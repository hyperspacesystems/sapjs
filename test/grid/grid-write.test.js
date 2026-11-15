import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { colName } from "../../src/grid/a1.js";
import { canonicalGrid, domAdapter } from "../../src/grid/codec/canonical.js";
import { patchGrid } from "../../src/grid/codec/patch.js";
import { gridModel } from "../../src/grid/codec/read.js";
import { shown, typed } from "../../src/grid/codec/value.js";
import { tableHtml } from "../../src/grid/codec/write.js";
import { contentOf } from "../../src/grid/content.js";
import { createGrid } from "../../src/grid/grid.js";
import { parseInput } from "../../src/grid/input.js";
import { GridRefused } from "../../src/grid/ops.js";
import { CASES } from "./support/input-cases.js";
import { splitTables } from "./support/laws.js";
import { sameTree } from "./support/same-tree.js";

global.__SAP_KEEP_CONSOLE__ = true;

const GOLDEN = join(__dirname, "..", "grid-codec", "golden");
const REPAIR = join(__dirname, "golden", "repair");
const TODAY = 46095;

const NONE = { records: 0, pauses: 0 };

const EMPTY_LISTS = { added: [], removed: [], changed: [] };

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

const golden = (name) => tableHtml(goldenTables().find((table) => table.name === name).model);

// The repair inputs, with the one live-table fact a file cannot hold: the hidden cell of
// hidden-text holds the text the repair test passes as `hiddenText`.
const repairInputs = () =>
  readdirSync(REPAIR)
    .filter((name) => name.endsWith(".in.html"))
    .sort()
    .map((file) => {
      const name = file.slice(0, -".in.html".length);
      const before = name === "hidden-text" ? (table) => (table.querySelector("td[hidden]").textContent = "kept") : undefined;
      return { name, html: readFileSync(join(REPAIR, file), "utf8"), out: readFileSync(join(REPAIR, `${name}.out.html`), "utf8").trim(), before };
    });

// The typed text of every case of the date and time input test, read from its file.
const dateCases = () => Array.from(readFileSync(join(__dirname, "input-date.test.js"), "utf8").matchAll(/\["((?:[^"\\]|\\.)*)",/g), (match) => JSON.parse(`"${match[1]}"`));

const observers = [];

afterEach(() => {
  for (const observer of observers.splice(0)) observer.disconnect();
  document.body.innerHTML = "";
});

// A live table parsed from bytes into the page, inside a tab when `tab` is given, and a Grid over
// it with `options`. `before(table)` edits the table before the Grid loads it. `records()` returns
// the mutation records the page saw and the calls of `write` since the Grid was made or since the
// last call; `heard` lists every change event; `bytes()` is the live table's canonical bytes.
function live(html, { tab, before, options } = {}) {
  document.body.innerHTML = tab ? `<section item data-id="${tab.id}"><h2 bind="name">${tab.name}</h2>${html}</section>` : html;
  const table = document.body.querySelector("table");
  if (before) before(table);
  const observer = new MutationObserver(() => {});
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  observers.push(observer);
  let pauses = 0;
  const write = (fn) => {
    pauses += 1;
    return fn();
  };
  const grid = createGrid(table, { write, today: () => TODAY, ...options });
  const heard = [];
  grid.on("change", (event) => heard.push(event));
  const records = () => {
    const out = { records: observer.takeRecords().length, pauses };
    pauses = 0;
    return out;
  };
  const td = (ref) => {
    const at = /^([A-Z]+)([0-9]+)$/.exec(ref);
    const c = at[1].charCodeAt(0) - 65;
    return table.querySelectorAll("tr")[Number(at[2]) - 1].querySelectorAll(":scope > td")[c];
  };
  return { table, grid, records, td, heard, bytes: () => canonicalGrid(domAdapter, table) };
}

const refusal = (run) => {
  try {
    run();
  } catch (error) {
    return [error instanceof GridRefused, error.code];
  }
  return "ran";
};

