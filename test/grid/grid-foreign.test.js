import { readFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalGrid, domAdapter } from "../../src/grid/codec/canonical.js";
import { gridModel } from "../../src/grid/codec/read.js";
import { tableHtml } from "../../src/grid/codec/write.js";
import { addFormatter } from "../../src/grid/format.js";
import { createGrid } from "../../src/grid/grid.js";
import { GridRefused } from "../../src/grid/ops.js";
import { splitTables } from "./support/laws.js";

global.__SAP_KEEP_CONSOLE__ = true;

const GOLDEN = join(__dirname, "..", "grid-codec", "golden");
const TODAY = 46095;

const tiny = () => tableHtml(gridModel(splitTables(readFileSync(join(GOLDEN, "tiny.html"), "utf8"))[0], 0));

// A table of one column over these rows, each given as its cells' markup.
const table = (rows, cols = 1) =>
  `<table grid><colgroup>${["ca", "cb", "cc"].slice(0, cols).map((id, c) => `<col data-id="${id}" data-pos="${"GVl"[c]}">`).join("")}</colgroup>\n<tbody>\n${rows
    .map((cells, r) => `<tr data-id="r${r + 1}" data-pos="${"GOVdl"[r]}">${cells}</tr>`)
    .join("\n")}\n</tbody></table>`;

const observers = [];
const offs = [];

afterEach(() => {
  for (const observer of observers.splice(0)) observer.disconnect();
  for (const off of offs.splice(0)) off();
  document.body.innerHTML = "";
});

// A live table and a Grid over it whose `write` hides what it writes from the page, as the plugin
// kit's write does. `edits()` returns the mutation records the page saw since the last call, and
// `undo(records)` puts them back in reverse, as a page undo does, and returns the nodes it touched.
function live(html) {
  document.body.innerHTML = html;
  const element = document.body.querySelector("table");
  const observer = new MutationObserver(() => {});
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true, attributeOldValue: true, characterDataOldValue: true });
  observers.push(observer);
  let seen = [];
  const write = (fn) => {
    seen.push(...observer.takeRecords());
    try {
      return fn();
    } finally {
      observer.takeRecords();
    }
  };
  const edits = () => {
    const out = [...seen, ...observer.takeRecords()];
    seen = [];
    return out;
  };
  const undo = (records) => {
    const nodes = new Set();
    for (const record of records.slice().reverse()) {
      nodes.add(record.target);
      if (record.type === "attributes") {
        if (record.oldValue === null) record.target.removeAttribute(record.attributeName);
        else record.target.setAttribute(record.attributeName, record.oldValue);
      } else if (record.type === "characterData") record.target.data = record.oldValue;
      else {
        for (const node of record.addedNodes) node.remove();
        for (const node of Array.from(record.removedNodes).reverse()) record.target.insertBefore(node, record.nextSibling);
      }
    }
    observer.takeRecords();
    return [...nodes];
  };
  let minted = 0;
  const grid = createGrid(element, { write, today: () => TODAY, newId: (prefix) => `${prefix}n${++minted}` });
  const heard = [];
  grid.on("change", (event) => heard.push(event));
  const td = (r, c) => element.querySelectorAll("tr")[r].querySelectorAll(":scope > td")[c];
  return { table: element, grid, heard, edits, undo, td, bytes: () => canonicalGrid(domAdapter, element) };
}

// What a call gives, or the code of the GridRefused it threw.
const attempt = (run) => {
  try {
    return run();
  } catch (error) {
    if (error instanceof GridRefused) return error.code;
    throw error;
  }
};

// A page undo of what `act` wrote, taken in as the plugin's pass takes it.
function undone(html, act, ref) {
  const page = live(html);
  const start = page.bytes();
  const value = page.grid.get(ref);
  act(page.grid);
  const records = page.edits();
  const event = page.grid.foreignWrite(page.undo(records));
  return { page, start, value, records: records.length, event };
}

