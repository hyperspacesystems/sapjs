// A seeded generator of actions against a backing's current state: mostly valid, some invalid.
// A valid action names real ids and makes the new ids and keys a tab makes; an invalid one names a
// missing id, writes a covered cell, uses a bad key or id, cuts or overlaps a merge, or is a bad
// JSON shape.
import { keyBetween } from "../../../src/grid/codec/order-keys.js";
import { modelBacking } from "../../../src/grid/backing-model.js";
import { derive } from "../../../src/grid/content.js";
import { apply } from "../../../src/grid/ops.js";
import { isMixedStyle } from "../../../src/grid/styles.js";

const SHEET = "sheet";

const FORMATS = [null, "#,##0", "0.00", "0%", "$#,##0.00", "m/d/yyyy", '0.0,"k"', '0.0" kg"', "0.0%;[Red]-0.0%"];

const TEXTS = ["007", "TRUE", "a<b", "hello", "  padded  ", "1,200", "=literal", "line\nbreak"];

const STYLE_VALUES = {
  "font-weight": ["bold", "normal"],
  background: ["#eeeeee", "#ff0000", "red"],
  color: ["#333333", "#ff0000", "#000000"],
  "background-color": ["#eeeeee", "#ffffff"],
  "text-align": ["left", "center", "right"],
  "border-top": ["1px solid #000000", "2px dashed #ff0000"],
  "border-right": ["1px solid #000000", "2px dashed #ff0000"],
  "border-bottom": ["1px solid #000000", "2px dashed #ff0000"],
  "border-left": ["1px solid #000000", "2px dashed #ff0000"],
};

const STYLE_PROPERTIES = Object.keys(STYLE_VALUES);

const WEIGHTS = [
  ["set", 20],
  ["setGrow", 5],
  ["format", 14],
  ["insertRows", 7],
  ["deleteRows", 7],
  ["changeRows", 8],
  ["insertCols", 7],
  ["deleteCols", 7],
  ["changeCols", 7],
  ["merge", 6],
  ["mergeFrozen", 4],
  ["sortRows", 5],
  ["sortCols", 5],
  ["insertFrozen", 4],
  ["unmerge", 5],
  ["freeze", 4],
  ["batch", 6],
];

// The shapes the app sends that a count keeps alive: one per builder below that the plan names and
// the seeded laws used to miss.
export const SHAPES = ["sortRows", "sortCols", "setGrow", "insertFrozen", "insertStyle", "mergeFrozen", "backgroundStyle", "nullStyle", "customFormat", "rowStyleTail", "mixedStyle"];

const SHAPE = new WeakMap();

export const shapeOf = (action) => SHAPE.get(action) ?? null;

const mark = (shape, action) => {
  SHAPE.set(action, shape);
  return action;
};

const pick = (rand, n) => Math.floor(rand() * n);
const chance = (rand, p) => rand() < p;
const pickOf = (rand, list) => list[pick(rand, list.length)];
const clone = (value) => JSON.parse(JSON.stringify(value));

function weighted(rand, options) {
  const total = options.reduce((sum, [, weight]) => sum + weight, 0);
  let ticket = rand() * total;
  for (const [name, weight] of options) {
    ticket -= weight;
    if (ticket < 0) return name;
  }
  return options[options.length - 1][0];
}

const usedIds = (backing) => {
  const used = new Set();
  for (const row of backing.rows()) used.add(row.id);
  for (const col of backing.cols()) used.add(col.id);
  return used;
};

function freshId(backing, taken = new Set()) {
  const used = usedIds(backing);
  for (let n = 1; ; n++) {
    const id = `g${n}`;
    if (!used.has(id) && !taken.has(id)) return id;
  }
}

// A key strictly between the records at index - 1 and index, moving past a tie when the two
// neighbors share a key (a valid tie cannot hold a key between it).
function keyAt(records, index) {
  let i = index;
  while (i > 0 && i < records.length && records[i - 1].pos >= records[i].pos) i++;
  const left = i > 0 ? records[i - 1].pos : null;
  const right = i < records.length ? records[i].pos : null;
  return { pos: keyBetween(left, right), index: i };
}

function boxesOf(backing) {
  const boxes = [];
  backing.rows().forEach((row, r) => {
    row.cells.forEach((cell, c) => {
      if (!cell) return;
      const rs = cell.rowspan ?? 1;
      const cs = cell.colspan ?? 1;
      if (rs === 1 && cs === 1) return;
      boxes.push({ row: r, col: c, bottom: r + rs - 1, right: c + cs - 1 });
    });
  });
  return boxes;
}