// One table of one row and one column whose column has this format.
const oneCell = (fmt) =>
  `<table grid><colgroup><col data-id="ca" data-pos="V"${fmt ? ` fmt="${fmt}"` : ""}></colgroup><tbody><tr data-id="r1" data-pos="V"></tr></tbody></table>`;

const cellOf = (bytes, r, c) => gridModel(bytes, 0).rows[r].cells[c] ?? null;

// A host's bytes without the stale mark its patch gives the table.
const unstale = (bytes) => bytes.replace(/^(<table[^>]*?) stale>/, "$1>");

test("tiny loads, and set B2 to 1,200 gives the pinned bytes", () => {
  const page = live(golden("tiny#0"), { tab: { id: "s1", name: "Budget" } });
  expect([page.grid.issues, page.records(), page.bytes()]).toEqual([[], NONE, golden("tiny#0")]);
  page.grid.set("B2", "1,200");
  const want = golden("tiny#0").replace('<td n v="1200">$1,200.00</td>', '<td n v="1200" fmt="#,##0">1,200</td>');
  expect(want).not.toBe(golden("tiny#0"));
  expect(page.bytes()).toBe(want);
  expect(tableHtml(gridModel(want, 0))).toBe(want);
  expect(sameTree(page.table)).toEqual([]);
  expect([page.grid.get("B2"), page.grid.input("B2"), page.grid.revision]).toEqual([1200, "1200", 1]);

  page.grid.set("B3", "1,500");
  expect(page.bytes()).toBe(want.replace('<td n v="300">$300.00</td>', '<td n v="1500" fmt="#,##0">1,500</td>'));
  expect(tableHtml(gridModel(page.bytes(), 0))).toBe(page.bytes());
  expect(sameTree(page.table)).toEqual([]);
});

// A host has no formatter: where the column has a format, the host writes the plain text and marks
// the table stale, and the grid writes the formatted text with `v`. The content is the same.
test("set B2 to 450 writes the same cell as a host patch of 450", () => {
  const host = patchGrid(golden("tiny#0"), [{ range: "B2", values: [[450]] }]).bytes;
  const page = live(golden("tiny#0"));
  page.grid.set("B2", 450);
  const mine = cellOf(page.bytes(), 1, 1);
  const theirs = cellOf(host, 1, 1);
  expect(theirs).toEqual({ text: "450", n: true });
  expect(mine).toEqual({ text: "$450.00", n: true, v: "450" });
  expect([contentOf(mine), mine.fmt, mine.style]).toEqual([contentOf(theirs), theirs.fmt, theirs.style]);
  expect(page.bytes().replace("$450.00</td>", "450</td>").replace(' v="450"', "")).toBe(unstale(host));

  const typedText = live(golden("tiny#0"));
  typedText.grid.set("B2", "450");
  expect(cellOf(typedText.bytes(), 1, 1)).toEqual(mine);

  // In a column with no format the two write the same bytes.
  const plain = live(golden("tiny#0"));
  plain.grid.set("A4", 450);
  expect(plain.bytes()).toBe(unstale(patchGrid(golden("tiny#0"), [{ range: "A4", values: [[450]] }]).bytes));
});

test("every typed input case of F5 and F6 comes back through input", () => {
  const cases = [...Object.values(CASES).flat(), ...dateCases().map((text) => [text, {}])];
  expect(cases.length).toBeGreaterThan(160);
  const wrong = [];
  for (const [text, { fmt }] of cases) {
    const page = live(oneCell(fmt));
    page.grid.set("A1", text);
    const { content, effectiveFmt } = page.grid.cell("A1");
    const shownText = page.grid.input("A1");
    const again = parseInput(shownText, { fmt: effectiveFmt, today: TODAY }).content;
    const want = parseInput(text, { fmt: fmt ?? null, today: TODAY }).content;
    const saved = typeof want === "number" ? typed(shown(want)) : want;
    if (JSON.stringify([content, again]) !== JSON.stringify([saved, saved])) wrong.push({ text, fmt, content, shownText, again });
  }
  console.log(`${cases.length} typed input cases written and read back`);
  expect(wrong).toEqual([]);
});

