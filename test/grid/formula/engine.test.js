import { apply, applyWorkbook } from "../../../src/grid/index.js";
import { buildDeleteRows, buildInsertRows, buildSet } from "../../../src/grid/build.js";
import { createEngine } from "../../../src/grid/formula/engine.js";
import { addFunctions } from "../../../src/grid/formula/functions.js";
import { addFormatter } from "../../../src/grid/format.js";
import { modelWorkbook } from "../../../src/grid/workbook-backing.js";
import { gridModel } from "../../../src/grid/codec/read.js";

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

// Sheets totals a SUMIF sum range of another shape over the criteria's shape from its first cell.
// Bug: the stretched cells left out of the graph, so the total kept an old value.
test("a SUMIF sum range stretches to the criteria's shape and follows the stretched cells", () => {
  const wb = book(["s1", "Sheet", "A", sheetOf("s1", 3, 3, { "0,0": number(1), "0,1": number(5), "0,2": formula('=SUMIF(A1:A3, ">0", B1)') })]);
  const engine = createEngine(wb);
  engine.load();
  expect(at(engine, "s1", "s1r1", "s1c3")).toBe(5);
  const backing = tabOf(wb, "s1").backing;
  expect(applyWorkbook(wb, buildSet(backing, "A2", 1), { engine }).out).toBe("applied");
  expect(applyWorkbook(wb, buildSet(backing, "B2", 7), { engine }).out).toBe("applied");
  expect(at(engine, "s1", "s1r1", "s1c3")).toBe(12);
  expect(applyWorkbook(wb, buildSet(backing, "B2", 8), { engine }).out).toBe("applied");
  expect(at(engine, "s1", "s1r1", "s1c3")).toBe(13);
});

// David's answer 7: opening a document whose TODAY moved on must not mark it unsaved. Bug: the
// load writes every changed result as a write that marks the document unsaved.
test("at load, results that changed only through TODAY are written quietly, others as writes", () => {
  const cached = (f, text) => ({ text, n: true, v: text, f });
  const wb = book(["s1", "Sheet", "A", sheetOf("s1", 1, 3, { "0,0": cached("=TODAY()", "44000"), "0,1": cached("=A1+1", "44001"), "0,2": cached("=5+1", "1") })]);
  const calls = [];
  const engine = createEngine(wb, { write: (fn) => { calls.push("write"); fn(); }, quiet: (fn) => { calls.push("quiet"); fn(); }, now: () => 45000.5 });
  engine.load();
  expect(at(engine, "s1", "s1r1", "s1c1")).toBe(45000);
  expect(at(engine, "s1", "s1r1", "s1c2")).toBe(45001);
  expect(calls.sort()).toEqual(["quiet", "write"]);
  expect(tabOf(wb, "s1").backing.cell(0, 1).text).toBe("45001");
  expect(tabOf(wb, "s1").backing.cell(0, 2).text).toBe("6");
});

// Sheets shows #VALUE! for a SUMIFS sum range of another shape, so an off-by-one range is seen.
test("a SUMIFS sum range of another shape shows #VALUE!, as in Sheets", () => {
  const wb = book(["s1", "Sheet", "A", sheetOf("s1", 3, 3, { "0,0": { text: "x" }, "2,0": { text: "x" }, "0,1": number(5), "1,1": number(7), "0,2": formula('=SUMIFS(B1:B2, A1:A3, "x")'), "1,2": formula('=SUMIF(A1:A3, "x", B1:B2)') })]);
  const engine = createEngine(wb);
  engine.load();
  expect(at(engine, "s1", "s1r1", "s1c3")).toEqual({ error: "#VALUE!" });
  expect(at(engine, "s1", "s1r2", "s1c3")).toBe(5);
});

