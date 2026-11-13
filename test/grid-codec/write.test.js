import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES } from "./support/fixtures.js";
import { tableHtml } from "../../src/grid/codec/write.js";

const GOLDEN = join(__dirname, "golden");
const NAMES = [
  "tiny",
  "budget-20k",
  "wide-100k",
  "merged",
  "styled",
  "formulas-formatted",
  "empty",
  "two-tabs",
  "escapes",
];
const HASHED = ["budget-20k", "wide-100k"];

const tableBytes = (name) => FIXTURES[name]().sheets.map((sheet) => tableHtml(sheet)).join("\n");

const TINY_BUDGET = [
  '<table grid freeze-cols="1"><colgroup><col data-id="ca" data-pos="G" style="width:180px"><col data-id="cb" data-pos="V" fmt="$#,##0.00"><col data-id="cc" data-pos="l" fmt="0%"></colgroup>',
  "<thead>",
  '<tr data-id="r1" data-pos="8"><td style="font-weight:bold">Item</td><td>Cost</td><td>Share</td></tr>',
  "</thead><tbody>",
  '<tr data-id="r2" data-pos="G"><td>Rent</td><td n v="1200">$1,200.00</td><td n f="=B2/B$5" v="0.8">80%</td></tr>',
  '<tr data-id="r3" data-pos="O"><td>Food</td><td n v="300">$300.00</td><td n f="=B3/B$5" v="0.2">20%</td></tr>',
  '<tr data-id="r4" data-pos="V"></tr>',
  '<tr data-id="r5" data-pos="d"><td style="font-weight:bold">Total</td><td n f="=SUM(B2:B3)" v="1500">$1,500.00</td></tr>',
  '<tr data-id="r6" data-pos="l"><td colspan="3" style="text-align:center">Prices as of November</td><td hidden></td><td hidden></td></tr>',
  "</tbody></table>",
].join("\n");

for (const name of NAMES) {
  test(`${name} matches its golden`, () => {
    const actual = tableBytes(name);
    if (HASHED.includes(name)) {
      const hashes = JSON.parse(readFileSync(join(GOLDEN, "hashes.json"), "utf8"));
      const bytes = Buffer.from(actual, "utf8");
      expect(hashes[name].bytes).toBe(bytes.length);
      expect(hashes[name].sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    } else {
      expect(actual).toBe(readFileSync(join(GOLDEN, `${name}.html`), "utf8"));
    }
  });
}

test("tiny's Budget table is the architecture example", () => {
  expect(tableHtml(FIXTURES.tiny().sheets[0])).toBe(TINY_BUDGET);
});

test("budget-20k stays at or under 30 bytes per filled cell", () => {
  const workbook = FIXTURES["budget-20k"]();
  const bytes = Buffer.byteLength(workbook.sheets.map((sheet) => tableHtml(sheet)).join("\n"), "utf8");
  let filled = 0;
  for (const sheet of workbook.sheets) {
    for (const row of sheet.rows) {
      for (const cell of row.cells) {
        if (cell && !cell.hidden && cell.text !== "") filled++;
      }
    }
  }
  const perCell = bytes / filled;
  if (perCell > 30) throw new Error(`bytes per filled cell ${perCell}`);
  expect(perCell).toBeLessThanOrEqual(30);
});

test("every fixture's table parses back to its model", () => {
  let compared = 0;
  for (const name of NAMES) {
    if (name === "wide-100k") continue;
    for (const sheet of FIXTURES[name]().sheets) {
      const doc = new DOMParser().parseFromString("<!DOCTYPE html><body>" + tableHtml(sheet), "text/html");
      const table = doc.querySelector("table");

      expect(table.getAttribute("freeze-cols")).toBe(
        sheet.freezeCols === undefined ? null : String(sheet.freezeCols),
      );
      expect(table.hasAttribute("stale")).toBe(Boolean(sheet.stale));

      const cols = table.querySelectorAll("col");
      expect(cols.length).toBe(sheet.cols.length);
      sheet.cols.forEach((col, i) => {
        const el = cols[i];
        expect(el.getAttribute("data-id")).toBe(col.id);
        expect(el.getAttribute("data-pos")).toBe(col.pos);
        expect(el.getAttribute("fmt")).toBe(col.fmt === undefined ? null : col.fmt);
        expect(el.getAttribute("style")).toBe(col.width === undefined ? null : `width:${col.width}px`);
      });

      const trs = table.querySelectorAll("tr");
      expect(trs.length).toBe(sheet.rows.length);
      sheet.rows.forEach((row, i) => {
        const tr = trs[i];
        expect(tr.getAttribute("data-id")).toBe(row.id);
        expect(tr.getAttribute("data-pos")).toBe(row.pos);
        expect(tr.getAttribute("style")).toBe(row.style === undefined ? null : row.style);
        expect(tr.closest("thead") !== null).toBe(row.frozen === true);

        const cells = row.cells.slice();
        while (cells.length > 0 && cells[cells.length - 1] === null) cells.pop();
        expect(tr.children.length).toBe(cells.length);
        cells.forEach((cell, c) => {
          const td = tr.children[c];
          expect(td.tagName).toBe("TD");
          if (cell === null) {
            expect(td.attributes.length).toBe(0);
            expect(td.textContent).toBe("");
          } else {
            expect(td.textContent).toBe(cell.text);
            expect(td.hasAttribute("n")).toBe(Boolean(cell.n));
            expect(td.hasAttribute("t")).toBe(Boolean(cell.t));
            expect(td.hasAttribute("hidden")).toBe(Boolean(cell.hidden));
            expect(td.getAttribute("f")).toBe(cell.f === undefined ? null : cell.f);
            expect(td.getAttribute("v")).toBe(cell.v === undefined ? null : cell.v);
            expect(td.getAttribute("fmt")).toBe(cell.fmt === undefined ? null : cell.fmt);
            expect(td.getAttribute("style")).toBe(cell.style === undefined ? null : cell.style);
            expect(td.getAttribute("colspan")).toBe(
              cell.colspan === undefined ? null : String(cell.colspan),
            );
            expect(td.getAttribute("rowspan")).toBe(
              cell.rowspan === undefined ? null : String(cell.rowspan),
            );
          }
          compared++;
        });
      });
    }
  }
  if (compared <= 20000) throw new Error(`compared ${compared} cells`);
  expect(compared).toBeGreaterThan(20000);
});
