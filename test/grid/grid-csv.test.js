import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { canonicalGrid, domAdapter } from "../../src/grid/codec/canonical.js";
import { gridModel } from "../../src/grid/codec/read.js";
import { tableHtml } from "../../src/grid/codec/write.js";
import { createGrid } from "../../src/grid/grid.js";
import { GridRefused } from "../../src/grid/ops.js";
import { FIXTURES } from "../grid-codec/support/fixtures.js";
import { splitTables } from "./support/laws.js";

global.__SAP_KEEP_CONSOLE__ = true;

const GOLDEN = join(__dirname, "..", "grid-codec", "golden");

const NONE = { records: 0, pauses: 0 };

const EMPTY = "<table grid><colgroup></colgroup>\n<tbody>\n</tbody></table>";

function goldenTables() {
  const tables = [];
  for (const file of readdirSync(GOLDEN).filter((name) => name.endsWith(".html")).sort()) {
    splitTables(readFileSync(join(GOLDEN, file), "utf8")).forEach((src, index) => tables.push({ name: `${file.replace(/\.html$/, "")}#${index}`, html: tableHtml(gridModel(src, 0)) }));
  }
  return tables;
}

const golden = (name) => goldenTables().find((table) => table.name === name).html;

const observers = [];

afterEach(() => {
  for (const observer of observers.splice(0)) observer.disconnect();
  document.body.innerHTML = "";
});

// A live table parsed from bytes into the page, and a Grid over it whose new ids are rn1, rn2, ...
// and cn1, cn2, ... unless `options` says otherwise. `records()` returns the mutation records the
// page saw and the calls of `write` since the Grid was made or since the last call; `heard` lists
// every change event; `bytes()` is the live table's canonical bytes.
function live(html, { options } = {}) {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  const table = host.querySelector("table");
  const observer = new MutationObserver(() => {});
  observer.observe(host, { childList: true, subtree: true, attributes: true, characterData: true });
  observers.push(observer);
  let pauses = 0;
  const write = (fn) => {
    pauses += 1;
    return fn();
  };
  let minted = 0;
  const grid = createGrid(table, { write, today: () => 46095, newId: (prefix) => `${prefix}n${++minted}`, ...options });
  const heard = [];
  grid.on("change", (event) => heard.push(event));
  const records = () => {
    const out = { records: observer.takeRecords().length, pauses };
    pauses = 0;
    return out;
  };
  return { table, grid, records, heard, bytes: () => canonicalGrid(domAdapter, table) };
}

const refusal = (run) => {
  try {
    run();
  } catch (error) {
    return [error instanceof GridRefused, error.code];
  }
  return "ran";
};

const lines = (...rows) => rows.join("\r\n");

// Every value of a sheet, `rows` by `cols`, with null past the sheet's last row or column.
function values(grid, rows, cols) {
  const held = grid.size.rows === 0 || grid.size.cols === 0 ? [] : grid.get(`1:${grid.size.rows}`);
  return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => held[r]?.[c] ?? null));
}

// Numbers, a date and a boolean, text that starts like a formula or reads as a number, and
// formulas whose results are a negative number and text that starts with "-".
const KINDS = [
  '<table grid><colgroup><col data-id="ca" data-pos="G"><col data-id="cb" data-pos="V" fmt="$#,##0.00"></colgroup>',
  "<tbody>",
  '<tr data-id="r1" data-pos="G"><td n>-5</td><td n v="-5">-$5.00</td></tr>',
  '<tr data-id="r2" data-pos="V"><td>-5 units</td><td>=SUM(A1)</td></tr>',
  '<tr data-id="r3" data-pos="d"><td t>123</td><td>FALSE</td></tr>',
  '<tr data-id="r4" data-pos="l"><td>+1</td><td n v="46095" fmt="m/d/yyyy">3/14/2026</td></tr>',
  '<tr data-id="r5" data-pos="t"><td>@home</td><td>\'quoted</td></tr>',
  '<tr data-id="r6" data-pos="x"><td n f="=0-5">-5</td><td f="=IF(1,&quot;-ok&quot;,&quot;&quot;)">-ok</td></tr>',
  "</tbody></table>",
].join("\n");