const intersects = (box, top, bottom, left, right) =>
  box.row <= bottom && box.bottom >= top && box.col <= right && box.right >= left;

function hiddenCell(backing) {
  const rows = backing.rows();
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].cells.length; c++) if (rows[r].cells[c]?.hidden) return { r, c };
  }
  return null;
}

function styleFor(rand) {
  const count = 1 + pick(rand, 3);
  const style = {};
  for (let i = 0; i < count; i++) {
    const property = pickOf(rand, STYLE_PROPERTIES);
    style[property] = chance(rand, 0.15) ? null : pickOf(rand, STYLE_VALUES[property]);
  }
  return style;
}

function extraFor(rand) {
  const extra = {};
  if (chance(rand, 0.65)) extra.fmt = pickOf(rand, FORMATS);
  if (chance(rand, 0.55)) extra.style = styleFor(rand);
  if (Object.keys(extra).length === 0) extra.fmt = pickOf(rand, FORMATS);
  return extra;
}

function formulaFor(rand, f) {
  if (chance(rand, 0.5)) return { f };
  return { f, r: pickOf(rand, [0, 42, -7, true, false, null]) };
}

function contentFor(rand) {
  switch (pick(rand, 10)) {
    case 0:
      return 0;
    case 1:
      return 42;
    case 2:
      return -7;
    case 3:
      return 12.5;
    case 4:
      return 0.125;
    case 5:
      return pickOf(rand, TEXTS);
    case 6:
      return chance(rand, 0.5);
    case 7:
      return null;
    case 8:
      return formulaFor(rand, "=A1+1");
    default:
      return formulaFor(rand, "=SUM(B2:B3)");
  }
}

function cellPairs(rand, backing, count) {
  const rows = backing.rows();
  const cols = backing.cols();
  const cells = [];
  const seen = new Set();
  for (let i = 0; i < count; i++) {
    const r = pick(rand, rows.length);
    const c = pick(rand, cols.length);
    const at = `${r}/${c}`;
    if (seen.has(at) || backing.cell(r, c)?.hidden) continue;
    seen.add(at);
    cells.push([rows[r].id, cols[c].id]);
  }
  return cells;
}

// The cells a merge clears, read from the backing now: pairs of ids in row order, then column order.
function clearsFor(backing, top, bottom, left, right) {
  const rows = backing.rows();
  const cols = backing.cols();
  const out = [];
  for (let r = top; r <= bottom; r++) {
    for (let c = left; c <= right; c++) {
      if (r === top && c === left) continue;
      if (r >= rows.length || c >= cols.length) continue;
      const cell = backing.cell(r, c);
      if (!cell) continue;
      if (
        cell.text === "" &&
        cell.f === undefined &&
        cell.fmt === undefined &&
        cell.style === undefined &&
        cell.colspan === undefined &&
        cell.rowspan === undefined
      ) continue;
      out.push([rows[r].id, cols[c].id]);
    }
  }
  return out;
}

// A merge whose clears no longer name the cells inside the rectangle: one missing, or one extra.
function staleClears(rand, backing, top, bottom, left, right) {
  const clears = clearsFor(backing, top, bottom, left, right);
  if (chance(rand, 0.5)) {
    if (clears.length > 0) clears.splice(pick(rand, clears.length), 1);
    return clears;
  }
  const rows = backing.rows();
  const cols = backing.cols();
  const named = new Set(clears.map(([row, col]) => `${row}/${col}`));
  for (let r = top; r <= bottom; r++) {
    for (let c = left; c <= right; c++) {
      if (r === top && c === left) continue;
      if (r >= rows.length || c >= cols.length) continue;
      if (named.has(`${rows[r].id}/${cols[c].id}`)) continue;
      return [...clears, [rows[r].id, cols[c].id]];
    }
  }
  return clears;
}

const styleMaps = (action) => {
  const out = [];
  const add = (extra) => {
    if (extra && typeof extra.style === "object" && extra.style !== null) out.push(extra.style);
  };
  if (action.t === "set" || action.t === "format") for (const entry of action.cells ?? []) add(entry[action.t === "set" ? 3 : 2]);
  if (action.t === "insertRows" || action.t === "changeRows") {
    for (const record of action.rows ?? []) {
      if (record && typeof record === "object" && typeof record.style === "object" && record.style !== null) out.push(record.style);
    }
  }
  return out;
};

