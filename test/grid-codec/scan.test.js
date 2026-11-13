import { FIXTURES } from "./support/fixtures.js";
import { tableHtml } from "../../src/grid/codec/write.js";
import { scanAt } from "./support/scan-helpers.js";

const NAMES = Object.keys(FIXTURES);

function modelRow(row) {
  const cells = row.cells.slice();
  while (cells.length > 0 && cells[cells.length - 1] === null) cells.pop();
  const expected = { id: row.id, pos: row.pos };
  if (row.frozen) expected.frozen = true;
  if (row.style !== undefined) expected.style = row.style;
  expected.cells = cells;
  return expected;
}

for (const name of NAMES) {
  const workbook = FIXTURES[name]();
  workbook.sheets.forEach((sheet, sheetIndex) => {
    test(`${name} sheet ${sheetIndex} is read back as its own model`, () => {
      const src = tableHtml(sheet);
      const result = scanAt(src, 0);
      expect(result.verdict).toBe("accept");
      expect(result.end).toBe(src.length);
      expect(result.cols).toEqual(sheet.cols);
      expect(result.rows.map((entry) => entry.row)).toEqual(sheet.rows.map(modelRow));
    });
  });
}

const BASE = (cells) => `<table grid><tbody>\n<tr data-id="r" data-pos="G">${cells}</tr>\n</tbody></table>`;

const budgetSheet = FIXTURES.tiny().sheets[0];
const noLineFeeds = tableHtml(budgetSheet).replace(/\n/g, "");
const spaceAndTab = tableHtml(budgetSheet).replace(/\n/g, " \t ");

const ACCEPTED = [
  ["no line feeds at all", noLineFeeds],
  ["tabs and spaces between rows", spaceAndTab],
  [
    "a table with no colgroup",
    '<table grid>\n<tbody>\n<tr data-id="r" data-pos="G"><td>x</td></tr>\n</tbody></table>',
  ],
  [
    "a table with only thead",
    '<table grid><colgroup></colgroup>\n<thead>\n<tr data-id="r" data-pos="G"><td>x</td></tr>\n</thead></table>',
  ],
  ["a hidden cell followed by a text cell", BASE("<td hidden></td><td>b</td>")],
];

for (const [what, src] of ACCEPTED) {
  test(`accepts ${what}`, () => {
    const result = scanAt(src, 0);
    expect(result.verdict).toBe("accept");
    expect(result.end).toBe(src.length);
  });
}

test("the accepted edge cases really differ from the writer's bytes", () => {
  expect(noLineFeeds).not.toBe(tableHtml(budgetSheet));
  expect(spaceAndTab).not.toBe(tableHtml(budgetSheet));
});
