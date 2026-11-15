import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { colName } from "../../src/grid/a1.js";
import { domBacking } from "../../src/grid/backing-dom.js";
import { modelBacking } from "../../src/grid/backing-model.js";
import { buildClear, buildFormat, buildMerge, buildSet, buildSetRange, buildUnmerge } from "../../src/grid/build.js";
import { gridModel } from "../../src/grid/codec/read.js";
import { cellValue } from "../../src/grid/codec/value.js";
import { cellHtml, tableHtml } from "../../src/grid/codec/write.js";
import { derive } from "../../src/grid/content.js";
import { derivePlain } from "../../src/grid/derive-plain.js";
import { normalizeSheet } from "../../src/grid/normalize.js";
import { apply, GridRefused } from "../../src/grid/ops.js";
import { rng } from "../grid-codec/support/rng.js";
import { agentHiddenText, agentSheet } from "./support/agent-sheet.js";
import { genAction } from "./support/gen-actions.js";
import { listTables, splitTables } from "./support/laws.js";
import { sameTree } from "./support/same-tree.js";

global.__SAP_KEEP_CONSOLE__ = true;

const GOLDEN = join(__dirname, "..", "grid-codec", "golden");
const SEED = 20261201;
const LISTS = 300;
const LENGTH = 16;
const REQUESTS = 60;
const LARGE = 400;

const NONE = { seen: 0, paused: 0, pauses: 0 };

const clone = (value) => JSON.parse(JSON.stringify(value));

const pick = (rand, n) => Math.floor(rand() * n);
const pickOf = (rand, list) => list[pick(rand, list.length)];

const unstale = (bytes) => bytes.replace(/^(<table grid(?: freeze-cols="[0-9]+")?) stale/, "$1");

const rowLine = (bytes, id) => bytes.split("\n").find((line) => line.includes(`data-id="${id}"`));

function firstDifference(live, model) {
  const left = live.split("\n");
  const right = model.split("\n");
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] !== right[i]) return { line: i, live: left[i] ?? null, model: right[i] ?? null };
  }
  return null;
}

function goldenTables() {
  const files = readdirSync(GOLDEN).filter((name) => name.endsWith(".html")).sort();
  const tables = [];
  for (const file of files) {
    splitTables(readFileSync(join(GOLDEN, file), "utf8")).forEach((src, index) => {
      tables.push({ name: `${file.replace(/\.html$/, "")}#${index}`, model: gridModel(src, 0) });
    });
  }
  return tables;
}

// The tables a list runs on: every golden table and the agent's sheet after the declared repair,
// except a table with no row or no column, which has no cell to write.
function cleanTables() {
  const tables = goldenTables();
  tables.push({ name: "agent", model: agentSheet(), hiddenText: agentHiddenText });
  return tables
    .map((table) => ({ name: table.name, model: normalizeSheet(clone(table.model), { derive, hiddenText: table.hiddenText }).sheet }))
    .filter((table) => table.model.rows.length > 0 && table.model.cols.length > 0);
}

const BUDGET = tableHtml(goldenTables().find((table) => table.name === "tiny#0").model);

const observers = [];

afterEach(() => {
  for (const observer of observers.splice(0)) observer.disconnect();
  document.body.innerHTML = "";
});

// A live table parsed from bytes, a backing over it, and the counts a test reads: the mutation
// records made by ordinary writes (`seen`), the ones made inside `write` (`paused`) and how many
// times `write` ran (`pauses`). `write` works as the plugin kit's does on a page with no mutation
// hub: what was queued before it started was written outside it, and what its function queues is
// taken away before anyone is told. `records()` returns the counts since the last call.
function live(bytes, options) {
  document.body.innerHTML = bytes;
  const table = document.body.firstElementChild;
  const observer = new MutationObserver(() => {});
  observer.observe(table, { childList: true, subtree: true, attributes: true, characterData: true });
  observers.push(observer);
  let counts = { ...NONE };
  const settle = () => {
    counts.seen += observer.takeRecords().length;
  };
  const write = (fn) => {
    settle();
    counts.pauses += 1;
    try {
      return fn();
    } finally {
      counts.paused += observer.takeRecords().length;
    }
  };
  const backing = domBacking(table, { write, ...options });
  const records = () => {
    settle();
    const out = counts;
    counts = { ...NONE };
    return out;
  };
  const cell = (rowId, c) => table.querySelector(`tr[data-id="${rowId}"]`).children[c];
  const cells = (rowId) => table.querySelector(`tr[data-id="${rowId}"]`).children.length;
  return { table, backing, records, cell, cells };
}

const attributeNames = (node) => Array.from(node.attributes, (attribute) => attribute.name).sort();

const agrees = (page) => {
  expect(tableHtml(page.backing.sheet)).toBe(page.backing.bytes());
  expect(sameTree(page.table)).toEqual([]);
};

