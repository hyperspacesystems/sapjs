// The reducer: one person's or one agent's edit, applied to a sheet. An action names cells by id;
// the reducer turns the ids into positions, holds every rule and writes through the backing's
// primitives only. A refused action changes nothing, an applied one returns an action that puts the
// bytes back, and a host with no formatter writes the same cells as patchGrid (derivePlain).

import { modelBacking } from "./backing-model.js";
import { isKey } from "./codec/order-keys.js";
import { isCanonicalStyle, STYLE_PROPERTIES } from "./codec/styles.js";
import { canonStyle, cleanDeclaration, declarationProperty, isMixedStyle, mixedNext, splitDeclarations } from "./styles.js";
import { effectiveFmt } from "./content.js";
import { derivePlain } from "./derive-plain.js";
import { isBuiltin } from "./format.js";
import { typed } from "./codec/value.js";

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_FMT = 255;

const FIELDS = {
  set: ["v", "t", "sheet", "rows", "cols", "cells"],
  format: ["v", "t", "sheet", "cells"],
  insertRows: ["v", "t", "sheet", "rows"],
  deleteRows: ["v", "t", "sheet", "rows"],
  changeRows: ["v", "t", "sheet", "rows"],
  insertCols: ["v", "t", "sheet", "cols"],
  deleteCols: ["v", "t", "sheet", "cols"],
  changeCols: ["v", "t", "sheet", "cols"],
  merge: ["v", "t", "sheet", "from", "to", "clears"],
  unmerge: ["v", "t", "sheet", "row", "col"],
  freeze: ["v", "t", "sheet", "rowsThrough", "colsThrough"],
  batch: ["v", "t", "actions"],
};

const ROW_FIELDS = ["id", "pos", "height", "frozen", "style", "cells", "hidden"];

const COL_FIELDS = ["id", "pos", "width", "fmt", "frozen", "cells", "hidden"];

const KINDS = new Set(Object.keys(FIELDS));

export class GridRefused extends Error {
  constructor(code, detail) {
    super(detail);
    this.name = "GridRefused";
    this.code = code;
    this.detail = detail;
  }
}

const bad = (detail) => {
  throw new GridRefused("bad_action", detail);
};

const refusal = (code, detail) => ({ out: "refused", code, detail });

const coveredRefusal = (rowId, colId) =>
  refusal("covered_cell", `${rowId}/${colId} is a merge's covered position`);

function loneSurrogate(text) {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function checkText(value, what) {
  if (typeof value !== "string") bad(`${what} is not text`);
  if (value.includes("\0")) bad(`${what} holds a NUL`);
  if (value.includes("\r")) bad(`${what} holds a carriage return`);
  if (loneSurrogate(value)) bad(`${what} holds a lone surrogate`);
}

function checkId(value, what) {
  if (typeof value !== "string" || !ID.test(value)) bad(`${what} is not 1 to 64 of A-Z a-z 0-9 _ -`);
}

function checkPair(value, what) {
  if (!Array.isArray(value) || value.length !== 2) bad(`${what} is [rowId, colId]`);
  checkId(value[0], `${what} row id`);
  checkId(value[1], `${what} col id`);
}

function checkResult(value, what) {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) bad(`${what} has a formula result that is not a finite number`);
    return;
  }
  if (typeof value === "string") {
    checkText(value, `${what} formula result`);
    return;
  }
  bad(`${what} has a formula result that is not a number, true, false, text or null`);
}

function checkContent(content, what) {
  if (content === null) return;
  if (typeof content === "number") {
    if (!Number.isFinite(content)) bad(`${what} is not a finite number`);
    return;
  }
  if (typeof content === "boolean") return;
  if (typeof content === "string") {
    checkText(content, what);
    return;
  }
  if (typeof content === "object" && !Array.isArray(content)) {
    const keys = Object.keys(content);
    if (keys.length < 1 || keys.length > 2 || !keys.includes("f") || typeof content.f !== "string") {
      bad(`${what} is not exactly { f: text, r? }`);
    }
    checkText(content.f, what);
    if (!content.f.startsWith("=")) bad(`${what} is a formula that does not start with =`);
    if (Object.prototype.hasOwnProperty.call(content, "r")) checkResult(content.r, what);
    return;
  }
  bad(`${what} is not null, a number, true, false, text or { f, r? }`);
}

function checkStyle(style, what) {
  if (style === null || typeof style !== "object" || Array.isArray(style)) bad(`${what} is an object of properties`);
  for (const property of Object.keys(style)) {
    if (!STYLE_PROPERTIES.includes(property)) bad(`${property} is not a style property`);
    if (property === "border") bad("a border in an action is one of the four sides");
    const value = style[property];
    if (value === null) continue;
    if (typeof value !== "string") bad(`the style value of ${property} is text or null`);
    checkText(value, `the style value of ${property}`);
    if (/[;{}<\0\r\n]/.test(value)) bad(`the style value of ${property} holds a separator or a markup character`);
    if (!isCanonicalStyle(`${property}:${value}`)) bad(`${property}:${value} is not a canonical style`);
  }
}

// `css` and a row's `style` are whole-style strings: undo puts back what a person or an agent wrote,
// so they are accepted as written, with no fixed-point test. Only text the writer cannot write is
// refused: a NUL, a carriage return or a lone surrogate.
function checkWholeStyle(value, what) {
  if (typeof value !== "string") bad(`${what} is text`);
  if (value.includes("\0")) bad(`${what} holds a NUL`);
  if (value.includes("\r")) bad(`${what} holds a carriage return`);
  if (loneSurrogate(value)) bad(`${what} holds a lone surrogate`);
}

function checkExtra(extra, what, required) {
  if (extra === undefined) {
    if (required) bad(`${what} is required`);
    return;
  }
  if (extra === null || typeof extra !== "object" || Array.isArray(extra)) bad(`${what} is an object`);
  for (const key of Object.keys(extra)) if (key !== "fmt" && key !== "style" && key !== "css" && key !== "text") bad(`${key} is not a field of ${what}`);
  if (extra.css !== undefined) checkWholeStyle(extra.css, "a css");
  if (extra.text !== undefined) checkText(extra.text, "a text");
  if (extra.fmt !== undefined && extra.fmt !== null) {
    checkText(extra.fmt, "a fmt");
    if (extra.fmt.length > MAX_FMT) bad(`a fmt is longer than ${MAX_FMT} characters`);
  }
  if (extra.style !== undefined) checkStyle(extra.style, "a style");
}

function checkCells(action) {
  const set = action.t === "set";
  const cells = action.cells;
  if (!Array.isArray(cells) || cells.length === 0) bad("cells is a non-empty list");
  const seen = new Set();
  cells.forEach((entry, index) => {
    const widest = set ? 4 : 3;
    if (!Array.isArray(entry) || entry.length < 3 || entry.length > widest) {
      bad(`cells[${index}] is not [rowId, colId, ${set ? "content, extra?]" : "extra]"}`);
    }
    checkId(entry[0], `cells[${index}] row id`);
    checkId(entry[1], `cells[${index}] col id`);
    const at = `${entry[0]} ${entry[1]}`;
    if (seen.has(at)) bad(`the cell ${entry[0]}/${entry[1]} is named twice`);
    seen.add(at);
    if (set) {
      checkContent(entry[2], `cells[${index}] content`);
      checkExtra(entry[3], "extra", false);
    } else {
      checkExtra(entry[2], "extra", true);
    }
  });
}

const mergeRefusal = () => new GridRefused("merge_cut", "an inserted cell carries no span");

function checkKey(value, what) {
  if (!isKey(value)) throw new GridRefused("bad_key", `${what} is not an order key`);
}

function checkHeight(value, what, removable) {
  if (removable && value === null) return;
  if (!Number.isInteger(value) || value < 1 || value > 9999) bad(`${what} is a whole number of pixels from 1 to 9999`);
}

function checkWidth(value, what, removable) {
  if (removable && value === null) return;
  if (!Number.isInteger(value) || value < 0 || value > 9999999) bad(`${what} is a whole number of pixels from 0 to 9999999`);
}

function checkColFmt(value, what, removable) {
  if (removable && value === null) return;
  checkText(value, what);
  if (value.length > MAX_FMT) bad(`${what} is longer than ${MAX_FMT} characters`);
}

function checkRowCells(records, index) {
  const cells = records[index].cells;
  if (!Array.isArray(cells)) bad(`rows[${index}].cells is a list of cells`);
  const named = new Set();
  cells.forEach((entry, at) => {
    if (!Array.isArray(entry) || entry.length < 2 || entry.length > 4) bad(`rows[${index}].cells[${at}] is not [colId, content, extra?]`);
    checkId(entry[0], `rows[${index}].cells[${at}] col id`);
    if (named.has(entry[0])) bad(`rows[${index}] names the column ${entry[0]} twice`);
    named.add(entry[0]);
    checkContent(entry[1], `rows[${index}].cells[${at}] content`);
    if (entry.length === 4) throw mergeRefusal();
    if (entry[2] !== undefined && entry[2] !== null) {
      if (typeof entry[2] !== "object" || Array.isArray(entry[2])) bad(`rows[${index}].cells[${at}] extra is an object`);
      if (entry[2].span !== undefined || entry[2].colspan !== undefined || entry[2].rowspan !== undefined) throw mergeRefusal();
    }
    checkExtra(entry[2], "extra", false);
  });
}

