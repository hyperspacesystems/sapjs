// VLOOKUP, HLOOKUP, XLOOKUP, LOOKUP, MATCH and INDEX, as Google Sheets computes them. A sorted
// search keeps the last place whose value is not past the key and stops at the first that is, so
// it finds what Sheets' binary search finds on sorted data. Only values of the key's kind (number,
// text, boolean) are compared; text compares without case.
import { asRange, compare, error, isBlank, isError, single, toBool, toNumber, wildcard } from "./values.js";

const kind = (value) => (typeof value === "number" ? "n" : typeof value === "string" ? "s" : typeof value === "boolean" ? "b" : null);

// The values of a one-row or one-column range, in order; null for a range of more than one of each.
function line(range) {
  if (range.height !== 1 && range.width !== 1) return null;
  const out = [];
  const length = Math.max(range.height, range.width);
  for (let k = 0; k < length; k++) out.push(range.height === 1 ? range.get(0, k) : range.get(k, 0));
  return out;
}

// The index of key in values, or -1. mode 0: equal (wildcards with `wild`); 1: equal or the next
// smaller in an ascending list; -1: equal or the next larger in a descending list.
function find(values, key, mode, wild = false) {
  const want = kind(key);
  // A blank key finds nothing, as in Sheets: it never matches an empty row or an error.
  if (want === null) return -1;
  if (mode === 0) {
    const pattern = wild && want === "s" ? wildcard(key) : null;
    return values.findIndex((value) => (pattern ? typeof value === "string" && pattern.test(value) : kind(value) === want && compare(value, key) === 0));
  }
  let found = -1;
  for (let k = 0; k < values.length; k++) {
    if (kind(values[k]) !== want) continue;
    const diff = compare(values[k], key);
    if (mode === 1 ? diff > 0 : diff < 0) break;
    found = k;
  }
  return found;
}

// The nearest match either side, for XLOOKUP's modes -1 and 1 on a list in any order.
function nearest(values, key, side) {
  const want = kind(key);
  let found = -1;
  for (let k = 0; k < values.length; k++) {
    if (kind(values[k]) !== want) continue;
    const diff = compare(values[k], key);
    if (diff === 0) return k;
    if (side < 0 ? diff > 0 : diff < 0) continue;
    if (found === -1 || (side < 0 ? compare(values[k], values[found]) > 0 : compare(values[k], values[found]) < 0)) found = k;
  }
  return found;
}

// A part of a range: rows top.., columns left.., as a range.
function part(range, top, left, height, width) {
  const innerHeight = Math.max(0, Math.min(height, (range.innerHeight ?? range.height) - top));
  const innerWidth = Math.max(0, Math.min(width, (range.innerWidth ?? range.width) - left));
  return {
    isRange: true,
    height,
    width,
    innerHeight,
    innerWidth,
    outside: height * width - innerHeight * innerWidth,
    get: (i, j) => (i < height && j < width ? range.get(top + i, left + j) : null),
    forEach(visit) {
      for (let i = 0; i < innerHeight; i++) for (let j = 0; j < innerWidth; j++) visit(range.get(top + i, left + j), i, j);
    },
  };
}

const whole = (count) => (args) => {
  if (args.length < count) return error("#N/A");
  for (const arg of args) if (isError(arg)) return arg;
  return null;
};

const position = (value) => {
  const number = toNumber(single(value));
  return isError(number) ? number : Math.trunc(number);
};

// VLOOKUP and HLOOKUP: `across` is HLOOKUP, which searches the first row.
function tableLookup(across) {
  return {
    run(args) {
      if (args.length < 3 || args.length > 4) return error("#N/A");
      const key = single(args[0]);
      if (isError(key)) return key;
      if (isError(args[1])) return args[1];
      const table = asRange(args[1]);
      const index = position(args[2]);
      if (isError(index)) return index;
      const sorted = args.length === 4 ? toBool(single(args[3])) : true;
      if (isError(sorted)) return sorted;
      if (index < 1) return error("#VALUE!");
      if (index > (across ? table.height : table.width)) return error("#REF!");
      const keys = across ? line(part(table, 0, 0, 1, table.width)) : line(part(table, 0, 0, table.height, 1));
      const at = find(keys, key, sorted ? 1 : 0, true);
      if (at === -1) return error("#N/A");
      return across ? table.get(index - 1, at) : table.get(at, index - 1);
    },
  };
}

