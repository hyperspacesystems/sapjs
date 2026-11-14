// The engine's one style form: a CSS string or a { property: value } object in, a canonical
// "prop:value;prop:value" string (STYLE_PROPERTIES order) or undefined out.

import { filterStyle, STYLE_PROPERTIES } from "./codec/styles.js";

const BASIC = {
  black: "#000000",
  silver: "#c0c0c0",
  gray: "#808080",
  white: "#ffffff",
  maroon: "#800000",
  red: "#ff0000",
  purple: "#800080",
  fuchsia: "#ff00ff",
  green: "#008000",
  lime: "#00ff00",
  olive: "#808000",
  yellow: "#ffff00",
  navy: "#000080",
  blue: "#0000ff",
  teal: "#008080",
  aqua: "#00ffff",
};

const SIDES = ["border-top", "border-right", "border-bottom", "border-left"];

const known = (name) => Object.prototype.hasOwnProperty.call(BASIC, name);

const colorOf = (value) => {
  const lower = value.toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(lower)) {
    const hex = lower.slice(1);
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
  }
  if (/^#[0-9a-f]{6}$/.test(lower)) return lower;
  const rgb = /^rgb\((\d{1,3}), ?(\d{1,3}), ?(\d{1,3})\)$/.exec(lower);
  if (rgb) {
    const parts = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    if (parts.every((part) => part <= 255)) {
      return `#${parts.map((part) => part.toString(16).padStart(2, "0")).join("")}`;
    }
    return value;
  }
  if (known(lower)) return BASIC[lower];
  return value;
};

const singleColor = (value) => {
  const lower = value.toLowerCase();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(lower)) return colorOf(lower);
  if (/^rgb\(/.test(lower)) {
    const color = colorOf(lower);
    return color.startsWith("#") ? color : null;
  }
  if (known(lower)) return BASIC[lower];
  return null;
};

// The same spelling rule for one declaration: [property, value] in, [property, value] or null
// (left out) out.
export function cleanDeclaration(property, value) {
  if (typeof value !== "string") return null;
  if (property === "font-weight") {
    const lower = value.toLowerCase();
    if (lower === "bold" || lower === "bolder") return ["font-weight", "bold"];
    if (lower === "normal" || lower === "400") return null;
    if (/^\d+$/.test(lower) && Number(lower) >= 700) return ["font-weight", "bold"];
    return ["font-weight", value];
  }
  if (property === "color" || property === "background-color") return [property, colorOf(value)];
  if (property === "background") {
    const color = singleColor(value);
    return color === null ? ["background", value] : ["background-color", color];
  }
  return [property, value];
}

// A style string cut into declarations the way CSS does: at a ";" that is outside quotes and
// outside parentheses, so a URL or a string in a value keeps its ";".
export function splitDeclarations(css) {
  const out = [];
  let start = 0;
  let quote = null;
  let depth = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth += 1;
    else if (ch === ")" && depth > 0) depth -= 1;
    else if (ch === ";" && depth === 0) {
      out.push(css.slice(start, i));
      start = i + 1;
    }
  }
  out.push(css.slice(start));
  return out;
}

const pair = (declaration) => {
  let quote = null;
  let depth = 0;
  for (let i = 0; i < declaration.length; i++) {
    const ch = declaration[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth += 1;
    else if (ch === ")" && depth > 0) depth -= 1;
    else if (ch === ":" && depth === 0) return [declaration.slice(0, i), declaration.slice(i + 1)];
  }
  return [declaration, ""];
};

const plainPairs = (input) => {
  let text;
  if (typeof input === "string") text = input;
  else if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    text = Object.keys(input)
      .filter((property) => typeof input[property] === "string")
      .map((property) => `${property}:${input[property]}`)
      .join(";");
  } else return [];
  const filtered = filterStyle(text);
  return filtered === undefined ? [] : splitDeclarations(filtered).map(pair);
};

export function cleanStyle(input) {
  const kept = new Map();
  for (const [property, value] of plainPairs(input)) {
    const cleaned = cleanDeclaration(property, value);
    if (cleaned === null) {
      kept.delete(property);
      continue;
    }
    if (cleaned[0] === "border") {
      kept.delete("border");
      for (const side of SIDES) kept.set(side, cleaned[1]);
    } else kept.set(cleaned[0], cleaned[1]);
  }
  const sides = SIDES.map((side) => kept.get(side));
  const allSides = sides.every((value) => value !== undefined);
  const equal = allSides && sides.every((value) => value === sides[0]);
  const pairs = [];
  if (equal) pairs.push(["border", sides[0]]);
  else for (const side of SIDES) if (kept.get(side) !== undefined) pairs.push([side, kept.get(side)]);
  for (const [property, value] of kept) if (!SIDES.includes(property)) pairs.push([property, value]);
  const ordered = pairs.slice().sort((a, b) => STYLE_PROPERTIES.indexOf(a[0]) - STYLE_PROPERTIES.indexOf(b[0]));
  return ordered.length === 0 ? undefined : ordered.map(([property, value]) => `${property}:${value}`).join(";");
}

const BORDER_SIDES = ["border-top", "border-right", "border-bottom", "border-left"];

