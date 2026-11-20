// Formula text: the tokenizer, the parser (Pratt, every node keeps its source span), and the
// binding of A1 references to row and column ids and back. A frame is the order of every tab's
// rows and columns. `bind` reads a formula in a frame; `print` writes a bound formula in another,
// so a reference follows its records and a range whose end record was deleted shrinks to the
// records left. An end typed past the sheet's edge floats: it keeps its row number or column
// letters (in ids it is 0). Formula text that does not parse is kept as typed.

// The tokenizer: text after "=" to tokens, each with a [start, end) span into
// that text. Regular expressions classify one token at a time and never rewrite.

const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
// An error literal: #REF!, #DIV/0!, #NAME?, and #N/A, the one with no closing mark.
const ERROR = /^#(?:[A-Za-z0-9/]+[!?]|[Nn]\/[Aa])/;
const WORD = /^[A-Za-z_][A-Za-z0-9_.]*/;
const COLUMN = /^[A-Za-z]{1,3}/;
const ROW = /^\d+/;

const isDigit = (ch) => ch !== undefined && ch >= "0" && ch <= "9";
const isLetter = (ch) => (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
const isSpace = (ch) => ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
const isWordChar = (ch) => ch !== undefined && (/[A-Za-z0-9_.]/.test(ch));

const invalid = (start, end) => ({ token: { type: "invalid", start, end: Math.max(end, start + 1) }, next: Math.max(end, start + 1) });

function readString(src, start) {
  let i = start + 1;
  let value = "";
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"') {
      if (src[i + 1] === '"') {
        value += '"';
        i += 2;
        continue;
      }
      return { token: { type: "str", value, start, end: i + 1 }, next: i + 1 };
    }
    value += ch;
    i += 1;
  }
  return invalid(start, src.length);
}

function readError(src, start) {
  const match = ERROR.exec(src.slice(start));
  if (!match) return invalid(start, start + 1);
  const end = start + match[0].length;
  return { token: { type: "err", code: match[0].toUpperCase(), start, end }, next: end };
}

function readCoord(src, i, sheet, origin = i) {
  const start = origin;
  let absCol = false;
  if (src[i] === "$") {
    absCol = true;
    i += 1;
  }
  const colMatch = COLUMN.exec(src.slice(i));
  if (colMatch) {
    const col = colMatch[0].toUpperCase();
    i += colMatch[0].length;
    let absRow = false;
    if (src[i] === "$") {
      absRow = true;
      i += 1;
    }
    const rowMatch = ROW.exec(src.slice(i));
    if (rowMatch) {
      i += rowMatch[0].length;
      if (isWordChar(src[i])) return invalid(start, i);
      return {
        token: { type: "cell", sheet, col, row: Number(rowMatch[0]), absCol, absRow, start, end: i },
        next: i
      };
    }
    if (absRow) return invalid(start, i);
    return { token: { type: "col", sheet, col, absCol, start, end: i }, next: i };
  }
  if (absCol) {
    const absRowMatch = ROW.exec(src.slice(i));
    if (!absRowMatch) return invalid(start, i);
    i += absRowMatch[0].length;
    if (isWordChar(src[i])) return invalid(start, i);
    return { token: { type: "row", sheet, row: Number(absRowMatch[0]), absRow: true, start, end: i }, next: i };
  }
  const rowMatch = ROW.exec(src.slice(i));
  if (rowMatch) {
    i += rowMatch[0].length;
    if (isWordChar(src[i])) return invalid(start, i);
    return { token: { type: "row", sheet, row: Number(rowMatch[0]), absRow: false, start, end: i }, next: i };
  }
  return invalid(start, start + 1);
}

function readQuoted(src, start) {
  let i = start + 1;
  let name = "";
  while (i < src.length) {
    if (src[i] === "'") {
      if (src[i + 1] === "'") {
        name += "'";
        i += 2;
        continue;
      }
      return { name, next: i + 1 };
    }
    name += src[i];
    i += 1;
  }
  return null;
}

