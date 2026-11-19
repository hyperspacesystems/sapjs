import { apply, applyWorkbook } from "../../../src/grid/index.js";
import { buildDeleteRows, buildInsertRows, buildSet } from "../../../src/grid/build.js";
import { createEngine } from "../../../src/grid/formula/engine.js";
import { modelWorkbook } from "../../../src/grid/workbook-backing.js";

global.__SAP_KEEP_CONSOLE__ = true;

const KEYS = "ABCDEFGHIJ";
const number = (value) => ({ text: String(value), n: true });
const formula = (f) => ({ text: "", f });

// A codec model: rows and columns keyed in order, cells by "row,col" from the top left, a column's
// format by its index.
function sheetOf(prefix, rows, cols, cells = {}, fmts = {}) {
  const sheet = {
    cols: Array.from({ length: cols }, (_, c) => ({ id: `${prefix}c${c + 1}`, pos: KEYS[c], ...(fmts[c] === undefined ? {} : { fmt: fmts[c] }) })),
    rows: Array.from({ length: rows }, (_, r) => ({ id: `${prefix}r${r + 1}`, pos: KEYS[r], cells: [] })),
  };
  for (const [at, cell] of Object.entries(cells)) {
    const [r, c] = at.split(",").map(Number);
    const row = sheet.rows[r];
    while (row.cells.length < c) row.cells.push(null);
    row.cells[c] = cell;
  }
  for (const row of sheet.rows) while (row.cells.length > 0 && row.cells[row.cells.length - 1] === null) row.cells.pop();
  return sheet;
}

const book = (...tabs) => modelWorkbook(tabs.map(([id, name, pos, sheet]) => ({ id, name, pos, sheet })));
const tabOf = (wb, id) => wb.sheets().find((tab) => tab.id === id);

const mint = () => {
  let n = 0;
  return (prefix) => `${prefix}m${n++}`;
};

// The engine's value at a cell, an error as its `{ error }`.
const at = (engine, sheet, row, col) => engine.result(sheet, row, col);

// A tab whose formulas read each other in a cycle, one of them itself, one of them only reading the
// cycle, and one reading that reader.
const cycle = () =>
  book([
    "s1",
    "Data",
    "A",
    sheetOf("s1", 5, 1, {
      "0,0": formula("=A1"),
      "1,0": formula("=A3"),
      "2,0": formula("=A2"),
      "3,0": formula("=A2"),
      "4,0": formula("=IFERROR(A4,7)"),
    }),
  ]);

// A formula that reads itself is not seen as a cycle, so it computes instead of showing #REF!.
test("a two-formula cycle and a formula that reads itself get #REF! with reason circular", () => {
  const engine = createEngine(cycle());
  engine.load();
  const circular = { error: "#REF!", reason: "circular" };
  expect([at(engine, "s1", "s1r1", "s1c1"), at(engine, "s1", "s1r2", "s1c1"), at(engine, "s1", "s1r3", "s1c1")]).toEqual([circular, circular, circular]);
});

// An error read from another cell keeps the reason its own cell shows, so a reader of a cycle
// shows the cycle's reason.
test("a formula that only reads a cycle shows the #REF! it reads, with no reason", () => {
  const engine = createEngine(cycle());
  engine.load();
  expect(at(engine, "s1", "s1r4", "s1c1")).toEqual({ error: "#REF!" });
});

// A dirty set marked circular as a whole (as peeling leaves it) makes a formula that only reads a
// cycle, and the formula that reads it, #REF! with a reason.
test("a formula that reads a cycle and is read by another is computed", () => {
  const engine = createEngine(cycle());
  engine.load();
  expect(at(engine, "s1", "s1r5", "s1c1")).toBe(7);
});

// A range's end past the edge bound to the last row of the moment, instead of the edge, leaves the
// rows an insert brings out of the total.
test("=SUM(A1:A20) on a 10-row tab covers the rows an insert brings and is computed after the insert", () => {
  const numbers = Object.fromEntries(Array.from({ length: 10 }, (_, r) => [`${r},0`, number(r + 1)]));
  const wb = book(["s1", "Budget", "A", sheetOf("s1", 10, 2, { ...numbers, "0,1": formula("=SUM(A1:A20)") })]);
  const engine = createEngine(wb);
  engine.load();
  expect(at(engine, "s1", "s1r1", "s1c2")).toBe(55);

  const newId = mint();
  expect(applyWorkbook(wb, buildInsertRows(tabOf(wb, "s1").backing, "11", 5, { newId }), { engine }).out).toBe("applied");
  expect(engine.computed).toBe(1);
  expect(at(engine, "s1", "s1r1", "s1c2")).toBe(55);

  expect(applyWorkbook(wb, buildSet(tabOf(wb, "s1").backing, "A11", 100), { engine }).out).toBe("applied");
  expect(engine.computed).toBe(1);
  expect(at(engine, "s1", "s1r1", "s1c2")).toBe(155);
});

