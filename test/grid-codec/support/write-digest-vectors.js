// Writes the row digest vectors a Go port or another host checks against: the
// published FNV-1a vectors plus every small fixture sheet's table bytes and the
// digest of that table, so a reader needs only the one file.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURES } from "./fixtures.js";
import { tableHtml } from "../../../src/grid/codec/write.js";
import { gridModel } from "../../../src/grid/codec/read.js";
import { fnv1a, hex, gridDigest, columnIds, tabDigest, rowChange } from "../../../src/grid/codec/digest.js";
import { keysBetween } from "./order-keys.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, "..", "golden");
const NAMES = ["tiny", "merged", "styled", "formulas-formatted", "empty", "escapes"];
const FNV_TEXTS = ["", "a", "foobar", "é", "😀"];

mkdirSync(GOLDEN, { recursive: true });

const fnv = FNV_TEXTS.map((text) => [text, hex(fnv1a(text))]);
const sheets = [];
for (const fixture of NAMES) {
  FIXTURES[fixture]().sheets.forEach((sheet, index) => {
    const table = tableHtml(sheet);
    sheets.push({ fixture, sheet: index, table, digest: tabDigest(gridModel(table, 0)) });
  });
}

// One-row sheets before and after an edit, with the guard's verdict for the row.
// colIds names the sheet's columns, so a removed column is a shorter list.
const changeSheet = (colIds, texts) => {
  const colKeys = keysBetween(null, null, colIds.length);
  return {
    id: "s1",
    name: "Sheet1",
    cols: colIds.map((id, i) => ({ id, pos: colKeys[i] })),
    rows: [{ id: "r1", pos: keysBetween(null, null, 1)[0], cells: texts.map((text) => ({ text })) }],
  };
};
const CHANGE_CASES = [
  ["unchanged", ["c0", "c1", "c2"], ["a", "b", "c"], ["c0", "c1", "c2"], ["a", "b", "c"]],
  ["overwrite", ["c0", "c1", "c2"], ["a", "b", "c"], ["c0", "c1", "c2"], ["a", "X", "c"]],
  ["clear", ["c0", "c1", "c2"], ["a", "b", "c"], ["c0", "c1", "c2"], ["a", "", "c"]],
  ["clear-and-overwrite", ["c0", "c1", "c2"], ["a", "b", "c"], ["c0", "c1", "c2"], ["X", "", "c"]],
  ["clear-one-fill-another", ["c0", "c1", "c2"], ["a", "b", ""], ["c0", "c1", "c2"], ["a", "", "d"]],
  ["fill-empty", ["c0", "c1", "c2"], ["a", "", ""], ["c0", "c1", "c2"], ["a", "", "d"]],
  ["remove-filled-column", ["c0", "c1", "c2"], ["a", "b", "c"], ["c0", "c2"], ["a", "c"]],
  ["remove-empty-column", ["c0", "c1", "c2"], ["a", "", "c"], ["c0", "c2"], ["a", "c"]],
  ["clear-whole-row", ["c0", "c1", "c2"], ["a", "b", "c"], ["c0", "c1", "c2"], []],
  ["replace-filled-column", ["email", "amount"], ["alice@example.test", "125"], ["phone", "amount"], ["555-0100", "125"]],
  ["remove-filled-column-insert-another", ["c0", "c1", "c2"], ["a", "b", "c"], ["c0", "c2", "c3"], ["a", "c", "d"]],
];
const changes = CHANGE_CASES.map(([name, beforeCols, beforeTexts, afterCols, afterTexts]) => {
  const before = tableHtml(changeSheet(beforeCols, beforeTexts));
  const after = tableHtml(changeSheet(afterCols, afterTexts));
  const beforeModel = gridModel(before, 0);
  const afterModel = gridModel(after, 0);
  const beforeRow = gridDigest(beforeModel)[0];
  const afterRow = gridDigest(afterModel)[0] ?? null;
  const beforeColumns = columnIds(beforeModel);
  const afterColumns = columnIds(afterModel);
  return { name, before, after, beforeColumns, afterColumns, beforeRow, afterRow, change: rowChange(beforeRow, afterRow, beforeColumns, afterColumns) };
});

writeFileSync(join(GOLDEN, "digest-vectors.json"), JSON.stringify({ fnv1a: fnv, sheets, changes }, null, 2) + "\n");

console.log(`wrote ${sheets.length} sheet vectors to ${join(GOLDEN, "digest-vectors.json")}`);