test("an import is one action and one change event, and the sheet grows to hold it", () => {
  const page = live(EMPTY);
  const event = page.grid.importDelimited("Item,Cost\r\nRent,\"1,200\"\r\nFood,300", "A1");
  expect([page.heard.length, page.heard[0] === event, event.action.t, event.rows.added, event.cols.added, event.structure, page.grid.revision]).toEqual([
    1,
    true,
    "set",
    ["rn1", "rn2", "rn3"],
    ["cn4", "cn5"],
    true,
    1,
  ]);
  expect(page.bytes()).toBe(
    [
      '<table grid><colgroup><col data-id="cn4" data-pos="G"><col data-id="cn5" data-pos="V"></colgroup>',
      "<tbody>",
      '<tr data-id="rn1" data-pos="G"><td>Item</td><td>Cost</td></tr>',
      '<tr data-id="rn2" data-pos="V"><td>Rent</td><td n v="1200" fmt="#,##0">1,200</td></tr>',
      '<tr data-id="rn3" data-pos="l"><td>Food</td><td n>300</td></tr>',
      "</tbody></table>",
    ].join("\n"),
  );
  expect([page.grid.issues, page.grid.get("A1:B3")]).toEqual([
    [],
    [
      ["Item", "Cost"],
      ["Rent", 1200],
      ["Food", 300],
    ],
  ]);

  const tiny = live(golden("tiny#0"));
  tiny.grid.importDelimited("Fuel\t80\nWater\t20", "A7", { delimiter: "\t" });
  expect([tiny.heard.length, tiny.heard[0].rows.added, tiny.grid.get("A7:B8")]).toEqual([
    1,
    ["rn1", "rn2"],
    [
      ["Fuel", 80],
      ["Water", 20],
    ],
  ]);

  const recorded = [];
  const held = live(EMPTY);
  held.grid.dispatch = (action) => recorded.push(action);
  held.grid.importDelimited("a,b", "A1");
  expect([recorded.map((action) => action.t), held.bytes(), held.heard]).toEqual([["set"], EMPTY, []]);
});

test("a field =1+1 arrives as text, and as a formula only with formulas: true", () => {
  const page = live(EMPTY);
  page.grid.importDelimited("=1+1,'=2", "A1");
  expect([page.grid.cell("A1").content, page.grid.cell("B1").content]).toEqual(["=1+1", "=2"]);
  page.grid.importDelimited("=1+1", "A1", { formulas: true });
  expect([page.grid.cell("A1").content, page.table.hasAttribute("stale")]).toEqual([{ f: "=1+1" }, true]);
});

test("a column typed text keeps 02134", () => {
  const page = live(EMPTY);
  expect(refusal(() => page.grid.importDelimited('02134,02134\n2134,2134\n3/14/2026,3/14/2026\n"two\r\nlines","two\r\nlines"', "A1", { types: ["text"] }))).toBe("ran");
  expect(page.grid.get("A1:B4")).toEqual([
    ["02134", "02134"],
    ["2134", 2134],
    ["3/14/2026", 46095],
    ["two\nlines", "two\nlines"],
  ]);
  expect([page.heard.length, page.grid.input("A2")]).toEqual([1, "'2134"]);
});

test("export then import of every fixture gives the same contents", () => {
  const tables = goldenTables();
  expect(tables.length).toBe(12);
  for (const { name, html } of tables) {
    const source = live(html);
    if (source.grid.issues.length > 0) source.grid.repair();
    const { rows, cols } = source.grid.size;
    const want = values(source.grid, rows, cols);
    for (const [mode, delimiter] of [
      ["raw", ","],
      ["shown", ","],
      ["raw", "\t"],
    ]) {
      const target = live(EMPTY);
      target.grid.importDelimited(source.grid.toDelimited(undefined, { delimiter, values: mode, protect: true }), "A1", { delimiter });
      const got = values(target.grid, rows, cols);
      const differ = [];
      want.forEach((line, r) => line.forEach((value, c) => (Object.is(value, got[r][c]) ? null : differ.push([r + 1, c + 1, value, got[r][c]]))));
      // Text that reads as a number or TRUE has no character protect marks, so it comes back as a
      // number or a boolean, as from a Google Sheets export. A shown export also cannot give back
      // a number under a format that typed input does not read.
      const lost = [
        [10, 1, "123", 123],
        [11, 1, "TRUE", true],
      ];
      expect([name, mode, delimiter, differ]).toEqual([name, mode, delimiter, name !== "escapes#0" ? [] : mode === "shown" ? [...lost, [13, 2, 1200, "1,200 kg"]] : lost]);
    }
  }

  // The generated 20,000-cell budget comes back exactly from a raw export. Its shown export
  // gives back percents rounded as they are shown, which is why raw exists.
  const budget = FIXTURES["budget-20k"]().sheets;
  expect(budget.length).toBe(2);
  for (const sheet of budget) {
    const source = live(tableHtml(sheet));
    const { rows, cols } = source.grid.size;
    const target = live(EMPTY);
    target.grid.importDelimited(source.grid.toDelimited(undefined, { values: "raw", protect: true }), "A1");
    expect([sheet.id, values(target.grid, rows, cols)]).toEqual([sheet.id, values(source.grid, rows, cols)]);
  }
});

