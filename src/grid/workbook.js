// The workbook apply: the one entry every replica calls (a tab over its DOM workbook, the room's
// admitted copy and the room on the host over model workbooks), so every replica writes the same
// bytes from the same step. A step is an action, or an inverse `{ action, restore }`.
//
// A set prints each formula's `refs` (the ids its author bound it to) in the frame it lands in. A
// structural action (rows or columns inserted, deleted, moved or changed, any tab action) runs, then
// every formula of every tab is bound in the frame before and printed in the frame after, by the
// floating reference rules (`00-design.md` section 3.2). The inverse is the reverse action plus a
// restore list for what the rewrite could not undo by itself: formulas of deleted records, ranges
// that lost an end, typed spellings, references a tab action bound by name or past the edge. A
// restore is guarded: it puts a formula back only while the formula still means what this action
// left there, judged before the inverse's own rewrite (rule 6). All or nothing: when the rewrite or
// a restore throws, every write is taken back and the step is refused.
// Rules (a tab's checkboxes, dropdowns and conditional formats) move with every structural or tab
// step as formulas do, and the inverse carries a guarded `rules` list beside `restore`
// (`settleRules`).

import { gridModel } from "./codec/read.js";
import { isKey, keysBetween } from "./codec/order-keys.js";
import { contentOf, derive as defaultDerive } from "./content.js";
import { apply, cellExtra, GridRefused, inverseContent } from "./ops.js";
import { modelBacking } from "./backing-model.js";
import { bind, cornersUnordered, frameFrom, fromIds, idsOf, lossy, moveAnchored, originalSlots, print, restoreSlots, shiftRows, slotsOf, topLeftOf } from "./formula/text.js";
import { MAX_BOX_COL, sameRule } from "./codec/rules.js";
import { colIndex, colName } from "./a1.js";

const STRUCTURAL = new Set(["insertRows", "deleteRows", "changeRows", "insertCols", "deleteCols", "changeCols"]);
const TAB = new Set(["insertSheet", "deleteSheet", "renameSheet", "moveSheet"]);

const refusal = (code, detail) => ({ out: "refused", code, detail });
// A set that grows the sheet (typing past its edge) inserts rows or columns too.
const grows = (action) => action.t === "set" && ((action.rows?.length ?? 0) > 0 || (action.cols?.length ?? 0) > 0);
const structural = (action) => (action.t === "batch" ? action.actions.some(structural) : STRUCTURAL.has(action.t) || grows(action));
// Inserted and deleted rows and columns move a rule's ranges; a move or a sort does not, since a rule
// covers places in the sheet (Sheets keeps a rule where it is when rows are sorted or moved).
const RESIZES = new Set(["insertRows", "deleteRows", "insertCols", "deleteCols"]);
const resizes = (action) => (action.t === "batch" ? action.actions.some(resizes) : RESIZES.has(action.t) || grows(action));
const sheetOf = (action) => (action.t === "batch" ? action.actions[0]?.sheet : action.sheet);
// A formula content is always `{ f }`; a string is text, even one that starts with "=" (the reducer's rule).
const formulaOf = (content) => (content && typeof content === "object" && typeof content.f === "string" ? content.f : null);

export function frameOf(wb) {
  return frameFrom(wb.sheets().map((tab) => ({ id: tab.id, name: tab.name, rows: tab.backing.rows().map((row) => row.id), cols: tab.backing.cols().map((col) => col.id) })));
}

// Every formula cell of these tabs: [tab, r, c, cell].
function* formulaCells(tabs) {
  for (const tab of tabs) {
    const rows = tab.backing.rows();
    for (let r = 0; r < rows.length; r++) {
      const cells = rows[r].cells;
      for (let c = 0; c < cells.length; c++) if (cells[c] && cells[c].f !== undefined) yield [tab, r, c, cells[c]];
    }
  }
}

// A formula's A1 text for `frame`, printed from the ids it carries. Text that already binds to those
// ids is kept as typed, so a spelling the printer would not write survives. `was` is the frame the
// ids were last true in, for the floating reference rules (an end past the edge, rule 2).
function printIds(f, refs, sheetId, frame, was = null) {
  const now = bind(f, sheetId, frame);
  if (now !== null && JSON.stringify(idsOf(now)) === JSON.stringify(refs)) return f;
  const bound = fromIds(f, refs);
  return bound === null ? null : print(bound, sheetId, was, frame);
}

// A set's formulas made into A1 for the frames `framesFor(entry)` gives: `[was, now]`.
function printSet(action, framesFor) {
  return {
    ...action,
    cells: action.cells.map((entry) => {
      const content = entry[2];
      if (content === null || typeof content !== "object" || content.refs === undefined) return entry;
      const [was, now] = framesFor(entry);
      const text = printIds(content.f, content.refs, action.sheet, now, was);
      if (text === null) throw new GridRefused("bad_action", "a formula's refs do not match its references");
      const { refs, ...rest } = content;
      return [entry[0], entry[1], { ...rest, f: text }, ...entry.slice(3)];
    }),
  };
}

const refsOf = (content) => (content !== null && typeof content === "object" && Array.isArray(content.refs) ? content.refs : null);
const setsOf = (action) => (action.t === "batch" ? action.actions : [action]).filter((one) => one.t === "set");