function classify(action, backing) {
  if (action === null || typeof action !== "object" || SHAPE.has(action)) return action;
  const maps = styleMaps(action);
  const has = (property) => maps.some((map) => Object.prototype.hasOwnProperty.call(map, property));
  if (has("background")) return mark("backgroundStyle", action);
  if (maps.some((map) => Object.values(map).includes(null))) return mark("nullStyle", action);
  if (/0\.0|0\.[0-9]+%/.test(JSON.stringify(action))) return mark("customFormat", action);
  if ((action.rows ?? []).some((record) => typeof record?.style === "string" && /^[^;]+;.*height:/.test(record.style))) {
    return mark("rowStyleTail", action);
  }
  const entries = action.t === "set" || action.t === "format" ? action.cells ?? [] : [];
  for (const entry of entries) {
    if (!Array.isArray(entry) || !backing) continue;
    const r = backing.rowIndex(entry[0]);
    const c = backing.colIndex(entry[1]);
    const cell = r === undefined || c === undefined ? null : backing.cell(r, c);
    if (cell && isMixedStyle(cell.style)) return mark("mixedStyle", action);
  }
  return action;
}

function validSet(rand, backing) {
  const pairs = cellPairs(rand, backing, 1 + pick(rand, 3));
  if (pairs.length === 0) return validInsertRows(rand, backing);
  const cells = pairs.map(([row, col]) => {
    const entry = [row, col, contentFor(rand)];
    if (chance(rand, 0.5)) entry.push(extraFor(rand));
    return entry;
  });
  return { v: 1, t: "set", sheet: SHEET, cells };
}

// A paste that brings rows and columns, appended at the end only: mid-table growth with a formula in
// a new row has an inverse the reducer refuses while formulas is null, and is not generated.
function validSetGrow(rand, backing) {
  const rows = backing.rows();
  const cols = backing.cols();
  const taken = new Set();
  const newRows = [];
  const newCols = [];
  const rowOrder = rows.map((row) => ({ pos: row.pos }));
  const rowCount = chance(rand, 0.8) ? 1 + pick(rand, 2) : 0;
  for (let i = 0; i < rowCount; i++) {
    const at = keyAt(rowOrder, rowOrder.length);
    rowOrder.push({ pos: at.pos });
    const id = freshId(backing, taken);
    taken.add(id);
    newRows.push({ id, pos: at.pos });
  }
  const colOrder = cols.map((col) => ({ pos: col.pos }));
  const colCount = chance(rand, 0.4) ? 1 : 0;
  for (let i = 0; i < colCount; i++) {
    const at = keyAt(colOrder, colOrder.length);
    colOrder.push({ pos: at.pos });
    const id = freshId(backing, taken);
    taken.add(id);
    newCols.push({ id, pos: at.pos });
  }
  if (rows.length + newRows.length === 0 || cols.length + newCols.length === 0) return validInsertRows(rand, backing);
  const allRows = rows.map((row) => row.id).concat(newRows.map((row) => row.id));
  const allCols = cols.map((col) => col.id).concat(newCols.map((col) => col.id));
  const cells = [];
  const seen = new Set();
  const count = 1 + pick(rand, 4);
  for (let i = 0; i < count; i++) {
    const row = newRows.length > 0 && chance(rand, 0.6) ? pickOf(rand, newRows).id : pickOf(rand, allRows);
    const col = newCols.length > 0 && chance(rand, 0.3) ? pickOf(rand, newCols).id : pickOf(rand, allCols);
    const at = `${row}/${col}`;
    if (seen.has(at)) continue;
    seen.add(at);
    let content = contentFor(rand);
    if (newRows.length > 0 && newCols.length > 0 && content !== null && typeof content === "object") content = 5;
    const entry = [row, col, content];
    if (chance(rand, 0.4)) entry.push(extraFor(rand));
    cells.push(entry);
  }
  if (cells.length === 0) return validInsertRows(rand, backing);
  const out = { v: 1, t: "set", sheet: SHEET, cells };
  if (newRows.length > 0) out.rows = newRows;
  if (newCols.length > 0) out.cols = newCols;
  return mark("setGrow", out);
}