// Bug: a grand total over subtotalled rows counted each subtotal again.
test("SUBTOTAL leaves out cells that hold their own SUBTOTAL", () => {
  const wb = book(["s1", "Sheet", "A", sheetOf("s1", 6, 1, { "0,0": number(10), "1,0": number(20), "2,0": formula("=SUBTOTAL(9,A1:A2)"), "3,0": number(5), "4,0": formula("=subtotal(9,A4)"), "5,0": formula("=SUBTOTAL(9,A1:A5)") })]);
  const engine = createEngine(wb);
  engine.load();
  expect(at(engine, "s1", "s1r3", "s1c1")).toBe(30);
  expect(at(engine, "s1", "s1r6", "s1c1")).toBe(35);
});

// Bug: an ISO week number of a blank date cell threw and stopped the whole computation.
test("WEEKNUM of a blank date and EDATE of day 0 compute", () => {
  const wb = book(["s1", "Sheet", "A", sheetOf("s1", 1, 3, { "0,1": formula("=WEEKNUM(A1,21)"), "0,2": formula("=EDATE(A1,0)") })]);
  const engine = createEngine(wb);
  engine.load();
  expect(at(engine, "s1", "s1r1", "s1c2")).toBe(52);
  expect(at(engine, "s1", "s1r1", "s1c3")).toBe(0);
});

// David's answer 7 and the lazy pack: opening a saved sheet before its functions load must keep the
// saved results and stay saved, and their arrival must not mark it unsaved either. Bugs: the load
// wrote #NAME? over yesterday's results as an edit; the arrival wrote nothing, or wrote it as an
// edit, or told no listener.
test("a function added after load computes the formulas waiting on it quietly, and tells the tab", () => {
  const cached = (f, text) => ({ text, n: true, v: text, f });
  const wb = book(["s1", "Sheet", "A", sheetOf("s1", 1, 3, { "0,0": cached("=TWICE(4)", "8"), "0,1": cached("=A1+1", "9"), "0,2": formula("=TWICE(1)") })]);
  const calls = [];
  const engine = createEngine(wb, { write: (fn) => { calls.push("write"); fn(); }, quiet: (fn) => { calls.push("quiet"); fn(); } });
  engine.load();
  expect([at(engine, "s1", "s1r1", "s1c1"), at(engine, "s1", "s1r1", "s1c2"), at(engine, "s1", "s1r1", "s1c3")]).toEqual([8, 9, { error: "#NAME?" }]);
  expect(tabOf(wb, "s1").backing.cell(0, 0).text).toBe("8");
  calls.length = 0;
  const heard = [];
  engine.on("s1", (event) => heard.push(event.source));
  const remove = addFunctions([["TWICE", { run: ([x]) => 3 * (typeof x === "object" ? x.get(0, 0) : x) }]]);
  try {
    expect([at(engine, "s1", "s1r1", "s1c1"), at(engine, "s1", "s1r1", "s1c2"), at(engine, "s1", "s1r1", "s1c3")]).toEqual([12, 13, 3]);
    expect(calls).toEqual(["quiet"]);
    expect(heard).toEqual(["derived"]);
    expect(tabOf(wb, "s1").backing.cell(0, 1).text).toBe("13");
  } finally {
    remove();
  }
  expect(at(engine, "s1", "s1r1", "s1c1")).toEqual({ error: "#NAME?" });
  engine.dispose();
  const again = addFunctions([["TWICE", { run: () => 0 }]]);
  try {
    expect(at(engine, "s1", "s1r1", "s1c1")).toEqual({ error: "#NAME?" });
  } finally {
    again();
  }
});

// Bug this guards: a sheet saved before the pack existed, opened on a page that already has it,
// computed its =TWICE cells as ordinary writes and showed the file unsaved though nobody edited it.
test("a sheet opened after a function arrived computes its formulas quietly", () => {
  const wb = book(["s1", "Sheet", "A", sheetOf("s1", 1, 2, { "0,0": { text: "#NAME?", f: "=TWICE(4)" }, "0,1": number(1) })]);
  const remove = addFunctions([["TWICE", { run: ([x]) => 2 * x }]]);
  try {
    const calls = [];
    const engine = createEngine(wb, { write: (fn) => { calls.push("write"); fn(); }, quiet: (fn) => { calls.push("quiet"); fn(); } });
    engine.load();
    expect([tabOf(wb, "s1").backing.cell(0, 0).text, calls]).toEqual(["8", ["quiet"]]);
    engine.dispose();
  } finally {
    remove();
  }
});

