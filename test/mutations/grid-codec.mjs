// node test/mutations/grid-codec.mjs [keys-trailing-zero|codec-hidden-order|codec-group-merge|patch-keeps-hidden]
// Each entry removes one rule from the grid codec and names the test that must then
// fail. With no argument every entry runs, one after another.
import { mutate } from "./harness.mjs";

const TEST = "test/grid-codec/host-vectors.test.js";
const KEYS = "src/grid/codec/order-keys.js";
const WRITE = "src/grid/codec/write.js";

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
});
