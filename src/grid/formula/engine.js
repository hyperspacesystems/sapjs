// The formula engine of a workbook (layer 3): every formula's binding, the graph of what reads
// what, and the results. It runs where results are shown: a page's tabs, tests, a host's
// recalculation worker. The room never evaluates.
//
// The graph is keyed by record ids, scoped by tab: a cell is `sheet, row id, column id`, so a row
// insert moves no key. A single-cell reference is a reader entry on that cell's key; a range is
// kept on its tab and found by its place in the frame of the moment. A result is written into its
// cell as the codec stores it (`{ f, text, v?, n?, t? }`, an error as its code's text) through
// `write`, a write that is not an edit, and only when the stored parts change.

import { SUBTOTAL_NAMES, isAddedFunction, lookupFunction, onFunctionsAdded } from "./functions.js";
import { systemNow, systemRandom } from "./clock.js";
import { cellValue, shown, typed } from "../codec/value.js";
import { derive as defaultDerive, effectiveFmt, waitsForFormatter } from "../content.js";
import { fmtKind, isBuiltin, onFormattersChanged } from "../format.js";
import { frameOf } from "../workbook.js";
import { compiler } from "./compile.js";
import { bind, cornersUnordered, idsOf } from "./text.js";
import { ERRORS, error, isError, isRange, single } from "./values.js";

const keyOf = (sheet, row, col) => `${sheet}\u0000${row}\u0000${col}`;
const RESULT_FIELDS = ["f", "text", "v", "n", "t"];
const PLACE = /\b(?:ROW|COLUMN)\s*\(/i;

const RESHAPING = new Set(["insert", "delete", "move"]);

const lettersIndex = (letters) => {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.toUpperCase().charCodeAt(0) - 64);
  return n - 1;
};

// One axis of a reference in the frame: [first, last] indexes, [] when it holds nothing (both ends
// past the edge, or an empty tab), or null when a bound end's record is gone (#REF!). A null end is
// an open axis (a whole column or row); an end past the edge (undefined) runs to the edge.
// `ta` and `tb` are the typed indexes of the ends, used for an end past the edge: such a range
// reaches past the tab, where every cell reads blank (rule 3), so COUNTBLANK(B2:B20) on ten rows
// counts nineteen blanks.
function axis(a, b, at, count, ta, tb) {
  const ia = a === null ? 0 : a === undefined ? ta : at.get(a);
  const ib = b === null ? count - 1 : b === undefined ? tb : at.get(b);
  if (ia === undefined || ib === undefined) return null;
  if (a === null && count === 0) return [];
  return [Math.min(ia, ib), Math.max(ia, ib)];
}

// The typed 0-based row and column indexes of a reference node's two ends.
function typedEnds(node) {
  const from = node.type === "ref" ? node : node.from;
  const to = node.type === "ref" ? node : node.to;
  const row = (end) => (end.row === null ? undefined : end.row - 1);
  const col = (end) => (end.col === null ? undefined : lettersIndex(end.col));
  return { r0: row(from), r1: row(to), c0: col(from), c1: col(to) };
}

// SUMIF and AVERAGEIF total a sum range of another shape over the criteria range's shape, from
// the sum range's first cell, as Sheets does; SUMIFS and AVERAGEIFS show #VALUE! for one, as
// Sheets does. Which argument is which: [sum, criteria].
const STRETCH = { SUMIF: [2, 0], AVERAGEIF: [2, 0] };

// The stretched references of a parse: sum reference index -> criteria reference index.
function stretchesOf(parsed) {
  const out = new Map();
  if (parsed === null) return out;
  const at = new Map(parsed.refs.map((node, i) => [node, i]));
  const walk = (node) => {
    if (node === null || typeof node !== "object") return;
    if (node.type === "call") {
      const pair = STRETCH[node.name.toUpperCase()];
      const sum = pair && node.args[pair[0]];
      const criteria = pair && node.args[pair[1]];
      if (sum && criteria && at.has(sum) && at.has(criteria)) out.set(at.get(sum), at.get(criteria));
      node.args.forEach(walk);
      return;
    }
    for (const part of [node.arg, node.left, node.right]) walk(part);
  };
  walk(parsed.ast);
  return out;
}

// Whether a parse calls TODAY, NOW, RAND or RANDBETWEEN.
function callsVolatile(parsed) {
  if (parsed === null) return false;
  const walk = (node) => {
    if (node === null || typeof node !== "object") return false;
    if (node.type === "call") return lookupFunction(node.name)?.volatile === true || node.args.some(walk);
    return [node.arg, node.left, node.right].some(walk);
  };
  return walk(parsed.ast);
}

