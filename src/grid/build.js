// The builders: a request such as "set B2", "format B:D" or "insert 2 rows above row 5" becomes one
// action for the reducer. A builder reads the sheet through a backing's read side (sheetId, rows,
// cols, rowIndex, colIndex, cell, frozen), turns A1 references into ids at the moment it runs,
// mints ids through the caller's newId and takes order keys from the neighbors. It never writes,
// and it returns null when the request names nothing to write or asks for what the sheet already
// has. Merge spans and frozen membership are the reducer's: it works them out on the state the
// action lands on.

import { colIndex, parseArea, parseRef } from "./a1.js";
import { keysBetween } from "./codec/order-keys.js";
import { cellValue } from "./codec/value.js";
import { GridRefused } from "./ops.js";
import { canonStyle, declarationProperty, splitDeclarations } from "./styles.js";

export const GROW_ROWS = 10000;
export const GROW_COLS = 1000;

const MINT_TRIES = 100;

const SIDES = ["border-top", "border-right", "border-bottom", "border-left"];
const PRESETS = ["all", "outer", "inner", "top", "bottom", "left", "right", "none"];
const ROW_NUMBER = /^[1-9][0-9]{0,6}$/;
const HEIGHT = /^height:([0-9]+)px$/;
const EDGES = ["top", "left", "bottom", "right"];

const refuse = (code, detail) => {
  throw new GridRefused(code, detail);
};

const sheetOf = (view) => view.sheetId ?? "";

const hasContent = (cell) => Boolean(cell) && !cell.hidden && (cell.f !== undefined || cellValue(cell) !== null);

const isFormula = (content) => content !== null && typeof content === "object";

// One end of an area: a cell, a column name or a row number.
function corner(text) {
  if (ROW_NUMBER.test(text)) return { row: Number(text) - 1, col: null };
  const col = colIndex(text);
  return col === -1 ? parseRef(text) : { row: null, col };
}

// An A1 area as inclusive indexes, whichever corner was written first. A whole column or whole row
// form leaves the other axis null.
export function spanOf(area) {
  const parts = typeof area === "string" ? area.split(":") : [];
  if (parts.length !== 2) return parseArea(area);
  const [a, b] = parts.map(corner);
  if ((a.row === null) !== (b.row === null) || (a.col === null) !== (b.col === null)) return parseArea(area);
  return {
    r0: a.row === null ? null : Math.min(a.row, b.row),
    c0: a.col === null ? null : Math.min(a.col, b.col),
    r1: a.row === null ? null : Math.max(a.row, b.row),
    c1: a.col === null ? null : Math.max(a.col, b.col),
  };
}

function rectOf(view, area) {
  const { r0, c0, r1, c1 } = spanOf(area);
  const rows = view.rows().length;
  const cols = view.cols().length;
  const rect = { top: r0 ?? 0, bottom: r1 ?? rows - 1, left: c0 ?? 0, right: c1 ?? cols - 1, wholeCols: r0 === null, wholeRows: c0 === null };
  if (rect.bottom >= rows || rect.right >= cols) refuse("outside_sheet", `${area} reaches past the sheet's last row or column`);
  return rect;
}

function eachCell(view, rect, visit) {
  const rows = view.rows();
  const cols = view.cols();
  for (let r = rect.top; r <= rect.bottom; r++) {
    for (let c = rect.left; c <= rect.right; c++) visit(view.cell(r, c), rows[r], cols[c], r, c);
  }
}

// Ids for new records: the caller's newId, asked again while it gives an id the sheet has or this
// action has already taken, and refused when it keeps doing so. Rows and columns share one id
// space.
function minter(view, newId) {
  const taken = new Set();
  const free = (id) => typeof id === "string" && !taken.has(id) && view.rowIndex(id) < 0 && view.colIndex(id) < 0;
  return (prefix) => {
    for (let tries = 0; tries < MINT_TRIES; tries++) {
      const id = newId(prefix);
      if (!free(id)) continue;
      taken.add(id);
      return id;
    }
    return refuse("bad_action", `newId gave ${MINT_TRIES} ids in a row that are in the sheet or are not text`);
  };
}

