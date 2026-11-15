import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { colName } from "../../src/grid/a1.js";
import { keysBetween } from "../../src/grid/codec/order-keys.js";
import { gridModel, readRange } from "../../src/grid/codec/read.js";
import { tableHtml } from "../../src/grid/codec/write.js";
import { serial } from "../../src/grid/dates.js";
import { createGrid } from "../../src/grid/grid.js";
import { GridRefused } from "../../src/grid/ops.js";
import { splitTables } from "./support/laws.js";

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
      return { name, html: readFileSync(join(REPAIR, file), "utf8"), before };
    });

// A table of `count` data rows in one tbody, as a person writes a long table by hand.
function longTable(count) {
  const keys = keysBetween(null, null, count);
  const rows = keys.map((pos, r) => ({ id: `r${r}`, pos, cells: [{ text: `row ${r}` }] }));
  return tableHtml({ cols: [{ id: "ca", pos: "V" }], rows }, { groupSize: count + 1 });
}

// Tables a person or an agent writes, which the writer would not: one tbody of 120 rows with a
// tfoot and its columns as bare <col> elements, a row with no colgroup and no ids, a merge whose
// hidden cell holds text, and the hand-written tables of the codec's canonical test. A table marked
// stale is not here: step D8 gives its load a derived write.
const handWritten = () => [
  {
    name: "long, with a tfoot",
    html: longTable(120)
      .replace(/<colgroup>(.*?)<\/colgroup>/, "$1")
      .replace("</tbody></table>", '</tbody><tfoot><tr data-id="f" data-pos="z"><td>foot</td></tr></tfoot></table>'),
  },
  { name: "no parts", html: "<table grid><tr><td>a</td><td>b</td></tr></table>" },
  { name: "hidden text", html: golden("tiny#0"), before: (table) => (table.querySelector("td[hidden]").textContent = "note") },
  {
    name: "markup, uppercase, attribute order, entity",
    html: '<table grid><tbody><tr data-pos="G" data-id="r1"><TD V="3" n="">x <b>bold</b>\r\ny</TD><td>&copy; 2026</td><td></td></tr></tbody></table>',
  },
  {
    name: "rows outside tbody and a th",
    html: '<table grid freeze-cols="2"><colgroup><col data-id="a" data-pos="G" style="width: 90px; color:red"></colgroup><tr data-id="r1" data-pos="G"><th>H</th></tr></table>',
  },
  {
    name: "bad counts, hidden text",
    html: '<table grid freeze-cols="0"><tbody><tr data-id="r" data-pos="G"><td colspan="1">a</td><td rowspan="x">b</td><td hidden>c</td><td>d</td></tr></tbody></table>',
  },
  {
    name: "thead after tbody",
    html: '<table grid><tbody><tr data-id="b" data-pos="V"><td>2</td></tr></tbody><thead><tr data-id="a" data-pos="G"><td>1</td></tr></thead></table>',
  },
];

const observers = [];

afterEach(() => {
  for (const observer of observers.splice(0)) observer.disconnect();
  document.body.innerHTML = "";
});

// A live table parsed from bytes into the page, inside a tab when `tab` is given, and a Grid over
// it. `before(table)` edits the table before the Grid loads it. `records()` returns the mutation
// records the page saw and the calls of `write` since the Grid was made or since the last call.
function live(html, { tab, before } = {}) {
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
  const grid = createGrid(table, { write, today: () => TODAY });
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
  return { table, grid, records, td };
}

test("loading writes nothing", () => {
  const tables = goldenTables();
  expect(tables.length).toBeGreaterThanOrEqual(9);
  const inputs = repairInputs();
  expect(inputs.length).toBeGreaterThanOrEqual(10);
  const hand = handWritten();
  const all = [...tables.map((table) => ({ name: table.name, html: tableHtml(table.model) })), ...inputs, ...hand];
  for (const { name, html, before } of all) {
    const page = live(html, { before });
    expect([name, page.records()]).toEqual([name, NONE]);
    expect([name, page.grid.rescan(), page.grid.revision]).toEqual([name, false, 0]);
    expect([name, page.records()]).toEqual([name, NONE]);
  }
  console.log(`${tables.length} golden tables, ${inputs.length} repair inputs and ${hand.length} hand-written tables loaded with no write`);
});

