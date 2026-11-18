// node test/grid/fuzz/csv-fuzz.mjs [--lists N] [--seed S] [--out DIR] [--plant NAME]
// The delimited text fuzz of plan 6.4 (step D9). Each list is two legs. The codec leg writes random
// rows of random fields (quotes, CR, LF and CR LF, every delimiter, a BOM, empty fields, letters
// past ASCII) with a comma, a semicolon, a tab or a bar, and reads them back: the rows come back
// as written, with a BOM before the text too, the delimiter is detected when the fields hold no
// other one, and a quote left open throws the codec's own error. The engine leg fills a sheet with
// random values (numbers, text that starts like a formula or a number, booleans, empty cells, a
// date column), exports it raw with protect, and imports the text into an empty sheet with each
// column typed auto or text: every value comes back as the value rule reads the field written
// for it, and a column typed text keeps its fields as text, less the apostrophe protect put there
// (roundTrip holds both expectations). Prints the per-kind counts and exits 1
// on a failure (a throw is one) or on a count of zero. A failing list is cut down to the fewest
// rows and fields that still fail the same check and written to DIR/csv-fuzz-failure-<seed>.json.
// --plant NAME runs the codec and the Grid from a scratch copy of the project with that mutation
// put back; the checks stay this tree's.
import { JSDOM } from "jsdom";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/" });
for (const key of ["window", "document", "Node", "Element", "HTMLElement", "MutationObserver", "CustomEvent", "Event", "getComputedStyle"]) {
  globalThis[key] = key === "window" ? dom.window : dom.window[key];
}
const log = console.log;
console.log = console.warn = console.error = () => {};

const { rng } = await import("../../grid-codec/support/rng.js");
const { colName } = await import("../../../src/grid/a1.js");
const { shown } = await import("../../../src/grid/codec/value.js");
const { protectField } = await import("../../../src/grid/csv.js");
const { parseInput } = await import("../../../src/grid/input.js");
const { planted } = await import("./plant.mjs");

const NAME = "csv-fuzz";
const TODAY = 46095;
const DELIMITERS = [",", ";", "\t", "|"];
const CHARS = ["a", "b", "Z", "1", " ", ",", ";", "\t", "|", '"', "\n", "\r\n", "\r", "é", "😀", "'", "="];
const STRINGS = ["-5", "-5 units", "=1+1", "+5", "@x", "'Tis", "02134", "a,b", 'say "hi"', "two\nlines", "TRUE", "123", " padded ", "plain", "3/14/2026", "1e5", "50%", "$5"];
const NUMBERS = [-5, 0, 0.1, 1200.5, 46095, -0.25, 123456789012345, 1e21, 3.14159];
const CODEC_KINDS = ["rows", "bom", "quote", "line", "delimiter-in-field", "empty", "detect", "unclosed"];
const ENGINE_KINDS = ["number", "boolean", "empty", "text", "protected", "parsed", "date-column", "text-column"];

function options(argv) {
  const out = { lists: 20000, seed: 1, out: null, plant: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--lists") out.lists = Number(argv[++i]);
    else if (arg === "--seed") out.seed = Number(argv[++i]);
    else if (arg === "--out") out.out = argv[++i];
    else if (arg === "--plant") out.plant = argv[++i];
    else {
      log(`unknown option ${arg}`);
      process.exit(2);
    }
  }
  return out;
}

const pick = (random, list) => list[Math.floor(random() * list.length)];
const stable = (value) => JSON.stringify(value);

// One list's data: the rows of the codec leg and the block of the engine leg. The block's last row
// and last column each hold a value, so a grow paste makes the sheet the block's size.
function generate(random) {
  const width = 1 + Math.floor(random() * 5);
  const height = 1 + Math.floor(random() * 6);
  const rows = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => {
      if (random() < 0.15) return "";
      return Array.from({ length: 1 + Math.floor(random() * 5) }, () => pick(random, CHARS)).join("");
    }),
  );
  if (random() < 0.15) rows[0][0] = "﻿" + rows[0][0];
  const cols = 1 + Math.floor(random() * 4);
  const block = Array.from({ length: 1 + Math.floor(random() * 5) }, () =>
    Array.from({ length: cols }, () => {
      const roll = random();
      if (roll < 0.35) return pick(random, NUMBERS);
      if (roll < 0.45) return random() < 0.5;
      if (roll < 0.55) return null;
      return pick(random, STRINGS);
    }),
  );
  const last = block.length - 1;
  if (block[last].every((value) => value === null)) block[last][0] = pick(random, NUMBERS);
  if (block.every((line) => line[cols - 1] === null)) block[0][cols - 1] = pick(random, STRINGS);
  return {
    rows,
    delimiter: pick(random, DELIMITERS),
    eol: random() < 0.7 ? "\r\n" : "\n",
    bom: random() < 0.2,
    block,
    dates: Array.from({ length: cols }, () => random() < 0.2),
    types: Array.from({ length: cols }, () => (random() < 0.3 ? "text" : "auto")),
  };
}

