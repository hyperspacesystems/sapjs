import { tableHtml } from "../../../src/grid/codec/write.js";
import { createSheets } from "../../../src/grid/grid.js";
import { run } from "./support/rewrite-run.js";

global.__SAP_KEEP_CONSOLE__ = true;

const KEYS = "ABCDEFGHIJ";
const number = (value) => ({ text: String(value), n: true });

function sheetOf(prefix, rows, cols, cells) {
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
  return sheet;
}

// A page with two tabs, saved without results (a host's write): Budget totals five amounts, and
// Notes shows Budget's total.
function page() {
  const root = document.createElement("main");
  const tab = (id, name, pos, sheet) => {
    const html = tableHtml(sheet).replace("<table grid>", "<table grid stale>");
    return `<section item data-id="${id}" data-pos="${pos}"><h2 bind="name">${name}</h2>${html}</section>`;
  };
  root.innerHTML =
    tab("s1", "Budget", "A", sheetOf("s1", 6, 2, { "0,1": number(10), "1,1": number(20), "2,1": number(30), "3,1": number(40), "4,1": number(50), "5,0": { text: "Total" }, "5,1": { text: "", f: "=SUM(B1:B5)" } })) +
    tab("s2", "Notes", "B", sheetOf("s2", 2, 2, { "0,1": { text: "", f: "=Budget!B6*2" }, "1,1": { text: "", f: "=1/0" } }));
  document.body.replaceChildren(root);
  return root;
}

const textAt = (root, id, r, c) => root.querySelector(`section[data-id="${id}"] table`).rows[r].cells[c].textContent;

test("the budget computes through createSheets, and a row insert computes only the ranges it lands in", () => {
  const root = page();
  const writes = [];
  const sheets = createSheets(root, { write: (fn) => { writes.push(fn); return fn(); } });
  expect([textAt(root, "s1", 5, 1), textAt(root, "s2", 0, 1), textAt(root, "s2", 1, 1)]).toEqual(["150", "300", "#DIV/0!"]);
  expect(root.querySelectorAll("table[stale]")).toHaveLength(0);
  expect(writes.length).toBeGreaterThan(0);

  const budget = sheets.grid(root.querySelector('section[data-id="s1"] table'));
  const notes = sheets.grid(root.querySelector('section[data-id="s2"] table'));
  const heard = [];
  notes.on("change", (event) => heard.push(event));
  const revision = notes.revision;

  budget.set("B2", 25);
  expect([textAt(root, "s1", 5, 1), textAt(root, "s2", 0, 1)]).toEqual(["155", "310"]);
  expect(sheets.engine.computed).toBe(2);
  expect(heard.map((event) => event.source)).toEqual(["derived"]);
  expect(notes.revision).toBe(revision);

  const event = budget.insertRows("1", 1);
  expect(event.structure).toBe(true);
  expect(sheets.engine.computed).toBe(0);
  expect(budget.get("B7")).toBe(155);
  expect(root.querySelector('section[data-id="s2"] table').rows[0].cells[1].getAttribute("f")).toBe("=Budget!B7*2");
  expect(heard.map((one) => one.source)).toEqual(["derived", "workbook"]);
  expect(notes.revision).toBe(revision + 1);

  budget.apply(event.inverse);
  expect(root.querySelector('section[data-id="s2"] table').rows[0].cells[1].getAttribute("f")).toBe("=Budget!B6*2");
  expect([textAt(root, "s1", 5, 1), textAt(root, "s2", 0, 1)]).toEqual(["155", "310"]);
  expect(root.querySelectorAll("table[stale]")).toHaveLength(0);

  budget.insertRows("3", 1);
  expect(sheets.engine.computed).toBe(2);
  budget.set("B3", 5);
  expect([textAt(root, "s1", 6, 1), textAt(root, "s2", 0, 1)]).toEqual(["160", "320"]);
});

// The engine's cache of results drifting from a full computation: a result it keeps that a fresh
// engine would write, or writes another.
test("a full computation after every step finds the results the engine holds", () => {
  const faults = [];
  for (let seed = 1; seed <= 100; seed++) {
    for (const strict of [true, false]) {
      const bad = run(seed, { strict, computing: true, steps: 40 });
      if (bad === null) continue;
      if (strict || bad.fail.startsWith("E1")) faults.push({ strict, ...bad });
    }
  }
  expect(faults).toEqual([]);
}, 60000);