function checkRowRecords(action) {
  const insert = action.t === "insertRows";
  const seen = new Set();
  action.rows.forEach((record, index) => {
    if (record === null || typeof record !== "object" || Array.isArray(record)) bad(`rows[${index}] is a record`);
    for (const key of Object.keys(record)) if (!ROW_FIELDS.includes(key)) bad(`${key} is not a field of a rows record`);
    if (record.hidden !== undefined) bad("hidden rows wait for step X1");
    checkId(record.id, `rows[${index}] id`);
    if (insert || record.pos !== undefined) checkKey(record.pos, `rows[${index}].pos`);
    if (record.height !== undefined) checkHeight(record.height, `rows[${index}].height`, !insert);
    if (record.style !== undefined) checkWholeStyle(record.style, `rows[${index}].style`);
    if (!insert) {
      for (const key of ["frozen", "cells"]) {
        if (record[key] !== undefined) bad(`${key} is not a field of a changeRows record`);
      }
    }
    if (record.frozen !== undefined && typeof record.frozen !== "boolean") bad(`rows[${index}].frozen is true or false`);
    if (insert && record.cells !== undefined) checkRowCells(action.rows, index);
    if (!insert && record.pos === undefined && record.height === undefined && record.style === undefined) {
      bad(`rows[${index}] changes no pos, no height and no style`);
    }
    if (seen.has(record.id)) bad(`the record ${record.id} is brought twice`);
    seen.add(record.id);
  });
}

function checkColCells(records, index) {
  const cells = records[index].cells;
  if (!Array.isArray(cells)) bad(`cols[${index}].cells is a list of cells`);
  const named = new Set();
  cells.forEach((entry, at) => {
    if (!Array.isArray(entry) || entry.length < 2 || entry.length > 4) bad(`cols[${index}].cells[${at}] is not [rowId, content, extra?]`);
    checkId(entry[0], `cols[${index}].cells[${at}] row id`);
    if (named.has(entry[0])) bad(`cols[${index}] names the row ${entry[0]} twice`);
    named.add(entry[0]);
    checkContent(entry[1], `cols[${index}].cells[${at}] content`);
    if (entry.length === 4) throw mergeRefusal();
    if (entry[2] !== undefined && entry[2] !== null) {
      if (typeof entry[2] !== "object" || Array.isArray(entry[2])) bad(`cols[${index}].cells[${at}] extra is an object`);
      if (entry[2].span !== undefined || entry[2].colspan !== undefined || entry[2].rowspan !== undefined) throw mergeRefusal();
    }
    checkExtra(entry[2], "extra", false);
  });
}

function checkColRecords(action) {
  const insert = action.t === "insertCols";
  const seen = new Set();
  action.cols.forEach((record, index) => {
    if (record === null || typeof record !== "object" || Array.isArray(record)) bad(`cols[${index}] is a record`);
    for (const key of Object.keys(record)) if (!COL_FIELDS.includes(key)) bad(`${key} is not a field of a cols record`);
    if (record.hidden !== undefined) bad("hidden columns wait for step X1");
    checkId(record.id, `cols[${index}] id`);
    if (insert || record.pos !== undefined) checkKey(record.pos, `cols[${index}].pos`);
    if (record.width !== undefined) checkWidth(record.width, `cols[${index}].width`, !insert);
    if (record.fmt !== undefined) checkColFmt(record.fmt, `cols[${index}].fmt`, !insert);
    if (record.frozen !== undefined && typeof record.frozen !== "boolean") bad(`cols[${index}].frozen is true or false`);
    if (!insert) {
      for (const key of ["frozen", "cells"]) {
        if (record[key] !== undefined) bad(`${key} is not a field of a changeCols record`);
      }
    }
    if (insert && record.cells !== undefined) checkColCells(action.cols, index);
    if (!insert && record.pos === undefined && record.width === undefined && record.fmt === undefined) bad(`cols[${index}] changes no pos, no width and no fmt`);
    if (seen.has(record.id)) bad(`the record ${record.id} is brought twice`);
    seen.add(record.id);
  });
}

function checkRecords(action) {
  if (action.t === "deleteRows") {
    if (!Array.isArray(action.rows) || action.rows.length === 0) bad("rows is a non-empty list of row ids");
    const gone = new Set();
    action.rows.forEach((id, index) => {
      checkId(id, `rows[${index}] id`);
      if (gone.has(id)) bad(`the row ${id} is deleted twice`);
      gone.add(id);
    });
    return;
  }
  if (action.t === "insertRows" || action.t === "changeRows") {
    if (!Array.isArray(action.rows) || action.rows.length === 0) bad("rows is a non-empty list of records");
    checkRowRecords(action);
    return;
  }
  if (action.t === "deleteCols") {
    if (!Array.isArray(action.cols) || action.cols.length === 0) bad("cols is a non-empty list of column ids");
    const gone = new Set();
    action.cols.forEach((id, index) => {
      checkId(id, `cols[${index}] id`);
      if (gone.has(id)) bad(`the column ${id} is deleted twice`);
      gone.add(id);
    });
    return;
  }
  if (action.t === "insertCols" || action.t === "changeCols") {
    if (!Array.isArray(action.cols) || action.cols.length === 0) bad("cols is a non-empty list of records");
    checkColRecords(action);
    return;
  }
  if (action.t === "merge") {
    checkPair(action.from, "from");
    checkPair(action.to, "to");
    if (action.clears !== undefined) {
      if (!Array.isArray(action.clears)) bad("clears is a list of [rowId, colId]");
      const seen = new Set();
      action.clears.forEach((pair, index) => {
        checkPair(pair, `clears[${index}]`);
        const key = `${pair[0]}/${pair[1]}`;
        if (seen.has(key)) bad(`clears names ${key} twice`);
        seen.add(key);
      });
    }
    return;
  }
  if (action.t === "unmerge") {
    checkId(action.row, "row");
    checkId(action.col, "col");
    return;
  }
  if (action.t === "freeze") {
    if (action.rowsThrough === undefined && action.colsThrough === undefined) {
      bad("a freeze names rowsThrough or colsThrough");
    }
    if (action.rowsThrough !== undefined && action.rowsThrough !== null) checkId(action.rowsThrough, "rowsThrough");
    if (action.colsThrough !== undefined && action.colsThrough !== null) checkId(action.colsThrough, "colsThrough");
    return;
  }
  const seen = new Set();
  for (const axis of ["rows", "cols"]) {
    const list = action[axis];
    if (list === undefined) continue;
    if (!Array.isArray(list)) bad(`${axis} is a list of records`);
    list.forEach((record, index) => {
      if (record === null || typeof record !== "object" || Array.isArray(record)) bad(`${axis}[${index}] is a record`);
      for (const key of Object.keys(record)) if (key !== "id" && key !== "pos") bad(`${key} is not a field of a ${axis} record`);
      checkId(record.id, `${axis}[${index}] id`);
      checkKey(record.pos, `${axis}[${index}].pos`);
      if (seen.has(record.id)) bad(`the record ${record.id} is brought twice`);
      seen.add(record.id);
    });
  }
}

export function validate(action) {
  if (action === null || typeof action !== "object" || Array.isArray(action)) bad("an action is an object");
  if (action.v !== 1) bad("v is 1");
  if (typeof action.t !== "string" || !KINDS.has(action.t)) bad(`${String(action.t)} is not an action kind`);
  for (const key of Object.keys(action)) if (!FIELDS[action.t].includes(key)) bad(`${key} is not a field of ${action.t}`);
  if (action.t === "batch") {
    if (!Array.isArray(action.actions) || action.actions.length === 0) bad("actions is a non-empty list");
    action.actions.forEach((one, index) => {
      if (one !== null && typeof one === "object" && one.t === "batch") bad(`actions[${index}] is a batch inside a batch`);
      validate(one);
    });
    return;
  }
  checkText(action.sheet, "sheet");
  if (action.t === "set" || action.t === "format") checkCells(action);
  checkRecords(action);
}

const deletions = (action) => ({
  rows: action.t === "deleteRows" ? action.rows : [],
  cols: action.t === "deleteCols" ? action.cols : [],
});

export function creates(action) {
  if (action.t === "batch") {
    const rows = [];
    const cols = [];
    const madeRows = new Set();
    const madeCols = new Set();
    for (const one of action.actions) {
      const part = creates(one);
      for (const id of part.rows) {
        madeRows.add(id);
        if (!rows.includes(id)) rows.push(id);
      }
      for (const id of part.cols) {
        madeCols.add(id);
        if (!cols.includes(id)) cols.push(id);
      }
      const gone = deletions(one);
      for (const id of gone.rows) {
        madeRows.delete(id);
        const at = rows.indexOf(id);
        if (at >= 0) rows.splice(at, 1);
      }
      for (const id of gone.cols) {
        madeCols.delete(id);
        const at = cols.indexOf(id);
        if (at >= 0) cols.splice(at, 1);
      }
    }
    const want = needs(action);
    return {
      rows: rows.filter((id) => !want.rows.includes(id)),
      cols: cols.filter((id) => !want.cols.includes(id)),
    };
  }
  return {
    rows: action.t === "deleteRows" || action.t === "changeRows" || action.rows === undefined ? [] : action.rows.map((record) => record.id),
    cols: action.t === "deleteCols" || action.t === "changeCols" || action.cols === undefined ? [] : action.cols.map((record) => record.id),
  };
}

