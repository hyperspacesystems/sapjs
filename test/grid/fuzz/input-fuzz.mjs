// node test/grid/fuzz/input-fuzz.mjs [--count N] [--seed S] [--out DIR] [--plant NAME] [count] [seed]
// Part (a) types strings a person types - numbers in every form, dates, times, booleans, formulas
// and free text - into parseInput under every format, and checks that it never throws, that what it
// returns is content the editor can show and the file can hold, that derive accepts it, and that the
// canonical writer's bytes read back with the strict reader as the same content.
// Part (b) draws content and checks the editor law I1: the text the editor shows for content under
// fmt parses back to content, and the format it brings is never taken.
// Prints one counts line per part and exits 1 on any failure or any count of zero.
// today is 46095, so "3/14" and "Mar 14" read as that day.
// --plant NAME runs the same checks against a scratch copy of the project with that entry of
// test/mutations/grid-format.mjs put back, so the fuzzer can be shown able to fail.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { rng } from "../../grid-codec/support/rng.js";
import { planted } from "./plant.mjs";

const TODAY = 46095;
const NAME = "input-fuzz";

const CODES = [
  "m/d/yyyy",
  "yyyy-mm-dd",
  "mmm d, yyyy",
  "mmmm d, yyyy",
  "mmm d",
  "h:mm",
  "h:mm:ss",
  "h:mm AM/PM",
  "h:mm:ss AM/PM",
  "m/d/yyyy h:mm",
  "m/d/yyyy h:mm:ss",
];

const FORMATS = [
  null,
  "0",
  "0.00",
  "0.000",
  "#,##0",
  "#,##0.00",
  "#,##0.00000",
  "$#,##0",
  "$#,##0.00",
  "0%",
  "0.00%",
  "@",
  ...CODES,
];

const WORDS = ["abc", "hello world", "  a  ", "a<b", 'quote "x"', "line\nbreak", "Rent"];

const INPUT_TEXTS = ["1200", "TRUE", "'x", "=x", "3/14/2026", " 5 ", "12:30", "007", "1,200", "1e5", "+5"];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const FREE = [
  "a<b",
  "a&b",
  'quote "x"',
  "line\nbreak",
  "a\r\nb",
  "a\rb",
  "a\0b",
  "a\uD800b",
  "\uDC00",
  "two\nlines\r\nand\0nul",
  "  a  ",
  "<td>",
  "&amp;",
  "a'b",
  "x\uD83D\uDE00y",
];

let stable = null;
let MAX_SERIAL = 0;

const same = (a, b) =>
  typeof a === "object" && a !== null ? JSON.stringify(a) === JSON.stringify(b) : Object.is(a, b);

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

function numberSample(random) {
  const pick = (n) => Math.floor(random() * n);
  const digits = (n, first = 1 + pick(9)) => {
    let text = String(first);
    for (let i = 1; i < n; i++) text += String(pick(10));
    return text;
  };
  const ornaments = (body) => {
    let text = body;
    if (random() < 0.2) text = "-" + text;
    if (random() < 0.15) text = (random() < 0.5 ? "-$" : "$-").replace("-", text.startsWith("-") ? "" : "-") + text;
    if (random() < 0.2) text = "$" + text;
    if (random() < 0.2) text += "%";
    return text;
  };
  switch (pick(8)) {
    case 0:
      return ornaments(digits(1 + pick(9)));
    case 1: {
      let whole = String(1 + pick(9)) + String(pick(10)) + String(pick(10));
      const groups = 1 + pick(3);
      for (let i = 0; i < groups; i++) whole += "," + String(pick(1000)).padStart(3, "0");
      const fraction = random() < 0.5 ? "." + String(pick(1000)).padStart(3, "0") : "";
      return ornaments(whole + fraction);
    }
    case 2:
      return ornaments(digits(1 + pick(12)) + "." + digits(1 + pick(12), pick(10)));
    case 3:
      return ornaments("0." + "0".repeat(pick(8)) + digits(1 + pick(8)));
    case 4:
      return ornaments("0".repeat(1 + pick(3)) + digits(1 + pick(6)));
    case 5: {
      const count = random() < 0.5 ? 15 : 16;
      return ornaments(digits(count, 1 + pick(9)));
    }
    case 6: {
      const count = 300 + pick(101);
      let body = digits(count, 1 + pick(9));
      return ornaments(body);
    }
    default:
      return ornaments("0." + "0".repeat(300 + pick(101)) + digits(1 + pick(9)));
  }
}