function validFormat(rand, backing) {
  const pairs = cellPairs(rand, backing, 1 + pick(rand, 3));
  if (pairs.length === 0) return validInsertRows(rand, backing);
  return { v: 1, t: "format", sheet: SHEET, cells: pairs.map(([row, col]) => [row, col, extraFor(rand)]) };
}

// The columns a merge would cover if a row landed at `at`: a cell there would be a covered write.
function grownColsAt(backing, at) {
  const covered = new Set();
  for (const box of boxesOf(backing)) {
    if (box.row < at && at <= box.bottom) for (let c = box.col; c <= box.right; c++) covered.add(c);
  }
  return covered;
}

function rowCells(rand, backing, at) {
  const cols = backing.cols();
  if (cols.length === 0) return undefined;
  const covered = grownColsAt(backing, at);
  const free = [];
  cols.forEach((col, c) => {
    if (!covered.has(c)) free.push(c);
  });
  const cells = [];
  const count = chance(rand, 0.5) ? 0 : 1 + pick(rand, 2);
  for (let i = 0; i < count && free.length > 0; i++) {
    const at2 = free.splice(pick(rand, free.length), 1)[0];
    const entry = [cols[at2].id, contentFor(rand)];
    if (chance(rand, 0.4)) entry.push(extraFor(rand));
    cells.push(entry);
  }
  return cells.length > 0 ? cells : undefined;
}

function validInsertRows(rand, backing) {
  const order = backing.rows().map((row) => ({ pos: row.pos }));
  const records = [];
  const taken = new Set();
  const count = chance(rand, 0.25) ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const at = pick(rand, order.length + 1);
    const key = keyAt(order, at);
    order.splice(key.index, 0, { pos: key.pos });
    const id = freshId(backing, taken);
    taken.add(id);
    const record = { id, pos: key.pos };
    if (chance(rand, 0.25)) record.height = 20 + pick(rand, 40);
    const cells = rowCells(rand, backing, key.index);
    if (cells !== undefined) record.cells = cells;
    records.push(record);
  }
  return { v: 1, t: "insertRows", sheet: SHEET, rows: records };
}

function validDeleteRows(rand, backing) {
  const rows = backing.rows();
  const ids = [];
  const count = 1 + pick(rand, 2);
  for (let i = 0; i < count; i++) {
    const id = rows[pick(rand, rows.length)].id;
    if (!ids.includes(id)) ids.push(id);
  }
  return { v: 1, t: "deleteRows", sheet: SHEET, rows: ids };
}

function validChangeRows(rand, backing) {
  const rows = backing.rows();
  const id = rows[pick(rand, rows.length)].id;
  const record = { id };
  if (chance(rand, 0.75)) {
    const others = rows.filter((row) => row.id !== id).map((row) => ({ pos: row.pos }));
    const key = keyAt(others, pick(rand, others.length + 1));
    record.pos = key.pos;
  }
  if (record.pos === undefined || chance(rand, 0.2)) {
    record.height = chance(rand, 0.15) ? null : 20 + pick(rand, 40);
  }
  return { v: 1, t: "changeRows", sheet: SHEET, rows: [record] };
}

function colCells(rand, backing, at) {
  const rows = backing.rows();
  if (rows.length === 0) return undefined;
  const covered = new Set();
  for (const box of boxesOf(backing)) {
    if (box.col < at && at <= box.right) for (let r = box.row; r <= box.bottom; r++) covered.add(r);
  }
  const free = [];
  rows.forEach((row, r) => {
    if (!covered.has(r)) free.push(r);
  });
  const cells = [];
  const count = chance(rand, 0.5) ? 0 : 1 + pick(rand, 2);
  for (let i = 0; i < count && free.length > 0; i++) {
    const at2 = free.splice(pick(rand, free.length), 1)[0];
    const entry = [rows[at2].id, contentFor(rand)];
    if (chance(rand, 0.4)) entry.push(extraFor(rand));
    cells.push(entry);
  }
  return cells.length > 0 ? cells : undefined;
}

function validInsertCols(rand, backing) {
  const order = backing.cols().map((col) => ({ pos: col.pos }));
  const records = [];
  const taken = new Set();
  const count = chance(rand, 0.25) ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const at = pick(rand, order.length + 1);
    const key = keyAt(order, at);
    order.splice(key.index, 0, { pos: key.pos });
    const id = freshId(backing, taken);
    taken.add(id);
    const record = { id, pos: key.pos };
    if (chance(rand, 0.25)) record.width = 40 + pick(rand, 200);
    if (chance(rand, 0.2)) record.fmt = pickOf(rand, FORMATS);
    const cells = colCells(rand, backing, key.index);
    if (cells !== undefined) record.cells = cells;
    records.push(record);
  }
  return { v: 1, t: "insertCols", sheet: SHEET, cols: records };
}

