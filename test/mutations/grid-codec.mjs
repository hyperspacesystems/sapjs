// node test/mutations/grid-codec.mjs [keys-trailing-zero|codec-hidden-order|codec-group-merge|patch-keeps-hidden|
//   writer-cells|writer-results|writer-rows|writer-cols|writer-repeated-id|writer-structure|writer-result-cells|
//   writer-event-rows|writer-rescanned|writer-extras-swap|writer-result-flags]
// Each entry removes one rule from the grid codec and names the test that must then
// fail. With no argument every entry runs, one after another.
import { mutate } from "./harness.mjs";

const TEST = "test/grid-codec/host-vectors.test.js";
const KEYS = "src/grid/codec/order-keys.js";
const WRITE = "src/grid/codec/write.js";
const CACHED = "src/grid/codec/cached-writer.js";
const CACHED_TEST = "test/grid-codec/cached-writer.test.js";
const CACHED_LAW = "the cached writer writes the same bytes as tableHtml after every action of every list";

mutate({
  "keys-trailing-zero": {
    what: "a key may end in 0, so a keyBetween call on one no longer throws",
    file: KEYS,
    find: "const VALID_KEY = /^[0-9A-Za-z]*[1-9A-Za-z]$/;",
    replace: "const VALID_KEY = /^[0-9A-Za-z]*[0-9A-Za-z]$/;",
    test: TEST,
    name: "the order key validity and throw cases in host-vectors.json match the code",
    expects: /"a0"/,
  },
  "codec-hidden-order": {
    what: "the writer puts a row's hidden after its style, where the strict reader does not take it",
    file: WRITE,
    find: "${hidden}${style}>",
    replace: "${style}${hidden}>",
    test: "test/grid-codec/scan.test.js",
    name: "hidden sheet 0 is read back as its own model",
    expects: /toBe|toEqual/,
  },
  "codec-group-merge": {
    what: "a group ends every 50 rows, inside a merge down a column too",
    file: WRITE,
    find: "if (r - start >= groupSize && open <= r) {",
    replace: "if (r - start >= groupSize) {",
    test: "test/grid-codec/write.test.js",
    name: "tall-merge matches its golden",
    expects: /toBe|toEqual/,
  },
  "patch-keeps-hidden": {
    what: "a patch that rewrites a row drops the row's hidden",
    file: "src/grid/codec/patch.js",
    find: "const row = edited.get(index) ?? { ...grid.rows[index].row, cells: [...grid.rows[index].row.cells] };",
    replace: "const row = edited.get(index) ?? { ...grid.rows[index].row, hidden: undefined, cells: [...grid.rows[index].row.cells] };",
    test: TEST,
    name: "the patch and order key cases in host-vectors.json match the code",
    expects: /toBe|toEqual/,
  },
  "writer-cells": {
    what: "a changed cell keeps its group's cached string, so the save writes the old value",
    file: CACHED,
    find: "    for (const change of changes.cells ?? []) dropRow(tab, change.row);\n",
    replace: "",
    test: CACHED_TEST,
    name: CACHED_LAW,
    expects: /toBeNull/,
  },
  "writer-results": {
    what: "a recalculated formula result keeps its group's cached string, so the save writes the old total",
    file: CACHED,
    find: "    for (const change of changes.results ?? []) dropRow(tab, change.row);\n",
    replace: "",
    test: CACHED_TEST,
    name: CACHED_LAW,
    expects: /toBeNull/,
  },
  "writer-rows": {
    what: "a row change (a new height, style or hidden) keeps its group's cached string",
    file: CACHED,
    find: "    for (const entry of listed(changes.rows)) dropRow(tab, rowOf(entry));\n",
    replace: "",
    test: CACHED_TEST,
    name: CACHED_LAW,
    expects: /toBeNull/,
  },
  "writer-cols": {
    what: "a column change drops nothing, so a moved column's cells keep their old order",
    file: CACHED,
    find: "if (!changes || changes.rescanned || (changes.structure && !lists) || listed(changes.cols).length > 0) {",
    replace: "if (!changes || changes.rescanned || (changes.structure && !lists)) {",
    test: CACHED_TEST,
    name: "a column change, or a touch that names nothing, drops the whole tab",
    expects: /toBe|toEqual/,
  },
  "writer-repeated-id": {
    what: "a table where a row id repeats caches its groups, so a write to one copy of the row is lost",
    file: CACHED,
    find: "const distinct = new Set(data.map((row) => row.id)).size === data.length;",
    replace: "const distinct = true;",
    test: CACHED_TEST,
    name: "a table where a row id repeats is written whole every time",
    expects: /toBe|toEqual/,
  },
  "writer-structure": {
    what: "a structure change with no row or column lists drops nothing, so cached rows keep their old cell order",
    file: CACHED,
    find: "changes.rescanned || (changes.structure && !lists) ||",
    replace: "changes.rescanned ||",
    test: CACHED_TEST,
    name: "a structure change named with no row or column lists drops the whole tab, and a change of an unknown shape throws",
    expects: /toBe|toEqual/,
  },
  "writer-result-cells": {
    what: "a result is written into any cell, so a value typed over a formula is saved as the old result",
    file: CACHED,
    find: "if (!cell || cell.f === undefined || cell.hidden || cols[c] === undefined) return;",
    replace: "if (!cell || cols[c] === undefined) return;",
    test: CACHED_TEST,
    name: CACHED_LAW,
    expects: /toBeNull|grid codec/,
  },
  "writer-event-rows": {
    what: "a Grid event's row lists are read as empty, so a typed row height keeps its group's cached string",
    file: CACHED,
    find: "const listed = (part) => (Array.isArray(part) ? part : [...(part?.added ?? []), ...(part?.removed ?? []), ...(part?.changed ?? [])]);",
    replace: "const listed = (part) => (Array.isArray(part) ? part : []);",
    test: CACHED_TEST,
    name: "a Grid change event drops the groups of the rows it names, and one that read the whole table drops the tab",
    expects: /toBe|toEqual/,
  },
  "writer-rescanned": {
    what: "a Grid event that read the whole table again drops nothing",
    file: CACHED,
    find: "if (!changes || changes.rescanned || (changes.structure && !lists) ||",
    replace: "if (!changes || (changes.structure && !lists) ||",
    test: CACHED_TEST,
    name: "a Grid change event drops the groups of the rows it names, and one that read the whole table drops the tab",
    expects: /toBe|toEqual/,
  },
  "writer-extras-swap": {
    what: "groups written with no results are reused by a write with results, so a save keeps an old total",
    file: CACHED,
    find: "    if (tab.extras !== extras) {",
    replace: "    if (false) {",
    test: CACHED_TEST,
    name: "a write with other results, or with none, writes every group again",
    expects: /toBe|toEqual/,
  },
  "writer-result-flags": {
    what: "a result keeps the cell's old n and t, so a text result that reads as a number is saved as a number",
    file: CACHED,
    find: 'for (const key of ["v", "n", "t"]) {',
    replace: 'for (const key of ["v"]) {',
    test: CACHED_TEST,
    name: CACHED_LAW,
    expects: /toBeNull/,
  },
});
