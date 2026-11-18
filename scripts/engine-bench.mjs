// The formula engine's speed on a sheet of the size a budget file reaches: 1,000 rows by 20
// columns, column A holding numbers, column B `=A{r}*2`, column C `=B{r}+C{r-1}` (a 1,000-cell
// chain), and one `=SUM(B1:B1000)` total. Prints the milliseconds for a whole load, for one edit of
// A500, and for one row insert at the top, each the median of 5 runs. No limit is asserted: the
// numbers are for a person to watch, on this machine, against the budget the plan sets.
//
// Usage: node scripts/engine-bench.mjs

import { buildInsertRows, buildSet } from "../src/grid/build.js";
import { keysBetween } from "../src/grid/codec/order-keys.js";
import { createEngine } from "../src/grid/formula/engine.js";
import { applyWorkbook } from "../src/grid/workbook.js";
import { modelWorkbook } from "../src/grid/workbook-backing.js";

const ROWS = 1000;
const COLS = 20;
const RUNS = 5;

const number = (value) => ({ text: String(value), n: true });
const formula = (f) => ({ text: "", f });

function sheet() {
  const sheet = {
    cols: keysBetween(null, null, COLS).map((pos, c) => ({ id: `c${c}`, pos })),
    rows: keysBetween(null, null, ROWS).map((pos, r) => ({ id: `r${r}`, pos, cells: [] })),
  };
  sheet.rows.forEach((row, r) => {
    row.cells.push(number(r + 1), formula(`=A${r + 1}*2`), formula(r === 0 ? "=B1" : `=B${r + 1}+C${r}`));
    for (let c = 3; c < COLS; c++) row.cells.push(r === 0 && c === 3 ? formula(`=SUM(B1:B${ROWS})`) : number(r * c + 1));
  });
  return sheet;
}

const book = () => modelWorkbook([{ id: "s1", name: "Budget", pos: "A", sheet: sheet() }]);

const millis = (run) => {
  const start = process.hrtime.bigint();
  run();
  return Number(process.hrtime.bigint() - start) / 1e6;
};

const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];

function newId() {
  let n = 0;
  return (prefix) => `${prefix}b${n++}`;
}

const times = { load: [], edit: [], insert: [] };
for (let run = 0; run < RUNS; run++) {
  const wb = book();
  const engine = createEngine(wb);
  times.load.push(millis(() => engine.load()));

  const backing = wb.sheets()[0].backing;
  times.edit.push(millis(() => applyWorkbook(wb, buildSet(backing, "A500", 500), { engine })));
  times.insert.push(millis(() => applyWorkbook(wb, buildInsertRows(backing, "1", 1, { newId: newId() }), { engine })));
}

const line = (label, list) => console.log(`${label.padEnd(18)} ${median(list).toFixed(1)} ms  (median of ${RUNS}, runs ${list.map((one) => one.toFixed(1)).join(", ")})`);
line("load", times.load);
line("edit A500", times.edit);
line("insert row at top", times.insert);
function loaded() {
  const wb = book();
  const engine = createEngine(wb);
  engine.load();
  return { wb, engine };
}

const held = loaded();
console.log(`formulas           ${held.engine.size} in ${ROWS} rows by ${COLS} columns`);
