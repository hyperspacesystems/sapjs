import { tableHtml } from "../../src/grid/codec/write.js";
import { createGrid, createSheets } from "../../src/grid/grid.js";
import { GridRefused } from "../../src/grid/ops.js";
import gridFunctions from "../../src/plugins/grid-functions.js";
import gridPlugin from "../../src/plugins/grid.js";
import Sap from "../../src/sap.js";

global.__SAP_KEEP_CONSOLE__ = true;

const KEYS = "ABCDEFGHIJ";
const number = (value) => ({ text: String(value), n: true });

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

// A page with two tabs: Budget totals five amounts, and Notes shows Budget's total and divides by
// zero. The tables are saved without results, as a host's write leaves them.
function page() {
  const root = document.createElement("main");
  const tab = (id, name, pos, sheet) => `<section item data-id="${id}" data-pos="${pos}"><h2 bind="name">${name}</h2>${tableHtml(sheet)}</section>`;
  root.innerHTML =
    tab("s1", "Budget", "A", sheetOf("s1", 6, 2, { "0,1": number(10), "1,1": number(20), "2,1": number(30), "3,1": number(40), "4,1": number(50), "5,0": { text: "Total" }, "5,1": { text: "", f: "=SUM(B1:B5)" } })) +
    tab("s2", "Notes", "B", sheetOf("s2", 2, 2, { "0,1": { text: "", f: "=Budget!B6*2" }, "1,1": { text: "", f: "=1/0" } }));
  document.body.replaceChildren(root);
  return root;
}

const tableIn = (root, id) => root.querySelector(`section[data-id="${id}"] table`);
const textAt = (root, id, r, c) => tableIn(root, id).rows[r].cells[c].textContent;

// A refused step that loses the refusal's code, or comes back as a value, is one a caller cannot
// tell from a bug.
test("a refused workbook step throws GridRefused with the refusal's code and changes no cell", () => {
  const root = page();
  const sheets = createSheets(root, { write: (fn) => fn() });
  const first = root.innerHTML;
  const budget = sheets.grid(tableIn(root, "s1"));
  const html = tableHtml(sheetOf("s3", 2, 2, { "0,0": { text: "x" } }));
  let caught = null;
  try {
    budget.apply({ v: 1, t: "insertSheet", sheet: { id: "s3", name: "BUDGET", pos: "C", html } });
  } catch (error) {
    caught = error;
  }
  expect(caught instanceof GridRefused).toBe(true);
  expect(caught.code).toBe("name_taken");
  expect(root.innerHTML).toBe(first);
});

// An inverse that leaves the results the step computed behind, or a stale mark the engine's own
// tab never carries, saves bytes the page did not have.
test("apply(event.inverse) gives back the page's bytes", () => {
  const root = page();
  const sheets = createSheets(root, { write: (fn) => fn() });
  const budget = sheets.grid(tableIn(root, "s1"));
  const first = root.innerHTML;
  expect([textAt(root, "s1", 5, 1), textAt(root, "s2", 0, 1)]).toEqual(["150", "300"]);

  const edited = budget.set("B2", 25);
  expect(textAt(root, "s1", 5, 1)).toBe("155");
  expect(root.innerHTML).not.toBe(first);
  budget.apply(edited.inverse);
  expect(root.innerHTML).toBe(first);

  const inserted = budget.insertRows("1", 1);
  expect(inserted.structure).toBe(true);
  expect(textAt(root, "s1", 6, 1)).toBe("150");
  expect(root.innerHTML).not.toBe(first);
  budget.apply(inserted.inverse);
  expect(root.innerHTML).toBe(first);
  expect(root.querySelectorAll("table[stale]")).toHaveLength(0);
});

// A Grid with no engine whose formula write leaves the tab unmarked gives a reader stale results it
// cannot tell, which the reducer's default must keep marking.
test("a Grid created with no engine keeps marking stale on a formula write", () => {
  const root = document.createElement("main");
  root.innerHTML = `<section item data-id="s1" data-pos="A"><h2 bind="name">Budget</h2>${tableHtml(sheetOf("s1", 3, 2, { "0,0": number(10), "1,0": number(20) }))}</section>`;
  document.body.replaceChildren(root);
  const table = tableIn(root, "s1");
  const plain = createGrid(table);
  expect(table.hasAttribute("stale")).toBe(false);
  plain.set("B1", "=SUM(A1:A2)");
  expect(table.hasAttribute("stale")).toBe(true);

  const shared = createSheets(page(), { write: (fn) => fn() });
  const budget = shared.grid(tableIn(document.body.firstElementChild, "s1"));
  budget.set("B2", "=SUM(B1:B2)");
  expect(tableIn(document.body.firstElementChild, "s1").hasAttribute("stale")).toBe(false);
});

