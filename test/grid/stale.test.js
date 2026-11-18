import { readFileSync } from "node:fs";
import { join } from "node:path";

import { modelBacking } from "../../src/grid/backing-model.js";
import { canonicalGrid, domAdapter } from "../../src/grid/codec/canonical.js";
import { patchGrid } from "../../src/grid/codec/patch.js";
import { gridModel } from "../../src/grid/codec/read.js";
import { tableHtml } from "../../src/grid/codec/write.js";
import { derive } from "../../src/grid/content.js";
import { addFormatter } from "../../src/grid/format.js";
import { createGrid } from "../../src/grid/grid.js";
import { apply as applyAction } from "../../src/grid/ops.js";
import { splitTables } from "./support/laws.js";

global.__SAP_KEEP_CONSOLE__ = true;

const GOLDEN = join(__dirname, "..", "grid-codec", "golden");
const TODAY = 46095;
const KG = '0.0" kg"';

const tiny = () => tableHtml(gridModel(splitTables(readFileSync(join(GOLDEN, "tiny.html"), "utf8"))[0], 0));

// A table with no formula: a text column, then currency, percent, date and grouped columns.
const FORMATTED = `<table grid><colgroup><col data-id="ca" data-pos="G"><col data-id="cb" data-pos="O" fmt="$#,##0.00"><col data-id="cc" data-pos="V" fmt="0%"><col data-id="cd" data-pos="d" fmt="m/d/yyyy"><col data-id="ce" data-pos="l" fmt="#,##0"></colgroup>
<tbody>
<tr data-id="r1" data-pos="G"><td>Rent</td><td n v="1200">$1,200.00</td><td n v="0.8">80%</td><td n v="46095">3/14/2026</td><td n v="1200">1,200</td></tr>
<tr data-id="r2" data-pos="V"><td>Food</td><td n v="300">$300.00</td><td n v="0.2">20%</td><td n v="46096">3/15/2026</td><td n>300</td></tr>
</tbody></table>`;

// A table with a currency column and a column under a format no formatter knows, which holds text
// some formatter wrote once.
const UNKNOWN = `<table grid><colgroup><col data-id="ca" data-pos="G" fmt="$#,##0.00"><col data-id="cb" data-pos="V" fmt="${KG.replaceAll('"', "&quot;")}"></colgroup>
<tbody>
<tr data-id="r1" data-pos="G"><td n v="1200">$1,200.00</td><td n v="12.3">12.3 kg</td></tr>
<tr data-id="r2" data-pos="V"><td n v="300">$300.00</td><td n v="4">4.0 kg</td></tr>
</tbody></table>`;

const observers = [];
const offs = [];

afterEach(() => {
  for (const observer of observers.splice(0)) observer.disconnect();
  for (const off of offs.splice(0)) off();
  document.body.innerHTML = "";
});

// A live table and a Grid over it whose `write` hides what it writes from the page, as the plugin
// kit's write does. `records()` gives how many mutation records the page saw and how many writes
// were hidden since the Grid was made or since the last call.
function live(html, { mayWrite } = {}) {
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
  const grid = createGrid(table, { write, today: () => TODAY, ...(mayWrite ? { mayWrite } : null) });
  const heard = [];
  grid.on("change", (event) => heard.push(event));
  const td = (r, c) => table.querySelectorAll("tr")[r].querySelectorAll(":scope > td")[c];
  return { table, grid, heard, records, td, bytes: () => canonicalGrid(domAdapter, table) };
}

const rowLine = (bytes, id) => bytes.split("\n").find((line) => line.startsWith(`<tr data-id="${id}"`));

