// The functions, by upper-case name in a fixed Map: a name taken from formula text never reaches a
// property of an object. Each is `{ run(args, ctx), areas? }`. An argument is a value or a range;
// a reference written straight into a call is a range of one cell, so SUM(A1) skips text in A1 as
// Sheets does while SUM("x") is #VALUE!. With `areas`, a reference argument comes as its place
// `{ isArea, top, left, height, width }` instead (ROW, COLUMN, ROWS, COLUMNS).
//
// S3 holds the first batches: math and totals, conditional totals, logic and information. S4 adds
// lookup, text, dates, the volatile functions and the rest of the 86.

import { compare, error, isBlank, isError, isRange, single, toBool, toNumber } from "./values.js";

const isArea = (value) => value !== null && typeof value === "object" && value.isArea === true;

// A value as a range of one cell, so a function that walks ranges takes a plain value too.
const asRange = (value) =>
  isRange(value) ? value : { isRange: true, height: 1, width: 1, innerHeight: 1, innerWidth: 1, outside: 0, get: () => value, forEach: (visit) => visit(value, 0, 0) };

// Each number the arguments give: in a range only its numbers count, and an error stops the walk;
// a value written directly is coerced, so SUM(TRUE, "3") is 4. Returns the first error, or null.
function eachNumber(args, add) {
  for (const arg of args) {
    if (isRange(arg)) {
      let failure = null;
      arg.forEach((value) => {
        if (failure !== null) return;
        if (isError(value)) failure = value;
        else if (typeof value === "number") add(value);
      });
      if (failure !== null) return failure;
      continue;
    }
    if (isError(arg)) return arg;
    if (isBlank(arg)) continue;
    const number = toNumber(arg);
    if (isError(number)) return number;
    add(number);
  }
  return null;
}

const numbers = (args) => {
  const list = [];
  const failure = eachNumber(args, (value) => list.push(value));
  return failure ?? list;
};

// A number to 15 significant digits, so 0.1 + 0.2 rounds as people expect.
const clean = (value) => (Number.isFinite(value) ? Number(value.toPrecision(15)) : value);

// Each argument as a number, or the first error: for functions with fixed numeric arguments.
function numberArgs(args, count, defaults = []) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const arg = i < args.length ? single(args[i]) : defaults[i];
    if (arg === undefined) return error("#N/A");
    const number = toNumber(arg);
    if (isError(number)) return number;
    out.push(number);
  }
  return out;
}

const fixed = (count, body, defaults) => ({
  run(args) {
    if (args.length > count || args.length < count - defaults.filter((d) => d !== undefined).length) return error("#N/A");
    const list = numberArgs(args, count, defaults);
    return isError(list) ? list : body(...list);
  },
});

function roundTo(x, digits, mode) {
  const d = Math.trunc(digits);
  const factor = 10 ** d;
  const scaled = Number((Math.abs(x) * factor).toPrecision(15));
  const whole = mode === "up" ? Math.ceil(scaled) : mode === "down" ? Math.floor(scaled) : Math.floor(scaled + 0.5);
  const out = clean((Math.sign(x) * whole) / factor);
  return Object.is(out, -0) ? 0 : out;
}

// Wildcards in a criterion: * any run, ? one character, ~ takes the next one as it is.
function wildcard(pattern) {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "~" && i + 1 < pattern.length) source += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (ch === "*") source += "[\\s\\S]*";
    else if (ch === "?") source += "[\\s\\S]";
    else source += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, "i");
}

const NUMERIC = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