function monthName(random) {
  const pick = (n) => Math.floor(random() * n);
  const name = MONTHS[pick(MONTHS.length)];
  const short = random() < 0.5 ? name.slice(0, 3) : name;
  switch (pick(4)) {
    case 0:
      return short;
    case 1:
      return short.toLowerCase();
    case 2:
      return short.toUpperCase();
    default:
      return short.split("").map((c) => (random() < 0.5 ? c.toLowerCase() : c.toUpperCase())).join("");
  }
}

function yearSample(random) {
  const pick = (n) => Math.floor(random() * n);
  switch (pick(3)) {
    case 0:
      return String(pick(100)).padStart(2, "0");
    case 1:
      return String(1970 + pick(130));
    default:
      return String(pick(10000)).padStart(4, "0");
  }
}

function dateSample(random) {
  const pick = (n) => Math.floor(random() * n);
  const month = String(1 + pick(13));
  const day = String(1 + pick(35));
  const year = yearSample(random);
  switch (pick(9)) {
    case 0:
      return `${month}/${day}/${year}`;
    case 1:
      return `${month}-${day}-${year}`;
    case 2:
      return `${String(1 + pick(9999)).padStart(4, "0")}-${String(1 + pick(12))}-${String(1 + pick(31))}`;
    case 3:
      return `${monthName(random)} ${day}, ${year}`;
    case 4:
      return `${monthName(random)} ${day} ${year}`;
    case 5:
      return `${monthName(random)} ${day}`;
    case 6:
      return `${day} ${monthName(random)} ${year}`;
    case 7:
      return `${String(1 + pick(13))}/${String(1 + pick(35))}`;
    default:
      return `${month}/${day}/${year}`;
  }
}

function timeSample(random) {
  const pick = (n) => Math.floor(random() * n);
  const half = random() < 0.5;
  const hour = half ? 1 + pick(12) : pick(24);
  const minute = String(pick(random() < 0.9 ? 60 : 61)).padStart(2, "0");
  const second = String(pick(random() < 0.9 ? 60 : 61)).padStart(2, "0");
  const ampm = ["AM", "PM", "am", "pm"][pick(4)];
  switch (pick(4)) {
    case 0:
      return `${hour}:${minute}`;
    case 1:
      return `${hour}:${minute}:${second}`;
    case 2:
      return `${hour}:${minute} ${ampm}`;
    default:
      return `${hour}:${minute}:${second} ${ampm}`;
  }
}

function booleanSample(random) {
  const pick = (n) => Math.floor(random() * n);
  const word = random() < 0.5 ? "true" : "false";
  switch (pick(3)) {
    case 0:
      return word;
    case 1:
      return word.toUpperCase();
    default:
      return word.split("").map((c) => (random() < 0.5 ? c.toUpperCase() : c)).join("");
  }
}

function formulaSample(random) {
  const pick = (n) => Math.floor(random() * n);
  const bodies = ["A1", "SUM(A1:A3)", " 1", "=B2*2", 'IF(A1>0,"y","n")'];
  switch (pick(4)) {
    case 0:
      return "=" + bodies[pick(bodies.length)];
    case 1:
      return "=";
    case 2:
      return "'" + ["x", "123", "=A1", "'y", "<b>&"][pick(5)];
    default:
      return "'";
  }
}

function freeSample(random) {
  const pick = (n) => Math.floor(random() * n);
  if (random() < 0.5) return FREE[pick(FREE.length)];
  const alphabet = "ab XY019<>&\"\n\r\t-$%.:/'\\\0";
  let text = "";
  for (let i = 0, n = 1 + pick(12); i < n; i++) text += alphabet[pick(alphabet.length)];
  return text;
}

function typedSample(random) {
  const pick = (n) => Math.floor(random() * n);
  let text;
  switch (pick(12)) {
    case 0:
    case 1:
      text = numberSample(random);
      break;
    case 2:
    case 3:
      text = dateSample(random);
      break;
    case 4:
    case 5:
      text = timeSample(random);
      break;
    case 6:
      text = dateSample(random) + " " + timeSample(random);
      break;
    case 7:
      text = booleanSample(random);
      break;
    case 8:
      text = formulaSample(random);
      break;
    case 9:
      text = freeSample(random);
      break;
    case 10:
      text = WORDS[pick(WORDS.length)];
      break;
    default:
      text = random() < 0.5 ? "" : INPUT_TEXTS[pick(INPUT_TEXTS.length)];
      break;
  }
  if (random() < 0.2) {
    const pad = [" ", "\t", "  ", " \t"][pick(4)];
    if (random() < 0.5) text = pad + text;
    if (random() < 0.5) text = text + pad;
  }
  return text;
}