// The action with each set's formulas made into A1. A formula is printed in the frame before the
// action, and the rewrite after it moves the text to the frame after, like every other formula. A
// formula whose ids name a row or column that is not there before the action (an undo that brings
// a row back in one part of a batch and puts back a formula naming it in another), or an end past
// the sheet's edge (0), cannot be printed there, so it is printed in the frame after the action,
// found on a copy of the tab, and `late` tells the rewrite to leave that cell as it is.
function printSets(action, wb, tab) {
  const late = new Set();
  const before = frameOf(wb);
  const known = (ref) => {
    if (!Array.isArray(ref) || ref[0] === "~") return true;
    const one = wb.sheets().find((t) => t.id === ref[0]);
    if (!one) return true;
    const row = (id) => id === null || (typeof id === "string" && one.backing.rowIndex(id) >= 0);
    const col = (id) => id === null || (typeof id === "string" && one.backing.colIndex(id) >= 0);
    return row(ref[1]) && row(ref[3]) && col(ref[2]) && col(ref[4]);
  };
  for (const one of setsOf(action)) for (const entry of one.cells) if (refsOf(entry[2])?.some((ref) => !known(ref))) late.add(cellKey(one.sheet, entry[0], entry[1]));
  let after = before;
  if (late.size > 0 && structural(action)) {
    const scratch = modelBacking(tab.backing.sheet, { sheetId: tab.id });
    if (apply(scratch, withoutRefs(action), { derive: defaultDerive, formulas: {} }).out === "applied") {
      after = frameFrom(wb.sheets().map((one) => {
        const b = one.id === tab.id ? scratch : one.backing;
        return { id: one.id, name: one.name, rows: b.rows().map((row) => row.id), cols: b.cols().map((col) => col.id) };
      }));
    }
  }
  if (after === before) late.clear();
  const each = (one) => (one.t !== "set" ? one : printSet(one, (entry) => (late.has(cellKey(one.sheet, entry[0], entry[1])) ? [before, after] : [null, before])));
  return { printed: action.t === "batch" ? { ...action, actions: action.actions.map(each) } : each(action), late };
}

const withoutRefs = (action) => {
  const plain = (one) => (one.t !== "set" ? one : { ...one, cells: one.cells.map((entry) => (refsOf(entry[2]) === null ? entry : [entry[0], entry[1], (({ refs, ...rest }) => rest)(entry[2]), ...entry.slice(3)])) });
  return action.t === "batch" ? { ...action, actions: action.actions.map(plain) } : plain(action);
};

const cellKey = (sheet, row, col) => `${sheet}\u0000${row}\u0000${col}`;

// A set's inverse with each formula it puts back carried with the ids it means in `frame`, the
// frame before the set, so an undo delivered after a peer's structural edit means what was there.
function bindSetInverse(inverse, frame) {
  if (inverse.t === "batch") return { ...inverse, actions: inverse.actions.map((one) => bindSetInverse(one, frame)) };
  if (inverse.t !== "set") return inverse;
  return {
    ...inverse,
    cells: inverse.cells.map((entry) => {
      const f = formulaOf(entry[2]);
      if (f === null) return entry;
      const bound = bind(f, inverse.sheet, frame);
      if (bound === null) return entry;
      const base = typeof entry[2] === "object" ? entry[2] : { f };
      return [entry[0], entry[1], { ...base, refs: idsOf(bound) }, ...entry.slice(3)];
    }),
  };
}

// An outgoing set or batch for a room, with each formula content that carries no `refs` given the
// ids it means in the workbook as it is now, so a peer's insert or delete that the room orders first
// leaves it meaning the same cells. Applying it here gives the same result as the action without.
export function boundAction(wb, action) {
  if (!action || typeof action !== "object" || (action.t !== "set" && action.t !== "batch")) return action;
  const frame = frameOf(wb);
  const each = (one) => {
    if (one.t === "batch") return { ...one, actions: one.actions.map(each) };
    if (one.t !== "set") return one;
    const kept = one.cells.map((entry) => entry[2] !== null && typeof entry[2] === "object" && "refs" in entry[2]);
    const bound = bindSetInverse(one, frame);
    return { ...one, cells: bound.cells.map((entry, i) => (kept[i] ? one.cells[i] : entry)) };
  };
  return each(action);
}

// The formulas of the rows and columns an action deletes, before it runs: the reverse action brings
// their cells back as A1 text of the old frame, so the restore list holds them too.
function deletedFormulas(wb, action) {
  const out = [];
  const each = (one) => {
    if (one.t === "batch") return one.actions.forEach(each);
    const tab = wb.sheets().find((t) => t.id === one.sheet);
    if (!tab) return;
    const b = tab.backing;
    if (one.t === "deleteRows") {
      for (const id of one.rows) {
        const r = b.rowIndex(id);
        if (r < 0) continue;
        b.rows()[r].cells.forEach((cell, c) => {
          if (cell && cell.f !== undefined) out.push([tab.id, id, b.cols()[c].id, cell.f]);
        });
      }
    }
    if (one.t === "deleteCols") {
      for (const id of one.cols) {
        const c = b.colIndex(id);
        if (c < 0) continue;
        for (const row of b.rows()) if (row.cells[c] && row.cells[c].f !== undefined) out.push([tab.id, row.id, id, row.cells[c].f]);
      }
    }
  };
  each(action);
  return out;
}

// The rows and columns an action brings in, by tab and id (two tabs may hold the same row id, as a
// copied tab does): their cells come with the action.
const recordKey = (sheet, id) => `${sheet}\u0000${id}`;
function insertedIds(action) {
  const out = new Set();
  const walk = (one) => {
    if (one.t === "batch") return one.actions.forEach(walk);
    if (one.t === "insertRows" || one.t === "set") (one.rows ?? []).forEach((row) => out.add(recordKey(one.sheet, row.id)));
    if (one.t === "insertCols" || one.t === "set") (one.cols ?? []).forEach((col) => out.add(recordKey(one.sheet, col.id)));
  };
  walk(action);
  return out;
}

