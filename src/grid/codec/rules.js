// The rules a table saves in its <template rules> block (GRAMMAR.md, "Rules"): checkboxes,
// dropdowns, conditional formats, color scales and charts. `ruleProblem` is the shape both the strict
// reader and the writer hold a rule to; what its ranges and formula mean is checked where rules are
// edited.

export const RULE_KINDS = ["check", "list", "when", "scale", "chart"];
// The optional attributes, in the order the writer writes them and the reader reads them.
export const RULE_FIELDS = ["items", "source", "open", "test", "a", "b", "f", "style", "low", "mid", "high", "type", "title", "stacked", "series"];
// The attributes written bare, with no value.
export const RULE_FLAGS = new Set(["open", "stacked"]);
export const CHART_TYPES = ["column", "bar", "line", "area", "pie", "scatter"];
const STACKING = new Set(["column", "bar", "area"]);
// What each conditional-format test compares the cell with.
export const RULE_TESTS = {
  gt: ["a"], ge: ["a"], lt: ["a"], le: ["a"], eq: ["a"], ne: ["a"],
  contains: ["a"], starts: ["a"], ends: ["a"],
  between: ["a", "b"], outside: ["a", "b"],
  empty: [], filled: [], duplicate: [], unique: [],
  formula: ["f"],
};
export const MAX_ITEMS = 500;
export const MAX_ITEM_LENGTH = 255;
export const MAX_TITLE_LENGTH = 255;

const COLOR = /^#[0-9a-f]{6}$/;
const UNSAFE = /[\r\0]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const text = (value) => typeof value === "string" && value !== "";

function itemsProblem(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) return `a list rule has 1 to ${MAX_ITEMS} items`;
  for (const item of items) {
    if (typeof item !== "string" || item === "" || item.length > MAX_ITEM_LENGTH) return `a list item is 1 to ${MAX_ITEM_LENGTH} characters`;
    if (UNSAFE.test(item)) return "a list item holds a carriage return, a NUL or half a character";
  }
  return null;
}

const BOX = /^([A-Z]{1,3})([1-9][0-9]{0,6})(?::([A-Z]{1,3})([1-9][0-9]{0,6}))?$/;
const letters = (name) => [...name].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export const MAX_BOX_COL = 16383;

// A chart's box as 0-based edges, or null: one cell or one closed range on its own tab, top-left
// cell first, no $, within column XFD and row 9999999.
export function chartBox(range) {
  const m = typeof range === "string" ? BOX.exec(range) : null;
  if (m === null) return null;
  const box = { left: letters(m[1]), top: Number(m[2]) - 1, right: letters(m[3] ?? m[1]), bottom: Number(m[4] ?? m[2]) - 1 };
  return box.right <= MAX_BOX_COL && box.left <= box.right && box.top <= box.bottom ? box : null;
}

// Why a rule is not one the file may hold, or null.
export function ruleProblem(rule) {
  if (rule === null || typeof rule !== "object" || Array.isArray(rule)) return "a rule is a record";
  if (!RULE_KINDS.includes(rule.kind)) return `unknown rule kind ${JSON.stringify(rule.kind)}`;
  for (const key of ["id", "pos", "range"]) if (!text(rule[key])) return `a rule has no ${key}`;
  const allowed = new Set(["id", "pos", "kind", "range"]);
  const need = (...keys) => {
    for (const key of keys) {
      allowed.add(key);
      if (!text(rule[key])) return `a ${rule.kind} rule has no ${key}`;
    }
    return null;
  };
  let problem = null;
  if (rule.kind === "list") {
    allowed.add("items").add("source").add("open");
    if ((rule.items === undefined) === (rule.source === undefined)) return "a list rule has items or a source, not both";
    if (rule.items !== undefined) problem = itemsProblem(rule.items);
    else if (!text(rule.source)) problem = "a list rule has no source";
    if (rule.open !== undefined && rule.open !== true) problem = "open is true or absent";
  } else if (rule.kind === "when") {
    const compared = RULE_TESTS[rule.test];
    if (compared === undefined || !Object.hasOwn(RULE_TESTS, rule.test)) return `unknown rule test ${JSON.stringify(rule.test)}`;
    allowed.add("test");
    problem = need("style", ...compared);
  } else if (rule.kind === "chart") {
    allowed.add("source").add("type").add("title").add("stacked").add("series");
    if (chartBox(rule.range) === null) return "a chart's range is A1 or A1:B2, top-left cell first, within XFD and row 9999999, with no $";
    if (!text(rule.source)) return "a chart rule has no source";
    if (!CHART_TYPES.includes(rule.type)) return `unknown chart type ${JSON.stringify(rule.type)}`;
    if (rule.title !== undefined && (!text(rule.title) || rule.title.length > MAX_TITLE_LENGTH || UNSAFE.test(rule.title))) {
      problem = `a chart title is 1 to ${MAX_TITLE_LENGTH} characters with no carriage return, NUL or half a character`;
    }
    if (rule.stacked !== undefined && (rule.stacked !== true || !STACKING.has(rule.type))) problem = "stacked is true or absent, and only on a column, bar or area chart";
    if (rule.series !== undefined && rule.series !== "rows") problem = "series is rows or absent";
  } else if (rule.kind === "scale") {
    problem = need("low", "high");
    if (rule.mid !== undefined) allowed.add("mid");
    for (const key of ["low", "mid", "high"]) if (problem === null && rule[key] !== undefined && !COLOR.test(rule[key])) problem = `${key} is a color written #rrggbb`;
  }
  if (problem !== null) return problem;
  for (const key of Object.keys(rule)) if (!allowed.has(key)) return `${key} is not a field of a ${rule.kind} rule`;
  for (const key of ["source", "test", "a", "b", "f", "style", "title"]) if (rule[key] !== undefined && typeof rule[key] !== "string") return `${key} is text`;
  return null;
}

// A copy of a rule with its fields in the order the file writes them, so two copies of one rule
// compare equal as JSON text.
export function copyRule(rule) {
  const copy = { id: rule.id, pos: rule.pos, kind: rule.kind, range: rule.range };
  for (const field of RULE_FIELDS) if (rule[field] !== undefined) copy[field] = field === "items" ? [...rule[field]] : rule[field];
  return copy;
}

// Rules in the order the file keeps them: by key, then by id, so two coworkers' rules with one key
// sort the same everywhere.
export const byRule = (a, b) => (a.pos !== b.pos ? (a.pos < b.pos ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export const sameRule = (a, b) => JSON.stringify(a ? copyRule(a) : null) === JSON.stringify(b ? copyRule(b) : null);