// A page whose Grids are mounted without the engine hands Sap.grid(table) a Grid that computes
// nothing, so nothing another tab writes ever reaches it.
test("Sap.grid.sheets registers each table, so Sap.grid(table) returns the same Grid as the engine's", () => {
  Sap.use(gridPlugin);
  const root = page();
  const made = Sap.grid.sheets(root);
  const tables = [...root.querySelectorAll("section[item] > table[grid]")];
  expect(tables).toHaveLength(2);
  expect(tables.map((table) => Sap.grid(table) === made.grid(table))).toEqual([true, true]);
  expect(tables.map((table) => Sap.grid(table).sheet.id)).toEqual(["s1", "s2"]);

  // The Grid the plugin hands out is the engine's: a write on one tab computes the other's result.
  const heard = [];
  Sap.grid(tables[1]).on("change", (event) => heard.push(event.source));
  Sap.grid(tables[0]).set("B2", 25);
  expect([textAt(root, "s1", 5, 1), textAt(root, "s2", 0, 1), heard]).toEqual(["155", "310", ["derived"]]);
});

// Bug: a Grid the mount pass made before the page's engine existed stays the table's Grid, so
// edits on it compute nothing and a row insert is refused.
test("a Grid made before createSheets gives way to the engine's Grid", () => {
  const root = page();
  const early = createGrid(tableIn(root, "s1"), { write: (fn) => fn() });
  const sheets = createSheets(root, { write: (fn) => fn() });
  const budget = sheets.grid(tableIn(root, "s1"));
  expect(budget).not.toBe(early);
  budget.set("B2", 25);
  expect(textAt(root, "s2", 0, 1)).toBe("310");
});

// Bug: a rename of a tab no formula on it names changes no cell of its own tab, so apply returns null and the
// caller loses the inverse it needs to undo the rename.
test("a tab rename through a Grid returns its event, whose inverse takes it back", () => {
  const root = page();
  let scheduled = 0;
  const sheets = createSheets(root, { write: (fn) => fn(), schedule: () => { scheduled += 1; } });
  const budget = sheets.grid(tableIn(root, "s1"));
  const event = budget.apply({ v: 1, t: "renameSheet", sheet: "s1", name: "Plan" });
  expect(event).not.toBeNull();
  expect(scheduled).toBeGreaterThan(0);
  expect(tableIn(root, "s2").rows[0].cells[1].getAttribute("f")).toBe("=Plan!B6*2");
  budget.apply(event.inverse);
  expect(root.querySelector('section[data-id="s1"] h2').textContent).toBe("Budget");
  expect(tableIn(root, "s2").rows[0].cells[1].getAttribute("f")).toBe("=Budget!B6*2");
});

// Bug: a write from outside the Grid (another person's edit arriving, a host's patch) is taken
// into the mirror but the engine never hears it, so the totals keep the old numbers.
test("a write from outside the grid computes the formulas that read it", () => {
  const root = page();
  const sheets = createSheets(root, { write: (fn) => fn() });
  const budget = sheets.grid(tableIn(root, "s1"));
  const td = tableIn(root, "s1").rows[0].cells[1];
  td.textContent = "100";
  td.setAttribute("v", "100");
  budget.foreignWrite([td]);
  expect([textAt(root, "s1", 5, 1), textAt(root, "s2", 0, 1)]).toEqual(["240", "480"]);
});

// A page undo as the plugin's begin sees it: the DOM writes an edit made, reverted in reverse, and
// the touched nodes handed to the Grid. Writes made through `write` are not edits and not recorded.
function pageUndo(root) {
  const observer = new MutationObserver(() => {});
  observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true, attributeOldValue: true, characterDataOldValue: true });
  let seen = [];
  const write = (fn) => {
    seen.push(...observer.takeRecords());
    try {
      return fn();
    } finally {
      observer.takeRecords();
    }
  };
  const undo = () => {
    const records = [...seen, ...observer.takeRecords()];
    seen = [];
    const nodes = new Set();
    for (const record of records.reverse()) {
      nodes.add(record.target);
      if (record.type === "attributes") {
        if (record.oldValue === null) record.target.removeAttribute(record.attributeName);
        else record.target.setAttribute(record.attributeName, record.oldValue);
      } else if (record.type === "characterData") record.target.data = record.oldValue;
      else {
        for (const node of record.addedNodes) node.remove();
        for (const node of [...record.removedNodes].reverse()) record.target.insertBefore(node, record.nextSibling);
      }
    }
    observer.takeRecords();
    return [...nodes];
  };
  return { write, undo, clear: () => { seen = []; observer.takeRecords(); } };
}