function appended(records, count, mint, prefix) {
  const last = records.length > 0 ? records[records.length - 1].pos : null;
  return keysBetween(last, null, count).map((pos) => ({ id: mint(prefix), pos }));
}

// A style map as an action carries it: a `border` is written as its four sides.
function sidesOf(style) {
  if (style === null || typeof style !== "object" || Array.isArray(style)) refuse("bad_action", "a style is an object of properties");
  const out = {};
  for (const property of Object.keys(style)) {
    if (property === "border") for (const side of SIDES) out[side] = style.border;
    else out[property] = style[property];
  }
  return out;
}

// The style properties a cell holds, as an action names them: a border as its four sides and a
// background by both of its names.
function heldBy(cell) {
  const held = new Set();
  if (!cell || typeof cell.style !== "string") return held;
  for (const declaration of splitDeclarations(cell.style)) {
    const property = declarationProperty(declaration);
    if (property === "border") for (const side of SIDES) held.add(side);
    else if (property === "background" || property === "background-color") held.add("background").add("background-color");
    else held.add(property);
  }
  return held;
}

// What a request for `fmt` writes as a cell's own format: null (no own format) when its column
// shows `fmt`, and nothing when the cell already is so.
function fmtFor(cell, colFmt, fmt) {
  const own = cell && cell.fmt !== undefined ? cell.fmt : null;
  const want = fmt === colFmt ? null : fmt;
  return want === own ? undefined : want;
}

// The part of a style map that changes a cell: removing a property the cell does not hold is left
// out.
function styleFor(cell, map) {
  const held = heldBy(cell);
  const out = {};
  for (const property of Object.keys(map)) if (map[property] !== null || held.has(property)) out[property] = map[property];
  return Object.keys(out).length > 0 ? out : undefined;
}

// A block item is content alone, or { content, fmt?, style? }. Empty text is no content. `old` is
// the cell the item lands on and `colFmt` its column's format.
function itemOf(item, formulas, old, colFmt) {
  const one = item !== null && typeof item === "object" && "content" in item ? item : { content: item };
  const raw = !formulas && isFormula(one.content) && typeof one.content.f === "string" ? one.content.f : one.content;
  const content = raw === "" ? null : raw;
  const extra = {};
  const fmt = one.fmt === undefined ? undefined : fmtFor(old, colFmt, one.fmt);
  if (fmt !== undefined) extra.fmt = fmt;
  const style = one.style === undefined ? undefined : styleFor(old, sidesOf(one.style));
  if (style !== undefined) extra.style = style;
  return { content, extra: Object.keys(extra).length > 0 ? extra : undefined };
}

export function buildSetRange(view, at, block, { grow = false, formulas = true, newId } = {}) {
  if (!Array.isArray(block) || !block.every(Array.isArray)) refuse("bad_action", "a block is a list of rows, each a list of items");
  const origin = parseRef(at);
  const rows = view.rows();
  const cols = view.cols();
  const kept = [];
  let lastRow = -1;
  let lastCol = -1;
  block.forEach((line, i) => {
    line.forEach((item, j) => {
      if (item === undefined) return;
      const r = origin.row + i;
      const c = origin.col + j;
      const old = r < rows.length && c < cols.length ? view.cell(r, c) : null;
      const { content, extra } = itemOf(item, formulas, old, c < cols.length ? cols[c].fmt ?? null : null);
      if (content === null && extra === undefined && !hasContent(old)) return;
      kept.push({ r, c, content, extra });
      lastRow = Math.max(lastRow, r);
      lastCol = Math.max(lastCol, c);
    });
  });
  if (kept.length === 0) return null;

  const moreRows = Math.max(0, lastRow + 1 - rows.length);
  const moreCols = Math.max(0, lastCol + 1 - cols.length);
  if (moreRows > 0 || moreCols > 0) {
    if (!grow) refuse("outside_sheet", `the block at ${at} reaches past the sheet's last row or column`);
    if (moreRows > GROW_ROWS || moreCols > GROW_COLS) {
      refuse("too_large", `the block at ${at} needs ${moreRows} new rows and ${moreCols} new columns; one action brings at most ${GROW_ROWS} rows and ${GROW_COLS} columns`);
    }
  }
  const mint = minter(view, newId);
  const newRows = appended(rows, moreRows, mint, "r");
  const newCols = appended(cols, moreCols, mint, "c");
  const rowId = (r) => (r < rows.length ? rows[r] : newRows[r - rows.length]).id;
  const colId = (c) => (c < cols.length ? cols[c] : newCols[c - cols.length]).id;

  const action = { v: 1, t: "set", sheet: sheetOf(view) };
  if (newRows.length > 0) action.rows = newRows;
  if (newCols.length > 0) action.cols = newCols;
  action.cells = kept.map(({ r, c, content, extra }) => (extra === undefined ? [rowId(r), colId(c), content] : [rowId(r), colId(c), content, extra]));
  return action;
}

