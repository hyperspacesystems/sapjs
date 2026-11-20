import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { domBacking } from "../../src/grid/backing-dom.js";
import { modelBacking } from "../../src/grid/backing-model.js";
import { keysBetween } from "../../src/grid/codec/order-keys.js";
import { gridModel } from "../../src/grid/codec/read.js";
import { cellValue } from "../../src/grid/codec/value.js";
import { tableHtml } from "../../src/grid/codec/write.js";
import { derive } from "../../src/grid/content.js";
import { normalizeSheet } from "../../src/grid/normalize.js";
import { apply } from "../../src/grid/ops.js";
import { rng } from "../grid-codec/support/rng.js";
import { agentHiddenText, agentSheet } from "./support/agent-sheet.js";
import { genList, shapeOf } from "./support/gen-actions.js";
import { listTables, splitTables } from "./support/laws.js";
import { sameTree } from "./support/same-tree.js";

global.__SAP_KEEP_CONSOLE__ = true;

const GOLDEN = join(__dirname, "..", "grid-codec", "golden");
const SEED = 20261215;
const LISTS = 300;
const LENGTH = 40;
const PARTS = 6;
const PRIMITIVES = 600;

const KINDS = ["set", "format", "insertRows", "deleteRows", "changeRows", "insertCols", "deleteCols", "changeCols", "merge", "unmerge", "freeze", "batch"];

const NONE = { seen: 0, paused: 0, pauses: 0, moved: 0 };

const clone = (value) => JSON.parse(JSON.stringify(value));

const pick = (rand, n) => Math.floor(rand() * n);

const unstale = (bytes) => bytes.replace(/^(<table grid(?: freeze-cols="[0-9]+")?) stale/, "$1");

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

// A sheet of `count` rows with the first `frozen` of them frozen, three columns, and a text in
// each row's first cell.
function longSheet(count, frozen = 0) {
  const cols = keysBetween(null, null, 3).map((pos, c) => ({ id: `c${c}`, pos }));
  const rows = keysBetween(null, null, count).map((pos, r) => {
    const row = { id: `r${r}`, pos, cells: [{ text: `row ${r}` }] };
    if (r < frozen) row.frozen = true;
    return row;
  });
  return { cols, rows };
}

// The tables a list runs on: every golden table, the agent's sheet, and a sheet whose data rows
// fill two groups exactly, so that one more row needs a third. Each is taken after the declared
// repair.
function listedTables() {
  const tables = goldenTables();
  tables.push({ name: "agent", model: agentSheet(), hiddenText: agentHiddenText });
  tables.push({ name: "long", model: longSheet(102, 2) });
  return tables.map((table) => ({ name: table.name, model: normalizeSheet(clone(table.model), { derive, hiddenText: table.hiddenText }).sheet }));
}

const observers = [];

afterEach(() => {
  for (const observer of observers.splice(0)) observer.disconnect();
  document.body.innerHTML = "";
});

// A backing over a table, and the counts a test reads: the mutation records made by ordinary
// writes (`seen`), the ones made inside `write` (`paused`), how many times `write` ran (`pauses`)
// and how many rows a write took out of one part and put in another or in the same part again
// (`moved`), paused or not. `write` works as the plugin kit's does on a page with no mutation
// hub. `records()` returns the counts since the last call.
function watch(table, options) {
  const observer = new MutationObserver(() => {});
  observer.observe(table, { childList: true, subtree: true, attributes: true, characterData: true });
  observers.push(observer);
  let counts = { ...NONE };
  let lifted = new Set();
  const count = (made) => {
    for (const record of made) {
      for (const node of record.removedNodes) if (node.localName === "tr") lifted.add(node);
      for (const node of record.addedNodes) if (node.localName === "tr" && lifted.delete(node)) counts.moved += 1;
    }
    return made.length;
  };
  const settle = () => {
    counts.seen += count(observer.takeRecords());
  };
  const write = (fn) => {
    settle();
    counts.pauses += 1;
    try {
      return fn();
    } finally {
      counts.paused += count(observer.takeRecords());
    }
  };
  const backing = domBacking(table, { write, ...options });
  const records = () => {
    settle();
    const out = counts;
    counts = { ...NONE };
    lifted = new Set();
    return out;
  };
  return { table, backing, records };
}

function live(bytes, options) {
  document.body.innerHTML = bytes;
  return watch(document.body.firstElementChild, options);
}

// The table's parts with the count of element children of each, in order.
const parts = (table) => Array.from(table.children, (part) => `${part.localName} ${part.children.length}`);

const rowIds = (part) => Array.from(part.querySelectorAll("tr"), (tr) => tr.getAttribute("data-id"));

const rowOf = (table, id) => table.querySelector(`tr[data-id="${id}"]`);

const cellTexts = (table, id) => Array.from(rowOf(table, id).children, (td) => td.textContent);

// One sheet as a model backing and as a live table.
function pair(start, options) {
  const model = modelBacking(clone(start), { sheetId: null });
  const page = live(tableHtml(start), options);
  return { model, page, dom: page.backing, table: page.table };
}

// The live table has the model's bytes, its mirror has them too, and its tree is the tree those
// bytes parse to.
function agree(twin, label) {
  const bytes = tableHtml(twin.model.sheet);
  expect([label, firstDifference(twin.dom.bytes(), bytes)]).toEqual([label, null]);
  expect([label, firstDifference(tableHtml(twin.dom.sheet), bytes)]).toEqual([label, null]);
  expect([label, sameTree(twin.table, bytes)]).toEqual([label, []]);
}

// One primitive on the model and on the live table, which answer alike and then agree.
function both(twin, name, ...args) {
  const left = twin.model[name](...args);
  const right = twin.dom[name](...args);
  expect([name, right]).toEqual([name, left]);
  agree(twin, `${name} ${JSON.stringify(args)}`);
}

// Calls that leave the frozen rows in the middle of a list until the last one, as the reducer's
// do: the two backings agree after the last.
function chain(twin, calls) {
  for (const [name, ...args] of calls) {
    twin.model[name](...args);
    twin.dom[name](...args);
  }
  agree(twin, JSON.stringify(calls));
}

