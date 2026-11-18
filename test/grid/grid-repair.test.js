import { canonicalGrid, domAdapter, treeModel } from "../../src/grid/codec/canonical.js";
import { tableHtml } from "../../src/grid/codec/write.js";
import { derive } from "../../src/grid/content.js";
import { createGrid } from "../../src/grid/grid.js";
import { normalizeSheet } from "../../src/grid/normalize.js";

afterEach(() => {
  document.body.innerHTML = "";
});

function live(html) {
  document.body.innerHTML = html;
  const table = document.body.querySelector("table");
  return { table, grid: createGrid(table), bytes: () => canonicalGrid(domAdapter, table) };
}

const rowLines = (bytes) => bytes.split("\n").filter((line) => line.startsWith("<tr"));

test("rows with cells past the last column are repaired once: the new columns move no cell, the repair gives normalizeSheet's bytes, and a second repair changes nothing", () => {
  const html =
    '<table grid><colgroup><col data-id="a" data-pos="G"><col data-id="b" data-pos="V"></colgroup><tbody>' +
    '<tr data-id="r1" data-pos="G"><td>Rent</td><td n>1200</td></tr>' +
    '<tr data-id="r2" data-pos="V"><td>Food</td><td n>300</td><td></td></tr>' +
    '<tr data-id="r3" data-pos="d"><td>Gas</td><td n>45</td><td></td><td></td></tr>' +
    '<tr data-id="r4" data-pos="l"><td>Fee</td><td n>9</td><td>late</td></tr>' +
    "</tbody></table>";
  document.body.innerHTML = html;
  const want = tableHtml(normalizeSheet(treeModel(domAdapter, document.body.querySelector("table")), { derive }).sheet);
  const page = live(html);
  const found = page.grid.issues.map((issue) => issue.code);
  const event = page.grid.repair();
  const once = [page.bytes(), page.grid.issues, page.grid.revision];
  const again = page.grid.repair();
  page.grid.set("A2", "Groceries");
  expect([found, event?.source, once, again, page.grid.revision]).toEqual([["row_too_long", "row_too_long", "row_too_long"], "repair", [want, [], 1], null, 2]);
  expect(rowLines(want)).toEqual([
    '<tr data-id="r1" data-pos="G"><td>Rent</td><td n>1200</td></tr>',
    '<tr data-id="r2" data-pos="V"><td>Food</td><td n>300</td></tr>',
    '<tr data-id="r3" data-pos="d"><td>Gas</td><td n>45</td></tr>',
    '<tr data-id="r4" data-pos="l"><td>Fee</td><td n>9</td><td>late</td></tr>',
  ]);
  expect(want.match(/<col /g).length).toBe(4);
});

test("text in a hidden cell under a merge down a column is shown where it was, and the cells beside it keep their columns", () => {
  const page = live(
    '<table grid><colgroup><col data-id="a" data-pos="G"><col data-id="b" data-pos="V"><col data-id="c" data-pos="l"></colgroup><tbody>' +
      '<tr data-id="r1" data-pos="G"><td rowspan="2">Tall</td><td>B1</td><td>C1</td></tr>' +
      '<tr data-id="r2" data-pos="V"><td hidden>note</td><td>B2</td><td>C2</td></tr>' +
      "</tbody></table>",
  );
  const found = page.grid.issues.map((issue) => issue.code);
  page.grid.repair();
  expect([found, page.grid.issues, page.bytes()]).toEqual([
    ["hidden_text"],
    [],
    '<table grid><colgroup><col data-id="a" data-pos="G"><col data-id="b" data-pos="V"><col data-id="c" data-pos="l"></colgroup>\n<tbody>\n' +
      '<tr data-id="r1" data-pos="G"><td>Tall</td><td>B1</td><td>C1</td></tr>\n' +
      '<tr data-id="r2" data-pos="V"><td>note</td><td>B2</td><td>C2</td></tr>\n' +
      "</tbody></table>",
  ]);
});