test("a cell's own editor text written back changes nothing, in every cell of every fixture", () => {
  let cells = 0;
  let refused = 0;
  for (const { name, model } of goldenTables()) {
    const page = live(tableHtml(model));
    const before = page.bytes();
    const { rows, cols } = page.grid.size;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ref = `${colName(c)}${r + 1}`;
        const text = page.grid.input(ref);
        if (page.grid.issues.length > 0) {
          expect([name, ref, refusal(() => page.grid.set(ref, text))]).toEqual([name, ref, [true, "needs_repair"]]);
          refused += 1;
        } else {
          expect([name, ref, page.grid.set(ref, text)]).toEqual([name, ref, null]);
        }
        cells += 1;
      }
    }
    expect([name, page.records(), page.bytes() === before, page.grid.revision, page.heard]).toEqual([name, NONE, true, 0, []]);
  }
  console.log(`${cells} cells written back with their editor text, ${refused} refused for repair`);
  expect(cells - refused).toBeGreaterThan(40000);
});

test("one event and one revision step per write, and get reads the new value at once", () => {
  const page = live(golden("tiny#0"), { tab: { id: "s1", name: "Budget" } });
  const event = page.grid.set("B3", "450");
  expect(page.grid.get("B3")).toBe(450);
  expect(page.heard).toEqual([event]);
  expect(event).toEqual({
    sheet: "s1",
    source: "api",
    action: { v: 1, t: "set", sheet: "s1", cells: [["r3", "cb", 450]] },
    inverse: { v: 1, t: "set", sheet: "s1", cells: [["r3", "cb", 300, { fmt: null }]] },
    cells: [{ row: "r3", col: "cb", before: 300, after: 450 }],
    rows: EMPTY_LISTS,
    cols: EMPTY_LISTS,
    structure: false,
    revision: 1,
  });

  page.grid.setRange("A2", [["Lodging", "1,250"]]);
  expect([page.grid.get("A2:B2"), page.heard.length, page.grid.revision]).toEqual([[["Lodging", 1250]], 2, 2]);
  page.grid.clear("A3:C3");
  expect([page.grid.get("A3:C3"), page.heard.length, page.grid.revision]).toEqual([[[null, null, null]], 3, 3]);
  page.grid.format("A2", { style: { "font-style": "italic" } });
  expect([page.grid.cell("A2").style, page.heard.length, page.grid.revision]).toEqual(["font-style:italic", 4, 4]);
  expect(page.heard.map((heard) => [heard.source, heard.revision])).toEqual([
    ["api", 1],
    ["api", 2],
    ["api", 3],
    ["api", 4],
  ]);
  expect(tableHtml(gridModel(page.bytes(), 0))).toBe(page.bytes());
});

test("a dispatch that records and does not apply leaves the bytes unchanged for every command", () => {
  const commands = {
    set: (grid) => grid.set("B3", "450"),
    setRange: (grid) => grid.setRange("A2", [["Lodging", "1,250"]]),
    clear: (grid) => grid.clear("A2:C3"),
    format: (grid) => grid.format("B2:B3", { fmt: "0.00" }),
  };
  for (const [name, run] of Object.entries(commands)) {
    const page = live(golden("tiny#0"));
    const recorded = [];
    page.grid.dispatch = (action) => {
      recorded.push(action);
      return "recorded";
    };
    expect([name, run(page.grid)]).toEqual([name, "recorded"]);
    expect([name, page.records(), page.bytes(), recorded.length, page.grid.revision, page.heard]).toEqual([name, NONE, golden("tiny#0"), 1, 0, []]);
    const event = page.grid.apply(recorded[0]);
    expect([name, event.revision, page.bytes() === golden("tiny#0")]).toEqual([name, 1, false]);
  }
});