function readWordOrRef(src, start) {
  if (src[start] === "'") {
    const quoted = readQuoted(src, start);
    if (!quoted || src[quoted.next] !== "!") return invalid(start, quoted ? quoted.next : src.length);
    return readCoord(src, quoted.next + 1, quoted.name, start);
  }

  const word = WORD.exec(src.slice(start));
  if (word && src[start + word[0].length] === "!") {
    const end = start + word[0].length;
    return readCoord(src, end + 1, word[0], start);
  }

  if (src[start] === "$") return readCoord(src, start, null);

  if (!word) return invalid(start, start + 1);
  const end = start + word[0].length;
  if (src[end] === "(") {
    return { token: { type: "name", value: word[0].toUpperCase(), start, end }, next: end };
  }
  const upper = word[0].toUpperCase();
  if (upper === "TRUE" || upper === "FALSE") {
    return { token: { type: "bool", value: upper === "TRUE", start, end }, next: end };
  }
  return readCoord(src, start, null);
}

function readNumber(src, start) {
  const match = NUMBER.exec(src.slice(start));
  const end = start + match[0].length;
  if (src[end] === ":" && isDigit(src[end + 1])) {
    const row = ROW.exec(src.slice(end + 1));
    const rowEnd = end + 1 + row[0].length;
    return {
      tokens: [
        { type: "row", sheet: null, row: Number(match[0]), absRow: false, start, end },
        { type: "punct", value: ":", start: end, end: end + 1 },
        { type: "row", sheet: null, row: Number(row[0]), absRow: false, start: end + 1, end: rowEnd }
      ],
      next: rowEnd
    };
  }
  return { tokens: [{ type: "num", value: Number(match[0]), start, end }], next: end };
}

export function tokenize(src) {
  const tokens = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (isSpace(ch)) {
      i += 1;
      continue;
    }

    const prev = tokens[tokens.length - 1];
    if (prev?.type === "punct" && prev.value === ":" && tokens[tokens.length - 2]?.type === "row" && (isDigit(ch) || ch === "$")) {
      const scanned = readCoord(src, i, null);
      tokens.push(scanned.token);
      i = scanned.next;
      continue;
    }

    if (ch === "(" || ch === ")" || ch === "," || ch === ":" || ch === "%") {
      tokens.push({ type: "punct", value: ch, start: i, end: i + 1 });
      i += 1;
      continue;
    }

    if (ch === '"') {
      const scanned = readString(src, i);
      tokens.push(scanned.token);
      i = scanned.next;
      continue;
    }

    if (ch === "#") {
      const scanned = readError(src, i);
      tokens.push(scanned.token);
      i = scanned.next;
      continue;
    }

    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") {
      tokens.push({ type: "op", value: two, start: i, end: i + 2 });
      i += 2;
      continue;
    }

    if ("+-*/^&=<>".includes(ch)) {
      tokens.push({ type: "op", value: ch, start: i, end: i + 1 });
      i += 1;
      continue;
    }

    if (isDigit(ch) || (ch === "." && isDigit(src[i + 1]))) {
      const scanned = readNumber(src, i);
      for (const token of scanned.tokens) tokens.push(token);
      i = scanned.next;
      continue;
    }

    if (ch === "$" || ch === "'" || isLetter(ch) || ch === "_") {
      const scanned = readWordOrRef(src, i);
      tokens.push(scanned.token);
      i = scanned.next;
      continue;
    }

    tokens.push({ type: "invalid", start: i, end: i + 1 });
    i += 1;
  }

  return tokens;
}

// The parser: a Pratt parser over the tokens, keeping every node's source span.
// A formula that does not parse returns { error: "#ERROR!", at } and never throws.

const BINARY = {
  "=": 1,
  "<>": 1,
  "<": 1,
  ">": 1,
  "<=": 1,
  ">=": 1,
  "&": 2,
  "+": 3,
  "-": 3,
  "*": 4,
  "/": 4,
  "^": 5
};
const UNARY = 6;
const POSTFIX = 7;

class ParseError extends Error {
  constructor(at) {
    super("#ERROR!");
    this.at = at;
  }
}

const peek = (state) => state.tokens[state.index];

const next = (state) => {
  const token = state.tokens[state.index];
  state.index += 1;
  return token;
};

const fail = (state, token) => {
  throw new ParseError(token ? token.start : state.end);
};

const isCoordinate = (token) =>
  token.type === "cell" || token.type === "col" || token.type === "row";