test("a negative number is exported without an apostrophe and the text -5 units with one", () => {
  const page = live(KINDS);
  expect([page.bytes(), page.grid.issues]).toEqual([KINDS, []]);
  expect(page.grid.toDelimited(undefined, { protect: true })).toBe(lines("-5,-$5.00", "'-5 units,'=SUM(A1)", "123,FALSE", "'+1,3/14/2026", "'@home,''quoted", "-5,'-ok"));
  expect(page.grid.toDelimited(undefined, { values: "raw", protect: true })).toBe(lines("-5,-5", "'-5 units,'=SUM(A1)", "123,FALSE", "'+1,46095", "'@home,''quoted", "-5,'-ok"));
  expect(page.grid.toDelimited()).toBe(lines("-5,-$5.00", "-5 units,=SUM(A1)", "123,FALSE", "+1,3/14/2026", "@home,'quoted", "-5,-ok"));

  const back = live(EMPTY);
  back.grid.importDelimited(page.grid.toDelimited(undefined, { protect: true }), "A1");
  const want = page.grid.get("A1:B6");
  want[2][0] = 123;
  expect(back.grid.get("A1:B6")).toEqual(want);
});

test("a row the page hides is exported, and a covered cell is empty", () => {
  expect(live(golden("tiny#0")).grid.toDelimited()).toBe(
    lines("Item,Cost,Share", "Rent,\"$1,200.00\",80%", "Food,$300.00,20%", ",,", "Total,\"$1,500.00\",", "Prices as of November,,"),
  );
  const merged = live(golden("merged#0"));
  merged.grid.repair();
  expect(merged.grid.toDelimited(undefined, { values: "raw" })).toBe(lines("Title,,,D1", "Tall,B2,C2,", ",B3,,D3", "Box,,,"));

  const stale = live('<table grid><colgroup><col data-id="ca" data-pos="G"><col data-id="cb" data-pos="V"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="V"><td colspan="2">Head</td><td hidden>stale</td></tr>\n</tbody></table>');
  expect([stale.grid.issues.map((issue) => issue.code), stale.grid.toDelimited(), stale.grid.toDelimited(undefined, { values: "raw" })]).toEqual([["hidden_text"], "Head,", "Head,"]);

  // Hiding waits for step X1, so a page's own hidden attribute stands in for it here.
  const hidden = live(
    '<table grid><colgroup><col data-id="ca" data-pos="G"><col data-id="cb" data-pos="V" hidden></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="G"><td>a</td><td>b</td></tr>\n<tr data-id="r2" data-pos="V" hidden><td>c</td><td>d</td></tr>\n</tbody></table>',
  );
  expect([hidden.grid.issues, hidden.grid.toDelimited()]).toEqual([[], lines("a,b", "c,d")]);
});

test("export writes CR LF, quotes a field that holds the delimiter, a quote or a line break, and TSV is the same with a tab", () => {
  const page = live(
    '<table grid><colgroup><col data-id="ca" data-pos="G"><col data-id="cb" data-pos="V"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="V"><td>a,b</td><td>say "hi"</td></tr>\n<tr data-id="r2" data-pos="l"><td>two\nlines</td><td>tab\there</td></tr>\n</tbody></table>',
  );
  expect(page.grid.toDelimited()).toBe('"a,b","say ""hi"""\r\n"two\nlines",tab\there');
  expect(page.grid.toDelimited(undefined, { delimiter: "\t" })).toBe('a,b\t"say ""hi"""\r\n"two\nlines"\t"tab\there"');
  // The first line holds one comma and one tab, and detection takes the comma, so the import is
  // told the delimiter.
  const back = live(EMPTY);
  back.grid.importDelimited(page.grid.toDelimited(undefined, { delimiter: "\t" }), "A1", { delimiter: "\t" });
  expect(back.grid.get("A1:B2")).toEqual(page.grid.get("A1:B2"));
});

