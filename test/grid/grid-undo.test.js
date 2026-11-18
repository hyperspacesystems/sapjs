import { readFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalGrid, domAdapter } from "../../src/grid/codec/canonical.js";
import { keysBetween } from "../../src/grid/codec/order-keys.js";
import { gridModel } from "../../src/grid/codec/read.js";
import { tableHtml } from "../../src/grid/codec/write.js";
import { derive } from "../../src/grid/content.js";
import { createGrid } from "../../src/grid/grid.js";
import { normalizeSheet } from "../../src/grid/normalize.js";

afterEach(() => {
  document.body.innerHTML = "";
});

const TABLE =
  '<table grid><colgroup><col data-id="ca" data-pos="G"><col data-id="cb" data-pos="V"></colgroup>\n<tbody>\n' +
  '<tr data-id="r1" data-pos="G"><td>a</td><td>old</td></tr>\n' +
  '<tr data-id="r2" data-pos="V"><td>b</td><td n>7</td></tr>\n' +
  "</tbody></table>";

// A live table and a Grid whose writes that are not edits stay out of the undo history, as ClayJS
// keeps them out. `step()` returns the edits since the last step. `undo(step)` replays them in
// reverse and refuses as ClayJS's undo does, returning why: a node an edit added must still sit
// where it was added, and a text an edit wrote must still be there. Then the Grid reads the table
// again, and `undo` returns "undone".
function live(html) {
  document.body.innerHTML = html;
  const table = document.body.querySelector("table");
  const observer = new MutationObserver(() => {});
  observer.observe(table, { childList: true, subtree: true, attributes: true, characterData: true, attributeOldValue: true, characterDataOldValue: true });
  const edits = [];
  let depth = 0;
  const write = (fn) => {
    if (depth++ === 0) edits.push(...observer.takeRecords());
    try {
      return fn();
    } finally {
      if (--depth === 0) observer.takeRecords();
    }
  };
  const grid = createGrid(table, { write, today: () => 46095 });
  const step = () => {
    edits.push(...observer.takeRecords());
    const records = edits.splice(0);
    return records.map((record, i) => {
      if (record.type !== "characterData") return { record };
      const later = records.slice(i + 1).find((next) => next.target === record.target);
      return { record, after: later ? later.oldValue : record.target.data };
    });
  };
  const undo = (records) => {
    for (const { record, after } of [...records].reverse()) {
      if (record.type === "characterData") {
        if (record.target.data !== after) return "content-changed";
        record.target.data = record.oldValue;
      } else if (record.type === "attributes") {
        if (record.oldValue === null) record.target.removeAttribute(record.attributeName);
        else record.target.setAttribute(record.attributeName, record.oldValue);
      } else {
        if ([...record.addedNodes].some((node) => node.parentNode !== record.target)) return "structure-changed";
        for (const node of record.addedNodes) node.remove();
        const next = record.nextSibling?.parentNode === record.target ? record.nextSibling : null;
        for (const node of record.removedNodes) record.target.insertBefore(node, next);
      }
    }
    observer.takeRecords();
    grid.foreignWrite([table]);
    step();
    return "undone";
  };
  return { table, grid, step, undo, bytes: () => canonicalGrid(domAdapter, table) };
}

test("two undos after a column format put back the typed number, then the text it replaced", () => {
  const page = live(TABLE);
  page.step();
  page.grid.set("B1", "5");
  const typed = page.step();
  page.grid.format("B:B", { fmt: "$#,##0.00" });
  const formatted = page.step();
  const edits = formatted.map(({ record }) => `${record.type} ${record.target.localName} ${record.attributeName}`);
  const shown = page.table.rows[0].cells[1].outerHTML;
  const first = page.undo(formatted);
  const once = [page.table.rows[0].cells[1].outerHTML, page.table.rows[1].cells[1].outerHTML];
  const second = page.undo(typed);
  expect([edits, shown, first, once, second, page.grid.get("B1"), page.bytes()]).toEqual([
    ["attributes col fmt"],
    '<td n="" v="5">$5.00</td>',
    "undone",
    ['<td n="">5</td>', '<td n="">7</td>'],
    "undone",
    "old",
    TABLE,
  ]);
});

test("after a column format, undo takes away the text node typed into an emptied cell, then puts back the text it cleared", () => {
  const page = live(TABLE);
  page.step();
  page.grid.set("A1", null);
  const nodes = page.table.rows[0].cells[0].childNodes.length;
  const cleared = page.step();
  page.grid.set("A1", "9");
  const typed = page.step();
  page.grid.format("A:A", { fmt: "0.0" });
  const formatted = page.step();
  const shown = page.table.rows[0].cells[0].outerHTML;
  const undone = [page.undo(formatted), page.undo(typed)];
  const empty = page.table.rows[0].cells[0].outerHTML;
  undone.push(page.undo(cleared));
  expect([nodes, shown, undone, empty, page.bytes()]).toEqual([0, '<td n="" v="9">9.0</td>', ["undone", "undone", "undone"], "<td></td>", TABLE]);
});

