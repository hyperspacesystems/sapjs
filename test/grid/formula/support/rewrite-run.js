// The rewrite fuzz: formula references through the real workbook apply across structural edits.
//
// Properties checked on every seed (two tabs, random formulas with cell, range, whole column,
// absolute and cross-tab references and references to names no tab has, and random insert, delete
// and move of rows and columns, formula sets, formula overwrites and tab renames, moves and
// deletes):
//   P1 meaning: a reference whose target records were never deleted still binds, in the current
//      frame, to the same records it was first bound to.
//   P2 undo out of order: undoing an action after later actions (a peer's edit in the room's order)
//      brings back every reference that the undone action had cut.
//   P3 a whole unwind: undoing every action, last first, gives back the first bytes of every tab.
//   P4 a twin read from the bytes: applying an action to a workbook read back from its own bytes
//      gives the same bytes.
//   P6 same inverse: the inverse (records change and restore list) computed on a twin equals the
//      original's, so every replica can work out an undo from the action alone.
//   P7 delayed sets: a formula authored with ids at one step and delivered a few steps later (as
//      when the room orders a peer's edits first) means what its author bound it to; and sets that
//      overwrite a formula with a number exercise the bound inverse of a set.
//   P5 the control: the same session with every restore list emptied fails P2 or P3.

import { applyWorkbook, createEngine as makeEngine, modelWorkbook } from "../../../../src/grid/index.js";
import { bind, frameOf, idsOf } from "../../../../src/grid/index.js";
import { buildDeleteCols, buildDeleteRows, buildInsertCols, buildInsertRows, buildMoveRows, buildSet } from "../../../../src/grid/build.js";
import { colName } from "../../../../src/grid/a1.js";
import { gridModel } from "../../../../src/grid/codec/read.js";
import { tableHtml } from "../../../../src/grid/codec/write.js";
import { keysBetween } from "../../../../src/grid/codec/order-keys.js";
import { docOf, sheetCodec } from "../../../../src/grid/room-codec.js";

const STEPS = 40;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let idn = 0;
const mint = (prefix) => `${prefix}${(idn++).toString(36)}`;

function makeSheet(id, name, pos, rows, cols, rand) {
  const rkeys = keysBetween(null, null, rows);
  const ckeys = keysBetween(null, null, cols);
  const sheet = {
    cols: ckeys.map((key) => ({ id: mint("c"), pos: key })),
    rows: rkeys.map((key) => ({ id: mint("r"), pos: key, cells: [] })),
  };
  for (const row of sheet.rows) {
    for (let c = 0; c < cols; c++) row.cells.push(rand() < 0.5 ? { text: String(Math.floor(rand() * 100)), n: true } : null);
    while (row.cells.length > 0 && row.cells[row.cells.length - 1] === null) row.cells.pop();
  }
  return { id, name, pos, sheet };
}

function randomRef(rand, home, otherSheet, otherName) {
  const cross = rand() < 0.25;
  const target = cross ? otherSheet : home;
  const rows = target.backing.rows().length;
  const cols = target.backing.cols().length;
  const a = () => (rand() < 0.2 ? "$" : "");
  const col = () => colName(Math.floor(rand() * cols));
  const row = () => 1 + Math.floor(rand() * rows);
  const prefix = cross ? `${otherName}!` : "";
  const k = rand();
  if (rand() < 0.3) {
    const far = rows + 1 + Math.floor(rand() * 4);
    if (rand() < 0.4) return `${prefix}${col()}${far}`;
    return `${prefix}${col()}${row()}:${col()}${far}`;
  }
  if (k < 0.5) return `${prefix}${a()}${col()}${a()}${row()}`;
  if (k < 0.85) {
    const r0 = row();
    const r1 = Math.min(rows, r0 + Math.floor(rand() * 5));
    const c0 = Math.floor(rand() * cols);
    const c1 = Math.min(cols - 1, c0 + Math.floor(rand() * 2));
    return `${prefix}${colName(c0)}${r0}:${colName(c1)}${r1}`;
  }
  const x = Math.floor(rand() * cols);
  // A range open at its bottom, as people total a column below its header (`B2:B`).
  if (k < 0.93) return `${prefix}${colName(x)}${row()}:${colName(x)}`;
  const y = Math.min(cols - 1, x + Math.floor(rand() * 2));
  return `${prefix}${colName(x)}:${colName(y)}`;
}