test("a live table is read into the mirror and nothing is written", () => {
  const tables = goldenTables();
  expect(tables.length).toBeGreaterThanOrEqual(9);
  let rows = 0;
  for (const { name, model } of tables) {
    const bytes = tableHtml(model);
    const page = live(bytes);
    expect([name, page.records()]).toEqual([name, NONE]);
    expect([name, page.backing.bytes() === bytes]).toEqual([name, true]);
    expect([name, tableHtml(page.backing.sheet) === bytes]).toEqual([name, true]);
    expect([name, page.backing.sheet.cols]).toEqual([name, model.cols]);
    expect([name, page.backing.sheet.rows.length]).toEqual([name, model.rows.length]);
    expect([name, sameTree(page.table)]).toEqual([name, []]);
    // Each row of the mirror reads as the row element the backing holds for it.
    for (let r = 0; r < model.rows.length; r += 1 + Math.floor(model.rows.length / 40)) {
      expect([name, r, page.backing.rows()[r]]).toEqual([name, r, model.rows[r]]);
      expect([name, r, page.backing.read([r])]).toEqual([name, r, null]);
      rows += 1;
    }
    expect([name, page.records()]).toEqual([name, NONE]);
  }
  expect(rows).toBeGreaterThan(100);

  const { backing } = live(BUDGET, { sheetId: "s1" });
  expect(backing.sheetId).toBe("s1");
  expect(backing.table).toBe(document.body.firstElementChild);
  expect(backing.rows().map((row) => row.id)).toEqual(["r1", "r2", "r3", "r4", "r5", "r6"]);
  expect(backing.cols().map((col) => col.id)).toEqual(["ca", "cb", "cc"]);
  expect([backing.rowIndex("r5"), backing.rowIndex("nope"), backing.colIndex("cc"), backing.colIndex("r5")]).toEqual([4, -1, 2, -1]);
  expect(backing.frozen()).toEqual({ rows: 1, cols: 1 });
  expect(backing.hasFormula()).toBe(true);
  expect(backing.cell(0, 0)).toEqual({ text: "Item", style: "font-weight:bold" });
  expect(backing.cell(1, 1)).toEqual({ text: "$1,200.00", n: true, v: "1200" });
  expect(backing.cell(3, 0)).toBe(null);
  expect(backing.cell(5, 1)).toEqual({ text: "", hidden: true });
});

test("putCell writes the mirror and the table together", () => {
  const page = live(BUDGET);
  const { backing } = page;
  backing.putCell(1, 0, { text: "Lease", style: "font-style:italic" });
  expect(backing.cell(1, 0)).toEqual({ text: "Lease", style: "font-style:italic" });
  expect(rowLine(backing.bytes(), "r2")).toBe(
    '<tr data-id="r2" data-pos="G"><td style="font-style:italic">Lease</td><td n v="1200">$1,200.00</td><td n f="=B2/B$5" v="0.8">80%</td></tr>',
  );
  agrees(page);

  // The frozen row is the first row of the mirror and the row of the thead.
  backing.putCell(0, 1, { text: "Price" });
  expect(backing.cell(0, 1)).toEqual({ text: "Price" });
  expect(page.cell("r1", 1).textContent).toBe("Price");

  // A formula cell loses its formula and the table says it holds one fewer.
  backing.putCell(1, 2, { text: "0.8", n: true });
  backing.putCell(2, 2, null);
  expect(backing.hasFormula()).toBe(true);
  backing.putCell(4, 1, { text: "1500", n: true });
  expect(backing.hasFormula()).toBe(false);
  agrees(page);
});

test("putCell removes the attributes the new cell does not have", () => {
  const page = live(BUDGET);
  const { backing } = page;
  backing.putCell(3, 1, { text: "007", t: true, fmt: "@", style: "color:#c00" });
  const td = page.cell("r4", 1);
  expect(td.outerHTML).toBe('<td t="" fmt="@" style="color:#c00">007</td>');
  backing.putCell(3, 1, { text: "7.00", n: true, v: "7", fmt: "0.00" });
  expect(page.cell("r4", 1)).toBe(td);
  expect(attributeNames(td)).toEqual(["fmt", "n", "v"]);
  expect(rowLine(backing.bytes(), "r4")).toBe('<tr data-id="r4" data-pos="V"><td></td><td n v="7" fmt="0.00">7.00</td></tr>');

  backing.putCell(3, 1, { text: "", f: "=A1", colspan: 2, rowspan: 2 });
  expect(td.outerHTML).toBe('<td f="=A1" colspan="2" rowspan="2"></td>');
  backing.putCell(3, 1, { text: "", hidden: true });
  expect(td.outerHTML).toBe('<td hidden=""></td>');
  backing.putCell(3, 1, { text: "plain" });
  expect(td.outerHTML).toBe("<td>plain</td>");
  agrees(page);

  // A flag a hand wrote with a value, and markup inside the cell, go when the cell is written.
  td.setAttribute("n", "1");
  td.innerHTML = "<b>9</b>";
  backing.rescan();
  backing.putCell(3, 1, { text: "9", n: true, style: "color:#c00" });
  expect(td.outerHTML).toBe('<td n="" style="color:#c00">9</td>');
  agrees(page);
});

test("putCell pads a short row and drops the empty cells at a row's end", () => {
  const page = live(BUDGET);
  const { backing } = page;
  backing.putCell(3, 2, { text: "Tip" });
  expect(page.cells("r4")).toBe(3);
  expect(rowLine(backing.bytes(), "r4")).toBe('<tr data-id="r4" data-pos="V"><td></td><td></td><td>Tip</td></tr>');
  agrees(page);

  backing.putCell(3, 2, null);
  expect(page.cells("r4")).toBe(0);
  expect(backing.cell(3, 2)).toBe(null);
  expect(backing.rows()[3].cells).toEqual([]);
  agrees(page);

  // A cleared cell in the middle keeps its place, and the last cell takes the empty ones with it.
  backing.putCell(1, 1, null);
  expect(page.cells("r2")).toBe(3);
  expect(page.cell("r2", 1).outerHTML).toBe("<td></td>");
  backing.putCell(1, 2, null);
  expect(page.cells("r2")).toBe(1);
  expect(backing.rows()[1].cells).toEqual([{ text: "Rent" }]);
  agrees(page);

  // A clear past the row's end has nothing to do.
  page.records();
  backing.putCell(1, 2, null);
  expect(page.records()).toEqual(NONE);
  expect(page.cells("r2")).toBe(1);
});

test("a putCell that changes nothing writes nothing", () => {
  const page = live(BUDGET);
  const { backing } = page;
  let puts = 0;
  backing.rows().forEach((row, r) => {
    for (let c = 0; c < 3; c++) {
      backing.putCell(r, c, clone(backing.cell(r, c)));
      puts += 1;
    }
  });
  backing.putCell(3, 0, { text: "" });
  expect(puts).toBe(18);
  expect(page.records()).toEqual(NONE);
  expect(backing.bytes()).toBe(BUDGET);
  expect(backing.cell(3, 0)).toBe(null);
});