test("two hidden texts under one merge down a column, the second in a row with no placeholder for the merge: repair keeps every text, and the row's shown cell stays in the column the page drew it in", () => {
  const page = live(
    '<table grid><colgroup><col data-id="a" data-pos="G"><col data-id="b" data-pos="V"><col data-id="c" data-pos="l"></colgroup><tbody>' +
      '<tr data-id="r1" data-pos="G"><td rowspan="3">Tall</td><td>B1</td></tr>' +
      '<tr data-id="r2" data-pos="V"><td hidden>note1</td><td>B2</td></tr>' +
      '<tr data-id="r3" data-pos="l"><td>B3</td><td hidden>note2</td></tr>' +
      "</tbody></table>",
  );
  page.grid.repair();
  expect([page.grid.issues, rowLines(page.bytes())]).toEqual([
    [],
    [
      '<tr data-id="r1" data-pos="G"><td>Tall</td><td>B1</td></tr>',
      '<tr data-id="r2" data-pos="V"><td>note1</td><td>B2</td></tr>',
      '<tr data-id="r3" data-pos="l"><td></td><td>B3</td><td>note2</td></tr>',
    ],
  ]);
});

test("a merge across a row undone for the hidden text under it keeps the other text it covered", () => {
  const page = live(
    '<table grid><colgroup><col data-id="a" data-pos="G"><col data-id="b" data-pos="V"><col data-id="c" data-pos="l"></colgroup><tbody>' +
      '<tr data-id="r1" data-pos="G"><td colspan="3">Title</td><td hidden>note</td><td>Extra</td></tr>' +
      "</tbody></table>",
  );
  const found = page.grid.issues.map((issue) => issue.code);
  page.grid.repair();
  expect([found.includes("hidden_text"), page.grid.issues, rowLines(page.bytes())]).toEqual([
    true,
    [],
    ['<tr data-id="r1" data-pos="G"><td>Title</td><td>note</td><td>Extra</td></tr>'],
  ]);
});

test("text a write from outside the grid puts in a cell hidden under a merge is found at once: an unmerge refuses until a repair shows it", () => {
  const page = live(
    '<table grid><colgroup><col data-id="a" data-pos="G"><col data-id="b" data-pos="V"></colgroup><tbody>' +
      '<tr data-id="r1" data-pos="G"><td colspan="2">Merged</td><td hidden></td></tr>' +
      '<tr data-id="r2" data-pos="V"><td>a</td><td>b</td></tr>' +
      "</tbody></table>",
  );
  const hidden = page.table.querySelector("td[hidden]");
  hidden.textContent = "rescued-note";
  const event = page.grid.foreignWrite([hidden]);
  const found = page.grid.issues.map((issue) => issue.code);
  let refused = null;
  try {
    page.grid.unmerge("A1");
  } catch (error) {
    refused = error.code;
  }
  page.grid.repair();
  expect([event, found, refused, page.grid.issues, page.grid.get("A1:B1")]).toEqual([null, ["hidden_text"], "needs_repair", [], [["Merged", "rescued-note"]]]);
});

test("hidden text a write from outside the grid takes away again leaves no issue", () => {
  const page = live(
    '<table grid><colgroup><col data-id="a" data-pos="G"><col data-id="b" data-pos="V"></colgroup><tbody>' +
      '<tr data-id="r1" data-pos="G"><td colspan="2">Merged</td><td hidden></td></tr>' +
      "</tbody></table>",
  );
  const hidden = page.table.querySelector("td[hidden]");
  hidden.textContent = "typo";
  page.grid.foreignWrite([hidden]);
  const found = page.grid.issues.map((issue) => issue.code);
  hidden.textContent = "";
  page.grid.foreignWrite([hidden]);
  let unmerged;
  try {
    unmerged = page.grid.unmerge("A1").source;
  } catch (error) {
    unmerged = error.code;
  }
  expect([found, page.grid.issues, unmerged]).toEqual([["hidden_text"], [], "api"]);
});