// An unbound name is not read again after a tab action, so a formula naming a tab that now has
// that name keeps its #REF!.
test("a formula naming a tab no tab has computes once a tab is renamed to that name", () => {
  const wb = book(
    ["s1", "Budget", "A", sheetOf("s1", 2, 2, { "0,1": formula("=Plan!B1") })],
    ["s2", "Notes", "B", sheetOf("s2", 2, 2, { "0,1": number(7) })],
  );
  const engine = createEngine(wb);
  engine.load();
  expect(at(engine, "s1", "s1r1", "s1c2")).toEqual({ error: "#REF!" });
  expect(applyWorkbook(wb, { v: 1, t: "renameSheet", sheet: "s2", name: "Plan" }, { engine }).out).toBe("applied");
  expect(at(engine, "s1", "s1r1", "s1c2")).toBe(7);
});

// An error literal compiled as its text, so a reference to a deleted tab, printed as =#REF!, shows
// the text where the tab it named is gone.
test("a formula naming a deleted tab is #REF!", () => {
  const wb = book(
    ["s1", "Budget", "A", sheetOf("s1", 2, 2, { "0,1": formula("=Notes!B1") })],
    ["s2", "Notes", "B", sheetOf("s2", 2, 2, { "0,1": number(7) })],
  );
  const engine = createEngine(wb);
  engine.load();
  expect(at(engine, "s1", "s1r1", "s1c2")).toBe(7);
  expect(applyWorkbook(wb, { v: 1, t: "deleteSheet", sheet: "s2" }, { engine }).out).toBe("applied");
  expect(at(engine, "s1", "s1r1", "s1c2")).toEqual({ error: "#REF!" });
});

// A ROW() formula is not seeded after a structural step, so it keeps the row it was in.
test("=ROW() follows its row after a row insert above it", () => {
  const wb = book(["s1", "Data", "A", sheetOf("s1", 4, 2, { "2,1": formula("=ROW()") })]);
  const engine = createEngine(wb);
  engine.load();
  expect(at(engine, "s1", "s1r3", "s1c2")).toBe(3);
  const newId = mint();
  expect(applyWorkbook(wb, buildInsertRows(tabOf(wb, "s1").backing, "1", 1, { newId }), { engine }).out).toBe("applied");
  expect(at(engine, "s1", "s1r3", "s1c2")).toBe(4);
});

// A writer's extras that ignore the column's format save the plain number under a format that
// shows two decimals.
test("extras gives a result's text under its column's format", () => {
  const wb = book(["s1", "Data", "A", sheetOf("s1", 2, 2, { "0,1": formula("=1+2") }, { 1: "0.00" })]);
  const engine = createEngine(wb);
  engine.load();
  expect(engine.result("s1", "s1r1", "s1c2")).toBe(3);
  expect(engine.extras("s1", "s1r1", "s1c2")).toEqual({ text: "3.00", v: "3", n: true, t: undefined });
});

// A load that clears every tab's stale mark hides a number nothing has formatted yet.
test("load clears stale on a tab with nothing waiting and leaves it on one with a plain number", () => {
  const ready = sheetOf("s1", 2, 1, { "0,0": formula("=1+1") });
  const waiting = sheetOf("s2", 2, 1, { "0,0": number(5) }, { 0: "jjj" });
  ready.stale = true;
  waiting.stale = true;
  const wb = book(["s1", "Ready", "A", ready], ["s2", "Waiting", "B", waiting]);
  const engine = createEngine(wb);
  engine.load();
  expect([tabOf(wb, "s1").backing.sheet.stale === true, tabOf(wb, "s2").backing.sheet.stale === true]).toEqual([false, true]);
  expect(at(engine, "s1", "s1r1", "s1c1")).toBe(2);
});

// A step that computes every formula it holds, not only what reads the changed cell.
test("computed after an edit counts only the formulas that read it", () => {
  const numbers = Object.fromEntries(Array.from({ length: 5 }, (_, r) => [`${r},0`, number(r + 1)]));
  const wb = book(["s1", "Data", "A", sheetOf("s1", 5, 3, { ...numbers, "0,1": formula("=SUM(A1:A5)"), "1,1": formula("=A3*2"), "2,1": formula("=99") })]);
  const engine = createEngine(wb);
  engine.load();
  expect(engine.computed).toBe(3);
  expect(applyWorkbook(wb, buildSet(tabOf(wb, "s1").backing, "A3", 20), { engine }).out).toBe("applied");
  expect(engine.computed).toBe(2);
  expect([at(engine, "s1", "s1r1", "s1c2"), at(engine, "s1", "s1r2", "s1c2"), at(engine, "s1", "s1r3", "s1c2")]).toEqual([32, 40, 99]);
});