test("a content or format write is announced and a derived write is paused", () => {
  const page = live(BUDGET);
  const { backing } = page;

  backing.putCell(1, 0, { text: "Lease" });
  expect(page.records()).toEqual({ seen: 1, paused: 0, pauses: 0 });
  backing.putCell(1, 0, { text: "Lease", style: "font-weight:bold" });
  expect(page.records()).toEqual({ seen: 1, paused: 0, pauses: 0 });
  backing.putCell(1, 1, { text: "1200.00", n: true, v: "1200", fmt: "0.00" });
  expect(page.records()).toEqual({ seen: 2, paused: 0, pauses: 0 });
  backing.putCell(3, 0, { text: "5", n: true });
  expect(page.records()).toEqual({ seen: 3, paused: 0, pauses: 0 });
  backing.putCell(3, 0, { text: "5", t: true });
  expect(page.records()).toEqual({ seen: 2, paused: 0, pauses: 0 });
  backing.putCell(4, 0, { text: "Total", colspan: 2, style: "font-weight:bold" });
  expect(page.records()).toEqual({ seen: 1, paused: 0, pauses: 0 });
  backing.putCell(4, 1, { text: "", hidden: true });
  expect(page.records().paused).toBe(0);

  // The same value shown another way, as after a column's format changes.
  backing.putCell(2, 1, { text: "300.00", n: true, v: "300" });
  expect(page.records()).toEqual({ seen: 0, paused: 1, pauses: 1 });
  // A formula's result.
  backing.putCell(2, 2, { text: "25%", n: true, f: "=B3/B$5", v: "0.25" });
  expect(page.records()).toEqual({ seen: 0, paused: 2, pauses: 1 });
  // A mark the value does not need.
  backing.putCell(2, 0, { text: "Food", t: true });
  expect(page.records()).toEqual({ seen: 0, paused: 1, pauses: 1 });
  agrees(page);
});

test("setStale marks the table inside the paused path", () => {
  const page = live(BUDGET);
  const { backing, table } = page;
  backing.setStale(true);
  expect(table.getAttribute("stale")).toBe("");
  expect(backing.sheet.stale).toBe(true);
  expect(backing.bytes().startsWith('<table grid freeze-cols="1" stale>')).toBe(true);
  expect(page.records()).toEqual({ seen: 0, paused: 1, pauses: 1 });
  agrees(page);

  backing.setStale(true);
  expect(page.records()).toEqual(NONE);

  backing.setStale(false);
  expect(table.hasAttribute("stale")).toBe(false);
  expect(backing.sheet.stale).toBe(undefined);
  expect(backing.bytes()).toBe(BUDGET);
  expect(page.records()).toEqual({ seen: 0, paused: 1, pauses: 1 });

  backing.setStale(false);
  expect(page.records()).toEqual(NONE);
});

test("the touched rows are read before a write", () => {
  const page = live(BUDGET, { sheetId: "s1" });
  const { backing } = page;
  const td = page.cell("r3", 0);
  td.textContent = "Bread";
  page.records();

  const action = { v: 1, t: "set", sheet: "s1", cells: [["r3", "ca", "Milk"]] };
  const foreign = backing.read(backing.touched(action));
  const out = apply(backing, action, { derive });

  expect(out.inverse).toEqual({ v: 1, t: "set", sheet: "s1", cells: [["r3", "ca", "Bread", { fmt: null }]] });
  expect(out.changes.cells).toEqual([{ sheet: "s1", row: "r3", col: "ca", before: "Bread", after: "Milk" }]);
  expect(foreign).toEqual({ rows: [], cells: [{ row: "r3", col: "ca", before: { text: "Food" }, after: { text: "Bread" } }] });
  expect(td.textContent).toBe("Milk");
  expect(page.records()).toEqual({ seen: 1, paused: 0, pauses: 0 });

  expect(apply(backing, out.inverse, { derive }).out).toBe("applied");
  expect(td.textContent).toBe("Bread");
  agrees(page);
});

test("read takes a foreign write into the mirror as the codec reads it", () => {
  const page = live(BUDGET);
  const { backing } = page;
  expect(backing.read([0, 1, 2, 3, 4, 5])).toBe(null);

  // Text over a formatted number: the file's value rule still reads the `v`.
  page.cell("r2", 1).textContent = "5";
  // An attribute, a cell added to a short row, and a cell removed from the end of another.
  page.cell("r3", 0).setAttribute("style", "color:#c00");
  page.table.querySelector('tr[data-id="r4"]').innerHTML = "<td>new</td><td></td><td></td><td>past the last column</td>";
  page.cell("r5", 1).remove();
  // A row's own style.
  page.table.querySelector('tr[data-id="r3"]').setAttribute("style", "height:30px");
  page.records();

  // Only the rows asked for are read.
  expect(backing.read([1])).toEqual({
    rows: [],
    cells: [{ row: "r2", col: "cb", before: { text: "$1,200.00", n: true, v: "1200" }, after: { text: "5", n: true, v: "1200" } }],
  });
  expect(backing.cell(1, 1)).toEqual({ text: "5", n: true, v: "1200" });
  expect(backing.cell(2, 0)).toEqual({ text: "Food" });
  expect(backing.read([1])).toBe(null);

  const found = backing.read([2, 3, 4, 5]);
  expect(found).toEqual({
    rows: [{ row: "r3", before: { id: "r3", pos: "O" }, after: { id: "r3", pos: "O", style: "height:30px" } }],
    cells: [
      { row: "r3", col: "ca", before: { text: "Food" }, after: { text: "Food", style: "color:#c00" } },
      { row: "r4", col: "ca", before: null, after: { text: "new" } },
      { row: "r4", col: null, before: null, after: { text: "past the last column" } },
      { row: "r5", col: "cb", before: { text: "$1,500.00", n: true, f: "=SUM(B2:B3)", v: "1500" }, after: null },
    ],
  });
  expect(backing.rows()[2].style).toBe("height:30px");
  expect(backing.rows()[3].cells).toEqual([{ text: "new" }, null, null, { text: "past the last column" }]);
  // The answer is the reader's to keep: changing it does not change the mirror.
  found.cells[1].after.text = "changed";
  expect(backing.cell(3, 0)).toEqual({ text: "new" });
  expect(backing.hasFormula()).toBe(true);
  expect(tableHtml(backing.sheet)).toBe(backing.bytes());
  expect(backing.read([0, 1, 2, 3, 4, 5])).toBe(null);
  expect(page.records()).toEqual(NONE);

  // A style a hand takes off a row is taken off the mirror's row.
  page.table.querySelector('tr[data-id="r3"]').removeAttribute("style");
  expect(backing.read([2])).toEqual({ rows: [{ row: "r3", before: { id: "r3", pos: "O", style: "height:30px" }, after: { id: "r3", pos: "O" } }], cells: [] });
  expect("style" in backing.rows()[2]).toBe(false);

  // The frozen row reads as the frozen row it is.
  page.cell("r1", 2).textContent = "Part";
  expect(backing.read([0])).toEqual({ rows: [], cells: [{ row: "r1", col: "cc", before: { text: "Share" }, after: { text: "Part" } }] });
  expect(backing.rows()[0].frozen).toBe(true);
});