test("a merge down and across over a row with its own value and a hidden note: repair keeps the value in the column the page drew it in and shows the note where it was", () => {
  const page = live(
    '<table grid><colgroup><col data-id="a" data-pos="G"><col data-id="b" data-pos="V"><col data-id="c" data-pos="d"><col data-id="d" data-pos="l"></colgroup><tbody>' +
      '<tr data-id="r1" data-pos="G"><td colspan="2" rowspan="3">Total</td><td hidden></td><td n>4</td><td>b</td></tr>' +
      '<tr data-id="r2" data-pos="V"><td hidden></td><td hidden></td><td n>5</td><td>c</td></tr>' +
      '<tr data-id="r3" data-pos="d"><td>x</td><td hidden>internal note</td><td n>6</td><td>d</td></tr>' +
      "</tbody></table>",
  );
  page.grid.repair();
  expect([page.grid.issues, page.grid.get("A3:E3"), rowLines(page.bytes())]).toEqual([
    [],
    [[null, "internal note", "x", 6, "d"]],
    [
      '<tr data-id="r1" data-pos="G"><td>Total</td><td></td><td n>4</td><td>b</td></tr>',
      '<tr data-id="r2" data-pos="V"><td></td><td></td><td n>5</td><td>c</td></tr>',
      '<tr data-id="r3" data-pos="d"><td></td><td>internal note</td><td>x</td><td n>6</td><td>d</td></tr>',
    ],
  ]);
});

// Tables whose first run of the repair leaves work for a second, as the repair fuzz found them: a
// span cut to the HTML limit then runs into a merge the run already passed.
const TWO_RUNS = [
  [
    "a span of 1,500 columns beside merges with no hidden cells",
    '<table grid=""><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="0.0,&quot;k&quot;"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>\n' +
    "<tbody>\n" +
    '<tr data-id="h" data-pos="8" style="background: #eeeeee; height: 24px"><td style="text-align: center; color: var(--brand)">Item</td><td>Weight</td><td style="border-width: 1px; border-style: solid; border-color: #cccccc">Qty</td><td style="font: 14px Georgia">Note</td></tr>\n' +
    '<tr data-id="r1" data-pos="G"><td style="background: linear-gradient(#ffffff,#000000)">Rent</td><td n="" v="12345">12.3k</td><td n="" style="background-image:url(icon.png); background-repeat:no-repeat">3</td><td style="border-top-left-radius: 6px">a</td></tr>\n' +
    '<tr data-id="r2" data-pos="O" style="color:#333333; height: 30px"><td colspan="2" rowspan="2">Total</td><td n="">4</td><td colspan="1500">b</td></tr>\n' +
    '<tr data-id="r3" data-pos="V"><td n="">5</td><td>c</td></tr>\n' +
    '<tr data-id="r4" data-pos="l" style="height: 20px"><td>x</td><td hidden="">internal note</td><td n="">6</td><td>d</td></tr>\n' +
    "</tbody></table>",
  ],
  [
    "two spans of 1,500 columns",
    '<table grid=""><colgroup><col data-id="m-c0" data-pos="8"><col data-id="m-c1" data-pos="G"><col data-id="m-c2" data-pos="V"><col data-id="m-c3" data-pos="l"></colgroup>\n' +
    "<tbody>\n" +
    '<tr data-id="m-r1" data-pos="8"><td colspan="3">Title</td><td>D1</td></tr>\n' +
    '<tr data-id="m-r2" data-pos="G"><td rowspan="2">Tall</td><td>B2</td><td colspan="1500">C2</td></tr>\n' +
    '<tr data-id="m-r3" data-pos="V"><td>B3</td><td></td><td colspan="1500">D3</td></tr>\n' +
    '<tr data-id="m-r4" data-pos="l"><td colspan="2" rowspan="2">Box</td></tr>\n' +
    "</tbody></table>",
  ],
  [
    "a merge past the edge beside a span of 1,500 columns",
    '<table grid freeze-cols="2"><colgroup><col data-id="st-c0" data-pos="G" style="width:120px"><col data-id="st-c1" data-pos="V" fmt="0.0%"><col data-id="st-c2" data-pos="l"></colgroup>\n' +
    "<thead>\n" +
    '<tr data-id="st-r1" data-pos="G" style="font-weight:bold;background:#eef"><td>Name</td><td>Share</td><td>Note</td></tr>\n' +
    "</thead><tbody>\n" +
    '<tr data-id="st-r2" data-pos="V"><td colspan="5" rowspan="3" style="color:#c00">Red</td><td n v="0.125" style="text-align:right;font-style:italic">12.5%</td><td colspan="1500" style="text-decoration:underline;white-space:nowrap">underlined</td></tr>\n' +
    '<tr data-id="st-r3" data-pos="l" style="border-bottom:1px solid #999"><td>last</td></tr>\n' +
    "</tbody></table>",
  ],
];