function contentSample(random) {
  const pick = (n) => Math.floor(random() * n);
  switch (pick(7)) {
    case 0:
      return stable(numberValue(random));
    case 1:
      return stable(2 + pick(MAX_SERIAL - 1));
    case 2:
      return stable(2 + pick(MAX_SERIAL - 1) + random());
    case 3:
      return stable(random());
    case 4:
      return random() < 0.5;
    case 5:
      return stringSample(random);
    default:
      return { f: "=A1+" + pick(1000) };
  }
}

function numberValue(random) {
  const pick = (n) => Math.floor(random() * n);
  const sign = random() < 0.5 ? -1 : 1;
  switch (pick(4)) {
    case 0:
      return sign * pick(1000000);
    case 1: {
      const count = 1 + pick(15);
      let digits = String(1 + pick(9));
      for (let i = 1; i < count; i++) digits += String(pick(10));
      return sign * Number(`${digits[0]}.${digits.slice(1)}e${pick(32) - 10}`);
    }
    case 2:
      return sign * Number(`${pick(100000)}.${String(pick(10000)).padStart(4, "0")}`);
    default:
      return sign * Number(`${pick(1000)}.${String(pick(1000)).padStart(3, "0")}5`);
  }
}

function stringSample(random) {
  const pick = (n) => Math.floor(random() * n);
  switch (pick(3)) {
    case 0:
      return WORDS[pick(WORDS.length)];
    case 1:
      return INPUT_TEXTS[pick(INPUT_TEXTS.length)];
    default: {
      const length = 1 + pick(12);
      const alphabet = "ab XY019_<>&\"\n-$%.:/";
      let text = "";
      for (let i = 0; i < length; i++) text += alphabet[pick(alphabet.length)];
      return text;
    }
  }
}

const opts = options(process.argv.slice(2), 1000000);
const seed = opts.seed;
const count = opts.count;