export function buildSet(view, ref, content, { fmt, style, grow, newId } = {}) {
  return buildSetRange(view, ref, [[{ content, fmt, style }]], { grow, newId });
}

// An import is a block that always grows the sheet and, unless the caller says so, never brings a
// formula: a formula item is written as its text.
export function buildImport(view, at, block, { formulas = false, newId } = {}) {
  return buildSetRange(view, at, block, { grow: true, formulas, newId });
}

export function buildClear(view, area) {
  const cells = [];
  eachCell(view, rectOf(view, area), (cell, row, col) => {
    if (hasContent(cell)) cells.push([row.id, col.id, null]);
  });
  return cells.length === 0 ? null : { v: 1, t: "set", sheet: sheetOf(view), cells };
}

// The sides a border preset writes on one cell of the area. A merged cell stands for its whole box.
function presetSides({ preset, line }, rect, cell, r, c) {
  if (preset === "none") return Object.fromEntries(SIDES.map((side) => [side, null]));
  const top = r === rect.top;
  const left = c === rect.left;
  const bottom = r + (cell?.rowspan ?? 1) - 1 >= rect.bottom;
  const right = c + (cell?.colspan ?? 1) - 1 >= rect.right;
  const on = {
    "border-top": preset === "all" || ((preset === "outer" || preset === "top") && top),
    "border-right": preset === "all" || ((preset === "outer" || preset === "right") && right) || (preset === "inner" && !right),
    "border-bottom": preset === "all" || ((preset === "outer" || preset === "bottom") && bottom) || (preset === "inner" && !bottom),
    "border-left": preset === "all" || ((preset === "outer" || preset === "left") && left),
  };
  return Object.fromEntries(SIDES.filter((side) => on[side]).map((side) => [side, line]));
}

// A format on whole columns is the column default: the columns that do not show `fmt` take it and
// each of their cells loses its own. On any other area a cell takes `fmt` as its own, or loses its
// own when the column already shows `fmt`.
export function buildFormat(view, area, { fmt, style, border } = {}) {
  if (border !== undefined) {
    if (border === null || typeof border !== "object" || !PRESETS.includes(border.preset)) refuse("bad_action", `a border names a preset: ${PRESETS.join(", ")}`);
    if (border.preset !== "none" && typeof border.line !== "string") refuse("bad_action", "a border preset other than none needs a line such as 1px solid #333333");
  }
  const rect = rectOf(view, area);
  const columns = rect.wholeCols && fmt !== undefined;
  const map = style === undefined ? {} : sidesOf(style);
  const cells = [];
  eachCell(view, rect, (cell, row, col, r, c) => {
    if (cell && cell.hidden) return;
    const extra = {};
    const own = fmt === undefined ? undefined : fmtFor(cell, columns ? fmt : col.fmt ?? null, fmt);
    if (own !== undefined) extra.fmt = own;
    const sides = styleFor(cell, { ...map, ...(border === undefined ? null : presetSides(border, rect, cell, r, c)) });
    if (sides !== undefined) extra.style = sides;
    if (Object.keys(extra).length > 0) cells.push([row.id, col.id, extra]);
  });
  const sheet = sheetOf(view);
  const format = cells.length === 0 ? null : { v: 1, t: "format", sheet, cells };
  const changed = columns ? view.cols().slice(rect.left, rect.right + 1).filter((col) => (col.fmt ?? null) !== fmt) : [];
  if (changed.length === 0) return format;
  const defaults = { v: 1, t: "changeCols", sheet, cols: changed.map((col) => ({ id: col.id, fmt })) };
  return format === null ? defaults : { v: 1, t: "batch", actions: [defaults, format] };
}