// Bug: SUBTOTAL 7 (STDEV) stayed #VALUE! after the pack brought STDEV, because the formula calls
// SUBTOTAL, not STDEV.
test("SUBTOTAL's statistics codes compute once their functions arrive", () => {
  const wb = book(["s1", "Sheet", "A", sheetOf("s1", 3, 1, { "0,0": number(2), "1,0": number(4), "2,0": formula("=SUBTOTAL(10,A1:A2)") })]);
  const engine = createEngine(wb);
  engine.load();
  expect(at(engine, "s1", "s1r3", "s1c1")).toEqual({ error: "#VALUE!" });
  const remove = addFunctions([["VAR", { run: () => 2 }]]);
  try {
    expect(at(engine, "s1", "s1r3", "s1c1")).toBe(2);
  } finally {
    remove();
  }
});

// Bug: a formula under a format no formatter knew kept its plain text after the formatter came.
test("a formatter added after load redraws the formulas under its codes", () => {
  const wb = book(["s1", "Sheet", "A", sheetOf("s1", 1, 1, { "0,0": { ...formula("=3+4"), fmt: "0.0 \"kg\"" } })]);
  const engine = createEngine(wb);
  engine.load();
  expect(tabOf(wb, "s1").backing.cell(0, 0).text).toBe("7");
  const remove = addFormatter({ test: (fmt) => fmt.endsWith('"kg"'), format: (value) => `${Number(value).toFixed(1)} kg`, kind: () => "number" });
  try {
    expect(tabOf(wb, "s1").backing.cell(0, 0).text).toBe("7.0 kg");
  } finally {
    remove();
  }
});