test("get gives the values the codec's readRange gives", () => {
  const wrong = [];
  let cells = 0;
  for (const { name, model } of goldenTables()) {
    const bytes = tableHtml(model);
    const strict = gridModel(bytes, 0);
    const { grid } = live(bytes);
    const rows = strict.rows.length;
    const cols = strict.cols.length;
    const last = colName(Math.max(cols, 1) - 1);
    const same = (ref, form) => {
      const got = grid.get(ref);
      const want = readRange(strict, form ?? ref).values;
      if (JSON.stringify(got) !== JSON.stringify(ref.includes(":") ? want : want[0]?.[0] ?? null)) wrong.push({ name, ref, got, want });
    };
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        same(`${colName(c)}${r + 1}`);
        cells += 1;
      }
    }
    same(`A1:${last}${Math.max(rows, 1)}`);
    same("B2:C3");
    same("A1:Z999");
    same(`A${rows + 3}`);
    same(`${colName(cols + 2)}1`);
    same(`${colName(cols + 1)}1:${colName(cols + 3)}2`);
    same("B:B", `B1:B${Math.max(rows, 1)}`);
    same("A:ZZ", `A1:ZZ${Math.max(rows, 1)}`);
    same("2:3", `A2:${last}3`);
  }
  console.log(`${cells} cells read one by one`);
  expect(cells).toBeGreaterThan(1000);
  expect(wrong).toEqual([]);

  const { grid } = live(golden("tiny#0"));
  expect(grid.get("B2")).toBe(1200);
  expect(grid.get("C2")).toBe(0.8);
  expect(grid.get("A2:C3")).toEqual([
    ["Rent", 1200, 0.8],
    ["Food", 300, 0.2],
  ]);
  expect(grid.get("A4:C4")).toEqual([[null, null, null]]);
  expect(grid.get("B2:B2")).toEqual([[1200]]);
  expect(grid.cell("C2")).toEqual({
    content: { f: "=B2/B$5" },
    value: 0.8,
    text: "80%",
    fmt: null,
    effectiveFmt: "0%",
    style: null,
    span: null,
    covered: false,
  });

  // An area's corners may come in either order, as the builders take them.
  expect(grid.get("C3:A2")).toEqual(grid.get("A2:C3"));
  expect(grid.get("C2:A3")).toEqual(grid.get("A2:C3"));
  expect(grid.get("C:B")).toEqual(grid.get("B:C"));
  expect(grid.get("3:2")).toEqual(grid.get("2:3"));

  // A reference the A1 reader refuses is refused as a command is.
  const refusal = (read) => {
    try {
      read();
    } catch (error) {
      return [error instanceof GridRefused, error.code];
    }
    return "read";
  };
  for (const ref of ["A0", "b2", "a1:b2", "A1:B", "0:5", "A1:B2:C3", "", 5, null]) {
    expect([ref, refusal(() => grid.get(ref))]).toEqual([ref, [true, "bad_range"]]);
  }
  for (const ref of ["A1:B2", "B:B", "", "b2"]) {
    expect([ref, refusal(() => grid.cell(ref)), refusal(() => grid.input(ref))]).toEqual([ref, [true, "bad_range"], [true, "bad_range"]]);
  }
});

test("the same table gives the same Grid", () => {
  const first = live(golden("tiny#0"));
  expect(createGrid(first.table)).toBe(first.grid);
  expect(createGrid(first.table, { write: () => null, today: () => 0 })).toBe(first.grid);
  expect(first.grid.input("A2")).toBe("Rent");

  const other = document.createElement("div");
  other.innerHTML = golden("tiny#0");
  const second = createGrid(other.firstElementChild);
  expect(second).not.toBe(first.grid);
  expect(second.get("A2:C3")).toEqual(first.grid.get("A2:C3"));

  const div = document.createElement("div");
  div.setAttribute("grid", "");
  expect(() => createGrid(div)).toThrow(TypeError);
  expect(() => createGrid(document.createElement("table"))).toThrow(TypeError);
  expect(() => createGrid(null)).toThrow(TypeError);
});