test("an inserted, removed or moved row is where the writer puts it", () => {
  const twin = pair(longSheet(4));
  expect(parts(twin.table)).toEqual(["colgroup 3", "tbody 4"]);
  // An action on rows or columns is taken to touch every row, so every row is read before it.
  for (const t of ["insertRows", "deleteRows", "changeRows", "insertCols", "deleteCols", "changeCols", "merge", "unmerge", "freeze"]) {
    expect([t, twin.dom.touched({ v: 1, t, sheet: "sheet" })]).toEqual([t, [0, 1, 2, 3]]);
  }

  both(twin, "insertRow", 0, { id: "a", pos: "A" });
  expect(twin.page.records()).toEqual({ ...NONE, seen: 1 });
  both(twin, "insertRow", 3, { id: "b", pos: "B", style: "height:40px" });
  both(twin, "insertRow", 6, { id: "c", pos: "C" });
  expect(rowIds(twin.table)).toEqual(["a", "r0", "r1", "b", "r2", "r3", "c"]);
  expect(rowOf(twin.table, "b").getAttribute("style")).toBe("height:40px");
  expect(Array.from(rowOf(twin.table, "c").attributes, (attribute) => attribute.name)).toEqual(["data-id", "data-pos"]);
  expect(rowOf(twin.table, "c").children.length).toBe(0);

  // A row that comes with cells is drawn as the writer writes it, with no empty cell at its end.
  both(twin, "insertRow", 1, { id: "d", pos: "D", cells: [{ text: "x" }, null, { text: "z", style: "color:#ff0000" }, null, null] });
  expect(cellTexts(twin.table, "d")).toEqual(["x", "", "z"]);
  expect(rowOf(twin.table, "d").children[2].getAttribute("style")).toBe("color:#ff0000");
  twin.page.records();

  both(twin, "moveRow", 0, 7);
  expect(twin.page.records()).toEqual({ ...NONE, seen: 2, moved: 1 });
  both(twin, "moveRow", 7, 0);
  both(twin, "moveRow", 2, 5);
  both(twin, "moveRow", 5, 2);
  both(twin, "moveRow", 3, 3);
  expect(rowIds(twin.table)).toEqual(["a", "d", "r0", "r1", "b", "r2", "r3", "c"]);
  twin.page.records();

  both(twin, "removeRow", 7);
  expect(twin.page.records()).toEqual({ ...NONE, seen: 1 });
  both(twin, "removeRow", 0);
  both(twin, "removeRow", 2);
  expect(rowIds(twin.table)).toEqual(["d", "r0", "b", "r2", "r3"]);

  // A row's record is written on the row, and a field that is taken away leaves no attribute.
  twin.page.records();
  both(twin, "putRow", 2, { style: "height:24px" });
  both(twin, "putRow", 2, { pos: "Bz", id: "b2" });
  expect(twin.page.records()).toEqual({ ...NONE, seen: 3 });
  expect(Array.from(rowOf(twin.table, "b2").attributes, (attribute) => `${attribute.name}=${attribute.value}`)).toEqual(["data-id=b2", "data-pos=Bz", "style=height:24px"]);
  both(twin, "putRow", 2, { style: undefined });
  expect(rowOf(twin.table, "b2").hasAttribute("style")).toBe(false);
  twin.page.records();
  both(twin, "putRow", 2, { pos: "Bz" });
  expect(twin.page.records()).toEqual(NONE);

  while (twin.model.rows().length > 0) both(twin, "removeRow", 0);
  expect(parts(twin.table)).toEqual(["colgroup 3", "tbody 0"]);
  both(twin, "insertRow", 0, { id: "z", pos: "V" });
  expect(parts(twin.table)).toEqual(["colgroup 3", "tbody 1"]);
  expect(twin.dom.rescan()).toBe(false);
});

test("the thead holds the frozen rows and is there only while a row is frozen", () => {
  const twin = pair(longSheet(5));
  both(twin, "setFrozen", { rows: 2 });
  expect(parts(twin.table)).toEqual(["colgroup 3", "thead 2", "tbody 3"]);
  expect(rowIds(twin.table.tHead)).toEqual(["r0", "r1"]);
  const made = twin.page.records();
  expect([made.seen > 0, made.paused, made.pauses]).toEqual([true, 0, 0]);

  both(twin, "setFrozen", { rows: 2 });
  expect(twin.page.records()).toEqual(NONE);
  both(twin, "setFrozen", { rows: 4 });
  both(twin, "setFrozen", { rows: 1 });
  expect(parts(twin.table)).toEqual(["colgroup 3", "thead 1", "tbody 4"]);
  expect(rowIds(twin.table)).toEqual(["r0", "r1", "r2", "r3", "r4"]);
  both(twin, "setFrozen", { rows: 0 });
  expect(parts(twin.table)).toEqual(["colgroup 3", "tbody 5"]);
  expect(rowIds(twin.table)).toEqual(["r0", "r1", "r2", "r3", "r4"]);

  // A row put before the frozen line is frozen. The reducer says so after it puts the row.
  both(twin, "setFrozen", { rows: 2 });
  chain(twin, [["insertRow", 1, { id: "a", pos: "A" }], ["setFrozen", { rows: 3 }]]);
  expect(rowIds(twin.table.tHead)).toEqual(["r0", "a", "r1"]);
  both(twin, "insertRow", 3, { id: "b", pos: "B", frozen: true });
  expect(rowIds(twin.table.tHead)).toEqual(["r0", "a", "r1", "b"]);
  both(twin, "insertRow", 4, { id: "c", pos: "C" });
  expect(rowIds(twin.table.tHead)).toEqual(["r0", "a", "r1", "b"]);
  expect(rowIds(twin.table.tBodies[0])).toEqual(["c", "r2", "r3", "r4"]);

  // A row that crosses the line changes parts: the reducer moves it, then says how many rows
  // are frozen still.
  chain(twin, [["moveRow", 0, 6], ["setFrozen", { rows: 4 }]]);
  expect(rowIds(twin.table.tHead)).toEqual(["a", "r1", "b", "c"]);
  chain(twin, [["moveRow", 7, 1], ["setFrozen", { rows: 4 }]]);
  expect(rowIds(twin.table.tHead)).toEqual(["a", "r4", "r1", "b"]);
  expect(rowIds(twin.table.tBodies[0])).toEqual(["c", "r2", "r3", "r0"]);
  both(twin, "moveRow", 0, 3);
  expect(rowIds(twin.table.tHead)).toEqual(["r4", "r1", "b", "a"]);

  // The frozen flag of a row record moves the line by one row.
  both(twin, "putRow", 4, { frozen: true });
  expect(rowIds(twin.table.tHead)).toEqual(["r4", "r1", "b", "a", "c"]);
  both(twin, "putRow", 4, { frozen: undefined });
  expect(rowIds(twin.table.tHead)).toEqual(["r4", "r1", "b", "a"]);

  // The thead goes with its last row, by a removal or by a freeze, and one tbody stays when every
  // row is frozen.
  for (let left = 4; left > 0; left--) {
    expect(parts(twin.table)).toEqual(["colgroup 3", `thead ${left}`, "tbody 4"]);
    both(twin, "removeRow", 0);
  }
  expect(parts(twin.table)).toEqual(["colgroup 3", "tbody 4"]);
  both(twin, "setFrozen", { rows: 4 });
  expect(parts(twin.table)).toEqual(["colgroup 3", "thead 4", "tbody 0"]);
  both(twin, "putRow", 3, { frozen: undefined });
  expect(parts(twin.table)).toEqual(["colgroup 3", "thead 3", "tbody 1"]);
  both(twin, "setFrozen", { rows: 0 });
  expect(parts(twin.table)).toEqual(["colgroup 3", "tbody 4"]);
  expect(twin.dom.rescan()).toBe(false);
});