test("a row whose id, position key or group changed makes the backing read the table again", () => {
  // A live sync patch can reuse a row's element for another row. An index of the mirror would
  // then name the wrong row, so nothing of the mirror is kept.
  const renamed = live(BUDGET);
  const r5 = renamed.table.querySelector('tr[data-id="r5"]');
  const r6 = renamed.table.querySelector('tr[data-id="r6"]');
  r5.setAttribute("data-id", "r6");
  r6.setAttribute("data-id", "r5");
  renamed.cell("r2", 0).textContent = "Lease";
  expect(renamed.backing.read([4])).toEqual({ rows: [], cells: [], rescanned: true });
  expect([renamed.backing.rowIndex("r6"), renamed.backing.rowIndex("r5")]).toEqual([4, 5]);
  expect(renamed.backing.cell(1, 0)).toEqual({ text: "Lease" });
  expect(tableHtml(renamed.backing.sheet)).toBe(renamed.backing.bytes());
  expect(renamed.records()).toEqual({ seen: 3, paused: 0, pauses: 0 });

  // A write by id after it lands on the element that holds the id now.
  const out = apply(renamed.backing, { v: 1, t: "set", sheet: "s", cells: [["r5", "ca", "Note"]] }, { derive });
  expect(out.out).toBe("applied");
  expect(r6.firstElementChild.textContent).toBe("Note");
  expect(r5.firstElementChild.textContent).toBe("Total");

  const keyed = live(BUDGET);
  keyed.table.querySelector('tr[data-id="r3"]').setAttribute("data-pos", "P");
  keyed.cell("r5", 0).textContent = "Sum";
  expect(keyed.backing.read([2])).toEqual({ rows: [], cells: [], rescanned: true });
  expect(keyed.backing.rows()[2].pos).toBe("P");
  expect(keyed.backing.cell(4, 0)).toEqual({ text: "Sum", style: "font-weight:bold" });

  const regrouped = live(BUDGET);
  regrouped.table.tHead.appendChild(regrouped.table.querySelector('tr[data-id="r2"]'));
  expect(regrouped.backing.read([1])).toEqual({ rows: [], cells: [], rescanned: true });
  expect(regrouped.backing.frozen()).toEqual({ rows: 2, cols: 1 });
  expect(tableHtml(regrouped.backing.sheet)).toBe(regrouped.backing.bytes());
});

test("a column, a frozen column count or a stale mark that changed makes the backing read the table again", () => {
  // A column put in by a hand or by a live sync patch moves every cell after it. A write by
  // column id must land in the cell that holds the id now.
  const page = live(BUDGET, { sheetId: "s1" });
  const { backing, table } = page;
  const added = document.createElement("col");
  added.setAttribute("data-id", "cx");
  added.setAttribute("data-pos", "K");
  table.querySelector('col[data-id="cb"]').before(added);
  for (const id of ["r1", "r2", "r3", "r5"]) page.cell(id, 0).after(document.createElement("td"));
  page.records();

  const action = { v: 1, t: "set", sheet: "s1", cells: [["r3", "cb", 9]] };
  expect(backing.read(backing.touched(action))).not.toBe(null);
  expect(backing.cols().map((col) => col.id)).toEqual(["ca", "cx", "cb", "cc"]);
  expect(tableHtml(backing.sheet)).toBe(backing.bytes());
  const out = apply(backing, action, { derive });
  expect(out.inverse.cells).toEqual([["r3", "cb", 300, { fmt: null }]]);
  expect(Array.from(table.querySelector('tr[data-id="r3"]').children, (td) => td.textContent)).toEqual(["Food", "", "$9.00", "20%"]);
  expect(backing.read([0, 1, 2, 3, 4, 5])).toBe(null);

  // A column's own fields.
  added.setAttribute("fmt", "0.0");
  table.querySelector('col[data-id="ca"]').setAttribute("style", "width:90px");
  expect(backing.read([])).not.toBe(null);
  expect(backing.cols().slice(0, 2)).toEqual([{ id: "ca", pos: "G", width: 90 }, { id: "cx", pos: "K", fmt: "0.0" }]);
  expect(backing.read([])).toBe(null);

  table.setAttribute("freeze-cols", "2");
  expect(backing.read([])).not.toBe(null);
  expect(backing.frozen()).toEqual({ rows: 1, cols: 2 });

  table.setAttribute("stale", "");
  expect(backing.read([])).not.toBe(null);
  expect(backing.sheet.stale).toBe(true);
  expect(backing.read([])).toBe(null);

  added.remove();
  expect(backing.read([])).not.toBe(null);
  expect(backing.cols().map((col) => col.id)).toEqual(["ca", "cb", "cc"]);
});