test("a covered cell reads null", () => {
  const blank = (effectiveFmt) => ({ content: null, value: null, text: "", fmt: null, effectiveFmt, style: null, span: null, covered: true });
  const tiny = live(golden("tiny#0"));
  expect(tiny.grid.cell("A6")).toEqual({
    content: "Prices as of November",
    value: "Prices as of November",
    text: "Prices as of November",
    fmt: null,
    effectiveFmt: null,
    style: "text-align:center",
    span: { rows: 1, cols: 3 },
    covered: false,
  });
  expect(tiny.grid.cell("B6")).toEqual(blank("$#,##0.00"));
  expect(tiny.grid.cell("C6")).toEqual(blank("0%"));
  expect(tiny.grid.get("A6:C6")).toEqual([["Prices as of November", null, null]]);
  expect([tiny.grid.get("B6"), tiny.grid.input("B6")]).toEqual([null, ""]);

  const merged = live(golden("merged#0"));
  for (const ref of ["B1", "C1", "A3", "B4"]) {
    expect([ref, merged.grid.get(ref), merged.grid.cell(ref)]).toEqual([ref, null, blank(null)]);
  }
  expect(merged.grid.cell("A1").span).toEqual({ rows: 1, cols: 3 });
  expect(merged.grid.cell("A2").span).toEqual({ rows: 2, cols: 1 });
  expect(merged.grid.cell("A4").span).toEqual({ rows: 2, cols: 2 });
  expect([merged.grid.cell("B2").span, merged.grid.cell("B2").covered]).toEqual([null, false]);
  expect(merged.grid.get("A1:D4")).toEqual([
    ["Title", null, null, "D1"],
    ["Tall", "B2", "C2", null],
    [null, "B3", null, "D3"],
    ["Box", null, null, null],
  ]);

  // Text in the table's hidden cell is an issue to repair, not a value.
  const noted = live(golden("tiny#0"), { before: (table) => (table.querySelector("td[hidden]").textContent = "note") });
  expect(noted.td("B6").textContent).toBe("note");
  expect([noted.grid.get("B6"), noted.grid.cell("B6"), noted.grid.input("B6")]).toEqual([null, blank("$#,##0.00"), ""]);

  // A format, a style, a value or a span the table keeps on a covered cell is not read either.
  const kept = live(golden("tiny#0"), {
    before: (table) => {
      const td = table.querySelector("td[hidden]");
      for (const [name, value] of [["n", ""], ["v", "99"], ["fmt", "0.00"], ["style", "color:red"], ["colspan", "2"]]) td.setAttribute(name, value);
    },
  });
  expect([kept.grid.get("B6"), kept.grid.cell("B6"), kept.grid.input("B6")]).toEqual([null, blank("$#,##0.00"), ""]);
});

test("each repair input lists its pinned issues", () => {
  const pinned = {
    "duplicate-ids": [
      { code: "row_id_duplicate", row: 1, id: "r1" },
      { code: "row_id_duplicate", row: 2, id: "c2" },
    ],
    "hidden-text": [{ code: "hidden_text", row: 0, col: 1, text: "kept" }],
    "keys-out-of-order": [{ code: "row_pos_order", row: 4 }],
    "no-ids": [
      { code: "col_id_missing", col: 0 },
      { code: "col_id_missing", col: 1 },
      { code: "row_id_missing", row: 0 },
      { code: "row_id_missing", row: 1 },
      { code: "col_pos_invalid", col: 0 },
      { code: "col_pos_invalid", col: 1 },
      { code: "row_pos_invalid", row: 0 },
      { code: "row_pos_invalid", row: 1 },
    ],
    orphan: [{ code: "hidden_orphan", row: 1, col: 1 }],
    overlap: [{ code: "merge_overlap", row: 1, col: 0 }],
    "past-edge": [
      { code: "merge_past_end", row: 0, col: 0 },
      { code: "merge_past_end", row: 2, col: 0 },
    ],
    "plain-colspan": [
      { code: "merge_uncovered", row: 0, col: 1 },
      { code: "merge_uncovered", row: 2, col: 0 },
    ],
    "short-cols": [{ code: "row_too_long", row: 1 }],
    "valid-ties": [],
  };
  const inputs = repairInputs();
  expect(inputs.map((input) => input.name)).toEqual(Object.keys(pinned).sort());
  for (const { name, html, before } of inputs) {
    const { grid } = live(html, { before });
    expect([name, grid.issues]).toEqual([name, pinned[name]]);
    expect(Object.isFrozen(grid.issues)).toBe(true);
  }
  for (const table of goldenTables()) {
    const { grid } = live(tableHtml(table.model));
    const want = table.name === "merged#0" ? [{ code: "merge_past_end", row: 3, col: 0 }] : [];
    expect([table.name, grid.issues]).toEqual([table.name, want]);
  }
});