test("one repair settles a table whose first run leaves work for a second", () => {
  const out = TWO_RUNS.map(([name, html]) => {
    const page = live(html);
    const first = page.grid.repair();
    const bytes = page.bytes();
    return [name, first?.source, page.grid.issues, page.grid.repair(), page.bytes() === bytes];
  });
  expect(out).toEqual(TWO_RUNS.map(([name]) => [name, "repair", [], null, true]));
});

test("a repair keeps a row with hidden text in the columns its cells sit at, even when a span the repair undoes covered one of them", () => {
  const html =
  "<table grid=\"\"><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"0.0,&quot;k&quot;\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n" +
  "<tbody>\n" +
  "<tr data-id=\"h\" data-pos=\"8\" style=\"background: #eeeeee; height: 24px\"><td style=\"text-align: center; color: var(--brand)\">Item</td><td>Weight</td><td style=\"border-width: 1px; border-style: solid; border-color: #cccccc\">Qty</td><td rowspan=\"8\" style=\"font: 14px Georgia\">Note</td></tr>\n" +
  "<tr data-id=\"r1\" data-pos=\"G\"><td style=\"background: linear-gradient(#ffffff,#000000)\">Rent</td><td n=\"\" v=\"12345\">12.3k</td><td n=\"\" style=\"background-image:url(icon.png); background-repeat:no-repeat\">3</td><td style=\"border-top-left-radius: 6px\">a</td></tr>\n" +
  "<tr data-id=\"r2\" data-pos=\"O\" style=\"color:#333333; height: 30px\"><td colspan=\"2\" rowspan=\"2\">Total</td><td hidden=\"\"></td><td n=\"\">4</td><td>b</td></tr>\n" +
  "<tr data-id=\"r3\" data-pos=\"V\"><td hidden=\"\"></td><td hidden=\"\"></td><td n=\"\">5</td><td>c</td></tr>\n" +
  "<tr data-id=\"r4\" data-pos=\"l\" style=\"height: 20px\"><td>x</td><td hidden=\"\">internal note</td><td n=\"\">6</td><td>d</td><td hidden=\"\">kept</td></tr>\n" +
  "</tbody></table>";
  const page = live(html);
  const first = page.grid.repair();
  const bytes = page.bytes();
  expect([first?.source, page.grid.get("A5:E5"), page.grid.issues, page.grid.repair(), page.bytes() === bytes]).toEqual([
    "repair",
    [["x", "internal note", 6, "d", "kept"]],
    [],
    null,
    true,
  ]);
});

test("a repair that undoes a span over a value keeps that value even when another span it kept now covers it", () => {
  const html =
    '<table grid=""><colgroup><col data-id="m-c0" data-pos="8"><col data-id="m-c1" data-pos="G"><col data-id="m-c2" data-pos="V"><col data-id="m-c3" data-pos="l"></colgroup>\n' +
    "<tbody>\n" +
    '<tr data-id="m-r1" data-pos="8"><td colspan="3">Title</td><td colspan="1500" rowspan="6">D1</td></tr>\n' +
    '<tr data-id="m-r2" data-pos="G"><td rowspan="2">Tall</td><td>B2</td><td>C2</td></tr>\n' +
    '<tr data-id="m-r3" data-pos="V"><td>B3</td><td></td><td>D3</td></tr>\n' +
    '<tr data-id="m-r4" data-pos="l"><td colspan="2" rowspan="2">Box</td></tr>\n' +
    "</tbody></table>";
  const page = live(html);
  const first = page.grid.repair();
  const shown = page.bytes().match(/>[^<]+</g).map((text) => text.slice(1, -1)).filter((text) => text.trim() !== "");
  expect([first?.source, shown.includes("D3"), page.grid.issues, page.grid.repair()]).toEqual(["repair", true, [], null]);
});
