// node test/bench/grid-engine-bench.mjs [--runs 7] [--json out.json] [--src dir]
// First numbers for the grid engine (plan step D9), on the ledger of the codec's budget-20k
// fixture (about 20,000 cells, with formulas) and on a formula-free sheet of 1,000 rows by 20
// columns: loading a Grid, one typed set, a 20,000 cell setRange that grows an empty sheet, one
// row inserted at the top of the formula-free sheet (the guard refuses it on a sheet with
// formulas), and a full rescan of a clean table and of a table with one cell changed on the DOM.
// Each number is the median of the runs in ms, with the fastest and slowest, and the mutation
// records the operation made. jsdom timings: compare runs on one machine, not the milliseconds.
// No time is asserted. --src points at another copy of src/, to compare two versions.
import { JSDOM } from "jsdom";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i === -1 ? fallback : process.argv[i + 1];
}

const RUNS = Number(arg("runs", 7));
const JSON_OUT = arg("json", null);
const SRC = arg("src", null);
const src = (file) => (SRC ? pathToFileURL(resolve(SRC, file)).href : `../../src/${file}`);
const ROWS = 1000;
const COLS = 20;

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/" });
for (const key of ["window", "document", "Node", "Element", "HTMLElement", "MutationObserver", "CustomEvent", "Event", "getComputedStyle"]) {
  globalThis[key] = key === "window" ? dom.window : dom.window[key];
}
const log = console.log;
console.log = console.warn = console.error = () => {};

const { createGrid } = await import(src("grid/grid.js"));
const { tableHtml } = await import(src("grid/codec/write.js"));
const { FIXTURES } = await import("../grid-codec/support/fixtures.js");
const doc = dom.window.document;

const ledger = FIXTURES["budget-20k"]().sheets[0];
const ledgerHtml = `<div items="sheets"><section item data-id="${ledger.id}"><h2 bind="name">Ledger</h2>${tableHtml(ledger)}</section></div>`;
const emptyHtml = '<div items="sheets"><section item data-id="flat"><h2 bind="name">Flat</h2><table grid><colgroup><col data-id="ca" data-pos="V"></colgroup><tbody><tr data-id="r1" data-pos="V"></tr></tbody></table></section></div>';
const block = Array.from({ length: ROWS }, (unused, r) => Array.from({ length: COLS }, (unused2, c) => (c === 0 ? `item ${r}` : c % 3 === 0 ? `${(r * 7 + c) % 1000}.25` : c % 3 === 1 ? `${r * c}` : `note ${c}`)));

let host = null;
let observer = null;
function page(html) {
  if (host !== null) host.remove();
  if (observer !== null) observer.disconnect();
  host = doc.createElement("div");
  host.innerHTML = html;
  doc.body.append(host);
  observer = new dom.window.MutationObserver(() => {});
  observer.observe(host, { childList: true, subtree: true, attributes: true, characterData: true });
  return host.querySelector("table");
}

// Runs fn and returns its time in ms and the mutation records it made.
function measure(fn) {
  observer.takeRecords();
  const t0 = performance.now();
  const out = fn();
  const ms = performance.now() - t0;
  return { ms, records: observer.takeRecords().length, out };
}

let flat = null;
function flatSheet() {
  if (flat === null) {
    const table = page(emptyHtml);
    createGrid(table).setRange("A1", block, { grow: true });
    flat = host.innerHTML;
  }
  return page(flat);
}

const OPS = {
  load() {
    const table = page(ledgerHtml);
    return measure(() => createGrid(table));
  },
  set() {
    const table = page(ledgerHtml);
    const grid = createGrid(table);
    grid.set("B500", "1,234.56");
    return measure(() => grid.set("B500", "2,345.67"));
  },
  setRange() {
    const table = page(emptyHtml);
    const grid = createGrid(table);
    const run = measure(() => grid.setRange("A1", block, { grow: true }));
    if (grid.size.rows * grid.size.cols !== ROWS * COLS) throw new Error(`setRange gave ${grid.size.rows} x ${grid.size.cols}`);
    return run;
  },
  insertTop() {
    const table = flatSheet();
    const grid = createGrid(table);
    const run = measure(() => grid.insertRows(1, 1));
    if (run.out?.rows?.added?.length !== 1) throw new Error("the insert at the top did not insert one row");
    return run;
  },
  rescanClean() {
    const table = page(ledgerHtml);
    const grid = createGrid(table);
    const run = measure(() => grid.rescan());
    if (run.out !== false) throw new Error("a clean table differed on a rescan");
    return run;
  },
  rescanChanged() {
    const table = page(ledgerHtml);
    const grid = createGrid(table);
    table.tBodies[3].rows[10].cells[1].textContent = "77";
    const run = measure(() => grid.rescan());
    if (run.out !== true) throw new Error("a rescan missed a cell changed on the DOM");
    return run;
  },
};

const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
const round = (ms) => Math.round(ms * 100) / 100;

const result = { src: SRC || "src", node: process.version, runs: RUNS, ledger: { rows: ledger.rows.length, cols: ledger.cols.length }, flat: { rows: ROWS, cols: COLS }, ops: {} };
for (const [name, op] of Object.entries(OPS)) {
  op();
  const samples = [];
  let records = 0;
  for (let i = 0; i < RUNS; i++) {
    const run = op();
    samples.push(run.ms);
    records = run.records;
  }
  result.ops[name] = { median: round(median(samples)), min: round(Math.min(...samples)), max: round(Math.max(...samples)), records };
}

const pad = (value, width = 12) => String(value).padStart(width);
log(`grid engine from ${result.src}, node ${result.node}, median of ${RUNS} runs, jsdom`);
log(`ledger ${result.ledger.rows} x ${result.ledger.cols}, flat sheet ${ROWS} x ${COLS}`);
log("operation".padEnd(16) + pad("median ms") + pad("min ms") + pad("max ms") + pad("records"));
for (const [name, one] of Object.entries(result.ops)) log(name.padEnd(16) + pad(one.median) + pad(one.min) + pad(one.max) + pad(one.records));
if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify(result, null, 2) + "\n");
  log(`wrote ${JSON_OUT}`);
}
