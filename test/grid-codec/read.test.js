import { FIXTURES } from "./support/fixtures.js";
import { tableHtml } from "../../src/grid/codec/write.js";
import { cellValue } from "../../src/grid/codec/value.js";
import {
  gridModel,
  cellJson,
  tabJson,
  tabIndex,
  parseRange,
  readRange,
  QueryRefused,
} from "../../src/grid/codec/read.js";

global.__SAP_KEEP_CONSOLE__ = true;

const budget = () => gridModel(tableHtml(FIXTURES.tiny().sheets[0]), 0);
const trips = () => gridModel(tableHtml(FIXTURES.tiny().sheets[1]), 0);

const BUDGET_TAB = {
  cols: ["ca", "cb", "cc"],
  rows: [
    { id: "r1", cells: [{ v: "Item", style: "font-weight:bold" }, "Cost", "Share"] },
    { id: "r2", cells: ["Rent", { v: 1200, text: "$1,200.00" }, { f: "=B2/B$5", v: 0.8, text: "80%" }] },
    { id: "r3", cells: ["Food", { v: 300, text: "$300.00" }, { f: "=B3/B$5", v: 0.2, text: "20%" }] },
    { id: "r4", cells: [] },
    { id: "r5", cells: [{ v: "Total", style: "font-weight:bold" }, { f: "=SUM(B2:B3)", v: 1500, text: "$1,500.00" }] },
    { id: "r6", cells: [{ v: "Prices as of November", style: "text-align:center", colspan: 3 }] },
  ],
};

const letter = (n) => {
  let text = "";
  while (n > 0) {
    const rest = (n - 1) % 26;
    text = String.fromCharCode(65 + rest) + text;
    n = Math.floor((n - 1) / 26);
  }
  return text;
};

const refusal = (fn) => {
  try {
    fn();
  } catch (error) {
    return error instanceof QueryRefused ? error.code : `plain ${error.constructor.name}`;
  }
  return "no error";
};

test("tabJson gives the tab shape of a whole read", () => {
  expect(tabJson(budget())).toEqual(BUDGET_TAB);
  expect(JSON.stringify(tabJson(budget()))).toBe(JSON.stringify(BUDGET_TAB));
});

test("tabIndex gives rows, cols and frozen rows", () => {
  expect(tabIndex(budget())).toEqual({ rows: 6, cols: 3, frozenRows: 1 });
  expect(tabIndex(trips())).toEqual({ rows: 2, cols: 2, frozenRows: 0 });
});

test("readRange gives values by default", () => {
  expect(readRange(budget(), "A1:C3")).toEqual({
    values: [
      ["Item", "Cost", "Share"],
      ["Rent", 1200, 0.8],
      ["Food", 300, 0.2],
    ],
  });
});

test("readRange render formulas gives formulas where a cell has one", () => {
  expect(readRange(budget(), "A1:C3", "formulas")).toEqual({
    values: [
      ["Item", "Cost", "Share"],
      ["Rent", 1200, "=B2/B$5"],
      ["Food", 300, "=B3/B$5"],
    ],
  });
});

test("readRange render cells gives the tab shape of the rectangle", () => {
  expect(readRange(budget(), "A1:C3", "cells")).toEqual({
    cols: ["ca", "cb", "cc"],
    rows: [
      { id: "r1", cells: [{ v: "Item", style: "font-weight:bold" }, "Cost", "Share"] },
      { id: "r2", cells: ["Rent", { v: 1200, text: "$1,200.00" }, { f: "=B2/B$5", v: 0.8, text: "80%" }] },
      { id: "r3", cells: ["Food", { v: 300, text: "$300.00" }, { f: "=B3/B$5", v: 0.2, text: "20%" }] },
    ],
  });
});

test("readRange clips to the sheet and pads covered cells with null", () => {
  expect(readRange(budget(), "B2")).toEqual({ values: [[1200]] });
  expect(readRange(budget(), "B5:Z9")).toEqual({ values: [[1500, null], [null, null]] });
  expect(readRange(budget(), "D1:E2")).toEqual({ values: [[], []] });
  expect(readRange(budget(), "A9:B9")).toEqual({ values: [] });
});

test("readRange gives a date as its serial", () => {
  expect(readRange(trips(), "B1")).toEqual({ values: [[46095]] });
});

test("parseRange refuses every other form of range", () => {
  const refused = [
    "a1",
    "A0",
    "C3:A1",
    "A1:B2:C3",
    "XFE1",
    "",
    "A1:",
    " A1",
    "A01",
    "A12345678",
    "Sheet1!A1",
    5,
  ];
  for (const range of refused) {
    expect([range, refusal(() => parseRange(range))]).toEqual([range, "bad_range"]);
  }
  expect(parseRange("XFD1048576")).toEqual({ r0: 1048575, c0: 16383, r1: 1048575, c1: 16383 });
  expect(refusal(() => readRange(budget(), "A1", "bogus"))).toBe("bad_render");
});

test("cellJson writes the tab shape of one cell", () => {
  expect(cellJson(null)).toBe(null);
  expect(cellJson({ text: "", hidden: true })).toBe(null);
  expect(cellJson({ text: "02134", t: true })).toBe("02134");
  expect(cellJson({ text: "123", t: true })).toBe("123");
  expect(cellJson({ text: "7", n: true })).toBe(7);
  expect(cellJson({ text: "", fmt: "0%" })).toEqual({ v: null, fmt: "0%" });
  expect(cellJson({ text: "TRUE", f: "=A1>1" })).toEqual({ f: "=A1>1", v: true });
});

test("the byte route reads every fixture cell as the model says", () => {
  let compared = 0;

  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const sheet of fixture().sheets) {
      const model = gridModel(tableHtml(sheet), 0);
      const rows = Math.max(1, model.rows.length);
      const cols = Math.max(1, model.cols.length);
      const lastCell = `${letter(cols)}${rows}`;
      const expected = model.rows.map((row) =>
        Array.from({ length: model.cols.length }, (_, c) => cellValue(row.cells[c] ?? null)),
      );

      expect([name, readRange(model, `A1:${lastCell}`, "values")]).toEqual([name, { values: expected }]);
      compared += model.rows.length * model.cols.length;
    }
  }

  console.log(`read.test.js compared ${compared} cells`);
  expect(compared).toBeGreaterThan(100000);
}, 120000);

test("the whole read of wide-100k is fast", () => {
  let best = Infinity;

  for (let run = 0; run < 3; run++) {
    const start = Date.now();
    for (const sheet of FIXTURES["wide-100k"]().sheets) tabJson(gridModel(tableHtml(sheet), 0));
    best = Math.min(best, Date.now() - start);
  }

  console.log(`read.test.js wide-100k whole read: ${best} ms`);
  expect(best).toBeLessThan(500);
}, 120000);
