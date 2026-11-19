// Text a person types or reads in a locale, turned to and from the neutral text the file keeps.
// The grid converts at its edges only: what a person types goes through `neutralInput` before
// `parseInput`, and what the cell editor shows goes through `localEdit` after `editText`. Nothing
// stored changes, so a file saved under one locale is byte-identical under another.
import { tokenize } from "./formula/text.js";
import { parseInput } from "./input.js";
import { EN_US } from "./locales.js";

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isNeutral = (locale) => locale === EN_US || (locale.point === "." && locale.separator === "," && Object.keys(locale.functions).length === 0);

const reverse = new WeakMap();
function englishNames(locale) {
  let map = reverse.get(locale);
  if (map === undefined) {
    map = new Map(Object.entries(locale.functions).map(([en, local]) => [local.toUpperCase(), en]));
    reverse.set(locale, map);
  }
  return map;
}

// The neutral formula as a person in this locale reads it: local function names and booleans, the
// local decimal mark and argument separator. Text in quotes and references are left as they are.
export function toLocalFormula(f, locale) {
  if (isNeutral(locale) || typeof f !== "string" || f[0] !== "=") return f;
  const body = f.slice(1);
  let out = "";
  let at = 0;
  for (const token of tokenize(body)) {
    const text = body.slice(token.start, token.end);
    let local = text;
    if (token.type === "name") local = locale.functions[token.value] ?? text;
    else if (token.type === "bool") local = token.value ? locale.bools[0] : locale.bools[1];
    else if (token.type === "num") local = text.replace(".", locale.point);
    else if (token.type === "punct" && token.value === ",") local = locale.separator;
    out += body.slice(at, token.start) + local;
    at = token.end;
  }
  return "=" + out + body.slice(at);
}

const NAME = /^[\p{L}_][\p{L}\p{N}_.]*/u;

// What a person in this locale typed as a formula, in the neutral form; null when it holds an
// English "," between arguments in a locale that writes ";", which would otherwise be read as a
// different formula. Text in quotes and quoted tab names are copied as they are.
export function fromLocalFormula(text, locale) {
  if (isNeutral(locale) || text[0] !== "=") return text;
  const names = englishNames(locale);
  const bools = locale.bools.map((b) => b.toUpperCase());
  let out = "=";
  let i = 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < text.length && !(text[j] === ch && text[j + 1] !== ch)) j += text[j] === ch ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    // A number starts after an operator, a bracket, a separator or a space; a comma right after a
    // reference, ")" or text is never a decimal mark ("=ROUND(A1,2)" is an English comma).
    const opens = !/[\p{L}\p{N}_$)"']/u.test(text[i - 1] ?? "");
    if (/\d/.test(ch) || (ch === locale.point && opens && /\d/.test(text[i + 1] ?? ""))) {
      const number = new RegExp(`^\\d*(?:${escape(locale.point)}\\d+)?(?:[eE][+-]?\\d+)?`).exec(text.slice(i))[0] || ch;
      out += number.replace(locale.point, ".");
      i += number.length;
      continue;
    }
    const word = NAME.exec(text.slice(i))?.[0];
    if (word && !/[\p{L}\p{N}_$]/u.test(text[i - 1] ?? "")) {
      const after = text[i + word.length];
      const upper = word.toUpperCase();
      if (after === "(" && names.has(upper)) out += names.get(upper);
      else if (after !== "(" && after !== "!" && bools.includes(upper)) out += upper === bools[0] ? "TRUE" : "FALSE";
      else out += word;
      i += word.length;
      continue;
    }
    if (ch === locale.separator) out += ",";
    else if (ch === "," && locale.separator !== ",") return null;
    // A "." outside a name, a number or quotes is an English decimal mark or a grouping dot
    // ("=2.500*12"): neither may be read as the other.
    else if (ch === "." && locale.point !== ".") return null;
    else out += ch;
    i += 1;
  }
  return out;
}

const DATE_ORDER = (locale) => new RegExp(`^(\\d{1,2})${escape(locale.dateSep)}(\\d{1,2})(?:${escape(locale.dateSep)}(\\d{2,4}))?${locale.dateSep === "." ? "\\.?" : ""}(\\s+\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\s*[AaPp][Mm])?)?$`);

// What a person in this locale typed into a cell, as the text `parseInput` reads the same way in
// the neutral form: "1.234,56" is "1234.56", "5.3.2024" is "3/5/2024", "WAHR" is "TRUE", and a
// formula is translated, or null when it holds an English "," or ".". Text that would read as
// something else in the neutral form ("12.5" or "true" in German) is kept as text.
export function neutralInput(text, locale) {
  if (isNeutral(locale) || typeof text !== "string") return text;
  if (text[0] === "=") return fromLocalFormula(text.trim(), locale);
  const trimmed = text.trim();
  // Times and ISO dates read the same in every locale.
  if (/^\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?$/i.test(trimmed) || /^\d{4}-\d{1,2}-\d{1,2}$/.test(trimmed)) return text;
  if (trimmed[0] === "'") return text;
  const upper = trimmed.toUpperCase();
  if (upper === locale.bools[0].toUpperCase()) return "TRUE";
  if (upper === locale.bools[1].toUpperCase()) return "FALSE";
  const group = locale.group === " " ? "[\\u202f\\u00a0 ]" : escape(locale.group);
  const currency = escape(locale.currency);
  const bare = trimmed.replace(new RegExp(`^([+-]?)\\s*${currency}\\s*|\\s*${currency}$`), "$1");
  const number = new RegExp(`^([+-]?)([1-9]\\d{0,2}(?:${group}\\d{3})+|\\d+)?(?:${escape(locale.point)}(\\d+))?([eE][+-]?\\d+)?(\\s*%)?$`).exec(bare);
  if (number && (number[2] || number[3])) return `${number[1]}${(number[2] ?? "0").replace(/\D/g, "")}${number[3] ? "." + number[3] : ""}${number[4] ?? ""}${number[5] ? "%" : ""}`;
  const date = DATE_ORDER(locale).exec(trimmed);
  if (date) return `${date[2]}/${date[1]}${date[3] ? "/" + date[3] : ""}${date[4] ?? ""}`;
  // Anything else that the neutral form would read as a number or a date stays text.
  return typeof parseInput(text, { today: 0 }).content === "string" ? text : "'" + text;
}

// The cell editor's text for a cell, in this locale: `text` is `editText`'s neutral text for
// `content` (a number, a boolean, text or { f }).
export function localEdit(text, content, locale) {
  if (isNeutral(locale)) return text;
  if (content !== null && typeof content === "object" && typeof content.f === "string") return toLocalFormula(text, locale);
  if (typeof content === "boolean") return content ? locale.bools[0] : locale.bools[1];
  if (typeof content === "string") {
    if (text[0] === "'") return text;
    // A text that this locale would read back as something else keeps a leading quote.
    return neutralInput(text, locale) === text ? text : "'" + text;
  }
  if (typeof content !== "number") return text;
  const date = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/.exec(text);
  if (date) return `${date[2]}${locale.dateSep}${date[1]}${locale.dateSep}${date[3]}${date[4]}`;
  return text.replace(".", locale.point);
}
