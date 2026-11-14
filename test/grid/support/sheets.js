// Small sheet models for the check's tests: cols are ids (or [id, pos] pairs),
// rows are [id, pos, cells], and a cell is text, null, a cell object or H.

import { keysBetween } from "../../../src/grid/codec/order-keys.js";

export const H = { text: "", hidden: true };

const cellOf = (cell) => (typeof cell === "string" ? { text: cell } : cell);

export function sheet({ cols = [], rows = [], freezeCols } = {}) {
  const positions = keysBetween(null, null, cols.length);
  const model = {
    cols: cols.map((col, i) => {
      const [id, pos] = Array.isArray(col) ? col : [col, positions[i]];
      return { id, pos };
    }),
    rows: rows.map(([id, pos, cells = []]) => ({ id, pos, cells: cells.map(cellOf) })),
  };
  if (freezeCols !== undefined) model.freezeCols = freezeCols;
  return model;
}

// A sheet with no problem: 3 columns, 4 rows, one 2x2 merge, a frozen first row.
export function clean() {
  const model = sheet({
    cols: ["c0", "c1", "c2"],
    rows: [
      ["r0", "8", ["Name", "Qty", "Note"]],
      ["r1", "G", [{ text: "Box", colspan: 2, rowspan: 2 }, H, "A"]],
      ["r2", "V", [H, H, "B"]],
      ["r3", "l", [{ text: "x" }]],
    ],
  });
  model.rows[0].frozen = true;
  return model;
}