test("a page that may not write refuses every command and the repair", () => {
  const page = live(golden("tiny#0"), { options: { mayWrite: (target) => target?.localName !== "table" } });
  const recorded = [];
  page.grid.dispatch = (action) => recorded.push(action);
  const commands = [
    () => page.grid.set("B3", "450"),
    () => page.grid.setRange("A2", [["x"]]),
    () => page.grid.clear("A2"),
    () => page.grid.format("A2", { fmt: "0.00" }),
    () => page.grid.repair(),
  ];
  for (const run of commands) expect(refusal(run)).toEqual([true, "read_only"]);
  expect([recorded, page.records(), page.bytes(), page.grid.revision]).toEqual([[], NONE, golden("tiny#0"), 0]);

  // A room's action still reaches a page that may only read.
  page.grid.apply({ v: 1, t: "set", sheet: "", cells: [["r3", "cb", 450]] });
  expect([page.grid.get("B3"), page.grid.revision]).toEqual([450, 1]);
});

test("a damaged table refuses set until repair, and repair gives the bytes of normalizeSheet", () => {
  const inputs = repairInputs();
  expect(inputs.length).toBeGreaterThanOrEqual(10);
  for (const { name, html, out, before } of inputs) {
    const page = live(html, { before });
    const recorded = [];
    page.grid.dispatch = (action) => recorded.push(action);
    const damaged = page.grid.issues.length > 0;
    if (damaged) expect([name, refusal(() => page.grid.set("A1", "x")), recorded]).toEqual([name, [true, "needs_repair"], []]);
    page.records();
    const event = page.grid.repair();
    expect([name, page.bytes(), sameTree(page.table), page.grid.issues]).toEqual([name, out, [], []]);
    if (event !== null) expect([name, event.source, "inverse" in event, event.revision, page.grid.revision]).toEqual([name, "repair", false, 1, 1]);
    expect([name, damaged, event === null]).toEqual([name, damaged, !damaged && page.records().records === 0]);
    page.grid.dispatch = page.grid.apply;
    expect([name, page.grid.set("A1", "written")?.source, page.grid.get("A1")]).toEqual([name, "api", "written"]);
  }

  // The text a hidden cell held is in the table after the repair.
  const hidden = live(inputs.find((input) => input.name === "hidden-text").html, { before: inputs.find((input) => input.name === "hidden-text").before });
  hidden.grid.repair();
  expect([hidden.grid.get("B1"), hidden.table.querySelector("td[hidden]")]).toEqual(["kept", null]);
});

test("repair gives a hand-written table the writer's parts, and leaves a canonical table alone", () => {
  const rows = Array.from({ length: 120 }, (_, r) => `<tr data-id="r${r}" data-pos="${String.fromCharCode(66 + Math.floor(r / 26))}${String.fromCharCode(97 + (r % 26))}"><td>row ${r}</td></tr>`).join("");
  const hand = live(`<table grid><col data-id="ca" data-pos="V"><tbody>${rows}</tbody><tfoot><tr data-id="f" data-pos="z"><td>foot</td></tr></tfoot></table>`);
  expect(hand.grid.issues).toEqual([]);
  const bytes = hand.bytes();
  expect(sameTree(hand.table)).not.toEqual([]);
  const event = hand.grid.repair();
  expect([event?.source, event !== null && "inverse" in event, event?.revision, hand.records().pauses > 0]).toEqual(["repair", false, 1, true]);
  expect([hand.bytes(), sameTree(hand.table), hand.table.tBodies.length]).toEqual([bytes, [], 3]);
  expect(hand.grid.repair()).toBe(null);

  const plain = live(golden("tiny#0"));
  expect([plain.grid.repair(), plain.records(), plain.grid.revision, plain.heard]).toEqual([null, NONE, 0, []]);
});

test("a typed look becomes the cell's format only when the cell shows another kind", () => {
  const page = live(
    '<table grid><colgroup><col data-id="ca" data-pos="G"><col data-id="cb" data-pos="V" fmt="0.00"><col data-id="cc" data-pos="l" fmt="#,##0"></colgroup>' +
      '<tbody><tr data-id="r1" data-pos="V"></tr><tr data-id="r2" data-pos="l"><td></td><td></td><td fmt="0%" n v="0.5">50%</td></tr></tbody></table>',
  );
  page.grid.set("A1", "1,200");
  page.grid.set("B1", "1,200");
  page.grid.set("C1", "1,200");
  page.grid.set("C2", "1,200");
  page.grid.set("A2", "$5");
  expect([page.grid.cell("A1"), page.grid.cell("B1"), page.grid.cell("C1"), page.grid.cell("C2"), page.grid.cell("A2")].map((cell) => [cell.text, cell.fmt])).toEqual([
    ["1,200", "#,##0"],
    ["1200.00", null],
    ["1,200", null],
    ["1,200", null],
    ["$5.00", "$#,##0.00"],
  ]);
});

