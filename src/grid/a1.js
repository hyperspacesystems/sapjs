// Column letters and A1 references. The cell and rectangle forms go through the
// codec's parseRange so the two never disagree about what a cell is.

import { parseRange, QueryRefused } from "./codec/read.js";

export const MAX_COLS = 16384;

const CELL = /^[A-Z]{1,3}[1-9][0-9]{0,6}$/;
const CELLS = /^[A-Z]{1,3}[1-9][0-9]{0,6}:[A-Z]{1,3}[1-9][0-9]{0,6}$/;
const LETTERS = /^[A-Z]{1,3}$/;
const COLUMNS = /^([A-Z]{1,3}):([A-Z]{1,3})$/;
const ROWS = /^([1-9][0-9]{0,6}):([1-9][0-9]{0,6})$/;

const refuse = (area) => {
  throw new QueryRefused("bad_range", `${JSON.stringify(area)} is not an A1 cell, rectangle, whole column or whole row such as B2, A1:C9, B:D or 2:5`);
};

export function colName(index) {
  let rest = index + 1;
  let name = "";
  while (rest > 0) {
    const letter = (rest - 1) % 26;
    name = String.fromCharCode(65 + letter) + name;
    rest = Math.floor((rest - 1) / 26);
  }
  return name;
}

export function colIndex(name) {
  if (typeof name !== "string" || !LETTERS.test(name)) return -1;
  let n = 0;
  for (const letter of name) n = n * 26 + (letter.charCodeAt(0) - 64);
  return n > MAX_COLS ? -1 : n - 1;
}

export function parseRef(ref) {
  if (typeof ref !== "string" || ref.includes(":")) refuse(ref);
  const { r0, c0 } = parseRange(ref);
  return { row: r0, col: c0 };
}

export function parseArea(area) {
  if (typeof area !== "string") refuse(area);
  if (CELL.test(area) || CELLS.test(area)) return parseRange(area);

  const columns = COLUMNS.exec(area);
  if (columns) {
    const c0 = colIndex(columns[1]);
    const c1 = colIndex(columns[2]);
    if (c0 === -1 || c1 === -1 || c1 < c0) refuse(area);
    return { r0: null, c0, r1: null, c1 };
  }

  const rows = ROWS.exec(area);
  if (rows) {
    const r0 = Number(rows[1]) - 1;
    const r1 = Number(rows[2]) - 1;
    if (r1 < r0) refuse(area);
    return { r0, c0: null, r1, c1: null };
  }

  return refuse(area);
}