let root = null;
let dir = null;
try {
  if (opts.plant) {
    root = planted(opts.plant);
    dir = root;
  }
  const base = dir ? pathToFileURL(join(dir, "src/grid/")).href : new URL("../../../src/grid/", import.meta.url).href;
  const load = (file) => import(base + file);
  const [{ shown, typed }, { adoptFmt, contentOf, derive }, dates, { fmtKind }, { editText, parseInput }, { cellHtml }, { scanGrid }] =
    await Promise.all([
      load("codec/value.js"),
      load("content.js"),
      load("dates.js"),
      load("format.js"),
      load("input.js"),
      load("codec/write.js"),
      load("codec/scan.js"),
    ]);
  ({ MAX_SERIAL } = dates);
  stable = (x) => typed(shown(x));

  const random = rng(seed);
  const pick = (n) => Math.floor(random() * n);
  const first = { part: null, index: null, input: null, format: null, error: null };
  let typedFailureCount = 0;
  let lawFailureCount = 0;
  const kinds = { null: 0, number: 0, boolean: 0, text: 0, formula: 0 };
  const BROUGHT = ["number", "currency", "percent", "date", "time", "datetime"];
  const brought = Object.fromEntries(BROUGHT.map((kind) => [kind, 0]));

  const note = (part, index, input, fmt, why) => {
    if (part === "typed") typedFailureCount++;
    else lawFailureCount++;
    if (first.part === null) Object.assign(first, { part, index, input, format: fmt, error: why });
    if (typedFailureCount + lawFailureCount <= 5) {
      console.log(`${part} failure ${index}: ${why}`);
      console.log(`  input ${JSON.stringify(input)} under format ${JSON.stringify(fmt)}`);
    }
  };

  const contentProblem = (content) => {
    if (content === null) return null;
    if (typeof content === "number") {
      if (!Number.isFinite(content)) return `number ${content} is not finite`;
      return typed(shown(content)) === content ? null : `number ${content} does not read back as ${shown(content)}`;
    }
    if (typeof content === "boolean") return null;
    if (typeof content === "string") {
      if (/[\r\0]/.test(content)) return `text ${JSON.stringify(content)} holds a carriage return or NUL`;
      return null;
    }
    if (content !== null && typeof content === "object" && typeof content.f === "string") return null;
    return `content ${JSON.stringify(content)} is not null, a number, a boolean, text or a formula`;
  };

  const readBack = (content) => {
    const cell = derive(content, null);
    const html = cellHtml(cell);
    const src = `<table grid><tbody><tr data-id="r1" data-pos="G">${html}<td>x</td></tr></tbody></table>`;
    const rows = [];
    scanGrid(src, 0, { row: (row) => rows.push(row) });
    return contentOf(rows[0].cells[0]);
  };

  // (a) strings a person types
  let typedChecked = 0;
  for (let i = 0; i < count; i++) {
    const input = typedSample(random);
    const fmt = FORMATS[pick(FORMATS.length)];
    typedChecked++;
    let back;
    try {
      back = parseInput(input, { fmt, today: TODAY });
    } catch (error) {
      note("typed", i, input, fmt, `parseInput threw ${error.message}`);
      continue;
    }
    const content = back.content;
    if (typeof back.fmt === "string") {
      const kind = fmtKind(back.fmt);
      brought[kind] = (brought[kind] ?? 0) + 1;
    }
    if (content === null) kinds.null++;
    else if (typeof content === "number") kinds.number++;
    else if (typeof content === "boolean") kinds.boolean++;
    else if (typeof content === "string") kinds.text++;
    else if (content !== null && typeof content === "object" && typeof content.f === "string") kinds.formula++;
    const problem = contentProblem(content);
    if (problem) {
      note("typed", i, input, fmt, `content: ${problem}`);
      continue;
    }
    const adopted = typeof back.fmt === "string" ? adoptFmt(fmt, null, back.fmt) : null;
    const effective = typeof adopted === "string" ? adopted : fmt;
    let cell;
    try {
      cell = derive(content, effective);
    } catch (error) {
      note("typed", i, input, fmt, `derive threw ${error.message} for adopted ${JSON.stringify(effective)}`);
      continue;
    }
    let got;
    try {
      got = readBack(content);
    } catch (error) {
      note("typed", i, input, fmt, `writing and reading back threw ${error.message}`);
      continue;
    }
    if (!same(got, content)) {
      note("typed", i, input, fmt, `read back ${JSON.stringify(got)} instead of the content ${JSON.stringify(content)}`);
    }
  }
  const broughtTotal = Object.values(brought).reduce((sum, n) => sum + n, 0);
  const broughtKinds = BROUGHT.map((kind) => `${kind} ${brought[kind]}`).join(", ");
  console.log(`typed: checked ${typedChecked}, null ${kinds.null}, number ${kinds.number}, boolean ${kinds.boolean}, text ${kinds.text}, formula ${kinds.formula}, brought ${broughtTotal}, failures ${typedFailureCount}`);
  console.log(`typed brought: ${broughtKinds}`);

  // (b) the editor law
  let checked = 0;
  let fallbacks = 0;
  let atSkips = 0;
  for (let i = 0; i < count; i++) {
    const content = contentSample(random);
    const fmt = FORMATS[pick(FORMATS.length)];
    const kind = fmtKind(fmt);
    if (kind === "text" && typeof content !== "string") {
      atSkips++;
      continue;
    }
    checked++;
    const text = editText(content, fmt, TODAY);
    if (typeof content === "number" && text === shown(content) &&
      (kind === "date" || kind === "time" || kind === "datetime")) fallbacks++;
    const back = parseInput(text, { fmt, today: TODAY });
    const broken = !same(back.content, content) ||
      (back.fmt !== undefined && adoptFmt(fmt, null, back.fmt) !== undefined);
    if (!broken) continue;
    note("law", i, text, fmt, `editor text parses to ${JSON.stringify(back.content)} and brings ${JSON.stringify(back.fmt)} instead of the content ${JSON.stringify(content)}`);
  }
  console.log(`law: checked ${checked}, fallbacks ${fallbacks}, at-skips ${atSkips}, failures ${lawFailureCount}`);

  const failures = typedFailureCount + lawFailureCount;
  if (failures > 0 && opts.out) {
    mkdirSync(opts.out, { recursive: true });
    const file = join(opts.out, `${NAME}-failure-${seed}.json`);
    writeFileSync(file, JSON.stringify({ seed, ...first }, null, 2) + "\n");
    console.log(`failure written to ${file}`);
  }
  const zero = typedChecked === 0 || Object.values(kinds).some((n) => n === 0) || broughtTotal === 0 ||
    BROUGHT.some((kind) => brought[kind] === 0) || checked === 0 || fallbacks === 0 || atSkips === 0;
  if (failures > 0) console.log(`${failures} failure(s)`);
  if (zero) console.log("one of the counts is zero");
  process.exitCode = failures > 0 || zero ? 1 : 0;
} finally {
  if (root) rmSync(root, { recursive: true, force: true });
}
