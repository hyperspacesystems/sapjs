// The strict reader: accepts a grid region if and only if it fits GRAMMAR.md,
// which is exactly what write.js emits. Anything else is a CodecMiss, and the
// caller reads that table with a real HTML parser instead.

import { RULE_FIELDS, ruleProblem } from "./rules.js";

export class CodecMiss extends Error {
  constructor(message) {
    super(message);
    this.name = "CodecMiss";
  }
}

const MAX_COUNT_DIGITS = 7;
const NO_SINK = {};
const ATTR_REFS = /&amp;|&quot;|[&\r\0]/g;
const TEXT_REFS = /&amp;|&lt;|&gt;|[&>\r\0]/g;
const ATTR_DECODED = { "&amp;": "&", "&quot;": '"' };
const TEXT_DECODED = { "&amp;": "&", "&lt;": "<", "&gt;": ">" };

let cursor = 0;

function miss(why, at) {
  throw new CodecMiss(`grid codec: ${why} at ${at}`);
}

function decode(raw, refs, decoded, at) {
  return raw.replace(refs, (match) => decoded[match] ?? miss(`character ${JSON.stringify(match)} outside the grammar`, at));
}

function expect(src, i, literal) {
  if (!src.startsWith(literal, i)) miss(`expected ${JSON.stringify(literal)}`, i);
  return i + literal.length;
}

function skipSpace(src, i) {
  for (;;) {
    const c = src.charCodeAt(i);
    if (c !== 32 && c !== 10 && c !== 9) return i;
    i++;
  }
}

function flag(src, i, literal) {
  if (!src.startsWith(literal, i)) return false;
  const next = src.charCodeAt(i + literal.length);
  return next === 32 || next === 62;
}

function readAval(src, i) {
  const end = src.indexOf('"', i);
  if (end === -1) miss("open attribute value", i);
  cursor = end + 1;
  return decode(src.slice(i, end), ATTR_REFS, ATTR_DECODED, i);
}

function readCount(src, i, min) {
  let end = i;
  while (end - i <= MAX_COUNT_DIGITS) {
    const c = src.charCodeAt(end);
    if (c < 48 || c > 57) break;
    end++;
  }
  const digits = src.slice(i, end);
  if (digits.length === 0 || digits.length > MAX_COUNT_DIGITS) miss("bad count", i);
  if (digits.length > 1 && digits[0] === "0") miss("count with a leading zero", i);
  const value = Number(digits);
  if (value < min) miss(`count below ${min}`, i);
  cursor = end;
  return value;
}

function readCol(src, i) {
  i = expect(src, i, '<col data-id="');
  const col = { id: readAval(src, i) };
  i = expect(src, cursor, ' data-pos="');
  col.pos = readAval(src, i);
  i = cursor;
  if (src.startsWith(' fmt="', i)) {
    col.fmt = readAval(src, i + 6);
    i = cursor;
  }
  if (flag(src, i, " hidden")) {
    col.hidden = true;
    i += 7;
  }
  if (src.startsWith(' style="width:', i)) {
    col.width = readCount(src, i + 14, 0);
    i = expect(src, cursor, 'px"');
  }
  cursor = expect(src, i, ">");
  return col;
}

function readCell(src, i) {
  i = expect(src, i, "<td");
  const cell = {};
  let bare = true;
  if (flag(src, i, " n")) { cell.n = true; i += 2; bare = false; }
  if (flag(src, i, " t")) { cell.t = true; i += 2; bare = false; }
  if (src.startsWith(' f="', i)) { cell.f = readAval(src, i + 4); i = cursor; bare = false; }
  if (src.startsWith(' v="', i)) { cell.v = readAval(src, i + 4); i = cursor; bare = false; }
  if (src.startsWith(' fmt="', i)) { cell.fmt = readAval(src, i + 6); i = cursor; bare = false; }
  if (src.startsWith(' colspan="', i)) { cell.colspan = readCount(src, i + 10, 2); i = expect(src, cursor, '"'); bare = false; }
  if (src.startsWith(' rowspan="', i)) { cell.rowspan = readCount(src, i + 10, 2); i = expect(src, cursor, '"'); bare = false; }
  if (flag(src, i, " hidden")) { cell.hidden = true; i += 7; bare = false; }
  if (src.startsWith(' style="', i)) { cell.style = readAval(src, i + 8); i = cursor; bare = false; }
  i = expect(src, i, ">");
  const lt = src.indexOf("<", i);
  if (lt === -1) miss("open cell", i);
  const text = decode(src.slice(i, lt), TEXT_REFS, TEXT_DECODED, i);
  cursor = expect(src, lt, "</td>");
  if (cell.hidden && text !== "") miss("a hidden cell with text", i);
  if (bare && text === "") return null;
  return Object.assign({ text }, cell);
}