test("a host-patched table with no formula loads with its values formatted, its revision at 0, nothing the page sees, and no stale mark", () => {
  const values = [
    [450, 0.25, 46100, 1234],
    [-12.5, 1, 46200, 99999],
  ];
  const host = patchGrid(FORMATTED, [{ range: "B1:E2", values }]).bytes;
  expect(rowLine(host, "r1")).toBe('<tr data-id="r1" data-pos="G"><td>Rent</td><td n>450</td><td n>0.25</td><td n>46100</td><td n>1234</td></tr>');
  const typed = live(FORMATTED);
  typed.grid.setRange("B1", values);
  const want = typed.bytes();

  const page = live(host);
  expect([page.grid.revision, page.records().seen, page.table.hasAttribute("stale"), page.grid.issues]).toEqual([0, 0, false, []]);
  expect(page.bytes()).toBe(want);
  expect(rowLine(want, "r1")).toBe('<tr data-id="r1" data-pos="G"><td>Rent</td><td n v="450">$450.00</td><td n v="0.25">25%</td><td n v="46100">3/19/2026</td><td n v="1234">1,234</td></tr>');
});

test("a row a host appended is formatted from its columns' formats, and a date out of range shows its number", () => {
  let n = 0;
  const page = live(patchGrid(FORMATTED, [{ append: [["Gas", 45.5, 0.1, -5, 2000]] }], { newId: () => `rx${++n}` }).bytes);
  expect([rowLine(page.bytes(), "rx1"), page.table.hasAttribute("stale"), page.grid.revision]).toEqual(['<tr data-id="rx1" data-pos="l"><td>Gas</td><td n v="45.5">$45.50</td><td n v="0.1">10%</td><td n>-5</td><td n v="2000">2,000</td></tr>', false, 0]);
});

test("a page that may not write still shows a host-patched table formatted", () => {
  const page = live(patchGrid(FORMATTED, [{ range: "B1", values: [[450]] }]).bytes, { mayWrite: () => false });
  expect([page.td(0, 1).outerHTML, page.table.hasAttribute("stale"), page.records().seen, attempt(() => page.grid.set("B2", "5"))]).toEqual(['<td n="" v="450">$450.00</td>', false, 0, "read_only"]);
});

test("a host-patched table with a formula loads with its values formatted and keeps its stale mark, because no engine calculated the formulas again", () => {
  const host = patchGrid(tiny(), [{ range: "B2", values: [[450]] }]).bytes;
  const page = live(host);
  expect([page.grid.revision, page.records().seen, page.table.hasAttribute("stale")]).toEqual([0, 0, true]);
  expect(rowLine(page.bytes(), "r2")).toBe('<tr data-id="r2" data-pos="G"><td>Rent</td><td n v="450">$450.00</td><td n f="=B2/B$5" v="0.8">80%</td></tr>');
});

test("a table with a formula keeps its stale mark on reload after an undo that brings a formula back: its bytes cannot tell it from a host patch whose results are out of date", () => {
  const formulas = (bytes) => ["r2", "r3", "r5"].map((id) => rowLine(bytes, id).match(/<td n f=[^>]*>[^<]*<\/td>/g));
  const start = tiny();

  const undone = live(start);
  undone.grid.apply(undone.grid.deleteCols("C").inverse);
  const reloaded = live(undone.bytes());

  const edited = live(start);
  const removal = edited.grid.deleteCols("C");
  edited.grid.set("B2", "450");
  edited.grid.apply(removal.inverse);

  const host = live(patchGrid(start, [{ range: "B2", values: [[450]] }]).bytes);
  expect([reloaded.table.hasAttribute("stale"), edited.table.hasAttribute("stale"), host.table.hasAttribute("stale")]).toEqual([true, true, true]);
  expect([formulas(reloaded.bytes()), formulas(edited.bytes()), formulas(host.bytes())]).toEqual([formulas(start), formulas(start), formulas(start)]);
  expect([edited.grid.get("B2"), edited.grid.get("C2"), host.grid.get("B2"), host.grid.get("C2")]).toEqual([450, 0.8, 450, 0.8]);
});