export function needs(action) {
  if (action.t === "batch") {
    const rows = [];
    const cols = [];
    const madeRows = new Set();
    const madeCols = new Set();
    for (const one of action.actions) {
      const part = needs(one);
      for (const id of part.rows) if (!madeRows.has(id) && !rows.includes(id)) rows.push(id);
      for (const id of part.cols) if (!madeCols.has(id) && !cols.includes(id)) cols.push(id);
      const made = creates(one);
      for (const id of made.rows) madeRows.add(id);
      for (const id of made.cols) madeCols.add(id);
      const gone = deletions(one);
      for (const id of gone.rows) madeRows.delete(id);
      for (const id of gone.cols) madeCols.delete(id);
    }
    return { rows, cols };
  }
  if (action.t === "merge") {
    const clears = action.clears ?? [];
    return {
      rows: [...new Set([action.from[0], action.to[0], ...clears.map((pair) => pair[0])])],
      cols: [...new Set([action.from[1], action.to[1], ...clears.map((pair) => pair[1])])],
    };
  }
  if (action.t === "unmerge") return { rows: [action.row], cols: [action.col] };
  if (action.t === "freeze") {
    return {
      rows: typeof action.rowsThrough === "string" ? [action.rowsThrough] : [],
      cols: typeof action.colsThrough === "string" ? [action.colsThrough] : [],
    };
  }
  const brought = creates(action);
  if (action.t === "deleteRows" || action.t === "changeRows") {
    return { rows: action.rows.map((record) => (typeof record === "string" ? record : record.id)), cols: [] };
  }
  if (action.t === "deleteCols" || action.t === "changeCols") {
    return { rows: [], cols: action.cols.map((record) => (typeof record === "string" ? record : record.id)) };
  }
  const rows = [];
  const cols = [];
  for (const entry of cellEntries(action)) {
    if (!rows.includes(entry[0]) && !brought.rows.includes(entry[0])) rows.push(entry[0]);
    if (!cols.includes(entry[1]) && !brought.cols.includes(entry[1])) cols.push(entry[1]);
  }
  return { rows, cols };
}

const cellEntries = (action) => {
  if (action.t === "insertRows") return action.rows.flatMap((record) => (record.cells ?? []).map((entry) => [record.id, entry[0]]));
  if (action.t === "insertCols") return action.cols.flatMap((record) => (record.cells ?? []).map((entry) => [entry[0], record.id]));
  return action.cells ?? [];
};

export function targets(action) {
  if (action.t === "batch") return action.actions.flatMap((one) => targets(one));
  if (action.t === "merge") {
    const corners = [];
    for (const [row, col] of [action.from, action.to, [action.from[0], action.to[1]], [action.to[0], action.from[1]]]) {
      if (!corners.some(([r, c]) => r === row && c === col)) corners.push([row, col]);
    }
    const out = corners.flatMap(([row, col]) => [
      [action.sheet, row, col, "content"],
      [action.sheet, row, col, "span"],
    ]);
    for (const [row, col] of action.clears ?? []) {
      out.push(
        [action.sheet, row, col, "content"],
        [action.sheet, row, col, "fmt"],
        [action.sheet, row, col, "style:*"],
        [action.sheet, row, col, "span"],
      );
    }
    return out;
  }
  if (action.t === "unmerge") {
    return [
      [action.sheet, action.row, action.col, "content"],
      [action.sheet, action.row, action.col, "span"],
    ];
  }
  if (action.t === "freeze") {
    const out = [];
    if (action.rowsThrough !== undefined) out.push([action.sheet, "table", "", "freezeRows"]);
    if (action.colsThrough !== undefined) out.push([action.sheet, "table", "", "freezeCols"]);
    return out;
  }
  const set = action.t === "set";
  const grow = action.t === "insertRows" || action.t === "insertCols";
  const out = [];
  if (action.t === "insertRows" || action.t === "deleteRows") {
    for (const record of action.rows) out.push([action.sheet, "row", typeof record === "string" ? record : record.id, "exists"]);
    if (action.t === "insertRows") {
      for (const record of action.rows) {
        if (record.style !== undefined) out.push([action.sheet, "row", record.id, "rowstyle"]);
      }
    }
  }
  if (action.t === "insertCols" || action.t === "deleteCols") {
    for (const record of action.cols) out.push([action.sheet, "col", typeof record === "string" ? record : record.id, "exists"]);
  }
  if (action.t === "changeRows") {
    for (const record of action.rows) {
      if (record.pos !== undefined) out.push([action.sheet, "row", record.id, "pos"]);
      if (record.height !== undefined) {
        out.push([action.sheet, "row", record.id, "height"]);
        out.push([action.sheet, "row", record.id, "rowstyle"]);
      }
      if (record.style !== undefined) out.push([action.sheet, "row", record.id, "rowstyle"]);
    }
  }
  if (action.t === "changeCols") {
    for (const record of action.cols) {
      if (record.pos !== undefined) out.push([action.sheet, "col", record.id, "pos"]);
      if (record.width !== undefined) out.push([action.sheet, "col", record.id, "width"]);
      if (record.fmt !== undefined) out.push([action.sheet, "col", record.id, "fmt"]);
    }
  }
  if (action.t !== "deleteRows" && action.t !== "changeRows" && action.t !== "deleteCols" && action.t !== "changeCols") {
    const entries = action.t === "insertRows"
      ? action.rows.flatMap((record) => (record.cells ?? []).map((entry) => [record.id, entry[0], entry[1], entry[2]]))
      : action.t === "insertCols"
        ? action.cols.flatMap((record) => (record.cells ?? []).map((entry) => [entry[0], record.id, entry[1], entry[2]]))
        : action.cells;
    for (const entry of entries) {
      const extra = set || grow ? entry[3] : entry[2];
      if (set || grow || (extra && extra.text !== undefined)) out.push([action.sheet, entry[0], entry[1], "content"]);
      if (extra && extra.fmt !== undefined) out.push([action.sheet, entry[0], entry[1], "fmt"]);
      if (extra && extra.style !== undefined) {
        for (const property of Object.keys(extra.style)) out.push([action.sheet, entry[0], entry[1], `style:${targetOf(property, extra.style[property])}`]);
      }
      if (extra && extra.css !== undefined) out.push([action.sheet, entry[0], entry[1], "style:*"]);
    }
  }
  return out;
}

const contentOf = (cell) => {
  if (!cell || cell.hidden) return null;
  if (cell.f !== undefined) return { f: cell.f };
  return typed(cell.v ?? cell.text, cell.t === true);
};

// A formula restored by an inverse carries the stored result the cell had, so its bytes come back.
const inverseContent = (cell) => {
  if (!cell || cell.hidden) return null;
  if (cell.f === undefined) return typed(cell.v ?? cell.text, cell.t === true);
  if (cell.text === undefined && cell.v === undefined && cell.n === undefined) return { f: cell.f };
  return { f: cell.f, r: typed(cell.v ?? cell.text, cell.t === true) };
};

const cssOf = (style) => (typeof style === "string" ? canonStyle(style) : undefined);

const styleList = (style) => {
  const list = [];
  if (typeof style !== "string") return list;
  for (const declaration of splitDeclarations(style)) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;
    const property = declaration.slice(0, colon).trim();
    const value = declaration.slice(colon + 1).trim();
    if (property === "" || value === "") continue;
    const at = list.findIndex(([name]) => name === property);
    if (at === -1) list.push([property, value]);
    else list[at][1] = value;
  }
  return list;
};

const SIDES = ["border-top", "border-right", "border-bottom", "border-left"];

function expandedStyle(style) {
  const map = new Map();
  const clean = canonStyle(style);
  if (clean !== undefined) {
    for (const [property, value] of styleList(clean)) {
      if (property === "border") for (const side of SIDES) map.set(side, value);
      else map.set(property, value);
    }
  }
  return map;
}

const targetOf = (property, value) => {
  if (property === "background") return "background-color";
  const cleaned = cleanDeclaration(property, value);
  return cleaned === null ? property : cleaned[0];
};

function nextStyle(oldStyle, changes) {
  if (changes === undefined) return oldStyle ?? undefined;
  if (isMixedStyle(oldStyle)) return canonStyle(mixedNext(oldStyle, changes));
  const kept = expandedStyle(oldStyle);
  for (const property of Object.keys(changes)) {
    const value = changes[property];
    const cleaned = value === null ? null : cleanDeclaration(property, value);
    if (cleaned === null) {
      kept.delete(property);
      if (property === "background") kept.delete("background-color");
      continue;
    }
    kept.set(cleaned[0], cleaned[1]);
  }
  if (kept.size === 0) return undefined;
  return canonStyle(Array.from(kept, ([property, value]) => `${property}:${value}`).join(";"));
}

const nextFmt = (old, extra) => {
  if (extra.fmt === null) return undefined;
  if (typeof extra.fmt === "string") return extra.fmt;
  return old && old.fmt !== undefined ? old.fmt : undefined;
};