const quoted = (name) => (/^[A-Za-z]+$/.test(name) ? name : `'${name.split("'").join("''")}'`);

function addFormulas(wb, rand, count) {
  for (let i = 0; i < count; i++) {
    const sheets = wb.sheets();
    const s = sheets[Math.floor(rand() * sheets.length)];
    const otherSheet = sheets.find((tab) => tab !== s);
    const other = quoted(otherSheet.name);
    const rows = s.backing.rows();
    const r = Math.floor(rand() * rows.length);
    const c = Math.floor(rand() * s.backing.cols().length);
    const f = `=SUM(${randomRef(rand, s, otherSheet, other)})+${randomRef(rand, s, otherSheet, other)}*2${i % 4 === 0 ? (i % 8 === 0 ? "+'Q1 2026'!B2" : "+Totals!B2") : ""}`;
    s.backing.putCell(r, c, { text: "0", n: true, f });
  }
}

const bytes = (wb) => wb.sheets().map((tab) => tableHtml(tab.backing.sheet).replace("<table grid stale>", "<table grid>")).join("\n");

const corners = (ref) => (ref === null || ref[0] === "~" ? ref : [ref[0], ...[ref[1], ref[3]].sort(), ...[ref[2], ref[4]].sort()]);

// Each formula cell's meaning: the ids of each reference, by the cell's own ids.
function meanings(wb) {
  const frame = frameOf(wb);
  const out = new Map();
  for (const s of wb.sheets()) {
    s.backing.rows().forEach((row) => {
      row.cells.forEach((cell, c) => {
        if (!cell || cell.f === undefined) return;
        const bound = bind(cell.f, s.id, frame);
        out.set(`${s.id}|${row.id}|${s.backing.cols()[c].id}`, bound ? JSON.stringify(idsOf(bound).map(corners)) : "x");
      });
    });
  }
  return out;
}

// Whether an id form holds an end past the sheet's edge.
const floats = (form) => JSON.parse(form).some((ref) => Array.isArray(ref) && ref[0] !== "~" && ref.slice(1).some((id) => id === 0));

function randomAction(wb, rand) {
  const sheets = wb.sheets();
  const s = sheets[Math.floor(rand() * sheets.length)];
  const b = s.backing;
  const n = b.rows().length;
  const m = b.cols().length;
  const k = rand();
  const newId = mint;
  if (k < 0.3) return buildInsertRows(b, String(1 + Math.floor(rand() * (n + 1))), 1 + Math.floor(rand() * 2), { newId });
  if (k < 0.5 && n > 4) {
    const r = 1 + Math.floor(rand() * n);
    return buildDeleteRows(b, `${r}:${Math.min(n, r + Math.floor(rand() * 2))}`);
  }
  if (k < 0.65) return buildInsertCols(b, colName(Math.floor(rand() * (m + 1))), 1, { newId });
  if (k < 0.75 && m > 3) return buildDeleteCols(b, colName(Math.floor(rand() * m)));
  const r = 1 + Math.floor(rand() * n);
  return buildMoveRows(b, `${r}:${r}`, String(1 + Math.floor(rand() * (n + 1))));
}

const NAMES = ["Budget", "Notes tab", "Q1 2026", "Data", "Sheet's copy", "Totals", "A1"];

function tabAction(wb, rand) {
  const sheets = wb.sheets();
  if (rand() < 0.6 || sheets.length === 1) {
    const s = sheets[Math.floor(rand() * sheets.length)];
    const free = NAMES.filter((name) => !sheets.some((tab) => tab.name.toLowerCase() === name.toLowerCase()));
    if (free.length === 0) return null;
    return { v: 1, t: "renameSheet", sheet: s.id, name: free[Math.floor(rand() * free.length)] };
  }
  if (rand() < 0.5) {
    const s = sheets[Math.floor(rand() * sheets.length)];
    return { v: 1, t: "moveSheet", sheet: s.id, pos: `${1 + Math.floor(rand() * 9)}A` };
  }
  return { v: 1, t: "deleteSheet", sheet: sheets[Math.floor(rand() * sheets.length)].id };
}

