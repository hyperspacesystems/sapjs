// The values a formula works with: a number, a text, true or false, null for a blank, an error
// `{ error: code }` (with a `reason` only where the engine names one, such as a cycle), and a range
// (`isRange`) that only a function takes whole. Coercion follows Google Sheets; a text that is not a
// number never silently becomes 0.

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export const ERRORS = ["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#ERROR!"];

export const error = (code, reason) => (reason === undefined ? { error: code } : { error: code, reason });

export const isError = (value) => value !== null && typeof value === "object" && typeof value.error === "string";

export const isBlank = (value) => value === null || value === undefined;

export const isRange = (value) => value !== null && typeof value === "object" && value.isRange === true;

// A number, or #VALUE! for a text that is not one. A blank is 0, true is 1.
export function toNumber(value) {
  if (isError(value)) return value;
  if (isRange(value)) return value.height === 1 && value.width === 1 ? toNumber(value.get(0, 0)) : error("#VALUE!");
  if (isBlank(value)) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  const text = value.trim();
  if (text === "") return 0;
  if (NUMBER.test(text)) return Number(text);
  return error("#VALUE!");
}

export function toText(value) {
  if (isError(value)) return value;
  if (isRange(value)) return value.height === 1 && value.width === 1 ? toText(value.get(0, 0)) : error("#VALUE!");
  if (isBlank(value)) return "";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return numberText(value);
}

export function toBool(value) {
  if (isError(value)) return value;
  if (isRange(value)) return value.height === 1 && value.width === 1 ? toBool(value.get(0, 0)) : error("#VALUE!");
  if (isBlank(value)) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = value.trim().toUpperCase();
  if (text === "TRUE") return true;
  if (text === "FALSE") return false;
  return error("#VALUE!");
}

// A single value from a range that stands where one value goes (`=A1:A3` in a cell): its only cell,
// else #VALUE!. v1 has no spilled arrays.
export const single = (value) => (isRange(value) ? (value.height === 1 && value.width === 1 ? value.get(0, 0) : error("#VALUE!")) : value);

// A number as a formula's text shows it: up to 15 significant digits, no exponent below 1e21.
export function numberText(value) {
  if (!Number.isFinite(value)) return "#NUM!";
  if (Object.is(value, -0) || value === 0) return "0";
  return String(Number(value.toPrecision(15)));
}

// A blank takes the kind of the value it is compared with.
const blankAs = (other) => (typeof other === "string" ? "" : typeof other === "boolean" ? false : 0);

const rank = (value) => (typeof value === "number" ? 0 : typeof value === "string" ? 1 : 2);

// Negative when left sorts before right. Text compares without case; numbers sort before text and
// text before booleans, as in Sheets.
export function compare(left, right) {
  left = single(left);
  right = single(right);
  if (isError(left)) return left;
  if (isError(right)) return right;
  const a = isBlank(left) ? blankAs(right) : left;
  const b = isBlank(right) ? blankAs(left) : right;
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  // Numbers compare at 15 significant digits, as SUM rounds and Sheets compares: 0.1+0.2 = 0.3.
  if (ra === 0) return Number(a.toPrecision(15)) - Number(b.toPrecision(15));
  if (ra === 1) {
    const la = a.toLowerCase();
    const lb = b.toLowerCase();
    return la < lb ? -1 : la > lb ? 1 : 0;
  }
  return (a ? 1 : 0) - (b ? 1 : 0);
}

// A number that left the finite range is #NUM!, as Sheets shows it.
export const finite = (value) => (typeof value === "number" && !Number.isFinite(value) ? error("#NUM!") : value);

function arithmetic(op, left, right) {
  const a = toNumber(left);
  if (isError(a)) return a;
  const b = toNumber(right);
  if (isError(b)) return b;
  switch (op) {
    case "+":
      return finite(a + b);
    case "-":
      return finite(a - b);
    case "*":
      return finite(a * b);
    case "/":
      return b === 0 ? error("#DIV/0!") : finite(a / b);
    case "^":
      return a === 0 && b < 0 ? error("#DIV/0!") : finite(Math.pow(a, b));
    default:
      return error("#VALUE!");
  }
}

function concatenate(left, right) {
  const a = toText(left);
  if (isError(a)) return a;
  const b = toText(right);
  if (isError(b)) return b;
  return a + b;
}

function comparison(op, left, right) {
  const diff = compare(left, right);
  if (isError(diff)) return diff;
  switch (op) {
    case "=":
      return diff === 0;
    case "<>":
      return diff !== 0;
    case "<":
      return diff < 0;
    case ">":
      return diff > 0;
    case "<=":
      return diff <= 0;
    case ">=":
      return diff >= 0;
    default:
      return error("#VALUE!");
  }
}

export function applyBinary(op, left, right) {
  if (op === "&") return concatenate(left, right);
  if (op === "+" || op === "-" || op === "*" || op === "/" || op === "^") return arithmetic(op, left, right);
  return comparison(op, left, right);
}

export function negate(value) {
  const number = toNumber(value);
  return isError(number) ? number : -number;
}

export function percent(value) {
  const number = toNumber(value);
  return isError(number) ? number : number / 100;
}

// The same value: errors by code and reason, numbers by Object.is.
export const sameValue = (left, right) =>
  Object.is(left, right) || (isError(left) && isError(right) && left.error === right.error && left.reason === right.reason);
