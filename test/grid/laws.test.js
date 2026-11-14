import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { derive } from "../../src/grid/content.js";
import { apply, creates, fits, GridRefused, needs, targets } from "../../src/grid/ops.js";
import { modelBacking } from "../../src/grid/backing-model.js";
import { checkSheet } from "../../src/grid/check.js";
import { normalizeSheet } from "../../src/grid/normalize.js";
import { gridModel } from "../../src/grid/codec/read.js";
import { tableHtml } from "../../src/grid/codec/write.js";
import { rng } from "../grid-codec/support/rng.js";
import { genList, shapeOf, SHAPES } from "./support/gen-actions.js";
import { listTables, runList, splitTables } from "./support/laws.js";
import { agentHiddenText, agentSheet } from "./support/agent-sheet.js";

global.__SAP_KEEP_CONSOLE__ = true;

const SEED = 20261119;
const LISTS = 300;
const LENGTH = 30;

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

const engine = {
  apply,
  fits,
  needs,
  creates,
  targets,
  shapeOf,
  GridRefused,
  modelBacking,
  checkSheet,
  normalizeSheet,
  gridModel,
  tableHtml,
  derive,
};

const clone = (value) => JSON.parse(JSON.stringify(value));

function goldenTables() {
  const dir = join(__dirname, "..", "grid-codec", "golden");
  const files = readdirSync(dir).filter((name) => name.endsWith(".html")).sort();
  const tables = [];
  for (const file of files) {
    splitTables(readFileSync(join(dir, file), "utf8")).forEach((src, index) => {
      tables.push({ name: `${file.replace(/\.html$/, "")}#${index}`, model: gridModel(src, 0) });
    });
  }
  return tables;
}

test("reducer laws over seeded lists", () => {
  const tables = goldenTables();
  tables.push({ name: "agent", model: agentSheet(), hiddenText: agentHiddenText });
  expect(tables.length).toBeGreaterThan(0);
  const spread = listTables(tables, LISTS);
  const counts = {};
  const random = rng(SEED);
  const started = Date.now();
  let failure = null;

  for (let index = 0; index < LISTS && failure === null; index++) {
    const table = tables.find((one) => one.name === spread[index]);
    const formulas = index % 2 === 0 ? null : {};
    const start = normalizeSheet(clone(table.model), { derive, hiddenText: table.hiddenText }).sheet;
    const seed = Math.floor(random() * 4294967296);
    const actions = genList(rng(seed), start, LENGTH, { formulas });
    failure = runList(engine, { start, actions, formulas, seed, list: index, name: table.name, counts });
    if (failure !== null) {
      console.log(`law ${failure.law} on ${failure.table}, list ${failure.list}, action ${failure.index}, seed ${failure.seed}`);
      console.log(`  action ${JSON.stringify(failure.action)}`);
      console.log(`  detail ${JSON.stringify(failure.detail)}`);
      console.log(`  before ${JSON.stringify(failure.before)}`);
      console.log(`  after  ${JSON.stringify(failure.after)}`);
    }
  }

  const summary = KINDS.concat(SHAPES).map((kind) => `${kind} ${counts[kind]?.applied ?? 0} applied, ${counts[kind]?.refused ?? 0} refused`);
  console.log(`lists ${LISTS}, actions ${LISTS * LENGTH}, ${Date.now() - started} ms`);
  for (const line of summary) console.log(`  ${line}`);

  expect(failure).toBeNull();

  for (const kind of KINDS) {
    expect([kind, (counts[kind]?.applied ?? 0) > 0]).toEqual([kind, true]);
    expect([kind, (counts[kind]?.refused ?? 0) > 0]).toEqual([kind, true]);
  }
  for (const shape of SHAPES) {
    expect([shape, (counts[shape]?.applied ?? 0) > 0]).toEqual([shape, true]);
  }
});