const refEnd = (token) => {
  if (token.type === "cell") {
    return { col: token.col, row: token.row, absCol: token.absCol, absRow: token.absRow };
  }
  if (token.type === "col") {
    return { col: token.col, row: null, absCol: token.absCol, absRow: false };
  }
  return { col: null, row: token.row, absCol: false, absRow: token.absRow };
};

function parseReference(state, first) {
  const colon = peek(state);
  if (!colon || colon.type !== "punct" || colon.value !== ":") {
    if (first.type !== "cell") fail(state, first);
    const ref = {
      type: "ref",
      sheet: first.sheet ?? null,
      col: first.col,
      row: first.row,
      absCol: first.absCol,
      absRow: first.absRow,
      span: [first.start, first.end]
    };
    state.refs.push(ref);
    return ref;
  }

  next(state);
  const second = next(state);
  if (!second || !isCoordinate(second)) fail(state, second);

  const from = refEnd(first);
  const to = refEnd(second);
  if ((from.col === null) !== (to.col === null)) fail(state, second);
  if (from.row === null && to.row !== null) fail(state, second);

  const sheet = first.sheet ?? second.sheet ?? null;
  if (first.sheet && second.sheet && first.sheet !== second.sheet) fail(state, second);

  const range = { type: "range", from, to, sheet, span: [first.start, second.end] };
  state.refs.push(range);
  return range;
}

function parsePrefix(state) {
  const token = next(state);
  if (!token) fail(state, token);

  switch (token.type) {
    case "num":
      return { type: "num", value: token.value, span: [token.start, token.end] };
    case "str":
      return { type: "str", value: token.value, span: [token.start, token.end] };
    case "bool":
      return { type: "bool", value: token.value, span: [token.start, token.end] };
    case "err":
      return { type: "err", code: token.code, span: [token.start, token.end] };
    case "cell":
    case "col":
    case "row":
      return parseReference(state, token);
    case "op": {
      if (token.value !== "-" && token.value !== "+") fail(state, token);
      const arg = parseExpr(state, UNARY);
      return { type: "unary", op: token.value, arg, span: [token.start, arg.span[1]] };
    }
    case "punct": {
      if (token.value !== "(") fail(state, token);
      const inner = parseExpr(state, 0);
      const close = next(state);
      if (!close || close.type !== "punct" || close.value !== ")") fail(state, close);
      return inner;
    }
    case "name": {
      const open = next(state);
      if (!open || open.type !== "punct" || open.value !== "(") fail(state, open);
      const args = [];
      const after = peek(state);
      if (after && after.type === "punct" && after.value === ")") {
        const close = next(state);
        return { type: "call", name: token.value, args, span: [token.start, close.end] };
      }
      for (;;) {
        args.push(parseExpr(state, 0));
        const separator = next(state);
        if (!separator || separator.type !== "punct") fail(state, separator);
        if (separator.value === ")") {
          return { type: "call", name: token.value, args, span: [token.start, separator.end] };
        }
        if (separator.value !== ",") fail(state, separator);
      }
    }
    default:
      fail(state, token);
  }
}

function parseExpr(state, minPower) {
  let left = parsePrefix(state);

  for (;;) {
    const token = peek(state);
    if (!token) break;

    if (token.type === "punct" && token.value === "%") {
      if (POSTFIX <= minPower) break;
      next(state);
      left = { type: "postfix", op: "%", arg: left, span: [left.span[0], token.end] };
      continue;
    }

    if (token.type !== "op") break;
    const power = BINARY[token.value];
    if (power === undefined || power <= minPower) break;

    next(state);
    // ^ groups from the right, as in Sheets: 2^3^2 is 2^9.
    const right = parseExpr(state, token.value === "^" ? power - 1 : power);
    left = {
      type: "binary",
      op: token.value,
      left,
      right,
      span: [left.span[0], right.span[1]]
    };
  }

  return left;
}

export function parse(src) {
  const state = { tokens: tokenize(src), index: 0, refs: [], end: src.length };
  try {
    const ast = parseExpr(state, 0);
    const rest = peek(state);
    if (rest) fail(state, rest);
    return { ast, refs: state.refs };
  } catch (error) {
    if (error instanceof ParseError) return { error: "#ERROR!", at: error.at };
    throw error;
  }
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function colIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.toUpperCase().charCodeAt(0) - 64);
  return n - 1;
}