const KG =
  '<table grid><colgroup><col data-id="ca" data-pos="G" fmt="#,##0 &quot;kg&quot;"><col data-id="cb" data-pos="V"></colgroup>\n<tbody>\n' +
  '<tr data-id="r1" data-pos="G"><td n v="1200">1,200 kg</td><td>x</td></tr>\n' +
  "</tbody></table>";

test("an undo of a column format over a format no formatter knows puts back the text that format showed, with its number", () => {
  const results = ["$#,##0.00", null].map((fmt) => {
    const page = live(KG);
    page.step();
    page.grid.format("A:A", { fmt });
    const shown = page.table.rows[0].cells[0].outerHTML;
    const undone = page.undo(page.step());
    return [shown, undone, page.bytes(), page.table.hasAttribute("stale")];
  });
  expect(results).toEqual([
    ['<td n="" v="1200">$1,200.00</td>', "undone", KG, false],
    ['<td n="">1200</td>', "undone", KG, false],
  ]);
});

// merged's table after the declared repair, in a tab with the id the engine fuzz gives it.
const MERGED = tableHtml(normalizeSheet(gridModel(readFileSync(join(__dirname, "..", "grid-codec", "golden", "merged.html"), "utf8"), 0), { derive }).sheet);

test("an undo of one batch that types a number, formats its column and writes a formula over the number gives back the text the cell had", () => {
  const page = live(`<section item data-id="sheet">${MERGED}</section>`);
  page.step();
  page.grid.apply({
    v: 1,
    t: "batch",
    actions: [
      { v: 1, t: "set", sheet: "sheet", cells: [["m-r3", "m-c1", -7], ["m-r2", "m-c2", -7]] },
      { v: 1, t: "changeCols", sheet: "sheet", cols: [{ id: "m-c1", fmt: "0.00" }] },
      {
        v: 1,
        t: "set",
        sheet: "sheet",
        cells: [
          ["m-r4", "m-c2", 0, { fmt: '0.0,"k"', style: { background: "red", "border-right": "1px solid #000000" } }],
          ["m-r3", "m-c1", { f: "=A1+1" }, { fmt: "0%", style: { "text-align": "right", "border-left": null, "font-weight": "bold" } }],
        ],
      },
    ],
  });
  const shown = page.grid.cell("B3");
  const undone = page.undo(page.step());
  expect([shown.content, undone, page.grid.get("B3"), page.bytes()]).toEqual([{ f: "=A1+1" }, "undone", "B3", MERGED]);
});

test("an undo of one batch that formats a column and clears a number typed before it gives back the number", () => {
  const page = live(`<section item data-id="sheet">${TABLE}</section>`);
  page.step();
  page.grid.apply({
    v: 1,
    t: "batch",
    actions: [
      { v: 1, t: "changeCols", sheet: "sheet", cols: [{ id: "cb", fmt: "m/d/yyyy" }] },
      { v: 1, t: "set", sheet: "sheet", cells: [["r2", "cb", null]] },
    ],
  });
  const cleared = page.grid.get("B2");
  const undone = page.undo(page.step());
  expect([cleared, undone, page.grid.get("B2"), page.bytes()]).toEqual([null, "undone", 7, TABLE]);
});

test("an undo of one batch that writes a formula over text and then gives it a result gives back the text", () => {
  const page = live(`<section item data-id="sheet">${TABLE}</section>`);
  page.step();
  page.grid.apply({
    v: 1,
    t: "batch",
    actions: [
      { v: 1, t: "set", sheet: "sheet", cells: [["r1", "cb", { f: "=A1+1", r: null }]] },
      { v: 1, t: "set", sheet: "sheet", cells: [["r1", "cb", { f: "=A1+1", r: false }]] },
    ],
  });
  const shown = page.table.rows[0].cells[1].textContent;
  const undone = page.undo(page.step());
  expect([shown, undone, page.grid.get("B1"), page.bytes()]).toEqual(["FALSE", "undone", "old", TABLE]);
});

const TALL = tableHtml({
  cols: [{ id: "ca", pos: "G" }],
  rows: keysBetween(null, null, 55).map((pos, i) => ({ id: `r${i + 1}`, pos, cells: [{ text: `Row ${i + 1}` }] })),
});

test("an undo of a row move, a delete and an insert across the 50-row group cut puts every row back in its place", () => {
  const results = [];
  for (const edit of [(g) => g.moveRows("51", 1), (g) => g.deleteRows("50"), (g) => g.insertRows(10, 1)]) {
    const page = live(TALL);
    page.step();
    edit(page.grid);
    const records = page.step();
    results.push([page.undo(records), page.grid.get("A49:A52"), page.grid.issues, page.bytes() === TALL]);
  }
  const back = ["undone", [["Row 49"], ["Row 50"], ["Row 51"], ["Row 52"]], [], true];
  expect(results).toEqual([back, back, back]);
});