export function applyWorkbook(wb, step, { derive = defaultDerive, engine = null } = {}) {
  const inverseStep = step.action !== undefined && step.t === undefined;
  const action = inverseStep ? step.action : step;
  const restore = inverseStep ? step.restore ?? [] : [];
  const ruleRestore = inverseStep ? step.rules ?? [] : [];
  // Each tab's stale mark before the step: the reducer marks a tab stale on a formula write, and a
  // refused step leaves every tab as it was, the mark too.
  const stale = new Map(wb.sheets().map((tab) => [tab.id, tab.backing.sheet.stale === true]));
  const run = { wb, derive, computed: engine !== null, stale, journal: [], ruleJournal: [], undo: null, changed: { sheets: [], cells: [], rows: [], cols: [], table: [], formulas: [], results: [], structure: false, sorted: [] } };
  // Rules are judged and moved only when a tab has one or the step puts one back.
  const rulesBefore = ruleRestore.length > 0 || wb.sheets().some((tab) => tab.backing.rules().length > 0) ? rulesOf(wb) : null;
  const ruleFrame = rulesBefore !== null && (TAB.has(action.t) || resizes(action)) ? frameOf(wb) : null;
  let out;
  try {
    out = action.t === "sort" ? applySort(run, action, restore) : TAB.has(action.t) ? applyTab(run, action, restore) : applySheet(run, action, restore);
    if (out.out === "applied" && rulesBefore !== null && action.t !== "rules") settleRules(run, action, ruleRestore, rulesBefore, ruleFrame, out.inverse);
  } catch (err) {
    takeBack(run);
    if (err instanceof GridRefused) return refusal(err.code, err.detail);
    return refusal("rewrite_failed", String(err?.message ?? err));
  }
  // The engine computes after the step, outside all or nothing: its writes are results, which a
  // later step or a reload computes again, never content.
  if (out.out === "applied" && engine !== null) out.changed.results = engine.update(out.changed);
  return out;
}

// Every rewrite and restore write goes through here, so a failure can take it back.
function put(run, tab, r, c, next) {
  const b = tab.backing;
  const row = b.rows()[r].id;
  const col = b.cols()[c].id;
  const old = b.cell(r, c);
  b.putCell(r, c, next);
  run.journal.push({ sheet: tab.id, row, col, old });
  run.changed.cells.push({ sheet: tab.id, row, col, before: contentOf(old), after: contentOf(next) });
  run.changed.formulas.push({ sheet: tab.id, row, col });
}

function takeBack(run) {
  for (const { sheet, old } of run.ruleJournal.reverse()) run.wb.sheets().find((t) => t.id === sheet)?.backing.setRules(old);
  run.ruleJournal = [];
  for (const { sheet, row, col, old } of run.journal.reverse()) {
    const tab = run.wb.sheets().find((t) => t.id === sheet);
    const r = tab?.backing.rowIndex(row) ?? -1;
    const c = tab?.backing.colIndex(col) ?? -1;
    if (r >= 0 && c >= 0) tab.backing.putCell(r, c, old);
  }
  run.journal = [];
  if (run.undo) run.undo();
  run.undo = null;
  for (const tab of run.wb.sheets()) {
    const was = run.stale.get(tab.id);
    if (was !== undefined && (tab.backing.sheet.stale === true) !== was) tab.backing.setStale(was);
  }
}

const ruleKey = (sheet, id) => `${sheet}\u0000${id}`;

function rulesOf(wb) {
  const out = new Map();
  for (const tab of wb.sheets()) for (const rule of tab.backing.rules()) out.set(ruleKey(tab.id, rule.id), { sheet: tab.id, rule });
  return out;
}

// Every rule write goes through here, so a failure can take it back.
function putRules(run, tab, list) {
  const old = tab.backing.rules();
  run.ruleJournal.push({ sheet: tab.id, old });
  tab.backing.setRules(list);
  run.changed.table.push({ sheet: tab.id, field: "rules", before: JSON.stringify(old), after: JSON.stringify(tab.backing.rules()) });
}

// A rule's formula text in the frame after a step, as a formula cell's is printed.
function moveFormula(f, sid, before, after) {
  const bound = bind(f, sid, before);
  return bound === null ? f : print(bound, sid, before, after);
}

// Whether a reference's text names other records after the step than before it: a deleted end
// that the next row took over, an end past the edge that now lands on a row, a tab name that now
// names a tab. The undo cannot get those back by moving the text again, so the inverse keeps them.
function rebinds(text, sid, before, after, next) {
  const was = bind(`=${text}`, sid, before);
  const now = bind(`=${next}`, sid, after);
  if (was === null || now === null) return text !== next;
  return JSON.stringify(idsOf(was)) !== JSON.stringify(idsOf(now));
}

const BOX_ROWS = 9999999;
const BOX_CELL = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/;
const endsOf = (box) => {
  const cells = box.split(":");
  if (cells.length > 2) return null;
  const ends = [];
  for (const cell of cells) {
    const m = BOX_CELL.exec(cell);
    const col = m === null ? -1 : colIndex(m[1]);
    if (col < 0 || col > MAX_BOX_COL) return null;
    ends.push({ row: Number(m[2]) - 1, col });
  }
  return ends;
};
const cellAt = (row, col) => `${colName(Math.min(Math.max(col, 0), MAX_BOX_COL))}${Math.min(Math.max(row, 0), BOX_ROWS - 1) + 1}`;