test("the tbody groups are cut where the writer cuts them", () => {
  const twin = pair(longSheet(100, 2));
  expect(parts(twin.table)).toEqual(["colgroup 3", "thead 2", "tbody 50", "tbody 48"]);

  // A row put first moves the last row of its group into the next one, as an ordinary write, so
  // an undo of the insert puts it back.
  both(twin, "insertRow", 2, { id: "a", pos: "A" });
  expect(parts(twin.table)).toEqual(["colgroup 3", "thead 2", "tbody 50", "tbody 49"]);
  expect(rowIds(twin.table.tBodies[1])[0]).toBe("r51");
  expect(twin.page.records()).toEqual({ ...NONE, seen: 3, moved: 1 });

  // A row put last fills its group and moves no row.
  both(twin, "insertRow", 101, { id: "b", pos: "B" });
  expect(parts(twin.table)).toEqual(["colgroup 3", "thead 2", "tbody 50", "tbody 50"]);
  expect(twin.page.records()).toEqual({ ...NONE, seen: 1 });

  // A row past the last full group gets a new tbody, and its removal takes the tbody away.
  both(twin, "insertRow", 102, { id: "c", pos: "C" });
  expect(parts(twin.table)).toEqual(["colgroup 3", "thead 2", "tbody 50", "tbody 50", "tbody 1"]);
  expect(rowIds(twin.table.tBodies[2])).toEqual(["c"]);
  both(twin, "removeRow", 102);
  expect(parts(twin.table)).toEqual(["colgroup 3", "thead 2", "tbody 50", "tbody 50"]);

  // A row in the thead moves no other row.
  twin.page.records();
  chain(twin, [["insertRow", 0, { id: "d", pos: "D" }], ["setFrozen", { rows: 3 }]]);
  expect(twin.page.records()).toEqual({ ...NONE, seen: 1 });
  chain(twin, [["removeRow", 0], ["setFrozen", { rows: 2 }]]);
  expect(twin.page.records()).toEqual({ ...NONE, seen: 1 });

  // A removed row is made up for from the next group.
  both(twin, "removeRow", 2);
  expect(parts(twin.table)).toEqual(["colgroup 3", "thead 2", "tbody 50", "tbody 49"]);
  expect(twin.page.records()).toEqual({ ...NONE, seen: 3, moved: 1 });

  // A row moved from the last group to the first, and back.
  chain(twin, [["moveRow", 100, 2], ["setFrozen", { rows: 2 }]]);
  expect(parts(twin.table)).toEqual(["colgroup 3", "thead 2", "tbody 50", "tbody 49"]);
  expect(rowIds(twin.table.tBodies[0])[0]).toBe("b");
  expect(twin.page.records()).toEqual({ ...NONE, seen: 4, moved: 2 });
  chain(twin, [["moveRow", 2, 100], ["setFrozen", { rows: 2 }]]);
  expect(rowIds(twin.table.tBodies[1])[48]).toBe("b");
  twin.page.records();

  // The frozen line moves the groups too: rows that leave the thead push later rows on, and
  // rows that enter it pull them back.
  both(twin, "setFrozen", { rows: 0 });
  expect(parts(twin.table)).toEqual(["colgroup 3", "tbody 50", "tbody 50", "tbody 1"]);
  // Two rows that leave the thead, and three rows the groups pass on.
  expect(twin.page.records().moved).toBe(5);
  both(twin, "setFrozen", { rows: 1 });
  expect(parts(twin.table)).toEqual(["colgroup 3", "thead 1", "tbody 50", "tbody 50"]);
  both(twin, "setFrozen", { rows: 60 });
  expect(parts(twin.table)).toEqual(["colgroup 3", "thead 60", "tbody 41"]);
  both(twin, "setFrozen", { rows: 0 });
  expect(parts(twin.table)).toEqual(["colgroup 3", "tbody 50", "tbody 50", "tbody 1"]);
  both(twin, "setFrozen", { rows: 101 });
  expect(parts(twin.table)).toEqual(["colgroup 3", "thead 101", "tbody 0"]);
  both(twin, "setFrozen", { rows: 0 });
  expect(parts(twin.table)).toEqual(["colgroup 3", "tbody 50", "tbody 50", "tbody 1"]);
  expect(twin.dom.rescan()).toBe(false);
});

