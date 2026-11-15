// node test/mutations/grid-codec.mjs [keys-trailing-zero]
// Each entry removes one rule from the grid codec and names the test that must then
// fail. With no argument every entry runs, one after another.
import { mutate } from "./harness.mjs";

const TEST = "test/grid-codec/host-vectors.test.js";
const KEYS = "src/grid/codec/order-keys.js";

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
});