// The index in `now` of the last record that was also in `was`, or -1.
function lastStaying(ids, other) {
  let i = ids.length - 1;
  while (i >= 0 && !other.has(ids[i])) i -= 1;
  return i;
}

// How far a step moved the places past a tab's last row (or column): back one for each row it
// removed before a row that stays, on one for each it put before a row that stays. Rows added or
// removed after the last row that stays only change where the sheet's records end, so they move
// nothing, and a step and its undo move the same distance.
function edgeShift(was, wasAt, now, nowAt) {
  let shift = 0;
  for (let i = lastStaying(was, nowAt) - 1; i >= 0; i--) if (!nowAt.has(was[i])) shift -= 1;
  for (let i = lastStaying(now, wasAt) - 1; i >= 0; i--) if (!wasAt.has(now[i])) shift += 1;
  return shift;
}

// Where one end of a box lands on one axis. An end past the last record moves by the edge shift.
// An end on a record follows the formula move, except when that record and every record after it
// went: then it is past the edge after the step, and moves by the edge shift as such an end does.
function placeEnd(index, moved, ids, nowAt, shift) {
  if (index >= ids.length) return index + shift;
  if (ids.slice(index).every((id) => !nowAt.has(id))) return index + shift;
  return moved;
}

// A chart's box is a picture over the cells, kept the same size when rows or columns come or go
// outside it. An end past the tab's last row or column has no record to follow, so it moves by
// the step's shift of the places past the edge. The box stays within XFD and row 9999999 and its
// top-left end stays first.
function moveBox(box, moved, was, now) {
  const old = endsOf(box);
  const ends = endsOf(moved);
  if (!was || !now || old === null || ends === null || old.length !== ends.length) return moved;
  const rows = edgeShift(was.rows, was.rowAt, now.rows, now.rowAt);
  const cols = edgeShift(was.cols, was.colAt, now.cols, now.colAt);
  const out = ends.map((end, i) => ({
    row: placeEnd(old[i].row, end.row, was.rows, now.rowAt, rows),
    col: placeEnd(old[i].col, end.col, was.cols, now.colAt, cols),
  }));
  if (out.length === 1) return cellAt(out[0].row, out[0].col);
  const [top, bottom] = [Math.min(out[0].row, out[1].row), Math.max(out[0].row, out[1].row)];
  const [left, right] = [Math.min(out[0].col, out[1].col), Math.max(out[0].col, out[1].col)];
  return `${cellAt(top, left)}:${cellAt(bottom, right)}`;
}

// A rule moved by a step that inserted or deleted rows or columns, or by a tab action: null when its
// range is gone. A source or a formula that lost what it named keeps #REF!, as a formula cell would.
// The formula is written for the range's top-left cell, so after rows or columns came or went it
// moves with that corner (`moveAnchored`); a tab action renames or cuts the tabs it names.

function moveRule(rule, sid, before, after, tabStep) {
  const moved = moveFormula(`=${rule.range}`, sid, before, after).slice(1);
  if (moved.includes("#REF!")) return { rule: null, rebound: true };
  const range = rule.kind === "chart" ? moveBox(rule.range, moved, before.get(sid), after.get(sid)) : moved;
  const out = { ...rule, range };
  if (rule.source !== undefined) out.source = moveFormula(`=${rule.source}`, sid, before, after).slice(1);
  if (rule.f !== undefined) {
    const was = topLeftOf(rule.range);
    const now = topLeftOf(range);
    out.f = tabStep ? moveFormula(rule.f, sid, before, after) : moveAnchored(rule.f, sid, before, after, now.row - was.row, now.col - was.col);
  }
  const rebound = rule.kind === "chart" || rebinds(rule.range, sid, before, after, range) || (rule.source !== undefined && rebinds(rule.source, sid, before, after, out.source)) || (rule.f !== undefined && rebinds(rule.f.slice(1), sid, before, after, out.f.slice(1)));
  const same = out.range === rule.range && out.source === rule.source && out.f === rule.f;
  return { rule: same ? rule : out, rebound };
}

// Moves every rule of every tab (a source or formula can name another tab). A tab the step brought
// in already has its rules in the new frame. Returns the keys of the rules the step rebound.
function rewriteRules(run, before, after, tabStep) {
  const rebound = new Set();
  for (const tab of run.wb.sheets()) {
    const rules = tab.backing.rules();
    if (rules.length === 0 || !before.has(tab.id)) continue;
    const next = [];
    let changed = false;
    for (const rule of rules) {
      const moved = moveRule(rule, tab.id, before, after, tabStep);
      if (moved.rebound) rebound.add(ruleKey(tab.id, rule.id));
      if (moved.rule !== rule) changed = true;
      if (moved.rule !== null) next.push(moved.rule);
    }
    if (changed) putRules(run, tab, next);
  }
  return rebound;
}

function restoreRule(run, sheet, id, back) {
  const tab = run.wb.sheets().find((t) => t.id === sheet);
  if (!tab) return;
  const rules = tab.backing.rules();
  if (sameRule(rules.find((rule) => rule.id === id), back)) return;
  putRules(run, tab, [...rules.filter((rule) => rule.id !== id), ...(back === null ? [] : [back])]);
}