test("an insert at the top of a 1,000 row sheet moves one row across each later group", () => {
  const start = goldenTables().find((table) => table.name === "two-tabs#0").model;
  expect([start.rows.length, start.rows.filter((row) => row.frozen).length]).toEqual([1000, 0]);
  const twin = pair(start);
  const full = Array.from({ length: 20 }, () => "tbody 50");
  expect(parts(twin.table)).toEqual(["colgroup 1", ...full]);

  both(twin, "insertRow", 0, { id: "top", pos: "0" });
  expect(parts(twin.table)).toEqual(["colgroup 1", ...full, "tbody 1"]);
  // One record for the new row, then twenty rows moved, two records each, and the new tbody.
  expect(twin.page.records()).toEqual({ ...NONE, seen: 42, moved: 20 });

  // A row put in the eleventh group moves a row across the ten cuts after it.
  both(twin, "insertRow", 525, { id: "mid", pos: "1" });
  expect(twin.page.records()).toEqual({ ...NONE, seen: 21, moved: 10 });
  both(twin, "removeRow", 525);
  expect(twin.page.records()).toEqual({ ...NONE, seen: 21, moved: 10 });

  both(twin, "removeRow", 0);
  expect(parts(twin.table)).toEqual(["colgroup 1", ...full]);
  expect(twin.page.records()).toEqual({ ...NONE, seen: 42, moved: 20 });
  expect(firstDifference(twin.dom.bytes(), tableHtml(start))).toBeNull();

  // A frozen row moves no data row.
  chain(twin, [["insertRow", 0, { id: "head", pos: "0", frozen: true }]]);
  expect(parts(twin.table)).toEqual(["colgroup 1", "thead 1", ...full]);
  expect(twin.page.records()).toEqual({ ...NONE, seen: 2 });

  const started = Date.now();
  for (let i = 0; i < 20; i++) expect(twin.dom.read([])).toBeNull();
  console.log(`read of no row on 1,001 rows: ${(Date.now() - started) / 20} ms`);
  expect(twin.dom.rescan()).toBe(false);
});

test("a new column adds a cell to every row that reaches it", () => {
  const start = goldenTables().find((table) => table.name === "tiny#0").model;
  const twin = pair(start);
  const widths = () => ["r1", "r2", "r3", "r4", "r5", "r6"].map((id) => rowOf(twin.table, id).children.length);
  expect(widths()).toEqual([3, 3, 3, 0, 2, 3]);

  // Rows r1, r2, r3, r5 and r6 reach column 1. Row r4 has no cell and gets none.
  both(twin, "insertCol", 1, { id: "cx", pos: "K" });
  expect(widths()).toEqual([4, 4, 4, 0, 3, 4]);
  expect(cellTexts(twin.table, "r1")).toEqual(["Item", "", "Cost", "Share"]);
  expect(rowOf(twin.table, "r5").children[1].attributes.length).toBe(0);
  expect(Array.from(twin.table.querySelectorAll("col"), (col) => col.getAttribute("data-id"))).toEqual(["ca", "cx", "cb", "cc"]);
  expect(twin.page.records()).toEqual({ ...NONE, seen: 6 });

  // A column at the end, or past the cells of every row, adds only its record.
  both(twin, "insertCol", 4, { id: "cy", pos: "t", fmt: "0.00", width: 90 });
  expect(widths()).toEqual([4, 4, 4, 0, 3, 4]);
  const added = twin.table.querySelector('col[data-id="cy"]');
  expect(Array.from(added.attributes, (attribute) => `${attribute.name}=${attribute.value}`)).toEqual(["data-id=cy", "data-pos=t", "fmt=0.00", "style=width:90px"]);
  expect(twin.page.records()).toEqual({ ...NONE, seen: 1 });
  both(twin, "insertCol", 0, { id: "cw", pos: "4" });
  expect(widths()).toEqual([5, 5, 5, 0, 4, 5]);

  // A column record is written on its col element.
  twin.page.records();
  both(twin, "putCol", 5, { width: 120 });
  both(twin, "putCol", 5, { fmt: undefined });
  both(twin, "putCol", 5, { id: "cz", pos: "u" });
  expect(Array.from(added.attributes, (attribute) => `${attribute.name}=${attribute.value}`)).toEqual(["data-id=cz", "data-pos=u", "style=width:120px"]);
  both(twin, "putCol", 5, { width: undefined });
  expect(added.hasAttribute("style")).toBe(false);
  expect(twin.page.records()).toEqual({ ...NONE, seen: 5 });
  both(twin, "putCol", 5, { pos: "u" });
  expect(twin.page.records()).toEqual(NONE);

  // A removed column takes its cell from every row that reaches it, and a row is left with no
  // empty cell at its end.
  both(twin, "putCell", 3, 2, { text: "only" });
  expect(widths()).toEqual([5, 5, 5, 3, 4, 5]);
  both(twin, "removeCol", 2);
  expect(widths()).toEqual([4, 4, 4, 0, 3, 4]);
  both(twin, "removeCol", 0);
  both(twin, "removeCol", 3);
  expect(firstDifference(twin.dom.bytes(), tableHtml(start))).toBeNull();

  // A moved column moves its cell in every row that reaches either place.
  both(twin, "moveCol", 0, 2);
  expect(cellTexts(twin.table, "r1")).toEqual(["Cost", "Share", "Item"]);
  expect(cellTexts(twin.table, "r5")).toEqual(["$1,500.00", "", "Total"]);
  expect(widths()).toEqual([3, 3, 3, 0, 3, 3]);
  both(twin, "moveCol", 2, 0);
  expect(firstDifference(twin.dom.bytes(), tableHtml(start))).toBeNull();
  both(twin, "moveCol", 2, 1);
  expect(cellTexts(twin.table, "r5")).toEqual(["Total", "", "$1,500.00"]);
  both(twin, "moveCol", 1, 1);
  both(twin, "moveCol", 1, 2);
  expect(firstDifference(twin.dom.bytes(), tableHtml(start))).toBeNull();

  // The count of frozen columns is the table's attribute.
  twin.page.records();
  both(twin, "setFrozen", { cols: 2 });
  expect(twin.table.getAttribute("freeze-cols")).toBe("2");
  both(twin, "setFrozen", { cols: 0 });
  expect(twin.table.hasAttribute("freeze-cols")).toBe(false);
  expect(twin.page.records()).toEqual({ ...NONE, seen: 2 });
  both(twin, "setFrozen", { cols: 0, rows: 1 });
  expect(twin.page.records()).toEqual(NONE);

  // Every column can go, and a first one comes back.
  for (let left = 3; left > 0; left--) both(twin, "removeCol", 0);
  expect(parts(twin.table).slice(0, 1)).toEqual(["colgroup 0"]);
  both(twin, "insertCol", 0, { id: "cn", pos: "V" });
  both(twin, "putCell", 1, 0, { text: "back" });
  expect(twin.dom.rescan()).toBe(false);
});

