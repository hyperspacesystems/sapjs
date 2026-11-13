// The reader: one grid's bytes to the model, and the model to the API's JSON
// shapes (the tab, the index entry, a range). The document level (tab names and
// ids, rev, choosing a tab) lives in the host's readDocument.

import { scanGrid } from "./scan.js";
import { cellValue, shown } from "./value.js";

export const RENDERS = ["values", "formulas", "cells"];

const A1 = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/;
const MAX_COLUMN = 16384;

export class QueryRefused extends Error {
  constructor(code, message) {
    super(message);
    this.name = "QueryRefused";
    this.code = code;
  }
}

// The whole model of the grid at `at`, as GRAMMAR.md's model. Throws CodecMiss.
export function gridModel(src, at) {
  const sheet = { cols: [], rows: [] };
  scanGrid(src, at, {
    table: (table) => Object.assign(sheet, table),
    col: (col) => sheet.cols.push(col),
    row: (row) => sheet.rows.push(row),
  });
  return sheet;
}

// A cell in the tab shape: null when blank or covered, a scalar when the cell is
// plain, otherwise an object with `v` typed and `text` only when it differs from v.
export function cellJson(cell) {
  if (!cell || cell.hidden) return null;
  const v = cellValue(cell);
  const plain = cell.f === undefined && cell.v === undefined && cell.fmt === undefined &&
    cell.style === undefined && cell.colspan === undefined && cell.rowspan === undefined;
  if (plain) return v;
  const out = {};
  if (cell.f !== undefined) out.f = cell.f;
  out.v = v;
  if (cell.text !== shown(v)) out.text = cell.text;
  if (cell.fmt !== undefined) out.fmt = cell.fmt;
  if (cell.style !== undefined) out.style = cell.style;
  if (cell.colspan !== undefined) out.colspan = cell.colspan;
  if (cell.rowspan !== undefined) out.rowspan = cell.rowspan;
  return out;
}

function rowJson(row) {
  const cells = row.cells.map(cellJson);
  while (cells.length > 0 && cells[cells.length - 1] === null) cells.pop();
  return { id: row.id, cells };
}

// The tab shape without id and name, which the document level adds.
export function tabJson(sheet) {
  const tab = { cols: sheet.cols.map((col) => col.id), rows: sheet.rows.map(rowJson) };
  if (sheet.stale) tab.stale = true;
  return tab;
}

export function tabIndex(sheet) {
  return {
    rows: sheet.rows.length,
    cols: sheet.cols.length,
    frozenRows: sheet.rows.filter((row) => row.frozen).length,
  };
}

function columnNumber(letters) {
  let n = 0;
  for (const letter of letters) n = n * 26 + (letter.charCodeAt(0) - 64);
  return n;
}

function parseCell(text, range) {
  const match = A1.exec(text);
  const column = match ? columnNumber(match[1]) : 0;
  if (!match || column > MAX_COLUMN) {
    throw new QueryRefused("bad_range", `range ${JSON.stringify(range)} is not an A1 cell or rectangle such as B2 or A1:C3`);
  }
  return { row: Number(match[2]) - 1, col: column - 1 };
}

// "B2" or "A1:C3" to zero-based inclusive bounds. Refuses every other form.
export function parseRange(range) {
  if (typeof range !== "string") throw new QueryRefused("bad_range", "range must be text such as A1:C3");
  const parts = range.split(":");
  if (parts.length > 2) throw new QueryRefused("bad_range", `range ${JSON.stringify(range)} has more than one colon`);
  const start = parseCell(parts[0], range);
  const end = parts.length === 2 ? parseCell(parts[1], range) : start;
  if (end.row < start.row || end.col < start.col) {
    throw new QueryRefused("bad_range", `range ${JSON.stringify(range)} is reversed: write the top left cell first`);
  }
  return { r0: start.row, c0: start.col, r1: end.row, c1: end.col };
}

// A rectangle of the sheet, clipped to the sheet's saved rows and columns and padded
// with null inside that. render "values" and "formulas" give { values }; "cells"
// gives { cols, rows } in the tab shape.
export function readRange(sheet, range, render = "values") {
  if (!RENDERS.includes(render)) {
    throw new QueryRefused("bad_render", `render must be one of ${RENDERS.join(", ")}`);
  }
  const { r0, c0, r1, c1 } = parseRange(range);
  const lastRow = Math.min(r1, sheet.rows.length - 1);
  const lastCol = Math.min(c1, sheet.cols.length - 1);
  const rows = sheet.rows.slice(r0, lastRow + 1);
  const width = Math.max(0, lastCol - c0 + 1);

  if (render === "cells") {
    return {
      cols: sheet.cols.slice(c0, lastCol + 1).map((col) => col.id),
      rows: rows.map((row) => rowJson({ id: row.id, cells: row.cells.slice(c0, c0 + width) })),
    };
  }

  const pick = render === "formulas"
    ? (cell) => (cell && !cell.hidden && cell.f !== undefined ? cell.f : cellValue(cell))
    : cellValue;
  return {
    values: rows.map((row) => Array.from({ length: width }, (_, i) => pick(row.cells[c0 + i] ?? null))),
  };
}