function colText(index) {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    out = LETTERS[(n - 1) % 26] + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function frameFrom(sheets) {
  const frame = new Map();
  for (const s of sheets) {
    frame.set(s.id, {
      id: s.id,
      name: s.name,
      rows: s.rows,
      cols: s.cols,
      rowAt: new Map(s.rows.map((id, i) => [id, i])),
      colAt: new Map(s.cols.map((id, i) => [id, i])),
    });
  }
  return frame;
}

const byName = (frame, name) => {
  const low = name.toLowerCase();
  for (const s of frame.values()) if (s.name.toLowerCase() === low) return s;
  return null;
};

function endIds(sheet, end) {
  const row = end.row === null ? null : sheet.rows[end.row - 1] ?? undefined;
  const col = end.col === null ? null : sheet.cols[colIndex(end.col)] ?? undefined;
  return { row, col };
}

// A bound reference: the sheet id and the record ids of its ends. `undefined` marks an end past the
// sheet (kept as typed), `null` an open axis (a whole column or a whole row).
export function bind(f, homeId, frame) {
  const parsed = parse(f.slice(1));
  if (parsed.error) return null;
  const home = frame.get(homeId);
  const refs = parsed.refs.map((node) => {
    const sheet = node.sheet === null ? home : byName(frame, node.sheet);
    if (sheet === null) return { unbound: true, name: node.sheet };
    if (node.type === "ref") {
      const { row, col } = endIds(sheet, node);
      return { s: sheet.id, r0: row, c0: col, r1: row, c1: col, cell: true };
    }
    const a = endIds(sheet, node.from);
    const b = endIds(sheet, node.to);
    return { s: sheet.id, r0: a.row, c0: a.col, r1: b.row, c1: b.col, cell: false };
  });
  return { f, parsed, refs };
}

// The ids of a bound formula, for an action: one entry per reference, in order.
const enc = (id) => (id === undefined ? 0 : id);
const dec = (id) => (id === 0 ? undefined : id);
export const idsOf = (bound) => bound.refs.map((ref) => (ref.dead ? null : ref.unbound ? ["~", ref.name] : [ref.s, enc(ref.r0), enc(ref.c0), enc(ref.r1), enc(ref.c1)]));

// A formula's A1 text and the ids an author bound it to, made into a bound formula again.
export function fromIds(f, ids) {
  const parsed = parse(f.slice(1));
  if (parsed.error || parsed.refs.length !== ids.length) return null;
  const refs = parsed.refs.map((node, i) => {
    const id = ids[i];
    if (id === null) return { dead: true };
    if (id[0] === "~") return { unbound: true, name: id[1] };
    return { s: id[0], r0: dec(id[1]), c0: dec(id[2]), r1: dec(id[3]), c1: dec(id[4]), cell: node.type === "ref" };
  });
  return { f, parsed, refs };
}

// A formula's ids with each range's two corners in a fixed order: after a move a range's first
// and last records can swap with no change in meaning.
export const cornersUnordered = (ids) =>
  JSON.stringify(ids.map((ref) => (ref === null || ref[0] === "~" ? ref : [ref[0], ...[ref[1], ref[3]].sort(), ...[ref[2], ref[4]].sort()])));

// One axis of a range in the after frame: [from, to] indexes, or null when nothing is left. A
// deleted end moves inward along the before order to the first record that is still there.
function axisSpan(first, last, beforeAt, beforeList, afterAt) {
  let a = afterAt.get(first);
  let b = afterAt.get(last);
  if (a !== undefined && b !== undefined) return a <= b ? [a, b] : [b, a];
  const i0 = beforeAt?.get(first);
  const i1 = beforeAt?.get(last);
  if (i0 === undefined || i1 === undefined) return null;
  const lo = Math.min(i0, i1);
  const hi = Math.max(i0, i1);
  // A range typed bottom to top (B10:B2) has its first end at the bottom: search from each end's
  // own side, so the top end moves down and the bottom end moves up.
  let top = i0 <= i1 ? a : b;
  let bottom = i0 <= i1 ? b : a;
  if (top === undefined) {
    for (let i = lo; i <= hi && top === undefined; i++) top = afterAt.get(beforeList[i]);
  }
  if (bottom === undefined) {
    for (let i = hi; i >= lo && bottom === undefined; i--) bottom = afterAt.get(beforeList[i]);
  }
  if (top === undefined || bottom === undefined) return null;
  return top <= bottom ? [top, bottom] : [bottom, top];
}

const quoteName = (name) => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) && !/^[A-Za-z]{1,3}[0-9]+$/.test(name) ? name : `'${name.split("'").join("''")}'`);