// A table no writer wrote: a tbody, two theads, a tfoot, a row with no part around it, a second
// colgroup and a column outside both. The reader takes the rows as r2 r5 r1 r3 r4 r6.
function handMade() {
  const row = (id, pos, text) => `<tr data-id="${id}" data-pos="${pos}"><td>${text}</td></tr>`;
  document.body.innerHTML = [
    "<table grid>",
    `<tbody>${row("r1", "G", "one")}</tbody>`,
    '<colgroup><col data-id="ca" data-pos="G"></colgroup>',
    `<thead>${row("r2", "4", "two")}</thead>`,
    `<tfoot>${row("r3", "O", "three")}</tfoot>`,
    '<colgroup><col data-id="cb" data-pos="V"></colgroup>',
    `<tbody>${row("r4", "V", "four")}</tbody>`,
    `<thead>${row("r5", "8", "five")}</thead>`,
    "</table>",
  ].join("");
  const table = document.body.firstElementChild;
  const loose = document.createElement("tr");
  loose.setAttribute("data-id", "r6");
  loose.setAttribute("data-pos", "l");
  loose.appendChild(document.createElement("td")).textContent = "six";
  table.appendChild(loose);
  const col = document.createElement("col");
  col.setAttribute("data-id", "cc");
  col.setAttribute("data-pos", "l");
  table.appendChild(col);
  return table;
}

test("a table with other parts gets the writer's parts at its first row primitive", () => {
  const page = watch(handMade());
  const dom = page.backing;
  const table = page.table;
  expect(parts(table)).toEqual(["tbody 1", "colgroup 1", "thead 1", "tfoot 1", "colgroup 1", "tbody 1", "thead 1", "tr 1", "col 0"]);
  expect(dom.rows().map((row) => row.id)).toEqual(["r2", "r5", "r1", "r3", "r4", "r6"]);
  expect(dom.cols().map((col) => col.id)).toEqual(["ca", "cb", "cc"]);
  const bytes = dom.bytes();
  expect(sameTree(table, bytes)).not.toEqual([]);

  // Cells and columns are written where the parts are, and no part moves.
  dom.putCell(3, 1, { text: "3b" });
  dom.insertCol(1, { id: "cx", pos: "K" });
  dom.removeCol(1);
  dom.putCell(3, 1, null);
  expect(parts(table)).toEqual(["tbody 1", "colgroup 1", "thead 1", "tfoot 1", "colgroup 1", "tbody 1", "thead 1", "tr 1", "col 0"]);
  expect(dom.bytes()).toBe(bytes);
  const made = page.records();
  expect([made.paused, made.pauses]).toEqual([0, 0]);

  // The row primitive puts the parts right inside the paused path, then makes its own write.
  const model = modelBacking(clone(dom.sheet), { sheetId: null });
  const twin = { model, page, dom, table };
  both(twin, "insertRow", 6, { id: "r7", pos: "t" });
  expect(parts(table)).toEqual(["colgroup 3", "thead 2", "tbody 5"]);
  expect(rowIds(table)).toEqual(["r2", "r5", "r1", "r3", "r4", "r6", "r7"]);
  const shaped = page.records();
  expect([shaped.seen, shaped.pauses, shaped.paused > 0]).toEqual([1, 1, true]);
  // A row moves once at most: r1 and r2 were in the parts that stay, and the other four moved.
  expect(shaped.moved).toBe(4);

  both(twin, "setFrozen", { rows: 0 });
  expect(parts(table)).toEqual(["colgroup 3", "tbody 7"]);
  expect(page.records().pauses).toBe(0);
  expect(dom.tidy()).toBe(false);
  expect(dom.rescan()).toBe(false);
});

test("tidy gives a table the writer's parts and writes nothing when it has them", () => {
  // One tbody of 120 rows, as a person writes a long table by hand.
  const start = longSheet(120, 1);
  const bytes = tableHtml(start);
  document.body.innerHTML = tableHtml(start, { groupSize: 500 });
  const page = watch(document.body.firstElementChild);
  expect(parts(page.table)).toEqual(["colgroup 3", "thead 1", "tbody 119"]);
  expect(page.backing.bytes()).toBe(bytes);
  expect(page.backing.tidy()).toBe(true);
  expect(parts(page.table)).toEqual(["colgroup 3", "thead 1", "tbody 50", "tbody 50", "tbody 19"]);
  expect(page.records()).toEqual({ seen: 0, paused: 2 + 2 * 69, pauses: 1, moved: 69 });
  expect(sameTree(page.table, bytes)).toEqual([]);
  expect(page.backing.tidy()).toBe(false);
  expect(page.records()).toEqual(NONE);

  // A table with no part at all, and one with an empty thead.
  document.body.innerHTML = "<table grid></table>";
  const bare = watch(document.body.firstElementChild);
  expect(bare.backing.tidy()).toBe(true);
  expect(parts(bare.table)).toEqual(["colgroup 0", "tbody 0"]);
  expect(sameTree(bare.table, tableHtml({ cols: [], rows: [] }))).toEqual([]);
  bare.backing.insertCol(0, { id: "ca", pos: "V" });
  bare.backing.insertRow(0, { id: "r1", pos: "V", cells: [{ text: "first" }] });
  expect(bare.backing.bytes()).toBe(tableHtml({ cols: [{ id: "ca", pos: "V" }], rows: [{ id: "r1", pos: "V", cells: [{ text: "first" }] }] }));
  expect(sameTree(bare.table)).toEqual([]);

  document.body.innerHTML = tableHtml(longSheet(3)).replace("<tbody>", "<thead></thead><tbody>");
  const headed = watch(document.body.firstElementChild);
  expect(parts(headed.table)).toEqual(["colgroup 3", "thead 0", "tbody 3"]);
  expect(headed.backing.tidy()).toBe(true);
  expect(parts(headed.table)).toEqual(["colgroup 3", "tbody 3"]);
  expect(headed.records()).toEqual({ seen: 0, paused: 1, pauses: 1, moved: 0 });

  // An element that is no row stays in its part, after the rows, and is no reason to write twice.
  document.body.innerHTML = tableHtml(longSheet(3)).replace("<tbody>", "<tbody><template></template>");
  const odd = watch(document.body.firstElementChild);
  expect(odd.backing.tidy()).toBe(true);
  expect(Array.from(odd.table.tBodies[0].children, (node) => node.localName)).toEqual(["tr", "tr", "tr", "template"]);
  expect(odd.backing.tidy()).toBe(false);
  odd.records();
  odd.backing.insertRow(0, { id: "a", pos: "0" });
  expect(odd.records()).toEqual({ ...NONE, seen: 1 });
  expect(rowIds(odd.table)).toEqual(["a", "r0", "r1", "r2"]);
});

