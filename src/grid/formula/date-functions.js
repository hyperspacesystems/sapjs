// The date functions on serial day numbers (day 0 is 1899-12-30), as Google Sheets computes them.
// A date argument may be a number or a text a person could type as a date ("2024-03-01").
// TODAY and NOW read the engine's clock (`ctx.now()`, a serial day with its time as a fraction).
import { parseInput } from "../input.js";
import { MAX_SERIAL, civil, serial } from "../dates.js";
import { asRange, error, isBlank, isError, single, toNumber } from "./values.js";

// A serial day from an argument: its whole days, or #VALUE! for a text that is no date, #NUM! for
// one before day 0.
function day(value) {
  value = single(value);
  if (isError(value)) return value;
  if (isBlank(value)) return 0;
  if (typeof value === "boolean") return error("#VALUE!");
  let number = value;
  if (typeof value === "string") {
    const read = parseInput(value).content;
    if (typeof read !== "number") return error("#VALUE!");
    number = read;
  }
  number = Math.floor(number);
  return number < 0 || number > MAX_SERIAL ? error("#NUM!") : number;
}

const whole = (value) => {
  const number = toNumber(single(value));
  return isError(number) ? number : Math.trunc(number);
};

const call = (min, max, reads, body) => ({
  run(args, ctx) {
    if (args.length < min || args.length > max) return error("#N/A");
    const values = [];
    for (let i = 0; i < args.length; i++) {
      const value = reads[i](args[i]);
      if (isError(value)) return value;
      values.push(value);
    }
    return body(values, ctx);
  },
});

// The serial of year y, month m (any whole number: 13 is next January) and day d (any whole
// number: 0 is the last day of the month before), or #NUM!.
// The day number of any y, m, d, unbounded: the year moves by whole 400-year cycles of 146,097
// days into the range `serial` knows, so a month before day 0 or after 9999 still has a length.
function rawDay(y, m, d) {
  y += Math.floor((m - 1) / 12);
  m = ((((m - 1) % 12) + 12) % 12) + 1;
  const era = Math.floor((y - 2000) / 400);
  return serial(y - era * 400, m, 1) + era * 146097 + d - 1;
}

function dateOf(y, m, d) {
  const out = rawDay(y, m, d);
  return out < 0 || out > MAX_SERIAL ? error("#NUM!") : out;
}

const monthLength = (y, m) => rawDay(y, m + 1, 1) - rawDay(y, m, 1);

// The day `months` months on, kept in the month: Jan 31 plus one month is Feb 29 in 2024.
function addMonths(n, months) {
  const date = civil(n);
  const length = monthLength(date.y, date.m + months);
  return dateOf(date.y, date.m + months, Math.min(date.d, length));
}

// 0 for Sunday to 6 for Saturday.
const weekday = (n) => (n + 6) % 7;

const workday = (n) => weekday(n) !== 0 && weekday(n) !== 6;

function holidays(arg) {
  const out = new Set();
  if (arg === undefined) return out;
  let failure = null;
  asRange(arg).forEach((value) => {
    if (failure !== null || isBlank(value)) return;
    const n = day(value);
    if (isError(n)) failure = n;
    else out.add(n);
  });
  return failure ?? out;
}

function datedif(start, end, unit) {
  if (start > end) return error("#NUM!");
  const a = civil(start);
  const b = civil(end);
  const months = (b.y - a.y) * 12 + (b.m - a.m) - (b.d < a.d ? 1 : 0);
  switch (unit.toUpperCase()) {
    case "D":
      return end - start;
    case "M":
      return months;
    case "Y":
      return Math.floor(months / 12);
    case "YM":
      return months % 12;
    case "MD":
      return b.d >= a.d ? b.d - a.d : end - rawDay(b.y, b.m - 1, a.d);
    case "YD": {
      const anniversary = rawDay(b.y, a.m, a.d);
      return anniversary <= end ? end - anniversary : end - rawDay(b.y - 1, a.m, a.d);
    }
    default:
      return error("#NUM!");
  }
}

