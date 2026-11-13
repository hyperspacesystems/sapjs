import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES } from "./support/fixtures.js";
import { tableHtml } from "../../src/grid/codec/write.js";
import { gridModel } from "../../src/grid/codec/read.js";

import { fnv1a, hex, cellInput, columnIds, rowDigest, gridDigest, tabDigest, maskHex, maskIndexes, rowChange } from "../../src/grid/codec/digest.js";

const GOLDEN = join(__dirname, "golden");
const VECTORS = JSON.parse(readFileSync(join(GOLDEN, "digest-vectors.json"), "utf8"));

const budget = () => gridModel(tableHtml(FIXTURES.tiny().sheets[0]), 0);

const columns = [{ id: "a" }, { id: "b" }, { id: "c" }];
const row = (id, cells) => ({ id, cells });

const TINY_BUDGET_DIGEST = [
  ["r1", 3, 13, "88eaf7a4", "5b298afa", "7"],
  ["r2", 3, 15, "2e42c11c", "5b298afa", "7"],
  ["r3", 3, 14, "f29ad24a", "5b298afa", "7"],
  ["r5", 2, 16, "3f334081", "0d001bd9", "3"],
  ["r6", 1, 21, "7e1a83c4", "58299449", "1"],
];

test("fnv1a matches the published 32 bit vectors", () => {
  expect(hex(fnv1a(""))).toBe("811c9dc5");
  expect(hex(fnv1a("a"))).toBe("e40c292c");
  expect(hex(fnv1a("foobar"))).toBe("bf9cf968");
});

test("gridDigest of tiny's Budget sheet matches the rows worked out by hand", () => {
  expect(gridDigest(budget())).toEqual(TINY_BUDGET_DIGEST);
});

test("columnsHash is the xor of the filled columns' hashes", () => {
  const digest = rowDigest(row("r1", [{ text: "x" }, { text: "y" }]), columns);
  expect(digest[1]).toBe(2);
  expect(digest[4]).toBe(hex((fnv1a("a") ^ fnv1a("b")) >>> 0));
});

test("filling a different column keeps filled and changes columnsHash", () => {
  const before = rowDigest(row("r1", [{ text: "x" }, { text: "y" }]), columns);
  const after = rowDigest(row("r1", [{ text: "x" }, { text: "" }, { text: "y" }]), columns);
  expect(after[1]).toBe(before[1]);
  expect(after[4]).not.toBe(before[4]);
});

test("swapping which column holds which value changes inputsHash and keeps columnsHash", () => {
  const before = rowDigest(row("r1", [{ text: "x" }, { text: "yy" }]), columns);
  const after = rowDigest(row("r1", [{ text: "yy" }, { text: "x" }]), columns);
  expect(after[3]).not.toBe(before[3]);
  expect(after[4]).toBe(before[4]);
});

test("a recalculation is not a change", () => {
  const before = { text: "80%", f: "=B2/B$5", v: "0.8" };
  const after = { text: "90%", f: "=B2/B$5", v: "0.9" };
  expect(rowDigest(row("r2", [{ text: "Rent" }, before]), columns)).toEqual(
    rowDigest(row("r2", [{ text: "Rent" }, after]), columns),
  );
});

test("cellInput gives f before v before text", () => {
  expect(cellInput({ text: "80%", f: "=B2/B$5", v: "0.8" })).toBe("=B2/B$5");
  expect(cellInput({ text: "$1,200.00", v: "1200" })).toBe("1200");
  expect(cellInput({ text: "Item" })).toBe("Item");
  expect(cellInput({ text: "gone", hidden: true })).toBe("");
  expect(cellInput(undefined)).toBe("");
});

test("a spaced cell counts as filled with mass 1", () => {
  const digest = rowDigest(row("r1", [{ text: "  x  " }]), columns);
  expect(digest[1]).toBe(1);
  expect(digest[2]).toBe(1);
});

test("the vectors file matches the code and the fixtures", () => {
  for (const entry of VECTORS.sheets) {
    const sheet = FIXTURES[entry.fixture]().sheets[entry.sheet];
    expect(entry.table).toBe(tableHtml(sheet));
    expect(tabDigest(gridModel(entry.table, 0))).toEqual(entry.digest);
  }
  for (const [text, hash] of VECTORS.fnv1a) expect(hex(fnv1a(text))).toBe(hash);
  expect(VECTORS.changes.map((entry) => entry.name)).toEqual([
    "unchanged", "overwrite", "clear", "clear-and-overwrite", "clear-one-fill-another",
    "fill-empty", "remove-filled-column", "remove-empty-column", "clear-whole-row",
    "replace-filled-column", "remove-filled-column-insert-another",
  ]);
  for (const entry of VECTORS.changes) {
    const beforeModel = gridModel(entry.before, 0);
    const afterModel = gridModel(entry.after, 0);
    const beforeRow = gridDigest(beforeModel)[0];
    const afterRow = gridDigest(afterModel)[0] ?? null;
    expect([beforeRow, afterRow]).toEqual([entry.beforeRow, entry.afterRow]);
    expect(rowChange(beforeRow, afterRow, columnIds(beforeModel), columnIds(afterModel))).toBe(entry.change);
  }
});