test("read sees a row a foreign write added, moved or took away", () => {
  const rescanned = { rows: [], cells: [], rescanned: true };
  const fresh = (id) => {
    const tr = document.createElement("tr");
    tr.setAttribute("data-id", id);
    tr.setAttribute("data-pos", "z");
    tr.appendChild(document.createElement("td")).textContent = "new";
    return tr;
  };
  const start = longSheet(6, 1);
  const edits = [
    ["a row at the end", (table) => table.tBodies[0].appendChild(fresh("x")), ["r0", "r1", "r2", "r3", "r4", "r5", "x"]],
    ["a row at the start", (table) => table.tBodies[0].prepend(fresh("x")), ["r0", "x", "r1", "r2", "r3", "r4", "r5"]],
    ["a row in the thead", (table) => table.tHead.appendChild(fresh("x")), ["r0", "x", "r1", "r2", "r3", "r4", "r5"]],
    ["a row in a new tbody", (table) => table.appendChild(document.createElement("tbody")).appendChild(fresh("x")), ["r0", "r1", "r2", "r3", "r4", "r5", "x"]],
    ["a row for a row", (table) => table.tBodies[0].lastElementChild.replaceWith(fresh("x")), ["r0", "r1", "r2", "r3", "r4", "x"]],
    ["the last row gone", (table) => table.tBodies[0].lastElementChild.remove(), ["r0", "r1", "r2", "r3", "r4"]],
    ["two rows the other way round", (table) => table.tBodies[0].appendChild(table.tBodies[0].firstElementChild), ["r0", "r2", "r3", "r4", "r5", "r1"]],
    ["the first data row frozen", (table) => table.tHead.appendChild(table.tBodies[0].firstElementChild), ["r0", "r1", "r2", "r3", "r4", "r5"]],
    ["the frozen row let go", (table) => table.tBodies[0].prepend(table.tHead.firstElementChild), ["r0", "r1", "r2", "r3", "r4", "r5"]],
  ];
  for (const [name, edit, ids] of edits) {
    const { table, backing, records } = live(tableHtml(start));
    expect([name, backing.read([])]).toEqual([name, null]);
    edit(table);
    records();
    // No row is named: the list of rows is read whatever the caller asks for.
    expect([name, backing.read([])]).toEqual([name, rescanned]);
    expect([name, backing.rows().map((row) => row.id)]).toEqual([name, ids]);
    expect([name, tableHtml(backing.sheet)]).toEqual([name, backing.bytes()]);
    expect([name, backing.read(backing.rows().map((row, r) => r))]).toEqual([name, null]);
    expect([name, records()]).toEqual([name, NONE]);

    // The next row primitive works on the table as it is now.
    backing.insertRow(backing.rows().length, { id: "last", pos: "zz" });
    backing.removeRow(1);
    expect([name, tableHtml(backing.sheet)]).toEqual([name, backing.bytes()]);
    expect([name, sameTree(table)]).toEqual([name, []]);
  }
});

test("read takes the table's parts as they are now", () => {
  // A foreign write puts every row in a new tbody and takes the old one away: the rows are the
  // same rows in the same order, so no row is read again, and a row added after it is not lost.
  const twin = pair(longSheet(4));
  const body = document.createElement("tbody");
  body.append(...twin.table.tBodies[0].children);
  twin.table.tBodies[0].replaceWith(body);
  expect(twin.dom.read([0, 1, 2, 3])).toBeNull();
  both(twin, "insertRow", 4, { id: "a", pos: "z" });
  expect(rowIds(twin.table)).toEqual(["r0", "r1", "r2", "r3", "a"]);

  // The same for a column that a foreign write made again.
  const col = twin.table.querySelector("col").cloneNode(true);
  twin.table.querySelector("col").replaceWith(col);
  expect(twin.dom.read([])).toBeNull();
  both(twin, "putCol", 0, { width: 64 });
  expect(col.getAttribute("style")).toBe("width:64px");

  // Groups a foreign write cut elsewhere are put right at the next row primitive.
  const long = pair(longSheet(100));
  long.table.tBodies[0].append(...long.table.tBodies[1].children);
  long.table.tBodies[1].remove();
  expect(parts(long.table)).toEqual(["colgroup 3", "tbody 100"]);
  expect(long.dom.read([])).toBeNull();
  long.page.records();
  both(long, "insertRow", 100, { id: "a", pos: "z" });
  expect(parts(long.table)).toEqual(["colgroup 3", "tbody 50", "tbody 50", "tbody 1"]);
  // The foreign layout is put right as one derived write; the new row and the group it opens are
  // ordinary writes.
  expect(long.page.records()).toEqual({ seen: 4, paused: 101, pauses: 1, moved: 51 });
});

test("rowIndexOf finds the row that holds a node", () => {
  const start = goldenTables().find((table) => table.name === "tiny#0").model;
  const { table, backing } = live(tableHtml(start));
  const ids = ["r1", "r2", "r3", "r4", "r5", "r6"];
  ids.forEach((id, r) => expect([id, backing.rowIndexOf(rowOf(table, id))]).toEqual([id, r]));
  const cell = rowOf(table, "r3").children[1];
  expect(backing.rowIndexOf(cell)).toBe(2);
  expect(backing.rowIndexOf(cell.firstChild)).toBe(2);
  expect(backing.rowIndexOf(table)).toBe(-1);
  expect(backing.rowIndexOf(table.tBodies[0])).toBe(-1);
  expect(backing.rowIndexOf(table.querySelector("col"))).toBe(-1);
  expect(backing.rowIndexOf(document.body)).toBe(-1);

  // A table inside a cell is part of that cell's row.
  cell.innerHTML = '<table><tbody><tr data-id="inner"><td><b>in</b></td></tr></tbody></table>';
  expect(backing.rowIndexOf(cell.querySelector("b"))).toBe(2);

  // The index follows the rows as they move, and a row with another row's id is still itself.
  backing.rescan();
  backing.moveRow(1, 4);
  backing.insertRow(1, { id: "new", pos: "A" });
  expect(ids.map((id) => backing.rowIndexOf(rowOf(table, id)))).toEqual([0, 5, 2, 3, 4, 6]);
  const renamed = rowOf(table, "r6");
  renamed.setAttribute("data-id", "r4");
  expect(backing.rowIndexOf(renamed)).toBe(6);

  // A row the backing has not read yet, and a row that left the table, are no row of it.
  const added = table.tBodies[0].appendChild(document.createElement("tr"));
  expect(backing.rowIndexOf(added)).toBe(-1);
  const gone = rowOf(table, "r3");
  gone.remove();
  expect(backing.rowIndexOf(gone)).toBe(-1);
});