test("rows are found in the tree reader's order whatever the table's groups", () => {
  document.body.innerHTML =
    "<table grid><colgroup><col data-id=\"ca\" data-pos=\"V\"></colgroup>" +
    "<tbody><tr data-id=\"r1\" data-pos=\"c\"><td>1</td></tr><tr data-id=\"r2\" data-pos=\"d\"><td>2</td></tr></tbody>" +
    "<thead><tr data-id=\"h1\" data-pos=\"a\"><td>3</td></tr></thead>" +
    "<tfoot><tr data-id=\"f1\" data-pos=\"e\"><td>4</td></tr></tfoot>" +
    "<tbody><tr data-id=\"r3\" data-pos=\"f\"><td>5</td></tr></tbody>" +
    "<thead><tr data-id=\"h2\" data-pos=\"b\"><th>6</th></tr></thead></table>";
  const table = document.body.firstElementChild;
  const bare = document.createElement("tr");
  bare.setAttribute("data-id", "b1");
  bare.setAttribute("data-pos", "g");
  table.appendChild(bare);
  expect(Array.from(table.children, (part) => part.localName)).toEqual(["colgroup", "tbody", "thead", "tfoot", "tbody", "thead", "tr"]);

  const backing = domBacking(table);
  const ids = ["h1", "h2", "r1", "r2", "f1", "r3", "b1"];
  expect(backing.rows().map((row) => row.id)).toEqual(ids);
  expect(backing.frozen().rows).toBe(2);
  expect(backing.read([0, 1, 2, 3, 4, 5, 6])).toBe(null);

  ids.forEach((id, r) => backing.putCell(r, 0, { text: `row ${id}` }));
  for (const id of ids) expect(table.querySelector(`tr[data-id="${id}"]`).textContent).toBe(`row ${id}`);
  expect(table.querySelector('tr[data-id="h2"]').innerHTML).toBe("<th>row h2</th>");
  expect(backing.read([0, 1, 2, 3, 4, 5, 6])).toBe(null);
  expect(tableHtml(backing.sheet)).toBe(backing.bytes());
});

test("a touched row that left the table makes the backing read the table again", () => {
  const action = { v: 1, t: "set", sheet: "s1", cells: [["r3", "ca", "Milk"]] };

  // The row is in another table now.
  const moved = live(BUDGET, { sheetId: "s1" });
  const other = document.createElement("table");
  other.appendChild(document.createElement("tbody")).appendChild(moved.table.querySelector('tr[data-id="r3"]'));
  expect(moved.backing.read(moved.backing.touched(action))).toEqual({ rows: [], cells: [], rescanned: true });
  expect(moved.backing.rows().map((row) => row.id)).toEqual(["r1", "r2", "r4", "r5", "r6"]);

  // The row is in no table.
  const page = live(BUDGET, { sheetId: "s1" });
  const { backing } = page;
  page.table.querySelector('tr[data-id="r3"]').remove();
  page.cell("r5", 0).textContent = "Sum";
  page.records();

  expect(backing.read(backing.touched(action))).toEqual({ rows: [], cells: [], rescanned: true });
  expect(backing.rows().map((row) => row.id)).toEqual(["r1", "r2", "r4", "r5", "r6"]);
  expect(backing.cell(3, 0)).toEqual({ text: "Sum", style: "font-weight:bold" });
  expect(tableHtml(backing.sheet)).toBe(backing.bytes());

  const out = apply(backing, action, { derive });
  expect([out.out, out.code]).toEqual(["refused", "missing_row"]);
  expect(page.records()).toEqual(NONE);
});

test("rescan reads the table again", () => {
  const page = live(BUDGET);
  const { backing, table } = page;
  page.cell("r2", 0).textContent = "Lease";
  const added = table.querySelector('tr[data-id="r6"]').cloneNode(false);
  added.setAttribute("data-id", "r7");
  added.setAttribute("data-pos", "p");
  table.tBodies[0].appendChild(added);
  table.querySelector('tr[data-id="r4"]').remove();
  table.setAttribute("stale", "");
  page.records();
  expect(backing.cell(1, 0)).toEqual({ text: "Rent" });

  expect(backing.rescan()).toBe(true);
  expect(backing.rescan()).toBe(false);
  expect(page.records()).toEqual(NONE);
  expect(backing.cell(1, 0)).toEqual({ text: "Lease" });
  expect(backing.rows().map((row) => row.id)).toEqual(["r1", "r2", "r3", "r5", "r6", "r7"]);
  expect(backing.sheet.stale).toBe(true);
  expect(tableHtml(backing.sheet)).toBe(backing.bytes());

  // A write after it lands on the row elements the table holds now.
  backing.putCell(5, 1, { text: "last" });
  backing.putCell(3, 0, { text: "Sum" });
  expect(added.outerHTML).toBe('<tr data-id="r7" data-pos="p"><td></td><td>last</td></tr>');
  expect(page.cell("r5", 0).textContent).toBe("Sum");
  expect(tableHtml(backing.sheet)).toBe(backing.bytes());

  // The backing's own writes are in the mirror, so a scan after them finds no difference. One
  // foreign write of any kind is a difference.
  backing.putCell(1, 2, null);
  backing.setStale(false);
  expect(backing.rescan()).toBe(false);
  const edits = [
    () => page.cell("r2", 0).setAttribute("style", "color:#c00"),
    () => table.querySelector('tr[data-id="r3"]').setAttribute("style", "height:30px"),
    () => table.querySelector("col").setAttribute("fmt", "0.0"),
    () => table.setAttribute("freeze-cols", "2"),
    () => table.querySelector('tr[data-id="r3"]').appendChild(document.createElement("td")).append("x"),
    () => table.querySelector('tr[data-id="r7"]').remove(),
  ];
  for (const edit of edits) {
    edit();
    expect(backing.rescan()).toBe(true);
    expect(backing.rescan()).toBe(false);
  }
});