// A criterion of SUMIF and its kin, as a test of one cell's value. A number or a boolean matches
// that value. A text may start with = <> < > <= >=; the rest is a number, TRUE or FALSE, or a text
// that = and <> match with wildcards and without case. "" and "=" match a blank cell, "<>" a cell
// that is not blank.
function criterion(raw) {
  raw = single(raw);
  if (isError(raw)) return raw;
  // A number matches the number and text that reads as it ("007" for 7); text that reads as a
  // number matches that number and the same text, so COUNTIF(A:A, A1) finds an ID like "007".
  const sameNumber = (value, number) => value === number || (typeof value === "string" && NUMERIC.test(value.trim()) && Number(value.trim()) === number);
  if (typeof raw === "boolean") return (value) => value === raw;
  if (typeof raw === "number") return (value) => sameNumber(value, raw);
  const text = isBlank(raw) ? "" : raw;
  const op = /^(<=|>=|<>|<|>|=)/.exec(text)?.[0] ?? "";
  const rest = text.slice(op.length);
  const operand = NUMERIC.test(rest.trim()) ? Number(rest.trim()) : rest.toUpperCase() === "TRUE" ? true : rest.toUpperCase() === "FALSE" ? false : rest;
  if (op === "" || op === "=" || op === "<>") {
    let equal;
    if (operand === "") equal = (value) => isBlank(value) || value === "";
    else if (typeof operand === "number") {
      const text = rest.toLowerCase();
      equal = (value) => sameNumber(value, operand) || (typeof value === "string" && value.toLowerCase() === text);
    } else if (typeof operand === "string") {
      const pattern = wildcard(operand);
      equal = (value) => typeof value === "string" && pattern.test(value);
    } else equal = (value) => value === operand;
    return op === "<>" ? (value) => !equal(value) : equal;
  }
  const holds = (diff) => (op === "<" ? diff < 0 : op === ">" ? diff > 0 : op === "<=" ? diff <= 0 : diff >= 0);
  if (typeof operand === "number") return (value) => typeof value === "number" && holds(value - operand);
  if (typeof operand === "boolean") return (value) => typeof value === "boolean" && holds(compare(value, operand));
  return (value) => typeof value === "string" && holds(compare(value, operand));
}

// The cells of `first` where every criterion pair holds: pairs is [range, criterion, ...]. Each
// range must have the shape of the first one. Returns a list of [i, j], or an error.
function matching(pairs) {
  if (pairs.length === 0 || pairs.length % 2 !== 0) return error("#N/A");
  // A range that is an error (a deleted tab's #REF!) is that error, never zero matches.
  for (let k = 0; k < pairs.length; k += 2) if (isError(pairs[k])) return pairs[k];
  const tests = [];
  const first = asRange(pairs[0]);
  for (let k = 0; k < pairs.length; k += 2) {
    const range = asRange(pairs[k]);
    if (range.height !== first.height || range.width !== first.width) return error("#VALUE!");
    const test = criterion(pairs[k + 1]);
    if (isError(test)) return test;
    tests.push([range, test]);
  }
  const found = [];
  for (let i = 0; i < first.innerHeight; i++) {
    for (let j = 0; j < first.innerWidth; j++) {
      if (tests.every(([range, test]) => test(range.get(i, j)))) found.push([i, j]);
    }
  }
  // The places past the tab's edge are blank in every range of the same shape.
  found.outside = first.outside > 0 && tests.every(([, test]) => test(null)) ? first.outside : 0;
  return found;
}

// The total and count of the numbers at these cells of `range`; an error there stops it.
function totalAt(range, cells) {
  let total = 0;
  let count = 0;
  for (const [i, j] of cells) {
    const value = range.get(i, j);
    if (isError(value)) return value;
    if (typeof value === "number") {
      total += value;
      count += 1;
    }
  }
  return { total: clean(total), count };
}

// The range totalled must have the criteria's shape. Sheets stretches a shorter one from its first
// cell; v1 shows #VALUE! instead, because cells read past a range are not in the graph and the total
// would not follow them.
const ifs = (target, pairs, average) => {
  const cells = matching(pairs);
  if (isError(cells)) return cells;
  if (isError(target)) return target;
  const totalled = asRange(target);
  const first = asRange(pairs[0]);
  if (totalled.height !== first.height || totalled.width !== first.width) return error("#VALUE!");
  const sum = totalAt(totalled, cells);
  if (isError(sum)) return sum;
  if (!average) return sum.total;
  return sum.count === 0 ? error("#DIV/0!") : clean(sum.total / sum.count);
};

// AND and OR: booleans and numbers count, in a range text and blanks are left out, and a call with
// nothing to count is #VALUE!.
function logical(args, all) {
  let seen = 0;
  let result = all;
  const take = (value) => {
    seen += 1;
    const bool = typeof value === "number" ? value !== 0 : value;
    result = all ? result && bool : result || bool;
  };
  for (const arg of args) {
    if (isRange(arg)) {
      let failure = null;
      arg.forEach((value) => {
        if (failure !== null) return;
        if (isError(value)) failure = value;
        else if (typeof value === "number" || typeof value === "boolean") take(value);
      });
      if (failure !== null) return failure;
      continue;
    }
    const bool = toBool(arg);
    if (isError(bool)) return bool;
    take(bool);
  }
  return seen === 0 ? error("#VALUE!") : result;
}