function validDeleteCols(rand, backing) {
  const cols = backing.cols();
  const ids = [];
  const count = 1 + pick(rand, 2);
  for (let i = 0; i < count; i++) {
    const id = cols[pick(rand, cols.length)].id;
    if (!ids.includes(id)) ids.push(id);
  }
  return { v: 1, t: "deleteCols", sheet: SHEET, cols: ids };
}

function validChangeCols(rand, backing) {
  const cols = backing.cols();
  const id = cols[pick(rand, cols.length)].id;
  const record = { id };
  const what = pick(rand, 3);
  if (what === 0) {
    const others = cols.filter((col) => col.id !== id).map((col) => ({ pos: col.pos }));
    const key = keyAt(others, pick(rand, others.length + 1));
    record.pos = key.pos;
  } else if (what === 1) {
    record.width = 40 + pick(rand, 200);
  } else {
    record.fmt = pickOf(rand, FORMATS);
  }
  return { v: 1, t: "changeCols", sheet: SHEET, cols: [record] };
}

function validMerge(rand, backing, invalidRate = 0) {
  const rows = backing.rows();
  const cols = backing.cols();
  const boxes = boxesOf(backing);
  const frozen = backing.frozen();
  for (let attempt = 0; attempt < 12; attempt++) {
    const r0 = pick(rand, rows.length);
    const c0 = pick(rand, cols.length);
    if (backing.cell(r0, c0)?.hidden) continue;
    let bottom = r0 + pick(rand, Math.min(3, rows.length - 1 - r0) + 1);
    let right = c0 + pick(rand, Math.min(3, cols.length - 1 - c0) + 1);
    if (r0 < frozen.rows) bottom = Math.min(bottom, frozen.rows - 1);
    if (c0 < frozen.cols) right = Math.min(right, frozen.cols - 1);
    if (bottom === r0 && right === c0) continue;
    if (boxes.some((box) => intersects(box, r0, bottom, c0, right))) continue;
    const stale = invalidRate > 0 && chance(rand, invalidRate);
    const clears = stale ? staleClears(rand, backing, r0, bottom, c0, right) : clearsFor(backing, r0, bottom, c0, right);
    return { v: 1, t: "merge", sheet: SHEET, from: [rows[r0].id, cols[c0].id], to: [rows[bottom].id, cols[right].id], clears };
  }
  return validInsertRows(rand, backing);
}

// A merge across the frozen column line, which is drawn: only the row line cuts a merge.
function validMergeFrozen(rand, backing, invalidRate = 0) {
  const rows = backing.rows();
  const cols = backing.cols();
  const boxes = boxesOf(backing);
  const frozen = backing.frozen();
  for (let attempt = 0; attempt < 12; attempt++) {
    const left = frozen.cols - 1;
    const right = Math.min(cols.length - 1, left + 1 + pick(rand, 2));
    const r0 = pick(rand, rows.length);
    if (left < 0 || right <= left) continue;
    if (r0 < frozen.rows) continue;
    if (backing.cell(r0, left)?.hidden) continue;
    const bottom = Math.min(rows.length - 1, r0 + pick(rand, 2));
    if (boxes.some((box) => intersects(box, r0, bottom, left, right))) continue;
    const stale = invalidRate > 0 && chance(rand, invalidRate);
    const clears = stale ? staleClears(rand, backing, r0, bottom, left, right) : clearsFor(backing, r0, bottom, left, right);
    return mark("mergeFrozen", { v: 1, t: "merge", sheet: SHEET, from: [rows[r0].id, cols[left].id], to: [rows[bottom].id, cols[right].id], clears });
  }
  return validMerge(rand, backing, invalidRate);
}