const opts = options(process.argv.slice(2));

let root = null;
try {
  if (opts.plant) root = planted(opts.plant);
  const base = root ? pathToFileURL(join(root, "src/grid/")).href : new URL("../../../src/grid/", import.meta.url).href;
  const load = (file) => import(base + file);
  const [csv, grid] = await Promise.all([load("csv.js"), load("grid.js")]);
  const engine = { ...csv, createGrid: grid.createGrid };

  const counts = {};
  const random = rng(opts.seed);
  let first = null;
  const started = Date.now();
  for (let index = 0; index < opts.lists && first === null; index++) {
    const seed = Math.floor(random() * 4294967296);
    const data = generate(rng(seed));
    const failure = runList(engine, data, counts);
    if (failure !== null) first = { list: index, seed, data, failure };
  }

  if (first !== null) {
    let data = first.data;
    let cut = true;
    const tries = (one) => {
      const again = runList(engine, one, null);
      return again !== null && again.check === first.failure.check;
    };
    while (cut) {
      cut = false;
      for (const key of ["rows", "block"]) {
        for (let at = data[key].length - 1; at >= 0 && !cut; at--) {
          if (data[key].length < 2) break;
          const candidate = { ...data, [key]: data[key].slice(0, at).concat(data[key].slice(at + 1)) };
          if (tries(candidate)) {
            data = candidate;
            cut = true;
          }
        }
        const width = data[key][0]?.length ?? 0;
        for (let at = width - 1; at >= 0 && !cut && width > 1; at--) {
          const without = (list) => list.slice(0, at).concat(list.slice(at + 1));
          const candidate = { ...data, [key]: data[key].map(without), ...(key === "block" ? { dates: without(data.dates), types: without(data.types) } : {}) };
          if (tries(candidate)) {
            data = candidate;
            cut = true;
          }
        }
      }
    }
    const last = runList(engine, data, null) ?? first.failure;
    log(`${last.check}, list ${first.list}, seed ${first.seed}`);
    log(`  data ${JSON.stringify(data)}`);
    log(`  detail ${JSON.stringify(last.detail)}`);
    if (opts.out) {
      mkdirSync(opts.out, { recursive: true });
      const file = join(opts.out, `${NAME}-failure-${first.seed}.json`);
      writeFileSync(file, JSON.stringify({ seed: first.seed, list: first.list, check: last.check, detail: last.detail, data }, null, 2) + "\n");
      log(`failure written to ${file}`);
    }
  }

  for (const kind of CODEC_KINDS) log(`codec ${kind}: ${counts[kind] ?? 0}`);
  for (const delimiter of DELIMITERS) log(`codec delimiter ${JSON.stringify(delimiter)}: ${counts[`delimiter ${delimiter}`] ?? 0}`);
  for (const kind of ENGINE_KINDS) log(`engine ${kind}: ${counts[`engine ${kind}`] ?? 0}`);
  log(`lists ${opts.lists}, failures ${first === null ? 0 : 1}, ${Date.now() - started} ms`);
  const zero = [...CODEC_KINDS, ...DELIMITERS.map((one) => `delimiter ${one}`), ...ENGINE_KINDS.map((one) => `engine ${one}`)].some((kind) => (counts[kind] ?? 0) === 0);
  if (zero) log("one of the counts is zero");
  process.exitCode = first !== null || zero ? 1 : 0;
} finally {
  if (root) rmSync(root, { recursive: true, force: true });
}

// Both legs of one list. Returns the first failure or null; a throw is a failure.
function runList(engine, data, counts) {
  try {
    return listChecks(engine, data, counts);
  } catch (error) {
    return { check: "no step throws", detail: String(error?.stack ?? error).split("\n").slice(0, 4).join(" | ") };
  }
}

