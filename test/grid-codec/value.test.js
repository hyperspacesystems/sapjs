import { typed, shown, cellValue } from "../../src/grid/codec/value.js";
import { serial } from "./support/fixtures.js";
import { CELLS, SHOWN } from "./support/value-cases.js";

test.each(CELLS)("cellValue: %s", (name, cell, expected) => {
  expect(cellValue(cell)).toBe(expected);
});

test.each(SHOWN)("shown(%p) is %p", (value, expected) => {
  expect(shown(value)).toBe(expected);
});

test("shown refuses infinity and NaN", () => {
  expect(() => shown(Infinity)).toThrow();
  expect(() => shown(-Infinity)).toThrow();
  expect(() => shown(NaN)).toThrow();
});

test("the fixture serial for 2026-03-14 is 46095", () => {
  expect(serial("2026-03-14")).toBe(46095);
});