// Opening a saved sheet before the function pack arrives: what waits keeps what it was saved with.
describe("before the pack arrives", () => {
  const recording = () => {
    const calls = [];
    return { calls, options: { write: (fn) => { calls.push("write"); fn(); }, quiet: (fn) => { calls.push("quiet"); fn(); } } };
  };

  // Bug this guards: the saved #DIV/0! of a waiting =STDEV came back as text, so =A1/2 turned into
  // #VALUE! and =IFERROR(A1,0) showed "#DIV/0!", written into the file.
  test("a waiting formula's saved error is still an error to the formulas reading it", () => {
    const wb = book(["s1", "Sheet", "A", sheetOf("s1", 1, 3, { "0,0": { text: "#DIV/0!", f: "=STDEV(B9)" }, "0,1": { text: "#DIV/0!", f: "=A1/2" }, "0,2": { text: "0", n: true, f: "=IFERROR(A1,0)" } })]);
    const { calls, options } = recording();
    const engine = createEngine(wb, options);
    engine.load();
    expect([at(engine, "s1", "s1r1", "s1c2"), at(engine, "s1", "s1r1", "s1c3"), calls]).toEqual([{ error: "#DIV/0!" }, 0, []]);
  });

  // Bug this guards: a saved =SUBTOTAL(7,...) showed #VALUE! on open, because only STDEV itself
  // counted as waiting.
  test("SUBTOTAL with a statistics code keeps its saved result", () => {
    const wb = book(["s1", "Sheet", "A", sheetOf("s1", 4, 1, { "0,0": number(2), "1,0": number(4), "2,0": number(6), "3,0": { text: "2", n: true, f: "=SUBTOTAL(7,A1:A3)" } })]);
    const { calls, options } = recording();
    const engine = createEngine(wb, options);
    engine.load();
    expect([at(engine, "s1", "s1r4", "s1c1"), calls]).toEqual([2, []]);
  });

  // Bug this guards: with the formats plugin first, =PMT under a custom code turned #NAME?.
  test("formatters arriving first draw a waiting formula's saved result", () => {
    const wb = book(["s1", "Sheet", "A", sheetOf("s1", 1, 1, { "0,0": { text: "8", n: true, f: "=TWICE(4)", fmt: '0.0 "kg"' } })]);
    const engine = createEngine(wb);
    engine.load();
    const remove = addFormatter({ test: (fmt) => fmt.endsWith('"kg"'), format: (value) => `${Number(value).toFixed(1)} kg`, kind: () => "number" });
    try {
      expect([at(engine, "s1", "s1r1", "s1c1"), tabOf(wb, "s1").backing.cell(0, 0).text]).toEqual([8, "8.0 kg"]);
    } finally {
      remove();
      engine.dispose();
    }
  });

  // Bug this guards: every open rewrote "3.33 kg" as 3.33333333333333, because the saved value
  // keeps 15 digits and the result has 17.
  test("a formula under a code no formatter knows keeps its saved text when its value is the same", () => {
    const wb = book(["s1", "Sheet", "A", sheetOf("s1", 1, 1, { "0,0": { text: "3.33 kg", n: true, v: "3.33333333333333", f: "=10/3", fmt: '0.00 "kg"' } })]);
    const { calls, options } = recording();
    const engine = createEngine(wb, options);
    engine.load();
    expect([tabOf(wb, "s1").backing.cell(0, 0).text, calls]).toEqual(["3.33 kg", []]);
  });

  // Bug this guards: TEXT with a code only the formats plugin knows wrote #VALUE! over its saved
  // text on open, and stayed #VALUE! after the plugin came.
  test("TEXT with a code no formatter knows keeps its saved text, and draws once formatters arrive", () => {
    const wb = book(["s1", "Sheet", "A", sheetOf("s1", 1, 2, { "0,0": number(1.25), "0,1": { text: "1 1/4", f: '=TEXT(A1,"# ?/?")' } })]);
    const { calls, options } = recording();
    const engine = createEngine(wb, options);
    engine.load();
    expect([tabOf(wb, "s1").backing.cell(0, 1).text, calls]).toEqual(["1 1/4", []]);
    const remove = addFormatter({ test: (fmt) => fmt === "# ?/?", format: () => "one and a quarter", kind: () => "number" });
    try {
      expect([tabOf(wb, "s1").backing.cell(0, 1).text, calls]).toEqual(["one and a quarter", ["quiet"]]);
    } finally {
      remove();
      engine.dispose();
    }
  });

  // Bug this guards: a sheet saved before its formatter existed, opened with the formatter here,
  // drew its formulas in their codes through write and showed the file unsaved.
  test("opening with the formatter already here draws formula results in their codes quietly", () => {
    const wb = book(["s1", "Sheet", "A", sheetOf("s1", 1, 1, { "0,0": { text: "8", n: true, f: "=4*2", fmt: '0.0 "kg"' } })]);
    const remove = addFormatter({ test: (fmt) => fmt.endsWith('"kg"'), format: (value) => `${Number(value).toFixed(1)} kg`, kind: () => "number" });
    try {
      const { calls, options } = recording();
      const engine = createEngine(wb, options);
      engine.load();
      expect([tabOf(wb, "s1").backing.cell(0, 0).text, calls]).toEqual(["8.0 kg", ["quiet"]]);
      engine.dispose();
    } finally {
      remove();
    }
  });

  // Bug this guards: formatters arriving computed RAND under a custom code again, so its stored
  // number changed though only the drawing had.
  test("formatters arriving draw results again without computing them", () => {
    let random = 0.25;
    const wb = book(["s1", "Sheet", "A", sheetOf("s1", 1, 1, { "0,0": { text: "", f: "=RAND()", fmt: '0.0 "kg"' } })]);
    const engine = createEngine(wb, { random: () => random });
    engine.load();
    random = 0.75;
    const remove = addFormatter({ test: (fmt) => fmt.endsWith('"kg"'), format: (value) => `${Number(value).toFixed(2)} kg`, kind: () => "number" });
    try {
      expect(tabOf(wb, "s1").backing.cell(0, 0).text).toBe("0.25 kg");
    } finally {
      remove();
      engine.dispose();
    }
  });
});

