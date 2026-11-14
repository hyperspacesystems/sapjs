import { H, sheet } from "./sheets.js";
import { derive } from "../../../src/grid/content.js";
import { normalizeSheet } from "../../../src/grid/normalize.js";
import { modelBacking } from "../../../src/grid/backing-model.js";
import { tableHtml } from "../../../src/grid/codec/write.js";

export const S = "items";

// 4 columns, 5 rows: one #,##0 column, one 2x1 merge, one styled cell, one cell with its own fmt
// and one formula cell that holds a result. `box` adds a 2x2 merge at r4/cc, `freezeCols` freezes
// the first columns.
export function fixture({ formula = true, merge = true, frozen = 0, rowspan = false, rowStyles = {}, box = false, freezeCols = 0 } = {}) {
  const rows = [
    ["r1", "8", ["Name", "Qty", "Note", "Flag"]],
    ["r2", "G", [{ text: "Total", colspan: 2 }, H, { text: "7", n: true }, null]],
    ["r3", "O", ["a", { text: "5", n: true }, { text: "plain", fmt: "0%" }, null]],
    ["r4", "V", [{ text: "Bold", style: "font-weight:bold;color:#333333" }, { text: "1,200", n: true, v: "1200" }, null, "TRUE"]],
    ["r5", "l", ["Form", { text: "1,205", f: "=SUM(B3:B4)", n: true, v: "1205" }, null, null]],
  ];
  if (!merge) rows[1][2] = ["Total", null, { text: "7", n: true }, null];
  if (!formula) rows[4][2][1] = { text: "1,205", n: true, v: "1205" };
  if (rowspan) {
    rows[2][2][0] = { text: "a", rowspan: 2 };
    rows[3][2][0] = H;
  }
  if (box) {
    rows[3][2][2] = { text: "Box", colspan: 2, rowspan: 2 };
    rows[3][2][3] = H;
    rows[4][2][2] = H;
    rows[4][2][3] = H;
  }
  const model = sheet({
    cols: [["ca", "8"], ["cb", "G"], ["cc", "O"], ["cd", "V"]],
    rows,
  });
  model.cols[1].fmt = "#,##0";
  for (const [id, style] of Object.entries(rowStyles)) model.rows.find((row) => row.id === id).style = style;
  for (let i = 0; i < frozen; i++) model.rows[i].frozen = true;
  if (freezeCols) model.freezeCols = freezeCols;
  return normalizeSheet(model, { derive }).sheet;
}

export const backing = (options) => modelBacking(fixture(options), { sheetId: S });

export const bytesOf = (store) => tableHtml(store.sheet);

export const startTag = (bytes) => bytes.slice(0, bytes.indexOf(">") + 1);

export const rowLine = (bytes, id) => bytes.split("\n").find((line) => line.includes(`data-id="${id}"`));

export const unstale = (bytes) => bytes.replace("<table grid stale>", "<table grid>");

// The cells a merge clears, read from the store it runs on: pairs of ids in row order, then column
// order, other than the anchor, that hold content, fmt or style.
export const clearsOf = (store, from, to) => {
  const rows = store.rows();
  const cols = store.cols();
  const top = Math.min(store.rowIndex(from[0]), store.rowIndex(to[0]));
  const bottom = Math.max(store.rowIndex(from[0]), store.rowIndex(to[0]));
  const left = Math.min(store.colIndex(from[1]), store.colIndex(to[1]));
  const right = Math.max(store.colIndex(from[1]), store.colIndex(to[1]));
  const out = [];
  for (let r = top; r <= bottom; r++) {
    for (let c = left; c <= right; c++) {
      if (r === top && c === left) continue;
      const cell = store.cell(r, c);
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
};

// A pinned merge names the cells it clears; the pin reads them from the store it runs on.
export const withClears = (store, one) => {
  if (one === null || typeof one !== "object" || one.t !== "merge" || one.clears !== undefined) return one;
  return { ...one, clears: clearsOf(store, one.from, one.to) };
};

// An empty cell with no format is never kept: one that is holding an empty text alone is a bug.
export const keptEmpty = (model) => {
  const found = [];
  model.rows.forEach((row) => {
    row.cells.forEach((cell, c) => {
      if (cell && !cell.hidden && Object.keys(cell).length === 1 && cell.text === "") found.push(`${row.id}/${model.cols[c].id}`);
    });
  });
  return found;
};
