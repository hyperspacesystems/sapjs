import { readFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalGrid, domAdapter } from "../../src/grid/codec/canonical.js";
import { gridModel } from "../../src/grid/codec/read.js";
import { tableHtml } from "../../src/grid/codec/write.js";
import { createGrid } from "../../src/grid/grid.js";
import * as gridIndex from "../../src/grid/index.js";
import { GridRefused } from "../../src/grid/ops.js";
import { splitTables } from "./support/laws.js";

global.__SAP_KEEP_CONSOLE__ = true;

const GOLDEN = join(__dirname, "..", "grid-codec", "golden");
const TODAY = 46095;

const golden = (file) => tableHtml(gridModel(splitTables(readFileSync(join(GOLDEN, `${file}.html`), "utf8"))[0], 0));

// A table of one column over these rows, each given as its cell's markup.
const oneCol = (cells) =>
  `<table grid><colgroup><col data-id="ca" data-pos="G"></colgroup>\n<tbody>\n${cells.map((cell, r) => `<tr data-id="r${r + 1}" data-pos="${"GOV"[r]}">${cell}</tr>`).join("\n")}\n</tbody></table>`;

const observers = [];

afterEach(() => {
  for (const observer of observers.splice(0)) observer.disconnect();
  document.body.innerHTML = "";
});

// A live table and a Grid over it whose `write` hides what it writes from the page, as the plugin
// kit's write does. `records()` returns how many mutation records the page saw and how many
// writes were hidden since the last call.
function live(html) {
  document.body.innerHTML = html;
  const table = document.body.querySelector("table");
  const observer = new MutationObserver(() => {});
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  observers.push(observer);
  let seen = 0;
  let pauses = 0;
  const write = (fn) => {
    seen += observer.takeRecords().length;
    pauses += 1;
    try {
      return fn();
    } finally {
      observer.takeRecords();
    }
  };
  const records = () => {
    const out = { seen: seen + observer.takeRecords().length, pauses };
    seen = 0;
    pauses = 0;
    return out;
  };
  let minted = 0;
  const grid = createGrid(table, { write, today: () => TODAY, newId: (prefix) => `${prefix}n${++minted}` });
  const heard = [];
  grid.on("change", (event) => heard.push(event));
  return { table, grid, heard, records, bytes: () => canonicalGrid(domAdapter, table) };
}

// What a call gives, or the code of the GridRefused it threw, or the name of any other error.
const attempt = (run) => {
  try {
    return run();
  } catch (error) {
    return error instanceof GridRefused ? error.code : error.name;
  }
};

test("an edit is a write the page sees, and a formula's new result through apply is a write it does not see that still fires an event", () => {
  const page = live(golden("tiny"));
  page.grid.set("B2", "1,200");
  const edit = page.records();
  const results = [{ f: "=B3*2" }, { f: "=B3*2", r: 600 }, { f: "=B3*2", r: 650 }, { f: "=B3*2", r: "n/a" }, { f: "=B3*2" }].map((content) => {
    const event = page.grid.apply({ v: 1, t: "set", sheet: "", cells: [["r4", "cb", content]] });
    const { seen, pauses } = page.records();
    return [event?.revision, seen > 0, pauses > 0, page.grid.get("B4")];
  });
  expect([edit.seen > 0, edit.pauses, results]).toEqual([
    true,
    0,
    [
      [2, true, true, null],
      [3, false, true, 600],
      [4, false, true, 650],
      [5, false, true, "n/a"],
      [6, false, true, null],
    ],
  ]);
});

test("a grow paste of empty cells that bring a format adds the rows with the format", () => {
  const page = live(golden("tiny"));
  const event = attempt(() => page.grid.setRange("A7", [[{ content: null, fmt: "0.00" }]], { grow: true }));
  expect([event?.source, page.grid.size.rows, page.bytes().split("\n").at(-2)]).toEqual(["api", 7, '<tr data-id="rn1" data-pos="t"><td fmt="0.00"></td></tr>']);
});

test("a write that changes only a formula's result or a cell's shown text fires an event and moves the revision", () => {
  const percent = live(oneCol(['<td n f="=1+1" v="2" fmt="0%">200%</td>']));
  const result = percent.grid.setRange("A1", [[{ content: { f: "=1+1", r: 5 } }]]);
  const shown = percent.table.querySelector("td").textContent;
  const wiped = percent.grid.apply({ v: 1, t: "set", sheet: "", cells: [["r1", "ca", { f: "=1+1" }]] });
  const rounded = live(oneCol(['<td n f="=1+1" v="2" fmt="0">2</td>']));
  const valueOnly = rounded.grid.setRange("A1", [[{ content: { f: "=1+1", r: 2.4 } }]]);
  const kg = live(oneCol(['<td n v="12.3" fmt="0.0&quot; kg&quot;">12.3 kg</td>']));
  const textOnly = kg.grid.apply({ v: 1, t: "set", sheet: "", cells: [["r1", "ca", 12.3]] });
  expect([
    [result?.revision, result?.cells.length, shown],
    [wiped?.revision, percent.grid.get("A1")],
    [valueOnly?.revision, rounded.grid.get("A1"), rounded.table.querySelector("td").textContent],
    [textOnly?.revision, kg.grid.get("A1"), kg.table.querySelector("td").textContent],
  ]).toEqual([
    [1, 1, "500%"],
    [2, null],
    [1, 2.4, "2"],
    [1, 12.3, "12.3"],
  ]);
});

