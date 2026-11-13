// node test/bench/grid-mount-bench.mjs [--rows 1000] [--cols 20] [--runs 5] [--json out.json] [--src dir] [--declare] [--rules]
// Measures what one sheet-shaped page costs the engine: a [sap] root, one sheet row, and
// a <table grid> of rows x cols cells with every fifth cell a formula. It reports mount,
// Sap.refresh(), one edit outside the table, one accessor read, and the ownership walks,
// at the asked size and at a tenth of it, plus how many times each phase touched a cell.
// jsdom timings: compare the two sizes and two runs on one machine, not the milliseconds.
// --src points at another copy of src/, to measure two versions of the engine on one machine.
// --declare tells the engine that table[grid] is the grid plugin's opaque boundary, as the
// plugin manifest will once the grid plugin ships, and installs no plugin: the engine then
// has to leave the table alone. Without it table[grid] is ordinary markup.
// --rules puts the grid's ownership rules on the page, as a plugin definition would:
// a formula cell owns its text and `n` is painted on every cell. The ownership walks
// then ask the table by selector. A copy of src/ from before rules ignores them.
import { JSDOM } from "jsdom";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { watchCells } from "../helpers/cell-reads.js";

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i === -1 ? fallback : process.argv[i + 1];
}

const ROWS = Number(arg("rows", 1000));
const COLS = Number(arg("cols", 20));
const RUNS = Number(arg("runs", 5));
const JSON_OUT = arg("json", null);
const SRC = arg("src", null);
const DECLARE = process.argv.includes("--declare");
const RULES = process.argv.includes("--rules");
const src = (file) => (SRC ? pathToFileURL(resolve(SRC, file)).href : `../../src/${file}`);
const GROUP = 50;

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/" });
for (const key of ["window", "document", "Node", "Element", "HTMLElement", "MutationObserver", "CustomEvent", "Event", "getComputedStyle"]) {
  globalThis[key] = key === "window" ? dom.window : dom.window[key];
}
const log = console.log;
console.log = console.warn = console.error = () => {};

const { default: Sap } = await import(src("sap.js"));
const { eachPainted, stripPaints } = await import(src("ownership.js"));
const doc = dom.window.document;
if (DECLARE) {
  const { declareFacts } = await import(src("registry.js"));
  declareFacts({ name: "grid", file: "grid", order: 5, boundaries: { grid: { opaque: true, on: "table" } }, helpers: ["cell", "range"] });
}
if (RULES) {
  if (!Array.isArray(dom.window.sapPlugins)) dom.window.sapPlugins = [];
  dom.window.sapPlugins.push({
    name: "grid",
    ownership: [
      { within: "table[grid]", select: "td[f]", text: true },
      { within: "table[grid]", select: "td", attrs: ["n"] },
    ],
  });
}

function table(rows, cols) {
  let html = "<table grid>";
  for (let r = 0; r < rows; r++) {
    if (r % GROUP === 0) html += (r ? "</tbody>" : "") + "<tbody>";
    html += `<tr data-id="r${r}">`;
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      html += i % 5 === 0 ? `<td n f="=A1*2">${i * 2}</td>` : i % 2 ? `<td n>${i}</td>` : `<td>cell ${i}</td>`;
    }
    html += "</tr>";
  }
  return html + "</tbody></table>";
}

function page(rows, cols) {
  return `<main sap state="zoom:num" zoom="1">
  <input id="title" bind="title" value="Workbook">
  <section items="sheets">
    <article item data-id="s1"><h2 bind="name">Budget</h2>${table(rows, cols)}</article>
  </section>
  <output id="count" text="state.sheets.length + ' sheet, ' + state.title">1 sheet, Workbook</output>
</main>`;
}

const tick = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

function type(control, value) {
  control.value = value;
  control.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

function build(rows, cols) {
  doc.body.innerHTML = page(rows, cols);
  Sap._reset();
  return doc.querySelector("[sap]");
}

const PHASES = ["mount", "refresh", "edit", "accessor", "eachPainted", "stripPaints"];

async function phases(rows, cols, around) {
  const root = build(rows, cols);
  const title = root.querySelector("#title");
  const article = root.querySelector("article");
  const out = {};
  out.mount = await around(() => Sap.mount(root));
  await tick();
  out.refresh = await around(() => Sap.refresh());
  let n = 0;
  out.edit = await around(async () => {
    type(title, "Workbook " + n++);
    await tick();
  });
  out.accessor = await around(() => Sap(article).name);
  out.eachPainted = await around(() => eachPainted(root, () => {}));
  const clone = root.cloneNode(true);
  out.stripPaints = await around(() => stripPaints(clone));
  out.mountWrites = Sap.status().apps[0].mountWrites;
  out.ok = Sap.status().apps[0].ok;
  return out;
}

function timed(fn) {
  const t0 = performance.now();
  const r = fn();
  if (r && typeof r.then === "function") return r.then(() => performance.now() - t0);
  return performance.now() - t0;
}

async function timings(rows, cols) {
  const samples = Object.fromEntries(PHASES.map((p) => [p, []]));
  let last = null;
  for (let i = 0; i < RUNS; i++) {
    last = await phases(rows, cols, timed);
    for (const p of PHASES) samples[p].push(await last[p]);
  }
  const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
  const out = { cells: rows * cols, mountWrites: last.mountWrites, ok: last.ok };
  for (const p of PHASES) out[p] = Math.round(median(samples[p]) * 100) / 100;
  return out;
}

// How many times a phase made the engine read a table row or cell.
async function touches(rows, cols) {
  const cellsRead = watchCells(dom.window);
  try {
    const result = await phases(rows, cols, (fn) => cellsRead.during(fn));
    const out = { cells: rows * cols };
    for (const p of PHASES) out[p] = await result[p];
    return out;
  } finally {
    cellsRead.stop();
  }
}

const small = [Math.max(GROUP, Math.round(ROWS / 10)), COLS];
const large = [ROWS, COLS];

await timings(...small);
const result = {
  version: Sap.version,
  src: SRC || "src",
  declared: DECLARE,
  rules: RULES,
  node: process.version,
  runs: RUNS,
  ms: { small: await timings(...small), large: await timings(...large) },
  cellReads: { small: await touches(...small), large: await touches(...large) },
};

const pad = (v) => String(v).padStart(12);
log(`sapjs ${result.version} from ${result.src}, grid boundary ${DECLARE ? "declared, plugin absent" : "not declared"}, ownership rules ${RULES ? "on the page" : "absent"}, node ${result.node}, median of ${RUNS} runs, jsdom`);
log("phase".padEnd(14) + pad(`${result.ms.small.cells} ms`) + pad(`${result.ms.large.cells} ms`) + pad("ratio") + pad(`${result.cellReads.small.cells} reads`) + pad(`${result.cellReads.large.cells} reads`));
for (const p of PHASES) {
  const a = result.ms.small[p];
  const b = result.ms.large[p];
  log(p.padEnd(14) + pad(a) + pad(b) + pad(a ? (b / a).toFixed(1) + "x" : "n/a") + pad(result.cellReads.small[p]) + pad(result.cellReads.large[p]));
}
log(`mount writes ${result.ms.large.mountWrites}, ok ${result.ms.large.ok}`);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(result, null, 2) + "\n");