// A reference with an end past the sheet's edge. A bound end follows its record and the tab's name
// follows the tab; a floating end keeps its typed row number or column letters. A bound end whose
// record is gone moves toward the edge to the next record that is left, and past the new edge when
// none is.
function floatText(node, ref, prefix, from, to, was, sheet) {
  const one = (id, typed, afterAt, beforeAt, beforeList, afterLen) => {
    if (id === undefined) return typed;
    const at = afterAt.get(id);
    if (at !== undefined) return at;
    if (node.type === "ref") return "dead";
    const i = beforeAt?.get(id);
    if (i === undefined) return "dead";
    for (let k = i + 1; k < beforeList.length; k++) {
      const next = afterAt.get(beforeList[k]);
      if (next !== undefined) return next;
    }
    return afterLen;
  };
  // An open end (null, as the B of `B2:B`) stays open; the other end follows its record or floats.
  const axis = (a, b, typedA, typedB, afterAt, beforeAt, beforeList, afterLen) => {
    if (a === null && b === null) return [null, null];
    if (a !== undefined && b !== undefined && a !== null && b !== null) {
      if (node.type === "ref") return afterAt.has(a) ? [afterAt.get(a), afterAt.get(a)] : ["dead", "dead"];
      return axisSpan(a, b, beforeAt, beforeList, afterAt) ?? ["dead", "dead"];
    }
    const end = (id, typed) => (id === null ? null : one(id, typed, afterAt, beforeAt, beforeList, afterLen));
    return [end(a, typedA), end(b, typedB)];
  };
  const rowOf = (part) => (part.row === null ? null : part.row - 1);
  const colOf = (part) => (part.col === null ? null : colIndex(part.col));
  const rows = axis(ref.r0, ref.r1, rowOf(from), rowOf(to), sheet.rowAt, was?.rowAt, was?.rows, sheet.rows.length);
  const cols = axis(ref.c0, ref.c1, colOf(from), colOf(to), sheet.colAt, was?.colAt, was?.cols, sheet.cols.length);
  if (rows.includes("dead") || cols.includes("dead")) return "#REF!";
  const end = (part, r, c) => (c === null ? "" : (part.absCol ? "$" : "") + colText(c)) + (r === null ? "" : (part.absRow ? "$" : "") + (r + 1));
  if (node.type === "ref") return prefix + end(from, rows[0], cols[0]);
  return prefix + end(from, rows[0], cols[0]) + ":" + end(to, rows[1], cols[1]);
}

function refText(node, ref, homeId, before, after) {
  if (ref.dead) return "#REF!";
  if (ref.unbound) return null;
  const sheet = after.get(ref.s);
  if (sheet === undefined) return "#REF!";
  const was = before?.get(ref.s);
  const prefix = ref.s === homeId && node.sheet === null ? "" : `${quoteName(sheet.name)}!`;
  // A range open at one end of an axis (`B2:B`, rows from 2 to the tab's end) prints as floating
  // ends do: the bound end follows its record, the open end stays open.
  const half = (x, y) => (x === null) !== (y === null);
  const floats = ref.r0 === undefined || ref.c0 === undefined || ref.r1 === undefined || ref.c1 === undefined || half(ref.r0, ref.r1) || half(ref.c0, ref.c1);
  const from = node.type === "ref" ? node : node.from;
  const to = node.type === "ref" ? node : node.to;
  if (floats) return floatText(node, ref, prefix, from, to, was, sheet);
  let rows = null;
  let cols = null;
  if (ref.r0 !== null) {
    rows = ref.cell ? (sheet.rowAt.has(ref.r0) ? [sheet.rowAt.get(ref.r0), sheet.rowAt.get(ref.r0)] : null) : axisSpan(ref.r0, ref.r1, was?.rowAt, was?.rows, sheet.rowAt);
    if (rows === null) return "#REF!";
  }
  if (ref.c0 !== null) {
    cols = ref.cell ? (sheet.colAt.has(ref.c0) ? [sheet.colAt.get(ref.c0), sheet.colAt.get(ref.c0)] : null) : axisSpan(ref.c0, ref.c1, was?.colAt, was?.cols, sheet.colAt);
    if (cols === null) return "#REF!";
  }
  const end = (part, r, c) => (c === null ? "" : (part.absCol ? "$" : "") + colText(c)) + (r === null ? "" : (part.absRow ? "$" : "") + (r + 1));
  if (node.type === "ref") return prefix + end(from, rows[0], cols[0]);
  return prefix + end(from, rows ? rows[0] : null, cols ? cols[0] : null) + ":" + end(to, rows ? rows[1] : null, cols ? cols[1] : null);
}