// After a step: a step that inserted or deleted rows or columns, or a tab action, moves every rule;
// each rule the inverse puts back comes back only while it still is what the undone step left (no
// coworker changed it since); and the inverse gets one entry [sheet, id, back, left] for every rule
// the whole step changed or rebound, with `back` the rule before the step and `left` the rule after
// it (null where there was none).
function settleRules(run, action, ruleRestore, rulesBefore, before, inverse) {
  const rebound = before === null ? new Set() : rewriteRules(run, before, frameOf(run.wb), TAB.has(action.t));
  for (const [sheet, id, back, left] of ruleRestore) {
    if (sameRule(rulesBefore.get(ruleKey(sheet, id))?.rule, left)) restoreRule(run, sheet, id, back);
  }
  const after = rulesOf(run.wb);
  const changes = [];
  for (const key of new Set([...rulesBefore.keys(), ...after.keys()])) {
    const was = rulesBefore.get(key);
    const now = after.get(key);
    if (sameRule(was?.rule, now?.rule) && !rebound.has(key)) continue;
    changes.push([(was ?? now).sheet, (was ?? now).rule.id, was?.rule ?? null, now?.rule ?? null]);
  }
  if (changes.length > 0) inverse.rules = changes;
}

function applySheet(run, action, restore) {
  const { wb, derive, computed } = run;
  const tab = wb.sheets().find((t) => t.id === sheetOf(action));
  if (!tab) return refusal("missing_sheet", `no tab ${JSON.stringify(sheetOf(action))}`);
  const before = frameOf(wb);
  const { printed, late } = printSets(action, wb, tab);
  const moves = structural(action);
  const gone = moves ? deletedFormulas(wb, action) : [];
  const out = apply(tab.backing, printed, { derive, formulas: {}, computed });
  if (out.out !== "applied") return out;
  run.undo = () => apply(tab.backing, out.inverse, { derive, formulas: {}, computed });
  for (const change of out.changes.cells) run.changed.cells.push({ ...change, sheet: tab.id });
  for (const change of out.changes.rows ?? []) run.changed.rows.push({ ...change, sheet: tab.id });
  for (const change of out.changes.cols ?? []) run.changed.cols.push({ ...change, sheet: tab.id });
  for (const change of out.changes.table ?? []) run.changed.table.push({ ...change, sheet: tab.id });
  run.changed.structure = moves;
  const own = new Set(setsOf(action).flatMap((one) => one.cells.map((entry) => cellKey(one.sheet, entry[0], entry[1]))));
  const back = moves || restore.length > 0 ? rewriteAll(run, before, frameOf(wb), gone, insertedIds(action), restore, { late, own }) : [];
  return { out: "applied", inverse: { action: bindSetInverse(out.inverse, before), restore: back }, changed: run.changed };
}

// Tab actions live at the workbook level; the per-sheet reducer never sees them. Their inverse is the
// opposite tab action plus a restore list. A deleted tab's formulas are restored whole from ids,
// since peers may have moved what they point at while it was gone.
function applyTab(run, action, restore) {
  const { wb } = run;
  const tabs = wb.sheets();
  const id = action.t === "insertSheet" ? action.sheet?.id : action.sheet;
  const tab = tabs.find((t) => t.id === id) ?? null;
  const taken = (name) => tabs.some((t) => t !== tab && t.name.toLowerCase() === String(name).toLowerCase());
  const bad = tabProblem(action);
  if (bad !== null) return refusal("bad_action", bad);
  const before = frameOf(wb);
  const gone = [];
  const inserted = new Set();
  let inverse;
  if (action.t === "insertSheet") {
    if (tab) return refusal("sheet_exists", `a tab ${JSON.stringify(id)} exists`);
    if (taken(action.sheet.name)) return refusal("name_taken", `a tab is named ${JSON.stringify(action.sheet.name)}`);
    wb.insertSheet(action.sheet);
    run.undo = () => wb.deleteSheet(id);
    inserted.add(id);
    inverse = { v: 1, t: "deleteSheet", sheet: id };
  } else {
    if (!tab) return refusal("missing_sheet", `no tab ${JSON.stringify(id)}`);
    if (action.t === "renameSheet") {
      if (taken(action.name)) return refusal("name_taken", `a tab is named ${JSON.stringify(action.name)}`);
      inverse = { v: 1, t: "renameSheet", sheet: id, name: tab.name };
      run.renamed = true;
      wb.renameSheet(id, action.name);
      run.undo = () => wb.renameSheet(id, inverse.name);
    } else if (action.t === "moveSheet") {
      inverse = { v: 1, t: "moveSheet", sheet: id, pos: tab.pos };
      wb.moveSheet(id, action.pos);
      run.undo = () => wb.moveSheet(id, inverse.pos);
    } else {
      if (tabs.length === 1) return refusal("last_sheet", "a workbook keeps one tab");
      for (const [one, r, c, cell] of formulaCells([tab])) gone.push([one.id, one.backing.rows()[r].id, one.backing.cols()[c].id, cell.f]);
      const removed = wb.deleteSheet(id);
      run.undo = () => wb.insertSheet(removed);
      inverse = { v: 1, t: "insertSheet", sheet: removed };
    }
  }
  run.changed.sheets.push(id);
  run.changed.structure = true;
  return { out: "applied", inverse: { action: inverse, restore: rewriteAll(run, before, frameOf(wb), gone, inserted, restore) }, changed: run.changed };
}

// What is wrong with a tab action's shape, or null. Both workbooks take only what both read the same
// way: a tab's bytes must be the codec's (the strict reader takes them), its key an order key, its
// id not the mark of an unknown tab name in ids.
// Text a tab's id or name may hold: not empty, no NUL or CR (the strict reader refuses both, and a
// page's parser reads CR as LF), and no half of a surrogate pair, which has no UTF-8 bytes and makes
// `encodeURIComponent` throw.
function cleanText(value) {
  if (typeof value !== "string" || value === "" || value.includes("\0") || value.includes("\r")) return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && (value.charCodeAt(i + 1) & 0xfc00) === 0xdc00) i += 1;
    else if (c >= 0xd800 && c <= 0xdfff) return false;
  }
  return true;
}