function readRow(src, i, frozen) {
  i = expect(src, i, '<tr data-id="');
  const row = { id: readAval(src, i) };
  i = expect(src, cursor, ' data-pos="');
  row.pos = readAval(src, i);
  i = cursor;
  if (frozen) row.frozen = true;
  if (flag(src, i, " hidden")) {
    row.hidden = true;
    i += 7;
  }
  if (src.startsWith(' style="', i)) {
    row.style = readAval(src, i + 8);
    i = cursor;
  }
  i = expect(src, i, ">");
  row.cells = [];
  while (!src.startsWith("</tr>", i)) {
    row.cells.push(readCell(src, i));
    i = cursor;
  }
  if (row.cells.length > 0 && row.cells[row.cells.length - 1] === null) miss("a row that ends with an empty cell", i);
  cursor = i + 5;
  return row;
}

function readGroup(src, i, frozen, sink, index) {
  const start = i;
  const close = frozen ? "</thead>" : "</tbody>";
  i = expect(src, i, frozen ? "<thead>" : "<tbody>");
  for (;;) {
    i = skipSpace(src, i);
    if (src.startsWith(close, i)) break;
    const rowStart = i;
    const row = readRow(src, i, frozen);
    i = cursor;
    sink.row?.(row, rowStart, i, index++);
  }
  cursor = i + close.length;
  sink.group?.(start, cursor, frozen);
  return index;
}

function readRule(src, i) {
  const start = i;
  i = expect(src, i, '<rule data-id="');
  const rule = { id: readAval(src, i) };
  rule.pos = readAval(src, expect(src, cursor, ' data-pos="'));
  rule.kind = readAval(src, expect(src, cursor, ' kind="'));
  rule.range = readAval(src, expect(src, cursor, ' range="'));
  i = cursor;
  for (const field of RULE_FIELDS) {
    if (field === "open") {
      if (flag(src, i, " open")) {
        rule.open = true;
        i += 5;
      }
      continue;
    }
    if (!src.startsWith(` ${field}="`, i)) continue;
    const raw = readAval(src, i + field.length + 3);
    i = cursor;
    if (field !== "items") {
      rule[field] = raw;
      continue;
    }
    let items = null;
    try {
      items = JSON.parse(raw);
    } catch {
      miss("rule items that are not JSON", start);
    }
    if (!Array.isArray(items) || JSON.stringify(items) !== raw) miss("rule items that are not a list written as the writer writes it", start);
    rule.items = items;
  }
  const problem = ruleProblem(rule);
  if (problem !== null) miss(problem, start);
  cursor = expect(src, i, "></rule>");
  return rule;
}

// Reads the grid that starts at `at` and returns the index just past "</table>".
// The sink is told about the table, each col, each row (with its cells and its
// byte range), each row group, each rule (with its byte range) and the rules
// block's byte range. Throws CodecMiss when the region does not fit.
export function scanGrid(src, at, sink = NO_SINK) {
  let i = expect(src, at, "<table grid");
  const table = {};
  if (src.startsWith(' freeze-cols="', i)) {
    table.freezeCols = readCount(src, i + 14, 1);
    i = expect(src, cursor, '"');
  }
  if (flag(src, i, " stale")) {
    table.stale = true;
    i += 6;
  }
  i = expect(src, i, ">");
  sink.table?.(table);

  i = skipSpace(src, i);
  if (src.startsWith("<colgroup>", i)) {
    i += 10;
    for (;;) {
      i = skipSpace(src, i);
      if (src.startsWith("</colgroup>", i)) break;
      const col = readCol(src, i);
      i = cursor;
      sink.col?.(col);
    }
    i = skipSpace(src, i + 11);
  }

  let index = 0;
  if (src.startsWith("<thead>", i)) {
    index = readGroup(src, i, true, sink, index);
    i = skipSpace(src, cursor);
  }
  while (src.startsWith("<tbody>", i)) {
    index = readGroup(src, i, false, sink, index);
    i = skipSpace(src, cursor);
  }
  if (src.startsWith("<template rules>", i)) {
    const start = i;
    i += 16;
    let count = 0;
    for (;;) {
      i = skipSpace(src, i);
      if (src.startsWith("</template>", i)) break;
      const ruleStart = i;
      const rule = readRule(src, i);
      i = cursor;
      sink.rule?.(rule, ruleStart, i);
      count += 1;
    }
    if (count === 0) miss("an empty rules block", start);
    i += 11;
    sink.rules?.(start, i);
    i = skipSpace(src, i);
  }
  return expect(src, i, "</table>");
}