// The bound formula printed in `after`. `before` is the frame it was bound in (null when it came
// from an action's ids, so a deleted end has no order to shrink along and gives #REF!).
export function print(bound, homeId, before, after) {
  const src = bound.f.slice(1);
  let out = "";
  let at = 0;
  bound.parsed.refs.forEach((node, i) => {
    const typed = src.slice(node.span[0], node.span[1]);
    const text = refText(node, bound.refs[i], homeId, before, after);
    out += src.slice(at, node.span[0]) + (text === null ? typed : text);
    at = node.span[1];
  });
  return "=" + out + src.slice(at);
}

// A formula in the standard spelling (David's answer 10): function names and TRUE and FALSE in
// capitals, every reference printed from the tab's own names (`=budget!a1` is `=Budget!A1`). The
// spacing and everything else stay as typed. A formula that does not parse comes back unchanged.
export function standard(f, homeId, frame) {
  const bound = bind(f, homeId, frame);
  if (bound === null) return f;
  const src = print(bound, homeId, frame, frame).slice(1);
  let out = "";
  let at = 0;
  for (const token of tokenize(src)) {
    if (token.type !== "name" && token.type !== "bool") continue;
    out += src.slice(at, token.start) + (token.type === "name" ? token.value : token.value ? "TRUE" : "FALSE");
    at = token.end;
  }
  return "=" + out + src.slice(at);
}

// The formula with each reference written as the ids it is bound to: two formulas mean the same
// thing exactly when their id forms are equal, in whatever frames they were printed.
export function idForm(bound) {
  const src = bound.f.slice(1);
  let out = "";
  let at = 0;
  bound.parsed.refs.forEach((node, i) => {
    const ref = bound.refs[i];
    const text = ref.dead ? "#REF!" : `{${[ref.s, ref.r0, ref.c0, ref.r1, ref.c1].map((id) => (id === undefined ? "?" : id === null ? "" : id)).join("|")}}`;
    out += src.slice(at, node.span[0]) + text;
    at = node.span[1];
  });
  return "=" + out + src.slice(at);
}

// Whether printing in `after` loses something the ids hold: a reference cut to #REF! or a range end
// that is gone (the range shrank).
export function lossy(bound, after) {
  return bound.refs.some((ref) => {
    if (ref.dead || ref.unbound) return false;
    const sheet = after.get(ref.s);
    if (sheet === undefined) return true;
    const gone = (id, at) => id !== null && id !== undefined && !at.has(id);
    return gone(ref.r0, sheet.rowAt) || gone(ref.r1, sheet.rowAt) || gone(ref.c0, sheet.colAt) || gone(ref.c1, sheet.colAt);
  });
}

// A formula cut into its skeleton and its reference slots. A slot is a bound reference or a #REF!
// that stands where one was. Each slot's key names what it points at, in any frame.
export function slotsOf(f, homeId, frame) {
  const bound = bind(f, homeId, frame);
  if (bound === null) return null;
  const src = f.slice(1);
  const marks = [];
  bound.parsed.refs.forEach((node, i) => marks.push({ span: node.span, ref: bound.refs[i] }));
  for (const token of tokenize(src)) if (token.type === "err" && token.code === "#REF!") marks.push({ span: [token.start, token.end], ref: { dead: true } });
  marks.sort((a, b) => a.span[0] - b.span[0]);
  let skeleton = "";
  let at = 0;
  for (const mark of marks) {
    skeleton += src.slice(at, mark.span[0]) + "\u0001";
    at = mark.span[1];
  }
  skeleton += src.slice(at);
  const key = (ref) => {
    if (ref.dead) return "#REF!";
    if (ref.unbound) return `~${ref.name}`;
    const mark = (id) => (id === undefined ? "?" : id === null ? "" : id);
    return [ref.s, ...[mark(ref.r0), mark(ref.r1)].sort(), ...[mark(ref.c0), mark(ref.c1)].sort()].join("|");
  };
  return { skeleton, keys: marks.map((m) => key(m.ref)), marks, src, bound };
}