test("touched names the rows of a set, a format and a batch", () => {
  const { backing } = live(BUDGET, { sheetId: "s1" });
  const set = { v: 1, t: "set", sheet: "s1", cells: [["r5", "ca", 1], ["r2", "cb", 2], ["r5", "cb", 3], ["nope", "ca", 4], ["r1", "cc", 5]] };
  const format = { v: 1, t: "format", sheet: "s1", cells: [["r3", "ca", { fmt: "0%" }]] };
  expect(backing.touched(set)).toEqual([4, 1, 0]);
  expect(backing.touched(format)).toEqual([2]);
  expect(backing.touched({ v: 1, t: "batch", actions: [format, set] })).toEqual([2, 4, 1, 0]);
  expect(backing.touched({ v: 1, t: "set", sheet: "s1", cells: [["nope", "ca", 4]] })).toEqual([]);

  // Every row a merge covers is among the rows it touches.
  const merge = { v: 1, t: "merge", sheet: "s1", from: ["r2", "ca"], to: ["r3", "ca"], clears: [["r3", "ca"]] };
  expect(backing.touched(merge)).toEqual(expect.arrayContaining([1, 2]));

  // An action the reducer will refuse for its shape still gets an answer.
  for (const shape of [null, 5, "set", [], {}, { t: "set" }, { t: "set", cells: [null, 5, ["r2"], [{}]] }, { t: "batch" }, { t: "batch", actions: [null] }]) {
    expect(Array.isArray(backing.touched(shape))).toBe(true);
  }
  expect(backing.touched({ t: "set", cells: [null, 5, ["r2"], [{}]] })).toEqual([1]);
});

const contentKey = (cell) => {
  if (!cell || cell.hidden) return "null";
  if (cell.f !== undefined) return `f ${cell.f}`;
  const value = cellValue(cell);
  return `${typeof value} ${String(value)}`;
};

const RANK = { none: 0, derived: 1, edit: 2 };

// What an applied action did, read from the model alone: an edit when some cell's content or one
// of its format fields changed, derived when only other bytes changed, and none when no byte did.
function kindOfChange(before, after) {
  let kind = Boolean(before.stale) === Boolean(after.stale) ? "none" : "derived";
  for (let r = 0; r < after.rows.length; r++) {
    const was = before.rows[r].cells;
    const is = after.rows[r].cells;
    for (let c = 0; c < Math.max(was.length, is.length); c++) {
      const a = was[c] ?? null;
      const b = is[c] ?? null;
      if (contentKey(a) !== contentKey(b)) return "edit";
      for (const field of ["fmt", "style", "colspan", "rowspan", "hidden"]) if (a?.[field] !== b?.[field]) return "edit";
      for (const field of ["text", "n", "t", "v"]) if ((a?.[field] ?? "") !== (b?.[field] ?? "")) kind = "derived";
    }
  }
  return kind;
}

// A batch is its members in order, and one member can put back what another changed, so each
// member is judged on its own.
function kindOf(before, after, action) {
  if (action.t !== "batch") return kindOfChange(before, after);
  const scratch = modelBacking(before, { sheetId: null });
  let kind = "none";
  for (const one of action.actions) {
    const was = clone(scratch.sheet);
    apply(scratch, one, { derive });
    const next = kindOfChange(was, scratch.sheet);
    if (RANK[next] > RANK[kind]) kind = next;
  }
  return kind;
}

// Two derived cells are the same when they are written as the same bytes.
const sameSaved = (a, b) => (a === null || b === null ? a === b : cellHtml(a) === cellHtml(b));

const contentsOf = (action) => (action.t === "batch" ? action.actions.flatMap(contentsOf) : action.t === "set" ? action.cells.map((entry) => entry[2]) : []);

// One table as a model backing and as a live table. `step` applies an action on both and
// returns null, or the first thing that differs. `undo` applies every inverse, last first.
function twins(name, start, counts) {
  const model = modelBacking(clone(start), { sheetId: null });
  const page = live(tableHtml(start));
  const dom = page.backing;
  const large = start.rows.length * start.cols.length > LARGE;
  const inverses = [];
  const fail = (check, action, detail) => ({ check, table: name, action, detail });

  const count = (kind, what) => {
    counts[kind] = counts[kind] ?? {};
    counts[kind][what] = (counts[kind][what] ?? 0) + 1;
  };

  const tree = () => {
    const found = sameTree(page.table);
    if (found.length > 0) return fail("the live table is the tree its bytes parse to", null, found);
    return dom.rescan() ? fail("a scan of the whole table finds what the mirror has", null, null) : null;
  };

  const step = (action) => {
    const was = clone(model.sheet);
    const foreign = dom.read(dom.touched(action));
    if (foreign !== null) return fail("the backing's own writes are not read as foreign", action, foreign);
    const left = apply(model, action, { derive });
    const right = apply(dom, action, { derive });
    const made = page.records();
    if (JSON.stringify(right) !== JSON.stringify(left)) return fail("the live table answers as the model does", action, { live: right, model: left });

    const bytes = tableHtml(model.sheet);
    const liveBytes = dom.bytes();
    if (liveBytes !== bytes) return fail("the live table's bytes are the model's", action, firstDifference(liveBytes, bytes));
    const mirrorBytes = tableHtml(dom.sheet);
    if (mirrorBytes !== bytes) return fail("the mirror's bytes are the model's", action, firstDifference(mirrorBytes, bytes));
    if (!large) {
      const found = sameTree(page.table, liveBytes);
      if (found.length > 0) return fail("the live table is the tree its bytes parse to", action, found);
    }

    const applied = left.out === "applied";
    const kind = applied ? kindOf(was, model.sheet, action) : "none";
    count(action.t, applied ? kind : "refused");
    const fits =
      kind === "edit" ? made.seen > 0 : kind === "derived" ? made.seen === 0 && made.paused > 0 : made.seen === 0 && made.paused === 0 && made.pauses === 0;
    if (!fits) return fail("an edit is announced, a derived write is paused and no other write is made", action, { kind, records: made });

    if (applied) {
      inverses.push(left.inverse);
      for (const content of contentsOf(action)) {
        count("content", "compared");
        if (!sameSaved(derive(content, null), derivePlain(content, null))) {
          return fail("derive with no format writes what derivePlain writes", action, content);
        }
      }
    }
    return null;
  };

  const undo = () => {
    for (const inverse of inverses.splice(0).reverse()) {
      const failure = step(inverse);
      if (failure !== null) return failure;
      if (inverses.pop() === undefined) return fail("an inverse applies", inverse, null);
    }
    const end = unstale(dom.bytes());
    const first = unstale(tableHtml(start));
    if (end !== first) return fail("the inverses bring the starting bytes back", null, firstDifference(end, first));
    return tree();
  };

  return { model, dom, page, step, undo, tree };
}

