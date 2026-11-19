// The box run for the sheet's room codec: ClayJS's codec laws on many seeds.
//
// Usage: node test/grid-room/fuzz-s1.mjs [--seeds N] [--runs R] [--seed S]
//
// Each seed runs `checkCodec` on R samples (support/sample.js). Prints every failure with its seed,
// then the count of each sampled outcome, including the reducer refusals the sampler leaves out
// (RESIDUAL, the plan's Deferred list). Exits 1 on any failure.
import { checkCodec } from "./support/check-codec.js";
import { sheetCodec } from "../../src/grid/room-codec.js";
import { sample, tally } from "./support/sample.js";

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : Number(process.argv[at + 1]);
};

const seeds = arg("seeds", 20);
const runs = arg("runs", 200);
const first = arg("seed", 1);
let failures = 0;
for (let seed = first; seed < first + seeds; seed++) {
  for (const failure of checkCodec(sheetCodec, sample, { runs, seed, cap: 5 })) {
    failures += 1;
    console.log(`FAIL seed ${seed} ${failure.law} run ${failure.run}: ${failure.detail}`);
  }
}
console.log(`seeds ${seeds} x ${runs} samples, failures ${failures}`);
console.log([...tally].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, n]) => `${key} ${n}`).join(", "));
process.exit(failures ? 1 : 0);