// A sort: 2 to 6 records moved in one action, each to a key between the records that stay.
function validSortRows(rand, backing) {
  const rows = backing.rows();
  const wanted = new Set();
  const count = Math.min(rows.length, 6, 2 + pick(rand, 5));
  while (wanted.size < count) wanted.add(rows[pick(rand, rows.length)].id);
  let order = rows.map((row) => ({ id: row.id, pos: row.pos }));
  const records = [];
  for (const id of wanted) {
    const rest = order.filter((one) => one.id !== id);
    const at = keyAt(rest, pick(rand, rest.length + 1));
    const record = { id, pos: at.pos };
    if (chance(rand, 0.3)) record.height = 20 + pick(rand, 30);
    records.push(record);
    let ix = 0;
    while (ix < rest.length && (rest[ix].pos < record.pos || (rest[ix].pos === record.pos && rest[ix].id < id))) ix++;
    order = rest.slice(0, ix).concat([{ id, pos: record.pos }], rest.slice(ix));
  }
  return mark("sortRows", { v: 1, t: "changeRows", sheet: SHEET, rows: records });
}

function validSortCols(rand, backing) {
  const cols = backing.cols();
  const wanted = new Set();
  const count = Math.min(cols.length, 6, 2 + pick(rand, 5));
  while (wanted.size < count) wanted.add(cols[pick(rand, cols.length)].id);
  let order = cols.map((col) => ({ id: col.id, pos: col.pos }));
  const records = [];
  for (const id of wanted) {
    const rest = order.filter((one) => one.id !== id);
    const at = keyAt(rest, pick(rand, rest.length + 1));
    const record = { id, pos: at.pos };
    if (chance(rand, 0.3)) record.width = 40 + pick(rand, 100);
    if (chance(rand, 0.3)) record.fmt = pickOf(rand, FORMATS);
    records.push(record);
    let ix = 0;
    while (ix < rest.length && (rest[ix].pos < record.pos || (rest[ix].pos === record.pos && rest[ix].id < id))) ix++;
    order = rest.slice(0, ix).concat([{ id, pos: record.pos }], rest.slice(ix));
  }
  return mark("sortCols", { v: 1, t: "changeCols", sheet: SHEET, cols: records });
}

const ROW_STYLES = ["color:red", "height:30px", "height:25px;font-weight:bold", "background:#eef;font-weight:bold", "color:red;height:30px", "background: #eee; height: 24px"];

// An insert into the frozen block, with the row style a tab writes.
function validInsertFrozen(rand, backing) {
  const rows = backing.rows();
  const frozen = backing.frozen().rows;
  const order = rows.map((row) => ({ pos: row.pos }));
  const at = keyAt(order, Math.min(pick(rand, frozen + 1), order.length));
  const id = freshId(backing);
  const record = { id, pos: at.pos, frozen: true };
  if (chance(rand, 0.5)) record.style = pickOf(rand, ROW_STYLES);
  if (chance(rand, 0.5)) record.height = 20 + pick(rand, 40);
  const action = { v: 1, t: "insertRows", sheet: SHEET, rows: [record] };
  const styled = record.style !== undefined;
  const tail = styled && /^[^;]+;.*height:/.test(record.style);
  return mark(tail ? "rowStyleTail" : styled ? "insertStyle" : "insertFrozen", action);
}

function validUnmerge(rand, backing) {
  const boxes = boxesOf(backing);
  if (boxes.length === 0) return validMerge(rand, backing);
  const box = interiorBox(rand, backing, boxes);
  const rows = backing.rows();
  const cols = backing.cols();
  return { v: 1, t: "unmerge", sheet: SHEET, row: rows[box.row].id, col: cols[box.col].id };
}

function interiorBox(rand, backing, boxes) {
  const rows = backing.rows();
  const cols = backing.cols();
  const usable = boxes.filter((box) => rows[box.row] !== undefined && cols[box.col] !== undefined);
  return usable.length > 0 ? pickOf(rand, usable) : pickOf(rand, boxes);
}

// The counts of frozen rows and columns a freeze action can name without cutting a merge.
function freezeLines(backing) {
  const rows = backing.rows();
  const cols = backing.cols();
  const boxes = boxesOf(backing);
  const rowCut = (f) => boxes.some((box) => box.bottom > box.row && box.row < f && box.bottom >= f);
  const colCut = (f) => boxes.some((box) => box.right > box.col && box.col < f && box.right >= f);
  const rowLines = [];
  for (let f = 0; f <= rows.length; f++) if (!rowCut(f)) rowLines.push(f);
  const colLines = [];
  for (let f = 0; f <= cols.length; f++) if (!colCut(f)) colLines.push(f);
  return { rowLines, colLines, rows, cols };
}