// The field an export with `protect` writes for a value, and the content an import into a column
// of this type ("auto" or "text") reads from it: typed input for "auto", the field kept as text for
// "text", without the apostrophe the export put before it (one protectField would put there).
function roundTrip(value, type) {
  const raw = value === null ? "" : typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : typeof value === "number" ? shown(value) : value;
  const field = typeof value === "string" ? protectField(raw) : raw;
  if (type !== "text") return { raw, field, want: parseInput(field, { today: TODAY }).content };
  const kept = field.startsWith("'") && protectField(field.slice(1)) === field ? field.slice(1) : field;
  return { raw, field, want: parseInput(kept, { fmt: "@" }).content };
}

function listChecks(engine, data, counts) {
  const tally = (kind) => {
    if (counts !== null) counts[kind] = (counts[kind] ?? 0) + 1;
  };
  const fail = (check, detail) => ({ check, detail });
  const { rows, delimiter, eol, bom, block, dates, types } = data;

  const text = engine.writeDelimited(rows, { delimiter, eol });
  tally("rows");
  tally(`delimiter ${delimiter}`);
  const fields = rows.flat();
  if (fields.some((field) => field.includes('"'))) tally("quote");
  if (fields.some((field) => /[\r\n]/.test(field))) tally("line");
  if (fields.some((field) => /[,;\t|]/.test(field))) tally("delimiter-in-field");
  if (fields.some((field) => field === "")) tally("empty");
  const back = engine.parseDelimited(bom ? "﻿" + text : text, { delimiter });
  if (bom) tally("bom");
  if (stable(back) !== stable(rows)) return fail("delimited rows read back as written", { text, back, rows });
  if (delimiter !== "|" && rows[0].length > 1 && fields.every((field) => !/[,;\t]/.test(field))) {
    tally("detect");
    const detected = engine.parseDelimited(text);
    if (stable(detected) !== stable(rows)) return fail("the delimiter is detected when the fields hold no other one", { text, detected });
  }
  try {
    engine.parseDelimited(`${text}${eol}"open`, { delimiter });
    return fail("a quote left open throws", { text });
  } catch (error) {
    if (error?.name !== "DelimitedError" || error.code !== "unterminated-quote") return fail("a quote left open throws the codec's own error", String(error));
    tally("unclosed");
  }

  document.body.innerHTML = '<table grid><colgroup><col data-id="ca" data-pos="V"></colgroup><tbody><tr data-id="r1" data-pos="V"></tr></tbody></table><table grid><colgroup><col data-id="cb" data-pos="V"></colgroup><tbody><tr data-id="r2" data-pos="V"></tr></tbody></table>';
  const [from, to] = Array.from(document.querySelectorAll("table"), (table) => engine.createGrid(table, { today: () => TODAY }));
  from.setRange("A1", block, { detect: false, grow: true });
  dates.forEach((date, c) => {
    if (date) from.format(`${colName(c)}:${colName(c)}`, { fmt: "m/d/yyyy" });
  });
  const exported = from.toDelimited(`A1:${colName(block[0].length - 1)}${block.length}`, { delimiter, values: "raw", protect: true });
  to.importDelimited(exported, "A1", { delimiter, types });

  const wrong = [];
  block.forEach((line, r) => {
    line.forEach((item, c) => {
      const ref = `${colName(c)}${r + 1}`;
      const value = from.get(ref);
      const { raw, field, want } = roundTrip(value, types[c]);
      tally(`engine ${value === null ? "empty" : typeof value === "string" ? "text" : typeof value}`);
      if (typeof value === "string" && field !== raw) tally("engine protected");
      if (typeof value === "string" && types[c] !== "text" && want !== value) tally("engine parsed");
      if (dates[c] && typeof value === "number") tally("engine date-column");
      if (types[c] === "text" && value !== null) tally("engine text-column");
      const got = to.get(ref);
      if (stable(got) !== stable(want ?? null)) wrong.push({ ref, value, field, got, want: want ?? null, type: types[c] });
    });
  });
  if (wrong.length > 0) return fail("an export then an import gives each value as its field reads", { exported, wrong: wrong.slice(0, 4) });
  return null;
}