const report = (failure) => {
  if (failure === null) return;
  console.log(`${failure.check}, on ${failure.table}`);
  console.log(`  action ${JSON.stringify(failure.action)}`);
  console.log(`  detail ${JSON.stringify(failure.detail)}`);
};

const cellKind = (one) =>
  one !== null && typeof one === "object" && (one.t === "format" || (one.t === "set" && one.rows === undefined && one.cols === undefined));

const cellsOnly = (action) =>
  cellKind(action) || (action !== null && typeof action === "object" && action.t === "batch" && Array.isArray(action.actions) && action.actions.every(cellKind));

// The seeded generator of the reducer's laws, kept to the actions that write cells alone.
function cellAction(rand, backing) {
  for (let tries = 0; tries < 2000; tries++) {
    const action = genAction(rand, backing);
    if (cellsOnly(action)) return action;
  }
  throw new Error("the generator gave no set or format in 2000 tries");
}

// A formula's result arrives, changes and goes: the content stays the same formula, so each of
// these after the first is a derived write. The seeded lists rarely make one.
const RESULTS = [{ f: "=B3*2" }, { f: "=B3*2", r: 600 }, { f: "=B3*2", r: 650 }, { f: "=B3*2", r: "n/a" }, { f: "=B3*2" }].map((content) => ({
  v: 1,
  t: "set",
  sheet: "sheet",
  cells: [["r4", "cb", content]],
}));

test("set and format lists give the same bytes on a live table as on the model", () => {
  const tables = cleanTables();
  expect(tables.length).toBeGreaterThanOrEqual(9);
  const spread = listTables(tables, LISTS);
  expect(new Set(spread).size).toBe(tables.length);
  const counts = {};
  const random = rng(SEED);
  const started = Date.now();
  let failure = null;

  for (let index = 0; index < LISTS && failure === null; index++) {
    const table = tables.find((one) => one.name === spread[index]);
    const seed = Math.floor(random() * 4294967296);
    const rand = rng(seed);
    const pair = twins(table.name, table.model, counts);
    for (let i = 0; i < LENGTH && failure === null; i++) failure = pair.step(cellAction(rand, pair.model));
    if (failure === null) failure = pair.tree();
    if (failure === null) failure = pair.undo();
    if (failure !== null) failure = { list: index, seed, ...failure };
    for (const observer of observers.splice(0)) observer.disconnect();
  }
  const seeded = JSON.stringify(counts);
  const derived = counts.set?.derived ?? 0;
  const results = twins("tiny#0", tables.find((one) => one.name === "tiny#0").model, counts);
  for (const action of RESULTS) failure = failure ?? results.step(action);
  failure = failure ?? results.undo();
  report(failure);
  console.log(`lists ${LISTS}, actions ${LISTS * LENGTH} and their inverses, ${Date.now() - started} ms`);
  console.log(`  ${seeded}`);

  expect(failure).toBeNull();
  expect(counts.set.derived - derived).toBe(8);
  for (const kind of ["set", "format", "batch"]) {
    expect([kind, (counts[kind]?.edit ?? 0) > 0]).toEqual([kind, true]);
    expect([kind, (counts[kind]?.refused ?? 0) > 0]).toEqual([kind, true]);
  }
  expect((counts.set.none ?? 0) + (counts.format.none ?? 0)).toBeGreaterThan(0);
  expect(counts.content.compared).toBeGreaterThan(1000);
});

const CONTENTS = [0, 42, -7.5, 1200, 0.125, "hello", "007", "TRUE", "a<b", "line\nbreak", true, false, null, { f: "=A1+1" }, { f: "=SUM(B2:B3)" }];
const FORMATS = [null, "#,##0", "0.00", "0%", "$#,##0.00", "m/d/yyyy", '0.0" kg"'];
const STYLES = [
  { "font-weight": "bold" },
  { color: "#ff0000" },
  { background: "#eeeeee" },
  { border: "1px solid #000000" },
  { "text-align": "center", "font-weight": null },
  { "border-top": "2px dashed #ff0000", color: null },
];
const BORDERS = [
  { preset: "all", line: "1px solid #000000" },
  { preset: "outer", line: "2px dashed #ff0000" },
  { preset: "inner", line: "1px solid #000000" },
  { preset: "none" },
];

