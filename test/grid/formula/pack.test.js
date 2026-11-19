// The extended functions, read the way Sheets reads them: in a range only numbers count (blanks,
// text and TRUE are skipped, later NPV periods do not shift) and an error stops the walk; a value
// written into the call is read as a number. The pack is added for these tests and removed after.
import { createEngine } from "../../../src/grid/formula/engine.js";
import { addFunctions } from "../../../src/grid/formula/functions.js";
import { PACK } from "../../../src/grid/formula/pack.js";
import { modelWorkbook } from "../../../src/grid/workbook-backing.js";

global.__SAP_KEEP_CONSOLE__ = true;

// The data every case reads:
//   A1:A6  10, 20, "x", (blank), TRUE, 30
//   C1:C6  1, 2, 3, 4, 5, 6
//   D1     #DIV/0! (a formula), D2 0
//   E1:E8  2, 4, 4, 4, 5, 5, 7, 9
//   F1:F3  100, (blank), 200
//   G1:G2  -100, 110
//   H1:H4  -1000, 0, 0, 200
//   I1:I4  0.1, 0.1, 0.1, 0.3
//   J1:J2  -1000, 500
const n = (value) => ({ text: String(value), n: true });
const DATA = {
  "0,0": n(10), "1,0": n(20), "2,0": { text: "x" }, "4,0": { text: "TRUE" }, "5,0": n(30),
  "0,2": n(1), "1,2": n(2), "2,2": n(3), "3,2": n(4), "4,2": n(5), "5,2": n(6),
  "0,3": { text: "", f: "=1/0" }, "1,3": n(0),
  "0,4": n(2), "1,4": n(4), "2,4": n(4), "3,4": n(4), "4,4": n(5), "5,4": n(5), "6,4": n(7), "7,4": n(9),
  "0,5": n(100), "2,5": n(200),
  "0,6": n(-100), "1,6": n(110),
  "0,7": n(-1000), "1,7": n(0), "2,7": n(0), "3,7": n(200),
  "0,8": n(0.1), "1,8": n(0.1), "2,8": n(0.1), "3,8": n(0.3),
  "0,9": n(-1000), "1,9": n(500),
};
const FIRST = 10;

// [formula, expected]: a number matches to 7 significant digits (0 exactly, since a cell shows
// 3E-17 where Sheets shows 0), an error is its code.
const CASES = [
  ["=STDEV(E1:E8)", Math.sqrt(32 / 7)],
  ["=STDEV.S(E1:E8)", Math.sqrt(32 / 7)],
  ["=STDEVP(E1:E8)", 2],
  ["=STDEV.P(E1:E8)", 2],
  ["=VAR(E1:E8)", 32 / 7],
  ["=VARP(E1:E8)", 4],
  ["=STDEV(A1:A6)", 10],
  ["=STDEV(10)", "#DIV/0!"],
  ["=STDEVP(10)", 0],
  ["=STDEV(C1:C3,D1)", "#DIV/0!"],
  ['=STDEV("x",1,2)', "#VALUE!"],
  ["=MODE(E1:E8)", 4],
  ["=MODE(C1:C6)", "#N/A"],
  ["=LARGE(C1:C6,2)", 5],
  ["=SMALL(A1:A6,1)", 10],
  ["=LARGE(C1:C6,0)", "#NUM!"],
  ["=SMALL(C1:C6,7)", "#NUM!"],
  ["=PERCENTILE(C1:C6,0.5)", 3.5],
  ["=PERCENTILE(A1:A6,0.5)", 20],
  ["=PERCENTILE.INC(C1:C6,1)", 6],
  ["=PERCENTILE(C1:C6,1.5)", "#NUM!"],
  ["=QUARTILE(C1:C6,0)", 1],
  ["=QUARTILE(C1:C6,1)", 2.25],
  ["=QUARTILE(C1:C6,4)", 6],
  ["=QUARTILE(C1:C6,1.9)", 2.25],
  ["=QUARTILE(C1:C6,5)", "#NUM!"],
  ["=RANK(5,C1:C6)", 2],
  ["=RANK(5,C1:C6,1)", 5],
  ["=RANK(5,C1:C6,D2)", 2],
  ["=RANK(7,C1:C6)", "#N/A"],
  ["=RANK.EQ(4,E1:E8)", 5],
  ["=CORREL(C1:C3,C4:C6)", 1],
  ["=CORREL(A1:A3,C1:C3)", 1],
  ["=CORREL(C1:C3,C1:C2)", "#N/A"],
  ["=CORREL(C1,C2)", "#DIV/0!"],
  ["=CORREL(C1:C2,D1:D2)", "#DIV/0!"],
  ["=PMT(5%/12,360,200000)", -1073.6432460242797],
  ["=PMT(0,10,1000)", -100],
  ["=PMT(5%,10)", "#N/A"],
  ["=FV(5%/12,60,-100)", 6800.61],
  ["=FV(5%/12,60,-100,F2)", 6800.61],
  ["=PV(5%/12,360,-1073.6432460242797)", 200000],
  ["=NPER(5%/12,-1073.6432460242797,200000)", 360],
  ["=NPV(10%,F1:F3)", 100 / 1.1 + 200 / 1.21],
  ["=NPV(10%,100,200)", 100 / 1.1 + 200 / 1.21],
  ["=NPV(-1,F1:F3)", "#DIV/0!"],
  ["=IRR(G1:G2)", 0.1],
  ["=IRR(C1:C6)", "#NUM!"],
  ["=RATE(360,-1073.6432460242797,200000)", 0.05 / 12],
  ["=RATE(12,-100,1000)", 0.0292285407691337],
  ["=RATE(36,-500,18000)", 0],
  ["=RATE(36,-500,17990)", 0.0000300414582125],
  ["=IRR(J1:J2)", -0.5],
  ["=IRR(H1:H4)", Math.cbrt(0.2) - 1],
  ["=STDEV(I1:I3)", 0],
  ["=CORREL(I1:I3,C1:C3)", "#DIV/0!"],
  ["=MODE(0.1+0.2,0.3,1)", 0.3],
  ["=RANK(0.1+0.2,I1:I4)", 1],
];

