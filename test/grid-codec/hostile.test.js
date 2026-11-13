import { cellHtml } from "../../src/grid/codec/write.js";
import { scanAt } from "./support/scan-helpers.js";
import { MISSES, CELLS } from "./support/hostile-cases.js";

const FORMULA = '=IF(A1="</table>","<td>","-->")&"\n"&"x"';
const formulaCell = cellHtml({ text: "7", n: true, f: FORMULA });

const READINGS = [];

for (const [what, src] of MISSES) {
  test(`miss: ${what}`, () => {
    expect(scanAt(src, 0).verdict).toBe("miss");

    const doc = new DOMParser().parseFromString("<!DOCTYPE html><body>" + src, "text/html");
    const first = doc.querySelector("td");
    READINGS.push({
      what,
      text: first ? first.textContent : null,
      attrs: first
        ? Array.from(first.attributes, (a) => `${a.name}=${a.value}`)
        : [],
    });
    expect(doc.documentElement).not.toBeNull();
  });
}

test("a formula attribute carries </table>, <td>, --> and a line feed", () => {
  const src = CELLS(formulaCell);
  const result = scanAt(src, 0);
  expect(result.verdict).toBe("accept");
  expect(result.end).toBe(src.length);
  expect(result.rows.length).toBe(1);
  expect(result.rows[0].row.cells[0].f).toBe(FORMULA);

  const doc = new DOMParser().parseFromString("<!DOCTYPE html><body>" + src, "text/html");
  const first = doc.querySelector("td");
  READINGS.push({ what: "formula cell", text: first ? first.textContent : null, attrs: [] });
});

test("&gt; in text reads back as >", () => {
  const src = CELLS("<td>--&gt;</td>");
  const result = scanAt(src, 0);
  expect(result.verdict).toBe("accept");
  expect(result.rows[0].row.cells[0]).toEqual({ text: "-->" });
});

test("the browser parser was consulted for every hostile case", () => {
  expect(READINGS.length).toBe(MISSES.length + 1);
});