test("a hidden cell that holds text is listed as hidden_text", () => {
  const tiny = live(golden("tiny#0"), {
    before: (table) => {
      const [first, second] = table.querySelectorAll("td[hidden]");
      second.textContent = "note";
      first.textContent = "two\r\nlines\0";
    },
  });
  expect(tiny.grid.issues).toEqual([
    { code: "hidden_text", row: 5, col: 1, text: "two\nlines" },
    { code: "hidden_text", row: 5, col: 2, text: "note" },
  ]);

  // Rows are counted in the tree reader's order, frozen rows first, wherever the thead sits; a th
  // is a cell; a hidden cell no merge covers is also an orphan; white space alone is not text; a
  // hidden cell of a table inside a cell is that table's, not this one's.
  const hand = live(
    '<table grid><colgroup><col data-id="ca" data-pos="G"><col data-id="cb" data-pos="V"></colgroup>' +
      '<tbody><tr data-id="b" data-pos="V"><td>x</td><td hidden>late</td></tr>' +
      '<tr data-id="c" data-pos="l"><td hidden> \n\t</td><td>in<table><tr><td hidden>inner</td></tr></table></td></tr></tbody>' +
      '<thead><tr data-id="a" data-pos="G"><th hidden>head</th><td hidden></td></tr></thead></table>',
  );
  expect(hand.grid.issues).toEqual([
    { code: "hidden_orphan", row: 0, col: 0 },
    { code: "hidden_orphan", row: 0, col: 1 },
    { code: "hidden_orphan", row: 1, col: 1 },
    { code: "hidden_orphan", row: 2, col: 0 },
    { code: "hidden_text", row: 0, col: 0, text: "head" },
    { code: "hidden_text", row: 1, col: 1, text: "late" },
  ]);
  expect(hand.grid.get("A1:B3")).toEqual([
    [null, null],
    ["x", null],
    [null, "ininner"],
  ]);

  // Text put in a hidden cell after loading is listed by the next rescan, which finds the model
  // unchanged, so it tells no listener and the revision stays.
  const later = live(golden("merged#0"));
  const heard = [];
  later.grid.on("change", (event) => heard.push(event));
  later.td("B1").textContent = "typed";
  expect(later.grid.issues).toEqual([{ code: "merge_past_end", row: 3, col: 0 }]);
  expect(later.grid.rescan()).toBe(false);
  expect(later.grid.issues).toEqual([
    { code: "merge_past_end", row: 3, col: 0 },
    { code: "hidden_text", row: 0, col: 1, text: "typed" },
  ]);
  later.td("B1").textContent = "";
  expect(later.grid.rescan()).toBe(false);
  expect(later.grid.issues).toEqual([{ code: "merge_past_end", row: 3, col: 0 }]);
  expect([heard, later.grid.revision]).toEqual([[], 0]);
});

test("rescan after a raw DOM edit sees the new value", () => {
  const page = live(golden("tiny#0"), { tab: { id: "s1", name: "Budget" } });
  const heard = [];
  page.grid.on("change", (event) => heard.push(event));

  page.td("A2").textContent = "Lodging";
  expect(page.grid.get("A2")).toBe("Rent");
  page.records();
  expect(page.grid.rescan()).toBe(true);
  expect(page.records()).toEqual(NONE);
  expect([page.grid.get("A2"), page.grid.cell("A2").content, page.grid.input("A2")]).toEqual(["Lodging", "Lodging", "Lodging"]);
  expect(heard).toEqual([
    { sheet: "s1", source: "dom", rescanned: true, structure: true, cells: [], rows: EMPTY_LISTS, cols: EMPTY_LISTS, revision: 1 },
  ]);
  expect(page.grid.revision).toBe(1);

  // A rescan that finds the table as the mirror has it tells nobody.
  page.td("A3").replaceWith(page.td("A3").cloneNode(true));
  page.table.tBodies[0].append("\n\n");
  expect(page.grid.rescan()).toBe(false);
  expect([heard.length, page.grid.revision]).toEqual([1, 1]);

  // A row a raw edit added, with an id the table has, is read and checked.
  const copy = page.table.querySelector('tr[data-id="r2"]').cloneNode(true);
  copy.querySelector("td").textContent = "Copy";
  page.table.tBodies[0].append(copy);
  expect(page.grid.rescan()).toBe(true);
  expect(page.grid.size).toEqual({ rows: 7, cols: 3 });
  expect(page.grid.get("A7:C7")).toEqual([["Copy", 1200, 0.8]]);
  expect(page.grid.issues).toEqual([
    { code: "row_id_duplicate", row: 6, id: "r2" },
    { code: "row_pos_order", row: 6 },
  ]);
  expect([heard.length, heard[1].revision, page.grid.revision]).toEqual([2, 2, 2]);

  copy.remove();
  expect(page.grid.rescan()).toBe(true);
  expect([page.grid.size, page.grid.issues, page.grid.revision]).toEqual([{ rows: 6, cols: 3 }, [], 3]);
});