// A formula authored now, with the ids it means now, to be delivered later.
function authorFormula(wb, rand) {
  const sheets = wb.sheets();
  const s = sheets[Math.floor(rand() * sheets.length)];
  const otherSheet = sheets.find((tab) => tab !== s);
  const other = quoted(otherSheet.name);
  const rows = s.backing.rows();
  const r = Math.floor(rand() * rows.length);
  const c = Math.floor(rand() * s.backing.cols().length);
  if (rows[r].cells[c] && rows[r].cells[c].f !== undefined) return null;
  const f = `=SUM(${randomRef(rand, s, otherSheet, other)})-${randomRef(rand, s, otherSheet, other)}`;
  const bound = bind(f, s.id, frameOf(wb));
  if (bound === null || idsOf(bound).some((ref) => ref === null)) return null;
  return { sheet: s.id, row: rows[r].id, col: s.backing.cols()[c].id, f, refs: idsOf(bound) };
}

function deliver(wb, item) {
  const s = wb.sheets().find((tab) => tab.id === item.sheet);
  if (!s) return null;
  const r = s.backing.rowIndex(item.row);
  const c = s.backing.colIndex(item.col);
  if (r < 0 || c < 0) return null;
  const cell = s.backing.cell(r, c);
  if (cell && cell.f !== undefined) return null;
  return buildSet(s.backing, colName(c) + (r + 1), { f: item.f, refs: item.refs });
}

function overwriteFormula(wb, rand) {
  const sheets = wb.sheets();
  const s = sheets[Math.floor(rand() * sheets.length)];
  const found = [];
  s.backing.rows().forEach((row, r) => row.cells.forEach((cell, c) => { if (cell && cell.f !== undefined) found.push([r, c]); }));
  if (found.length === 0) return null;
  const [r, c] = found[Math.floor(rand() * found.length)];
  return buildSet(s.backing, colName(c) + (r + 1), Math.floor(rand() * 100));
}

const setKey = (wb, action) => {
  const s = wb.sheets().find((tab) => tab.id === action.sheet);
  return action.cells.map(([rid, cid]) => `${s.id}|${rid}|${cid}`);
};

function deadRecords(log) {
  const dead = new Set();
  for (const entry of log) {
    if (entry.undone) continue;
    const walk = (a) => {
      if (a.t === "batch") return a.actions.forEach(walk);
      if (a.t === "deleteRows") a.rows.forEach((id) => dead.add(id));
      if (a.t === "deleteSheet") dead.add(a.sheet);
      if (a.t === "deleteCols") a.cols.forEach((id) => dead.add(id));
    };
    walk(entry.action);
  }
  return dead;
}

const twinOf = (wb) =>
  modelWorkbook(wb.sheets().map((tab) => ({ id: tab.id, name: tab.name, pos: tab.pos, sheet: gridModel(tableHtml(tab.backing.sheet), 0) })));

export const limits = { narrowed: 0, name: 0 };

// Which named outcome of an undo out of order turned reference `was` into `now`, or null.
function namedLimit(was, now) {
  if (was === null || !Array.isArray(now)) return null;
  if (was[0] === "~") return now[0] !== "~" ? "name" : null;
  if (now[0] !== was[0]) return null;
  const moved = [1, 2, 3, 4].filter((k) => was[k] !== now[k]);
  return moved.length === 1 && now[moved[0]] !== null && now[moved[0]] !== 0 ? "narrowed" : null;
}

// E1, with `computing`: after every step a fresh engine computing the whole workbook writes no cell
// and finds every result the running engine holds. Returns the first difference, or null.
// Every engine a run makes hears functions and formatters arrive until it is disposed, so a run
// disposes all of its own when it ends; thousands of seeds otherwise run out of memory.
const live = [];
function createEngine(wb) {
  const engine = makeEngine(wb);
  live.push(engine);
  return engine;
}

