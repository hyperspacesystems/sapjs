// The Grid: one live <table grid> as a sheet a page reads and writes. It owns the table's DOM
// backing, the list of the table's issues, the revision and the change listeners, and it is the
// one object for its table: a second call for the same table returns the first Grid, with the
// first call's options, until `dispose()`.
//
// Loading reads the table and writes nothing. Reads come from the backing's mirror and name cells
// in A1 form: rows count every row, frozen and hidden ones included, and columns count every
// column. An area's corners may come in either order, as the builders take them. A reference the
// A1 reader refuses throws GridRefused, as a command that cannot run does. `rescan()` reads the
// whole table again, and the table wins.
//
// The issues are the sheet check's, then one `hidden_text` entry for each hidden cell that holds
// more than white space in the live table. The tree reader reads such a cell as empty, so only the
// table shows it, and the declared repair takes the entry as it is to show the text again.
//
// Every command parses, calls a builder, leaves out what would change nothing and hands the
// action to `dispatch`, which is `apply` until a room puts its own there. A command refuses on a
// page that may not write and on a sheet with issues. `apply` reads the rows the action touches
// first, so a write from outside the grid is taken, with its own event, before the reducer runs.

import { parseRef } from "./a1.js";
import { domBacking } from "./backing-dom.js";
import {
  buildClear,
  buildDeleteCols,
  buildDeleteRows,
  buildFormat,
  buildFreeze,
  buildImport,
  buildInsertCols,
  buildInsertRows,
  buildMerge,
  buildMoveCols,
  buildMoveRows,
  buildSetColWidth,
  buildSetRange,
  buildSetRowHeight,
  buildUnmerge,
  spanOf,
} from "./build.js";
import { checkSheet } from "./check.js";
import { QueryRefused } from "./codec/read.js";
import { cellValue, shown, typed } from "./codec/value.js";
import { adoptFmt, contentOf, derive, effectiveFmt, waitsForFormatter } from "./content.js";
import { DelimitedError, detectDelimiter, parseDelimited, protectField, writeDelimited } from "./csv.js";
import { serial } from "./dates.js";
import { fmtKind } from "./format.js";
import { editText, parseInput } from "./input.js";
import { localEdit, neutralInput } from "./locale-text.js";
import { localeOf } from "./locales.js";
import { normalizeSheet } from "./normalize.js";
import { createEngine } from "./formula/engine.js";
import { apply as applyAction, GridRefused } from "./ops.js";
import { applyWorkbook } from "./workbook.js";
import { domWorkbook } from "./workbook-dom.js";

const grids = new WeakMap();

// Each Grid's DOM backing, for the workbook `createSheets` builds over the Grids of a page.
const owned = new WeakMap();
const engines = new WeakMap();

const isCell = (node) => node.localName === "td" || node.localName === "th";

// The text as the tree reader keeps it: CR LF and a lone CR become LF, and NUL goes.
const cleanText = (text) => text.replace(/\r\n?/g, "\n").replace(/\0/g, "");

