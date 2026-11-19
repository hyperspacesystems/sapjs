// The text functions, as Google Sheets computes them. Positions count from 1; a count or position
// out of range is #VALUE!. TEXT draws through the grid's own formats and knows a few more codes
// (day names, two-digit years, zero padding).
import { formatValue } from "../format.js";
import { parseInput } from "../input.js";
import { civil, clock } from "../dates.js";
import { error, isBlank, isError, isRange, single, toBool, toNumber, toText, wildcardSource } from "./values.js";

const text = (value) => toText(single(value));

// Positions and lengths count characters, never UTF-16 halves, so LEFT of "🟢 Done" is "🟢" and
// no half of an emoji is ever written into a cell.
const chars = (s) => Array.from(s);
const slice = (s, from, to) => chars(s).slice(from, to).join("");

const count = (value) => {
  const number = toNumber(single(value));
  return isError(number) ? number : Math.trunc(number);
};

// Every value of the arguments in order, a range's cells row by row; the first error stops it.
function each(args, visit) {
  for (const arg of args) {
    if (isRange(arg)) {
      let failure = null;
      arg.forEach((value) => {
        if (failure === null && isError(value)) failure = value;
        if (failure === null) visit(value);
      });
      if (failure !== null) return failure;
    } else if (isError(arg)) return arg;
    else visit(arg);
  }
  return null;
}

function joined(args) {
  let out = "";
  const failure = each(args, (value) => {
    out += toText(value);
  });
  return failure ?? out;
}

// Arguments read with `read`, the first error returned instead of calling `body`.
const call = (min, max, reads, body) => ({
  run(args) {
    if (args.length < min || args.length > max) return error("#N/A");
    const values = [];
    for (let i = 0; i < args.length; i++) {
      const value = reads[i](args[i]);
      if (isError(value)) return value;
      values.push(value);
    }
    return body(...values);
  },
});

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n, width) => String(n).padStart(width, "0");

// A date and time code the grid's formats do not know: tokens yyyy yy mmmm mmm mm m dddd ddd dd d
// hh h ss s AM/PM, the elapsed totals [h] [m] [s] (a timesheet's 37:30), text in double quotes,
// and \ before one character. An m after an h, or before an s, is minutes. Null for a code with
// none of these tokens.
function dateCode(value, fmt) {
  const tokens = fmt.match(/"[^"]*"|\\.|\[(?:h+|m+|s+)\]|yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM\/PM|[\s\S]/gi);
  if (!tokens.some((token) => /^\[?(y+|m+|d+|h+|s+)\]?$/i.test(token))) return null;
  if (tokens.some((token) => token === "[" || token === "]")) return error("#VALUE!");
  const c = clock(value);
  const date = civil(c.day);
  if (date === null) return error("#NUM!");
  const twelve = tokens.some((token) => token.toUpperCase() === "AM/PM");
  let out = "";
  tokens.forEach((token, k) => {
    const lower = token.toLowerCase();
    const unit = (t) => /^\[?([hs]+|[dmy]+)\]?$/i.test(t);
    const before = tokens.slice(0, k).reverse().find(unit)?.toLowerCase().replace("[", "") ?? "";
    const after = tokens.slice(k + 1).find(unit)?.toLowerCase().replace("[", "") ?? "";
    const seconds = Math.round(value * 86400);
    const minutes = (lower === "m" || lower === "mm") && (before.startsWith("h") || after.startsWith("s"));
    if (lower.startsWith("[")) {
      const total = lower[1] === "h" ? Math.floor(seconds / 3600) : lower[1] === "m" ? Math.floor(seconds / 60) : seconds;
      out += pad(total, lower.length - 2);
    } else if (token.startsWith('"')) out += token.slice(1, -1);
    else if (token.startsWith("\\")) out += token.slice(1);
    else if (lower === "yyyy") out += pad(date.y, 4);
    else if (lower === "yy") out += pad(date.y % 100, 2);
    else if (minutes) out += lower === "mm" ? pad(c.m, 2) : String(c.m);
    else if (lower === "mmmm") out += MONTHS[date.m - 1];
    else if (lower === "mmm") out += MONTHS[date.m - 1].slice(0, 3);
    else if (lower === "mm") out += pad(date.m, 2);
    else if (lower === "m") out += String(date.m);
    else if (lower === "dddd") out += DAYS[(c.day + 6) % 7];
    else if (lower === "ddd") out += DAYS[(c.day + 6) % 7].slice(0, 3);
    else if (lower === "dd") out += pad(date.d, 2);
    else if (lower === "d") out += String(date.d);
    else if (lower === "hh" || lower === "h") {
      const hour = twelve ? (c.h % 12 === 0 ? 12 : c.h % 12) : c.h;
      out += lower === "hh" ? pad(hour, 2) : String(hour);
    } else if (lower === "ss") out += pad(c.s, 2);
    else if (lower === "s") out += String(c.s);
    else if (lower === "am/pm") out += c.h < 12 ? "AM" : "PM";
    else out += token;
  });
  return out;
}

