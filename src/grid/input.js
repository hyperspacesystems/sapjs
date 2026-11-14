// What a person typed into a cell, as neutral content plus the format its look brings. The rules
// are narrow on purpose: a form that is text today can become a number in a later release without
// touching a saved file, but the reverse would change what people's habits produce. Pure: no
// clock, no locale, no page.

import { MAX_DIGITS, significantDigits, shown } from "./codec/value.js";
import { fmtKind, formatValue } from "./format.js";
import { civil, fraction, serial } from "./dates.js";

// an optional minus and an optional $ in either order, then the integer part (plain, or strict
// groups of three) with an optional decimal part, or a decimal part alone, then an optional %
const NUMBER = /^(-?\$?|\$-?)((?:[1-9][0-9]{0,2}(?:,[0-9]{3})+|[1-9][0-9]*|0)(?:\.[0-9]+)?|\.[0-9]+)(%?)$/;

// the month names as three letters or in full, any case; "sept" is not one of them
const MONTH_NAME = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const SLASH = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})$/;
const DASH = /^(\d{1,2})-(\d{1,2})-(\d{4}|\d{2})$/;
const SHORT = /^(\d{1,2})\/(\d{1,2})$/;
const NAME_FIRST = new RegExp(`^(${MONTH_NAME}) (\\d{1,2})(?:, (\\d{4})| (\\d{4}))?$`, "i");
const DAY_FIRST = new RegExp(`^(\\d{1,2}) (${MONTH_NAME}) (\\d{4})$`, "i");

// 1 or 2 hour digits, two minute digits, optional two second digits, optional one space and AM or PM
const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?: ([ap]m))?$/i;

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

const TRIM = /^[ \t]+|[ \t]+$/g;

// CR LF and a lone CR become LF, NUL goes and a lone surrogate becomes U+FFFD: the writer throws
// on the first two, and a sheet that cannot be written cannot be saved.
function clean(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\0/g, "")
    .replace(LONE_SURROGATE, "\uFFFD");
}

// the percent shift moves the point two places left in the digit string, never on the float
function shiftPoint(digits) {
  const [whole, fraction = ""] = digits.split(".");
  const padded = whole.padStart(2, "0");
  const moved = padded.slice(0, -2) || "0";
  return moved + "." + padded.slice(-2) + fraction;
}

// the percent shift moves the point two places right in the digit string, never on the float
function gainPoint(text) {
  const negative = text.startsWith("-");
  const body = negative ? text.slice(1) : text;
  const [whole, fraction = ""] = body.split(".");
  const padded = fraction.padEnd(2, "0");
  const moved = (whole + padded.slice(0, 2)).replace(/^0+(?=\d)/, "");
  const rest = padded.slice(2);
  return (negative ? "-" : "") + moved + (rest ? "." + rest : "") + "%";
}

// { content, fmt? } for a number typed in US English, or null when the text is not one
function numberContent(text, fmt) {
  const match = NUMBER.exec(text);
  if (!match) return null;
  const [, sign, body, percentMark] = match;
  const currency = sign.includes("$");
  if (currency && percentMark) return null;
  const point = body.indexOf(".");
  const whole = point < 0 ? body : body.slice(0, point);
  const fraction = point < 0 ? "" : body.slice(point + 1);
  const grouped = whole.includes(",");
  const digits = whole.replace(/,/g, "") + (fraction ? "." + fraction : "");
  if (significantDigits(digits) > MAX_DIGITS) return null;
  const percent = percentMark !== "" || (fmtKind(fmt) === "percent" && !currency && !grouped);
  const shifted = percent ? shiftPoint(digits) : digits;
  const number = Number((sign.includes("-") ? "-" : "") + shifted);
  if (!Number.isFinite(number) || (number === 0 && significantDigits(digits) > 0)) return null;
  const content = number === 0 ? 0 : number;
  if (percentMark) return { content, fmt: fraction ? "0.00%" : "0%" };
  if (currency) return { content, fmt: "$#,##0.00" };
  if (grouped) return { content, fmt: fraction ? "#,##0." + "0".repeat(fraction.length) : "#,##0" };
  return { content };
}

// two-digit years: 00 to 29 are 2000 to 2029, 30 to 99 are 1930 to 1999
function pivotYear(yy) {
  return yy <= 29 ? 2000 + yy : 1900 + yy;
}

function monthNumber(name) {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
}