let remove;
beforeAll(() => {
  remove = addFunctions(PACK);
});
afterAll(() => remove());

test("each extended function gives what Google Sheets gives", () => {
  const cells = { ...DATA };
  CASES.forEach(([f], i) => {
    cells[`9,${FIRST + i}`] = { text: "", f };
  });
  const width = FIRST + CASES.length;
  const sheet = {
    cols: Array.from({ length: width }, (_, c) => ({ id: `c${c}`, pos: `a${String(c).padStart(3, "0")}` })),
    rows: Array.from({ length: 12 }, (_, r) => ({ id: `r${r}`, pos: `a${String(r).padStart(3, "0")}`, cells: [] })),
  };
  for (const [at, cell] of Object.entries(cells)) {
    const [r, c] = at.split(",").map(Number);
    const row = sheet.rows[r];
    while (row.cells.length < c) row.cells.push(null);
    row.cells[c] = cell;
  }
  const engine = createEngine(modelWorkbook([{ id: "s", name: "Data", pos: "A", sheet }]));
  engine.load();
  const got = CASES.map(([f, want], i) => {
    const value = engine.result("s", "r9", `c${FIRST + i}`);
    const shown = value !== null && typeof value === "object" ? value.error : value;
    const close = typeof want === "number" && typeof shown === "number" && (want === 0 ? shown === 0 : Math.abs(shown - want) < 5e-7 * Math.abs(want));
    return [f, close ? want : shown];
  });
  expect(got).toEqual(CASES);
});


// Bug this guards: IRR of a 30-year monthly loan was #NUM!, because Newton's first step from 10%
// overshoots below -100% on a long series. Sheets gives 5%/12.
test("IRR and RATE solve long monthly series", () => {
  const payment = 1073.64324602428;
  const rows = 361;
  const sheet = {
    cols: [{ id: "c0", pos: "a" }, { id: "c1", pos: "b" }],
    rows: Array.from({ length: rows }, (_, r) => ({ id: `r${r}`, pos: `a${String(r).padStart(4, "0")}`, cells: [{ text: String(r === 0 ? -200000 : payment), n: true }] })),
  };
  sheet.rows[0].cells.push({ text: "", f: "=IRR(A1:A361)" });
  sheet.rows[1].cells.push({ text: "", f: "=RATE(360,-1073.6432460242797,200000,0,0,2)" });
  const engine = createEngine(modelWorkbook([{ id: "s", name: "Data", pos: "A", sheet }]));
  engine.load();
  const got = [engine.result("s", "r0", "c1"), engine.result("s", "r1", "c1")].map((x) => (typeof x === "number" ? Number((x * 12).toFixed(9)) : x));
  expect(got).toEqual([0.05, 0.05]);
});