function printOne(node, ref, homeId, frame, typed) {
  const fake = { f: "=" + "x".repeat(node.span[0]) + typed, parsed: { refs: [node] }, refs: [ref] };
  const text = print(fake, homeId, null, frame).slice(1 + node.span[0]);
  return text;
}

// Restores, slot by slot, the references a forward action cut or shrank: a slot whose key is still
// the key the forward action left there takes its original ids; any other slot keeps what it has.
// Returns the new A1 text, or null when the formula's skeleton changed (nothing is restored).
export function restoreSlots(currentF, homeId, frame, original, forwardKeys, beforeKeys = null) {
  const now = slotsOf(currentF, homeId, frame);
  if (now === null || now.skeleton !== original.skeleton || now.keys.length !== forwardKeys.length) return null;
  const src = now.src;
  let out = "";
  let at = 0;
  now.marks.forEach((mark, i) => {
    let text = src.slice(mark.span[0], mark.span[1]);
    if (((now.keys[i] === forwardKeys[i] || (beforeKeys !== null && beforeKeys[i] === forwardKeys[i])) && original.keys[i] !== forwardKeys[i])) {
      const node = original.nodes[i];
      const ref = original.refs[i];
      text = node === null || ref.dead ? "#REF!" : printOne(node, ref, homeId, frame, original.src.slice(node.span[0], node.span[1]));
    }
    out += src.slice(at, mark.span[0]) + text;
    at = mark.span[1];
  });
  return "=" + out + src.slice(at);
}

// One slot's original parse node and ids, kept so the slot can be printed again.
export function originalSlots(f, homeId, frame) {
  const s = slotsOf(f, homeId, frame);
  if (s === null) return null;
  const nodes = [];
  const refs = [];
  let j = 0;
  for (const mark of s.marks) {
    if (mark.ref.dead && !s.bound.refs.includes(mark.ref)) {
      nodes.push(null);
      refs.push({ dead: true });
      continue;
    }
    nodes.push(s.bound.parsed.refs[j]);
    refs.push(s.bound.refs[j]);
    j += 1;
  }
  return { skeleton: s.skeleton, keys: s.keys, nodes, refs, src: s.src };
}

// A formula moved by a sort, as a copy moves it: every row number not marked `$` moves by `delta`.
// A row that would go above row 1 makes its reference #REF!. Text that does not parse is kept.
export function shiftRows(f, delta) {
  if (delta === 0) return f;
  const src = f.slice(1);
  const parsed = parse(src);
  if (parsed.error) return f;
  let out = "";
  let at = 0;
  for (const node of parsed.refs) {
    const text = src.slice(node.span[0], node.span[1]);
    let moved = "";
    let from = 0;
    let dead = false;
    for (const token of tokenize(text)) {
      if (token.type !== "cell" && token.type !== "row") continue;
      if (token.absRow || token.row === undefined || token.row === null) continue;
      const digits = /\d+$/.exec(text.slice(token.start, token.end));
      if (digits === null) continue;
      const row = token.row + delta;
      if (row < 1) dead = true;
      const end = token.end;
      moved += text.slice(from, end - digits[0].length) + String(row);
      from = end;
    }
    out += src.slice(at, node.span[0]) + (dead ? "#REF!" : moved + text.slice(from));
    at = node.span[1];
  }
  return "=" + out + src.slice(at);
}

// The top-left row and column (0-based) of a range as written; an open axis starts at row 1 or
// column A.
export function topLeftOf(range) {
  const parsed = parse(range);
  const node = parsed.error ? null : parsed.refs[0];
  if (!node) return { row: 0, col: 0 };
  const ends = node.type === "ref" ? [node] : [node.from, node.to];
  const rows = ends.map((end) => end.row).filter((row) => typeof row === "number");
  const cols = ends.map((end) => end.col).filter((col) => typeof col === "string");
  return { row: rows.length > 0 ? Math.min(...rows) - 1 : 0, col: cols.length > 0 ? Math.min(...cols.map(colIndex)) : 0 };
}

