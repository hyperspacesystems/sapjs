// node test/mutations/grid-format.mjs [dates-century|clock-carry|format-round|format-negzero|format-carry|format-percent-shift|format-date-range|format-ampm-noon|derive-v|derive-t|derive-n|adopt-same-kind|adopt-column-equal|input-digits|input-zero|input-groups|input-percent-shift|input-at|input-trim|input-surrogate|input-date-real|input-pivot|edit-apostrophe|edit-fallback|input-time-stored]
// Each entry puts one bug back into the grid's date arithmetic, number formats, cell content or
// typed input and names the test that must then fail. With no argument every entry runs, one after
// another.
import { pathToFileURL } from "node:url";

import { mutate } from "./harness.mjs";

const DATES = "src/grid/dates.js";
const DATE_TEST = "test/grid/dates.test.js";
const NUMBER = "src/grid/format.js";
const NUMBER_TEST = "test/grid/format-number.test.js";
const DATE_CODE_TEST = "test/grid/format-date.test.js";
const CONTENT = "src/grid/content.js";
const CONTENT_TEST = "test/grid/content.test.js";
const INPUT = "src/grid/input.js";
const INPUT_TEST = "test/grid/input.test.js";
const DATE_INPUT_TEST = "test/grid/input-date.test.js";
const EDIT_TEST = "test/grid/edit-text.test.js";

const dates = (what, find, replace, name, expects) => ({ what, file: DATES, find, replace, test: DATE_TEST, name, expects });
const format = (what, find, replace, name, expects) => ({ what, file: NUMBER, find, replace, test: NUMBER_TEST, name, expects });
const dateCode = (what, find, replace, name, expects) => ({ what, file: NUMBER, find, replace, test: DATE_CODE_TEST, name, expects });
const content = (what, find, replace, name, expects) => ({ what, file: CONTENT, find, replace, test: CONTENT_TEST, name, expects });
const input = (what, find, replace, name, expects) => ({ what, file: INPUT, find, replace, test: INPUT_TEST, name, expects });
const dateInput = (what, find, replace, name, expects) => ({ what, file: INPUT, find, replace, test: DATE_INPUT_TEST, name, expects });
const edit = (what, find, replace, name, expects) => ({ what, file: INPUT, find, replace, test: EDIT_TEST, name, expects });