function localToday() {
  const now = new Date();
  return serial(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

// A fresh record id: the prefix and eight random letters or digits.
export function newId(prefix) {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  return prefix + Array.from(bytes, (byte) => (byte % 36).toString(36)).join("");
}

function refusing(read) {
  return (...args) => {
    try {
      return read(...args);
    } catch (error) {
      if (error instanceof QueryRefused) throw new GridRefused(error.code, error.message);
      if (error instanceof DelimitedError) throw Object.assign(new GridRefused(error.code.replaceAll("-", "_"), error.message), { line: error.line });
      throw error;
    }
  };
}

// The tab a table belongs to, found as the host's reader finds it: the section[item] that holds
// the table as a child, and that section's h2[bind="name"] child.
const tabOf = (table) => (table.parentElement !== null && table.parentElement.matches("section[item]") ? table.parentElement : null);

function nameOf(section) {
  for (let node = section?.firstElementChild ?? null; node !== null; node = node.nextElementSibling) {
    if (node.matches('h2[bind="name"]')) return node.textContent;
  }
  return "";
}

const columnOf = (td) => {
  let c = 0;
  for (let node = td.previousElementSibling; node !== null; node = node.previousElementSibling) if (isCell(node)) c += 1;
  return c;
};

const ownRow = (table, tr) => tr.localName === "tr" && (tr.parentNode === table || tr.parentNode.parentNode === table);

// Each hidden cell of this table that holds more than white space, in row then column order, with
// its text.
function hiddenText(table, backing) {
  const found = [];
  for (const td of table.querySelectorAll("td[hidden], th[hidden]")) {
    const text = cleanText(td.textContent);
    if (text.trim() === "" || !ownRow(table, td.parentNode)) continue;
    found.push({ code: "hidden_text", row: backing.rowIndexOf(td.parentNode), col: columnOf(td), text });
  }
  return found.sort((a, b) => a.row - b.row || a.col - b.col);
}

const noRecords = () => ({ added: [], removed: [], changed: [] });

const CELL_FIELDS = ["text", "n", "t", "f", "v", "fmt", "colspan", "rowspan", "hidden", "style"];
const FORMAT_FIELDS = ["fmt", "colspan", "rowspan", "hidden", "style"];
const COL_FIELDS = ["id", "pos", "fmt", "width"];
const ROW_FIELDS = ["id", "pos", "style"];

const sameFields = (a, b, fields) => fields.every((key) => (a ? a[key] : undefined) === (b ? b[key] : undefined));

// Each record's place and fields, by id, to tell a row or column change that changed nothing.
const placesOf = (list, fields) => new Map(list.map((one, i) => [one.id, [i, ...fields.map((key) => one[key] ?? "")].join("\u0000")]));

// Whether an action changes row or column records in place: a height, a style, a width, a format
// or a move, any of which may ask for what the record already has.
const rekeys = (action, t) => (action?.t === "batch" ? Array.isArray(action.actions) && action.actions.some((one) => rekeys(one, t)) : action?.t === t);

// Text as the cell editor takes it: CR LF and a lone CR become LF, NUL goes and a lone surrogate
// becomes U+FFFD.
const plain = (text) => parseInput(text, { fmt: "@" }).content ?? "";

// A field without the apostrophe an export with `protect` put before its text: one that
// protectField would put there. Any other apostrophe is part of the text.
const unprotected = (field) => (field.startsWith("'") && protectField(field.slice(1)) === field ? field.slice(1) : field);

// An item of a block that is not typed text, with its text and its formula made plain.
function cleaned(item) {
  if (item === null || typeof item !== "object") return item;
  if (typeof item.f === "string") return { ...item, f: plain(item.f) };
  const { content } = item;
  if (typeof content === "string") return { ...item, content: plain(content) };
  if (content !== null && typeof content === "object" && typeof content.f === "string") return { ...item, content: { ...content, f: plain(content.f) } };
  return item;
}

const blank = (cell) => cell.text === "" && cell.f === undefined && FORMAT_FIELDS.every((key) => cell[key] === undefined);

// Whether new content is what the cell holds. A formula is the same when its text is, unless the
// new content brings a result of its own.
function sameContent(next, held) {
  if (next !== null && typeof next === "object") return held !== null && typeof held === "object" && next.f === held.f && next.r === undefined;
  return next === held;
}

// The record lists of a change event, by id, from the reducer's row or column changes.
function recordsOf(changes, key) {
  const lists = { added: new Set(), removed: new Set(), changed: new Set() };
  const list = { insert: lists.added, delete: lists.removed };
  for (const change of changes ?? []) (list[change.kind] ?? lists.changed).add(change[key]);
  return { added: [...lists.added], removed: [...lists.removed], changed: [...lists.changed] };
}

// The row and column changes that move a record to another number: what an A1 reference names
// is no longer what it named. A new height, width, style or format moves nothing.
const RESHAPING = new Set(["insert", "delete", "move"]);

// Whether an action merges or unmerges cells, which moves what covers what.
const remerges = (action) => (action.t === "batch" ? action.actions.some(remerges) : action.t === "merge" || action.t === "unmerge");

// Whether a cell's `v` gives the text it shows under this format.
function explains(cell, fmt) {
  const value = typed(cell.v, cell.t === true);
  return (cell.f === undefined ? derive(value, fmt) : derive({ f: cell.f }, fmt, value))?.text === cell.text;
}

// The cell in normal form under this format: its derived parts made again from its content, or a
// formula's from its stored result, with its own format fields kept.
function normal(cell, fmt) {
  const result = cell.f !== undefined ? typed(cell.v ?? cell.text, cell.t === true) : undefined;
  const next = { ...(derive(contentOf(cell), fmt, result) ?? { text: "" }) };
  for (const key of ["fmt", "colspan", "rowspan", "style"]) if (cell[key] !== undefined) next[key] = cell[key];
  return blank(next) ? null : next;
}

// The cell a write from outside the grid leaves, with its derived parts put right. The text wins:
// when the write changed the text, a `v` that does not give that text under the cell's format goes,
// so text typed over a number is read as typed, while an undo of a format change, which puts the
// old text and format back beside the same `v`, keeps the number. That holds for a `v` the write
// changed too: other text beside another `v` that does not give it is read as the text.
// A format no formatter knows, built in or added, cannot be checked: there the cell keeps its text
// as written while a `v` holds its number, and a `v` left as it was beside new text under the same
// format, the cell's own or the column it was under (`beforeColumn`), goes.
function settled(before, after, column, beforeColumn = column) {
  if (after === null || after.hidden === true) return after;
  const cell = { ...after };
  const fmt = effectiveFmt(cell, column);
  const known = fmtKind(fmt) !== "unknown";
  if (cell.v !== undefined && cell.text !== (before?.text ?? "") && (known ? !explains(cell, fmt) : cell.v === before?.v && fmt === effectiveFmt(before, beforeColumn))) delete cell.v;
  if (!known && cell.v !== undefined) return cell;
  return normal(cell, fmt);
}

// The Grid of a <table grid>. Options: `write(fn)` runs fn as a write that is not an edit (the
// plugin kit's `write`); `mayWrite(table)` says whether the page may write (the kit's
// `mayWrite`); `schedule(table)` asks for a pass after a write; `newId(prefix)` mints record
// ids; `today()` gives today's serial day, for typed dates and the editor text of a date;
// `engine` is the formula engine `createSheets` shares among a page's Grids. Loading writes
// nothing, except the stale refresh on a table marked stale.
//
// With an engine, every action goes through `applyWorkbook`, so a row insert rewrites the formulas
// of every tab and the engine computes what depends on it. The change event's `inverse` is then a
// workbook step `{ action, restore }`, which `apply` takes back. Another tab's Grid hears what the
// step changed on its tab as a change with source "workbook", and every tab hears the results the
// engine wrote there as a change with source "derived" that names them in `results`.
export function createGrid(table, { write = (fn) => fn(), mayWrite = () => true, schedule = () => {}, newId: mint = newId, today = localToday, engine = null, locale: localeTag = null } = {}) {
  // The locale a person types and edits in ("de", "fr", ...); the table keeps the neutral form.
  const locale = localeOf(localeTag);
  if (table?.localName !== "table" || !table.hasAttribute("grid")) throw new TypeError("createGrid takes a <table grid> element");
  const known = grids.get(table);
  // A Grid made before its page's engine existed (a mount pass ran first) gives way to the
  // engine's Grid; asking with no engine gets whichever Grid the table has.
  if (known !== undefined && (engine === null || engines.get(known) === engine)) return known;
  known?.dispose();

  const section = tabOf(table);
  const id = section === null ? "" : section.getAttribute("data-id") ?? "";
  const backing = domBacking(table, { write, sheetId: id });
  const listeners = new Set();
  let revision = 0;
  let issues;

  const check = () => {
    issues = Object.freeze([...checkSheet(backing.sheet), ...hiddenText(table, backing)].map(Object.freeze));
  };
  check();

  // The changes of a workbook step that fall on this tab, in the reducer's shape.
  const ownChanges = (changed) => {
    const mine = (list) => (list ?? []).filter((change) => change.sheet === id);
    return { cells: mine(changed.cells), rows: mine(changed.rows), cols: mine(changed.cols), table: mine(changed.table) };
  };

  function emit(event) {
    const told = { sheet: id, ...event, revision };
    for (const listener of Array.from(listeners)) listener(told);
    return told;
  }

  // A change the grid did not make: the revision goes up and one event with source "dom" fires,
  // then the engine computes what the change touched.
  function fromDom(event) {
    revision += 1;
    const told = emit({ source: "dom", ...event });
    recompute(event.rescanned ? null : event.cells);
    return told;
  }

  // The engine computes after a write from outside the grid: these cells of this tab, or with
  // null the whole tab read again. Every tab hears the results as a "derived" change.
  function recompute(cells) {
    if (engine === null) return;
    const whole = cells === null;
    const changed = { sheets: whole ? [id] : [], structure: whole, cells: whole ? [] : cells.filter((cell) => cell.col !== null).map(({ row, col }) => ({ sheet: id, row, col })), rows: [], cols: [], table: [], formulas: [] };
    const results = engine.update(changed, { fromStep: false });
    if (results.length > 0) engine.announce({ sheets: [], cells: [], rows: [], cols: [], results }, id);
  }

  // A whole read that found the table changed: one change event with source "dom", which names
  // no cell because any of them may have changed, then the stale refresh.
  function whole() {
    const event = fromDom({ rescanned: true, structure: true, cells: [], rows: noRecords(), cols: noRecords() });
    refresh();
    return event;
  }

  // The stale refresh, on a table marked stale whose sheet has no issues: at load, after each
  // whole read and after a repair. Each value cell under a format a formatter knows is written
  // again from its value and its format, as writes that are not edits. A formula cell is left as
  // it is: no engine has calculated it again, so its stored result may be out of date. A cell
  // under a format no formatter knows keeps its text. The mark goes only when nothing is left
  // waiting: no formula cell, and no number under a format no formatter knows that shows its plain
  // value. One change event with source "derived" when a cell changed; it leaves the revision, so
  // opening a file never causes a save by itself. Returns that event, or null.
  function refresh() {
    if (backing.sheet.stale !== true || issues.length > 0) return null;
    const cols = backing.cols();
    const changes = [];
    let waiting = false;
    backing.rows().forEach((row, r) => {
      cols.forEach((column, c) => {
        const cell = backing.cell(r, c);
        if (cell === null || cell.hidden === true) return;
        if (cell.f !== undefined) {
          if (engine === null) waiting = true;
          return;
        }
        const look = effectiveFmt(cell, column);
        if (fmtKind(look) === "unknown") {
          if (waitsForFormatter(cell, look)) waiting = true;
          return;
        }
        const next = normal(cell, look);
        if (!sameFields(cell, next, CELL_FIELDS)) changes.push({ r, c, row, column, cell, next });
      });
    });
    if (changes.length > 0) write(() => changes.forEach(({ r, c, next }) => backing.putCell(r, c, next)));
    if (!waiting) backing.setStale(false);
    if (changes.length === 0) return null;
    const cells = changes.map(({ row, column, cell, next }) => ({ row: row.id, col: column.id, before: contentOf(cell), after: contentOf(next) }));
    return emit({ source: "derived", structure: false, cells, rows: noRecords(), cols: noRecords() });
  }

  // The saved cell at these indexes, or null past the sheet's last row or column.
  const cellAt = (r, c) => (r < backing.rows().length && c < backing.cols().length ? backing.cell(r, c) : null);

  // The cell at a reference as a page reads it. A covered cell, a position under a merge, holds
  // nothing of its own: whatever the table keeps on it, it reads as an empty cell of its column.
  function locate(ref) {
    const { row, col } = parseRef(ref);
    const found = cellAt(row, col);
    const covered = found?.hidden === true;
    return { own: covered ? null : found, column: backing.cols()[col], covered };
  }

  // The first and last row and column of an area, clipped to the sheet.
  function bounds(ref) {
    const { r0, c0, r1, c1 } = spanOf(ref);
    return { top: r0 ?? 0, left: c0 ?? 0, bottom: Math.min(r1 ?? Infinity, backing.rows().length - 1), right: Math.min(c1 ?? Infinity, backing.cols().length - 1) };
  }

  // The rows of an area clipped to the sheet, each a list of what `read` gives for its cells.
  function eachRow({ top, left, bottom, right }, read) {
    const lines = [];
    for (let r = top; r <= bottom; r++) {
      const line = [];
      for (let c = left; c <= right; c++) line.push(read(backing.cell(r, c)));
      lines.push(line);
    }
    return lines;
  }

  // One cell's value, or the rows of values of an area clipped to the sheet, as the codec's
  // readRange gives them.
  function get(ref) {
    if (typeof ref === "string" && !ref.includes(":")) return cellValue(locate(ref).own);
    return eachRow(bounds(ref), cellValue);
  }

  // An area as delimited text, the whole sheet when no area is given: CR LF line ends, every row
  // and column the area holds, and a covered cell empty. `values` is "shown" (the text a cell
  // shows) or "raw" (its value as the file writes it: a number in plain decimal, a date as its day
  // number). With `protect`, a text value that starts like a formula gets an apostrophe, which an
  // import reads back as "this is text".
  function toDelimited(area, { delimiter = ",", values = "shown", protect = false } = {}) {
    if (values !== "shown" && values !== "raw") throw new GridRefused("bad_action", `values is "shown" or "raw", not ${values}`);
    const box = area === undefined ? { top: 0, left: 0, bottom: backing.rows().length - 1, right: backing.cols().length - 1 } : bounds(area);
    if (box.bottom < box.top || box.right < box.left) return "";
    // In a decimal-comma locale the file is ";"-delimited and numbers and dates are written as the
    // locale types them, so an export imports back unchanged under the same locale.
    const local = locale.point === "," && delimiter === ",";
    const field = (one) => {
      const value = cellValue(one);
      let text = values === "raw" ? shown(value) : one?.text ?? "";
      if (local && typeof value === "number") text = values === "raw" ? text.replace(".", locale.point) : localEdit(editText(value, one?.fmt ?? null, today()), value, locale);
      else if (local && typeof value === "string") text = localEdit(text, value, locale);
      return protect && typeof value === "string" ? protectField(text) : text;
    };
    return writeDelimited(eachRow(box, field), { delimiter: local ? ";" : delimiter });
  }

  function cell(ref) {
    const { own, column, covered } = locate(ref);
    const merged = own?.colspan !== undefined || own?.rowspan !== undefined;
    return {
      content: contentOf(own),
      value: cellValue(own),
      text: own?.text ?? "",
      fmt: own?.fmt ?? null,
      effectiveFmt: effectiveFmt(own, column),
      style: own?.style ?? null,
      span: merged ? { rows: own.rowspan ?? 1, cols: own.colspan ?? 1 } : null,
      covered,
    };
  }

  // The text the cell editor shows for the cell.
  function input(ref) {
    const { own, column } = locate(ref);
    return editorText(own, effectiveFmt(own, column));
  }

  // The editor text of a cell under its format, in the grid's locale; text in a text "@" cell is
  // shown as it is.
  function editorText(own, fmt) {
    const content = contentOf(own);
    const text = editText(content, fmt, today());
    return fmtKind(fmt) === "text" && typeof content === "string" ? text : localEdit(text, content, locale);
  }

  function on(type, listener) {
    if (type !== "change" || typeof listener !== "function") throw new TypeError('grid.on takes "change" and a function');
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  // After the table was read again in whole, from the mirror `old` held before: each cell of a row
  // and a column `old` held that differs from what `old` held, and each such cell with no format
  // of its own in a column whose format changed, gets its derived parts put right as `intake`
  // puts them, matched by row and column id. A page undo of a column format puts the column's old
  // format back and leaves the cells as the format change drew them, so they are drawn again.
  function retake(old) {
    const rowAt = new Map(old.rows.map((row, r) => [row.id, r]));
    const colAt = new Map(old.cols.map((col, c) => [col.id, c]));
    const cols = backing.cols();
    backing.rows().forEach((row, r) => {
      const o = rowAt.get(row.id);
      cols.forEach((column, c) => {
        const oc = colAt.get(column.id);
        if (o === undefined || oc === undefined) return;
        const before = old.rows[o].cells[oc] ?? null;
        const after = backing.cell(r, c);
        const redrawn = old.cols[oc].fmt !== column.fmt && after?.fmt === undefined;
        if (!redrawn && sameFields(before, after, CELL_FIELDS)) return;
        const next = settled(before, after, column, old.cols[oc]);
        if (!sameFields(after, next, CELL_FIELDS)) write(() => backing.putCell(r, c, next));
      });
    });
  }

  // Reads the whole table again; the table wins and the issues are found again. A table that
  // differed is a change from outside the grid: one change event with source "dom" names no cell,
  // because any of them may have changed. Returns that event, or null.
  function reread() {
    const old = backing.sheet;
    const differed = backing.rescan();
    if (differed) retake(old);
    check();
    return differed ? whole() : null;
  }

  // Returns whether the table differed.
  const rescan = () => reread() !== null;

  // Takes into the mirror what a write from outside the grid changed in the rows at these indexes,
  // puts each changed cell's derived parts right as a write that is not an edit, and tells the
  // listeners once. Returns the event, or null when the rows are as the mirror has them.
  function intake(indexes) {
    const old = backing.sheet;
    const found = backing.read(indexes);
    if (found === null) {
      if (indexes.some(hidesText) || issues.some((issue) => issue.code === "hidden_text" && indexes.includes(issue.row))) check();
      return null;
    }
    if (found.rescanned) {
      retake(old);
      check();
      return whole();
    }
    const cols = backing.cols();
    const cells = found.cells.map(({ row, col, before, after }) => {
      const c = col === null ? -1 : backing.colIndex(col);
      const next = c < 0 ? after : settled(before, after, cols[c]);
      if (c >= 0 && !sameFields(after, next, CELL_FIELDS)) write(() => backing.putCell(backing.rowIndex(row), c, next));
      return { row, col, before: contentOf(before), after: contentOf(next) };
    });
    check();
    return fromDom({ structure: false, cells, rows: { ...noRecords(), changed: found.rows.map((change) => change.row) }, cols: noRecords() });
  }

  // Whether the row at this index has a cell hidden under a merge that holds text. The mirror keeps
  // no text for such a cell, so a write that put text there changes nothing it holds, yet the
  // sheet then needs repair.
  const hidesText = (r) => Array.from(backing.rowAt(r)?.cells ?? []).some((td) => td.hidden && cleanText(td.textContent).trim() !== "");

  // The rows of the table these nodes are in, read as a write from outside the grid made them. A
  // node in no row of this table, such as the table itself or a col, reads the whole table. The
  // table's own thead or tbody adds no row: a row taken out of a group or moved across groups is
  // found by the read, which compares the row list. Returns the change event, or null when
  // nothing changed.
  function foreignWrite(nodes) {
    const rows = new Set();
    for (const node of nodes) {
      if (node.parentNode === table && (node.localName === "tbody" || node.localName === "thead")) continue;
      const r = node === table ? -1 : backing.rowIndexOf(node);
      if (r < 0) return reread();
      rows.add(r);
    }
    return intake([...rows].sort((a, b) => a - b));
  }

  function sound() {
    if (issues.length > 0) throw new GridRefused("needs_repair", `the sheet has ${issues.length} issue(s) to repair first, such as ${issues[0].code}`);
  }

  // The rows a command has read from the table while it runs, or true when it read the whole
  // table. `apply` reads only the rows not among them, because nothing else runs in between.
  let fresh = null;

  // Before a command reads the mirror: refused on a page that may not write, then a write from
  // outside the grid is taken in, so the command's references and its no-change checks see the
  // table as it is (the table's rows and columns, then the rows `rowsOf()` names), then refused
  // on a sheet with issues.
  function ready(rowsOf = () => []) {
    if (!mayWrite(table)) throw new GridRefused("read_only", "this page may not write");
    const rows = rowsOf();
    const event = intake(rows);
    sound();
    fresh = event?.rescanned ? true : new Set(rows);
  }

  // A command body that forgets the rows it read when it ends.
  const run = (body) =>
    refusing((...args) => {
      try {
        return body(...args);
      } finally {
        fresh = null;
      }
    });

  // The indexes of the sheet's rows from `top` to `bottom`, clipped to the sheet.
  function between(top, bottom) {
    const rows = [];
    for (let r = top; r <= Math.min(bottom, backing.rows().length - 1); r++) rows.push(r);
    return rows;
  }

  const rowsIn = (area) => {
    const { top, bottom } = bounds(area);
    return between(top, bottom);
  };

  const rowsFrom = (at, block) => {
    const { row } = parseRef(at);
    return between(row, row + (Array.isArray(block) ? block.length : 1) - 1);
  };

  // The action without what would change nothing. A set entry whose content the cell already
  // holds is left out, or becomes a format entry when it also brings a format or a style, so a
  // formula keeps its result and a cell its shown text. A set that adds rows or columns and whose
  // entries change no content is kept whole, so the sheet grows and its new cells take their
  // formats. Returns null when nothing is left.
  function trimmed(action) {
    if (action === null || action.t !== "set") return action;
    const cells = [];
    const formats = [];
    for (const entry of action.cells) {
      const r = backing.rowIndex(entry[0]);
      const c = backing.colIndex(entry[1]);
      const held = r < 0 || c < 0 ? null : contentOf(backing.cell(r, c));
      if (!sameContent(entry[2], held)) cells.push(entry);
      else if (entry[3] !== undefined) formats.push([entry[0], entry[1], entry[3]]);
    }
    if (cells.length === 0 && (action.rows !== undefined || action.cols !== undefined)) return action;
    const set = cells.length === 0 ? null : { ...action, cells };
    const format = formats.length === 0 ? null : { v: 1, t: "format", sheet: action.sheet, cells: formats };
    if (set === null) return format;
    return format === null ? set : { v: 1, t: "batch", actions: [set, format] };
  }

  function send(action) {
    const next = trimmed(action);
    return next === null ? null : grid.dispatch(next);
  }

  // The cells a set or format action names, by row and column id. An action of any shape gets an
  // answer, because the reducer checks it after this.
  function named(action) {
    if (action?.t === "batch") return Array.isArray(action.actions) ? action.actions.flatMap(named) : [];
    return (action?.t === "set" || action?.t === "format") && Array.isArray(action.cells) ? action.cells.filter(Array.isArray) : [];
  }

  // The reducer over this table. The rows the action touches are read first, so a write from
  // outside the grid is taken with its own event and the inverse puts back what the page held. A
  // sheet with issues refuses; a page that may only read still applies, so a room's actions reach
  // a viewer. A write that changes no content, no format field, no value and no shown text, and
  // no row, column or frozen count, fires no event and leaves the revision. The event's
  // `structure` is true when a row or column came, went or moved, when cells were merged or
  // unmerged, or when the frozen counts changed. A cell of a row or column the action took away is
  // not among the event's cells; the event names the row or column as removed. A cell the write
  // leaves showing a number's plain value under a format no formatter knows marks the table stale,
  // as a host's write marks it. Returns the change event, or null.
  function apply(step) {
    const action = engine !== null && step?.action !== undefined && step.t === undefined ? step.action : step;
    if (fresh !== true) {
      const touched = backing.touched(action);
      const rest = fresh === null ? touched : touched.filter((r) => !fresh.has(r));
      if (fresh === null || rest.length > 0) intake(rest);
    }
    sound();
    const held = new Map();
    for (const [row, col] of named(action)) {
      const r = backing.rowIndex(row);
      const c = backing.colIndex(col);
      held.set(`${row}\u0000${col}`, r < 0 || c < 0 ? null : backing.cell(r, c));
    }
    const rowsBefore = rekeys(action, "changeRows") ? placesOf(backing.rows(), ROW_FIELDS) : null;
    const colsBefore = rekeys(action, "changeCols") ? placesOf(backing.cols(), COL_FIELDS) : null;
    const out = engine === null ? applyAction(backing, action, { derive }) : applyWorkbook(engine.workbook, step, { derive, engine });
    if (out.out !== "applied") throw new GridRefused(out.code, out.detail);
    const changes = engine === null ? out.changes : ownChanges(out.changed);
    const touched = new Map();
    for (const change of changes.cells) {
      const key = `${change.row}\u0000${change.col}`;
      const first = touched.get(key);
      touched.set(key, { row: change.row, col: change.col, before: first === undefined ? change.before : first.before, after: change.after });
    }
    const cells = [];
    for (const [key, change] of touched) {
      const r = backing.rowIndex(change.row);
      const c = backing.colIndex(change.col);
      if (r < 0 || c < 0) continue;
      const now = backing.cell(r, c);
      const was = held.get(key);
      const same = sameContent(change.after, contentOf(was)) && sameFields(was, now, FORMAT_FIELDS) && cellValue(was) === cellValue(now) && (was?.text ?? "") === (now?.text ?? "");
      if (held.has(key) && same) continue;
      cells.push(change);
    }
    const real = (changes, key, before, list, fields) => {
      if (before === null) return changes ?? [];
      const after = placesOf(list, fields);
      return (changes ?? []).filter((change) => change.kind === "insert" || change.kind === "delete" || before.get(change[key]) !== after.get(change[key]));
    };
    const rowChanges = real(changes.rows, "row", rowsBefore, backing.rows(), ROW_FIELDS);
    const colChanges = real(changes.cols, "col", colsBefore, backing.cols(), COL_FIELDS);
    const rows = recordsOf(rowChanges, "row");
    const cols = recordsOf(colChanges, "col");
    const parts = (changes.table ?? []).filter((part) => part.before !== part.after);
    const heard = () => {
      if (engine !== null) engine.announce(out.changed, id);
    };
    const tabsChanged = engine !== null && out.changed.sheets.length > 0;
    if (!tabsChanged && cells.length === 0 && [rows, cols].every((list) => list.added.length + list.removed.length + list.changed.length === 0) && parts.length === 0) {
      heard();
      return null;
    }
    const reshaped = [...rowChanges, ...colChanges].some((change) => RESHAPING.has(change.kind));
    check();
    revision += 1;
    const event = emit({ source: "api", action, inverse: out.inverse, cells, rows, cols, structure: reshaped || remerges(action) || parts.length > 0 || tabsChanged });
    schedule(table);
    heard();
    return event;
  }

  // The value an item of a block puts in a cell: typed text is parsed as the cell editor parses
  // it, under the format of the cell it lands on, and brings a format the cell takes or not. The
  // cell's own editor text is its own content, so Enter on a cell changes nothing. Every text an
  // item brings is made plain first, typed or not. With `data`, typed text is plain data: it is
  // parsed as if the cell had no format, unless the cell's format is text "@", where it loses the
  // apostrophe our export with `protect` writes before text.
  function itemAt(item, r, c, { detect, formats, data, formulas }) {
    if (typeof item !== "string") return cleaned(item);
    if (!detect) return plain(item);
    const rows = backing.rows();
    const cols = backing.cols();
    const column = cols[c];
    const held = r < rows.length && c < cols.length ? backing.cell(r, c) : null;
    const effective = effectiveFmt(held, column);
    const own = held?.hidden === true ? null : held;
    if (item === editorText(own, effective) && (formulas || own?.f === undefined)) return contentOf(own);
    // A local number, date or formula reads as its neutral form. Text in a text "@" cell, and text
    // that only looks like a formula where formulas are kept as text, is never translated.
    const asText = fmtKind(effective) === "text" || (!formulas && String(item)[0] === "=");
    const local = asText ? item : neutralInput(item, locale);
    if (local === null) throw new GridRefused("bad_formula", 'write the formula as this locale does: ";" between arguments and "," before decimals');
    const text = data && fmtKind(effective) === "text" ? unprotected(item) : local;
    let parsed = parseInput(text, { fmt: data && fmtKind(effective) !== "text" ? null : effective, today: today() });
    // A rewrite the neutral form does not read as a number or date stores what was typed, as text.
    if (local !== item && text === local && typeof parsed.content === "string") parsed = { content: String(item) };
    const fmt = formats ? adoptFmt(effective, column?.fmt ?? null, parsed.fmt) : undefined;
    return fmt === undefined ? parsed.content : { content: parsed.content, fmt };
  }

  // A block of items from a cell on, as one action. An item is typed text, a value (a number,
  // true, false or null) or { content, fmt?, style? }. Options: `detect` (typed text is parsed;
  // false keeps it as text), `formats` (a typed look becomes the cell's format), `formulas`
  // (false keeps a formula as its text), `grow` (a block past the sheet adds rows and columns).
  function setRange(at, block, { detect = true, formats = true, formulas = true, grow = false } = {}) {
    ready(() => rowsFrom(at, block));
    return send(buildSetRange(backing, at, itemsAt(at, block, () => detect, formats, { formulas }), { grow, formulas, newId: mint }));
  }

  // A block's items as the cells they land on read them, from a cell on: `detect(j)` says whether
  // the j-th item of each line is typed text to parse, and `data` that typed text is plain data.
  function itemsAt(at, block, detect, formats, { data = false, formulas = true } = {}) {
    if (!Array.isArray(block)) return block;
    const { row, col } = parseRef(at);
    return block.map((line, i) => (Array.isArray(line) ? line.map((item, j) => itemAt(item, row + i, col + j, { detect: detect(j), formats, data, formulas })) : line));
  }

  // Delimited text written from a cell on as one action, the way a paste writes a block: the
  // sheet grows to hold it, a field is typed input unless its column's type is "text", and a
  // field that starts with "=" is text unless `formulas` is true. A typed field is plain data: it
  // is parsed as if its cell had no format, so 5 is five in a percent cell, unless the cell's
  // format is text "@". `types` lists "auto" or "text" for the columns of the text, first column
  // first; a column it leaves out is "auto". A "text" field is kept as it is, with its line breaks
  // made plain and without the apostrophe our export with `protect` writes before text, so export
  // then import gives the same text.
  function importDelimited(text, at, { delimiter, types = [], formulas = false } = {}) {
    const asText = (j) => types[j] === "text";
    let block;
    ready(() => {
      if (!Array.isArray(types) || types.some((type) => type !== undefined && type !== "auto" && type !== "text")) {
        throw new GridRefused("bad_action", 'types lists "auto" or "text" for each column');
      }
      block = parseDelimited(text, { delimiter: delimiter ?? (locale.point === "," ? detectDelimiter(text, { decimalComma: true }) : undefined) });
      return rowsFrom(at, block);
    });
    const fields = block.map((line) => line.map((field, j) => (asText(j) ? unprotected(field) : field)));
    return send(buildImport(backing, at, itemsAt(at, fields, (j) => !asText(j), true, { data: true, formulas }), { formulas, newId: mint }));
  }

  // Typed input for one cell; a number, true, false or null is taken as a plain value.
  const set = (ref, raw, { grow = false } = {}) => setRange(ref, [[raw]], { grow });

  // A command over A1 arguments: refused on a page that may not write and on a sheet with issues,
  // then one builder call and one dispatch. A request for what the sheet already has builds no
  // action and returns null. With `area`, the rows the first argument names are read from the
  // table first.
  const command = (build, area = false) =>
    run((...args) => {
      ready(area ? () => rowsIn(args[0]) : undefined);
      return send(build(...args));
    });

  // The tab's declared step: normalizeSheet over the table as it is now, with text in hidden cells
  // shown again, put in place through the backing's own writes, then the writer's parts. A column
  // added for a row that was too long moves that row's later cells right, so every cell is then
  // put where the repaired sheet has it, and the event compares with the table as it was. One
  // change with source "repair" and no inverse, then the stale refresh, or null when there was
  // nothing to put right.
  function repair() {
    if (!mayWrite(table)) throw new GridRefused("read_only", "this page may not write");
    rescan();
    const held = backing.sheet.rows.map((row) => row.cells.map((one) => (one ? { ...one } : null)));
    const { sheet: next, repairs } = normalizeSheet(backing.sheet, { derive, hiddenText: issues.filter((issue) => issue.code === "hidden_text") });
    const cols = noRecords();
    const rows = noRecords();
    const cells = [];
    next.cols.forEach((record, c) => {
      const old = backing.cols()[c];
      if (old === undefined) {
        backing.insertCol(c, record);
        cols.added.push(record.id);
        return;
      }
      const fields = Object.fromEntries(COL_FIELDS.filter((key) => old[key] !== record[key]).map((key) => [key, record[key]]));
      if (Object.keys(fields).length === 0) return;
      backing.putCol(c, fields);
      cols.changed.push(record.id);
    });
    next.rows.forEach((record, r) => {
      const old = backing.rows()[r];
      const fields = Object.fromEntries(ROW_FIELDS.filter((key) => old[key] !== record[key]).map((key) => [key, record[key]]));
      if (Object.keys(fields).length > 0) {
        backing.putRow(r, fields);
        rows.changed.push(record.id);
      }
      const width = Math.max(record.cells.length, backing.rows()[r].cells.length);
      for (let c = 0; c < width; c++) {
        const is = record.cells[c] ?? null;
        if (!sameFields(backing.cell(r, c), is, CELL_FIELDS)) backing.putCell(r, c, is);
        const was = held[r][c] ?? null;
        if (c < next.cols.length && !sameFields(was, is, CELL_FIELDS)) cells.push({ row: record.id, col: next.cols[c].id, before: contentOf(was), after: contentOf(is) });
      }
    });
    const freeze = next.freezeCols ?? 0;
    if ((backing.sheet.freezeCols ?? 0) !== freeze) backing.setFrozen({ cols: freeze });
    const tidied = backing.tidy();
    check();
    if (repairs.length === 0 && !tidied && cells.length === 0 && rows.changed.length === 0 && cols.added.length + cols.changed.length === 0) return null;
    revision += 1;
    const event = emit({ source: "repair", repairs, cells, rows, cols, structure: true });
    schedule(table);
    refresh();
    recompute(null);
    return event;
  }

  // Forgets the table: the next call for it makes a new Grid, and no listener hears this one again.
  function dispose() {
    if (grids.get(table) === grid) grids.delete(table);
    listeners.clear();
    unheard();
  }

  refresh();

  // What a step another Grid or a caller made changed on this tab, and the results the engine
  // wrote here.
  const unheard =
    engine === null
      ? () => {}
      : engine.on(id, (heard) => {
          if (heard.source === "derived") {
            emit({ source: "derived", structure: false, results: heard.results.map(({ row, col }) => ({ row, col })), cells: [], rows: noRecords(), cols: noRecords() });
            return;
          }
          check();
          revision += 1;
          emit({ source: "workbook", structure: heard.structure, cells: heard.cells.map(({ row, col, before, after }) => ({ row, col, before, after })), rows: recordsOf(heard.rows, "row"), cols: recordsOf(heard.cols, "col") });
          schedule(table);
        });

  const grid = {
    get sheet() {
      return { id, name: nameOf(section) };
    },
    get size() {
      return { rows: backing.rows().length, cols: backing.cols().length };
    },
    get issues() {
      return issues;
    },
    get revision() {
      return revision;
    },
    get: refusing(get),
    cell: refusing(cell),
    input: refusing(input),
    set: run(set),
    setRange: run(setRange),
    clear: command((area) => buildClear(backing, area), true),
    format: command((area, options) => buildFormat(backing, area, options), true),
    importDelimited: run(importDelimited),
    toDelimited: refusing(toDelimited),
    insertRows: command((before, count, { like } = {}) => buildInsertRows(backing, before, count, { like, newId: mint })),
    deleteRows: command((area) => buildDeleteRows(backing, area)),
    moveRows: command((area, before) => buildMoveRows(backing, area, before)),
    setRowHeight: command((area, px) => buildSetRowHeight(backing, area, px)),
    insertCols: command((before, count, { like } = {}) => buildInsertCols(backing, before, count, { like, newId: mint })),
    deleteCols: command((area) => buildDeleteCols(backing, area)),
    moveCols: command((area, before) => buildMoveCols(backing, area, before)),
    setColWidth: command((area, px) => buildSetColWidth(backing, area, px)),
    merge: command((area) => buildMerge(backing, area), true),
    unmerge: command((ref) => buildUnmerge(backing, ref), true),
    freeze: command((counts) => buildFreeze(backing, counts)),
    apply: refusing(apply),
    dispatch: null,
    repair,
    on,
    rescan,
    foreignWrite,
    dispose,
  };
  grid.dispatch = grid.apply;
  grids.set(table, grid);
  owned.set(grid, backing);
  if (engine !== null) engines.set(grid, engine);
  return grid;
}

// Every tab of a page as one workbook with one formula engine: each `<section item>` child of
// `root` holding a `<table grid>` gets its Grid (options as `createGrid` takes them), the Grids
// share the engine, and the engine computes every formula once, as writes that are not edits.
// `quiet(fn)` (default `write`) writes the results at load that changed only through TODAY, NOW,
// RAND or RANDBETWEEN, so they do not mark the document unsaved.
// Returns `{ workbook, engine, grid(table) }`.
export function createSheets(root, options = {}) {
  let engine = null;
  const workbook = domWorkbook(root, { mount: (table) => owned.get(createGrid(table, { ...options, engine })) });
  engine = createEngine(workbook, { write: options.write, quiet: options.quiet ?? options.write, now: options.now, random: options.random });
  engine.load();
  return { workbook, engine, grid: (table) => createGrid(table, { ...options, engine }) };
}