const place = (pick) => ({
  areas: true,
  run(args, ctx) {
    if (args.length > 1) return error("#N/A");
    if (args.length === 0) return pick({ top: ctx.home.row, left: ctx.home.col, height: 1, width: 1 }) + 1;
    const [area] = args;
    if (isError(area)) return area;
    return isArea(area) ? pick(area) + 1 : error("#VALUE!");
  },
});

const size = (pick) => ({
  areas: true,
  run(args) {
    if (args.length !== 1) return error("#N/A");
    const [area] = args;
    if (isError(area)) return area;
    if (isArea(area)) return pick(area);
    return isRange(area) ? pick(area) : 1;
  },
});

const FUNCTIONS = new Map([
  ["SUM", { run: (args) => { const list = numbers(args); return isError(list) ? list : clean(list.reduce((a, b) => a + b, 0)); } }],
  ["AVERAGE", { run: (args) => { const list = numbers(args); return isError(list) ? list : list.length === 0 ? error("#DIV/0!") : clean(list.reduce((a, b) => a + b, 0) / list.length); } }],
  ["MIN", { run: (args) => { const list = numbers(args); return isError(list) ? list : list.length === 0 ? 0 : list.reduce((a, b) => (b < a ? b : a)); } }],
  ["MAX", { run: (args) => { const list = numbers(args); return isError(list) ? list : list.length === 0 ? 0 : list.reduce((a, b) => (b > a ? b : a)); } }],
  ["COUNT", { run: (args) => {
    let count = 0;
    for (const arg of args) {
      if (isRange(arg)) arg.forEach((value) => { if (typeof value === "number") count += 1; });
      else if (!isBlank(arg) && !isError(arg) && !isError(toNumber(arg))) count += 1;
    }
    return count;
  } }],
  ["COUNTA", { run: (args) => {
    let count = 0;
    for (const arg of args) {
      if (isRange(arg)) arg.forEach((value) => { if (!isBlank(value)) count += 1; });
      else if (!isBlank(arg)) count += 1;
    }
    return count;
  } }],
  ["COUNTBLANK", { run: (args) => {
    if (args.length !== 1) return error("#N/A");
    if (isError(args[0])) return args[0];
    let count = 0;
    const range = asRange(args[0]);
    range.forEach((value) => { if (isBlank(value) || value === "") count += 1; });
    return count + range.outside;
  } }],
  ["PRODUCT", { run: (args) => { const list = numbers(args); return isError(list) ? list : list.length === 0 ? 0 : clean(list.reduce((a, b) => a * b, 1)); } }],
  ["SUMPRODUCT", { run: (args) => {
    if (args.length === 0) return error("#N/A");
    const ranges = args.map(asRange);
    const { height, width } = ranges[0];
    if (ranges.some((range) => range.height !== height || range.width !== width)) return error("#VALUE!");
    let total = 0;
    for (let i = 0; i < height; i++) {
      for (let j = 0; j < width; j++) {
        let product = 1;
        for (const range of ranges) {
          const value = range.get(i, j);
          if (isError(value)) return value;
          product *= typeof value === "number" ? value : 0;
        }
        total += product;
      }
    }
    return clean(total);
  } }],
  ["MEDIAN", { run: (args) => {
    const list = numbers(args);
    if (isError(list)) return list;
    if (list.length === 0) return error("#NUM!");
    list.sort((a, b) => a - b);
    const mid = list.length >> 1;
    return list.length % 2 === 1 ? list[mid] : clean((list[mid - 1] + list[mid]) / 2);
  } }],
  ["ROUND", fixed(2, (x, d) => roundTo(x, d, "near"), [undefined, 0])],
  ["ROUNDUP", fixed(2, (x, d) => roundTo(x, d, "up"), [undefined, 0])],
  ["ROUNDDOWN", fixed(2, (x, d) => roundTo(x, d, "down"), [undefined, 0])],
  ["INT", fixed(1, (x) => Math.floor(x), [undefined])],
  ["ABS", fixed(1, (x) => Math.abs(x), [undefined])],
  ["MOD", fixed(2, (a, b) => (b === 0 ? error("#DIV/0!") : clean(a - b * Math.floor(a / b))), [undefined, undefined])],
  ["POWER", fixed(2, (a, b) => (a === 0 && b < 0 ? error("#DIV/0!") : Number.isFinite(a ** b) ? a ** b : error("#NUM!")), [undefined, undefined])],
  ["SQRT", fixed(1, (x) => (x < 0 ? error("#NUM!") : Math.sqrt(x)), [undefined])],
  ["CEILING", fixed(2, (x, f) => (f === 0 ? 0 : x > 0 && f < 0 ? error("#NUM!") : clean(Math.ceil(clean(x / f)) * f)), [undefined, 1])],
  ["FLOOR", fixed(2, (x, f) => (f === 0 ? error("#DIV/0!") : x > 0 && f < 0 ? error("#NUM!") : clean(Math.floor(clean(x / f)) * f)), [undefined, 1])],
  ["SUMIF", { run: (args) => (args.length < 2 || args.length > 3 ? error("#N/A") : ifs(args[2] ?? args[0], [args[0], args[1]], false)) }],
  ["SUMIFS", { run: (args) => (args.length < 3 ? error("#N/A") : ifs(args[0], args.slice(1), false)) }],
  ["COUNTIF", { run: (args) => { if (args.length !== 2) return error("#N/A"); const cells = matching(args); return isError(cells) ? cells : cells.length + cells.outside; } }],
  ["COUNTIFS", { run: (args) => { const cells = matching(args); return isError(cells) ? cells : cells.length + cells.outside; } }],
  ["AVERAGEIF", { run: (args) => (args.length < 2 || args.length > 3 ? error("#N/A") : ifs(args[2] ?? args[0], [args[0], args[1]], true)) }],
  ["AVERAGEIFS", { run: (args) => (args.length < 3 ? error("#N/A") : ifs(args[0], args.slice(1), true)) }],
  ["IF", { run: (args) => {
    if (args.length < 2 || args.length > 3) return error("#N/A");
    const condition = toBool(args[0]);
    if (isError(condition)) return condition;
    return condition ? args[1] : args.length === 3 ? args[2] : false;
  } }],
  ["IFS", { run: (args) => {
    if (args.length === 0 || args.length % 2 !== 0) return error("#N/A");
    for (let k = 0; k < args.length; k += 2) {
      const condition = toBool(args[k]);
      if (isError(condition)) return condition;
      if (condition) return args[k + 1];
    }
    return error("#N/A");
  } }],
  ["AND", { run: (args) => logical(args, true) }],
  ["OR", { run: (args) => logical(args, false) }],
  ["NOT", { run: (args) => { if (args.length !== 1) return error("#N/A"); const bool = toBool(args[0]); return isError(bool) ? bool : !bool; } }],
  ["IFERROR", { run: (args) => (args.length < 1 || args.length > 2 ? error("#N/A") : isError(single(args[0])) ? args[1] ?? null : args[0]) }],
  ["IFNA", { run: (args) => { if (args.length !== 2) return error("#N/A"); const value = single(args[0]); return isError(value) && value.error === "#N/A" ? args[1] : args[0]; } }],
  ["SWITCH", { run: (args) => {
    if (args.length < 3) return error("#N/A");
    const subject = single(args[0]);
    if (isError(subject)) return subject;
    let k = 1;
    for (; k + 1 < args.length; k += 2) {
      const option = single(args[k]);
      if (isError(option)) return option;
      if (typeof option === typeof subject && compare(subject, option) === 0) return args[k + 1];
    }
    return k < args.length ? args[k] : error("#N/A");
  } }],
  ["ISBLANK", { run: (args) => (args.length !== 1 ? error("#N/A") : isBlank(single(args[0]))) }],
  ["ISNUMBER", { run: (args) => (args.length !== 1 ? error("#N/A") : typeof single(args[0]) === "number") }],
  ["ISTEXT", { run: (args) => (args.length !== 1 ? error("#N/A") : typeof single(args[0]) === "string") }],
  ["ISERROR", { run: (args) => (args.length !== 1 ? error("#N/A") : isError(single(args[0]))) }],
  ["ISNA", { run: (args) => { if (args.length !== 1) return error("#N/A"); const value = single(args[0]); return isError(value) && value.error === "#N/A"; } }],
  ["NA", { run: (args) => error("#N/A") }],
  ["ROW", place((area) => area.top)],
  ["COLUMN", place((area) => area.left)],
  ["ROWS", size((area) => area.height)],
  ["COLUMNS", size((area) => area.width)],
]);

export const lookupFunction = (name) => FUNCTIONS.get(name.toUpperCase()) ?? null;

export const functionNames = () => [...FUNCTIONS.keys()];

