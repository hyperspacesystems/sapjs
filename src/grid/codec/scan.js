// The strict reader: accepts a grid region if and only if it fits GRAMMAR.md,
// which is exactly what write.js emits. Anything else is a CodecMiss, and the
// caller reads that table with a real HTML parser instead.

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

// Reads the grid that starts at `at` and returns the index just past "</table>".
// The sink is told about the table, each col, each row (with its cells and its
// byte range) and each row group. Throws CodecMiss when the region does not fit.
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
  return expect(src, i, "</table>");
}