function weeknum(n, type) {
  const date = civil(n);
  const jan1 = rawDay(date.y, 1, 1);
  if (type === 21) {
    // ISO 8601: the week holding the year's first Thursday is week 1. Day 0's Thursday is before
    // day 0, in the last week of 1899.
    const thursday = n - ((weekday(n) + 6) % 7) + 3;
    const year = thursday < 0 ? 1899 : civil(thursday).y;
    return Math.floor((thursday - rawDay(year, 1, 1)) / 7) + 1;
  }
  const start = type === 1 ? 0 : type === 2 ? 1 : type >= 11 && type <= 17 ? (type - 10) % 7 : null;
  if (start === null) return error("#NUM!");
  const offset = (weekday(jan1) - start + 7) % 7;
  return Math.floor((n - jan1 + offset) / 7) + 1;
}

const text = (value) => {
  value = single(value);
  return isError(value) ? value : typeof value === "string" ? value : error("#VALUE!");
};

export const DATE_FUNCTIONS = [
  ["DATE", call(3, 3, [whole, whole, whole], ([y, m, d]) => {
    if (y < 0 || y >= 10000) return error("#NUM!");
    return dateOf(y < 1900 ? y + 1900 : y, m, d);
  })],
  ["YEAR", call(1, 1, [day], ([n]) => civil(n).y)],
  ["MONTH", call(1, 1, [day], ([n]) => civil(n).m)],
  ["DAY", call(1, 1, [day], ([n]) => civil(n).d)],
  ["WEEKDAY", call(1, 2, [day, whole], ([n, type = 1]) => {
    const dow = weekday(n);
    if (type === 1) return dow + 1;
    if (type === 2) return ((dow + 6) % 7) + 1;
    if (type === 3) return (dow + 6) % 7;
    return error("#NUM!");
  })],
  ["WEEKNUM", call(1, 2, [day, whole], ([n, type = 1]) => weeknum(n, type))],
  ["EDATE", call(2, 2, [day, whole], ([n, months]) => addMonths(n, months))],
  ["EOMONTH", call(2, 2, [day, whole], ([n, months]) => {
    const date = civil(n);
    return dateOf(date.y, date.m + months + 1, 0);
  })],
  ["DATEDIF", call(3, 3, [day, day, text], ([start, end, unit]) => datedif(start, end, unit))],
  ["DAYS", call(2, 2, [day, day], ([end, start]) => end - start)],
  ["DATEVALUE", call(1, 1, [text], ([value]) => {
    const read = parseInput(value).content;
    return typeof read === "number" ? Math.floor(read) : error("#VALUE!");
  })],
  ["NETWORKDAYS", call(2, 3, [day, day, (arg) => arg], ([start, end, extra]) => {
    const skip = holidays(extra);
    if (isError(skip)) return skip;
    const step = start <= end ? 1 : -1;
    let total = 0;
    for (let n = start; step > 0 ? n <= end : n >= end; n += step) if (workday(n) && !skip.has(n)) total += step;
    return total;
  })],
  ["WORKDAY", call(2, 3, [day, whole, (arg) => arg], ([start, days, extra]) => {
    const skip = holidays(extra);
    if (isError(skip)) return skip;
    const step = days >= 0 ? 1 : -1;
    let n = start;
    for (let left = Math.abs(days); left > 0; ) {
      n += step;
      if (n < 0 || n > MAX_SERIAL) return error("#NUM!");
      if (workday(n) && !skip.has(n)) left -= 1;
    }
    return n;
  })],
  ["TODAY", { volatile: true, run: (args, ctx) => (args.length > 0 ? error("#N/A") : Math.floor(ctx.now())) }],
  ["NOW", { volatile: true, run: (args, ctx) => (args.length > 0 ? error("#N/A") : ctx.now()) }],
];