test("a write that changes nothing writes nothing", () => {
  const page = live(golden("tiny#0"));
  const schedules = [];
  page.grid.dispose();
  const grid = createGrid(page.table, { today: () => TODAY, schedule: (table) => schedules.push(table) });
  grid.on("change", (event) => page.heard.push(event));
  page.grid = grid;
  const formula = page.td("C2").outerHTML;
  expect(page.grid.set("C2", "=B2/B$5")).toBe(null);
  expect(page.grid.set("A2", "Rent")).toBe(null);
  expect(page.grid.set("B2", 1200)).toBe(null);
  expect(page.grid.clear("A4:C4")).toBe(null);
  expect(page.grid.format("A1", { style: { "font-weight": "bold" } })).toBe(null);
  expect(page.grid.format("B2", { fmt: "$#,##0.00" })).toBe(null);
  expect(page.grid.apply({ v: 1, t: "format", sheet: "", cells: [["r1", "ca", { style: { "font-weight": "bold" } }]] })).toBe(null);
  expect([page.records(), page.grid.revision, page.heard, page.bytes(), schedules]).toEqual([NONE, 0, [], golden("tiny#0"), []]);

  // A number or a formula in a cell whose format is plain text keeps its content when its editor
  // text is written back, though that text typed fresh would be text.
  const text = live(
    '<table grid><colgroup><col data-id="ca" data-pos="V" fmt="@"></colgroup><tbody>' +
      '<tr data-id="r1" data-pos="G"><td n>42</td></tr><tr data-id="r2" data-pos="V"><td n f="=1+1" v="2">2</td></tr></tbody></table>',
  );
  const textBytes = text.bytes();
  expect([text.grid.input("A1"), text.grid.input("A2")]).toEqual(["42", "=1+1"]);
  expect([text.grid.set("A1", "42"), text.grid.set("A2", "=1+1"), text.bytes(), text.records()]).toEqual([null, null, textBytes, NONE]);
  text.grid.set("A1", "43");
  expect(text.grid.cell("A1").content).toBe("43");

  // The same formula with a style is a format: the formula keeps its result.
  page.grid.setRange("C2", [[{ content: { f: "=B2/B$5" }, style: { color: "#ff0000" } }]]);
  expect(page.td("C2").outerHTML).toBe(formula.replace('v="0.8"', 'v="0.8" style="color:#ff0000"'));
  expect([page.heard.length, page.heard[0].action.t, schedules.length]).toEqual([1, "format", 1]);
});

test("a reference past the sheet is refused unless the write may grow it", () => {
  const ids = ["n1", "n2", "n3"];
  const page = live(golden("tiny#0"), { options: { newId: () => ids.shift() } });
  expect(refusal(() => page.grid.set("D1", "x"))).toEqual([true, "outside_sheet"]);
  expect(refusal(() => page.grid.setRange("A6", [["x"], ["y"]]))).toEqual([true, "outside_sheet"]);
  expect(page.grid.set("Z99", null)).toBe(null);
  expect(refusal(() => page.grid.set("A10007", 1, { grow: true }))).toEqual([true, "too_large"]);
  expect([page.records(), page.grid.revision]).toEqual([NONE, 0]);

  const event = page.grid.set("D7", "x", { grow: true });
  expect([page.grid.size, page.grid.get("D7"), event.rows.added, event.cols.added, event.structure]).toEqual([{ rows: 7, cols: 4 }, "x", ["n1"], ["n2"], true]);
  expect(tableHtml(gridModel(page.bytes(), 0))).toBe(page.bytes());
  expect(sameTree(page.table)).toEqual([]);
});