export function buildColumnFormat(view, area, fmt) {
  if (!rectOf(view, area).wholeCols) refuse("bad_action", `${area} is not whole columns such as B:D`);
  return buildFormat(view, area, { fmt });
}

// A row's height in pixels, which it holds in its style: null when it has none, and undefined when
// the style holds a height the engine did not write.
function heightOf(row) {
  const heights = typeof row.style === "string" ? splitDeclarations(row.style).map((one) => one.trim()).filter((one) => declarationProperty(one) === "height") : [];
  if (heights.length === 0) return null;
  const px = heights.length === 1 ? HEIGHT.exec(heights[0]) : null;
  return px === null ? undefined : Number(px[1]);
}

// The two kinds of record. Rows are named by number, columns by letters; everything else about a
// row builder and its column twin is the same.
const ROWS = {
  name: "rows",
  word: "row",
  sample: "a row number such as 5",
  prefix: "r",
  limit: GROW_ROWS,
  records: (view) => view.rows(),
  index: (name) => ((typeof name === "number" || typeof name === "string") && ROW_NUMBER.test(name) ? Number(name) - 1 : -1),
  first: "top",
  last: "bottom",
  crossFirst: "left",
  crossLast: "right",
  crossWhole: "wholeCols",
  cellAt: (view, line, cross) => view.cell(line, cross),
  others: (view) => view.cols(),
  copied: ["style"],
  size: "height",
  sizeOf: heightOf,
  insert: "insertRows",
  remove: "deleteRows",
  change: "changeRows",
  through: "rowsThrough",
};

const COLS = {
  name: "cols",
  word: "column",
  sample: "a column name such as C",
  prefix: "c",
  limit: GROW_COLS,
  records: (view) => view.cols(),
  index: colIndex,
  first: "left",
  last: "right",
  crossFirst: "top",
  crossLast: "bottom",
  crossWhole: "wholeRows",
  cellAt: (view, line, cross) => view.cell(cross, line),
  others: (view) => view.rows(),
  copied: ["width", "fmt"],
  size: "width",
  sizeOf: (col) => col.width ?? null,
  insert: "insertCols",
  remove: "deleteCols",
  change: "changeCols",
  through: "colsThrough",
};

// The records an area names, first and last index. A row number or a column name alone is one
// record; an area that names only the other kind of record is refused.
function lineOf(axis, view, area) {
  const rect = rectOf(view, axis.index(area) >= 0 ? `${area}:${area}` : area);
  if (rect[axis.crossWhole]) refuse("bad_action", `${area} names no ${axis.word}`);
  return [rect[axis.first], rect[axis.last]];
}

// The index new or moved records land before: a row number or a column name, or one past the last
// record for the end.
function slotOf(axis, view, before) {
  const at = axis.index(before);
  if (at < 0) refuse("bad_action", `new or moved ${axis.word}s go before ${axis.sample}`);
  if (at > axis.records(view).length) refuse("outside_sheet", `${before} is more than one past the sheet's last ${axis.word}`);
  return at;
}

// Keys for `count` records that land before `others[at]`. When the two neighbors share a key no key
// lies between them, so the records of that run from `at` onward get fresh keys too, after the new
// ones: they are the followers. The records before `at` keep their key.
function keysAt(others, at, count) {
  const low = at > 0 ? others[at - 1].pos : null;
  let end = at;
  if (low !== null) while (end < others.length && others[end].pos === low) end++;
  const high = end < others.length ? others[end].pos : null;
  const keys = keysBetween(low, high, count + end - at);
  return { keys: keys.slice(0, count), followers: others.slice(at, end).map((record, i) => ({ id: record.id, pos: keys[count + i] })) };
}