export function tabProblem(action) {
  const text = cleanText;
  const id = action.t === "insertSheet" ? action.sheet?.id : action.sheet;
  if (action.v !== 1 || !text(id) || id === "~") return "a tab action names a tab by a non-empty id";
  if (action.t === "renameSheet" && !text(action.name)) return "a tab's name is a non-empty text";
  if (action.t === "moveSheet" && !isKey(action.pos)) return "a tab's place is an order key";
  if (action.t === "insertSheet") {
    if (action.sheet === null || typeof action.sheet !== "object" || Array.isArray(action.sheet)) return "a new tab is a record";
    const { name, pos, html } = action.sheet;
    if (!text(name) || !isKey(pos) || typeof html !== "string") return "a new tab has a name, an order key and its table's bytes";
    try {
      gridModel(html, 0);
    } catch {
      return "a new tab's bytes are not a table the codec reads";
    }
  }
  return null;
}

// Rewrites every formula of the workbook from the frame before to the frame after, then applies a
// step's restore list. Returns the restore list of the inverse, whose entries are:
//   [sheet, row, col, f, ids, null]         a formula of a deleted record, put back printed from ids
//   [sheet, row, col, f, ids, { ids }]      a whole-text restore: f comes back while the cell means
//                                           `{ ids }` (the meaning this action left), and f means `ids`
//   [sheet, row, col, f, slots, keys]       a slot restore: the references a lossy rewrite cut or
//                                           shrank come back, each while its slot still holds `keys`
// A cell a set of this step wrote gets no restore entry (`own`): the inverse's set writes it back
// whole, and an entry would put this step's formula back over it.
function rewriteAll(run, before, after, deleted, inserted, restore, { late = new Set(), own = new Set() } = {}) {
  const { wb } = run;
  const tabs = wb.sheets();
  const tabById = (id) => tabs.find((t) => t.id === id) ?? null;
  const back = deleted.map(([sid, rid, cid, f]) => {
    const bound = bind(f, sid, before);
    return [sid, rid, cid, f, bound ? idsOf(bound) : null, null];
  });

  const judged = judgeRestore(run, before, restore);

  for (const [tab, r, c, cell] of formulaCells(tabs)) {
    const rid = tab.backing.rows()[r].id;
    const cid = tab.backing.cols()[c].id;
    if (inserted.has(recordKey(tab.id, rid)) || inserted.has(recordKey(tab.id, cid)) || inserted.has(tab.id) || late.has(cellKey(tab.id, rid, cid))) continue;
    const bound = bind(cell.f, tab.id, before);
    if (bound === null) continue;
    const mine = own.has(cellKey(tab.id, rid, cid));
    const push = (entry) => mine || back.push(entry);
    const text = print(bound, tab.id, before, after);
    const was = idsOf(bound);
    // A reference a tab action bound by name, or a floating end that now binds a record, comes back
    // whole on undo while the cell still means what this step left.
    const named = bound.refs.some((ref) => ref.unbound);
    const floating = was.some((ref) => Array.isArray(ref) && ref[0] !== "~" && ref.includes(0));
    if (named || floating) {
      const now = bind(text, tab.id, after);
      const is = now === null ? null : idsOf(now);
      const nameBinds = named && now !== null && now.refs.some((ref, i) => bound.refs[i].unbound && !ref.unbound);
      const endBinds = floating && is !== null && was.some((ref, i) => Array.isArray(ref) && ref[0] !== "~" && ref.some((id, k) => id === 0 && Array.isArray(is[i]) && is[i][k] !== 0));
      if (nameBinds || endBinds) push([tab.id, rid, cid, cell.f, was, { ids: is }]);
    }
    const loses = lossy(bound, after);
    // Rule 7: a rewrite that loses a record keeps its restore entry even when the text is the same.
    // A rename leaves a typed spelling of the old name as it is, but the rename back prints the name
    // as the tab spells it, so that text comes back whole.
    if (text === cell.f && !loses) {
      if (run.renamed && print(bound, tab.id, before, before) !== cell.f) push([tab.id, rid, cid, cell.f, was, { ids: was }]);
      continue;
    }
    if (!loses && print(bound, tab.id, before, before) !== cell.f) {
      const now = bind(text, tab.id, after);
      if (now !== null) push([tab.id, rid, cid, cell.f, was, { ids: idsOf(now) }]);
    }
    if (loses) {
      const forward = slotsOf(text, tab.id, after);
      push([tab.id, rid, cid, cell.f, originalSlots(cell.f, tab.id, before), forward ? forward.keys : null]);
    }
    if (text !== cell.f) put(run, tab, r, c, { ...cell, f: text });
  }

  // The inverse undoes what the restore put back before it undoes the rewrite.
  return [...undoRestores(runRestore(run, after, restore, judged), after), ...back];
}

// Rule 6: a restore is judged against what its cell meant right before this step's own rewrite.
function judgeRestore(run, before, restore) {
  const tabById = (id) => run.wb.sheets().find((t) => t.id === id) ?? null;
  const meantBefore = new Map();
  const keysBefore = new Map();
  for (const entry of restore) {
    const [sid, rid, cid, , , guard] = entry;
    if (!guard) continue;
    const tab = tabById(sid);
    const r = tab ? tab.backing.rowIndex(rid) : -1;
    const c = tab ? tab.backing.colIndex(cid) : -1;
    if (r < 0 || c < 0) continue;
    const cell = tab.backing.cell(r, c);
    if (!cell || cell.f === undefined) continue;
    if (guard.ids === undefined) {
      const slots = slotsOf(cell.f, sid, before);
      keysBefore.set(entry, slots === null || slots.keys.length !== guard.length ? null : slots.keys);
      continue;
    }
    const pre = bind(cell.f, sid, before);
    meantBefore.set(entry, pre !== null && cornersUnordered(idsOf(pre)) === cornersUnordered(guard.ids));
  }

  return { meantBefore, keysBefore };
}