function validFreeze(rand, backing) {
  const { rowLines, colLines, rows, cols } = freezeLines(backing);
  const action = { v: 1, t: "freeze", sheet: SHEET };
  const what = rows.length > 0 && cols.length > 0 ? pick(rand, 3) : rows.length > 0 ? 0 : 1;
  if (what !== 1) {
    const f = pickOf(rand, rowLines);
    action.rowsThrough = f === 0 ? null : rows[f - 1].id;
  }
  if (what !== 0) {
    const f = pickOf(rand, colLines);
    action.colsThrough = f === 0 ? null : cols[f - 1].id;
  }
  return action;
}

function validPlain(rand, backing, mayCreate = true) {
  const names = feasible(backing).filter(([name]) => name !== "batch" && (mayCreate || (name !== "insertRows" && name !== "insertCols")));
  const free = names.length > 0 ? names : feasible(backing).filter(([name]) => name !== "batch");
  return build(weighted(rand, free), rand, backing);
}

function feasible(backing) {
  const rows = backing.rows().length;
  const cols = backing.cols().length;
  const boxes = boxesOf(backing).length;
  const blanks = rows === 0 || cols === 0;
  const names = [["insertRows", WEIGHTS.find(([n]) => n === "insertRows")[1]], ["insertCols", 7]];
  for (const [name, weight] of WEIGHTS) {
    if (name === "insertRows" || name === "insertCols" || name === "batch") continue;
    if ((name === "set" || name === "setGrow" || name === "format" || name === "merge" || name === "mergeFrozen") && blanks) continue;
    if ((name === "deleteRows" || name === "changeRows" || name === "sortRows") && rows < 2) continue;
    if ((name === "deleteCols" || name === "changeCols" || name === "sortCols") && cols < 2) continue;
    if (name === "mergeFrozen" && cols < 2) continue;
    if (name === "unmerge" && boxes === 0) continue;
    if (name === "freeze" && rows === 0 && cols === 0) continue;
    names.push([name, weight]);
  }
  names.push(["batch", 6]);
  return names;
}

function build(kind, rand, backing, invalidRate = 0) {
  switch (kind) {
    case "set":
      return validSet(rand, backing);
    case "setGrow":
      return validSetGrow(rand, backing);
    case "format":
      return validFormat(rand, backing);
    case "insertRows":
      return validInsertRows(rand, backing);
    case "deleteRows":
      return validDeleteRows(rand, backing);
    case "changeRows":
      return validChangeRows(rand, backing);
    case "insertCols":
      return validInsertCols(rand, backing);
    case "deleteCols":
      return validDeleteCols(rand, backing);
    case "changeCols":
      return validChangeCols(rand, backing);
    case "merge":
      return validMerge(rand, backing, invalidRate);
    case "mergeFrozen":
      return validMergeFrozen(rand, backing, invalidRate);
    case "sortRows":
      return validSortRows(rand, backing);
    case "sortCols":
      return validSortCols(rand, backing);
    case "insertFrozen":
      return validInsertFrozen(rand, backing);
    case "unmerge":
      return validUnmerge(rand, backing);
    case "freeze":
      return validFreeze(rand, backing);
    default:
      return validBatch(rand, backing, invalidRate);
  }
}

function validBatch(rand, backing, invalidRate) {
  const scratch = modelBacking(clone(backing.sheet), { sheetId: backing.sheetId });
  const actions = [];
  const count = 2 + pick(rand, 2);
  for (let i = 0; i < count; i++) {
    const one = classify(validPlain(rand, scratch, i === count - 1), scratch);
    actions.push(one);
    apply(scratch, one, { derive, formulas: null });
  }
  if (invalidRate > 0 && chance(rand, 0.4)) actions.push(invalidAction(rand, scratch));
  return { v: 1, t: "batch", actions };
}