// { content, fmt } for a typed date, or null when the text is not one
function dateContent(text, today) {
  let year;
  let month;
  let day;
  let fmt = "m/d/yyyy";
  let match;
  if ((match = ISO.exec(text))) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
    fmt = "yyyy-mm-dd";
  } else if ((match = SLASH.exec(text)) || (match = DASH.exec(text))) {
    month = Number(match[1]);
    day = Number(match[2]);
    year = match[3].length === 2 ? pivotYear(Number(match[3])) : Number(match[3]);
  } else if ((match = NAME_FIRST.exec(text))) {
    month = monthNumber(match[1]);
    day = Number(match[2]);
    fmt = "mmm d, yyyy";
    if (match[3] !== undefined || match[4] !== undefined) {
      year = Number(match[3] ?? match[4]);
    } else {
      const now = civil(today);
      if (!now) return null;
      year = now.y;
    }
  } else if ((match = DAY_FIRST.exec(text))) {
    day = Number(match[1]);
    month = monthNumber(match[2]);
    year = Number(match[3]);
    fmt = "mmm d, yyyy";
  } else if ((match = SHORT.exec(text))) {
    const now = civil(today);
    if (!now) return null;
    month = Number(match[1]);
    day = Number(match[2]);
    year = now.y;
  } else {
    return null;
  }
  const value = serial(year, month, day);
  if (value === null || value < 2) return null;
  return { content: value, fmt };
}

// { content, fmt } for a typed time, or null when the text is not one
function timeContent(text) {
  const match = TIME.exec(text);
  if (!match) return null;
  const [, hourText, minuteText, secondText, half] = match;
  let hour = Number(hourText);
  const minute = Number(minuteText);
  const second = secondText === undefined ? 0 : Number(secondText);
  if (half !== undefined) {
    if (hour < 1 || hour > 12) return null;
    const pm = half.toLowerCase() === "pm";
    if (hour === 12) {
      hour = pm ? 12 : 0;
    } else if (pm) {
      hour += 12;
    }
  } else if (hour > 23) {
    return null;
  }
  if (minute > 59 || second > 59) return null;
  const content = fraction(hour, minute, second);
  if (content === null) return null;
  const fmt = "h:mm" + (secondText === undefined ? "" : ":ss") + (half === undefined ? "" : " AM/PM");
  return { content, fmt };
}

// A time of day is a binary fraction with more digits than a cell saves; keep the number the
// file will read back (15 significant digits), so the tab and the saved file hold the same value.
const stored = (x) => Number(shown(x));

// { content, fmt } for a typed date, time or date-time, or null when the text is none of them
function momentContent(text, today) {
  const date = dateContent(text, today);
  if (date) return date;
  const time = timeContent(text);
  if (time) return { ...time, content: stored(time.content) };
  for (let at = text.indexOf(" "); at >= 0; at = text.indexOf(" ", at + 1)) {
    const day = dateContent(text.slice(0, at), today);
    if (!day) continue;
    const clock = timeContent(text.slice(at + 1));
    if (!clock) continue;
    const fmt = clock.fmt.includes(":ss") ? "m/d/yyyy h:mm:ss" : "m/d/yyyy h:mm";
    return { content: stored(day.content + clock.content), fmt };
  }
  return null;
}

// What a person typed into a cell, as content plus the format its look brings.
// fmt: the cell's effective format (or null). today: today's serial day.
// Returns { content } or { content, fmt }.
export function parseInput(text, { fmt = null, today } = {}) {
  const cleaned = clean(text);
  if (cleaned === "") return { content: null };
  if (fmtKind(fmt) === "text") return { content: cleaned };
  if (cleaned[0] === "'") return cleaned === "'" ? { content: null } : { content: cleaned.slice(1) };
  if (cleaned[0] === "=") return cleaned === "=" ? { content: "=" } : { content: { f: cleaned } };
  const trimmed = cleaned.replace(TRIM, "");
  const lower = trimmed.toLowerCase();
  if (lower === "true") return { content: true };
  if (lower === "false") return { content: false };
  const number = numberContent(trimmed, fmt);
  if (number) return number;
  const moment = momentContent(trimmed, today);
  if (moment) return moment;
  return { content: cleaned };
}

// the code each date and time kind shows its number under in the editor
const MOMENT_CODES = { date: "m/d/yyyy", time: "h:mm:ss", datetime: "m/d/yyyy h:mm:ss" };

// The text a cell's editor shows for content c under fmt. today: today's serial day.
export function editText(content, fmt = null, today) {
  if (content === null || content === undefined) return "";
  if (typeof content === "object") return content.f;
  if (typeof content === "boolean") return content ? "TRUE" : "FALSE";
  if (typeof content === "string") {
    return parseInput(content, { fmt, today }).content === content ? content : "'" + content;
  }
  const kind = fmtKind(fmt);
  if (kind === "percent") return gainPoint(shown(content));
  const code = MOMENT_CODES[kind];
  if (code === undefined) return shown(content);
  const pretty = formatValue(content, code);
  if (pretty === null || parseInput(pretty, { fmt, today }).content !== content) return shown(content);
  return pretty;
}