// Puts back each restore entry whose guard still holds, in the frame after the step's own writes.
// Returns what it changed, [sheet, row, col, old text, new text], so the caller's inverse can put
// those cells back byte for byte even when coworkers moved rows in between.
function runRestore(run, after, restore, { meantBefore, keysBefore }) {
  const tabById = (id) => run.wb.sheets().find((t) => t.id === id) ?? null;
  const changes = [];
  for (const entry of restore) {
    const [sid, rid, cid, f, refs, guard] = entry;
    const tab = tabById(sid);
    const r = tab ? tab.backing.rowIndex(rid) : -1;
    const c = tab ? tab.backing.colIndex(cid) : -1;
    if (r < 0 || c < 0) continue;
    const cell = tab.backing.cell(r, c);
    if (!cell || cell.f === undefined) continue;
    let text;
    if (guard === null) {
      text = refs === null ? f : printIds(f, refs, sid, after) ?? f;
    } else if (guard.ids !== undefined) {
      // The text comes back printed from the ids it meant, so a coworker's insert of another row or
      // column since then shifts it as it shifted the cell; with no such shift it is f as typed.
      const now = bind(cell.f, sid, after);
      const stillMeans = (now !== null && cornersUnordered(idsOf(now)) === cornersUnordered(guard.ids)) || meantBefore.get(entry) === true;
      if (!stillMeans) continue;
      text = printIds(f, refs, sid, after);
      if (text === null) continue;
    } else {
      const whole = refs !== null ? slotsOf(f, sid, after) : null;
      const current = whole ? slotsOf(cell.f, sid, after) : null;
      const pre = keysBefore.get(entry) ?? null;
      const leftAsIs = current && (JSON.stringify(current.keys) === JSON.stringify(guard) || (pre !== null && JSON.stringify(pre) === JSON.stringify(guard)));
      text = whole && leftAsIs && JSON.stringify(whole.keys) === JSON.stringify(refs.keys) ? f : refs === null ? null : restoreSlots(cell.f, sid, after, refs, guard, pre);
      if (text === null) continue;
    }
    if (text === cell.f) continue;
    changes.push([sid, rid, cid, cell.f, text]);
    put(run, tab, r, c, { ...cell, f: text });
  }
  return changes;
}

// Whole-text restores that undo what `runRestore` changed: each old text comes back while its
// cell still means what the restore left. `home` says where the inverse finds the cell and what
// text it had (a sort moves cells and shifts their text; any other step leaves both).
// The undo of restores that ran in order runs them back in the reverse order: two on one cell undo the later one first.
function undoRestores(changes, frame, home = (sid, rid, cid, old, text) => ({ row: rid, f: old, now: text })) {
  const out = [];
  for (const change of changes) {
    const [sid, , cid] = change;
    const { row, f, now } = home(...change);
    const was = bind(f, sid, frame);
    const left = bind(now, sid, frame);
    if (was !== null && left !== null) out.push([sid, row, cid, f, idsOf(was), { ids: idsOf(left) }]);
  }
  return out.reverse();
}

