import { applyWorkbook, createEngine, domWorkbook, modelWorkbook } from "../../src/grid/index.js";
import { buildDeleteCols, buildDeleteRows, buildInsertCols, buildInsertRows, buildMoveCols, buildMoveRows, buildSet } from "../../src/grid/build.js";
import { colName } from "../../src/grid/a1.js";
import { gridModel } from "../../src/grid/codec/read.js";
import { tableHtml } from "../../src/grid/codec/write.js";

global.__SAP_KEEP_CONSOLE__ = true;

const KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

const number = (value) => ({ text: String(value), n: true });

// A codec model: rows and columns keyed in order, cells by "row,col" from the top left.
function sheetOf(prefix, rows, cols, cells = {}) {
  const sheet = {
    cols: Array.from({ length: cols }, (_, c) => ({ id: `${prefix}c${c + 1}`, pos: KEYS[c] })),
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

const budget = () =>
  sheetOf("s1", 6, 2, {
    "0,1": number(10),
    "1,1": number(20),
    "2,1": number(30),
    "3,1": number(40),
    "4,1": number(50),
    "5,0": { text: "Total" },
    "5,1": { text: "150", n: true, v: "150", f: "=SUM(B1:B5)" },
  });

const notes = () => sheetOf("s2", 3, 2, { "0,1": { text: "150", n: true, v: "150", f: "=Budget!B6" } });

const book = () =>
  modelWorkbook([
    { id: "s1", name: "Budget", pos: "A", sheet: budget() },
    { id: "s2", name: "Notes", pos: "B", sheet: notes() },
  ]);

const noStale = (html) => html.replace("<table grid stale>", "<table grid>");
const bytes = (wb) => wb.sheets().map((tab) => tableHtml(tab.backing.sheet)).join("\n");
const shape = (wb) => wb.sheets().map((tab) => [tab.id, tab.name, tab.pos]);

const tabOf = (wb, id) => wb.sheets().find((tab) => tab.id === id);
const formulaAt = (wb, id, row, col) => {
  const backing = tabOf(wb, id).backing;
  return backing.cell(backing.rowIndex(row), backing.colIndex(col))?.f ?? null;
};

const mint = () => {
  let n = 0;
  return (prefix) => `${prefix}m${n++}`;
};

const rootOf = (wb) => {
  const root = document.createElement("div");
  for (const tab of wb.sheets()) {
    const section = document.createElement("section");
    section.setAttribute("item", "");
    section.setAttribute("data-id", tab.id);
    section.setAttribute("data-pos", tab.pos);
    const title = document.createElement("h2");
    title.setAttribute("bind", "name");
    title.textContent = tab.name;
    const holder = document.createElement("div");
    holder.innerHTML = tableHtml(tab.backing.sheet);
    section.append(title, holder.firstElementChild);
    root.append(section);
  }
  document.body.append(root);
  return root;
};

test("a row above a total moves the total and every tab that names it", () => {
  const wb = book();
  const first = bytes(wb);
  expect(formulaAt(wb, "s1", "s1r6", "s1c2")).toBe("=SUM(B1:B5)");
  expect(formulaAt(wb, "s2", "s2r1", "s2c2")).toBe("=Budget!B6");

  const action = buildInsertRows(tabOf(wb, "s1").backing, "3", 1, { newId: mint() });
  const out = applyWorkbook(wb, action);
  expect(out.out).toBe("applied");
  expect(formulaAt(wb, "s1", "s1r6", "s1c2")).toBe("=SUM(B1:B6)");
  expect(formulaAt(wb, "s2", "s2r1", "s2c2")).toBe("=Budget!B7");

  expect(applyWorkbook(wb, out.inverse).out).toBe("applied");
  expect(noStale(bytes(wb))).toBe(noStale(first));
});

// Bug: a row inserted at the top turned a stored `=SUM(B1:B)` into `=SUM(#REF!)`.
test("a range open at its bottom follows a row insert and a delete and keeps its open end", () => {
  const wb = modelWorkbook([{ id: "s1", name: "Budget", pos: "A", sheet: sheetOf("s1", 4, 3, { "3,2": { text: "", f: "=SUM(B1:B)" } }) }]);
  const backing = tabOf(wb, "s1").backing;
  expect(applyWorkbook(wb, buildInsertRows(backing, "1", 1, { newId: mint() })).out).toBe("applied");
  expect(formulaAt(wb, "s1", "s1r4", "s1c3")).toBe("=SUM(B2:B)");
  expect(applyWorkbook(wb, buildDeleteRows(backing, "2:3")).out).toBe("applied");
  expect(formulaAt(wb, "s1", "s1r4", "s1c3")).toBe("=SUM(B2:B)");
});

test("renaming a tab rewrites the formulas that name it and the inverse gives the bytes back", () => {
  const wb = modelWorkbook([
    { id: "s1", name: "Budget", pos: "A", sheet: sheetOf("s1", 3, 2, { "0,1": { text: "7", n: true, f: "=Notes!B9" } }) },
    { id: "s2", name: "Notes", pos: "B", sheet: sheetOf("s2", 10, 2, { "8,1": number(7) }) },
  ]);
  const first = bytes(wb);
  const out = applyWorkbook(wb, { v: 1, t: "renameSheet", sheet: "s2", name: "Plan" });
  expect(out.out).toBe("applied");
  expect(formulaAt(wb, "s1", "s1r1", "s1c2")).toBe("=Plan!B9");
  expect(tabOf(wb, "s2").name).toBe("Plan");
  expect(applyWorkbook(wb, out.inverse).out).toBe("applied");
  expect(tabOf(wb, "s2").name).toBe("Notes");
  expect(noStale(bytes(wb))).toBe(noStale(first));
});

test("deleting a tab and undoing brings back its formulas and every formula naming it", () => {
  const wb = book();
  const first = bytes(wb);
  const out = applyWorkbook(wb, { v: 1, t: "deleteSheet", sheet: "s2" });
  expect(out.out).toBe("applied");
  expect(shape(wb)).toEqual([["s1", "Budget", "A"]]);
  expect(formulaAt(wb, "s1", "s1r6", "s1c2")).toBe("=SUM(B1:B5)");
  expect(applyWorkbook(wb, out.inverse).out).toBe("applied");
  expect(shape(wb)).toEqual([["s1", "Budget", "A"], ["s2", "Notes", "B"]]);
  expect(formulaAt(wb, "s2", "s2r1", "s2c2")).toBe("=Budget!B6");
  expect(noStale(bytes(wb))).toBe(noStale(first));
});

test("moving a tab changes the order and no formula", () => {
  const wb = book();
  const formulas = [formulaAt(wb, "s1", "s1r6", "s1c2"), formulaAt(wb, "s2", "s2r1", "s2c2")];
  const out = applyWorkbook(wb, { v: 1, t: "moveSheet", sheet: "s2", pos: "1" });
  expect(out.out).toBe("applied");
  expect(shape(wb).map(([id]) => id)).toEqual(["s2", "s1"]);
  expect([formulaAt(wb, "s1", "s1r6", "s1c2"), formulaAt(wb, "s2", "s2r1", "s2c2")]).toEqual(formulas);
  expect(applyWorkbook(wb, out.inverse).out).toBe("applied");
  expect(shape(wb).map(([id]) => id)).toEqual(["s1", "s2"]);
  expect([formulaAt(wb, "s1", "s1r6", "s1c2"), formulaAt(wb, "s2", "s2r1", "s2c2")]).toEqual(formulas);
});

test("a new tab may not take a name another tab has", () => {
  const wb = book();
  const html = tableHtml(sheetOf("s3", 2, 2, { "0,0": { text: "x" } }));
  const out = applyWorkbook(wb, { v: 1, t: "insertSheet", sheet: { id: "s3", name: "BUDGET", pos: "C", html } });
  expect(out).toEqual(expect.objectContaining({ out: "refused", code: "name_taken" }));
  expect(shape(wb)).toHaveLength(2);
  const fresh = applyWorkbook(wb, { v: 1, t: "insertSheet", sheet: { id: "s3", name: "Plan", pos: "C", html } });
  expect(fresh.out).toBe("applied");
  expect(shape(wb).map(([id, name]) => [id, name])).toEqual([["s1", "Budget"], ["s2", "Notes"], ["s3", "Plan"]]);
});

test("all or nothing: a write that throws takes every tab back", () => {
  const wb = book();
  const first = bytes(wb);
  const before = shape(wb);
  const tab = tabOf(wb, "s2");
  const put = tab.backing.putCell.bind(tab.backing);
  let calls = 0;
  tab.backing.putCell = (r, c, cell) => {
    calls += 1;
    if (calls === 1) throw new Error("no writes today");
    return put(r, c, cell);
  };
  const out = applyWorkbook(wb, buildInsertRows(tabOf(wb, "s1").backing, "3", 1, { newId: mint() }));
  expect(out).toEqual(expect.objectContaining({ out: "refused", code: "rewrite_failed" }));
  expect(calls).toBe(1);
  expect(bytes(wb)).toBe(first);
  expect(shape(wb)).toEqual(before);
  expect(formulaAt(wb, "s2", "s2r1", "s2c2")).toBe("=Budget!B6");
});

test("a typed spelling comes back when its undo runs", () => {
  const wb = modelWorkbook([{ id: "s1", name: "Budget", pos: "A", sheet: sheetOf("s1", 4, 2, { "0,1": { text: "6", n: true, v: "6", f: "=sum($a$1:a3)" } }) }]);
  const first = bytes(wb);
  const out = applyWorkbook(wb, buildInsertRows(wb.sheets()[0].backing, "1", 1, { newId: mint() }));
  expect(out.out).toBe("applied");
  expect(formulaAt(wb, "s1", "s1r1", "s1c2")).toBe("=sum($A$2:A4)");
  expect(applyWorkbook(wb, out.inverse).out).toBe("applied");
  expect(formulaAt(wb, "s1", "s1r1", "s1c2")).toBe("=sum($a$1:a3)");
  expect(noStale(bytes(wb))).toBe(noStale(first));
});

test("an end past the edge comes back as typed when the growth that reached it is undone", () => {
  const wb = modelWorkbook([{ id: "s1", name: "Budget", pos: "A", sheet: sheetOf("s1", 4, 2, { "0,1": { text: "0", n: true, v: "0", f: "=sum($a$1:$a$5)" } }) }]);
  const first = bytes(wb);
  const out = applyWorkbook(wb, buildSet(wb.sheets()[0].backing, "A5", 5, { grow: true, newId: mint() }));
  expect(out.out).toBe("applied");
  expect(wb.sheets()[0].backing.rows()).toHaveLength(5);
  expect(formulaAt(wb, "s1", "s1r1", "s1c2")).toBe("=sum($A$1:$A$5)");
  expect(applyWorkbook(wb, out.inverse).out).toBe("applied");
  expect(wb.sheets()[0].backing.rows()).toHaveLength(4);
  expect(formulaAt(wb, "s1", "s1r1", "s1c2")).toBe("=sum($a$1:$a$5)");
  expect(noStale(bytes(wb))).toBe(noStale(first));
});

const rng = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const NAMES = ["Budget", "Notes", "Q1 2026", "Data", "Totals", "A1"];

function randomStep(wb, rand, newId, tabs) {
  const sheets = wb.sheets();
  const tab = sheets[Math.floor(rand() * sheets.length)];
  const b = tab.backing;
  const rows = b.rows().length;
  const cols = b.cols().length;
  const k = rand();
  if (k < 0.2) return buildInsertRows(b, String(1 + Math.floor(rand() * (rows + 1))), 1, { newId });
  if (k < 0.32 && rows > 3) {
    const r = 1 + Math.floor(rand() * rows);
    return buildDeleteRows(b, `${r}:${Math.min(rows, r + Math.floor(rand() * 2))}`);
  }
  if (k < 0.44) return buildInsertCols(b, colName(Math.floor(rand() * (cols + 1))), 1, { newId });
  if (k < 0.54 && cols > 2) return buildDeleteCols(b, colName(Math.floor(rand() * cols)));
  if (k < 0.64) {
    const r = 1 + Math.floor(rand() * rows);
    return buildMoveRows(b, `${r}:${r}`, String(1 + Math.floor(rand() * (rows + 1))));
  }
  if (k < 0.7 && cols > 2) {
    const c = Math.floor(rand() * cols);
    return buildMoveCols(b, colName(c), colName(Math.floor(rand() * (cols + 1))));
  }
  if (k < 0.86) {
    const r = 1 + Math.floor(rand() * rows);
    const c = Math.floor(rand() * cols);
    const name = colName(c);
    const f = rand() < 0.5 ? `=SUM(${name}1:${name}${rows})` : `=${colName((c + 1) % cols)}${r}`;
    return buildSet(b, `${name}${r}`, { f });
  }
  if (!tabs) return null;
  const free = NAMES.filter((name) => !sheets.some((one) => one.name.toLowerCase() === name.toLowerCase()));
  if (k < 0.92 && free.length > 0) return { v: 1, t: "renameSheet", sheet: tab.id, name: free[Math.floor(rand() * free.length)] };
  if (k < 0.96) return { v: 1, t: "moveSheet", sheet: tab.id, pos: `${Math.floor(rand() * 5)}${"ABCDE"[Math.floor(rand() * 5)]}` };
  if (k < 0.98 && sheets.length > 1) return { v: 1, t: "deleteSheet", sheet: tab.id };
  if (free.length === 0) return null;
  const id = `s${tabs}`;
  const html = tableHtml(sheetOf(id, 3, 2, { "0,0": { text: id } }));
  return { v: 1, t: "insertSheet", sheet: { id, name: free[Math.floor(rand() * free.length)], pos: `${Math.floor(rand() * 5)}Z`, html } };
}

test("a page and a model given the same steps write the same bytes", () => {
  const model = book();
  const page = domWorkbook(rootOf(model));
  const same = () => {
    expect(page.sheets().map((tab) => [tab.id, tab.name, tab.pos])).toEqual(shape(model));
    expect(page.sheets().map((tab) => tableHtml(tab.backing.sheet)).join("\n")).toBe(bytes(model));
  };
  same();

  const rand = rng(20261118);
  const newId = mint();
  const done = [];
  let tabCount = 9;
  for (let step = 0; step < 30; step++) {
    const action = randomStep(model, rand, newId, tabCount);
    if (action === null) continue;
    const one = applyWorkbook(model, action);
    const two = applyWorkbook(page, action);
    expect(two.out).toBe(one.out);
    if (one.out !== "applied") continue;
    if ((action.t === "insertSheet") === true) tabCount += 1;
    done.push(one.inverse);
    same();
  }
  expect(done.length).toBeGreaterThan(15);
  for (const inverse of done.reverse()) {
    const one = applyWorkbook(model, inverse);
    const two = applyWorkbook(page, inverse);
    expect(two.out).toBe(one.out);
    same();
  }
});

test("two tabs given one order key keep one order, by id, on the page and in the model, whichever came first", () => {
  const tabs = (first, second) => [first, second].map(([id, name]) => ({ v: 1, t: "insertSheet", sheet: { id, name, pos: "z", html: tableHtml(budget()) } }));
  const orders = [];
  for (const [first, second] of [[["tb", "Two"], ["ta", "One"]], [["ta", "One"], ["tb", "Two"]]]) {
    const model = book();
    const root = rootOf(model);
    const page = domWorkbook(root);
    for (const action of tabs(first, second)) {
      expect([applyWorkbook(model, action).out, applyWorkbook(page, action).out]).toEqual(["applied", "applied"]);
    }
    orders.push(shape(model).map(([id]) => id).join(), shape(page).map(([id]) => id).join(), [...root.children].map((el) => el.getAttribute("data-id")).join());
  }
  expect(new Set(orders).size).toBe(1);
  expect(orders[0].endsWith("ta,tb")).toBe(true);
});

test("a set's undo, run after a row went in above the formula's target, puts back a formula that follows the rows", () => {
  const wb = book();
  const budgetTab = () => tabOf(wb, "s1").backing;
  const set = applyWorkbook(wb, buildSet(budgetTab(), "B6", 7));
  expect(set.out).toBe("applied");
  const insert = applyWorkbook(wb, buildInsertRows(budgetTab(), "1", 1, { newId: mint() }));
  expect(insert.out).toBe("applied");
  expect(applyWorkbook(wb, set.inverse).out).toBe("applied");
  expect(formulaAt(wb, "s1", "s1r6", "s1c2")).toBe("=SUM(B2:B6)");
});

test("a range typed bottom to top keeps every row it still holds when an end row is deleted", () => {
  const wb = modelWorkbook([
    { id: "s1", name: "Budget", pos: "A", sheet: budget() },
    { id: "s2", name: "Notes", pos: "B", sheet: sheetOf("s2", 2, 2, { "0,1": { text: "140", n: true, v: "140", f: "=SUM(Budget!B5:B1)" }, "1,1": { text: "140", n: true, v: "140", f: "=SUM(Budget!B5:B1)" } }) },
  ]);
  expect(applyWorkbook(wb, buildDeleteRows(tabOf(wb, "s1").backing, "1:1")).out).toBe("applied");
  expect(formulaAt(wb, "s2", "s2r1", "s2c2")).toBe("=SUM(Budget!B1:B4)");
  expect(applyWorkbook(wb, buildDeleteRows(tabOf(wb, "s1").backing, "4:4")).out).toBe("applied");
  expect(formulaAt(wb, "s2", "s2r2", "s2c2")).toBe("=SUM(Budget!B1:B3)");
});

test("an undo of a number typed over text that starts with = gives back the text, not a formula", () => {
  const wb = modelWorkbook([{ id: "s1", name: "Budget", pos: "A", sheet: sheetOf("s1", 2, 2, { "0,0": { text: "=A2+B2" } }) }]);
  const first = bytes(wb);
  const set = applyWorkbook(wb, buildSet(tabOf(wb, "s1").backing, "A1", 42));
  expect(set.out).toBe("applied");
  expect(applyWorkbook(wb, set.inverse).out).toBe("applied");
  expect([tabOf(wb, "s1").backing.cell(0, 0), bytes(wb)]).toEqual([{ text: "=A2+B2" }, first]);
});

test("a formula holding the literal #N/A follows its rows", () => {
  const wb = modelWorkbook([
    { id: "s1", name: "Budget", pos: "A", sheet: budget() },
    { id: "s2", name: "Notes", pos: "B", sheet: sheetOf("s2", 1, 2, { "0,1": { text: "20", n: true, v: "20", f: "=IF(Budget!B2>0,Budget!B2,#N/A)" } }) },
  ]);
  expect(applyWorkbook(wb, buildInsertRows(tabOf(wb, "s1").backing, "1", 1, { newId: mint() })).out).toBe("applied");
  expect(formulaAt(wb, "s2", "s2r1", "s2c2")).toBe("=IF(Budget!B3>0,Budget!B3,#N/A)");
});

test("a refused undo leaves no stale mark from the formula it brought back", () => {
  const wb = book();
  const removed = applyWorkbook(wb, buildDeleteRows(tabOf(wb, "s1").backing, "6:6"));
  expect(removed.out).toBe("applied");
  const first = bytes(wb);
  tabOf(wb, "s2").backing.putCell = () => {
    throw new Error("no writes today");
  };
  const out = applyWorkbook(wb, removed.inverse);
  expect([out.out, out.code]).toEqual(["refused", "rewrite_failed"]);
  expect(bytes(wb)).toBe(first);
});

const unstaled = (html) => html.replaceAll("<table grid stale>", "<table grid>");

test("a sort moves whole rows: a formula inside the block keeps pointing at its own row, one outside keeps its address, and undo gives the bytes back", () => {
  const wb = modelWorkbook([
    { id: "s1", name: "Budget", pos: "A", sheet: sheetOf("s1", 4, 3, { "0,1": number(30), "0,2": { text: "", f: "=B1*2" }, "1,1": number(10), "1,2": { text: "", f: "=B2*2" }, "2,1": number(20), "2,2": { text: "", f: "=B3*2" }, "3,1": { text: "", f: "=B1" } }) },
    { id: "s2", name: "Notes", pos: "B", sheet: sheetOf("s2", 1, 1, { "0,0": { text: "", f: "=Budget!B1" } }) },
  ]);
  const before = bytes(wb);
  const out = applyWorkbook(wb, { v: 1, t: "sort", sheet: "s1", rows: ["s1r2", "s1r3", "s1r1"], cols: null });
  expect(out.out).toBe("applied");
  expect(tabOf(wb, "s1").backing.rows().map((row) => row.id)).toEqual(["s1r2", "s1r3", "s1r1", "s1r4"]);
  expect(["s1r2", "s1r3", "s1r1"].map((row) => formulaAt(wb, "s1", row, "s1c3"))).toEqual(["=B1*2", "=B2*2", "=B3*2"]);
  expect(formulaAt(wb, "s1", "s1r4", "s1c2")).toBe("=B1");
  expect(formulaAt(wb, "s2", "s2r1", "s2c1")).toBe("=Budget!B1");
  expect(applyWorkbook(wb, out.inverse).out).toBe("applied");
  expect(unstaled(bytes(wb))).toBe(unstaled(before));
});

test("a sort of some columns moves content between the rows, and a formula pushed above row 1 comes back whole on undo", () => {
  const wb = modelWorkbook([{ id: "s1", name: "Budget", pos: "A", sheet: sheetOf("s1", 3, 2, { "0,0": { text: "a" }, "0,1": number(1), "1,0": { text: "b" }, "1,1": number(2), "2,0": { text: "c" }, "2,1": { text: "", f: "=A1+A2" } }) }]);
  const before = bytes(wb);
  const out = applyWorkbook(wb, { v: 1, t: "sort", sheet: "s1", rows: ["s1r3", "s1r1", "s1r2"], cols: ["s1c2"] });
  expect(out.out).toBe("applied");
  expect(formulaAt(wb, "s1", "s1r1", "s1c2")).toBe("=#REF!+#REF!");
  expect(tabOf(wb, "s1").backing.cell(0, 0).text).toBe("a");
  expect(applyWorkbook(wb, out.inverse).out).toBe("applied");
  expect(unstaled(bytes(wb))).toBe(unstaled(before));
});

test("a batch's undo that brings a row back and then a formula naming it gives the formula back", () => {
  const wb = book();
  const out = applyWorkbook(wb, { v: 1, t: "batch", actions: [{ v: 1, t: "set", sheet: "s1", cells: [["s1r6", "s1c2", "gone"]] }, { v: 1, t: "deleteRows", sheet: "s1", rows: ["s1r1"] }] });
  expect(out.out).toBe("applied");
  expect(applyWorkbook(wb, out.inverse).out).toBe("applied");
  expect([formulaAt(wb, "s1", "s1r6", "s1c2"), formulaAt(wb, "s2", "s2r1", "s2c2")]).toEqual(["=SUM(B1:B5)", "=Budget!B6"]);
});

test("a row inserted in one tab still moves a formula in another tab's row that has the same id", () => {
  const wb = modelWorkbook([
    { id: "s1", name: "Budget", pos: "A", sheet: budget() },
    { id: "s2", name: "Copy", pos: "B", sheet: sheetOf("cp", 2, 2, { "1,1": { text: "", f: "=Budget!B1" } }) },
  ]);
  expect(applyWorkbook(wb, { v: 1, t: "insertRows", sheet: "s1", rows: [{ id: "cpr2", pos: "5" }] }).out).toBe("applied");
  expect(formulaAt(wb, "s2", "cpr2", "cpc2")).toBe("=Budget!B2");
});

test("a rename's undo keeps a typed spelling of the tab's name", () => {
  const wb = modelWorkbook([
    { id: "s1", name: "NOTES", pos: "A", sheet: sheetOf("s1", 1, 1, { "0,0": number(5) }) },
    { id: "s2", name: "Sum", pos: "B", sheet: sheetOf("s2", 1, 1, { "0,0": { text: "", f: "=Notes!A1" } }) },
  ]);
  const before = bytes(wb);
  const out = applyWorkbook(wb, { v: 1, t: "renameSheet", sheet: "s1", name: "Notes" });
  expect(applyWorkbook(wb, out.inverse).out).toBe("applied");
  expect(formulaAt(wb, "s2", "s2r1", "s2c1")).toBe("=Notes!A1");
  expect(unstaled(bytes(wb))).toBe(unstaled(before));
});

test("a redo after a coworker moved a row in gives back the total's range, not one that takes in the moved row", () => {
  const rows = ["r1", "r2", "r3", "r4", "r5"].map((id, i) => ({ id, pos: "BCDEF"[i], cells: [null, number((i + 1) * 10)] }));
  rows.push({ id: "r6", pos: "G", cells: [{ text: "Total" }, { text: "", f: "=SUM(B1:B3)" }] });
  const wb = modelWorkbook([{ id: "s1", name: "Budget", pos: "A", sheet: { cols: [{ id: "a", pos: "A" }, { id: "b", pos: "B" }], rows } }]);
  const removed = applyWorkbook(wb, { v: 1, t: "deleteRows", sheet: "s1", rows: ["r1"] });
  applyWorkbook(wb, { v: 1, t: "changeRows", sheet: "s1", rows: [{ id: "r5", pos: "BV" }] });
  const before = unstaled(bytes(wb));
  const undo = applyWorkbook(wb, removed.inverse);
  expect(formulaAt(wb, "s1", "r6", "b")).toBe("=SUM(B1:B4)");
  expect(applyWorkbook(wb, undo.inverse).out).toBe("applied");
  expect(formulaAt(wb, "s1", "r6", "b")).toBe("=SUM(B2:B3)");
  expect(unstaled(bytes(wb))).toBe(before);
});

test("a batch's own set keeps its cell's old formula on undo, not a restore entry of the set's formula", () => {
  const wb = modelWorkbook([{ id: "s1", name: "Budget", pos: "A", sheet: sheetOf("s1", 2, 2, { "0,0": number(5), "0,1": { text: "5", n: true, f: "=A1" }, "1,0": number(6) }) }]);
  const out = applyWorkbook(wb, { v: 1, t: "batch", actions: [{ v: 1, t: "set", sheet: "s1", cells: [["s1r1", "s1c2", { f: "=a1" }]] }, { v: 1, t: "deleteRows", sheet: "s1", rows: ["s1r2"] }] });
  expect(applyWorkbook(wb, out.inverse).out).toBe("applied");
  expect(formulaAt(wb, "s1", "s1r1", "s1c2")).toBe("=A1");
});

test("a batch that sets a range with an end past the edge and deletes a row prints the range as two steps would", () => {
  const sheet = () => sheetOf("s1", 4, 2, { "0,0": number(1), "1,0": number(2), "2,0": number(3), "3,0": number(4) });
  const set = { v: 1, t: "set", sheet: "s1", cells: [["s1r1", "s1c2", { f: "=SUM(A3:A10)", refs: [["s1", "s1r3", "s1c1", 0, "s1c1"]] }]] };
  const remove = { v: 1, t: "deleteRows", sheet: "s1", rows: ["s1r3"] };
  const one = modelWorkbook([{ id: "s1", name: "Budget", pos: "A", sheet: sheet() }]);
  expect(applyWorkbook(one, { v: 1, t: "batch", actions: [set, remove] }).out).toBe("applied");
  const two = modelWorkbook([{ id: "s1", name: "Budget", pos: "A", sheet: sheet() }]);
  applyWorkbook(two, set);
  applyWorkbook(two, remove);
  expect([formulaAt(one, "s1", "s1r1", "s1c2"), formulaAt(two, "s1", "s1r1", "s1c2")]).toEqual(["=SUM(A3:A10)", "=SUM(A3:A10)"]);
});

test("a whole-width sort with an engine open computes the formulas outside the block over the rows now at their addresses", () => {
  const wb = modelWorkbook([
    { id: "s1", name: "Budget", pos: "A", sheet: sheetOf("s1", 4, 2, { "0,1": number(30), "1,1": number(10), "2,1": number(20), "3,0": { text: "", f: "=SUM(B1:B2)" }, "3,1": { text: "", f: "=B1" } }) },
    { id: "s2", name: "Sum", pos: "B", sheet: sheetOf("s2", 1, 1, { "0,0": { text: "", f: "=Budget!B1" } }) },
  ]);
  const engine = createEngine(wb);
  engine.load();
  expect(applyWorkbook(wb, { v: 1, t: "sort", sheet: "s1", rows: ["s1r2", "s1r3", "s1r1"], cols: null }, { engine }).out).toBe("applied");
  expect([engine.result("s1", "s1r4", "s1c1"), engine.result("s1", "s1r4", "s1c2"), engine.result("s2", "s2r1", "s2c1")]).toEqual([30, 10, 10]);
  engine.dispose();
});

test("a sort that would move a frozen row, cut a merge or name a missing column is refused and changes nothing", () => {
  const wb = book();
  expect(applyWorkbook(wb, { v: 1, t: "freeze", sheet: "s1", rowsThrough: "s1r1" }).out).toBe("applied");
  expect(applyWorkbook(wb, { v: 1, t: "merge", sheet: "s1", from: ["s1r3", "s1c1"], to: ["s1r4", "s1c1"], clears: [] }).out).toBe("applied");
  const before = bytes(wb);
  const sort = (rows, cols) => applyWorkbook(wb, { v: 1, t: "sort", sheet: "s1", rows, cols }).code;
  expect([sort(["s1r2", "s1r1"], null), sort(["s1r3", "s1r2"], null), sort(["s1r5", "s1r2"], ["s1c2", "s1c9"]), sort(["s1r4", "s1r2"], ["s1c1"])]).toEqual(["bad_action", "merge_cut", "missing_col", "covered_cell"]);
  expect(bytes(wb)).toBe(before);
});