test("input gives the editor text of each kind of cell", () => {
  const cases = [
    ["tiny#0", { A1: "Item", A2: "Rent", B2: "1200", C2: "=B2/B$5", B5: "=SUM(B2:B3)", A4: "", B6: "", Z99: "" }],
    ["tiny#1", { B1: "3/14/2026", B2: "=5000-Budget!B5" }],
    ["styled#0", { B2: "12.5%", A2: "Red" }],
    ["escapes#0", { A8: "'=literal", A9: "02134", A10: "'123", A11: "'TRUE", A3: "  padded  ", B13: "1200" }],
    ["formulas-formatted#0", { A1: "7", B1: "=A1*1.5", D1: "=DATE(2026,1,1)", E1: "=A1>35" }],
  ];
  for (const [name, refs] of cases) {
    const { grid } = live(golden(name));
    for (const [ref, text] of Object.entries(refs)) expect([name, ref, grid.input(ref)]).toEqual([name, ref, text]);
  }

  // Text that typed again would be a date keeps an apostrophe. Whether it would be one depends on
  // today: 2/29 is a date only in a leap year, and TODAY is in 2026.
  const dates =
    '<table grid><colgroup><col data-id="ca" data-pos="G"><col data-id="cb" data-pos="V"></colgroup>' +
    '<tbody><tr data-id="r" data-pos="V"><td>3/14</td><td>2/29</td></tr></tbody></table>';
  const typed = live(dates);
  expect([typed.grid.input("A1"), typed.grid.input("B1")]).toEqual(["'3/14", "2/29"]);
  const leap = document.createElement("div");
  leap.innerHTML = dates;
  expect(createGrid(leap.firstElementChild, { today: () => serial(2024, 6, 1) }).input("B1")).toBe("'2/29");
  const plain = document.createElement("div");
  plain.innerHTML = dates;
  expect(createGrid(plain.firstElementChild).input("A1")).toBe("'3/14");
});

test("sheet and size describe the tab and the table", () => {
  const tab = live(golden("tiny#0"), { tab: { id: "s1", name: "Budget" } });
  expect([tab.grid.sheet, tab.grid.size]).toEqual([{ id: "s1", name: "Budget" }, { rows: 6, cols: 3 }]);
  tab.table.previousElementSibling.textContent = "Costs";
  expect(tab.grid.sheet).toEqual({ id: "s1", name: "Costs" });

  const bare = live(golden("styled#0"));
  expect([bare.grid.sheet, bare.grid.size]).toEqual([{ id: "", name: "" }, { rows: 3, cols: 3 }]);

  // A section with no item attribute is no tab, and a name bound inside the table is a cell.
  const plain = live(`<section data-id="s9"><h2 bind="name">Plain</h2>${golden("tiny#0")}</section>`);
  expect(plain.grid.sheet).toEqual({ id: "", name: "" });
  const inside = live(`<section item data-id="s3">${golden("tiny#0").replace("<td>Cost</td>", '<td bind="name">Cost</td>')}</section>`);
  expect(inside.table.querySelector('td[bind="name"]').textContent).toBe("Cost");
  expect([inside.grid.sheet, inside.grid.get("B1")]).toEqual([{ id: "s3", name: "" }, "Cost"]);

  // A table the host's reader would not find as the tab's own is in no tab.
  const deep = live(`<section item data-id="s2"><h2 bind="name">Deep</h2><div>${golden("empty#0")}</div></section>`);
  expect([deep.grid.sheet, deep.grid.size]).toEqual([{ id: "", name: "" }, { rows: 0, cols: 0 }]);
  expect([deep.grid.get("A1"), deep.grid.get("A1:B2"), deep.grid.issues]).toEqual([null, [], []]);
});

test("on adds a listener and returns what removes it", () => {
  const page = live(golden("tiny#0"));
  const first = [];
  const second = [];
  const stop = page.grid.on("change", (event) => first.push(event.revision));
  page.grid.on("change", (event) => second.push(event.revision));
  page.td("A2").textContent = "one";
  page.grid.rescan();
  stop();
  page.td("A2").textContent = "two";
  page.grid.rescan();
  expect([first, second]).toEqual([[1], [1, 2]]);
  stop();
  page.td("A2").textContent = "three";
  page.grid.rescan();
  expect([first, second]).toEqual([[1], [1, 2, 3]]);
  expect(() => page.grid.on("changed", () => {})).toThrow(TypeError);
  expect(() => page.grid.on("change")).toThrow(TypeError);
});