test("a page undo of a cell's format change keeps the number: a typed look, a date, a percent and a formula's result", () => {
  const date = table(['<td n v="46095" fmt="m/d/yyyy">3/14/2026</td>']);
  const percent = table(['<td n v="0.125" fmt="0%">13%</td>']);
  const cases = [
    ["typed look", tiny(), (grid) => grid.set("B2", "1,200"), "B2"],
    ["date", date, (grid) => grid.format("A1", { fmt: "mmm d, yyyy" }), "A1"],
    ["percent", percent, (grid) => grid.format("A1", { fmt: "0.00%" }), "A1"],
    ["formula", tiny(), (grid) => grid.format("C2", { fmt: "0.00%" }), "C2"],
  ];
  const out = cases.map(([name, html, act, ref]) => {
    const { page, start, value, records, event } = undone(html, act, ref);
    return [name, records > 0, event?.source, page.grid.get(ref), page.bytes() === start, page.grid.issues];
  });
  expect(out).toEqual([
    ["typed look", true, "dom", 1200, true, []],
    ["date", true, "dom", 46095, true, []],
    ["percent", true, "dom", 0.125, true, []],
    ["formula", true, "dom", 0.8, true, []],
  ]);
});

test("a page undo of a whole-column format draws that column's cells again", () => {
  const out = [
    ["C:C", "0.00%", "C2"],
    ["B:B", "#,##0", "B3"],
  ].map(([area, fmt, ref]) => {
    const { page, start, value, records } = undone(tiny(), (grid) => grid.format(area, { fmt }), ref);
    return [area, records, page.grid.get(ref) === value, page.bytes() === start];
  });
  expect(out).toEqual([
    ["C:C", 1, true, true],
    ["B:B", 1, true, true],
  ]);
});

test("a page undo of a whole-column format is taken in by the next command when no pass ran first", () => {
  const page = live(tiny());
  const start = page.bytes();
  page.grid.format("C:C", { fmt: "0.00%" });
  page.undo(page.edits());
  page.grid.set("A2", "Lease");
  expect([page.td(1, 2).outerHTML, page.td(2, 2).textContent, page.bytes()]).toEqual(['<td n="" f="=B2/B$5" v="0.8">80%</td>', "20%", start.replace("<td>Rent</td>", "<td>Lease</td>")]);
});

test("a write from outside the grid that also changes a column gets the cell's derived parts put right", () => {
  const page = live(table(['<td n v="1200" fmt="$#,##0.00">$1,200.00</td>']));
  page.table.querySelector("col").setAttribute("style", "width:140px");
  page.td(0, 0).textContent = "999";
  const event = page.grid.foreignWrite([page.table.querySelector("col"), page.td(0, 0)]);
  expect([event.rescanned, page.grid.get("A1"), page.td(0, 0).outerHTML]).toEqual([true, 999, '<td n="" v="999" fmt="$#,##0.00">$999.00</td>']);
});

test("a write from outside the grid read with a merge change in a later row still gets its derived parts put right", () => {
  const page = live(table(['<td n v="1200" fmt="$#,##0.00">$1,200.00</td><td>x</td>', '<td rowspan="2">Tall</td><td>b</td>', "<td hidden></td><td>c</td>"], 2));
  page.td(0, 0).textContent = "999";
  page.td(1, 0).removeAttribute("rowspan");
  page.td(2, 0).removeAttribute("hidden");
  const event = page.grid.foreignWrite([page.td(0, 0), page.td(1, 0), page.td(2, 0)]);
  expect([event.rescanned, page.grid.get("A1"), page.td(0, 0).outerHTML, page.grid.issues]).toEqual([true, 999, '<td n="" v="999" fmt="$#,##0.00">$999.00</td>', []]);
});

test("a merge made or undone from outside the grid is read across all its rows", () => {
  const unmerge = live(table(['<td rowspan="2">Tall</td><td>b1</td>', "<td hidden></td><td>b2</td>"], 2));
  unmerge.td(0, 0).removeAttribute("rowspan");
  unmerge.td(1, 0).removeAttribute("hidden");
  const unmerged = attempt(() => unmerge.grid.set("A2", "hello"))?.source;
  const merge = live(table(["<td>Tall</td><td>b1</td>", "<td></td><td>b2</td>"], 2));
  merge.td(0, 0).setAttribute("rowspan", "2");
  merge.td(1, 0).setAttribute("hidden", "");
  const merged = attempt(() => merge.grid.set("A1", "Title"))?.source;
  expect([unmerged, unmerge.grid.get("A1:A2"), unmerge.grid.issues, merged, merge.grid.get("A1:A2"), merge.grid.issues]).toEqual([
    "api",
    [["Tall"], ["hello"]],
    [],
    "api",
    [["Title"], [null]],
    [],
  ]);
});