// The upper-case names a parse calls.
function callsOf(parsed) {
  const names = new Set();
  const walk = (node) => {
    if (node === null || typeof node !== "object") return;
    if (node.type === "call") {
      names.add(node.name.toUpperCase());
      node.args.forEach(walk);
      return;
    }
    [node.arg, node.left, node.right].forEach(walk);
  };
  if (parsed !== null) walk(parsed.ast);
  return [...names];
}

// `quiet(fn)` runs fn as a write that does not mark the document unsaved (David's answer 7): at
// load, a result that changed only because it reads TODAY, NOW, RAND or RANDBETWEEN is written
// that way, and saves with the next real edit. It defaults to `write`.
export function createEngine(wb, { derive = defaultDerive, write = (fn) => fn(), quiet = write, now = systemNow, random = systemRandom } = {}) {
  let hushed = null;
  const compileOf = compiler();
  const formulas = new Map();
  const results = new Map();
  const readers = new Map();
  const ranges = new Map();
  const listeners = new Map();
  let frame = new Map();
  let tabs = new Map();
  let last = 0;

  function look() {
    const list = wb.sheets();
    tabs = new Map(list.map((tab) => [tab.id, tab]));
    frame = frameOf(wb);
  }

  // The value at these indexes of a tab: a formula's result, else the cell's own value; an error
  // read from another cell loses the reason its own cell shows.
  function valueAt(sheet, r, c) {
    const f = frame.get(sheet);
    if (r < 0 || c < 0 || r >= f.rows.length || c >= f.cols.length) return null;
    const key = keyOf(sheet, f.rows[r], f.cols[c]);
    if (formulas.has(key)) {
      const value = results.get(key) ?? null;
      return isError(value) ? error(value.error) : value;
    }
    const cell = tabs.get(sheet).backing.cell(r, c);
    return cell === null || cell.hidden === true ? null : cellValue(cell);
  }

  // A range as functions read it: `get(i, j)` past its own size reads on into the tab, as
  // SUMIF's sum range does in Sheets; `forEach` visits every place, blanks too.
  function rangeView(sheet, rows, cols) {
    const height = rows.length === 0 || cols.length === 0 ? 0 : rows[1] - rows[0] + 1;
    const width = height === 0 ? 0 : cols[1] - cols[0] + 1;
    const top = rows[0] ?? 0;
    const left = cols[0] ?? 0;
    const f = frame.get(sheet);
    // `forEach` walks only the places on the tab; `outside` counts the blank places past its edge.
    const innerHeight = Math.max(0, Math.min(height, f.rows.length - top));
    const innerWidth = Math.max(0, Math.min(width, f.cols.length - left));
    return {
      isRange: true,
      height,
      width,
      innerHeight,
      innerWidth,
      outside: height * width - innerHeight * innerWidth,
      top,
      left,
      get: (i, j) => (i < height && j < width ? valueAt(sheet, top + i, left + j) : null),
      // Whether the place holds a formula that calls SUBTOTAL, which SUBTOTAL leaves out.
      subtotal: (i, j) => {
        if (i >= innerHeight || j >= innerWidth) return false;
        return formulas.get(keyOf(sheet, f.rows[top + i], f.cols[left + j]))?.subtotal === true;
      },
      forEach(visit) {
        for (let i = 0; i < innerHeight; i++) for (let j = 0; j < innerWidth; j++) visit(valueAt(sheet, top + i, left + j), i, j);
      },
    };
  }

  const blankRange = { isRange: true, height: 1, width: 1, top: 0, left: 0, get: () => null, forEach: (visit) => visit(null, 0, 0) };

  // The box a range covers in the frame of the moment: [top, bottom, left, right], [] when it
  // covers nothing, or null when a bound end's record is gone.
  function boxOf(ref, node, at = frame) {
    const f = at.get(ref.s);
    if (f === undefined) return null;
    const typed = typedEnds(node);
    const rows = axis(ref.r0, ref.r1, f.rowAt, f.rows.length, typed.r0, typed.r1);
    const cols = axis(ref.c0, ref.c1, f.colAt, f.cols.length, typed.c0, typed.c1);
    if (rows === null || cols === null) return null;
    return rows.length === 0 || cols.length === 0 ? [] : [rows[0], rows[1], cols[0], cols[1]];
  }

  // The box reference i of an entry covers in a frame: a cell's place, a range's box, and for a
  // stretched sum range the criteria range's shape from its first cell. [] covers nothing; null is
  // a reference whose record is gone.
  function refBox(entry, i, at = frame) {
    const ref = entry.refs[i];
    if (ref.dead || ref.unbound) return null;
    let box;
    if (ref.cell) {
      const f = at.get(ref.s);
      if (f === undefined || ref.r0 === undefined || ref.c0 === undefined) return null;
      const r = f.rowAt.get(ref.r0);
      const c = f.colAt.get(ref.c0);
      if (r === undefined || c === undefined) return null;
      box = [r, r, c, c];
    } else box = boxOf(ref, entry.parsed.refs[i], at);
    const k = entry.stretch.get(i);
    if (k === undefined || box === null || box.length === 0) return box;
    const criteria = refBox(entry, k, at);
    if (criteria === null || criteria.length === 0) return box;
    return [box[0], box[0] + criteria[1] - criteria[0], box[2], box[2] + criteria[3] - criteria[2]];
  }

  function read(entry, i, whole) {
    const ref = entry.refs[i];
    if (ref.dead || ref.unbound) return error("#REF!");
    if (entry.stretch.has(i)) {
      const box = refBox(entry, i);
      if (box === null) return error("#REF!");
      return box.length === 0 ? rangeView(ref.s, [], []) : rangeView(ref.s, [box[0], box[1]], [box[2], box[3]]);
    }
    const f = frame.get(ref.s);
    if (f === undefined) return error("#REF!");
    if (ref.cell) {
      if (ref.r0 === undefined || ref.c0 === undefined) return whole ? blankRange : null;
      const r = f.rowAt.get(ref.r0);
      const c = f.colAt.get(ref.c0);
      if (r === undefined || c === undefined) return error("#REF!");
      return whole ? rangeView(ref.s, [r, r], [c, c]) : valueAt(ref.s, r, c);
    }
    const box = boxOf(ref, entry.parsed.refs[i]);
    if (box === null) return error("#REF!");
    return box.length === 0 ? rangeView(ref.s, [], []) : rangeView(ref.s, [box[0], box[1]], [box[2], box[3]]);
  }

  // Where a reference is: indexes from the frame, or the typed row and column of an end past the
  // edge, so ROW(A1000) is 1000 on a short tab.
  function area(entry, i) {
    const ref = entry.refs[i];
    if (ref.dead || ref.unbound) return error("#REF!");
    const f = frame.get(ref.s);
    if (f === undefined) return error("#REF!");
    const node = entry.parsed.refs[i];
    const from = node.type === "ref" ? node : node.from;
    const to = node.type === "ref" ? node : node.to;
    const end = (id, at, typed, open) => (id === null ? open : id === undefined ? typed : at.get(id));
    const top = end(ref.r0, f.rowAt, (from.row ?? 1) - 1, 0);
    const bottom = end(ref.r1, f.rowAt, (to.row ?? 1) - 1, f.rows.length - 1);
    const left = end(ref.c0, f.colAt, from.col === null ? 0 : lettersIndex(from.col), 0);
    const right = end(ref.c1, f.colAt, to.col === null ? 0 : lettersIndex(to.col), f.cols.length - 1);
    if ([top, bottom, left, right].includes(undefined)) return error("#REF!");
    return { isArea: true, top: Math.min(top, bottom), left: Math.min(left, right), height: Math.abs(bottom - top) + 1, width: Math.abs(right - left) + 1 };
  }

  function link(entry) {
    entry.refs.forEach((ref, i) => {
      if (ref.dead || ref.unbound) return;
      if (ref.cell && !entry.stretch.has(i)) {
        if (ref.r0 === undefined || ref.c0 === undefined) return;
        const key = keyOf(ref.s, ref.r0, ref.c0);
        if (!readers.has(key)) readers.set(key, new Set());
        readers.get(key).add(entry);
        return;
      }
      if (!ranges.has(ref.s)) ranges.set(ref.s, new Set());
      ranges.get(ref.s).add({ ref, entry, i });
    });
  }

  function unlink(entry) {
    for (const [i, ref] of entry.refs.entries()) {
      if (ref.dead || ref.unbound) continue;
      if (ref.cell && !entry.stretch.has(i)) {
        if (ref.r0 === undefined || ref.c0 === undefined) continue;
        const key = keyOf(ref.s, ref.r0, ref.c0);
        readers.get(key)?.delete(entry);
        if (readers.get(key)?.size === 0) readers.delete(key);
        continue;
      }
      const list = ranges.get(ref.s);
      if (list === undefined) continue;
      for (const item of list) if (item.entry === entry) list.delete(item);
    }
  }

  function add(sheet, row, col, f) {
    const key = keyOf(sheet, row, col);
    const old = formulas.get(key);
    if (old !== undefined) unlink(old);
    const bound = bind(f, sheet, frame);
    const entry = { key, sheet, row, col, f, parsed: bound?.parsed ?? null, refs: bound?.refs ?? [], run: bound === null ? null : compileOf(f, bound.parsed) };
    // A reference with an end past the edge, or to a tab name no tab has, binds again after every
    // frame change (design 3.2 rule 8); ROW() and COLUMN() change when their cell moves.
    entry.floating = entry.refs.some((ref) => ref.unbound || (!ref.dead && [ref.r0, ref.c0, ref.r1, ref.c1].includes(undefined)));
    entry.place = PLACE.test(f);
    entry.stretch = stretchesOf(entry.parsed);
    entry.volatile = callsVolatile(entry.parsed);
    entry.calls = callsOf(entry.parsed);
    // The names whose arrival changes the result: a SUBTOTAL call also reads its codes' functions.
    entry.hears = entry.calls.includes("SUBTOTAL") ? [...entry.calls, ...SUBTOTAL_NAMES] : entry.calls;
    entry.subtotal = entry.parsed !== null && /\bSUBTOTAL\s*\(/i.test(f);
    // A reference written with a tab name binds by that name, so a tab insert, delete or rename can
    // change what it names even when its text stays the same (an undo out of order leaves such text).
    entry.named = entry.parsed !== null && entry.parsed.refs.some((node) => node.sheet !== null);
    formulas.set(key, entry);
    link(entry);
    return entry;
  }

  // What a formula means: its text with each reference masked, and the ids the references bind.
  // Only a rewrite's reprint of the same references compares equal; any other change compares
  // different, which costs a computation and never a wrong result.
  const meaning = (entry) => {
    if (entry.run === null) return null;
    let text = entry.f.slice(1);
    for (const [from, to] of entry.parsed.refs.map((node) => node.span).sort((a, b) => b[0] - a[0])) text = `${text.slice(0, from)}\u0001${text.slice(to)}`;
    return JSON.stringify([text, cornersUnordered(idsOf(entry))]);
  };

  // Whether a bound end of the formula names a record the frame no longer has: a rewrite that
  // lost the record can leave the same text (design 3.2 rule 7), which now means something else.
  const lost = (entry) =>
    entry.refs.some((ref) => {
      if (ref.dead || ref.unbound) return false;
      const f = frame.get(ref.s);
      if (f === undefined) return true;
      return [ref.r0, ref.r1].some((id) => id !== null && id !== undefined && !f.rowAt.has(id)) || [ref.c0, ref.c1].some((id) => id !== null && id !== undefined && !f.colAt.has(id));
    });

  function remove(key) {
    const entry = formulas.get(key);
    if (entry === undefined) return;
    unlink(entry);
    formulas.delete(key);
    results.delete(key);
  }

  // The formulas that read a changed cell, directly or through other formulas.
  function dirtyFrom(seeds) {
    const boxes = new Map();
    const itemBox = (item) => {
      if (!boxes.has(item)) {
        const box = refBox(item.entry, item.i);
        boxes.set(item, box === null || box.length === 0 ? null : box);
      }
      return boxes.get(item);
    };
    const dirty = new Set();
    const seen = new Set();
    const queue = [...seeds];
    const take = (entry) => {
      if (dirty.has(entry)) return;
      dirty.add(entry);
      queue.push(entry.key);
    };
    while (queue.length > 0) {
      const key = queue.pop();
      if (seen.has(key)) continue;
      seen.add(key);
      const own = formulas.get(key);
      if (own !== undefined) take(own);
      for (const entry of readers.get(key) ?? []) take(entry);
      const [sheet, row, col] = key.split("\u0000");
      const list = ranges.get(sheet);
      const f = frame.get(sheet);
      if (list === undefined || f === undefined) continue;
      const r = f.rowAt.get(row);
      const c = f.colAt.get(col);
      if (r === undefined || c === undefined) continue;
      for (const item of list) {
        const box = itemBox(item);
        if (box !== null && r >= box[0] && r <= box[1] && c >= box[2] && c <= box[3]) take(item.entry);
      }
    }
    return dirty;
  }

  // The dirty formulas as strongly connected parts, each after every part it reads (Tarjan's
  // algorithm, kept on an explicit stack so a chain of 19,000 cells cannot overflow the call
  // stack). A part of more than one formula, or one formula that reads itself, is a cycle; every
  // other formula is computed, whatever cycles it reads or feeds, as Sheets does.
  function ordered(dirty) {
    const list = [...dirty];
    const at = new Map(list.map((entry, i) => [entry, i]));
    const where = list.map((entry) => {
      const f = frame.get(entry.sheet);
      return [f.rowAt.get(entry.row), f.colAt.get(entry.col)];
    });
    const bySheet = new Map();
    list.forEach((entry, i) => {
      if (!bySheet.has(entry.sheet)) bySheet.set(entry.sheet, []);
      bySheet.get(entry.sheet).push(i);
    });
    const reads = list.map(() => []);
    const self = new Set();
    const edge = (i, target) => {
      reads[i].push(target);
      if (target === i) self.add(i);
    };
    list.forEach((entry, i) => {
      entry.refs.forEach((ref, k) => {
        if (ref.dead || ref.unbound) return;
        if (ref.cell && !entry.stretch.has(k)) {
          if (ref.r0 === undefined || ref.c0 === undefined) return;
          const target = formulas.get(keyOf(ref.s, ref.r0, ref.c0));
          if (target !== undefined && at.has(target)) edge(i, at.get(target));
          return;
        }
        const box = refBox(entry, k);
        if (box === null || box.length === 0) return;
        for (const j of bySheet.get(ref.s) ?? []) {
          const [r, c] = where[j];
          if (r >= box[0] && r <= box[1] && c >= box[2] && c <= box[3]) edge(i, j);
        }
      });
    });
    const index = new Int32Array(list.length).fill(-1);
    const low = new Int32Array(list.length);
    const held = new Uint8Array(list.length);
    const stack = [];
    const parts = [];
    let count = 0;
    for (let root = 0; root < list.length; root++) {
      if (index[root] !== -1) continue;
      index[root] = low[root] = count++;
      stack.push(root);
      held[root] = 1;
      const work = [[root, 0]];
      while (work.length > 0) {
        const top = work[work.length - 1];
        const v = top[0];
        if (top[1] < reads[v].length) {
          const w = reads[v][top[1]++];
          if (index[w] === -1) {
            index[w] = low[w] = count++;
            stack.push(w);
            held[w] = 1;
            work.push([w, 0]);
          } else if (held[w] === 1 && index[w] < low[v]) low[v] = index[w];
          continue;
        }
        work.pop();
        if (work.length > 0) {
          const u = work[work.length - 1][0];
          if (low[v] < low[u]) low[u] = low[v];
        }
        if (low[v] !== index[v]) continue;
        const part = [];
        let w;
        do {
          w = stack.pop();
          held[w] = 0;
          part.push(list[w]);
        } while (w !== v);
        parts.push({ entries: part, cycle: part.length > 1 || self.has(v) });
      }
    }
    return parts;
  }

  function evaluate(entry) {
    if (entry.run === null) return error("#ERROR!");
    const f = frame.get(entry.sheet);
    const ctx = {
      home: { row: f.rowAt.get(entry.row), col: f.colAt.get(entry.col) },
      read: (i, whole) => read(entry, i, whole),
      area: (i) => area(entry, i),
      now,
      random,
    };
    let value;
    try {
      value = single(entry.run(ctx));
    } catch (err) {
      if (err instanceof RangeError) return error("#NUM!");
      throw err;
    }
    if (value === undefined || isRange(value)) return value === undefined ? null : error("#VALUE!");
    if (typeof value === "number" && !Number.isFinite(value)) return error("#NUM!");
    return value;
  }

  // The cell's stored parts for a result, the cell's format fields kept.
  function partsOf(cell, column, value) {
    const shownValue = isError(value) ? value.error : value;
    const next = { ...derive({ f: cell.f }, effectiveFmt(cell, column), shownValue) };
    for (const key of ["fmt", "colspan", "rowspan", "style"]) if (cell[key] !== undefined) next[key] = cell[key];
    return next;
  }

  // Writes each result whose stored parts change; returns those cells.
  // `own` holds the keys of cells the step itself wrote: their results are drawn as part of the
  // step's edit (`loudly`), so a page undo of the step takes the result back with the formula.
  function store(entries, own = null) {
    const written = [];
    const writes = [];
    const loud = [];
    const soft = [];
    for (const entry of entries) {
      const tab = tabs.get(entry.sheet);
      const r = tab.backing.rowIndex(entry.row);
      const c = tab.backing.colIndex(entry.col);
      const cell = tab.backing.cell(r, c);
      if (cell === null || cell.f === undefined) continue;
      const column = tab.backing.cols()[c];
      const value = results.get(entry.key) ?? null;
      // Under a format no formatter knows yet, a cell that already holds this value keeps the text
      // it was saved with ("30.00 kg"); one that does not is written plain and waits for the
      // formatter, as the reducer's own writes do.
      if (fmtKind(effectiveFmt(cell, column)) === "unknown" && !isError(value) && cellValue(cell) === (typeof value === "number" ? typed(shown(value)) : value)) continue;
      const next = partsOf(cell, column, value);
      if (RESULT_FIELDS.every((key) => cell[key] === next[key])) continue;
      // Opening a sheet saved before its formatter existed draws the same value in its code.
      const redrawn = loading && cellValue(cell) === (typeof value === "number" ? typed(shown(value)) : value);
      (own !== null && own.has(entry.key) && tab.backing.loudly ? loud : hushed?.has(entry) || redrawn ? soft : writes).push([tab.backing, r, c, next]);
      written.push({ sheet: entry.sheet, row: entry.row, col: entry.col });
    }
    for (const [backing, r, c, next] of loud) backing.loudly(() => backing.putCell(r, c, next));
    if (writes.length > 0) write(() => writes.forEach(([backing, r, c, next]) => backing.putCell(r, c, next)));
    if (soft.length > 0) quiet(() => soft.forEach(([backing, r, c, next]) => backing.putCell(r, c, next)));
    return written;
  }

  // While loading, a formula that calls a function nobody has added yet (the extended pack, still
  // on its way) keeps the value it was saved with, so opening a saved sheet writes nothing. A cell
  // saved with no result computes, and shows #NAME?.
  let loading = false;
  const pending = (entry) => entry.hears.some((name) => lookupFunction(name) === null);
  function savedValue(entry) {
    const tab = tabs.get(entry.sheet);
    const cell = tab.backing.cell(tab.backing.rowIndex(entry.row), tab.backing.colIndex(entry.col));
    if (cell === null) return null;
    const value = cellValue(cell);
    // A saved error is stored as its text; formulas reading it get the error back.
    return typeof value === "string" && cell.t !== true && ERRORS.includes(value) ? error(value) : value;
  }

  // TEXT with a code no formatter knows yet is #VALUE!; at load it keeps its saved text until the
  // formatters arrive.
  function loaded(entry) {
    if (pending(entry)) return savedValue(entry) ?? evaluate(entry);
    const value = evaluate(entry);
    return entry.calls.includes("TEXT") && isError(value) && value.error === "#VALUE!" ? savedValue(entry) ?? value : value;
  }

  function recalc(seeds, kept = [], own = null) {
    const done = [];
    for (const { entries, cycle } of ordered(dirtyFrom(seeds))) {
      for (const entry of entries) {
        results.set(entry.key, cycle ? error("#REF!", "circular") : loading ? loaded(entry) : evaluate(entry));
        done.push(entry);
      }
    }
    last = done.length;
    return store([...done, ...kept], own);
  }

  function scanTab(tab, seeds) {
    const rows = tab.backing.rows();
    const cols = tab.backing.cols();
    rows.forEach((row, r) => {
      cols.forEach((col, c) => {
        const cell = tab.backing.cell(r, c);
        if (cell !== null && cell.hidden !== true && cell.f !== undefined) seeds.push(add(tab.id, row.id, col.id, cell.f).key);
      });
    });
  }

  // A tab whose every formula has a result and that has no number waiting for a formatter is not
  // stale.
  function settle(writeWith = write) {
    for (const tab of tabs.values()) {
      if (tab.backing.sheet.stale !== true) continue;
      const cols = tab.backing.cols();
      let waiting = false;
      tab.backing.rows().forEach((_, r) => {
        cols.forEach((column, c) => {
          const cell = tab.backing.cell(r, c);
          if (!waiting && cell !== null && waitsForFormatter(cell, effectiveFmt(cell, column))) waiting = true;
        });
      });
      if (!waiting) writeWith(() => tab.backing.setStale(false));
    }
  }

  // Binds and computes every formula of the workbook, writing results that differ from what the
  // cells hold. Returns the result cells written.
  function load() {
    formulas.clear();
    results.clear();
    readers.clear();
    ranges.clear();
    look();
    const seeds = [];
    for (const tab of tabs.values()) scanTab(tab, seeds);
    // A result that changed only because of TODAY or RAND, or because a function added after the
    // file was saved computes it now, is written quietly.
    hushed = dirtyFrom([...formulas.values()].filter((entry) => entry.volatile || entry.hears.some(isAddedFunction)).map((entry) => entry.key));
    loading = true;
    try {
      const written = recalc(seeds);
      settle();
      return written;
    } finally {
      hushed = null;
      loading = false;
    }
  }

  // Formulas whose results change because functions or formatters arrived or left: computed
  // again and written quietly, since nobody edited, and announced like any computed step.
  function again(entries) {
    if (entries.length === 0) return;
    const seeds = entries.map((entry) => entry.key);
    hushed = dirtyFrom(seeds);
    try {
      const written = recalc(seeds);
      settle(quiet);
      announce({ sheets: [], cells: [], rows: [], cols: [], results: written });
    } finally {
      hushed = null;
    }
  }

  // Formatters arriving change how results are drawn, not what they are: each result under a custom
  // code is stored again as it is, so a formula still waiting for a function keeps its saved value.
  // The stale mark stays for the grid's own refresh, which draws the typed cells under new codes.
  function redraw(entries) {
    const ready = entries.filter((entry) => results.has(entry.key));
    if (ready.length === 0) return;
    hushed = new Set(ready);
    try {
      announce({ sheets: [], cells: [], rows: [], cols: [], results: store(ready) });
    } finally {
      hushed = null;
    }
  }
  const customFormat = (entry) => {
    const tab = tabs.get(entry.sheet);
    const r = tab.backing.rowIndex(entry.row);
    const c = tab.backing.colIndex(entry.col);
    const fmt = r < 0 || c < 0 ? null : effectiveFmt(tab.backing.cell(r, c), tab.backing.cols()[c]);
    return typeof fmt === "string" && fmt !== "" && !isBuiltin(fmt);
  };
  const unlisten = [
    onFunctionsAdded((names) => again([...formulas.values()].filter((entry) => entry.hears.some((name) => names.includes(name))))),
    onFormattersChanged(() => {
      again([...formulas.values()].filter((entry) => entry.calls.includes("TEXT")));
      redraw([...formulas.values()].filter(customFormat));
    }),
  ];

  // After `applyWorkbook` applied a step: the formulas its cells hold are bound again, and every
  // formula that reads what changed is computed again. Returns the result cells written.
  // `fromStep` is false for a write from outside the grid, which may itself be a page undo: its
  // results are not edits of their own.
  function update(changed, { fromStep = true } = {}) {
    const reframed = changed.structure || changed.sheets.length > 0;
    const before = frame;
    if (reframed) look();
    const seeds = [];
    const kept = [];
    if (reframed) {
      for (const [key, entry] of [...formulas]) {
        const f = frame.get(entry.sheet);
        if (f === undefined || !f.rowAt.has(entry.row) || !f.colAt.has(entry.col)) {
          remove(key);
          seeds.push(key);
        }
      }
      // A whole-width sort moves row records under formulas that keep their text, so every formula
      // on the sorted tab binds again from its text, and so does every formula naming that tab.
      const sorted = new Set(changed.sorted ?? []);
      for (const id of new Set([...changed.sheets, ...sorted])) {
        const tab = tabs.get(id);
        if (tab === undefined) continue;
        for (const [key, entry] of [...formulas]) if (entry.sheet === id) remove(key);
        scanTab(tab, seeds);
      }
      const moved = new Set([...changed.rows, ...changed.cols].filter((change) => RESHAPING.has(change.kind)).map((change) => change.sheet));
      // A range computes again only when the rows or columns inside it are not the ones that were
      // inside it before the step: a row inserted above a row's own SUM moves it and changes nothing.
      const regrouped = (ref, node) => {
        const now = boxOf(ref, node);
        const was = boxOf(ref, node, before);
        const f = frame.get(ref.s);
        const o = before.get(ref.s);
        if (now === null || was === null || o === undefined) return true;
        if (now.length === 0 || was.length === 0) return now.length !== was.length;
        const same = (ids, old, a, b, oa, ob) => b - a === ob - oa && ids.slice(a, b + 1).every((id, i) => id === old[oa + i]);
        return !same(f.rows, o.rows, now[0], now[1], was[0], was[1]) || !same(f.cols, o.cols, now[2], now[3], was[2], was[3]);
      };
      const renamed = changed.sheets.length > 0;
      for (const entry of [...formulas.values()]) {
        if (entry.floating || (renamed && entry.named) || (entry.named && entry.refs.some((ref) => sorted.has(ref.s))) || lost(entry)) {
          const again = add(entry.sheet, entry.row, entry.col, entry.f);
          // A range on a sorted tab, or a cell a SUMIF stretches into one, holds other rows even when
          // its end rows are the same.
          if (entry.floating || (entry.named && entry.refs.some((ref) => sorted.has(ref.s) && (!ref.cell || entry.stretch.size > 0))) || meaning(again) !== meaning(entry)) seeds.push(again.key);
        }
        // A stretched sum range's cells depend on the criteria range's shape, so any move on its tab
        // computes it again.
        else if ((entry.place || entry.stretch.size > 0) && (moved.has(entry.sheet) || entry.refs.some((ref) => moved.has(ref.s)))) seeds.push(entry.key);
        else if (entry.refs.some((ref, i) => !ref.cell && !ref.dead && !ref.unbound && moved.has(ref.s) && regrouped(ref, entry.parsed.refs[i]))) seeds.push(entry.key);
      }
    }
    for (const { sheet, row, col } of changed.cells) {
      const tab = tabs.get(sheet);
      const key = keyOf(sheet, row, col);
      const r = tab?.backing.rowIndex(row) ?? -1;
      const c = tab?.backing.colIndex(col) ?? -1;
      const cell = r < 0 || c < 0 ? null : tab.backing.cell(r, c);
      if (cell !== null && cell.hidden !== true && cell.f !== undefined) {
        const old = formulas.get(key);
        // The same text means the same cells only in the same frame.
        // A skipped formula still gets its result written back: a write that set the formula
        // again (a paste of the same text, an undo) left the cell with no result.
        if (!reframed && old?.f === cell.f) {
          kept.push(old);
          continue;
        }
        const entry = add(sheet, row, col, cell.f);
        // A formula a rewrite printed again in a new frame means what it meant: nothing to compute,
        // unless it was waiting on a result.
        if (old !== undefined && results.has(key) && meaning(old) !== null && meaning(old) === meaning(entry)) {
          kept.push(entry);
          continue;
        }
      } else remove(key);
      seeds.push(key);
    }
    const own = fromStep ? new Set(changed.cells.map(({ sheet, row, col }) => keyOf(sheet, row, col))) : null;
    const written = recalc(seeds, kept, own);
    settle();
    return written;
  }

  // What a tab's listeners hear after a step a Grid did not make itself: the cells, rows and
  // columns the step changed on that tab (source "workbook", an edit of that tab), then the result
  // cells written there (source "derived").
  function announce(changed, from = null) {
    const bySheet = (list) => {
      const out = new Map();
      for (const item of list) {
        if (!out.has(item.sheet)) out.set(item.sheet, []);
        out.get(item.sheet).push(item);
      }
      return out;
    };
    const cells = bySheet(changed.cells);
    const rows = bySheet(changed.rows);
    const cols = bySheet(changed.cols);
    const table = bySheet(changed.table ?? []);
    for (const [sheet, heard] of listeners) {
      if (sheet !== from && (cells.has(sheet) || rows.has(sheet) || cols.has(sheet) || table.has(sheet) || changed.sheets.includes(sheet))) {
        for (const listener of [...heard]) listener({ source: "workbook", cells: cells.get(sheet) ?? [], rows: rows.get(sheet) ?? [], cols: cols.get(sheet) ?? [], structure: changed.structure || table.has(sheet) });
      }
    }
    for (const [sheet, list] of bySheet(changed.results ?? [])) {
      for (const listener of [...(listeners.get(sheet) ?? [])]) listener({ source: "derived", results: list });
    }
  }

  function on(sheet, listener) {
    if (!listeners.has(sheet)) listeners.set(sheet, new Set());
    listeners.get(sheet).add(listener);
    return () => listeners.get(sheet)?.delete(listener);
  }

  const resultOf = (sheet, row, col) => {
    const key = keyOf(sheet, row, col);
    return formulas.has(key) ? results.get(key) ?? null : undefined;
  };

  return {
    workbook: wb,
    load,
    // Stops hearing functions and formatters arrive; an engine nobody uses any more calls it.
    dispose() {
      unlisten.forEach((off) => off());
    },
    update,
    announce,
    on,
    // A formula cell's result (an error as `{ error }`), or undefined for a cell with no formula.
    result: resultOf,
    // The parts a writer stores for a formula cell's result, or undefined: the writer's `extras`.
    extras(sheet, row, col) {
      const value = resultOf(sheet, row, col);
      const tab = tabs.get(sheet);
      const r = tab?.backing.rowIndex(row) ?? -1;
      const c = tab?.backing.colIndex(col) ?? -1;
      if (value === undefined || r < 0 || c < 0) return undefined;
      const parts = partsOf(tab.backing.cell(r, c), tab.backing.cols()[c], value);
      return { text: parts.text, v: parts.v, n: parts.n, t: parts.t };
    },
    // How many formulas the engine holds, and how many its last load or step computed: for tests
    // that a step computes only what depends on it.
    get size() {
      return formulas.size;
    },
    get computed() {
      return last;
    },
  };
}