// One request to a builder, on a sheet of this size. Areas are rectangles of cells, never whole
// columns, so every action writes cells alone.
function request(rand, view) {
  const rows = view.rows().length;
  const cols = view.cols().length;
  const r = pick(rand, rows);
  const c = pick(rand, cols);
  const ref = `${colName(c)}${r + 1}`;
  const bottom = Math.min(rows - 1, r + pick(rand, 3));
  const right = Math.min(cols - 1, c + pick(rand, 3));
  const area = `${ref}:${colName(right)}${bottom + 1}`;
  const item = () => {
    const one = { content: pickOf(rand, CONTENTS) };
    if (rand() < 0.3) one.fmt = pickOf(rand, FORMATS);
    if (rand() < 0.3) one.style = pickOf(rand, STYLES);
    return rand() < 0.5 ? one : one.content;
  };
  switch (pick(rand, 7)) {
    case 0: {
      const options = {};
      if (rand() < 0.5) options.fmt = pickOf(rand, FORMATS);
      if (rand() < 0.4) options.style = pickOf(rand, STYLES);
      const content = pickOf(rand, CONTENTS);
      return ["set", (on) => buildSet(on, ref, content, options)];
    }
    case 1: {
      const block = [];
      for (let i = r; i <= bottom; i++) {
        const line = [];
        for (let j = c; j <= right; j++) line.push(item());
        block.push(line);
      }
      return ["setRange", (on) => buildSetRange(on, ref, block)];
    }
    case 2:
      return ["clear", (on) => buildClear(on, area)];
    case 3: {
      const options = {};
      if (rand() < 0.6) options.fmt = pickOf(rand, FORMATS);
      if (rand() < 0.5) options.style = pickOf(rand, STYLES);
      if (rand() < 0.3) options.border = pickOf(rand, BORDERS);
      if (Object.keys(options).length === 0) options.style = pickOf(rand, STYLES);
      return ["format", (on) => buildFormat(on, area, options)];
    }
    case 4:
    case 5:
      return ["merge", (on) => buildMerge(on, area)];
    default:
      return ["unmerge", (on) => buildUnmerge(on, ref)];
  }
}

test("builder-made lists give the same bytes on a live table as on the model", () => {
  const tables = cleanTables().filter((table) => table.model.rows.length * table.model.cols.length <= LARGE);
  expect(tables.length).toBeGreaterThanOrEqual(7);
  const counts = {};
  const built = {};
  const random = rng(SEED + 1);
  let failure = null;

  for (const table of tables) {
    if (failure !== null) break;
    const pair = twins(table.name, table.model, counts);
    for (let i = 0; i < REQUESTS && failure === null; i++) {
      const [name, build] = request(random, pair.dom);
      let action;
      let twin;
      try {
        action = build(pair.dom);
        twin = build(pair.model);
      } catch (error) {
        if (!(error instanceof GridRefused)) throw error;
        built[name] = built[name] ?? {};
        built[name].refused = (built[name].refused ?? 0) + 1;
        continue;
      }
      built[name] = built[name] ?? {};
      built[name][action === null ? "nothing" : "built"] = (built[name][action === null ? "nothing" : "built"] ?? 0) + 1;
      if (JSON.stringify(action) !== JSON.stringify(twin)) {
        failure = { check: "a builder reads the live table as it reads the model", table: table.name, action, detail: twin };
      } else if (action !== null) failure = pair.step(action);
    }
    if (failure === null) failure = pair.undo();
  }
  report(failure);
  console.log(`builders ${JSON.stringify(built)}`);
  console.log(`  ${JSON.stringify(counts)}`);

  expect(failure).toBeNull();
  for (const name of ["set", "setRange", "clear", "format", "merge", "unmerge"]) {
    expect([name, (built[name]?.built ?? 0) > 0]).toEqual([name, true]);
  }
  for (const kind of ["set", "format", "merge", "unmerge"]) {
    expect([kind, (counts[kind]?.edit ?? 0) > 0]).toEqual([kind, true]);
  }
  expect(counts.content.compared).toBeGreaterThan(100);
});

test("sameTree lists a planted difference", () => {
  const { table, cell } = live(BUDGET);
  expect(sameTree(table)).toEqual([]);
  const row = table.querySelector('tr[data-id="r4"]');

  row.appendChild(document.createElement("td"));
  expect(sameTree(table)).toEqual(["table > tbody[2] > tr[2]: 1 child elements where the bytes give 0"]);
  row.lastElementChild.remove();

  cell("r2", 1).setAttribute("n", "1");
  expect(sameTree(table)).toEqual(['table > tbody[2] > tr[0] > td[1]: n="1" v="1200" where the bytes give n="" v="1200"']);
  cell("r2", 1).setAttribute("n", "");

  cell("r2", 0).setAttribute("class", "picked");
  expect(sameTree(table)).toEqual(['table > tbody[2] > tr[0] > td[0]: class="picked" where the bytes give no attribute']);
  cell("r2", 0).removeAttribute("class");

  cell("r2", 0).textContent = "a\r\nb";
  expect(sameTree(table)).toEqual(['table > tbody[2] > tr[0] > td[0]: text "a\\r\\nb" where the bytes give "a\\nb"']);
  cell("r2", 0).innerHTML = "<b>Rent</b>";
  expect(sameTree(table)).toEqual(["table > tbody[2] > tr[0] > td[0]: 1 child elements where the bytes give 0"]);
  cell("r2", 0).textContent = "Rent";

  const th = document.createElement("th");
  th.textContent = "Item";
  th.setAttribute("style", "font-weight:bold");
  cell("r1", 0).replaceWith(th);
  expect(sameTree(table)).toEqual(["table > thead[1] > tr[0] > td[0]: <th> where the bytes give <td>"]);
  th.replaceWith(Object.assign(document.createElement("td"), { textContent: "Item" }));
  cell("r1", 0).setAttribute("style", "font-weight:bold");
  expect(sameTree(table)).toEqual([]);

  table.appendChild(row);
  expect(sameTree(table).length).toBeGreaterThan(0);
});