export const MUTATIONS = {
  "dates-century": dates(
    "1900 counts as a leap year",
    "(y % 100 !== 0 || y % 400 === 0)",
    "true",
    "month lengths",
    /toBe|toEqual/,
  ),
  "clock-carry": dates(
    "86400 seconds does not carry into the next day",
    "  const carry = Math.floor(secs / 86400);\n",
    "  const carry = 0;\n",
    "clock carry",
    /toEqual|toBe/,
  ),
  "format-round": format(
    "rounding uses the float",
    "const rounded = roundDigits(intPart, fracPart, places);",
    "const rounded = ((n) => { const [i, f = \"\"] = n.toFixed(places).split(\".\"); return { int: i, frac: f }; })(Number(magnitude));",
    "pinned number cases",
    /toBe|toEqual/,
  ),
  "format-negzero": format(
    "a result of all zeros keeps the minus",
    "const sign = negative && !blank ? \"-\" : \"\";",
    "const sign = negative ? \"-\" : \"\";",
    "pinned number cases",
    /toEqual|toBe/,
  ),
  "format-carry": format(
    "grouping uses the integer digits from before rounding",
    "const int = rounded.int.replace(",
    "const int = intPart.replace(",
    "pinned number cases",
    /toBe|toEqual/,
  ),
  "format-percent-shift": format(
    "the percent shift goes through Number(text) * 100",
    "  const [whole, fraction = \"\"] = text.split(\".\");\n  const padded = fraction.padEnd(2, \"0\");\n  return `${whole + padded.slice(0, 2)}.${padded.slice(2)}`;",
    "  return String(Number(text) * 100);",
    "pinned number cases",
    /toEqual|toBe/,
  ),
  "format-date-range": dateCode(
    "the date range keeps no lower bound",
    "if (c.day < 1 || c.day > MAX_SERIAL) return null;",
    "if (c.day > MAX_SERIAL) return null;",
    "out of range is null",
    /toBe|toEqual/,
  ),
  "format-ampm-noon": dateCode(
    "noon reads as AM",
    "const half = c.h < 12 ? \"AM\" : \"PM\";",
    "const half = c.h <= 12 ? \"AM\" : \"PM\";",
    "midnight and noon in AM/PM",
    /toBe|toEqual/,
  ),
  "derive-v": content(
    "v is always written for a number",
    "if (cell.text !== raw) cell.v = raw;",
    "cell.v = raw;",
    "pinned cells",
    /toBe|toEqual/,
  ),
  "derive-t": content(
    "t is never written",
    "{ text: content, t: true }",
    "{ text: content }",
    "pinned cells",
    /toBe|toEqual/,
  ),
  "derive-n": content(
    "n is not written",
    "raw, n: true };",
    "raw };",
    "pinned cells",
    /toBe|toEqual/,
  ),
  "adopt-same-kind": content(
    "the same-kind check is removed",
    " || fmtKind(effective) !== fmtKind(brought)",
    "",
    "adopting a typed format",
    /toBe|toEqual/,
  ),
  "adopt-column-equal": content(
    "the equal-to-column check is removed",
    "brought === columnFmt ? null : brought",
    "brought",
    "adopting a typed format",
    /toBe|toEqual/,
  ),
  "input-digits": input(
    "the 15 significant digit limit is dropped",
    "if (significantDigits(digits) > MAX_DIGITS) return null;",
    "if (false) return null;",
    "input: stays text",
    /toBe|toEqual/,
  ),
  "input-zero": input(
    "a leading zero is accepted on an integer part",
    "[1-9][0-9]*",
    "[0-9]+",
    "input: stays text",
    /toBe|toEqual/,
  ),
  "input-groups": input(
    "groups of any size are accepted",
    "(?:,[0-9]{3})+",
    "(?:,[0-9]+)+",
    "input: stays text",
    /toBe|toEqual/,
  ),
  "input-percent-shift": input(
    "the percent shift goes through Number(text) / 100",
    '  const moved = padded.slice(0, -2) || "0";\n  return moved + "." + padded.slice(-2) + fraction;',
    "  return String(Number(digits) / 100);",
    "input: percent",
    /toBe|toEqual/,
  ),
  "input-at": input(
    "the @ rule is removed, so numbers are detected under a text format",
    '  if (fmtKind(fmt) === "text") return { content: cleaned };',
    "",
    "input: plain text format",
    /toBe|toEqual/,
  ),
  "input-trim": input(
    "text is stored trimmed",
    "  if (moment) return moment;\n  return { content: cleaned };",
    "  if (moment) return moment;\n  return { content: trimmed };",
    "input: stays text",
    /toBe|toEqual/,
  ),
  "input-surrogate": input(
    "lone surrogates are kept",
    '.replace(LONE_SURROGATE, "\\uFFFD")',
    "",
    "input: cleanup",
    /toBe|toEqual/,
  ),
  "input-date-real": dateInput(
    "a day up to 31 is accepted in any month",
    "  const value = serial(year, month, day);",
    "  const value = serial(year, month, Math.min(day, 28));",
    "not a date",
    /toBe|toEqual/,
  ),
  "input-pivot": dateInput(
    "the two-digit year pivot moves, so 29 reads as 30",
    "return yy <= 29 ? 2000 + yy : 1900 + yy;",
    "return yy <= 30 ? 2000 + yy : 1900 + yy;",
    "two-digit years",
    /toBe|toEqual/,
  ),
  "edit-apostrophe": edit(
    "text never gets the apostrophe",
    "return parseInput(content, { fmt, today }).content === content ? content : \"'\" + content;",
    "return content;",
    "editor text",
    /toBe|toEqual/,
  ),
  "edit-fallback": edit(
    "the fallback to shown(x) is removed",
    "if (pretty === null || parseInput(pretty, { fmt, today }).content !== content) return shown(content);",
    "",
    "editor text",
    /toBe|toEqual/,
  ),
  "input-time-stored": dateInput(
    "a typed time keeps the raw binary fraction instead of the saved 15 digit value",
    "if (time) return { ...time, content: stored(time.content) };",
    "if (time) return time;",
    "typed times keep the saved value",
    /toBe|toEqual/,
  ),
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) mutate(MUTATIONS);
