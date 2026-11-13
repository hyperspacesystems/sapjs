import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scanAt } from "./support/scan-helpers.js";
import { MISSES } from "./support/hostile-cases.js";
import { CELLS } from "./support/value-cases.js";
import { cellValue, shown, typed } from "../../src/grid/codec/value.js";
import { patchGrid } from "../../src/grid/codec/patch.js";
import { keyBetween, keysBetween } from "../../src/grid/codec/order-keys.js";

const VECTORS = JSON.parse(readFileSync(join(__dirname, "golden", "host-vectors.json"), "utf8"));

test("every scan case in host-vectors.json matches the reader", () => {
  for (const entry of VECTORS.scan) {
    const out = scanAt(entry.src, 0);
    if (entry.verdict === "miss") {
      expect([entry.name, out.verdict]).toEqual([entry.name, "miss"]);
      continue;
    }
    expect([entry.name, out.verdict]).toEqual([entry.name, "accept"]);
    expect({ table: out.table, cols: out.cols, rows: out.rows }).toEqual({ table: entry.table, cols: entry.cols, rows: entry.rows });
  }
  expect(VECTORS.scan.filter((entry) => entry.name.startsWith("hostile ")).length).toBe(MISSES.length);
  expect(VECTORS.scan.filter((entry) => entry.verdict === "accept").length).toBeGreaterThan(50);
});

test("the value cases in host-vectors.json match the value rule", () => {
  expect(VECTORS.values.cells.length).toBe(CELLS.length);
  for (const [, cell, expected] of VECTORS.values.cells) expect(cellValue(cell)).toBe(expected);
  for (const [value, text] of VECTORS.values.shown) expect(shown(value)).toBe(text);
  for (const [value, text, back] of VECTORS.values.numbers) {
    expect(shown(value)).toBe(text);
    expect(typed(text)).toBe(back);
  }
});

test("the patch and order key cases in host-vectors.json match the code", () => {
  for (const entry of VECTORS.patches) {
    let next = 0;
    let got;
    try {
      const { bytes, changed } = patchGrid(entry.src, entry.ops, { newId: () => `n${++next}` });
      got = { bytes, changed };
    } catch (error) {
      got = { error: { type: error.name, code: error.code ?? null, message: error.message } };
    }
    expect([entry.name, got]).toEqual([entry.name, entry.error ? { error: entry.error } : { bytes: entry.bytes, changed: entry.changed }]);
  }
  expect(VECTORS.patches.filter((entry) => entry.error).length).toBeGreaterThan(10);
  expect(VECTORS.patches.some((entry) => entry.error?.type === "CodecMiss")).toBe(true);
  for (const [a, b, key] of VECTORS.keys.between) expect(keyBetween(a, b)).toBe(key);
  for (const [a, b, n, keys] of VECTORS.keys.spread) expect(keysBetween(a, b, n)).toEqual(keys);
});