function boxesOf(view) {
  const boxes = [];
  eachCell(view, { top: 0, bottom: view.rows().length - 1, left: 0, right: view.cols().length - 1 }, (cell, row, col, r, c) => {
    if (!cell || (cell.rowspan === undefined && cell.colspan === undefined)) return;
    boxes.push({ top: r, left: c, bottom: r + (cell.rowspan ?? 1) - 1, right: c + (cell.colspan ?? 1) - 1 });
  });
  return boxes;
}

// What each new record copies from the record `like` names: the record's own format fields and each
// cell's own format and style, never content and never a span. A cell the new records will be
// covered in (a merge runs through the slot) is left out, because the reducer refuses a write into
// a covered position.
function likeOf(axis, view, like, at) {
  const [from] = lineOf(axis, view, like);
  const record = axis.records(view)[from];
  const covered = new Set();
  for (const box of boxesOf(view)) {
    if (box[axis.first] >= at || at > box[axis.last]) continue;
    for (let cross = box[axis.crossFirst]; cross <= box[axis.crossLast]; cross++) covered.add(cross);
  }
  const cells = [];
  axis.others(view).forEach((other, cross) => {
    const cell = axis.cellAt(view, from, cross);
    if (!cell || cell.hidden || covered.has(cross)) return;
    const css = canonStyle(cell.style);
    if (cell.fmt === undefined && css === undefined) return;
    const extra = {};
    if (cell.fmt !== undefined) extra.fmt = cell.fmt;
    if (css !== undefined) extra.css = css;
    cells.push([other.id, null, extra]);
  });
  const fields = {};
  for (const key of axis.copied) if (record[key] !== undefined) fields[key] = record[key];
  return () => (cells.length === 0 ? { ...fields } : { ...fields, cells: cells.map(([id, content, extra]) => [id, content, { ...extra }]) });
}

function insertOn(axis, view, before, count, { newId, like } = {}) {
  if (!Number.isInteger(count) || count < 1) refuse("bad_action", `the number of new ${axis.word}s is a whole number from 1`);
  if (count > axis.limit) refuse("too_large", `one action brings at most ${axis.limit} new ${axis.word}s, not ${count}`);
  const at = slotOf(axis, view, before);
  const { keys, followers } = keysAt(axis.records(view), at, count);
  const mint = minter(view, newId);
  const copied = like === undefined ? () => null : likeOf(axis, view, like, at);
  const sheet = sheetOf(view);
  const insert = { v: 1, t: axis.insert, sheet, [axis.name]: keys.map((pos) => ({ id: mint(axis.prefix), pos, ...copied() })) };
  if (followers.length === 0) return insert;
  return { v: 1, t: "batch", actions: [{ v: 1, t: axis.change, sheet, [axis.name]: followers }, insert] };
}

function removeOn(axis, view, area) {
  const [first, last] = lineOf(axis, view, area);
  return { v: 1, t: axis.remove, sheet: sheetOf(view), [axis.name]: axis.records(view).slice(first, last + 1).map((record) => record.id) };
}

// A move is new keys for the moved records, in their order, at the place they land. A block moved
// to where it already is gives no action.
function moveOn(axis, view, area, before) {
  const records = axis.records(view);
  const [first, last] = lineOf(axis, view, area);
  const at = slotOf(axis, view, before);
  if (at >= first && at <= last + 1) return null;
  const moved = records.slice(first, last + 1);
  const others = [...records.slice(0, first), ...records.slice(last + 1)];
  const { keys, followers } = keysAt(others, at < first ? at : at - moved.length, moved.length);
  return { v: 1, t: axis.change, sheet: sheetOf(view), [axis.name]: [...moved.map((record, i) => ({ id: record.id, pos: keys[i] })), ...followers] };
}