// Bug: the result of a formula the step itself typed is written as a write that is not an edit,
// so a page undo of the typing puts the number back beside the result's text ("102010").
test("a page undo of typing a formula over a number gives the number and the totals back", () => {
  const root = page();
  const history = pageUndo(root);
  const sheets = createSheets(root, { write: history.write });
  const budget = sheets.grid(tableIn(root, "s1"));
  history.clear();
  budget.set("B1", "=B2+1000");
  expect(textAt(root, "s1", 5, 1)).toBe("1160");
  budget.foreignWrite(history.undo());
  expect([textAt(root, "s1", 0, 1), textAt(root, "s1", 5, 1)]).toEqual(["10", "150"]);
});

// Bug this guards: the extended pack built as its own plugin added its functions to a copy of the
// function table the grid's engine never reads, so =STDEV stayed #NAME? after it loaded.
test("installing grid-functions computes a sheet's waiting formulas and tells the tab", () => {
  Sap.use(gridPlugin);
  const root = page();
  Sap.grid.sheets(root);
  const tables = [...root.querySelectorAll("section[item] > table[grid]")];
  Sap.grid(tables[0]).set("A1", "=STDEV(B1:B2)");
  expect(textAt(root, "s1", 0, 0)).toBe("#NAME?");
  const heard = [];
  Sap.grid(tables[0]).on("change", (event) => heard.push(event.source));
  Sap.use(gridFunctions);
  expect([textAt(root, "s1", 0, 0), heard]).toEqual(["7.07106781186548", ["derived"]]);
});

// Bug this guards: a rebuild of the page's sheets (another tab renamed a tab) left the old engine
// listening, and when functions arrived it wrote its old =STDEV back over the number typed since.
test("an engine replaced by a rebuild writes nothing when functions arrive", () => {
  Sap.use(gridPlugin);
  const root = page();
  Sap.grid.sheets(root);
  Sap.grid(tableIn(root, "s1")).set("B1", "=TWICE(2)");
  Sap.grid.sheets(root);
  Sap.grid(tableIn(root, "s1")).set("B1", "5");
  const remove = Sap.grid.extend({ functions: [["TWICE", { run: ([x]) => 2 * x }]] });
  try {
    expect(textAt(root, "s1", 0, 1)).toBe("5");
  } finally {
    remove();
  }
});

// Bug this guards: a number typed under a custom code before the formats plugin kept its plain
// text when a formula on the same sheet used a custom code too, because the formula's redraw
// cleared the stale mark the table's own redraw waits for.
test("formatters arriving draw both the typed cells and the formulas of a stale table", () => {
  Sap.use(gridPlugin);
  const KG = '0.0 "kg"';
  const root = document.createElement("main");
  const sheet = { ...sheetOf("s1", 2, 1, { "0,0": { text: "30", n: true, fmt: KG }, "1,0": { text: "", f: "=A1*2", fmt: KG } }), stale: true };
  root.innerHTML = `<section item data-id="s1" data-pos="A"><h2 bind="name">Sheet</h2>${tableHtml(sheet)}</section>`;
  document.body.replaceChildren(root);
  const calls = [];
  // A host's write inside its quiet does not mark the file unsaved; only a write outside one does.
  let hushed = 0;
  const quiet = (fn) => { hushed += 1; try { fn(); } finally { hushed -= 1; } };
  createSheets(root, { write: (fn) => { if (hushed === 0) calls.push("write"); fn(); }, quiet });
  expect(tableIn(root, "s1").hasAttribute("stale")).toBe(true);
  calls.length = 0;
  const remove = Sap.grid.extend({ formatters: [{ test: (fmt) => fmt.endsWith('"kg"'), format: (value) => `${Number(value).toFixed(1)} kg`, kind: () => "number" }] });
  try {
    // Only the drawing changed, so nothing is written as an edit.
    expect([textAt(root, "s1", 0, 0), textAt(root, "s1", 1, 0), tableIn(root, "s1").hasAttribute("stale"), calls.includes("write")]).toEqual(["30.0 kg", "60.0 kg", false, false]);
  } finally {
    remove();
  }
});

// Bug this guards: grid-functions read the grid from window.Sap, which a page that loads the plugin
// files before sap.js does not have yet, so setup threw and the plugin never installed.
test("grid-functions reaches the grid through the kit, before window.Sap exists", () => {
  const saved = globalThis.Sap;
  delete globalThis.Sap;
  try {
    let added = null;
    const kit = { plugin: (name) => (name === "grid" ? { grid: { extend: (parts) => ((added = parts), () => {}) } } : null) };
    const made = gridFunctions.setup(kit);
    expect([added.functions.some(([name]) => name === "STDEV"), typeof made.dispose]).toEqual([true, "function"]);
  } finally {
    globalThis.Sap = saved;
  }
});
