// A second, independent implementation of the built-in number formats, for tests only: the
// digits of shown(value) as one scaled BigInt, rounded by BigInt arithmetic. It does not import
// src/grid/format.js, so a rounding mistake there shows up as a mismatch.

import { shown } from "../../../src/grid/codec/value.js";

const FAMILY = /^(\$?)(#,##0|0)(?:\.(0{1,15}))?(%?)$/;

function grouped(int) {
  let out = "";
  for (let i = 0; i < int.length; i++) {
    if (i > 0 && (int.length - i) % 3 === 0) out += ",";
    out += int[i];
  }
  return out;
}

export function oracleFormat(value, fmt) {
  const match = FAMILY.exec(fmt);
  if (!match || (match[1] && match[4])) return null;
  const text = shown(value);
  if (typeof value !== "number") return text;
  const [, currencyMark, code, zeros = "", percentMark] = match;
  const places = zeros.length;
  const negative = text.startsWith("-");
  const magnitude = negative ? text.slice(1) : text;
  const [whole, fraction = ""] = magnitude.split(".");
  const scale = fraction.length;
  const scaled = BigInt(whole + fraction) * (percentMark ? 100n : 1n);
  let units;
  if (scale >= places) {
    const factor = 10n ** BigInt(scale - places);
    units = scaled / factor;
    if ((scaled % factor) * 2n >= factor) units += 1n;
  } else {
    units = scaled * 10n ** BigInt(places - scale);
  }
  const digits = units.toString().padStart(places + 1, "0");
  const cut = digits.length - places;
  const int = digits.slice(0, cut);
  const frac = digits.slice(cut);
  const sign = negative && units !== 0n ? "-" : "";
  const body = code === "#,##0" ? grouped(int) : int;
  return sign + (currencyMark ? "$" : "") + body + (places ? "." + frac : "") + (percentMark ? "%" : "");
}