// A size for the records of an area that do not have it yet.
function resizeOn(axis, view, area, size) {
  const [first, last] = lineOf(axis, view, area);
  const records = axis.records(view).slice(first, last + 1).filter((record) => axis.sizeOf(record) !== size);
  return records.length === 0 ? null : { v: 1, t: axis.change, sheet: sheetOf(view), [axis.name]: records.map((record) => ({ id: record.id, [axis.size]: size })) };
}

export const buildInsertRows = (view, before, count, options) => insertOn(ROWS, view, before, count, options);
export const buildDeleteRows = (view, area) => removeOn(ROWS, view, area);
export const buildMoveRows = (view, area, before) => moveOn(ROWS, view, area, before);
export const buildSetRowHeight = (view, area, height) => resizeOn(ROWS, view, area, height);

export const buildInsertCols = (view, before, count, options) => insertOn(COLS, view, before, count, options);
export const buildDeleteCols = (view, area) => removeOn(COLS, view, area);
export const buildMoveCols = (view, area, before) => moveOn(COLS, view, area, before);
export const buildSetColWidth = (view, area, width) => resizeOn(COLS, view, area, width);

// The reducer's own test for a cell that holds nothing: a merge names every other cell it clears.
const blank = (cell) =>
  cell.text === "" &&
  cell.f === undefined &&
  cell.fmt === undefined &&
  cell.colspan === undefined &&
  cell.rowspan === undefined &&
  cell.style === undefined;

export function buildMerge(view, area) {
  const rect = rectOf(view, area);
  if ((rect.bottom - rect.top + 1) * (rect.right - rect.left + 1) < 2) return null;
  if (boxesOf(view).some((box) => EDGES.every((edge) => box[edge] === rect[edge]))) return null;
  const rows = view.rows();
  const cols = view.cols();
  const clears = [];
  eachCell(view, rect, (cell, row, col, r, c) => {
    if ((r !== rect.top || c !== rect.left) && cell && !blank(cell)) clears.push([row.id, col.id]);
  });
  return { v: 1, t: "merge", sheet: sheetOf(view), from: [rows[rect.top].id, cols[rect.left].id], to: [rows[rect.bottom].id, cols[rect.right].id], clears };
}

// Any cell of a merge names it: the action carries the anchor.
export function buildUnmerge(view, ref) {
  const { row, col } = parseRef(ref);
  if (row >= view.rows().length || col >= view.cols().length) refuse("outside_sheet", `${ref} is past the sheet's last row or column`);
  const box = boxesOf(view).find((one) => one.top <= row && row <= one.bottom && one.left <= col && col <= one.right);
  if (box === undefined) return null;
  return { v: 1, t: "unmerge", sheet: sheetOf(view), row: view.rows()[box.top].id, col: view.cols()[box.left].id };
}

// The last frozen record for a count: the one at `count`, or null for none.
function throughOf(axis, view, count) {
  const records = axis.records(view);
  if (!Number.isInteger(count) || count < 0) refuse("bad_action", `the number of frozen ${axis.word}s is a whole number from 0`);
  if (count > records.length) refuse("outside_sheet", `the sheet has ${records.length} ${axis.word}s, fewer than the ${count} to freeze`);
  return count === 0 ? null : records[count - 1].id;
}

// A freeze names the last frozen row, the last frozen column, or both: each one whose count the
// request changes.
export function buildFreeze(view, { rows, cols } = {}) {
  const frozen = view.frozen();
  const action = { v: 1, t: "freeze", sheet: sheetOf(view) };
  for (const [axis, count] of [[ROWS, rows], [COLS, cols]]) {
    if (count === undefined) continue;
    const through = throughOf(axis, view, count);
    if (count !== frozen[axis.name]) action[axis.through] = through;
  }
  return action.rowsThrough === undefined && action.colsThrough === undefined ? null : action;
}

// Adds or replaces rules by id and removes rules by id (GRAMMAR.md, "Rules").
export function buildRules(view, { set = [], remove = [] } = {}) {
  return set.length === 0 && remove.length === 0 ? null : { v: 1, t: "rules", sheet: sheetOf(view), set, remove };
}