const CELLS = [null, null, { text: "a" }, { text: "b", style: "font-weight:bold" }, { text: "", style: "color:#ff0000" }, { text: "7", n: true }];

// One step of the primitives: the calls the reducer makes for one row or column, in its order.
function primitiveStep(rand, model, n) {
  const rows = model.rows().length;
  const cols = model.cols().length;
  const frozen = model.frozen().rows;
  const cells = () => Array.from({ length: pick(rand, cols + 1) }, () => CELLS[pick(rand, CELLS.length)]);
  const kind = pick(rand, 12);
  if (kind === 0 || kind === 1 || rows === 0) {
    const at = pick(rand, rows + 1);
    const calls = [["insertRow", at, { id: `x${n}`, pos: `p${n}`, cells: cells() }]];
    if (at < frozen) calls.push(["setFrozen", { rows: frozen + 1 }]);
    return calls;
  }
  if (kind === 2 || kind === 3) {
    const at = pick(rand, rows);
    return at < frozen ? [["removeRow", at], ["setFrozen", { rows: frozen - 1 }]] : [["removeRow", at]];
  }
  if (kind === 4) return [["moveRow", pick(rand, rows), pick(rand, rows)], ["setFrozen", { rows: frozen }]];
  if (kind === 5) return [["setFrozen", { rows: pick(rand, 2) === 0 ? pick(rand, Math.min(rows, 6) + 1) : pick(rand, rows + 1) }]];
  if (kind === 6) return [["putRow", pick(rand, rows), pick(rand, 2) === 0 ? { style: [undefined, "height:30px"][pick(rand, 2)] } : { pos: `q${n}` }]];
  if (kind === 7 || cols === 0) return [["insertCol", pick(rand, cols + 1), { id: `y${n}`, pos: `p${n}`, width: [undefined, 80][pick(rand, 2)] }]];
  if (kind === 8) return [["removeCol", pick(rand, cols)]];
  if (kind === 9) return [["moveCol", pick(rand, cols), pick(rand, cols)]];
  if (kind === 10) {
    const fields = [{ fmt: "0.00" }, { fmt: undefined }, { width: 120 }, { width: undefined }][pick(rand, 4)];
    return [["putCol", pick(rand, cols), fields], ["setFrozen", { cols: pick(rand, cols + 1) }]];
  }
  return [["putCell", pick(rand, rows), pick(rand, cols), CELLS[pick(rand, CELLS.length)]]];
}

test("the primitives in any order keep the table the tree its bytes parse to", () => {
  // No read comes between the steps, so the backing works from the parts it kept.
  const twin = pair(longSheet(128, 3));
  const rand = rng(SEED);
  const used = {};
  const sizes = new Set();
  for (let n = 0; n < PRIMITIVES; n++) {
    const calls = primitiveStep(rand, twin.model, n);
    for (const [name] of calls) used[name] = (used[name] ?? 0) + 1;
    chain(twin, calls);
    sizes.add(twin.table.tBodies.length);
  }
  const made = twin.page.records();
  console.log(`primitives ${JSON.stringify(used)}, records ${JSON.stringify(made)}, tbody counts ${[...sizes].sort()}`);
  for (const name of ["insertRow", "removeRow", "moveRow", "putRow", "setFrozen", "insertCol", "removeCol", "moveCol", "putCol", "putCell"]) {
    expect([name, used[name] > 10]).toEqual([name, true]);
  }
  expect(made.moved).toBeGreaterThan(100);
  expect([...sizes].sort()).toEqual(expect.arrayContaining([1, 2, 3]));
  expect(twin.dom.rescan()).toBe(false);
});

const contentKey = (cell) => {
  if (!cell || cell.hidden) return "null";
  if (cell.f !== undefined) return `f ${cell.f}`;
  const value = cellValue(cell);
  return `${typeof value} ${String(value)}`;
};

// A sheet without its derived parts: the stale mark and each cell's text, n, t and v.
const essence = (sheet) =>
  JSON.stringify([
    sheet.freezeCols ?? 0,
    sheet.cols.map((col) => [col.id, col.pos, col.fmt ?? null, col.width ?? null]),
    sheet.rows.map((row) => [
      row.id,
      row.pos,
      row.frozen === true,
      row.style ?? null,
      row.cells.map((cell) => (cell ? [contentKey(cell), cell.fmt ?? null, cell.style ?? null, cell.colspan ?? null, cell.rowspan ?? null, cell.hidden === true] : null)),
    ]),
  ]);

const RANK = { none: 0, derived: 1, edit: 2 };

// What an applied action did, read from the model alone: an edit when anything but a derived part
// changed, derived when only derived parts did, and none when no byte did.
function kindOfChange(before, after) {
  if (essence(before) !== essence(after)) return "edit";
  return tableHtml(before) === tableHtml(after) ? "none" : "derived";
}

// A batch is its members in order, and one member can put back what another changed, so each
// member is judged on its own.
function kindOf(before, after, action, options) {
  if (action.t !== "batch") return kindOfChange(before, after);
  const scratch = modelBacking(before, { sheetId: null });
  let kind = "none";
  for (const one of action.actions) {
    const was = clone(scratch.sheet);
    apply(scratch, one, options);
    const next = kindOfChange(was, scratch.sheet);
    if (RANK[next] > RANK[kind]) kind = next;
  }
  return kind;
}

