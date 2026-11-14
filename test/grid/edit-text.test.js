import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { gridModel } from "../../src/grid/codec/read.js";
import { shown, typed } from "../../src/grid/codec/value.js";
import { adoptFmt, contentOf, effectiveFmt } from "../../src/grid/content.js";
import { MAX_SERIAL } from "../../src/grid/dates.js";
import { fmtKind } from "../../src/grid/format.js";
import { editText, parseInput } from "../../src/grid/input.js";
import { rng } from "../grid-codec/support/rng.js";
import { CELLS } from "../grid-codec/support/value-cases.js";

global.__SAP_KEEP_CONSOLE__ = true;

const GOLDEN = join(__dirname, "..", "grid-codec", "golden");
const TODAY = 46095;

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

const same = (a, b) =>
  typeof a === "object" && a !== null ? JSON.stringify(a) === JSON.stringify(b) : Object.is(a, b);

// The law I1: the text the editor shows for content under fmt parses back to content, and the
// format it brings is never taken.
function checkI1(content, fmt) {
  const text = editText(content, fmt, TODAY);
  const back = parseInput(text, { fmt, today: TODAY });
  if (!same(back.content, content)) return { content, fmt, text, back: back.content, why: "content" };
  if (back.fmt !== undefined && adoptFmt(fmt, null, back.fmt) !== undefined) {
    return { content, fmt, text, brought: back.fmt, why: "format" };
  }
  return null;
}

function skips(content, fmt) {
  return fmtKind(fmt) === "text" && typeof content !== "string";
}

test("editor text", () => {
  expect(editText(null)).toBe("");
  expect(editText({ f: "=A1" })).toBe("=A1");
  expect(editText(true)).toBe("TRUE");
  expect(editText(false)).toBe("FALSE");
  expect(editText("hello")).toBe("hello");
  expect(editText("1200")).toBe("'1200");
  expect(editText("TRUE")).toBe("'TRUE");
  expect(editText("=x")).toBe("'=x");
  expect(editText("'abc")).toBe("''abc");
  expect(editText("1200", "@")).toBe("1200");
  expect(editText(" 5 ", "@")).toBe(" 5 ");
  expect(editText(46095, "mmm d, yyyy")).toBe("3/14/2026");
  expect(editText(46095, "mmm d")).toBe("3/14/2026");
  expect(editText(0.5, "h:mm AM/PM")).toBe("12:00:00");
  expect(editText(46095.5, "m/d/yyyy")).toBe("46095.5");
  expect(editText(0.2, "0%")).toBe("20%");
  expect(editText(0.05, "0%")).toBe("5%");
  expect(editText(1200, "$#,##0.00")).toBe("1200");
});

test("law I1 on golden cells", () => {
  const failures = [];
  let checked = 0;
  let failed = 0;
  let atSkips = 0;
  for (const name of readdirSync(GOLDEN).filter((entry) => entry.endsWith(".html"))) {
    const src = readFileSync(join(GOLDEN, name), "utf8");
    for (let at = src.indexOf("<table grid"); at >= 0; at = src.indexOf("<table grid", at + 1)) {
      const sheet = gridModel(src, at);
      for (const row of sheet.rows) {
        for (let index = 0; index < row.cells.length; index++) {
          const content = contentOf(row.cells[index]);
          if (content === null || content === undefined) continue;
          const fmt = effectiveFmt(row.cells[index], sheet.cols[index]);
          if (skips(content, fmt)) {
            atSkips++;
            continue;
          }
          checked++;
          const broken = checkI1(content, fmt);
          if (!broken) continue;
          failed++;
          if (failures.length < 5) failures.push({ file: name, ...broken });
        }
      }
    }
  }
  for (const [label, cell] of CELLS) {
    const content = contentOf(cell);
    if (content === null || content === undefined) continue;
    const fmt = effectiveFmt(cell, null);
    if (skips(content, fmt)) {
      atSkips++;
      continue;
    }
    checked++;
    const broken = checkI1(content, fmt);
    if (!broken) continue;
    failed++;
    if (failures.length < 5) failures.push({ file: label, ...broken });
  }
  console.log(`law I1 golden: checked ${checked}, at-skips ${atSkips}, failures ${failed}`);
  expect(failures).toEqual([]);
  expect(failed).toBe(0);
  expect(checked).toBeGreaterThan(0);
});

function numberSample(random) {
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

// a number whose text under shown() parses back to the very same double, as the N1 generator makes
const stable = (n) => typed(shown(n));

function contentSample(random) {
  const pick = (n) => Math.floor(random() * n);
  switch (pick(7)) {
    case 0:
      return stable(numberSample(random));
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

test("law I1 seeded", () => {
  const random = rng(20261117);
  const pick = (n) => Math.floor(random() * n);
  const failures = [];
  let checked = 0;
  let failed = 0;
  let fallbacks = 0;
  let atSkips = 0;
  for (let i = 0; i < 20000; i++) {
    const content = contentSample(random);
    const fmt = FORMATS[pick(FORMATS.length)];
    const kind = fmtKind(fmt);
    if (skips(content, fmt)) {
      atSkips++;
      continue;
    }
    checked++;
    const text = editText(content, fmt, TODAY);
    if (typeof content === "number" && text === shown(content) &&
      (kind === "date" || kind === "time" || kind === "datetime")) fallbacks++;
    const broken = checkI1(content, fmt);
    if (!broken) continue;
    failed++;
    if (failures.length < 5) failures.push(broken);
  }
  console.log(`law I1 seeded: checked ${checked}, fallbacks ${fallbacks}, at-skips ${atSkips}, failures ${failed}`);
  expect(failures).toEqual([]);
  expect(failed).toBe(0);
  expect(checked).toBeGreaterThan(0);
  expect(fallbacks).toBeGreaterThan(0);
  expect(atSkips).toBeGreaterThan(0);
});