// A conditional format's formula is written for its range's top-left cell. Its relative parts mean
// "so many rows and columns from that cell", as a fill reads them, so after a step that moved the
// corner by `rows` and `cols` they move by as much. Its `$` parts keep naming the row or column they
// named in `before`, wherever that is in `after`, and a part whose row or column is gone, or that
// would land before row 1 or column A, becomes #REF!. A reference to a tab no tab is named is kept.
export function moveAnchored(f, homeId, before, after, rows, cols) {
  const src = f.slice(1);
  const parsed = parse(src);
  if (parsed.error) return f;
  const place = (ids, at, index) => (index >= ids.length ? index : at.get(ids[index]) ?? -1);
  let out = "";
  let at = 0;
  for (const node of parsed.refs) {
    const text = src.slice(node.span[0], node.span[1]);
    const was = node.sheet === null ? before.get(homeId) : byName(before, node.sheet);
    const now = was ? after.get(was.id) : null;
    let moved = "";
    let from = 0;
    let dead = false;
    if (was && now) {
      for (const token of tokenize(text)) {
        if (token.type !== "cell" && token.type !== "row" && token.type !== "col") continue;
        const raw = text.slice(token.start, token.end);
        const hasCol = token.type !== "row";
        const hasRow = token.type !== "col";
        const digits = hasRow ? /\d+$/.exec(raw)[0] : "";
        const length = (hasCol ? (token.absCol ? 1 : 0) + token.col.length : 0) + (hasRow ? (token.absRow ? 1 : 0) + digits.length : 0);
        const c = hasCol ? (token.absCol ? place(was.cols, now.colAt, colIndex(token.col)) : colIndex(token.col) + cols) : 0;
        const r = hasRow ? (token.absRow ? place(was.rows, now.rowAt, token.row - 1) : token.row - 1 + rows) : 0;
        if (c < 0 || r < 0) dead = true;
        const coord = (hasCol ? `${token.absCol ? "$" : ""}${colText(Math.max(c, 0))}` : "") + (hasRow ? `${token.absRow ? "$" : ""}${r + 1}` : "");
        moved += text.slice(from, token.end - length) + coord;
        from = token.end;
      }
    }
    out += src.slice(at, node.span[0]) + (dead ? "#REF!" : moved + text.slice(from));
    at = node.span[1];
  }
  return "=" + out + src.slice(at);
}

// What a formula means, as one string: its text with each reference replaced by its kind (a cell or
// a range) and the ids it binds to in `frame`, each range's corners in a fixed order, and an end past
// the sheet's edge written as its typed row number or column letters. Two formulas mean the same
// exactly when these are equal.
export function meaning(f, homeId, frame) {
  const bound = bind(f, homeId, frame);
  if (bound === null) return `!${f}`;
  const src = f.slice(1);
  let out = "";
  let at = 0;
  bound.parsed.refs.forEach((node, i) => {
    const ref = bound.refs[i];
    const from = node.type === "ref" ? node : node.from;
    const to = node.type === "ref" ? node : node.to;
    const end = (id, typed) => (id === undefined ? `~${typed}` : id === null ? "" : id);
    // A reference to a tab no tab is named keeps its typed corners: =Q2!B2 and =Q2!C50 differ.
    const corners = ref.unbound
      ? [`~${ref.name.toLowerCase()}`, ...[from.row ?? "", to.row ?? ""].sort(), ...[from.col ?? "", to.col ?? ""].sort()]
      : [ref.s, ...[end(ref.r0, from.row), end(ref.r1, to.row)].sort(), ...[end(ref.c0, from.col), end(ref.c1, to.col)].sort()];
    const lock = (one) => `${one.absCol ? "$" : ""}:${one.absRow ? "$" : ""}`;
    const key = [node.type, ...corners, ...[lock(from), lock(to)].sort()].join("|");
    out += src.slice(at, node.span[0]) + `\u0001${key}\u0001`;
    at = node.span[1];
  });
  return out + src.slice(at);
}
