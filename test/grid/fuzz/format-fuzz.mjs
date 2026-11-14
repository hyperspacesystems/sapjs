// node test/grid/fuzz/format-fuzz.mjs [--count N] [--seed S] [--out DIR] [--plant NAME] [count] [seed]
// Formats count random values under the built-in number codes and compares each result with the
// BigInt oracle. Prints "checked N, mismatches M" and exits 1 on any mismatch or if nothing was
// checked.
// --plant NAME runs the same checks against a scratch copy of the project with that entry of
// test/mutations/grid-format.mjs put back, so the fuzzer can be shown able to fail.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { oracleFormat } from "../support/decimal-oracle.js";
import { rng } from "../../grid-codec/support/rng.js";
import { planted } from "./plant.mjs";

const NAME = "format-fuzz";

const CODES = [];
for (const currency of ["", "$"]) {
  for (const group of ["#,##0", "0"]) {
    for (let places = 0; places <= 15; places++) {
      for (const percent of ["", "%"]) {
        if (currency && percent) continue;
        CODES.push(currency + group + (places ? "." + "0".repeat(places) : "") + percent);
      }
    }
  }
}

function options(argv, countDefault) {
  const out = { count: countDefault, seed: 1, out: null, plant: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--count") out.count = Number(argv[++i]);
    else if (arg === "--seed") out.seed = Number(argv[++i]);
    else if (arg === "--out") out.out = argv[++i];
    else if (arg === "--plant") out.plant = argv[++i];
    else if (arg.startsWith("--")) {
      console.error(`unknown option ${arg}`);
      process.exit(2);
    } else rest.push(Number(arg));
  }
  if (rest.length > 0) out.count = rest[0];
  if (rest.length > 1) out.seed = rest[1];
  return out;
}

function sample(random) {
  const pick = (n) => Math.floor(random() * n);
  const sign = random() < 0.5 ? -1 : 1;
  switch (pick(6)) {
    case 0:
      return 0;
    case 1:
      return sign * pick(1000000);
    case 2: {
      const count = 1 + pick(15);
      let digits = String(1 + pick(9));
      for (let i = 1; i < count; i++) digits += String(pick(10));
      return sign * Number(`${digits[0]}.${digits.slice(1)}e${pick(32) - 10}`);
    }
    case 3:
      return sign * Number(`${pick(1000000)}.${String(pick(1000000)).padStart(6, "0")}5`);
    case 4:
      return sign * Number(`${pick(100000)}.${String(pick(100)).padStart(2, "0")}5`);
    default:
      return sign * Number(`0.${String(pick(100000)).padStart(5, "0")}`);
  }
}

const opts = options(process.argv.slice(2), 1000000);
const seed = opts.seed;
const count = opts.count;

let root = null;
try {
  if (opts.plant) root = planted(opts.plant);
  const base = root ? pathToFileURL(join(root, "src/grid/")).href : new URL("../../../src/grid/", import.meta.url).href;
  const { formatValue } = await import(base + "format.js");

  const random = rng(seed);
  let checked = 0;
  let mismatches = 0;
  const first = { seed, index: null, input: null, format: null, mismatch: null };
  for (let i = 0; i < count; i++) {
    const value = sample(random);
    const fmt = CODES[Math.floor(random() * CODES.length)];
    checked++;
    const got = formatValue(value, fmt);
    const want = oracleFormat(value, fmt);
    if (got === want) continue;
    mismatches++;
    if (mismatches === 1) Object.assign(first, { index: i, input: value, format: fmt, mismatch: { got, want } });
    if (mismatches <= 5) console.log(`mismatch ${i}: [${value}, ${JSON.stringify(fmt)}, ${JSON.stringify(got)}, ${JSON.stringify(want)}]`);
  }
  console.log(`checked ${checked}, mismatches ${mismatches}`);
  if (mismatches > 0 && opts.out) {
    mkdirSync(opts.out, { recursive: true });
    const file = join(opts.out, `${NAME}-failure-${seed}.json`);
    writeFileSync(file, JSON.stringify(first, null, 2) + "\n");
    console.log(`failure written to ${file}`);
  }
  if (checked === 0) console.log("checked is zero");
  process.exitCode = mismatches > 0 || checked === 0 ? 1 : 0;
} finally {
  if (root) rmSync(root, { recursive: true, force: true });
}