test("an area exports its own cells, with its corners in either order, clipped to the sheet", () => {
  const page = live(golden("tiny#0"));
  expect(page.grid.toDelimited("B2:C3")).toBe(lines('"$1,200.00",80%', "$300.00,20%"));
  expect(page.grid.toDelimited("C3:B2")).toBe(page.grid.toDelimited("B2:C3"));
  expect(page.grid.toDelimited("A5:Z99")).toBe(lines('Total,"$1,500.00",', "Prices as of November,,"));
  expect([page.grid.toDelimited("B5"), page.grid.toDelimited("2:2", { values: "raw" }), page.grid.toDelimited("D1:E2"), live(EMPTY).grid.toDelimited()]).toEqual(['"$1,500.00"', "Rent,1200,0.8", "", ""]);
});

test("export reads a page that may not write and a sheet with issues; import refuses both, and writes nothing", () => {
  const readOnly = live(golden("tiny#0"), { options: { mayWrite: () => false } });
  expect([refusal(() => readOnly.grid.importDelimited("x", "A1")), readOnly.grid.toDelimited("A1")]).toEqual([[true, "read_only"], "Item"]);
  const damaged = live(golden("merged#0"));
  expect([refusal(() => damaged.grid.importDelimited("x", "A1")), damaged.grid.toDelimited("A1:B1")]).toEqual([[true, "needs_repair"], "Title,"]);
  for (const page of [readOnly, damaged]) expect([page.records(), page.grid.revision, page.heard]).toEqual([NONE, 0, []]);
});

test("an import of what the cells already hold writes nothing", () => {
  const page = live(golden("merged#0"));
  page.grid.repair();
  page.records();
  const before = page.bytes();
  const revision = page.grid.revision;
  expect([page.grid.importDelimited(page.grid.toDelimited(undefined, { protect: true }), "A1"), page.grid.importDelimited("", "A1")]).toEqual([null, null]);
  expect([page.records(), page.bytes(), page.grid.revision]).toEqual([NONE, before, revision]);
});

test("an import drops a byte order mark and a last line end, and refuses a block past the grow limits", () => {
  const page = live(EMPTY);
  page.grid.importDelimited("\uFEFF12,a\r\n3,b\r\n", "A1");
  expect([page.grid.size, page.grid.get("A1:B2")]).toEqual([
    { rows: 2, cols: 2 },
    [
      [12, "a"],
      [3, "b"],
    ],
  ]);
  page.records();
  expect([refusal(() => page.grid.importDelimited("x,".repeat(1002) + "x", "A1")), refusal(() => page.grid.importDelimited("x\n".repeat(10003), "A1"))]).toEqual([
    [true, "too_large"],
    [true, "too_large"],
  ]);
  expect([page.records(), page.grid.size, page.heard.length]).toEqual([NONE, { rows: 2, cols: 2 }, 1]);
});

test("delimited text and options that cannot be read refuse as GridRefused", () => {
  const page = live(EMPTY);
  let unclosed;
  try {
    page.grid.importDelimited('h1,h2\r\n"line1\r\nline2",ok\r\n"open\r\nstill', "A1");
  } catch (error) {
    unclosed = error;
  }
  expect([unclosed instanceof GridRefused, unclosed.code, unclosed.line, unclosed.message]).toEqual([true, "unterminated_quote", 4, "delimited text unterminated-quote at line 4"]);
  const bad = [
    ["a type that is not auto or text", () => page.grid.importDelimited("a", "A1", { types: ["number"] }), "bad_action"],
    ["a bad cell to import at", () => page.grid.importDelimited("a", "a1"), "bad_range"],
    ["values that are not shown or raw", () => page.grid.toDelimited(undefined, { values: "typed" }), "bad_action"],
  ];
  for (const [what, run, code] of bad) expect([what, refusal(run)]).toEqual([what, [true, code]]);
  expect([page.records(), page.bytes(), page.grid.revision]).toEqual([NONE, EMPTY, 0]);
});
