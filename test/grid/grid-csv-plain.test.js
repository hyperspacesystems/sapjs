import { canonicalGrid, domAdapter } from "../../src/grid/codec/canonical.js";
import { createGrid } from "../../src/grid/grid.js";

global.__SAP_KEEP_CONSOLE__ = true;

const TODAY = 46095;

const SHEET = `<table grid><colgroup><col data-id="ca" data-pos="G" fmt="0%"><col data-id="cb" data-pos="V" fmt="@"><col data-id="cc" data-pos="l" fmt="$#,##0.00"><col data-id="cd" data-pos="t"></colgroup>
<tbody>
<tr data-id="r1" data-pos="G"></tr>
<tr data-id="r2" data-pos="V"></tr>
<tr data-id="r3" data-pos="l"></tr>
</tbody></table>`;

afterEach(() => {
  document.body.innerHTML = "";
});

function live(html) {
  document.body.innerHTML = html;
  const table = document.body.querySelector("table");
  let minted = 0;
  const grid = createGrid(table, { today: () => TODAY, newId: (prefix) => `${prefix}n${++minted}` });
  return { table, grid, bytes: () => canonicalGrid(domAdapter, table) };
}

test("an import reads a field as plain data, whatever the cell's format, unless the format is text; typing and a paste still read the cell's format", () => {
  const page = live(SHEET);
  page.grid.importDelimited("5,5,1200,5%", "A1");
  page.grid.set("A2", "5");
  page.grid.setRange("A3", [["5", "5"]]);
  expect([page.grid.get("A1:D1"), page.grid.get("A2"), page.grid.get("A3:B3"), page.grid.cell("A1").text, page.grid.cell("D1").text]).toEqual([
    [[5, "5", 1200, 0.05]],
    0.05,
    [[0.05, "5"]],
    "500%",
    "5%",
  ]);
});

test("a protected export imported back over text and percent columns gives back the same values", () => {
  const page = live(`<table grid><colgroup><col data-id="ca" data-pos="G" fmt="@"><col data-id="cb" data-pos="V" fmt="0%"></colgroup>
<tbody>
<tr data-id="r1" data-pos="G"><td>-5 units</td><td n>0.8</td></tr>
<tr data-id="r2" data-pos="V"><td>=SUM(A1)</td><td n>0.25</td></tr>
<tr data-id="r3" data-pos="l"><td>'quoted</td><td></td></tr>
</tbody></table>`);
  const before = page.grid.get("A1:B3");
  const shown = page.grid.toDelimited(undefined, { protect: true });
  const raw = page.grid.toDelimited(undefined, { values: "raw", protect: true });
  page.grid.importDelimited(shown, "A1");
  const afterShown = page.grid.get("A1:B3");
  page.grid.importDelimited(raw, "A1");
  expect([afterShown, page.grid.get("A1:B3")]).toEqual([before, before]);
});
