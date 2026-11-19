// The command line around the rewrite fuzz (support/rewrite-run.js).
//
// Usage: node test/grid/formula/rewrite-fuzz.mjs [--seeds N] [--steps M] [--seed S] [--out-of-order]
//   [--computing] [--revert]
//
// Every seed runs twice, strict (an action is undone only in order, and every formula must still
// mean what it meant) and out of order (an action is undone while later actions stand). Each run is
// repeated with every restore list emptied: the control must fail somewhere, or the laws prove
// nothing. With `--computing` every seed also checks law E1: after every step a fresh engine
// computing the whole workbook writes no cell and holds every result the running engine holds.
// With `--revert` the out of order run goes through the room codec (`sheetCodec.apply`), so each
// undo is the guarded revert a room sends.
// Prints `seeds N, failures F` and exits 1 on a failure or a control that never fails.

import { limits, run } from "./support/rewrite-run.js";

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : Number(process.argv[at + 1]);
};

const seeds = arg("seeds", 300);
const steps = arg("steps", 40);
const first = arg("seed", 1);

// Undo out of order happens only in a room, and its guarded revert is S5's: its failures are
// reported here and fail the run only with --out-of-order.
const outOfOrderFails = process.argv.includes("--out-of-order");
const computing = process.argv.includes("--computing");
const revert = process.argv.includes("--revert");
let failures = 0;
let outOfOrder = 0;
let uncaught = 0;
for (let seed = first; seed < first + seeds; seed++) {
  for (const strict of [true, false]) {
    const bad = run(seed, { strict, steps, computing, revert });
    if (bad) {
      if (strict) failures += 1;
      else outOfOrder += 1;
      console.log(`FAIL ${strict ? "strict" : "out-of-order"} ${JSON.stringify(bad)}`);
    }
    if (run(seed, { naive: true, strict, steps, computing, revert }) === null) uncaught += 1;
  }
}
if (outOfOrderFails) failures += outOfOrder;

console.log(`seeds ${seeds}, failures ${failures}, out of order (S5) ${outOfOrder}, named limits: ${limits.narrowed} ranges narrowed at one end, ${limits.name} tab-name references left bound`);
if (uncaught === seeds * 2) {
  console.log("the control never failed: emptying every restore list changed nothing, so the laws prove nothing");
  process.exitCode = 1;
}
if (failures > 0) process.exitCode = 1;
