// node test/grid/fuzz/reducer-fuzz.mjs [--lists N] [--length L] [--seed S] [--out DIR] [--plant NAME]
// Runs the reducer laws of step R9 over seeded lists of mixed actions on every golden table, and
// prints the per-kind applied and refused counts. Exits 1 on a failure or on a count of zero. A
// failing list is cut down to the shortest one that still fails with the same law and written to
// DIR/reducer-failure-<seed>.json.
// --plant NAME runs the same checks against a scratch copy of the project with that entry of
// test/mutations/grid-ops.mjs or grid-format.mjs put back, so the fuzzer can be shown able to fail.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { rng } from "../../grid-codec/support/rng.js";
import { genList, shapeOf, SHAPES } from "../support/gen-actions.js";
import { listTables, runList, splitTables } from "../support/laws.js";
import { agentHiddenText, agentSheet } from "../support/agent-sheet.js";
import { planted } from "./plant.mjs";

const NAME = "reducer-fuzz";

const KINDS = [
  "set",
  "format",
  "insertRows",
  "deleteRows",
  "changeRows",
  "insertCols",
  "deleteCols",
  "changeCols",
  "merge",
  "unmerge",
  "freeze",
  "batch",
];

function options(argv) {
  const out = { lists: 20000, length: 40, seed: 1, out: null, plant: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--lists") out.lists = Number(argv[++i]);
    else if (arg === "--length") out.length = Number(argv[++i]);
    else if (arg === "--seed") out.seed = Number(argv[++i]);
    else if (arg === "--out") out.out = argv[++i];
    else if (arg === "--plant") out.plant = argv[++i];
    else {
      console.error(`unknown option ${arg}`);
      process.exit(2);
    }
  }
  return out;
}

const clone = (value) => JSON.parse(JSON.stringify(value));

function tablesIn(dir) {
  const files = readdirSync(dir).filter((name) => name.endsWith(".html")).sort();
  const tables = [];
  for (const file of files) {
    splitTables(readFileSync(join(dir, file), "utf8")).forEach((src, index) => {
      tables.push({ name: `${file.replace(/\.html$/, "")}#${index}`, model: null, src });
    });
  }
  return tables;
}

const opts = options(process.argv.slice(2));

let root = null;
try {
  if (opts.plant) root = planted(opts.plant);
  const base = root ? pathToFileURL(join(root, "src/grid/")).href : new URL("../../../src/grid/", import.meta.url).href;
  const load = (file) => import(base + file);
  const [ops, backing, check, normalize, content, read, write] = await Promise.all([
    load("ops.js"),
    load("backing-model.js"),
    load("check.js"),
    load("normalize.js"),
    load("content.js"),
    load("codec/read.js"),
    load("codec/write.js"),
  ]);
  const engine = {
    apply: ops.apply,
    fits: ops.fits,
    needs: ops.needs,
    creates: ops.creates,
    targets: ops.targets,
    shapeOf,
    GridRefused: ops.GridRefused,
    modelBacking: backing.modelBacking,
    checkSheet: check.checkSheet,
    normalizeSheet: normalize.normalizeSheet,
    gridModel: read.gridModel,
    tableHtml: write.tableHtml,
    derive: content.derive,
  };

  const dir = root ? join(root, "test", "grid-codec", "golden") : fileURLToPath(new URL("../../grid-codec/golden/", import.meta.url));
  const tables = tablesIn(dir);
  for (const table of tables) table.model = engine.gridModel(table.src, 0);
  tables.push({ name: "agent", model: agentSheet(), hiddenText: agentHiddenText });
  const spread = listTables(tables, opts.lists);
  const counts = {};
  const random = rng(opts.seed);
  let failures = 0;
  let first = null;

  for (let index = 0; index < opts.lists && first === null; index++) {
    const table = tables.find((one) => one.name === spread[index]);
    const formulas = index % 2 === 0 ? null : {};
    const start = engine.normalizeSheet(clone(table.model), { derive: engine.derive, hiddenText: table.hiddenText }).sheet;
    const seed = Math.floor(random() * 4294967296);
    const actions = genList(rng(seed), start, opts.length, { formulas });
    const failure = runList(engine, { start, actions, formulas, seed, list: index, name: table.name, counts });
    if (failure !== null) {
      failures += 1;
      first = { failure, start, actions, formulas };
    }
  }

  let shortest = null;
  if (first !== null) {
    const { failure, start, actions, formulas } = first;
    shortest = actions;
    let cut = true;
    while (cut) {
      cut = false;
      for (let at = shortest.length - 1; at >= 0; at--) {
        const candidate = shortest.slice(0, at).concat(shortest.slice(at + 1));
        const again = runList(engine, { start, actions: candidate, formulas, seed: failure.seed, list: failure.list, name: failure.table });
        if (again !== null && again.law === failure.law) {
          shortest = candidate;
          cut = true;
          break;
        }
      }
    }
    console.log(`law ${failure.law} on ${failure.table}, list ${failure.list}, action ${failure.index}, seed ${failure.seed}`);
    console.log(`  action ${JSON.stringify(failure.action)}`);
    console.log(`  detail ${JSON.stringify(failure.detail)}`);
    console.log(`  shortest list of ${shortest.length}: ${JSON.stringify(shortest)}`);
    if (opts.out) {
      mkdirSync(opts.out, { recursive: true });
      const file = join(opts.out, `${NAME}-failure-${failure.seed}.json`);
      writeFileSync(file, JSON.stringify({ seed: failure.seed, table: failure.table, list: shortest, law: failure.law }, null, 2) + "\n");
      console.log(`failure written to ${file}`);
    }
  }

  const actions = opts.lists * opts.length;
  for (const kind of KINDS.concat(SHAPES)) {
    const one = counts[kind] ?? { applied: 0, refused: 0 };
    console.log(`${kind}: applied ${one.applied}, refused ${one.refused}`);
  }
  console.log(`lists ${opts.lists}, actions ${actions}, failures ${failures}`);

  const zero = KINDS.some((kind) => (counts[kind]?.applied ?? 0) === 0 || (counts[kind]?.refused ?? 0) === 0)
    || SHAPES.some((shape) => (counts[shape]?.applied ?? 0) === 0);
  if (zero) console.log("one of the counts is zero");
  process.exitCode = failures > 0 || zero ? 1 : 0;
} finally {
  if (root) rmSync(root, { recursive: true, force: true });
}