const BORDER_FAMILY = new Set([...BORDER_SIDES, "border", "border-width", "border-style", "border-color"]);

// Does the property name of a declaration overlap one of the listed properties? Either it is one of
// them, or it is a shorthand that covers one.
const overlapsListed = (property) => {
  if (STYLE_PROPERTIES.includes(property)) return true;
  if (BORDER_FAMILY.has(property)) return true;
  if (BORDER_SIDES.some((side) => property.startsWith(`${side}-`))) return true;
  if (property.startsWith("background-")) return true;
  if (property === "font") return true;
  return property.startsWith("text-decoration-");
};

// The property name of one declaration, lowercased.
export const declarationProperty = (declaration) => pair(declaration)[0].trim().toLowerCase();

const declarationsOf = (css) => {
  const out = [];
  for (const declaration of splitDeclarations(css)) {
    const trimmed = declaration.trim();
    if (trimmed === "") continue;
    const [name, value] = pair(trimmed);
    out.push([name.trim().toLowerCase(), value, trimmed]);
  }
  return out;
};

// A style is mixed when a declaration the engine does not write sits on a family the rules do write:
// it cannot be canonicalized without changing what it means, so it is kept exactly as written.
export function isMixedStyle(css) {
  if (typeof css !== "string") return false;
  for (const [name, , trimmed] of declarationsOf(css)) {
    if (filterStyle(trimmed) !== undefined) continue;
    if (overlapsListed(name)) return true;
  }
  return false;
}

// cleanStyle for the declarations the engine writes, and every declaration it does not write kept
// exactly as it came in, trimmed and in its own order, after the canonical part. A mixed style is
// returned as written, so canonStyle is a fixed point of its own output.
export function canonStyle(css) {
  if (typeof css !== "string") return undefined;
  if (isMixedStyle(css)) {
    const parts = declarationsOf(css).map(([, , trimmed]) => trimmed);
    return parts.length === 0 ? undefined : parts.join(";");
  }
  const canonical = [];
  const kept = [];
  for (const declaration of splitDeclarations(css)) {
    const trimmed = declaration.trim();
    if (trimmed === "") continue;
    if (filterStyle(trimmed) === undefined) kept.push(trimmed);
    else canonical.push(trimmed);
  }
  const clean = cleanStyle(canonical.join(";"));
  const parts = [];
  if (clean !== undefined) parts.push(clean);
  if (kept.length > 0) parts.push(kept.join(";"));
  return parts.length === 0 ? undefined : parts.join(";");
}

const named = (property) => (property === "background" ? "background-color" : property);

const covers = (name, property) => {
  if (name === property) return true;
  if (property === "background-color" && name === "background") return true;
  return false;
};

// Y2: an edit never expands a shorthand or drops a declaration it does not name. The new declaration
// is appended after every other one, so it wins over a shorthand before it in CSS.
const remainder = () => [];

// A style map applied to a mixed style: a declaration whose property the map names goes, a kept
// `background` shorthand goes when the map names the background colour, and the new declaration is
// appended after every other one. Nothing else is expanded or dropped.
export function mixedNext(css, changes) {
  let list = declarationsOf(css);
  const keys = Object.keys(changes).sort((a, b) => STYLE_PROPERTIES.indexOf(named(a)) - STYLE_PROPERTIES.indexOf(named(b)));
  for (const key of keys) {
    const property = named(key);
    const next = [];
    for (const [name, value, trimmed] of list) {
      if (!covers(name, property)) next.push([name, value, trimmed]);
      else for (const [left, text] of remainder(name, value, property)) next.push([left, value, text]);
    }
    list = next;
    if (changes[key] === null) continue;
    const cleaned = cleanDeclaration(key, changes[key]);
    if (cleaned !== null) list.push([cleaned[0], cleaned[1], `${cleaned[0]}:${cleaned[1]}`]);
  }
  return list.length === 0 ? undefined : list.map(([, , trimmed]) => trimmed).join(";");
}

// A row's whole style: a height in pixels is written first, everything else kept as written, so a
// row's style has one form the engine writes and an inverse can carry it back byte for byte.
export function canonRowStyle(css) {
  if (typeof css !== "string") return undefined;
  const kept = [];
  let height = null;
  for (const [name, value, trimmed] of declarationsOf(css)) {
    if (height === null && name === "height" && /^\d+px$/.test(value.trim())) {
      height = trimmed;
      continue;
    }
    kept.push(trimmed);
  }
  const parts = height === null ? kept : [height, ...kept];
  return parts.length === 0 ? undefined : parts.join(";");
}

const PASTED_DEFAULTS = new Set([
  "color:#000000",
  "background-color:#ffffff",
  "font-style:normal",
  "text-decoration:none",
  "white-space:normal",
]);

// cleanStyle, then the defaults office apps put on every pasted cell are dropped.
export function pasteStyle(css) {
  const clean = cleanStyle(css);
  if (clean === undefined) return undefined;
  const kept = splitDeclarations(clean).filter((declaration) => !PASTED_DEFAULTS.has(declaration));
  return kept.length === 0 ? undefined : kept.join(";");
}
