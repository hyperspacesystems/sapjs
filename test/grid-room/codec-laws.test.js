/**
 * @jest-environment node
 */
// The gate for the sheet's room codec (S5): ClayJS's codec laws, C1 to C17, on workbooks the
// codec's own actions reach, with formulas, structure, tabs, sort and undo in the generator. The box
// run (`node test/grid-room/fuzz-s1.mjs --seeds 1000`) checks many more samples the same way.
import { checkCodec } from "./support/check-codec.js";
import { drawingsIn, sheetCodec } from "../../src/grid/room-codec.js";
import { RESIDUAL, sample, tally } from "./support/sample.js";

global.__SAP_KEEP_CONSOLE__ = true;

const KINDS = ["set", "format", "insertRows", "deleteRows", "changeRows", "insertCols", "deleteCols", "changeCols", "merge", "freeze", "batch", "sort", "revert", "insertSheet", "deleteSheet", "renameSheet", "moveSheet"];

test("the sheet codec passes the codec laws, and every kind of action, a skipped undo and a refusal are in the samples", () => {
  tally.clear();
  const failures = checkCodec(sheetCodec, sample, { runs: 400, seed: 1, cap: 5 });
  expect(failures).toEqual([]);
  const seen = (prefix) => [...tally.keys()].some((key) => key.startsWith(prefix));
  for (const kind of KINDS) expect([kind, seen(`${kind}:applied`)]).toEqual([kind, true]);
  expect(seen("revert:applied:skipped")).toBe(true);
  expect(seen("sort:refused") || seen("insertSheet:refused")).toBe(true);
  const dropped = [...tally].filter(([key]) => RESIDUAL.has(key.split(":")[1])).reduce((sum, [, n]) => sum + n, 0);
  const applied = [...tally].filter(([key]) => key.includes(":applied")).reduce((sum, [, n]) => sum + n, 0);
  expect(dropped).toBeLessThan(applied / 50);
});

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" role="img" width="320" height="180" viewBox="0 0 320 180"><title>Sales</title><rect x="50" y="40" width="20" height="100"></rect><text x="60" y="160">a &lt; b &amp; {{c}}</text></svg>';

test("the laws hold on samples whose first tab has two charts, one past the sheet's edge, and a writer that draws every chart", () => {
  const withCharts = (random) => {
    const one = sample(random);
    one.doc.tabs[0].sheet.rules = [
      { id: "k6", pos: "V", kind: "chart", range: "C2:D5", source: "A1:B6", type: "line" },
      { id: "k8", pos: "l", kind: "chart", range: "C4:H12", source: "A1:B6", type: "area", stacked: true },
      { id: "k9", pos: "t", kind: "chart", range: "C6:H7", source: "A1:B6", type: "bar" },
    ];
    return one;
  };
  const drawn = { ...sheetCodec, write: (doc, record, extras) => sheetCodec.write(doc, record, extras ?? { drawing: () => SVG }) };
  const bytes = drawn.write(withCharts(() => 0.5).doc, {});
  expect(bytes).toContain(`<figure chart="k6" sap-ignore="">${SVG}</figure>`);
  expect(drawingsIn(bytes)("s1", "k8")).toBe(SVG);
  expect(checkCodec(drawn, withCharts, { runs: 400, seed: 1, cap: 5 })).toEqual([]);
});