function textOf(value, fmt) {
  if (typeof value === "string") {
    const number = toNumber(value);
    if (isError(number)) return value;
    value = number;
  }
  const drawn = formatValue(value, fmt);
  if (drawn !== null) return drawn;
  if (typeof value !== "number") return toText(value);
  // Zero padding: "000" shows 12 as 012.
  if (/^0+$/.test(fmt)) return (value < 0 ? "-" : "") + pad(Math.round(Math.abs(value)), fmt.length);
  return dateCode(value, fmt) ?? error("#VALUE!");
}

function find(needle, hay, start, folded) {
  const list = chars(hay);
  if (start < 1 || start > list.length + 1) return error("#VALUE!");
  const pattern = folded ? new RegExp(`^${wildcardSource(needle)}`, "iu") : null;
  for (let k = start - 1; k <= list.length; k++) {
    const rest = list.slice(k).join("");
    if (folded ? pattern.test(rest) : rest.startsWith(needle)) return k + 1;
  }
  return error("#VALUE!");
}

const word = /\p{L}/u;

export const TEXT_FUNCTIONS = [
  ["CONCATENATE", { run: (args) => (args.length === 0 ? error("#N/A") : joined(args)) }],
  ["CONCAT", { run: (args) => (args.length === 0 ? error("#N/A") : joined(args)) }],
  ["TEXTJOIN", { run: (args) => {
    if (args.length < 3) return error("#N/A");
    const delimiter = text(args[0]);
    if (isError(delimiter)) return delimiter;
    const skip = toBool(single(args[1]));
    if (isError(skip)) return skip;
    const parts = [];
    const failure = each(args.slice(2), (value) => {
      if (skip && (isBlank(value) || value === "")) return;
      parts.push(toText(value));
    });
    return failure ?? parts.join(delimiter);
  } }],
  ["LEFT", call(1, 2, [text, count], (s, n = 1) => (n < 0 ? error("#VALUE!") : slice(s, 0, n)))],
  ["RIGHT", call(1, 2, [text, count], (s, n = 1) => (n < 0 ? error("#VALUE!") : n === 0 ? "" : slice(s, -n)))],
  ["MID", call(3, 3, [text, count, count], (s, start, n) => (start < 1 || n < 0 ? error("#VALUE!") : slice(s, start - 1, start - 1 + n)))],
  ["LEN", call(1, 1, [text], (s) => chars(s).length)],
  ["TRIM", call(1, 1, [text], (s) => s.replace(/ +/g, " ").replace(/^ | $/g, ""))],
  ["UPPER", call(1, 1, [text], (s) => s.toUpperCase())],
  ["LOWER", call(1, 1, [text], (s) => s.toLowerCase())],
  ["PROPER", call(1, 1, [text], (s) => [...s.toLowerCase()].map((ch, k, all) => (k === 0 || !word.test(all[k - 1]) ? ch.toUpperCase() : ch)).join(""))],
  ["SUBSTITUTE", call(3, 4, [text, text, text, count], (s, from, to, nth) => {
    if (from === "") return s;
    if (nth === undefined) return s.split(from).join(to);
    if (nth < 1) return error("#VALUE!");
    let at = -1;
    for (let k = 0; k < nth; k++) {
      at = s.indexOf(from, at + 1);
      if (at === -1) return s;
    }
    return s.slice(0, at) + to + s.slice(at + from.length);
  })],
  ["FIND", call(2, 3, [text, text, count], (needle, hay, start = 1) => find(needle, hay, start, false))],
  ["SEARCH", call(2, 3, [text, text, count], (needle, hay, start = 1) => find(needle, hay, start, true))],
  ["REPLACE", call(4, 4, [text, count, count, text], (s, start, n, by) => (start < 1 || n < 0 ? error("#VALUE!") : slice(s, 0, start - 1) + by + slice(s, start - 1 + n)))],
  ["TEXT", call(2, 2, [single, text], (value, fmt) => textOf(value, fmt))],
  // A text reads as a person typing it into a cell would: "1,234", "12%", "$1,000", a date.
  ["VALUE", call(1, 1, [single], (value) => {
    if (typeof value === "number") return value;
    if (isBlank(value)) return 0;
    if (typeof value !== "string") return error("#VALUE!");
    const plain = toNumber(value);
    if (!isError(plain)) return plain;
    const read = parseInput(value).content;
    return typeof read === "number" ? read : error("#VALUE!");
  })],
  ["HYPERLINK", call(1, 2, [text, text], (url, label) => label ?? url)],
];