test("a write from outside the grid is taken with its derived parts put right", () => {
  const page = live(golden("tiny#0"), { tab: { id: "s1", name: "Budget" } });
  page.td("B2").textContent = "5";
  page.records();
  const event = page.grid.foreignWrite([page.td("B2").firstChild]);
  expect(event).toEqual({ sheet: "s1", source: "dom", structure: false, cells: [{ row: "r2", col: "cb", before: 1200, after: 5 }], rows: EMPTY_LISTS, cols: EMPTY_LISTS, revision: 1 });
  expect([page.td("B2").outerHTML, page.records().pauses, page.grid.get("B2")]).toEqual(['<td n="" v="5">$5.00</td>', 1, 5]);
  expect(page.grid.foreignWrite([page.td("B2")])).toBe(null);

  // Text that does not read as a number takes the cell's number marks with its old value.
  page.td("B3").textContent = "1,200";
  page.grid.foreignWrite([page.td("B3")]);
  expect([page.td("B3").outerHTML, page.grid.get("B3")]).toEqual(["<td>1,200</td>", "1,200"]);

  // A write that does not say where it happened is read before the reducer runs, so the inverse
  // puts back what the page held.
  page.td("A2").textContent = "Lodging";
  page.td("B2").textContent = "6";
  const set = page.grid.set("B2", "7");
  expect([page.heard.map((heard) => heard.source), page.grid.get("A2:B2"), set.cells]).toEqual([["dom", "dom", "dom", "api"], [["Lodging", 7]], [{ row: "r2", col: "cb", before: 6, after: 7 }]]);
  page.grid.apply(set.inverse);
  expect([page.grid.get("A2:B2"), page.td("B2").outerHTML]).toEqual([[["Lodging", 6]], '<td n="" v="6">$6.00</td>']);

  // A node in no row reads the whole table.
  page.table.tBodies[0].append(page.table.querySelector('tr[data-id="r3"]').cloneNode(true));
  const whole = page.grid.foreignWrite([page.table]);
  expect([whole.rescanned, whole.structure, page.grid.issues.map((issue) => issue.code)]).toEqual([true, true, ["row_id_duplicate", "row_pos_order"]]);
});

test("setRange parses typed text unless told not to", () => {
  const three =
    '<table grid><colgroup><col data-id="ca" data-pos="G"><col data-id="cb" data-pos="V"><col data-id="cc" data-pos="l"></colgroup><tbody><tr data-id="r1" data-pos="V"></tr></tbody></table>';
  const block = [["007", "=1+1", "1,200"]];
  const read = (options) => {
    const page = live(three);
    page.grid.setRange("A1", block, options);
    return ["A1", "B1", "C1"].map((ref) => [page.grid.cell(ref).content, page.grid.cell(ref).fmt]);
  };
  expect(read()).toEqual([
    ["007", null],
    [{ f: "=1+1" }, null],
    [1200, "#,##0"],
  ]);
  expect(read({ detect: false })).toEqual([
    ["007", null],
    ["=1+1", null],
    ["1,200", null],
  ]);
  expect(read({ formulas: false })).toEqual([
    ["007", null],
    ["=1+1", null],
    [1200, "#,##0"],
  ]);
  expect(read({ formats: false })).toEqual([
    ["007", null],
    [{ f: "=1+1" }, null],
    [1200, null],
  ]);
});

test("dispose forgets the table", () => {
  const page = live(golden("tiny#0"));
  page.grid.dispose();
  const again = createGrid(page.table);
  expect(again).not.toBe(page.grid);
  again.set("B3", "450");
  expect([page.heard, again.get("B3"), createGrid(page.table)]).toEqual([[], 450, again]);
});

test("commands refuse a bad reference as GridRefused", () => {
  const page = live(golden("tiny#0"));
  const commands = [
    () => page.grid.set("b2", "x"),
    () => page.grid.setRange("A0", [["x"]]),
    () => page.grid.clear("A1:B"),
    () => page.grid.format(5, { fmt: "0.00" }),
  ];
  for (const run of commands) expect(refusal(run)).toEqual([true, "bad_range"]);
});
