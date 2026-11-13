import { FIXTURES } from "./support/fixtures.js";
import { tableHtml } from "../../src/grid/codec/write.js";
import { scanGrid } from "../../src/grid/codec/scan.js";
import { canonicalGrid, domAdapter } from "../../src/grid/codec/canonical.js";

const parse = (html) => new DOMParser().parseFromString("<!DOCTYPE html><body>" + html, "text/html");

const NAMES = ["tiny", "budget-20k", "merged", "styled", "formulas-formatted", "empty", "two-tabs", "escapes"];

const HAND = [
  [
    "markup, uppercase, attribute order, entity",
    '<table grid><tbody><tr data-pos="G" data-id="r1"><TD V="3" n="">x <b>bold</b>\r\ny</TD><td>&copy; 2026</td><td></td></tr></tbody></table>',
    '<table grid><colgroup></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="G"><td n v="3">x bold\ny</td><td>© 2026</td></tr>\n</tbody></table>',
  ],
  [
    "rows outside tbody and a th",
    '<table grid freeze-cols="2"><colgroup><col data-id="a" data-pos="G" style="width: 90px; color:red"></colgroup><tr data-id="r1" data-pos="G"><th>H</th></tr></table>',
    '<table grid freeze-cols="2"><colgroup><col data-id="a" data-pos="G" style="width:90px"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="G"><td>H</td></tr>\n</tbody></table>',
  ],
  [
    "bad counts dropped, hidden text dropped",
    '<table grid freeze-cols="0"><tbody><tr data-id="r" data-pos="G"><td colspan="1">a</td><td rowspan="x">b</td><td hidden>c</td><td>d</td></tr></tbody></table>',
    '<table grid><colgroup></colgroup>\n<tbody>\n<tr data-id="r" data-pos="G"><td>a</td><td>b</td><td hidden></td><td>d</td></tr>\n</tbody></table>',
  ],
  [
    "thead after tbody becomes the first group",
    '<table grid><tbody><tr data-id="b" data-pos="V"><td>2</td></tr></tbody><thead><tr data-id="a" data-pos="G"><td>1</td></tr></thead></table>',
    '<table grid><colgroup></colgroup>\n<thead>\n<tr data-id="a" data-pos="G"><td>1</td></tr>\n</thead><tbody>\n<tr data-id="b" data-pos="V"><td>2</td></tr>\n</tbody></table>',
  ],
];

let compared = 0;

for (const name of NAMES) {
  test(`${name} parsed and written back is the writer's bytes`, () => {
    const sheets = FIXTURES[name]().sheets;
    const doc = parse(sheets.map((sheet) => tableHtml(sheet)).join("\n"));
    const tables = doc.querySelectorAll("table");
    expect(tables.length).toBe(sheets.length);
    for (let i = 0; i < sheets.length; i++) {
      expect(canonicalGrid(domAdapter, tables[i])).toBe(tableHtml(sheets[i]));
      compared++;
    }
  });
}

test("every fixture table was compared", () => {
  expect(compared).toBeGreaterThanOrEqual(10);
});

test("a live DOM edit is written back", () => {
  const workbook = FIXTURES.tiny();
  const budget = workbook.sheets[0];
  const doc = parse(tableHtml(budget));
  const row = doc.querySelector('tr[data-id="r3"]');
  const td = row.querySelectorAll("td")[1];
  td.textContent = "$450.00";
  td.setAttribute("v", "450");

  const expected = {
    ...budget,
    rows: budget.rows.map((r) =>
      r.id === "r3" ? { ...r, cells: r.cells.map((cell, i) => (i === 1 ? { text: "$450.00", n: true, v: "450" } : cell)) } : r,
    ),
  };
  expect(canonicalGrid(domAdapter, doc.querySelector("table"))).toBe(tableHtml(expected));
});

for (const [name, input, expected] of HAND) {
  test(`hand-edited: ${name}`, () => {
    expect(canonicalGrid(domAdapter, parse(input).querySelector("table"))).toBe(expected);
  });

  test(`hand-edited: ${name} is read back by the strict reader`, () => {
    expect(scanGrid(expected, 0)).toBe(expected.length);
  });
}
