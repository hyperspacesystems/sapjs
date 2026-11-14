import { QueryRefused } from "../../src/grid/codec/read.js";
import { MAX_COLS, colName, colIndex, parseRef, parseArea } from "../../src/grid/a1.js";

global.__SAP_KEEP_CONSOLE__ = true;

const refused = (fn) => {
  let err = null;
  try {
    fn();
  } catch (thrown) {
    err = thrown;
  }
  expect(err).toBeInstanceOf(QueryRefused);
  expect(err.code).toBe("bad_range");
};

const PAIRS = [
  [0, "A"],
  [25, "Z"],
  [26, "AA"],
  [701, "ZZ"],
  [702, "AAA"],
  [16383, "XFD"],
];

test("column names", () => {
  expect(MAX_COLS).toBe(16384);
  for (const [index, name] of PAIRS) {
    expect(colName(index)).toBe(name);
    expect(colIndex(name)).toBe(index);
  }
  for (let index = 0; index < MAX_COLS; index++) {
    const name = colName(index);
    expect(colIndex(name)).toBe(index);
    expect(colName(colIndex(name))).toBe(name);
  }
  expect(colIndex("")).toBe(-1);
  expect(colIndex("a")).toBe(-1);
  expect(colIndex("XFE")).toBe(-1);
  expect(colIndex("AAAA")).toBe(-1);
  expect(colIndex("A1")).toBe(-1);
});

test("references", () => {
  expect(parseRef("A1")).toEqual({ row: 0, col: 0 });
  expect(parseRef("B2")).toEqual({ row: 1, col: 1 });
  expect(parseRef("Z9")).toEqual({ row: 8, col: 25 });
  expect(parseRef("AA10")).toEqual({ row: 9, col: 26 });
  expect(parseRef("XFD1048576")).toEqual({ row: 1048575, col: 16383 });

  for (const bad of ["a1", "$A$1", "$B2", "Sheet1!A1", "A 1", " A1", "A1 ", "A1:B2", "A1:A1", "0", "A0", "1A", "XFE1", "AAAA1", ""]) {
    refused(() => parseRef(bad));
  }
  refused(() => parseRef(7));
  refused(() => parseRef(null));
});

test("areas", () => {
  expect(parseArea("B2")).toEqual({ r0: 1, c0: 1, r1: 1, c1: 1 });
  expect(parseArea("A1:C9")).toEqual({ r0: 0, c0: 0, r1: 8, c1: 2 });
  expect(parseArea("XFD1:XFD9")).toEqual({ r0: 0, c0: 16383, r1: 8, c1: 16383 });
  expect(parseArea("B:D")).toEqual({ r0: null, c0: 1, r1: null, c1: 3 });
  expect(parseArea("C:C")).toEqual({ r0: null, c0: 2, r1: null, c1: 2 });
  expect(parseArea("2:5")).toEqual({ r0: 1, c0: null, r1: 4, c1: null });
  expect(parseArea("7:7")).toEqual({ r0: 6, c0: null, r1: 6, c1: null });

  for (const bad of ["b2", "a1:b2", "$A$1", "$A$1:$B$2", "Sheet1!A1", "Sheet1!A1:B2", "A 1", "A1: B2", "D:B", "5:2", "A:5", "5:A", "A1:B", "A1:5", "0:5", "A0", "A0:A1", "XFE1", "A:XFE", "XFE:XFE", "AAAA", ":", "A:", ":A", "", "A1:", ":A1"]) {
    refused(() => parseArea(bad));
  }
  refused(() => parseArea(3));
  refused(() => parseArea(null));
});