const blank = (cell) =>
  cell.text === "" &&
  cell.f === undefined &&
  cell.fmt === undefined &&
  cell.colspan === undefined &&
  cell.rowspan === undefined &&
  cell.style === undefined;

const isFormula = (content) => content !== null && typeof content === "object";

function cellFor(col, action, entry, old, derive) {
  const set = action.t === "set";
  const extra = (set ? entry[3] : entry[2]) ?? {};
  const fmt = nextFmt(old, extra);
  const effective = fmt !== undefined ? fmt : col && col.fmt !== undefined ? col.fmt : null;
  const content = set ? entry[2] : contentOf(old);
  const result = !set && old && old.f !== undefined ? typed(old.v ?? old.text, old.t === true) : undefined;
  const oldEffective = old && old.fmt !== undefined ? old.fmt : col && col.fmt !== undefined ? col.fmt : null;
  const keepText = !set && old && (fmt === old.fmt || (fmt !== undefined && fmt === oldEffective)) && effective !== null && !isBuiltin(effective);
  const made = keepText
    ? Object.fromEntries(["text", "n", "t", "v", "f"].filter((key) => old[key] !== undefined).map((key) => [key, old[key]]))
    : derive(content, effective, result) ?? { text: "" };
  if (extra.text !== undefined && effective !== null && !isBuiltin(effective)) {
    if (isFormula(content) && (set ? content.r === undefined : result === undefined)) bad("extra.text needs a formula that has a result");
    if (made.v === undefined && made.text !== extra.text) made.v = made.text;
    made.text = extra.text;
  }
  const next = { ...made };
  if (fmt !== undefined) next.fmt = fmt;
  if (old && old.colspan !== undefined) next.colspan = old.colspan;
  if (old && old.rowspan !== undefined) next.rowspan = old.rowspan;
  const base = extra.css !== undefined ? (extra.css === "" ? undefined : extra.css) : old && old.style;
  const style = nextStyle(base, extra.style);
  if (style !== undefined) next.style = style;
  return blank(next) ? null : next;
}

function inverseCell(action, entry, old, next, col) {
  const extra = action.t === "set" ? entry[3] : entry[2];
  const restore = { fmt: old && old.fmt !== undefined ? old.fmt : null };
  const text = carriedText(old, col);
  if (text !== undefined) restore.text = text;
  const changed = extra && extra.style !== undefined ? Object.keys(extra.style) : [];
  if (changed.length > 0) {
    if (isMixedStyle(old && old.style)) restore.css = old.style;
    else {
      const before = expandedStyle(old && old.style);
      const style = {};
      for (const property of changed) {
        const name = targetOf(property, extra.style[property]);
        style[name] = before.has(name) ? before.get(name) : null;
      }
      restore.style = style;
    }
  } else if (extra && extra.css !== undefined) {
    restore.css = old && typeof old.style === "string" ? old.style : "";
  }
  if (action.t === "format") return [entry[0], entry[1], restore];
  return [entry[0], entry[1], inverseContent(old), restore];
}

// A plain model, copied by value: the jsdom test environment has no structuredClone.
const snapshot = (sheet) => JSON.parse(JSON.stringify(sheet));

const trial = (content, fmt, result) => derivePlain(content, fmt, result);

function writeCells(backing, action, { derive }) {
  const changes = [];
  const inverses = [];
  const cols = backing.cols();
  for (const entry of action.cells) {
    const r = backing.rowIndex(entry[0]);
    const c = backing.colIndex(entry[1]);
    const old = backing.cell(r, c);
    const next = cellFor(cols[c], action, entry, old, derive);
    if (backing.cell(r, c)?.hidden) return coveredRefusal(entry[0], entry[1]);
    backing.putCell(r, c, next);
    changes.push({ sheet: action.sheet, row: entry[0], col: entry[1], before: contentOf(old), after: contentOf(next) });
    inverses.push(inverseCell(action, entry, old, next, cols[c]));
  }
  return { out: "applied", changes, inverses };
}

function deriveColCells(backing, action, c, derive) {
  const changes = [];
  const col = backing.cols()[c];
  backing.rows().forEach((row, r) => {
    const old = row.cells[c] ?? null;
    if (!old || old.hidden) return;
    if (old.fmt !== undefined) return;
    const content = contentOf(old);
    const result = old.f !== undefined ? typed(old.v ?? old.text, old.t === true) : undefined;
    const made = derive(content, col.fmt ?? null, result) ?? { text: "" };
    const next = { ...made };
    if (old.colspan !== undefined) next.colspan = old.colspan;
    if (old.rowspan !== undefined) next.rowspan = old.rowspan;
    if (old.style !== undefined) next.style = old.style;
    const kept = blank(next) ? null : next;
    backing.putCell(r, c, kept);
    changes.push({ sheet: action.sheet, row: row.id, col: col.id, before: contentOf(old), after: contentOf(kept) });
  });
  return changes;
}

