import { FIXTURES, documentHtml } from "./support/fixtures.js";
import { tableHtml } from "../../src/grid/codec/write.js";
import { cutGrids, joinGrids, holeHtml, holeMarker } from "../../src/grid/codec/cut.js";
import { CodecMiss } from "../../src/grid/codec/scan.js";

const NAMES = Object.keys(FIXTURES);

for (const name of NAMES) {
  test(`${name} cut leaves holes and join restores the bytes`, () => {
    const workbook = FIXTURES[name]();
    const src = documentHtml(workbook);
    const marker = holeMarker(src);
    const cut = cutGrids(src, marker);

    expect(cut.regions.length).toBe(workbook.sheets.length);
    cut.regions.forEach((region, n) => {
      expect(cut.rest).toContain(holeHtml(marker, n));
      expect(src.slice(region.start, region.end)).toBe(tableHtml(workbook.sheets[n]));
    });
    expect(cut.rest).not.toContain("<td");
    expect(joinGrids(cut.rest, marker, src, cut.regions)).toBe(src);
  });
}

test("a document with no grid is untouched", () => {
  const src = "<!DOCTYPE html>\n<html><body>\n<p>nothing here</p>\n</body></html>\n";
  const marker = holeMarker(src);
  const cut = cutGrids(src, marker);
  expect(cut.rest).toBe(src);
  expect(cut.regions.length).toBe(0);
  expect(joinGrids(cut.rest, marker, src, cut.regions)).toBe(src);
});

test("join swaps in new bytes for a region", () => {
  const workbook = FIXTURES.tiny();
  const src = documentHtml(workbook);
  const marker = holeMarker(src);
  const cut = cutGrids(src, marker);

  const modified = {
    sheets: workbook.sheets.map((sheet, i) =>
      i !== 0
        ? sheet
        : {
            ...sheet,
            rows: sheet.rows.map((row, r) =>
              r !== 1
                ? row
                : { ...row, cells: row.cells.map((cell, c) => (c !== 0 ? cell : { ...cell, text: "Rent (new)" })) },
            ),
          },
    ),
  };

  const bytes = [tableHtml(modified.sheets[0])];
  expect(joinGrids(cut.rest, marker, src, cut.regions, bytes)).toBe(documentHtml(modified));
});

test("hole text for a different marker does not disturb the cut", () => {
  const workbook = FIXTURES.tiny();
  const src = documentHtml(workbook).replace("<body>\n", `<body>\n<p>${holeHtml("other", 0)}</p>\n`);
  const marker = holeMarker(src);
  const cut = cutGrids(src, marker);

  expect(cut.regions.length).toBe(workbook.sheets.length);
  expect(cut.rest).toContain(holeHtml("other", 0));
  expect(joinGrids(cut.rest, marker, src, cut.regions)).toBe(src);
});

test("a marker that occurs in the document is a plain error", () => {
  const src = documentHtml(FIXTURES.tiny());
  let caught;
  try {
    cutGrids(src, "body");
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect(caught).not.toBeInstanceOf(CodecMiss);
});

test("a marker with a character outside [A-Za-z0-9_-] is a plain error", () => {
  const src = documentHtml(FIXTURES.tiny());
  for (const marker of ["bad marker", "bad/marker", "bad.marker", ""]) {
    let caught;
    try {
      cutGrids(src, marker);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(CodecMiss);
  }
});

test("cut does not know comments (lane B step B5 carries this case)", () => {
  const workbook = FIXTURES.tiny();
  const src = `<!-- ${tableHtml(workbook.sheets[0])} -->\n${tableHtml(workbook.sheets[1])}\n`;
  const marker = holeMarker(src);
  const cut = cutGrids(src, marker);

  expect(cut.regions.length).toBe(2);
  expect(joinGrids(cut.rest, marker, src, cut.regions)).toBe(src);
});

test("a table that misses stays in rest while a valid grid after it is cut", () => {
  const miss = '<table grid><tbody>\n<tr data-id="r" data-pos="G"><td>&copy</td></tr>\n</tbody></table>';
  const valid = tableHtml(FIXTURES.tiny().sheets[1]);
  const src = `${miss}\n${valid}\n`;
  const marker = holeMarker(src);
  const cut = cutGrids(src, marker);

  expect(cut.regions.length).toBe(1);
  expect(cut.rest).toBe(`${miss}\n${holeHtml(marker, 0)}\n`);
  expect(joinGrids(cut.rest, marker, src, cut.regions)).toBe(src);
});

// The 60 ms budget is a speed check, not a correctness check: on a loaded machine it measures
// the machine. It runs only when asked, for example SAPJS_PERF=1 npx jest test/grid-codec/cut.test.js.
const perfTest = process.env.SAPJS_PERF === "1" ? test : test.skip;

perfTest("cutGrids on wide-100k takes under 60 ms", () => {
  const src = documentHtml(FIXTURES["wide-100k"]());
  const marker = holeMarker(src);
  let best = Infinity;
  for (let run = 0; run < 3; run++) {
    const started = performance.now();
    cutGrids(src, marker);
    best = Math.min(best, performance.now() - started);
  }
  process.stdout.write(`cutGrids wide-100k best of 3: ${best.toFixed(1)} ms\n`);
  expect(best).toBeLessThan(60);
});