function invalidAction(rand, backing) {
  const rows = backing.rows();
  const cols = backing.cols();
  const missing = freshId(backing);
  const options = [];
  const hidden = hiddenCell(backing);
  const boxes = boxesOf(backing);
  if (rows.length > 0 && cols.length > 0) {
    const r = pick(rand, rows.length);
    const c = pick(rand, cols.length);
    const row = rows[r].id;
    const col = cols[c].id;
    options.push(
      () => ({ v: 1, t: "set", sheet: SHEET, cells: [[missing, col, 5]] }),
      () => ({ v: 1, t: "set", sheet: SHEET, cells: [[row, missing, 5]] }),
      () => ({ v: 1, t: "set", sheet: SHEET, cells: [[row, col, { bad: 1 }]] }),
      () => ({ v: 1, t: "set", sheet: SHEET, cells: [[row, col, 1], [row, col, 2]] }),
      () => ({ v: 1, t: "format", sheet: SHEET, cells: [[row, missing, { fmt: "0.00" }]] }),
      () => ({ v: 1, t: "format", sheet: SHEET, cells: [[row, col, { fmt: "x".repeat(300) }]] }),
      () => ({ v: 2, t: "set", sheet: SHEET, cells: [[row, col, 1]] }),
      () => ({ v: 1, t: "set", sheet: SHEET, cells: [] }),
      () => ({ v: 1, t: "merge", sheet: SHEET, from: [row, col], to: [row, col] }),
      () => ({ v: 1, t: "insertRows", sheet: SHEET, rows: [{ id: row, pos: keyAt(rows, r).pos }] }),
      () => ({ v: 1, t: "insertCols", sheet: SHEET, cols: [{ id: col, pos: keyAt(cols, c).pos }] }),
    );
    const cell = backing.cell(r, c);
    if (!cell || (cell.colspan === undefined && cell.rowspan === undefined)) {
      options.push(() => ({ v: 1, t: "unmerge", sheet: SHEET, row, col }));
    }
    if (hidden !== null) {
      options.push(() => ({ v: 1, t: "set", sheet: SHEET, cells: [[rows[hidden.r].id, cols[hidden.c].id, 9]] }));
    }
  }
  options.push(
    () => ({ v: 1, t: "insertRows", sheet: SHEET, rows: [{ id: missing, pos: "0" }] }),
    () => ({ v: 1, t: "insertCols", sheet: SHEET, cols: [{ id: missing, pos: "" }] }),
    () => ({ v: 1, t: "insertRows", sheet: SHEET, rows: [{ id: "bad id", pos: "A" }] }),
    () => ({ v: 1, t: "set", sheet: SHEET, cells: [[missing, missing, 1]] }),
    () => ({ v: 1, t: "batch", actions: [] }),
    () => ({ v: 1, t: "batch", actions: [{ v: 1, t: "batch", actions: [{ v: 1, t: "freeze", sheet: SHEET }] }] }),
    () => ({ v: 1, t: "freeze", sheet: 5 }),
  );
  for (const box of boxes) {
    if (box.right + 1 < cols.length) {
      options.push(() => ({
        v: 1,
        t: "merge",
        sheet: SHEET,
        from: [rows[box.row].id, cols[box.col].id],
        to: [rows[box.bottom].id, cols[box.right + 1].id],
        clears: clearsFor(backing, box.row, box.bottom, box.col, box.right + 1),
      }));
    }
    if (box.bottom > box.row) {
      options.push(() => ({ v: 1, t: "freeze", sheet: SHEET, rowsThrough: rows[box.bottom].id }));
    }
    if (box.right > box.col) {
      options.push(() => ({ v: 1, t: "freeze", sheet: SHEET, colsThrough: cols[box.right].id }));
    }
    if (box.row + 1 < rows.length && box.right + 1 < cols.length) {
      options.push(() => ({
        v: 1,
        t: "merge",
        sheet: SHEET,
        from: [rows[box.row].id, cols[box.col].id],
        to: [rows[box.bottom + 1]?.id ?? rows[box.bottom].id, cols[box.right + 1].id],
        clears: clearsFor(backing, box.row, Math.min(rows.length - 1, box.bottom + 1), box.col, box.right + 1),
      }));
    }
  }
  return pickOf(rand, options)();
}

export function genAction(rand, backing, { invalidRate = 0.15 } = {}) {
  if (invalidRate > 0 && chance(rand, invalidRate)) return invalidAction(rand, backing);
  return classify(build(weighted(rand, feasible(backing)), rand, backing, invalidRate), backing);
}

export function genList(rand, startSheet, length, options = {}) {
  const { formulas = null, invalidRate = 0.15 } = options;
  const scratch = modelBacking(clone(startSheet), { sheetId: null });
  const actions = [];
  for (let i = 0; i < length; i++) {
    const action = genAction(rand, scratch, { invalidRate });
    actions.push(action);
    apply(scratch, action, { derive, formulas });
  }
  return actions;
}