const compareRows = (a, b) => {
  if (a.pos !== b.pos) return a.pos < b.pos ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

const landing = (rows, record) => {
  for (let i = 0; i < rows.length; i++) if (compareRows(rows[i], record) > 0) return i;
  return rows.length;
};

function withHeight(style, height) {
  const kept = typeof style === "string"
    ? splitDeclarations(style).map((one) => one.trim()).filter((one) => one !== "" && declarationProperty(one) !== "height")
    : [];
  if (height !== null && height !== undefined) kept.unshift(`height:${height}px`);
  const text = kept.join(";");
  return text === "" ? undefined : text;
}

const withoutSpans = (cell, rs, cs) => {
  const kept = { ...cell };
  delete kept.rowspan;
  delete kept.colspan;
  if (cs > 1) kept.colspan = cs;
  if (rs > 1) kept.rowspan = rs;
  return blank(kept) ? null : kept;
};

// A merge's anchor that a delete moves into another row or column keeps the look it had: the old
// effective format becomes its own when the new place shows a different one, and the cell is written
// in normal form under that format, so that the delete's undo and its redo write the same bytes.
function relocatedAnchor(anchor, rs, cs, oldFmt, hereFmt, derive) {
  const own = oldFmt === null ? undefined : oldFmt === hereFmt ? anchor.fmt : oldFmt;
  const finalFmt = own !== undefined ? own : hereFmt;
  const keep = oldFmt !== null && finalFmt === oldFmt && !isBuiltin(finalFmt);
  const content = contentOf(anchor);
  const result = anchor.f !== undefined ? typed(anchor.v ?? anchor.text, anchor.t === true) : undefined;
  const made = keep
    ? Object.fromEntries(["text", "n", "t", "v", "f"].filter((key) => anchor[key] !== undefined).map((key) => [key, anchor[key]]))
    : derive(content, finalFmt, result) ?? { text: "" };
  const next = { ...made };
  if (own !== undefined) next.fmt = own;
  if (cs > 1) next.colspan = cs;
  if (rs > 1) next.rowspan = rs;
  if (anchor.style !== undefined) next.style = anchor.style;
  return blank(next) ? null : next;
}

function mergeRecords(backing) {
  return mergeBoxes(backing).map((box) => ({
    row: backing.rows()[box.row].id,
    col: backing.cols()[box.col].id,
    bottom: backing.rows()[box.bottom].id,
    right: backing.cols()[box.right].id,
    anchor: backing.rows()[box.row].id,
    anchorCol: backing.cols()[box.col].id,
    changed: false,
  }));
}

function growMergeRows(backing, action, box, at, cells) {
  backing.putCell(box.row, box.col, { ...backing.cell(box.row, box.col), rowspan: box.rs + 1 });
  for (let j = 0; j <= box.right - box.col; j++) {
    backing.putCell(at, box.col + j, { text: "", hidden: true });
    cells.push({ sheet: action.sheet, row: backing.rows()[at].id, col: backing.cols()[box.col + j].id, before: null, after: null });
  }
}

function growMergeCols(backing, action, box, at, cells) {
  backing.putCell(box.row, box.col, { ...backing.cell(box.row, box.col), colspan: box.right - box.col + 2 });
  for (let i = 0; i <= box.bottom - box.row; i++) {
    backing.putCell(box.row + i, at, { text: "", hidden: true });
    cells.push({ sheet: action.sheet, row: backing.rows()[box.row + i].id, col: backing.cols()[at].id, before: null, after: null });
  }
}

function orderedRows(backing, records) {
  const order = backing.rows().map((row) => ({ id: row.id, pos: row.pos }));
  for (const record of records) {
    if (record.pos === undefined) continue;
    const from = order.findIndex((one) => one.id === record.id);
    const [row] = order.splice(from, 1);
    row.pos = record.pos;
    order.splice(landing(order, record), 0, row);
  }
  return order.map((row) => row.id);
}

function orderedCols(backing, records) {
  const order = backing.cols().map((col) => ({ id: col.id, pos: col.pos }));
  for (const record of records) {
    if (record.pos === undefined) continue;
    const from = order.findIndex((one) => one.id === record.id);
    const [col] = order.splice(from, 1);
    col.pos = record.pos;
    order.splice(landing(order, record), 0, col);
  }
  return order.map((col) => col.id);
}

// The frozen line is a row line only: frozen rows are written in their own row group and a cell
// cannot span two groups, so a vertical merge across it cannot be drawn. Frozen columns are sticky
// styles alone, so nothing structural stops a merge from crossing the freezeCols line.
function boxesApart(backing, order, axis) {
  const frozen = axis === "rows" ? backing.frozen().rows : Infinity;
  for (const box of mergeBoxes(backing)) {
    const first = axis === "rows" ? box.row : box.col;
    const last = axis === "rows" ? box.bottom : box.right;
    const records = axis === "rows" ? backing.rows() : backing.cols();
    const at = [];
    for (let i = first; i <= last; i++) at.push(order.indexOf(records[i].id));
    if (at.some((index, i) => i > 0 && index !== at[0] + i)) return `the move would leave a merge's ${axis} apart`;
    if (at[0] < frozen && at[at.length - 1] >= frozen) return "the move would put a merge across the frozen line";
  }
  return null;
}

const cutRefusal = (detail = "the move would leave a merge's parts apart") => refusal("merge_cut", detail);

// The guard refuses only when the action moves a formula: when some record that exists before and
// after the action changes its index and some cell in such a record holds a formula before or after
// the action. A row or column the action inserts or deletes does not count, so a formula that leaves
// with a deleted record, or arrives with an inserted one, can leave no cached result pointing at the
// wrong cell. A formula the action moves into a record that stays does count: it moves away from the
// references it was written against, and its undo would have to move it back.
const holdsFormula = (store, rows, cols) =>
  store.rows().some(
    (row) =>
      rows.has(row.id) &&
      row.cells.some((cell, c) => cell !== null && cell.f !== undefined && cols.has(store.cols()[c]?.id)),
  );

// The action written on a copy, so that the guard can see where a formula lands. The copy carries an
// engine, so its own guard is off and this cannot recurse.
function afterOf(backing, action) {
  if (backing.sheetId !== null && action.sheet !== backing.sheetId) return null;
  const scratch = modelBacking(snapshot(backing.sheet), { sheetId: backing.sheetId });
  let out;
  try {
    out = writeAction(scratch, action, { derive: trial, formulas: {} });
  } catch {
    return null;
  }
  return out.out === "applied" ? scratch : null;
}

const guarded = (backing, action, formulas) => {
  if (formulas !== null) return false;
  const after = afterOf(backing, action);
  if (after === null) return false;
  const rows = new Set(backing.rows().map((row) => row.id).filter((id) => after.rowIndex(id) >= 0));
  const cols = new Set(backing.cols().map((col) => col.id).filter((id) => after.colIndex(id) >= 0));
  return holdsFormula(backing, rows, cols) || holdsFormula(after, rows, cols);
};

const engineRefusal = () => refusal("needs_formula_engine", "a row edit that moves an existing row needs the formula engine");

const colEngineRefusal = () => refusal("needs_formula_engine", "a column edit that moves an existing column needs the formula engine");

// Does any row or column that exists before the action, and still exists after it, change its index?
// Inserts that land after every existing record keep the order, a delete of a block that runs to the
// end keeps it, and a move keeps it when no remaining record's index changes.
const keepsOrder = (before, after) => {
  const at = new Map(before.map((id, index) => [id, index]));
  return after.every((id, index) => {
    const was = at.get(id);
    return was === undefined || was === index;
  });
};

function orderAfter(records, action, axis) {
  const order = records.map((record) => ({ id: record.id, pos: record.pos }));
  const list = (axis === "rows" ? action.rows : action.cols) ?? [];
  const inserting = action.t === (axis === "rows" ? "insertRows" : "insertCols");
  const deleting = action.t === (axis === "rows" ? "deleteRows" : "deleteCols");
  if (inserting) {
    for (const record of list) order.splice(landing(order, record), 0, { id: record.id, pos: record.pos });
  } else if (deleting) {
    for (const record of list) {
      const id = typeof record === "string" ? record : record.id;
      const at = order.findIndex((one) => one.id === id);
      if (at >= 0) order.splice(at, 1);
    }
  } else {
    for (const record of list) {
      if (record.pos === undefined) continue;
      const at = order.findIndex((one) => one.id === record.id);
      if (at < 0) continue;
      const [one] = order.splice(at, 1);
      one.pos = record.pos;
      order.splice(landing(order, record), 0, one);
    }
  }
  return order.map((one) => one.id);
}

const movesRows = (backing, action) => !keepsOrder(backing.rows().map((row) => row.id), orderAfter(backing.rows(), action, "rows"));

const movesCols = (backing, action) => !keepsOrder(backing.cols().map((col) => col.id), orderAfter(backing.cols(), action, "cols"));

function recordOf(row, cols) {
  const record = { id: row.id, pos: row.pos };
  if (row.style !== undefined) record.style = row.style;
  if (row.frozen === true) record.frozen = true;
  const cells = [];
  row.cells.forEach((cell, c) => {
    if (!cell || cell.hidden) return;
    const extra = cellExtra(cell, cols[c]);
    cells.push([cols[c].id, inverseContent(cell), extra]);
  });
  if (cells.length > 0) record.cells = cells;
  return record;
}

function recordOfCol(col, rows, at) {
  const record = { id: col.id, pos: col.pos };
  if (col.width !== undefined) record.width = col.width;
  if (col.fmt !== undefined) record.fmt = col.fmt;
  const cells = [];
  rows.forEach((row) => {
    const cell = row.cells[at] ?? null;
    if (!cell || cell.hidden) return;
    const extra = cellExtra(cell, col);
    cells.push([row.id, inverseContent(cell), extra]);
  });
  if (cells.length) record.cells = cells;
  return record;
}

function writeInsert(backing, action, { derive, formulas }) {
  const rows = [];
  const cells = [];
  const brought = [];
  let wroteFormula = false;
  if (guarded(backing, action, formulas) && movesRows(backing, action)) return engineRefusal();
  for (const record of action.rows) {
    if (backing.rowIndex(record.id) >= 0 || backing.colIndex(record.id) >= 0) {
      return refusal("exists", `the id ${record.id} is already in the sheet`);
    }
    const at = landing(backing.rows(), record);
    const frozen = backing.frozen().rows;
    if (record.frozen === true && at > frozen) {
      return refusal("bad_action", `the frozen row ${record.id} would land after the frozen block`);
    }
    const grown = mergeBoxes(backing).filter((box) => box.row < at && at <= box.bottom);
    const nextFrozen = record.frozen === true || at < frozen ? frozen + 1 : frozen;
    if (grown.some((box) => box.row < nextFrozen && box.bottom + 1 >= nextFrozen)) {
      return cutRefusal("the merge would cross the frozen line");
    }

    const style = record.height !== undefined ? withHeight(record.style, record.height) : record.style;
    backing.insertRow(at, { id: record.id, pos: record.pos, style });
    if (record.frozen === true || at < frozen) backing.setFrozen({ rows: frozen + 1 });
    rows.push({ sheet: action.sheet, row: record.id, kind: "insert" });
    for (const box of grown) growMergeRows(backing, action, box, at, cells);
    for (const entry of record.cells ?? []) {
      const c = backing.colIndex(entry[0]);
      if (c < 0) return refusal("missing_col", `column ${entry[0]} is not in the sheet`);
      if (backing.cell(at, c)?.hidden) return coveredRefusal(record.id, entry[0]);
      const next = cellFor(backing.cols()[c], { t: "set" }, [record.id, entry[0], entry[1], entry[2]], null, derive);
      backing.putCell(at, c, next);
      cells.push({ sheet: action.sheet, row: record.id, col: entry[0], before: null, after: contentOf(next) });
      if (isFormula(entry[1])) wroteFormula = true;
    }
    brought.push(record.id);
  }
  return {
    out: "applied",
    inverse: { v: 1, t: "deleteRows", sheet: action.sheet, rows: brought },
    changes: { rows, cells },
    wroteFormula,
  };
}

function writeDelete(backing, action, { derive, formulas }) {
  const rows = [];
  const cells = [];
  const records = [];
  const boxes = mergeRecords(backing);
  if (guarded(backing, action, formulas) && movesRows(backing, action)) return engineRefusal();
  for (const id of action.rows) {
    const at = backing.rowIndex(id);
    const frozen = backing.frozen().rows;
    const was = backing.rows()[at].frozen === true;
    records.push(recordOf(backing.rows()[at], backing.cols()));
    for (const box of boxes) {
      const anchorAt = box.anchor === null ? -1 : backing.rowIndex(box.anchor);
      if (anchorAt < 0 || anchorAt > at) continue;
      const c = backing.colIndex(box.col);
      const anchor = backing.cell(anchorAt, c);
      const rs = anchor === null ? 1 : anchor.rowspan ?? 1;
      const cs = anchor === null ? 1 : anchor.colspan ?? 1;
      if (rs === 1 && cs === 1) continue;
      if (anchorAt === at) {
        box.changed = true;
        if (rs === 1) {
          box.anchor = null;
          continue;
        }
        const line = backing.cols();
        const oldFmt = anchor.fmt !== undefined ? anchor.fmt : line[c].fmt !== undefined ? line[c].fmt : null;
        const hereFmt = line[c].fmt !== undefined ? line[c].fmt : null;
        const moved = relocatedAnchor(anchor, rs - 1, cs, oldFmt, hereFmt, derive);
        const below = backing.cell(at + 1, c);
        backing.putCell(at + 1, c, moved);
        cells.push({ sheet: action.sheet, row: backing.rows()[at + 1].id, col: box.col, before: contentOf(below), after: contentOf(moved) });
        box.anchor = backing.rows()[at + 1].id;
      } else if (at <= anchorAt + rs - 1) {
        box.changed = true;
        backing.putCell(anchorAt, c, withoutSpans(anchor, rs - 1, cs));
      }
    }
    backing.removeRow(at);
    if (was) backing.setFrozen({ rows: frozen - 1 });
    rows.push({ sheet: action.sheet, row: id, kind: "delete" });
  }
  const plain = { v: 1, t: "insertRows", sheet: action.sheet, rows: records };
  const actions = [];
  for (const box of boxes) {
    if (!box.changed) continue;
    const anchorAt = box.anchor === null ? -1 : backing.rowIndex(box.anchor);
    const anchor = anchorAt < 0 ? null : backing.cell(anchorAt, backing.colIndex(box.col));
    if (anchor !== null && (anchor.colspan !== undefined || anchor.rowspan !== undefined)) {
      actions.push({ v: 1, t: "unmerge", sheet: action.sheet, row: box.anchor, col: box.col });
    }
  }
  const restored = modelBacking(snapshot(backing.sheet), { sheetId: backing.sheetId });
  for (const one of actions) writeAction(restored, one, { derive, formulas });
  writeInsert(restored, plain, { derive, formulas });
  const restores = [];
  for (const box of boxes) {
    if (!box.changed) continue;
    restores.push({
      v: 1,
      t: "merge",
      sheet: action.sheet,
      from: [box.row, box.col],
      to: [box.bottom, box.right],
      clears: clearsThen(restored, box.row, box.col, box.bottom, box.right),
    });
  }
  const inverse = restores.length === 0 ? plain : { v: 1, t: "batch", actions: [...actions, plain, ...restores] };
  return { out: "applied", inverse, changes: { rows, cells } };
}

function writeChange(backing, action, { formulas }) {
  const rows = [];
  const records = [];
  if (action.rows.some((record) => record.pos !== undefined)) {
    const cut = boxesApart(backing, orderedRows(backing, action.rows), "rows");
    if (cut !== null) return cutRefusal(cut);
  }
  if (guarded(backing, action, formulas) && movesRows(backing, action)) return engineRefusal();
  for (const record of action.rows) {
    const from = backing.rowIndex(record.id);
    const row = backing.rows()[from];
    const before = { id: record.id };
    let to = from;
    if (record.pos !== undefined) {
      const others = backing.rows().filter((one, i) => i !== from);
      to = landing(others, record);
      before.pos = row.pos;
      rows.push({ sheet: action.sheet, row: record.id, kind: "move" });
    }
    const base = record.style !== undefined ? record.style : row.style;
    const style = record.height !== undefined ? withHeight(base, record.height) : base;
    if (record.height !== undefined || record.style !== undefined) {
      before.style = row.style === undefined ? "" : row.style;
      rows.push({ sheet: action.sheet, row: record.id, kind: record.height !== undefined ? "height" : "style" });
    }
    const frozen = backing.frozen().rows;
    if (record.pos !== undefined) backing.putRow(from, { pos: record.pos });
    if (record.height !== undefined || record.style !== undefined) backing.putRow(from, { style: style === "" ? undefined : style });
    if (record.pos !== undefined) {
      backing.moveRow(from, to);
      backing.setFrozen({ rows: frozen });
    }
    records.push(before);
  }
  return {
    out: "applied",
    inverse: { v: 1, t: "changeRows", sheet: action.sheet, rows: records },
    changes: { rows, cells: [] },
  };
}

function writeInsertCols(backing, action, { derive, formulas }) {
  const cols = [];
  const cells = [];
  const brought = [];
  let wroteFormula = false;
  if (guarded(backing, action, formulas) && movesCols(backing, action)) return colEngineRefusal();
  for (const record of action.cols) {
    if (backing.colIndex(record.id) >= 0 || backing.rowIndex(record.id) >= 0) {
      return refusal("exists", `the id ${record.id} is already in the sheet`);
    }
    const at = landing(backing.cols(), record);
    const frozen = backing.frozen().cols;
    if (record.frozen === true && at > frozen) {
      return refusal("bad_action", `the frozen column ${record.id} would land after the frozen block`);
    }
    const grown = mergeBoxes(backing).filter((box) => box.col < at && at <= box.right);
    backing.insertCol(at, record);
    if (record.frozen === true || at < frozen) backing.setFrozen({ cols: frozen + 1 });
    cols.push({ sheet: action.sheet, col: record.id, kind: "insert" });
    for (const box of grown) growMergeCols(backing, action, box, at, cells);
    for (const entry of record.cells ?? []) {
      const r = backing.rowIndex(entry[0]);
      if (r < 0) return refusal("missing_row", `row ${entry[0]} is not in the sheet`);
      if (backing.cell(r, at)?.hidden) return coveredRefusal(entry[0], record.id);
      const next = cellFor(backing.cols()[at], { t: "set" }, [entry[0], record.id, entry[1], entry[2]], null, derive);
      backing.putCell(r, at, next);
      cells.push({ sheet: action.sheet, row: entry[0], col: record.id, before: null, after: contentOf(next) });
      if (isFormula(entry[1])) wroteFormula = true;
    }
    brought.push(record.id);
  }
  return {
    out: "applied",
    inverse: { v: 1, t: "deleteCols", sheet: action.sheet, cols: brought },
    changes: { rows: [], cols, cells },
    wroteFormula,
  };
}

function writeDeleteCols(backing, action, { derive, formulas }) {
  const cols = [];
  const cells = [];
  const records = [];
  const boxes = mergeRecords(backing);
  if (guarded(backing, action, formulas) && movesCols(backing, action)) return colEngineRefusal();
  for (const id of action.cols) {
    const at = backing.colIndex(id);
    const frozen = backing.frozen().cols;
    const was = at < frozen;
    const record = recordOfCol(backing.cols()[at], backing.rows(), at);
    if (was) record.frozen = true;
    records.push(record);
    for (const box of boxes) {
      const anchorAt = box.anchorCol === null ? -1 : backing.colIndex(box.anchorCol);
      if (anchorAt < 0 || anchorAt > at) continue;
      const r = backing.rowIndex(box.row);
      const anchor = backing.cell(r, anchorAt);
      const rs = anchor === null ? 1 : anchor.rowspan ?? 1;
      const cs = anchor === null ? 1 : anchor.colspan ?? 1;
      if (rs === 1 && cs === 1) continue;
      if (anchorAt === at) {
        box.changed = true;
        if (cs === 1) {
          box.anchor = null;
          box.anchorCol = null;
          continue;
        }
        const line = backing.cols();
        const oldFmt = anchor.fmt !== undefined ? anchor.fmt : line[at].fmt !== undefined ? line[at].fmt : null;
        const hereFmt = line[at + 1].fmt !== undefined ? line[at + 1].fmt : null;
        const moved = relocatedAnchor(anchor, rs, cs - 1, oldFmt, hereFmt, derive);
        const beside = backing.cell(r, at + 1);
        backing.putCell(r, at + 1, moved);
        cells.push({ sheet: action.sheet, row: box.row, col: backing.cols()[at + 1].id, before: contentOf(beside), after: contentOf(moved) });
        box.anchorCol = backing.cols()[at + 1].id;
      } else if (at <= anchorAt + cs - 1) {
        box.changed = true;
        backing.putCell(r, anchorAt, withoutSpans(anchor, rs, cs - 1));
      }
    }
    backing.removeCol(at);
    if (was) backing.setFrozen({ cols: frozen - 1 });
    cols.push({ sheet: action.sheet, col: id, kind: "delete" });
  }
  const plain = { v: 1, t: "insertCols", sheet: action.sheet, cols: records };
  const actions = [];
  for (const box of boxes) {
    if (!box.changed) continue;
    const anchorAt = box.anchorCol === null ? -1 : backing.colIndex(box.anchorCol);
    const anchor = anchorAt < 0 ? null : backing.cell(backing.rowIndex(box.row), anchorAt);
    if (anchor !== null && (anchor.colspan !== undefined || anchor.rowspan !== undefined)) {
      actions.push({ v: 1, t: "unmerge", sheet: action.sheet, row: box.row, col: box.anchorCol });
    }
  }
  const restored = modelBacking(snapshot(backing.sheet), { sheetId: backing.sheetId });
  for (const one of actions) writeAction(restored, one, { derive, formulas });
  writeInsertCols(restored, plain, { derive, formulas });
  const restores = [];
  for (const box of boxes) {
    if (!box.changed) continue;
    restores.push({
      v: 1,
      t: "merge",
      sheet: action.sheet,
      from: [box.row, box.col],
      to: [box.bottom, box.right],
      clears: clearsThen(restored, box.row, box.col, box.bottom, box.right),
    });
  }
  const inverse = restores.length === 0 ? plain : { v: 1, t: "batch", actions: [...actions, plain, ...restores] };
  return { out: "applied", inverse, changes: { rows: [], cols, cells } };
}

// The cells of a column whose text the column's own format showed: the inverse of a column-format
// change writes those cells back with the text they showed, after the column's format comes back.
function carriedCells(backing, at, col) {
  const out = [];
  if (col.fmt === undefined || isBuiltin(col.fmt)) return out;
  backing.rows().forEach((row) => {
    const old = row.cells[at] ?? null;
    if (!old || old.hidden || old.fmt !== undefined) return;
    const text = carriedText(old, col);
    if (text === undefined || text === "") return;
    out.push([row.id, col.id, inverseContent(old), { text }]);
  });
  return out;
}

function writeChangeCols(backing, action, { derive, formulas }) {
  const cols = [];
  const cells = [];
  const records = [];
  const restore = [];
  if (action.cols.some((record) => record.pos !== undefined)) {
    const cut = boxesApart(backing, orderedCols(backing, action.cols), "cols");
    if (cut !== null) return cutRefusal(cut);
  }
  if (guarded(backing, action, formulas) && movesCols(backing, action)) return colEngineRefusal();
  for (const record of action.cols) {
    const from = backing.colIndex(record.id);
    const col = backing.cols()[from];
    const before = { id: record.id };
    let to = from;
    if (record.pos !== undefined) {
      const others = backing.cols().filter((one, i) => i !== from);
      to = landing(others, record);
      before.pos = col.pos;
      cols.push({ sheet: action.sheet, col: record.id, kind: "move" });
    }
    if (record.width !== undefined) {
      before.width = col.width ?? null;
      cols.push({ sheet: action.sheet, col: record.id, kind: "width" });
    }
    if (record.fmt !== undefined) {
      before.fmt = col.fmt ?? null;
      cols.push({ sheet: action.sheet, col: record.id, kind: "fmt" });
    }
    const frozen = backing.frozen().cols;
    if (record.pos !== undefined) backing.putCol(from, { pos: record.pos });
    if (record.width !== undefined) backing.putCol(from, { width: record.width === null ? undefined : record.width });
    if (record.fmt !== undefined) {
      const sameFmt = (record.fmt === null ? undefined : record.fmt) === col.fmt;
      if (!sameFmt) {
        for (const entry of carriedCells(backing, from, col)) restore.push(entry);
        backing.putCol(from, { fmt: record.fmt === null ? undefined : record.fmt });
        for (const change of deriveColCells(backing, action, from, derive)) cells.push(change);
      }
    }
    if (record.pos !== undefined) {
      backing.moveCol(from, to);
      backing.setFrozen({ cols: frozen });
    }
    records.push(before);
  }
  const back = { v: 1, t: "changeCols", sheet: action.sheet, cols: records };
  const inverse = restore.length === 0
    ? back
    : { v: 1, t: "batch", actions: [back, { v: 1, t: "set", sheet: action.sheet, cells: restore }] };
  return { out: "applied", inverse, changes: { rows: [], cols, cells } };
}

function mergeBoxes(backing) {
  const boxes = [];
  backing.rows().forEach((row, r) => {
    row.cells.forEach((cell, c) => {
      if (!cell) return;
      const rs = cell.rowspan ?? 1;
      const cs = cell.colspan ?? 1;
      if (rs === 1 && cs === 1) return;
      boxes.push({ row: r, col: c, bottom: r + rs - 1, right: c + cs - 1, rs, cs });
    });
  });
  return boxes;
}

const touches = (box, top, bottom, left, right) =>
  box.row <= bottom && box.bottom >= top && box.col <= right && box.right >= left;

const holds = (box, top, bottom, left, right) =>
  box.row >= top && box.bottom <= bottom && box.col >= left && box.right <= right;

// A cell whose format the grid does not know shows text the value alone does not say, so an inverse
// that writes the cell back carries that text and `apply` writes it instead of the derived one.
const carriedText = (cell, col) => {
  if (!cell || cell.hidden || cell.text === undefined) return undefined;
  const fmt = effectiveFmt(cell, col);
  return fmt !== null && !isBuiltin(fmt) ? cell.text : undefined;
};

const cellExtra = (cell, col) => {
  const extra = { fmt: cell.fmt !== undefined ? cell.fmt : null };
  const css = cssOf(cell.style);
  if (css !== undefined) extra.css = css;
  const text = carriedText(cell, col);
  if (text !== undefined) extra.text = text;
  return extra;
};

// Only the row line can cut a merge: a merge across the freezeCols line is drawn, so a freeze of
// columns never refuses for one.
const cutsFrozen = (backing, rows) =>
  mergeBoxes(backing).some((box) => box.rs > 1 && box.row < rows && box.bottom >= rows);

// A merge names the non-blank cells it clears in `clears`, because co-editing finds conflicts with
// `targets` alone: a merge that empties a cell someone else just wrote must name that cell, and one
// whose rectangle no longer holds the cells its author saw is refused instead of wiping the write.
const notBlank = (cell) => cell !== null && cell !== undefined && !blank(cell);

// The cells inside a rectangle other than its anchor that hold content, fmt or style.
function clearedBetween(backing, top, bottom, left, right) {
  const rows = backing.rows();
  const cols = backing.cols();
  const out = [];
  for (let r = top; r <= bottom; r++) {
    for (let c = left; c <= right; c++) {
      if (r === top && c === left) continue;
      if (r >= rows.length || c >= cols.length) continue;
      if (!notBlank(backing.cell(r, c))) continue;
      out.push([rows[r].id, cols[c].id]);
    }
  }
  return out;
}

// The cells a restore merge will clear: read from the state the inverse reaches just before it runs.
function clearsThen(scratch, rowFrom, colFrom, rowTo, colTo) {
  const top = scratch.rowIndex(rowFrom);
  const bottom = scratch.rowIndex(rowTo);
  const left = scratch.colIndex(colFrom);
  const right = scratch.colIndex(colTo);
  if (top < 0 || bottom < 0 || left < 0 || right < 0) return [];
  return clearedBetween(scratch, top, bottom, left, right);
}

const sameIds = (left, right) => {
  if (left.length !== right.length) return false;
  const keys = new Set(left.map((pair) => `${pair[0]}/${pair[1]}`));
  return right.every((pair) => keys.has(`${pair[0]}/${pair[1]}`));
};

function writeMerge(backing, action) {
  const rows = backing.rows();
  const cols = backing.cols();
  const top = Math.min(backing.rowIndex(action.from[0]), backing.rowIndex(action.to[0]));
  const bottom = Math.max(backing.rowIndex(action.from[0]), backing.rowIndex(action.to[0]));
  const left = Math.min(backing.colIndex(action.from[1]), backing.colIndex(action.to[1]));
  const right = Math.max(backing.colIndex(action.from[1]), backing.colIndex(action.to[1]));
  if (top === bottom && left === right) {
    return refusal("bad_action", "a merge is at least two cells");
  }
  const boxes = mergeBoxes(backing);
  if (boxes.some((box) => touches(box, top, bottom, left, right) && !holds(box, top, bottom, left, right))) {
    return refusal("merge_overlap", "a merge crosses the edge of the new one");
  }
  const frozen = backing.frozen();
  if (top < frozen.rows && bottom >= frozen.rows) {
    return refusal("merge_cut", "the merge would cross the frozen row line");
  }

  if (!sameIds(clearedBetween(backing, top, bottom, left, right), action.clears ?? [])) {
    return refusal("merge_stale", "the cells inside the merge are not the ones the action names");
  }

  const anchor = { ...(backing.cell(top, left) ?? { text: "" }) };
  delete anchor.colspan;
  delete anchor.rowspan;
  if (anchor.text === undefined) anchor.text = "";
  if (right > left) anchor.colspan = right - left + 1;
  if (bottom > top) anchor.rowspan = bottom - top + 1;
  backing.putCell(top, left, anchor);

  const changes = [];
  const restore = [];
  for (let r = top; r <= bottom; r++) {
    for (let c = left; c <= right; c++) {
      if (r === top && c === left) continue;
      const old = backing.cell(r, c);
      backing.putCell(r, c, { text: "", hidden: true });
      changes.push({ sheet: action.sheet, row: rows[r].id, col: cols[c].id, before: contentOf(old), after: null });
      if (old && !old.hidden) restore.push([rows[r].id, cols[c].id, inverseContent(old), cellExtra(old, cols[c])]);
    }
  }

  const actions = [{ v: 1, t: "unmerge", sheet: action.sheet, row: rows[top].id, col: cols[left].id }];
  if (restore.length > 0) actions.push({ v: 1, t: "set", sheet: action.sheet, cells: restore });
  for (const box of boxes) {
    if (!holds(box, top, bottom, left, right)) continue;
    actions.push({
      v: 1,
      t: "merge",
      sheet: action.sheet,
      from: [rows[box.row].id, cols[box.col].id],
      to: [rows[box.bottom].id, cols[box.right].id],
      clears: clearedBetween(backing, box.row, box.bottom, box.col, box.right),
    });
  }
  return { out: "applied", inverse: { v: 1, t: "batch", actions }, changes: { rows: [], cells: changes } };
}

function writeUnmerge(backing, action) {
  const rows = backing.rows();
  const cols = backing.cols();
  const r = backing.rowIndex(action.row);
  const c = backing.colIndex(action.col);
  const cell = backing.cell(r, c);
  if (!cell || (cell.colspan === undefined && cell.rowspan === undefined)) {
    return refusal("bad_action", "not a merge anchor");
  }
  const rs = Math.min(cell.rowspan ?? 1, rows.length - r);
  const cs = Math.min(cell.colspan ?? 1, cols.length - c);
  const anchor = { ...cell };
  delete anchor.colspan;
  delete anchor.rowspan;
  backing.putCell(r, c, blank(anchor) ? null : anchor);
  const changes = [];
  for (let i = 0; i < rs; i++) {
    for (let j = 0; j < cs; j++) {
      if (i === 0 && j === 0) continue;
      const old = backing.cell(r + i, c + j);
      backing.putCell(r + i, c + j, null);
      changes.push({ sheet: action.sheet, row: rows[r + i].id, col: cols[c + j].id, before: contentOf(old), after: null });
    }
  }
  return {
    out: "applied",
    inverse: {
      v: 1,
      t: "merge",
      sheet: action.sheet,
      from: [action.row, action.col],
      to: [rows[r + rs - 1].id, cols[c + cs - 1].id],
      clears: clearedBetween(backing, r, r + rs - 1, c, c + cs - 1),
    },
    changes: { rows: [], cells: changes },
  };
}

function writeFreeze(backing, action) {
  const rows = backing.frozen().rows;
  const cols = backing.frozen().cols;
  const nextRows = action.rowsThrough === undefined
    ? rows
    : action.rowsThrough === null
      ? 0
      : backing.rowIndex(action.rowsThrough) + 1;
  const nextCols = action.colsThrough === undefined
    ? cols
    : action.colsThrough === null
      ? 0
      : backing.colIndex(action.colsThrough) + 1;
  if (cutsFrozen(backing, nextRows)) {
    return refusal("merge_cut", "the freeze line would cut a merge");
  }
  if (action.rowsThrough !== undefined) backing.setFrozen({ rows: nextRows });
  if (action.colsThrough !== undefined) backing.setFrozen({ cols: nextCols });
  const table = [];
  if (action.rowsThrough !== undefined) {
    table.push({ sheet: action.sheet, field: "freezeRows", before: rows, after: nextRows });
  }
  if (action.colsThrough !== undefined) {
    table.push({ sheet: action.sheet, field: "freezeCols", before: cols, after: nextCols });
  }
  const inverse = { v: 1, t: "freeze", sheet: action.sheet };
  if (action.rowsThrough !== undefined) inverse.rowsThrough = rows === 0 ? null : backing.rows()[rows - 1].id;
  if (action.colsThrough !== undefined) inverse.colsThrough = cols === 0 ? null : backing.cols()[cols - 1].id;
  return { out: "applied", inverse, changes: { rows: [], cells: [], table } };
}

function writeSetWithStructure(backing, action, { derive, formulas }) {
  const kept = action.cells.map((entry) => backing.rowIndex(entry[0]) >= 0 && backing.colIndex(entry[1]) >= 0);
  const rows = action.rows ?? [];
  const cols = action.cols ?? [];
  let grownRows = null;
  let grownCols = null;
  if (rows.length > 0) {
    grownRows = writeInsert(backing, { v: 1, t: "insertRows", sheet: action.sheet, rows }, { derive, formulas });
    if (grownRows.out !== "applied") return grownRows;
  }
  if (cols.length > 0) {
    grownCols = writeInsertCols(backing, { v: 1, t: "insertCols", sheet: action.sheet, cols }, { derive, formulas });
    if (grownCols.out !== "applied") return grownCols;
  }
  const written = writeCells(backing, action, { derive });
  if (written.out !== "applied") return written;
  const actions = [];
  const restore = written.inverses.filter((entry, i) => kept[i]);
  if (restore.length > 0) actions.push({ v: 1, t: "set", sheet: action.sheet, cells: restore });
  if (grownCols !== null) actions.push(grownCols.inverse);
  if (grownRows !== null) actions.push(grownRows.inverse);
  return {
    out: "applied",
    inverse: { v: 1, t: "batch", actions },
    changes: {
      rows: grownRows === null ? [] : grownRows.changes.rows,
      cols: grownCols === null ? [] : grownCols.changes.cols,
      cells: written.changes,
    },
    wroteFormula: grownRows?.wroteFormula === true || grownCols?.wroteFormula === true,
  };
}

function writeSet(backing, action, { derive }) {
  const written = writeCells(backing, action, { derive });
  if (written.out !== "applied") return written;
  return {
    out: "applied",
    inverse: { v: 1, t: action.t, sheet: action.sheet, cells: written.inverses },
    changes: { rows: [], cells: written.changes },
  };
}

function writeAction(backing, action, options) {
  if (action.t === "insertRows") return writeInsert(backing, action, options);
  if (action.t === "deleteRows") return writeDelete(backing, action, options);
  if (action.t === "changeRows") return writeChange(backing, action, options);
  if (action.t === "insertCols") return writeInsertCols(backing, action, options);
  if (action.t === "deleteCols") return writeDeleteCols(backing, action, options);
  if (action.t === "changeCols") return writeChangeCols(backing, action, options);
  if (action.t === "merge") return writeMerge(backing, action);
  if (action.t === "unmerge") return writeUnmerge(backing, action);
  if (action.t === "freeze") return writeFreeze(backing, action);
  if (action.t === "set" && ((action.rows ?? []).length > 0 || (action.cols ?? []).length > 0)) {
    return writeSetWithStructure(backing, action, options);
  }
  return writeSet(backing, action, options);
}

function fitOne(backing, action, { formulas = null } = {}) {
  if (backing.sheetId !== null && action.sheet !== backing.sheetId) {
    return { code: "bad_action", detail: `the action is for sheet ${action.sheet}, not ${backing.sheetId}` };
  }
  const want = needs(action);
  for (const id of want.rows) if (backing.rowIndex(id) < 0) return { code: "missing_row", detail: `row ${id} is not in the sheet` };
  for (const id of want.cols) if (backing.colIndex(id) < 0) return { code: "missing_col", detail: `column ${id} is not in the sheet` };
  const scratch = modelBacking(snapshot(backing.sheet), { sheetId: backing.sheetId });
  const out = writeAction(scratch, action, { derive: trial, formulas });
  return out.out === "applied" ? true : { code: out.code, detail: out.detail };
}

export function fits(backing, action, { formulas = null } = {}) {
  validate(action);
  if (action.t === "batch") {
    const scratch = modelBacking(snapshot(backing.sheet), { sheetId: backing.sheetId });
    const out = applyUnchecked(scratch, action, { derive: trial, formulas });
    return out.out === "applied" ? true : { code: out.code, detail: out.detail };
  }
  return fitOne(backing, action, { formulas });
}

export function apply(backing, action, options = {}) {
  let fitted;
  try {
    fitted = fits(backing, action, { formulas: options.formulas ?? null });
  } catch (err) {
    if (err instanceof GridRefused) return refusal(err.code, err.detail);
    throw err;
  }
  if (fitted !== true) return refusal(fitted.code, fitted.detail);
  return applyUnchecked(backing, action, options);
}

// The inverses of a batch's actions, last first. An inverse that is itself a batch is spliced in, so
// undoing an undo never builds a batch inside a batch, which validate refuses.
const flatInverse = (done) => done.slice().reverse().flatMap((inverse) => (inverse.t === "batch" ? inverse.actions : [inverse]));

// The same write without the fits step, for the tests that must reach the batch rollback.
export function applyUnchecked(backing, action, { derive, formulas = null } = {}) {
  validate(action);
  if (action.t === "batch") {
    const done = [];
    const rows = [];
    const cols = [];
    const cells = [];
    const table = [];
    for (const one of action.actions) {
      const out = apply(backing, one, { derive, formulas });
      if (out.out !== "applied") {
        for (let i = done.length - 1; i >= 0; i--) apply(backing, done[i], { derive, formulas });
        return refusal(out.code, out.detail);
      }
      done.push(out.inverse);
      for (const change of out.changes.rows ?? []) rows.push(change);
      for (const change of out.changes.cols ?? []) cols.push(change);
      for (const change of out.changes.cells) cells.push(change);
      for (const change of out.changes.table ?? []) table.push(change);
    }
    return { out: "applied", inverse: { v: 1, t: "batch", actions: flatInverse(done) }, changes: { rows, cols, cells, table } };
  }
  const out = writeAction(backing, action, { derive, formulas });
  if (out.out !== "applied") return out;
  // A host with no formatter marks the table stale, as patchGrid does. Law C10 holds with `derive`.
  // With `derivePlain`, undo restores every value, format and style, but a formatted cell's text is
  // written plain until a tab re-derives it.
  if (derive && derive.plain === true) backing.setStale(true);
  // With no formula engine (all of M4) a new formula has no result yet: the table says so, so a host
  // or a later engine knows to compute it.
  if (out.wroteFormula === true) backing.setStale(true);
  if (action.t === "set" && action.cells.some((entry) => isFormula(entry[2]))) backing.setStale(true);
  return { out: "applied", inverse: out.inverse, changes: out.changes };
}