// A sort: `rows` in their new order, `cols` null for the whole width (the row records move, to the
// keys of the places they fill) or a list of columns (the cells of those columns move between the
// same row records). A formula inside the block keeps its relative shape, as a copy keeps it; a
// formula outside keeps its text, so it reads what now sits at its address, and after a whole-width
// sort the engine scans the tab again (`changed.sorted`). The inverse is the sort back, plus a
// whole-text restore for each formula whose shift there and back does not give its text again (a
// row above row 1, a spelling). A frozen row is not sorted whole width. A merge the sort would cut,
// or a column that is not there, is refused by the row move or the cell write the sort runs (the
// room codec's `#flat` places say the same).
const distinctIds = (list) => Array.isArray(list) && list.length > 0 && list.every((id) => typeof id === "string") && new Set(list).size === list.length;
// Two rows can share one order key (two people adding a row at the end at the same moment). A sort
// that copied its slots' keys would leave such rows in id order, so a run of slots sharing one key,
// or a slot sharing its key with the row beside it, gets fresh keys between its neighbours, when the
// run's rows sit together and the neighbours' keys leave room.
function freshTies(rows, slots, pos) {
  const out = pos.slice();
  for (let start = 0; start < out.length; ) {
    let end = start;
    while (end + 1 < out.length && out[end + 1] === out[start]) end++;
    const together = slots[end] - slots[start] === end - start;
    const lo = start > 0 && slots[start - 1] === slots[start] - 1 ? out[start - 1] : rows[slots[start] - 1]?.pos ?? null;
    const hi = rows[slots[end] + 1]?.pos ?? null;
    const tied = end > start || lo === out[start] || hi === out[end];
    if (tied && together && (lo === null || hi === null || lo < hi)) out.splice(start, end - start + 1, ...keysBetween(lo, hi, end - start + 1));
    start = end + 1;
  }
  return out;
}
// A sort's kept keys put its rows back only when they land in the places the rows hold now: a row a
// coworker inserted among them since would otherwise take another row number under its formulas.
function keepsSlots(rows, slots, ids, pos) {
  const keyOf = new Map(ids.map((id, i) => [id, pos[i]]));
  const order = rows.map((row) => ({ id: row.id, pos: keyOf.get(row.id) ?? row.pos, sorted: keyOf.has(row.id) }));
  order.sort((x, y) => (x.pos !== y.pos ? (x.pos < y.pos ? -1 : 1) : x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return order.flatMap((one, at) => (one.sorted ? [at] : [])).every((at, i) => at === slots[i]);
}

function applySort(run, action, restore) {
  const { wb, derive, computed } = run;
  if (!distinctIds(action.rows) || (action.cols !== null && !distinctIds(action.cols))) return refusal("bad_action", "a sort names distinct rows and columns");
  const tab = wb.sheets().find((t) => t.id === action.sheet);
  if (!tab) return refusal("missing_sheet", `no tab ${JSON.stringify(action.sheet)}`);
  if (action.pos !== undefined && (action.cols !== null || !Array.isArray(action.pos) || action.pos.length !== action.rows.length || !action.pos.every(isKey))) return refusal("bad_action", "a sort's pos is one order key per row, for a whole-width sort");
  const b = tab.backing;
  const before = frameOf(wb);
  const judged = judgeRestore(run, before, restore);
  const was = action.rows.map((id) => b.rowIndex(id));
  if (was.some((at) => at < 0)) return refusal("missing_row", "a sorted row is not in the sheet");
  if (action.cols === null && was.some((at) => b.rows()[at].frozen)) return refusal("bad_action", "a frozen row is not sorted");
  const slots = was.slice().sort((x, y) => x - y);
  const shifted = [];
  let step;
  let inverse;
  if (action.cols === null) {
    const pos = action.pos !== undefined && keepsSlots(b.rows(), slots, action.rows, action.pos) ? action.pos : freshTies(b.rows(), slots, slots.map((at) => b.rows()[at].pos));
    const minted = pos.some((key, i) => key !== b.rows()[slots[i]].pos);
    const old = action.rows.map((id, i) => ({ id, at: was[i], pos: b.rows()[was[i]].pos }));
    for (const one of old) {
      b.rows()[one.at].cells.forEach((cell, c) => {
        if (cell && cell.f !== undefined) shifted.push({ row: one.id, back: one.id, col: b.cols()[c].id, f: cell.f, from: one.at });
      });
    }
    step = { v: 1, t: "changeRows", sheet: tab.id, rows: action.rows.map((id, i) => ({ id, pos: pos[i] })) };
    const home = old.slice().sort((x, y) => x.at - y.at);
    inverse = { v: 1, t: "sort", sheet: tab.id, rows: home.map((one) => one.id), cols: null, ...(minted ? { pos: home.map((one) => one.pos) } : {}) };
  } else {
    const cells = [];
    action.rows.forEach((id, i) => {
      const target = b.rows()[slots[i]].id;
      for (const colId of action.cols) {
        const c = b.colIndex(colId);
        const cell = b.cell(was[i], c);
        let content = inverseContent(cell);
        if (content !== null && typeof content === "object") content = { ...content, f: shiftRows(content.f, slots[i] - was[i]) };
        const extra = cell ? cellExtra(cell, b.cols()[c]) : { fmt: null };
        cells.push([target, colId, content, { ...extra, css: extra.css ?? "" }]);
      }
    });
    step = { v: 1, t: "set", sheet: tab.id, cells };
  }
  const out = apply(b, step, { derive, formulas: {}, computed });
  if (out.out !== "applied") return out;
  // A narrow sort is undone by writing each cell's earlier content back to its own row, so a row a
  // coworker moved or deleted since takes back its own values, or none.
  if (action.cols !== null) inverse = bindSetInverse(out.inverse, before);
  run.undo = () => apply(b, out.inverse, { derive, formulas: {}, computed });
  for (const change of out.changes.cells) run.changed.cells.push({ ...change, sheet: tab.id });
  for (const change of out.changes.rows ?? []) run.changed.rows.push({ ...change, sheet: tab.id });
  run.changed.structure = action.cols === null;
  if (action.cols === null) run.changed.sorted.push(tab.id);
  const back = [];
  for (const one of shifted) {
    const delta = one.delta ?? b.rowIndex(one.row) - one.from;
    one.d = delta;
    const text = shiftRows(one.f, delta);
    if (one.delta === undefined && text !== one.f) {
      const r = b.rowIndex(one.row);
      const c = b.colIndex(one.col);
      put(run, tab, r, c, { ...b.cell(r, c), f: text });
    }
    const home = shiftRows(text, -delta);
    if (home === one.f) continue;
    const meant = bind(one.f, tab.id, before);
    const left = bind(home, tab.id, before);
    if (meant !== null && left !== null) back.push([tab.id, one.back, one.col, one.f, idsOf(meant), { ids: idsOf(left) }]);
  }
  // A sort is undone by the sort back, which moves each cell home and shifts its text by the same
  // rows the other way; a cell the restore changed comes back to its old text in that frame.
  const moved = new Map(shifted.map((one) => [`${one.row}\u0000${one.col}`, one]));
  const home = (sid, rid, cid, old, text) => {
    const one = sid === tab.id ? moved.get(`${rid}\u0000${cid}`) : undefined;
    return one ? { row: one.back, f: one.f, now: shiftRows(text, -one.d) } : { row: rid, f: old, now: text };
  };
  const undo = undoRestores(runRestore(run, frameOf(wb), restore, judged), before, home);
  return { out: "applied", inverse: { action: inverse, restore: [...undo, ...back] }, changed: run.changed };
}