function computesAgain(wb, engine) {
  const fresh = createEngine(wb);
  const written = fresh.load();
  if (written.length > 0) {
    const tab = wb.sheets().find((one) => one.id === written[0].sheet);
    const cell = tab.backing.cell(tab.backing.rowIndex(written[0].row), tab.backing.colIndex(written[0].col));
    return { cell: written[0], f: cell.f, stored: JSON.stringify(engine.result(written[0].sheet, written[0].row, written[0].col)), now: JSON.stringify(fresh.result(written[0].sheet, written[0].row, written[0].col)), why: "a full computation wrote a result the step left out" };
  }
  for (const tab of wb.sheets()) {
    const rows = tab.backing.rows();
    const cols = tab.backing.cols();
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < cols.length; c++) {
        if (tab.backing.cell(r, c)?.f === undefined) continue;
        const was = JSON.stringify(engine.result(tab.id, rows[r].id, cols[c].id));
        const now = JSON.stringify(fresh.result(tab.id, rows[r].id, cols[c].id));
        if (was !== now) return { cell: { sheet: tab.id, row: rows[r].id, col: cols[c].id }, was, now, why: "the running engine holds another result" };
      }
    }
  }
  return null;
}

export function run(...args) {
  try {
    return runOnce(...args);
  } finally {
    live.splice(0).forEach((engine) => engine.dispose());
  }
}