// One table as a model backing and as a live table. `step` applies an action on both and
// returns null, or the first thing that differs. `undo` applies every inverse, last first.
function twins(name, start, { counts, formulas }) {
  const twin = pair(start);
  const { model, dom, page } = twin;
  const options = { derive, formulas };
  const inverses = [];
  const fail = (check, action, detail) => ({ check, table: name, action, detail });

  const count = (kind, what, by = 1) => {
    counts[kind] = counts[kind] ?? {};
    counts[kind][what] = (counts[kind][what] ?? 0) + by;
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
    const left = apply(model, action, options);
    const right = apply(dom, action, options);
    const made = page.records();
    if (JSON.stringify(right) !== JSON.stringify(left)) return fail("the live table answers as the model does", action, { live: right, model: left });

    const bytes = tableHtml(model.sheet);
    const liveBytes = dom.bytes();
    if (liveBytes !== bytes) return fail("the live table's bytes are the model's", action, firstDifference(liveBytes, bytes));
    const mirrorBytes = tableHtml(dom.sheet);
    if (mirrorBytes !== bytes) return fail("the mirror's bytes are the model's", action, firstDifference(mirrorBytes, bytes));
    const found = sameTree(page.table, bytes);
    if (found.length > 0) return fail("the live table is the tree its bytes parse to", action, found);

    const applied = left.out === "applied";
    const kind = applied ? kindOf(was, model.sheet, action, options) : "none";
    count(action.t, applied ? "applied" : "refused");
    if (applied && shapeOf(action) !== null) count(shapeOf(action), "applied");
    count("records", kind);
    count("records", "moved", made.moved);
    const fits =
      kind === "edit" ? made.seen > 0 : kind === "derived" ? made.seen === 0 && made.paused > 0 : made.seen === 0 && made.paused === 0 && made.pauses === 0;
    if (!fits) return fail("an edit is announced, a derived write is paused and no other write is made", action, { kind, records: made });

    if (applied) inverses.push(left.inverse);
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
  console.log(`${failure.check}, on ${failure.table}, list ${failure.list}, seed ${failure.seed}`);
  console.log(`  action ${JSON.stringify(failure.action)}`);
  console.log(`  detail ${JSON.stringify(failure.detail)}`);
};

// The 300 lists, each of 40 actions of every kind from the generator of the reducer's laws, are
// spread over the tables as the laws spread them, so every table gets lists and a small table
// gets more of them. They run in six parts, so that one part is a short run. A list is run with
// a formula engine named or without one, turn about.
test.each(Array.from({ length: PARTS }, (unused, part) => [part + 1]))(`lists of every action kind give the same bytes and the same tree, part %i of ${PARTS}`, (part) => {
  const tables = listedTables();
  expect(tables.length).toBeGreaterThanOrEqual(11);
  const spread = listTables(tables, LISTS);
  expect(new Set(spread).size).toBe(tables.length);
  const random = rng(SEED);
  const seeds = spread.map(() => Math.floor(random() * 4294967296));
  const counts = {};
  const started = Date.now();
  let failure = null;
  let lists = 0;

  for (let index = part - 1; index < LISTS && failure === null; index += PARTS) {
    const table = tables.find((one) => one.name === spread[index]);
    const formulas = index % 2 === 0 ? null : {};
    const actions = genList(rng(seeds[index]), table.model, LENGTH, { formulas });
    const run = twins(table.name, table.model, { counts, formulas });
    for (let i = 0; i < actions.length && failure === null; i++) failure = run.step(actions[i]);
    if (failure === null) failure = run.tree();
    if (failure === null) failure = run.undo();
    if (failure !== null) failure = { list: index, seed: seeds[index], ...failure };
    for (const observer of observers.splice(0)) observer.disconnect();
    lists += 1;
  }
  report(failure);
  console.log(`part ${part}: lists ${lists}, actions ${lists * LENGTH} and their inverses, ${Date.now() - started} ms`);
  console.log(`  ${JSON.stringify(counts)}`);

  expect(failure).toBeNull();
  expect(lists).toBe(LISTS / PARTS);
  for (const kind of KINDS) expect([kind, (counts[kind]?.applied ?? 0) > 0]).toEqual([kind, true]);
  expect(counts.records.edit).toBeGreaterThan(1000);
  expect(counts.records.none).toBeGreaterThan(100);
});

test("a row insert keeps the rules block last and every rule", () => {
  const src = readFileSync(join(GOLDEN, "rules.html"), "utf8");
  const tail = src.slice(src.indexOf("<template rules>"));
  document.body.innerHTML = src;
  const page = watch(document.body.firstElementChild);
  page.backing.insertRow(page.backing.rows().length, { id: "last", pos: "zz" });
  expect(page.backing.bytes().endsWith(tail)).toBe(true);
  expect(page.table.lastElementChild.localName).toBe("template");
});

test("a hand-edited table with its rules block before the rows gets it back last", () => {
  const src = readFileSync(join(GOLDEN, "rules.html"), "utf8");
  const start = src.indexOf("<template rules>");
  const block = src.slice(start, src.indexOf("</template>") + "</template>".length);
  document.body.innerHTML = `${src.slice(0, start)}</table>`.replace("<tbody>", `${block}<tbody>`);
  const page = watch(document.body.firstElementChild);
  page.backing.insertRow(page.backing.rows().length, { id: "last", pos: "zz" });
  const bytes = page.backing.bytes();
  expect(bytes.endsWith(`${block}</table>`)).toBe(true);
  expect(page.table.lastElementChild.localName).toBe("template");
});

test("setRules writes the rules block a reader reads back", () => {
  const start = longSheet(3);
  document.body.innerHTML = tableHtml(start);
  const page = watch(document.body.firstElementChild);
  const rules = [
    { id: "a", pos: "G", kind: "check", range: "A1:A9" },
    { id: "b", pos: "V", kind: "list", range: "C2:C40", items: ["Open", "Done"] },
  ];
  page.backing.setRules(rules);
  expect(page.backing.bytes()).toBe(tableHtml({ ...start, rules }));
  expect(domBacking(page.table).rules()).toEqual(rules);
  page.backing.setRules([]);
  expect(Array.from(page.table.children).some((part) => part.localName === "template")).toBe(false);
});