// Bug: the engine keeps a reference bound to a deleted row when the formula's text did not change
// (a write that does not rewrite formulas, as a host's patch or an undo's restore leaves it), so the
// formula reads the dead row as #REF! instead of the cell its text names.
test("a formula whose row a plain write deleted reads the cell its text names", () => {
  const wb = book(["s1", "Sheet", "A", sheetOf("s1", 6, 2, { "4,0": number(5), "5,0": number(6), "0,1": formula("=A5") })]);
  const engine = createEngine(wb);
  engine.load();
  expect(at(engine, "s1", "s1r1", "s1c2")).toBe(5);
  const backing = tabOf(wb, "s1").backing;
  expect(apply(backing, buildDeleteRows(backing, "5:5"), { formulas: {} }).out).toBe("applied");
  engine.update({ sheets: [], cells: [], rows: [{ sheet: "s1", row: "s1r5", kind: "delete" }], cols: [], table: [], structure: true });
  expect(at(engine, "s1", "s1r1", "s1c2")).toBe(6);
});

// Bug: after a tab action the engine binds again only formulas with an end past the edge, so a
// formula still bound to a tab by its old name keeps reading it once the tab is renamed by a
// write that does not rewrite formulas (a host's patch).
test("a formula naming a tab by a name it no longer has is #REF! after a rename outside the workbook apply", () => {
  const wb = book(["s1", "Totals", "A", sheetOf("s1", 2, 2, { "1,1": number(7) })], ["s2", "Notes", "B", sheetOf("s2", 1, 1, { "0,0": formula("=Totals!B2") })]);
  const engine = createEngine(wb);
  engine.load();
  expect(at(engine, "s2", "s2r1", "s2c1")).toBe(7);
  wb.renameSheet("s1", "Budget");
  engine.update({ sheets: ["s1"], cells: [], rows: [], cols: [], table: [], structure: true });
  expect(at(engine, "s2", "s2r1", "s2c1")).toEqual({ error: "#REF!" });
});

// Bug: ROW and COLUMN compute again only when their own tab's rows move, so =ROW(Budget!B2) on
// another tab keeps 2 after a row is inserted above B2 on Budget.
test("=ROW(Budget!B2) on another tab follows a row insert on Budget", () => {
  const wb = book(["s1", "Budget", "A", sheetOf("s1", 3, 2)], ["s2", "Notes", "B", sheetOf("s2", 1, 1, { "0,0": formula("=ROW(Budget!B2)") })]);
  const engine = createEngine(wb);
  engine.load();
  expect(at(engine, "s2", "s2r1", "s2c1")).toBe(2);
  expect(applyWorkbook(wb, buildInsertRows(tabOf(wb, "s1").backing, "1", 1, { newId: mint() }), { engine }).out).toBe("applied");
  expect(at(engine, "s2", "s2r1", "s2c1")).toBe(3);
});

// Bug: the engine writes a result under a format no formatter knows yet as a plain number, so a
// saved "30.00 kg" turns into "30" when the page opens.
test("a result under a format no formatter knows keeps the text it was saved with", () => {
  const saved = { f: "=10+20", text: "30.00 kg", v: "30", n: true, fmt: "[kg]0.00" };
  const wb = book(["s1", "Sheet", "A", sheetOf("s1", 1, 1, { "0,0": saved })]);
  const engine = createEngine(wb);
  engine.load();
  const backing = tabOf(wb, "s1").backing;
  expect(backing.cell(0, 0).text).toBe("30.00 kg");
});

// Bug: a step that sets a formula to the text it already has (a paste of the same cell, a host's
// set) is skipped by the engine, though the write left the cell with no result, so it shows blank.
test("a set of a formula to the text it already has keeps its result in the cell", () => {
  const wb = book(["s1", "Sheet", "A", sheetOf("s1", 2, 1, { "0,0": number(4), "1,0": formula("=A1*2") })]);
  const engine = createEngine(wb);
  engine.load();
  const backing = tabOf(wb, "s1").backing;
  expect(applyWorkbook(wb, buildSet(backing, "A2", formula("=A1*2")), { engine }).out).toBe("applied");
  expect(backing.cell(1, 0).text).toBe("8");
});

// Bug: a range open at its bottom was printed as #REF! by a row insert, so its total turned into an
// error; it must keep totalling every row from its first one down.
test("=SUM(A2:A) totals the column below its first row across a row insert", () => {
  const wb = book(["s1", "Sheet", "A", sheetOf("s1", 4, 2, { "0,1": formula("=SUM(A2:A)"), "1,0": number(5), "2,0": number(7), "3,0": number(9) })]);
  const engine = createEngine(wb);
  engine.load();
  expect(at(engine, "s1", "s1r1", "s1c2")).toBe(21);
  const backing = tabOf(wb, "s1").backing;
  expect(applyWorkbook(wb, buildInsertRows(backing, "1", 1, { newId: mint() }), { engine }).out).toBe("applied");
  expect(backing.cell(1, 1).f).toBe("=SUM(A3:A)");
  expect(at(engine, "s1", "s1r1", "s1c2")).toBe(21);
  expect(applyWorkbook(wb, buildSet(backing, "A5", 100), { engine }).out).toBe("applied");
  expect(at(engine, "s1", "s1r1", "s1c2")).toBe(112);
});