test("text that is not parsed, and the text and formula of an object item, are made plain as the cell editor makes them", () => {
  const page = live(golden("empty"));
  const event = attempt(() => page.grid.setRange("A1", [["line1\r\nline2", { content: "a\rb\u0000c" }, { content: { f: "=LEN(\"x\r\ny\")" } }, { f: "=LEN(\"p\rq\")" }]], { detect: false, grow: true }));
  expect([event?.source, page.grid.get("A1:B1"), page.grid.input("C1"), page.grid.input("D1")]).toEqual(["api", [["line1\nline2", "a\nbc"]], '=LEN("x\ny")', '=LEN("p\nq")']);
});

test("a freeze, a column change or a row change that asks for what the sheet has fires no event, and one that changes something does", () => {
  const page = live(golden("tiny"));
  const pos = page.table.querySelectorAll("tr")[1].getAttribute("data-pos");
  const quiet = [
    { v: 1, t: "freeze", sheet: "", rowsThrough: "r1", colsThrough: "ca" },
    { v: 1, t: "changeCols", sheet: "", cols: [{ id: "ca", width: 180 }] },
    { v: 1, t: "changeRows", sheet: "", rows: [{ id: "r2", pos }] },
  ].map((action) => attempt(() => page.grid.apply(action)));
  const start = page.bytes();
  const loud = [
    { v: 1, t: "freeze", sheet: "", rowsThrough: null, colsThrough: "ca" },
    { v: 1, t: "changeCols", sheet: "", cols: [{ id: "ca", width: 200 }] },
    { v: 1, t: "changeRows", sheet: "", rows: [{ id: "r2", height: 30 }] },
  ].map((action) => attempt(() => page.grid.apply(action))?.revision);
  expect([quiet, page.heard.length, start === golden("tiny"), loud]).toEqual([[null, null, null], 3, true, [1, 2, 3]]);
});

test("deleting every row of a merge down a column, or every column of a merge across a row, fires one event whose inverse puts the merge back", () => {
  const html = `<table grid><colgroup><col data-id="ca" data-pos="G"><col data-id="cb" data-pos="V"><col data-id="cc" data-pos="l"></colgroup>
<tbody>
<tr data-id="r1" data-pos="G"><td>Item</td><td>Note</td><td>Kind</td></tr>
<tr data-id="r2" data-pos="O"><td>Box</td><td>a</td><td>big</td></tr>
<tr data-id="r3" data-pos="V"><td>Bag</td><td>b</td><td>small</td></tr>
</tbody></table>`;
  const out = [
    ["B2:B3", (grid) => grid.deleteRows("2:3")],
    ["B2:C2", (grid) => grid.deleteCols("B:C")],
  ].map(([area, remove]) => {
    const page = live(html);
    page.grid.merge(area);
    const merged = page.bytes();
    const event = attempt(() => remove(page.grid));
    const removed = typeof event === "string" ? event : [event?.revision, event?.structure, event?.rows.removed.length + event?.cols.removed.length, event?.cells.length];
    attempt(() => page.grid.apply(event?.inverse));
    return [area, removed, page.bytes() === merged];
  });
  expect(out).toEqual([
    ["B2:B3", [2, true, 2, 0], true],
    ["B2:C2", [2, true, 2, 0], true],
  ]);
});

test("apply refuses an action of the wrong shape as bad_action", () => {
  const page = live(golden("tiny"));
  const shapes = [null, 5, { v: 1, t: "set", sheet: "", cells: 5 }, { v: 1, t: "set", sheet: "", cells: [5] }, { v: 1, t: "format", sheet: "", cells: [null] }, { v: 1, t: "batch" }, { v: 1, t: "batch", actions: [null] }];
  expect(shapes.map((action) => attempt(() => page.grid.apply(action)))).toEqual(Array(shapes.length).fill("bad_action"));
  expect([page.bytes() === golden("tiny"), page.heard.length]).toEqual([true, 0]);
});

test("the grid index exports the delimited text helpers", () => {
  expect(["DelimitedError", "detectDelimiter", "parseDelimited", "writeDelimited", "protectField"].map((name) => typeof gridIndex[name])).toEqual(Array(5).fill("function"));
});
