/**
 * @jest-environment node
 */
// The gate for the sheet's room codec (S5): ClayJS's codec laws, C1 to C17, on workbooks the
// codec's own actions reach, with formulas, structure, tabs, sort and undo in the generator. The box
// run (`node test/grid-room/fuzz-s1.mjs --seeds 1000`) checks many more samples the same way.
import { checkCodec } from "./support/check-codec.js";
import { sheetCodec } from "../../src/grid/room-codec.js";
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
