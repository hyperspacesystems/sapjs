import { scanGrid, CodecMiss } from "../../../src/grid/codec/scan.js";

// Returns { verdict: "miss" } or { verdict: "accept", end, table, cols, rows: [{ row, bytes }] }.
export function scanAt(src, at = src.indexOf("<table")) {
  const out = { verdict: "accept", table: null, cols: [], rows: [] };
  try {
    out.end = scanGrid(src, at, {
      table: (table) => { out.table = table; },
      col: (col) => out.cols.push(col),
      row: (row, start, end) => out.rows.push({ row, bytes: src.slice(start, end) }),
    });
  } catch (error) {
    if (error instanceof CodecMiss) return { verdict: "miss", reason: error.message };
    throw error;
  }
  return out;
}