test("a whole-width sort computes again a lookup on another tab whose range keeps its two end rows", () => {
  // Fails when the engine skips a formula whose meaning did not change: the lookup keeps the old row's value.
  const budget = gridModel('<table grid><colgroup><col data-id="a" data-pos="G"><col data-id="b" data-pos="V"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="G"><td>pens</td><td n>30</td></tr>\n<tr data-id="r2" data-pos="M"><td>ink</td><td n>10</td></tr>\n<tr data-id="r3" data-pos="V"><td>paper</td><td n>20</td></tr>\n</tbody></table>', 0);
  const sum = gridModel('<table grid><colgroup><col data-id="a" data-pos="G"><col data-id="b" data-pos="V"></colgroup>\n<tbody>\n<tr data-id="x1" data-pos="G"><td f="=INDEX(Budget!B1:B3, 1)"></td><td f="=MATCH(&quot;paper&quot;, Budget!A1:A3, 0)"></td></tr>\n</tbody></table>', 0);
  const wb = modelWorkbook([{ id: "s1", name: "Budget", pos: "G", sheet: budget }, { id: "s2", name: "Sum", pos: "V", sheet: sum }]);
  const engine = createEngine(wb);
  engine.load();
  expect([engine.result("s2", "x1", "a"), engine.result("s2", "x1", "b")]).toEqual([30, 3]);
  expect(applyWorkbook(wb, { v: 1, t: "sort", sheet: "s1", rows: ["r3", "r2", "r1"], cols: null }, { engine }).out).toBe("applied");
  expect([engine.result("s2", "x1", "a"), engine.result("s2", "x1", "b")]).toEqual([20, 1]);
  engine.dispose();
});

test("a whole-width sort computes again a SUMIF on another tab whose sum range is one cell of the sorted tab", () => {
  // Fails when only true ranges on the sorted tab compute again: the SUMIF stretches Budget!B1 to B1:B3 and keeps the old total.
  const budget = gridModel('<table grid><colgroup><col data-id="a" data-pos="G"><col data-id="b" data-pos="V"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="G"><td>pens</td><td n>1</td></tr>\n<tr data-id="r2" data-pos="M"><td>ink</td><td n>10</td></tr>\n<tr data-id="r3" data-pos="V"><td>paper</td><td n>100</td></tr>\n</tbody></table>', 0);
  const sum = gridModel('<table grid><colgroup><col data-id="a" data-pos="G"><col data-id="b" data-pos="V"></colgroup>\n<tbody>\n<tr data-id="x1" data-pos="G"><td>no</td><td f="=SUMIF(A1:A3, &quot;pick&quot;, Budget!B1)"></td></tr>\n<tr data-id="x2" data-pos="M"><td>pick</td></tr>\n<tr data-id="x3" data-pos="V"><td>no</td></tr>\n</tbody></table>', 0);
  const wb = modelWorkbook([{ id: "s1", name: "Budget", pos: "G", sheet: budget }, { id: "s2", name: "Summary", pos: "V", sheet: sum }]);
  const engine = createEngine(wb);
  engine.load();
  expect(engine.result("s2", "x1", "b")).toBe(10);
  expect(applyWorkbook(wb, { v: 1, t: "sort", sheet: "s1", rows: ["r1", "r3", "r2"], cols: null }, { engine }).out).toBe("applied");
  expect(engine.result("s2", "x1", "b")).toBe(100);
  engine.dispose();
});