test("under a format no formatter knows, a cell keeps its text, and the stale mark stays while a number there shows its plain value", () => {
  const dollars = live(patchGrid(UNKNOWN, [{ range: "A1", values: [[450]] }]).bytes);
  const both = live(patchGrid(UNKNOWN, [{ range: "A1:B1", values: [[450, 7]] }]).bytes);
  expect([
    [rowLine(dollars.bytes(), "r1"), dollars.table.hasAttribute("stale")],
    [rowLine(both.bytes(), "r1"), rowLine(both.bytes(), "r2"), both.table.hasAttribute("stale")],
  ]).toEqual([
    ['<tr data-id="r1" data-pos="G"><td n v="450">$450.00</td><td n v="12.3">12.3 kg</td></tr>', false],
    ['<tr data-id="r1" data-pos="G"><td n v="450">$450.00</td><td n>7</td></tr>', '<tr data-id="r2" data-pos="V"><td n v="300">$300.00</td><td n v="4">4.0 kg</td></tr>', true],
  ]);
});

test("a format an added formatter knows is formatted at load and leaves nothing waiting", () => {
  offs.push(addFormatter({ test: (fmt) => fmt === KG, format: (value) => (typeof value === "number" ? `${shownOne(value)} kg` : String(value)), kind: "number" }));
  const page = live(patchGrid(UNKNOWN, [{ range: "A1:B1", values: [[450, 7]] }]).bytes);
  expect([rowLine(page.bytes(), "r1"), page.table.hasAttribute("stale")]).toEqual(['<tr data-id="r1" data-pos="G"><td n v="450">$450.00</td><td n v="7">7.0 kg</td></tr>', false]);
});

const shownOne = (value) => (Math.round(value * 10) / 10).toFixed(1);

test("a number the grid writes under a format no formatter knows shows its plain value and marks the table stale; a known format, an added one or a style alone does not", () => {
  const kg = live(UNKNOWN);
  kg.grid.format("B1", { style: { "font-weight": "bold" } });
  const styled = kg.table.hasAttribute("stale");
  kg.grid.set("A2", "75");
  const dollars = kg.table.hasAttribute("stale");
  kg.grid.set("B2", "15");
  expect([styled, dollars, kg.td(1, 1).outerHTML, kg.table.hasAttribute("stale"), kg.grid.revision]).toEqual([false, false, '<td n="">15</td>', true, 3]);

  offs.push(addFormatter({ test: (fmt) => fmt === KG, format: (value) => `${shownOne(value)} kg`, kind: "number" }));
  const added = live(UNKNOWN);
  added.grid.set("B2", "15");
  expect([added.td(1, 1).textContent, added.table.hasAttribute("stale")]).toEqual(["15.0 kg", false]);
});

test("a host writing through the model backing gets the same stale mark and bytes as the live table: marked for a number under a format no formatter knows, not under a known format or none", () => {
  const writes = [
    [UNKNOWN, "B2", "15"],
    [UNKNOWN, "A2", "75"],
    [FORMATTED, "A2", "5"],
  ];
  const results = writes.map(([html, ref, typed]) => {
    const page = live(html);
    const event = page.grid.set(ref, typed);
    const model = modelBacking(gridModel(html, 0));
    const out = applyAction(model, event.action, { derive });
    return [out.out, tableHtml(model.sheet) === page.bytes(), model.sheet.stale === true, page.table.hasAttribute("stale")];
  });
  expect(results).toEqual([
    ["applied", true, true, true],
    ["applied", true, false, false],
    ["applied", true, false, false],
  ]);
});

test("an undo that puts formatted text back under a format no formatter knows leaves the mark off", () => {
  const page = live(UNKNOWN);
  const typed = page.grid.set("B2", "15");
  const unmarked = live(page.bytes().replace("<table grid stale>", "<table grid>"));
  unmarked.grid.apply(typed.inverse);
  expect([rowLine(unmarked.bytes(), "r2"), unmarked.table.hasAttribute("stale")]).toEqual(['<tr data-id="r2" data-pos="V"><td n v="300">$300.00</td><td n v="4">4.0 kg</td></tr>', false]);
});