test("the mask names the filled column indexes and columnIds names their columns", () => {
  expect(rowDigest(row("r1", [{ text: "" }, { text: "x" }]), columns)[5]).toBe("2");
  expect(rowDigest(row("r1", [{ text: "x" }, { text: "" }, { text: "y" }]), columns)[5]).toBe("5");
  expect(maskIndexes("5")).toEqual([0, 2]);
  expect(maskIndexes(maskHex([0, 5, 17]))).toEqual([0, 5, 17]);
  expect(columnIds({ cols: [{ id: "a" }, {}, { id: "c" }] })).toEqual(["a", "#1", "c"]);
  expect(columnIds({ cols: [{ id: "" }, { id: "" }] })).toEqual(["#0", "#1"]);
});

test("rowChange: overwrite is a modification, clear is destruction, a moved empty column is not", () => {
  const verdicts = Object.fromEntries(VECTORS.changes.map((entry) => [entry.name, entry.change]));
  expect(verdicts).toEqual({
    unchanged: "same",
    overwrite: "modification",
    clear: "destruction",
    "clear-and-overwrite": "destruction",
    "clear-one-fill-another": "destruction",
    "fill-empty": "modification",
    "remove-filled-column": "destruction",
    "remove-empty-column": "modification",
    "clear-whole-row": "destruction",
    "replace-filled-column": "destruction",
    "remove-filled-column-insert-another": "destruction",
  });
});

test("every change vector's verdict is rowChange over its recorded column ids", () => {
  for (const entry of VECTORS.changes) {
    expect([entry.name, rowChange(entry.beforeRow, entry.afterRow, entry.beforeColumns, entry.afterColumns)]).toEqual([entry.name, entry.change]);
  }
});

test("replacing a filled column with another filled column at the same position is destruction", () => {
  const cols = (ids) => ids.map((id) => ({ id }));
  const row = (texts) => ({ id: "r1", cells: texts.map((text) => ({ text })) });
  const ids = (list) => columnIds({ cols: cols(list) });
  const before = rowDigest(row(["alice@example.test", "125"]), cols(["email", "amount"]));
  const after = rowDigest(row(["555-0100", "125"]), cols(["phone", "amount"]));
  expect(before[5]).toBe(after[5]);
  expect(rowChange(before, after, ids(["email", "amount"]), ids(["phone", "amount"]))).toBe("destruction");
  const overwritten = rowDigest(row(["bob@example.test", "125"]), cols(["email", "amount"]));
  expect(rowChange(before, overwritten, ids(["email", "amount"]), ids(["email", "amount"]))).toBe("modification");
});

test("a removed filled column is destruction even when another column is inserted", () => {
  const cols = (ids) => ids.map((id) => ({ id }));
  const row = (texts) => ({ id: "r1", cells: texts.map((text) => ({ text })) });
  const ids = (list) => columnIds({ cols: cols(list) });
  const before = rowDigest(row(["a", "b", "c"]), cols(["c0", "c1", "c2"]));
  const replaced = rowDigest(row(["a", "c", "d"]), cols(["c0", "c2", "c3"]));
  expect(rowChange(before, replaced, ids(["c0", "c1", "c2"]), ids(["c0", "c2", "c3"]))).toBe("destruction");
  const inserted = rowDigest(row(["a", "", "b", "c"]), cols(["c0", "cX", "c1", "c2"]));
  expect(rowChange(before, inserted, ids(["c0", "c1", "c2"]), ids(["c0", "cX", "c1", "c2"]))).toBe("modification");
});

test("the budget-20k digests stay under 50,000 characters", () => {
  const digests = FIXTURES["budget-20k"]().sheets.map((sheet) => tabDigest(gridModel(tableHtml(sheet), 0)));
  expect(JSON.stringify(digests).length).toBeLessThan(50000);
});

test("columns with no id are matched by position, so clearing one and filling another is destruction", () => {
  const cols = [{ id: "" }, { id: "" }, { id: "" }];
  const ids = columnIds({ cols });
  const before = rowDigest(row("r1", [{ text: "a" }, { text: "" }, { text: "c" }]), cols);
  const after = rowDigest(row("r1", [{ text: "" }, { text: "X" }, { text: "c" }]), cols);
  expect(before[4]).not.toBe("00000000");
  expect(rowChange(before, after, ids, ids)).toBe("destruction");
});

test("columns that get ids on first open keep their cells: a column with no id is the column now at its index", () => {
  const cells = [{ text: "a" }, { text: "b" }];
  const bare = [{ id: "" }, { id: "" }];
  const named = [{ id: "c1" }, { id: "c2" }];
  const before = rowDigest(row("r1", cells), bare);
  const after = rowDigest(row("r1", cells), named);
  expect(before[4]).not.toBe(after[4]);
  expect(rowChange(before, after, columnIds({ cols: bare }), columnIds({ cols: named }))).toBe("same");
  const cleared = rowDigest(row("r1", [{ text: "" }, { text: "b" }, { text: "x" }]), [...named, { id: "c3" }]);
  expect(rowChange(before, cleared, columnIds({ cols: bare }), ["c1", "c2", "c3"])).toBe("destruction");
});