function runOnce(seed, { naive = false, strict = false, steps = STEPS, computing = false, revert = false } = {}) {
  const rand = rng(seed);
  idn = 0;
  let wb = modelWorkbook([makeSheet("s1", "Budget", "A", 10, 5, rand), makeSheet("s2", "Notes tab", "B", 8, 4, rand)]);
  addFormulas(wb, rand, 14);
  // With `revert` (out of order only) every action and undo goes through the room codec, as in a
  // room: an undo is the codec's guarded revert, and the control empties the revert step's restore.
  // The codec builds a new workbook for each step, so no running engine follows it.
  const viaCodec = revert && !strict;
  const engine = computing && !viaCodec ? createEngine(wb) : null;
  engine?.load();
  const settled = (step) => {
    if (engine === null) return null;
    const off = computesAgain(wb, engine);
    return off === null ? null : { seed, fail: "E1 a full computation differs from the running engine", step, ...off };
  };
  const applyOne = (step) => {
    if (!viaCodec) return applyWorkbook(wb, step, { engine });
    const doc = docOf(wb);
    const out = sheetCodec.apply(doc, step);
    if (out.out === "applied") wb = modelWorkbook(doc.tabs);
    return out;
  };
  const naiveOf = (inverse) => (!viaCodec ? { action: inverse.action, restore: [] } : inverse.step ? { ...inverse, step: { ...inverse.step, restore: [] } } : inverse);
  const first = bytes(wb);
  const m0 = meanings(wb);
  const expect = new Map(m0);
  const stash = [];
  const log = [];
  for (let step = 0; step < steps; step++) {
    if (!strict && log.some((entry) => !entry.undone) && rand() < 0.3) {
      const open = log.filter((entry) => !entry.undone);
      const pick = open[Math.floor(rand() * open.length)];
      const inv = naive ? naiveOf(pick.inverse) : pick.inverse;
      const out = applyOne(inv);
      if (out.out !== "applied") continue;
      const off = settled(step);
      if (off !== null) return off;
      pick.undone = true;
      if (pick.prior) for (const [key, was] of pick.prior) was === undefined ? expect.delete(key) : expect.set(key, was);
      log.push({ action: inv.action, inverse: out.inverse, undo: true, undone: true });
    } else {
      let action;
      let delivered = null;
      try {
        const k = rand();
        if (k < 0.15) {
          const item = authorFormula(wb, rand);
          if (item) stash.push(item);
          continue;
        } else if (k < 0.3 && stash.length) {
          delivered = stash.shift();
          action = deliver(wb, delivered);
        } else if (k < 0.4) {
          action = overwriteFormula(wb, rand);
        } else if (k < 0.5) {
          action = tabAction(wb, rand);
        } else {
          action = randomAction(wb, rand);
        }
      } catch {
        continue;
      }
      if (action === null || action === undefined) continue;
      // P4: the same action on a workbook read back from its bytes gives the same bytes.
      const twin = twinOf(wb);
      const twinEngine = engine === null ? null : createEngine(twin);
      twinEngine?.load();
      const out = applyOne(action);
      if (out.out !== "applied") continue;
      const off = settled(step);
      if (off !== null) return { ...off, action: JSON.stringify(action).slice(0, 300) };
      const out2 = viaCodec ? out : applyWorkbook(twin, action, { engine: twinEngine });
      if (out2.out === "applied" && JSON.stringify(out2.inverse) !== JSON.stringify(out.inverse)) return { seed, fail: "P6 inverse differs on a twin read from bytes", step };
      if (!viaCodec && (out2.out !== "applied" || bytes(twin) !== bytes(wb))) return { seed, fail: "P4 a twin read from bytes writes other bytes", step };
      const entry = { action, inverse: out.inverse };
      if (action.t === "set") {
        const now = meanings(wb);
        entry.prior = setKey(wb, action).map((key) => [key, expect.get(key)]);
        for (const [key] of entry.prior) {
          if (now.has(key)) expect.set(key, now.get(key));
          else expect.delete(key);
        }
        if (delivered) {
          const key = `${delivered.sheet}|${delivered.row}|${delivered.col}`;
          const want = JSON.stringify(delivered.refs.map(corners));
          const dead = deadRecords(log);
          const frame = frameOf(wb);
          const alive = (sid, id, axis) => id === null || (frame.get(sid) && frame.get(sid)[axis].has(id));
          const touchesDead = delivered.refs.some((ref) => dead.has(ref[0]) || !frame.get(ref[0]) || ref.slice(1).some((id) => id !== null && dead.has(id)) || !alive(ref[0], ref[1], "rowAt") || !alive(ref[0], ref[3], "rowAt") || !alive(ref[0], ref[2], "colAt") || !alive(ref[0], ref[4], "colAt"));
          if (!touchesDead && now.get(key) !== want) return { seed, fail: "P7 a delayed set does not mean what its author bound", step, key, want, now: now.get(key) };
        }
      }
      log.push(entry);
    }
    // P1 and P2: every formula whose targets are all alive means what it meant at the start.
    const dead = deadRecords(log);
    const now = meanings(wb);
    for (const [key, was] of expect) {
      if (!now.has(key)) continue;
      if (was === "x") continue;
      const ids = JSON.parse(was);
      const touchesDead = ids.some((ref) => ref === null || ref[0] === "~" || dead.has(ref[0]) || ref.slice(1).some((id) => id === 0 || (id !== null && dead.has(id))));
      if (touchesDead) continue;
      if (now.get(key) === was) continue;
      if (strict) return { seed, fail: "P1/P2 meaning", step, key, was, now: now.get(key) };
    }
  }
  // P3: undo every open action, last first.
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i];
    if (entry.undone) continue;
    const inv = naive ? naiveOf(entry.inverse) : entry.inverse;
    const out = applyOne(inv);
    if (out.out !== "applied") {
      if (strict) return { seed, fail: "P3 an undo was refused", code: out.code, step: i };
      return null;
    }
    const off = settled(`unwind ${i}`);
    if (off !== null) return off;
    entry.undone = true;
  }
  const mEnd = meanings(wb);
  for (const [key, was] of m0) {
    if (was === "x" || floats(was) || mEnd.get(key) === was) continue;
    const keep = new Set(JSON.parse(was).map((ref) => JSON.stringify(ref)));
    if (mEnd.get(key) === "x") return { seed, fail: "P2 a formula no longer binds after unwinding", key, was };
    const now = JSON.parse(mEnd.get(key) ?? "[]");
    if (strict) return { seed, fail: "P2 meaning after unwinding", key, was, now: mEnd.get(key) };
    if (now.every((ref) => keep.has(JSON.stringify(ref)))) continue;
    // Two outcomes of an undo out of order are named, counted in `limits`, and not failures:
    // a range narrowed at one end (David's answer 6, design 3.8), and a reference to a tab name that
    // did not exist, left on the tab a rename gave that name once a later edit guarded its restore.
    const before = JSON.parse(was);
    const kinds = before.map((ref, i) => (JSON.stringify(ref) === JSON.stringify(now[i]) ? "same" : namedLimit(ref, now[i])));
    if (now.length !== before.length || kinds.includes(null)) return { seed, fail: "P2 meaning after unwinding", key, was, now: mEnd.get(key) };
    for (const kind of kinds) if (kind !== "same") limits[kind] += 1;
  }
  if (strict && bytes(wb) !== first) return { seed, fail: "P3 the bytes after the whole unwind" };
  return null;
}