export const LOOKUP_FUNCTIONS = [
  ["VLOOKUP", tableLookup(false)],
  ["HLOOKUP", tableLookup(true)],
  ["MATCH", { run: (args) => {
    if (args.length < 2 || args.length > 3) return error("#N/A");
    const failure = whole(2)(args);
    if (failure) return failure;
    const key = single(args[0]);
    if (isError(key)) return key;
    const values = line(asRange(args[1]));
    if (values === null) return error("#N/A");
    const type = args.length === 3 ? position(args[2]) : 1;
    if (isError(type)) return type;
    const at = find(values, key, Math.sign(type), true);
    return at === -1 ? error("#N/A") : at + 1;
  } }],
  // A row or column of 0 picks the whole column or row; v1 has no spilled arrays, so a cell shows
  // such a pick only when it is one cell, and a function such as SUM takes it whole.
  ["INDEX", { run: (args) => {
    if (args.length < 1 || args.length > 3) return error("#N/A");
    if (isError(args[0])) return args[0];
    const range = asRange(args[0]);
    let row = args.length > 1 ? position(args[1]) : 0;
    let col = args.length > 2 ? position(args[2]) : 0;
    if (isError(row)) return row;
    if (isError(col)) return col;
    if (args.length === 2 && range.height === 1) [row, col] = [1, row];
    if (row < 0 || col < 0 || row > range.height || col > range.width) return error("#REF!");
    if (row > 0 && col > 0) return range.get(row - 1, col - 1);
    if (row > 0 && range.width === 1) return range.get(row - 1, 0);
    if (col > 0 && range.height === 1) return range.get(0, col - 1);
    return part(range, row > 0 ? row - 1 : 0, col > 0 ? col - 1 : 0, row > 0 ? 1 : range.height, col > 0 ? 1 : range.width);
  } }],
  ["XLOOKUP", { run: (args) => {
    if (args.length < 3 || args.length > 6) return error("#N/A");
    const key = single(args[0]);
    if (isError(key)) return key;
    if (isError(args[1])) return args[1];
    if (isError(args[2])) return args[2];
    const values = line(asRange(args[1]));
    if (values === null) return error("#VALUE!");
    const result = asRange(args[2]);
    // The result range runs the lookup range's length, or the answer would come from another row.
    if ((asRange(args[1]).width === 1 ? result.height : result.width) !== values.length) return error("#VALUE!");
    const mode = args.length > 4 ? position(args[4]) : 0;
    const search = args.length > 5 ? position(args[5]) : 1;
    if (isError(mode)) return mode;
    if (isError(search)) return search;
    if (![0, 1, -1, 2].includes(mode) || ![1, -1, 2, -2].includes(search)) return error("#VALUE!");
    let at;
    if (mode === 0 || mode === 2) {
      const order = search < 0 ? values.map((_, k) => values.length - 1 - k) : values.map((_, k) => k);
      const pattern = mode === 2 && typeof key === "string" ? wildcard(key) : null;
      at = order.find((k) => (pattern ? typeof values[k] === "string" && pattern.test(values[k]) : kind(values[k]) === kind(key) && compare(values[k], key) === 0)) ?? -1;
    } else at = nearest(values, key, mode);
    if (at === -1) return args.length > 3 && !isBlank(args[3]) ? args[3] : error("#N/A");
    const byRow = asRange(args[1]).width === 1;
    if (byRow) return result.width === 1 ? result.get(at, 0) : part(result, at, 0, 1, result.width);
    return result.height === 1 ? result.get(0, at) : part(result, 0, at, result.height, 1);
  } }],
  // LOOKUP without a result range answers from the last row or column of the search range.
  ["LOOKUP", { run: (args) => {
    if (args.length < 2 || args.length > 3) return error("#N/A");
    const failure = whole(2)(args);
    if (failure) return failure;
    const key = single(args[0]);
    if (isError(key)) return key;
    const search = asRange(args[1]);
    const across = search.width > search.height;
    const keys = line(across ? part(search, 0, 0, 1, search.width) : part(search, 0, 0, search.height, 1));
    const at = find(keys, key, 1);
    if (at === -1) return error("#N/A");
    if (args.length === 2) return across ? search.get(search.height - 1, at) : search.get(at, search.width - 1);
    const result = line(asRange(args[2]));
    if (result === null) return error("#N/A");
    return at < result.length ? result[at] : error("#N/A");
  } }],
];
