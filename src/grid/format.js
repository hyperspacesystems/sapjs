// The shown text of a value under the grid's built-in number, date and time formats. Rounding
// works on the decimal digit strings, never on the float, and the date arithmetic goes through
// dates.js. Pure: no clock, no locale, no page.

import { shown } from "./codec/value.js";
import { MAX_SERIAL, civil, clock } from "./dates.js";

export const US = {
  group: ",",
  point: ".",
  currency: "$",
  months: [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ],
  monthsShort: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};

const FAMILY = /^(\$?)(#,##0|0)(?:\.(0{1,15}))?(%?)$/;

const formatters = [];

const pad = (n, width) => String(n).padStart(width, "0");

const hour12 = (c) => (c.h % 12 === 0 ? 12 : c.h % 12);

function half(c) {
  const half = c.h < 12 ? "AM" : "PM";
  return half;
}

// The built-in date, time and date-time codes: kind, and text(date, c, locale) for the civil day
// (null for a time code) and the clock of the value.
const CODES = new Map([
  ["m/d/yyyy", { kind: "date", text: (date) => `${date.m}/${date.d}/${pad(date.y, 4)}` }],
  ["yyyy-mm-dd", { kind: "date", text: (date) => `${pad(date.y, 4)}-${pad(date.m, 2)}-${pad(date.d, 2)}` }],
  ["mmm d, yyyy", { kind: "date", text: (date, c, locale) => `${locale.monthsShort[date.m - 1]} ${date.d}, ${pad(date.y, 4)}` }],
  ["mmmm d, yyyy", { kind: "date", text: (date, c, locale) => `${locale.months[date.m - 1]} ${date.d}, ${pad(date.y, 4)}` }],
  ["mmm d", { kind: "date", text: (date, c, locale) => `${locale.monthsShort[date.m - 1]} ${date.d}` }],
  ["h:mm", { kind: "time", text: (date, c) => `${c.h}:${pad(c.m, 2)}` }],
  ["h:mm:ss", { kind: "time", text: (date, c) => `${c.h}:${pad(c.m, 2)}:${pad(c.s, 2)}` }],
  ["h:mm AM/PM", { kind: "time", text: (date, c) => `${hour12(c)}:${pad(c.m, 2)} ${half(c)}` }],
  ["h:mm:ss AM/PM", { kind: "time", text: (date, c) => `${hour12(c)}:${pad(c.m, 2)}:${pad(c.s, 2)} ${half(c)}` }],
  ["m/d/yyyy h:mm", { kind: "datetime", text: (date, c) => `${date.m}/${date.d}/${pad(date.y, 4)} ${c.h}:${pad(c.m, 2)}` }],
  ["m/d/yyyy h:mm:ss", { kind: "datetime", text: (date, c) => `${date.m}/${date.d}/${pad(date.y, 4)} ${c.h}:${pad(c.m, 2)}:${pad(c.s, 2)}` }],
]);

const code = (fmt) => (typeof fmt === "string" ? CODES.get(fmt) : undefined);

function family(fmt) {
  if (typeof fmt !== "string") return null;
  const match = FAMILY.exec(fmt);
  if (!match || (match[1] && match[4])) return null;
  return match;
}

// intPart.fracPart rounded to places fraction digits, half away from zero, on the digit strings
function roundDigits(intPart, fracPart, places) {
  const kept = fracPart.slice(0, places).padEnd(places, "0");
  const next = fracPart[places];
  if (next === undefined || next < "5") return { int: intPart, frac: kept };
  const digits = (intPart + kept).split("");
  let i = digits.length - 1;
  while (i >= 0 && digits[i] === "9") digits[i--] = "0";
  if (i < 0) digits.unshift("1");
  else digits[i] = String(Number(digits[i]) + 1);
  const joined = digits.join("");
  const cut = joined.length - places;
  return { int: joined.slice(0, cut), frac: joined.slice(cut) };
}

// percent moves the point two places right on the digit string
function shiftPercent(text) {
  const [whole, fraction = ""] = text.split(".");
  const padded = fraction.padEnd(2, "0");
  return `${whole + padded.slice(0, 2)}.${padded.slice(2)}`;
}

function numberValue(text, match, locale) {
  const [, currencyMark, code, zeros = "", percentMark] = match;
  const places = zeros.length;
  const negative = text.startsWith("-");
  const magnitude = negative ? text.slice(1) : text;
  const shifted = percentMark ? shiftPercent(magnitude) : magnitude;
  const [intPart, fracPart = ""] = shifted.split(".");
  const rounded = roundDigits(intPart, fracPart, places);
  const blank = /^0*$/.test(rounded.int) && /^0*$/.test(rounded.frac);
  const sign = negative && !blank ? "-" : "";
  const int = rounded.int.replace(/^0+(?=\d)/, "");
  const grouped = code === "#,##0" ? int.replace(/\B(?=(\d{3})+$)/g, locale.group) : int;
  const currency = currencyMark ? locale.currency : "";
  const point = places ? locale.point + rounded.frac : "";
  const percent = percentMark ? "%" : "";
  return sign + currency + grouped + point + percent;
}

// The shown text of a value under a date, time or date-time code; null when the value falls
// outside the code's range. Text, booleans and null show as under the number family.
function coded(value, builtin, locale) {
  if (typeof value !== "number") return shown(value);
  if (!Number.isFinite(value)) return null;
  const c = clock(value);
  if (builtin.kind === "time") {
    if (value < 0 || c.day > MAX_SERIAL) return null;
    return builtin.text(null, c, locale);
  }
  if (c.day < 1 || c.day > MAX_SERIAL) return null;
  return builtin.text(civil(c.day), c, locale);
}

// The shown text of value under fmt, or null when no built-in code or registered formatter knows
// fmt. value: a finite number, text, true, false or null. Text and booleans show as shown(value);
// null shows "". '@' shows every value as shown(value). An empty fmt is "auto" and shows the value
// as it is.
export function formatValue(value, fmt, locale = US) {
  if (fmt === null || fmt === undefined || fmt === "") return shown(value);
  if (fmt === "@") return shown(value);
  const match = family(fmt);
  if (match) {
    const text = shown(value);
    return typeof value === "number" ? numberValue(text, match, locale) : text;
  }
  const builtin = code(fmt);
  if (builtin) return coded(value, builtin, locale);
  const custom = formatters.find((f) => f.test(fmt));
  return custom ? custom.format(value, fmt, locale) : null;
}

// "auto" for null, undefined or ""; "number", "currency" or "percent" for the number family;
// "text" for "@"; "date", "time" or "datetime" for the date and time codes; the kind of the first
// registered formatter whose test(fmt) is true; otherwise "unknown".
export function fmtKind(fmt) {
  if (fmt === null || fmt === undefined || fmt === "") return "auto";
  if (fmt === "@") return "text";
  const match = family(fmt);
  if (match) return match[1] ? "currency" : match[4] ? "percent" : "number";
  const builtin = code(fmt);
  if (builtin) return builtin.kind;
  const custom = formatters.find((f) => f.test(fmt));
  return custom ? custom.kind : "unknown";
}

// true for the number family, "@" and the date and time codes
export function isBuiltin(fmt) {
  return fmt === "@" || family(fmt) !== null || code(fmt) !== undefined;
}

const clampPlaces = (n) => Math.min(15, Math.max(0, n));

const zeros = (places) => (places ? "0." + "0".repeat(places) : "0");

// The format code with delta more (or fewer) decimal zeros, clamped to 0 to 15. Auto starts from
// the fraction digits of shown(value). Every other code is returned unchanged.
export function adjustDecimals(fmt, delta, value) {
  if (fmt === null || fmt === undefined || fmt === "") {
    if (typeof value !== "number" || !Number.isFinite(value)) return fmt;
    const fraction = shown(value).split(".")[1] || "";
    return zeros(clampPlaces(Math.min(fraction.length, 15) + delta));
  }
  const match = family(fmt);
  if (!match) return fmt;
  const [, currencyMark, group, decimalZeros = "", percentMark] = match;
  const places = clampPlaces(decimalZeros.length + delta);
  return currencyMark + group + (places ? "." + "0".repeat(places) : "") + percentMark;
}

// Register a formatter for codes that are not built in: { test(fmt) -> boolean, format(value, fmt,
// locale) -> string, kind }. Built-in codes always win. Returns a function that removes it.
export function addFormatter(formatter) {
  formatters.push(formatter);
  return () => {
    const at = formatters.indexOf(formatter);
    if (at >= 0) formatters.splice(at, 1);
  };
}
