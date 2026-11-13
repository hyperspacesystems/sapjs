// What a closed plugin boundary costs the engine must not grow with what is inside it.
// The counts are engine reads of a table row or cell (attributes and child links), not
// milliseconds, so the test means the same on every machine.

import { mount, type, Sap } from "./helpers/mount.js";
import { watchCells } from "./helpers/cell-reads.js";
import { declareFacts } from "../src/registry.js";

const tick = async (n = 4) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

beforeAll(() => {
  declareFacts({ name: "grid", file: "grid", order: 5, boundaries: { grid: { opaque: true, on: "table" } }, helpers: ["cell", "range"] });
});

afterEach(() => Sap._reset());

function page(cells, attr) {
  let rows = "";
  for (let r = 0; r < cells / 20; r++) {
    rows += "<tr>";
    for (let c = 0; c < 20; c++) rows += (r * 20 + c) % 5 === 0 ? `<td n f="=A1*2">2</td>` : `<td n>1</td>`;
    rows += "</tr>";
  }
  return `<main sap state="zoom:num" zoom="1">
    <input id="title" bind="title" value="Workbook">
    <section items="sheets"><article item data-id="s1"><h2 bind="name">Budget</h2><table ${attr}><tbody>${rows}</tbody></table></article></section>
    <output id="count" text="state.sheets.length + ' sheet, ' + state.title">1 sheet, Workbook</output>
  </main>`;
}

// Runs every phase on a page of that many cells and returns the reads each one made.
async function visits(cells, attr) {
  document.body.innerHTML = "";
  const cellsRead = watchCells();
  try {
    let root;
    const out = {};
    out.mount = await cellsRead.during(() => { root = mount(page(cells, attr)); });
    out.refresh = await cellsRead.during(() => Sap.refresh());
    out.accessor = await cellsRead.during(() => Sap(root.querySelector("article")).name);
    out.edit = await cellsRead.during(async () => { type(root.querySelector("#title"), "Plan"); await tick(); });
    out.status = await cellsRead.during(() => Sap.status());
    expect(root.querySelector("#count").textContent).toBe("1 sheet, Plan");
    expect(Sap.report().errors).toEqual([]);
    return out;
  } finally {
    cellsRead.stop();
  }
}

test("cost: mount, refresh, an accessor read, an edit and the green line read no cell of a closed boundary, at 2,000 or 20,000 cells", async () => {
  const small = await visits(2000, "grid");
  const large = await visits(20000, "grid");
  expect(large).toEqual(small);
  expect(small).toEqual({ mount: 0, refresh: 0, accessor: 0, edit: 0, status: 0 });
}, 30000);

test("cost: the counter sees the engine read every cell of a plain table", async () => {
  const small = await visits(400, "class=plain");
  const large = await visits(4000, "class=plain");
  for (const phase of ["mount", "refresh", "accessor", "status"]) {
    expect(small[phase]).toBeGreaterThan(400);
    expect(large[phase]).toBeGreaterThan(small[phase] * 5);
  }
}, 30000);