test("a host patch that reaches an open page is formatted when the grid reads the table again, its appended row with a derived event that leaves the revision", () => {
  const page = live(FORMATTED);
  let n = 0;
  const host = patchGrid(page.bytes(), [{ range: "B1", values: [[450]] }, { append: [["Gas", 45.5, 0.1, -5, 2000]] }], { newId: () => `rx${++n}` }).bytes;
  const holder = document.createElement("div");
  holder.innerHTML = host;
  page.table.setAttribute("stale", "");
  page.table.replaceChildren(...holder.querySelector("table").childNodes);
  page.grid.foreignWrite([page.table]);
  const bytes = page.bytes();
  expect([
    page.heard.map((event) => [event.source, event.revision, event.cells.map((cell) => `${cell.row} ${cell.col}`)]),
    rowLine(bytes, "r1"),
    rowLine(bytes, "rx1"),
    page.table.hasAttribute("stale"),
  ]).toEqual([
    [
      ["dom", 1, []],
      ["derived", 1, ["rx1 cb", "rx1 cc", "rx1 ce"]],
    ],
    '<tr data-id="r1" data-pos="G"><td>Rent</td><td n v="450">$450.00</td><td n v="0.8">80%</td><td n v="46095">3/14/2026</td><td n v="1200">1,200</td></tr>',
    '<tr data-id="rx1" data-pos="l"><td>Gas</td><td n v="45.5">$45.50</td><td n v="0.1">10%</td><td n>-5</td><td n v="2000">2,000</td></tr>',
    false,
  ]);
});

test("a stale table with issues is left as it is until it is repaired, and the repair formats it and removes the mark", () => {
  const host = patchGrid(FORMATTED, [{ range: "B1", values: [[450]] }]).bytes.replace('<tr data-id="r2"', '<tr data-id="r1"');
  const page = live(host);
  expect([page.grid.issues.map((issue) => issue.code), page.records(), page.table.hasAttribute("stale"), rowLine(page.bytes(), "r1")]).toEqual([
    ["row_id_duplicate"],
    { seen: 0, pauses: 0 },
    true,
    '<tr data-id="r1" data-pos="G"><td>Rent</td><td n>450</td><td n v="0.8">80%</td><td n v="46095">3/14/2026</td><td n v="1200">1,200</td></tr>',
  ]);
  page.grid.repair();
  expect([page.grid.issues, page.td(0, 1).outerHTML, page.table.hasAttribute("stale"), page.heard.map((event) => event.source)]).toEqual([[], '<td n="" v="450">$450.00</td>', false, ["repair"]]);
});

test("an undo that takes away the last formula leaves the stale mark until the table is next loaded, which removes it", () => {
  const page = live(FORMATTED);
  const typed = page.grid.set("B1", "=2*3");
  const marked = page.table.hasAttribute("stale");
  page.grid.apply(typed.inverse);
  const kept = page.table.hasAttribute("stale");
  const reloaded = live(page.bytes());
  expect([marked, kept, reloaded.table.hasAttribute("stale"), reloaded.records(), reloaded.bytes()]).toEqual([true, true, false, { seen: 0, pauses: 1 }, live(FORMATTED).bytes()]);
});

test("a stale mark on a table already formatted goes when the grid reads the table again, with no derived event", () => {
  const page = live(FORMATTED);
  page.table.setAttribute("stale", "");
  page.grid.foreignWrite([page.table]);
  expect([page.heard.map((event) => event.source), page.table.hasAttribute("stale"), page.bytes()]).toEqual([["dom"], false, live(FORMATTED).bytes()]);
});

function attempt(fn) {
  try {
    fn();
    return "ran";
  } catch (error) {
    return error.code ?? error.name;
  }
}
