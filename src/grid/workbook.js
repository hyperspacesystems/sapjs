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

import { gridModel } from "./codec/read.js";
import { isKey } from "./codec/order-keys.js";
import { contentOf, derive as defaultDerive } from "./content.js";
import { apply, GridRefused } from "./ops.js";
import { bind, cornersUnordered, frameFrom, fromIds, idsOf, lossy, originalSlots, print, restoreSlots, slotsOf } from "./formula/text.js";

const STRUCTURAL = new Set(["insertRows", "deleteRows", "changeRows", "insertCols", "deleteCols", "changeCols"]);
const TAB = new Set(["insertSheet", "deleteSheet", "renameSheet", "moveSheet"]);

const refusal = (code, detail) => ({ out: "refused", code, detail });
// A set that grows the sheet (typing past its edge) inserts rows or columns too.
const grows = (action) => action.t === "set" && ((action.rows?.length ?? 0) > 0 || (action.cols?.length ?? 0) > 0);
const structural = (action) => (action.t === "batch" ? action.actions.some(structural) : STRUCTURAL.has(action.t) || grows(action));
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
// ids is kept as typed, so a spelling the printer would not write survives.
function printIds(f, refs, sheetId, frame) {
  const now = bind(f, sheetId, frame);
  if (now !== null && JSON.stringify(idsOf(now)) === JSON.stringify(refs)) return f;
  const bound = fromIds(f, refs);
  return bound === null ? null : print(bound, sheetId, null, frame);
}

// The action with each set's formulas made into A1 for `frame`.
function printSets(action, frame) {
  if (action.t === "batch") return { ...action, actions: action.actions.map((one) => printSets(one, frame)) };
  if (action.t !== "set") return action;
  return {
    ...action,
    cells: action.cells.map((entry) => {
      const content = entry[2];
      if (content === null || typeof content !== "object" || content.refs === undefined) return entry;
      const text = printIds(content.f, content.refs, action.sheet, frame);
      if (text === null) throw new GridRefused("bad_action", "a formula's refs do not match its references");
      const { refs, ...rest } = content;
      return [entry[0], entry[1], { ...rest, f: text }, ...entry.slice(3)];
    }),
  };
}

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

// The ids of the rows and columns an action brings in: their cells come with the action.
function insertedIds(action) {
  const out = new Set();
  const walk = (one) => {
    if (one.t === "batch") return one.actions.forEach(walk);
    if (one.t === "insertRows" || one.t === "set") (one.rows ?? []).forEach((row) => out.add(row.id));
    if (one.t === "insertCols" || one.t === "set") (one.cols ?? []).forEach((col) => out.add(col.id));
  };
  walk(action);
  return out;
}

export function applyWorkbook(wb, step, { derive = defaultDerive, engine = null } = {}) {
  const inverseStep = step.action !== undefined && step.t === undefined;
  const action = inverseStep ? step.action : step;
  const restore = inverseStep ? step.restore ?? [] : [];
  // Each tab's stale mark before the step: the reducer marks a tab stale on a formula write, and a
  // refused step leaves every tab as it was, the mark too.
  const stale = new Map(wb.sheets().map((tab) => [tab.id, tab.backing.sheet.stale === true]));
  const run = { wb, derive, computed: engine !== null, stale, journal: [], undo: null, changed: { sheets: [], cells: [], rows: [], cols: [], table: [], formulas: [], results: [], structure: false } };
  let out;
  try {
    if (action.t === "sort") return refusal("bad_action", "sort comes with the room codec");
    out = TAB.has(action.t) ? applyTab(run, action, restore) : applySheet(run, action, restore);
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

function applySheet(run, action, restore) {
  const { wb, derive, computed } = run;
  const tab = wb.sheets().find((t) => t.id === sheetOf(action));
  if (!tab) return refusal("missing_sheet", `no tab ${JSON.stringify(sheetOf(action))}`);
  const before = frameOf(wb);
  const printed = printSets(action, before);
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
  const back = moves || restore.length > 0 ? rewriteAll(run, before, frameOf(wb), gone, insertedIds(action), restore) : [];
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
function tabProblem(action) {
  const text = (value) => typeof value === "string" && value !== "";
  const id = action.t === "insertSheet" ? action.sheet?.id : action.sheet;
  if (action.v !== 1 || !text(id) || id === "~") return "a tab action names a tab by a non-empty id";
  if (action.t === "renameSheet" && !text(action.name)) return "a tab's name is a non-empty text";
  if (action.t === "moveSheet" && !isKey(action.pos)) return "a tab's place is an order key";
  if (action.t === "insertSheet") {
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
function rewriteAll(run, before, after, deleted, inserted, restore) {
  const { wb } = run;
  const tabs = wb.sheets();
  const tabById = (id) => tabs.find((t) => t.id === id) ?? null;
  const back = deleted.map(([sid, rid, cid, f]) => {
    const bound = bind(f, sid, before);
    return [sid, rid, cid, f, bound ? idsOf(bound) : null, null];
  });

  // Rule 6: a restore is judged against what its cell meant right before this step's own rewrite.
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

  for (const [tab, r, c, cell] of formulaCells(tabs)) {
    const rid = tab.backing.rows()[r].id;
    const cid = tab.backing.cols()[c].id;
    if (inserted.has(rid) || inserted.has(cid) || inserted.has(tab.id)) continue;
    const bound = bind(cell.f, tab.id, before);
    if (bound === null) continue;
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
      if (nameBinds || endBinds) back.push([tab.id, rid, cid, cell.f, was, { ids: is }]);
    }
    const loses = lossy(bound, after);
    // Rule 7: a rewrite that loses a record keeps its restore entry even when the text is the same.
    if (text === cell.f && !loses) continue;
    if (!loses && print(bound, tab.id, before, before) !== cell.f) {
      const now = bind(text, tab.id, after);
      if (now !== null) back.push([tab.id, rid, cid, cell.f, was, { ids: idsOf(now) }]);
    }
    if (loses) {
      const forward = slotsOf(text, tab.id, after);
      back.push([tab.id, rid, cid, cell.f, originalSlots(cell.f, tab.id, before), forward ? forward.keys : null]);
    }
    if (text !== cell.f) put(run, tab, r, c, { ...cell, f: text });
  }

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
    if (text !== cell.f) put(run, tab, r, c, { ...cell, f: text });
  }
  return back;
}
