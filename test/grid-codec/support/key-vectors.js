// The order key cases host ports replay: which strings are keys, which calls throw,
// keyBetween on pairs and keysBetween spreads.
import { isKey, keyBetween, keysBetween } from "../../../src/grid/codec/order-keys.js";

const KEY_PAIRS = [[null, null], ["G", null], [null, "G"], ["G", "V"], ["V", "W"], ["Vz", "W"], ["z", null], ["zz", null], ["1", "2"], ["01", "1"], ["a", "a1"]];
const CANDIDATES = ["a0", "", "0", "00", "1", "a", "zz", "Vz", "01", "a-", "A B", "é", "a\n", "Z9", "0a"];
const THROWS = [["G", "G"], ["V", "G"], ["a0", null], [null, "a0"], ["a0", "b"], ["", null]];

function thrown(a, b) {
  try {
    keyBetween(a, b);
    return null;
  } catch (error) {
    return error.name;
  }
}

export function buildKeys() {
  return {
    between: KEY_PAIRS.map(([a, b]) => [a, b, keyBetween(a, b)]),
    spread: [[null, null, 6, keysBetween(null, null, 6)], ["G", "V", 5, keysBetween("G", "V", 5)], [null, null, 60, keysBetween(null, null, 60)], [null, null, 5, keysBetween(null, null, 5)], [null, null, 1000, keysBetween(null, null, 1000)]],
    valid: CANDIDATES.map((key) => [key, isKey(key)]),
    throws: THROWS.map(([a, b]) => [a, b, thrown(a, b)]),
  };
}
