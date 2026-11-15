// The tables the builders' tests build on, and the walk every built action takes: applied on the
// store it was built from, read back by the strict reader, checked, and undone.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { sheet } from "./sheets.js";
import { modelBacking } from "../../../src/grid/backing-model.js";
import { checkSheet } from "../../../src/grid/check.js";
import { gridModel, QueryRefused } from "../../../src/grid/codec/read.js";
import { tableHtml } from "../../../src/grid/codec/write.js";
import { derive } from "../../../src/grid/content.js";
import { normalizeSheet } from "../../../src/grid/normalize.js";
import { apply, GridRefused } from "../../../src/grid/ops.js";

const golden = (name) => readFileSync(join(__dirname, "..", "..", "grid-codec", "golden", `${name}.html`), "utf8");
const tiny = golden("tiny");
const second = tiny.indexOf("<table grid", tiny.indexOf("</table>"));

// tiny's two tables. Budget: 3 columns and 6 rows, a frozen first row and first column, formulas,
// and a 3 wide merge on the last row. Trips: 2 columns and 2 rows, with cells that have their own
// format.
export const budget = (sheetId = "s1") => modelBacking(gridModel(tiny, 0), { sheetId });
export const trips = () => modelBacking(gridModel(tiny, second), { sheetId: "s2" });

// merged's table after the declared repair: a 3 wide merge on row 1, a 2 tall merge at A2 and a
// 2 wide merge on row 4.
export const merged = () => modelBacking(normalizeSheet(gridModel(golden("merged"), 0), { derive }).sheet, { sheetId: "m" });

// Rows 2 to 4 share one order key, and so do columns B to D.
export const tied = () =>
  modelBacking(
    sheet({
      cols: [["ca", "G"], ["cb", "V"], ["cc", "V"], ["cd", "V"], ["ce", "l"]],
      rows: [["r1", "8", ["a1", "b1", "c1", "d1", "e1"]], ["r2", "V", ["a2"]], ["r3", "V", ["a3"]], ["r4", "V", ["a4"]], ["r5", "l", ["a5"]]],
    }),
    { sheetId: "t" },
  );

// A newId that gives the listed ids in turn.
export const ids = (...list) => {
  let next = 0;
  return () => list[next++];
};

// A newId that never runs out: g0, g1, g2.
export const counter = () => {
  let next = 0;
  return () => `g${next++}`;
};

export const refusal = (run) => {
  try {
    run();
  } catch (err) {
    return err instanceof GridRefused || err instanceof QueryRefused ? err.code : `${err.name}: ${err.message}`;
  }
  return "no refusal";
};

const idsOf = (records) => records.map((record) => record.id).join(" ");

// Applies a built action on the store it was built from. The bytes pass the strict reader and the
// check, and the inverse brings the starting bytes back (a table that took a formula stays marked
// stale). Returns what the action left: the lines the starting bytes did not have, the row and
// column ids in order, and the frozen counts.
export function walk(store, action, options) {
  const before = tableHtml(store.sheet);
  const out = apply(store, action, { derive, ...options });
  expect([out.out, out.code]).toEqual(["applied", undefined]);
  const after = tableHtml(store.sheet);
  expect(gridModel(after, 0)).toEqual(store.sheet);
  expect(checkSheet(store.sheet)).toEqual([]);
  const had = new Set(before.split("\n"));
  const left = { lines: after.split("\n").filter((line) => !had.has(line)), rows: idsOf(store.rows()), cols: idsOf(store.cols()), frozen: store.frozen() };
  expect(apply(store, out.inverse, { derive, ...options }).out).toBe("applied");
  expect(tableHtml(store.sheet).replace(" stale>", ">")).toBe(before);
  return left;
}