test("a format an added formatter knows is put right after a write from outside the grid", () => {
  const lb = '0.0" lb"';
  offs.push(addFormatter({ test: (fmt) => fmt === lb, format: (value) => (typeof value === "number" ? `${value.toFixed(1)} lb` : String(value)), kind: "number" }));
  const typed = live(table(["<td>TBD</td>"]).replace('data-pos="G">', `data-pos="G" fmt="${lb.replaceAll('"', "&quot;")}">`));
  typed.td(0, 0).textContent = "25";
  typed.grid.foreignWrite([typed.td(0, 0)]);
  const both = live(table(['<td n v="10" fmt="0.00">10.00</td>']));
  both.td(0, 0).setAttribute("fmt", lb);
  both.td(0, 0).textContent = "25";
  both.grid.foreignWrite([both.td(0, 0)]);
  expect([typed.td(0, 0).outerHTML, typed.grid.get("A1"), both.td(0, 0).outerHTML, both.grid.get("A1")]).toEqual([
    '<td n="" v="25">25.0 lb</td>',
    25,
    '<td n="" v="25" fmt="0.0&quot; lb&quot;">25.0 lb</td>',
    25,
  ]);
});

test("under a format no formatter knows, a write from outside the grid gets its number and text marks put right and keeps its own text", () => {
  const kg = "0.0&quot; kg&quot;";
  const page = live(table(["<td>TBD</td>", "<td t>42</td>", '<td n v="12.3">12.3 kg</td>']).replace('data-pos="G">', `data-pos="G" fmt="${kg}">`));
  page.td(0, 0).textContent = "42";
  page.td(1, 0).textContent = "";
  page.td(2, 0).setAttribute("style", "color:#ff0000");
  page.grid.foreignWrite([page.td(0, 0), page.td(1, 0), page.td(2, 0)]);
  expect([page.td(0, 0).outerHTML, page.grid.get("A1"), page.bytes().split("\n").slice(2, 5)]).toEqual([
    '<td n="">42</td>',
    42,
    ['<tr data-id="r1" data-pos="G"><td n>42</td></tr>', '<tr data-id="r2" data-pos="O"></tr>', '<tr data-id="r3" data-pos="V"><td n v="12.3" style="color:#ff0000">12.3 kg</td></tr>'],
  ]);
});

test("a command takes in a write from outside the grid before it reads the sheet", () => {
  const back = live(table(["<td>Rent</td>"]));
  back.td(0, 0).textContent = "Bread";
  const setBack = back.grid.set("A1", "Rent");

  const cleared = live(table(["<td>Rent</td>", "<td></td>"]));
  cleared.td(1, 0).textContent = "Gas";
  const clear = cleared.grid.clear("A2");

  const top = live(table(["<td>Rent</td>", "<td>Food</td>"]));
  const row = document.createElement("tr");
  row.setAttribute("data-id", "r0");
  row.setAttribute("data-pos", "A");
  row.innerHTML = "<td>Top</td>";
  top.table.querySelector("tbody").prepend(row);
  top.grid.deleteRows("1");

  const deleted = live(table(["<td>Rent</td>", "<td>Food</td>"]));
  deleted.td(1, 0).textContent = "Fuel";
  const removal = deleted.grid.deleteRows("2");
  deleted.grid.apply(removal.inverse);

  expect([
    [setBack?.source, back.td(0, 0).textContent, back.heard.map((event) => event.source)],
    [clear?.source, cleared.grid.get("A2"), cleared.table.querySelectorAll("tr")[1].innerHTML],
    top.grid.get("A1:A2"),
    deleted.grid.get("A1:A2"),
  ]).toEqual([["api", "Rent", ["dom", "api"]], ["api", null, ""], [["Rent"], ["Food"]], [["Rent"], ["Fuel"]]]);
});

test("apply takes in a write from outside the grid in the rows it touches before it applies", () => {
  const page = live(table(["<td>Rent</td>", "<td>Food</td>"]));
  page.td(1, 0).textContent = "Fuel";
  const event = page.grid.apply({ v: 1, t: "set", sheet: "", cells: [["r2", "ca", "Gas"]] });
  page.grid.apply(event.inverse);
  expect([page.heard.map((one) => one.source), page.grid.get("A2"), page.td(1, 0).textContent]).toEqual([["dom", "api", "api"], "Fuel", "Fuel"]);
});
