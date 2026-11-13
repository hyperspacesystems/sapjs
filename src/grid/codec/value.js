// The format's one value rule, shared by the writer, the reader, every host and
// the formula engine. JavaScript and Go must agree on every line of it.

const NUMBER = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;

export const MAX_DIGITS = 15;

export function significantDigits(text) {
  return text.replace(/^-/, "").replace(".", "").replace(/^0+/, "").replace(/0+$/, "").length;
}

export function typed(text, forceText = false) {
  if (text === "") return null;
  if (forceText) return text;
  if (text === "TRUE") return true;
  if (text === "FALSE") return false;
  if (!NUMBER.test(text)) return text;
  const digits = significantDigits(text);
  if (digits > MAX_DIGITS) return text;
  const number = Number(text);
  if (!Number.isFinite(number) || (number === 0 && digits > 0)) return text;
  return number === 0 ? 0 : number;
}

export function shown(value) {
  if (value === null || value === undefined) return "";
  if (value === true) return "TRUE";
  if (value === false) return "FALSE";
  if (typeof value === "string") return value;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`grid codec: ${String(value)} is not a finite number, a boolean or text`);
  }
  if (value === 0) return "0";
  const [mantissa, exponent] = value.toExponential(MAX_DIGITS - 1).split("e");
  const sign = mantissa[0] === "-" ? "-" : "";
  const digits = mantissa.replace("-", "").replace(".", "").replace(/0+$/, "");
  const point = Number(exponent) + 1;
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  const whole = digits.padEnd(point, "0").slice(0, point);
  const fraction = digits.slice(point);
  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}

export function cellValue(cell) {
  if (!cell || cell.hidden) return null;
  return typed(cell.v ?? cell.text, cell.t === true);
}
