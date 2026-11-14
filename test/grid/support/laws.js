// The reducer laws of the plan, over one seeded list of actions: C1, C2, C3, C4, C7, C8, C9, C10 and
// the check that a sheet stays clean. The engine is passed in, so a planted copy's ops.js is the
// one under test; the start sheet is already in normal form.
import { rng } from "../../grid-codec/support/rng.js";
import { cellValue } from "../../../src/grid/codec/value.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

const pick = (rand, n) => Math.floor(rand() * n);

const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

// A new formula marks the table stale and no action clears it, so the bytes are compared without it.
const unstale = (bytes) => bytes.replace(/^(<table grid(?: freeze-cols="[0-9]+")?) stale/, "$1");

export function splitTables(src) {
  const starts = [];
  for (let at = src.indexOf("<table grid"); at !== -1; at = src.indexOf("<table grid", at + 1)) starts.push(at);
  return starts.map((at, index) => src.slice(at, index + 1 < starts.length ? starts[index + 1] : src.length));
}

// The lists spread over every table: each table appears, and the tables with more cells get fewer
// lists, so the suite's time stays bounded.
export function listTables(tables, count) {
  const weight = (table) => {
    const cells = table.model.rows.length * Math.max(1, table.model.cols.length);
    return Math.max(1, Math.min(48, Math.round(2400 / (cells + 1))));
  };
  const weights = tables.map(weight);
  const widest = Math.max(...weights);
  const tickets = [];
  for (let round = 0; round < widest; round++) {
    tables.forEach((table, index) => {
      if (round < weights[index]) tickets.push(table.name);
    });
  }
  const names = [];
  for (let index = 0; index < count; index++) names.push(tickets[index % tickets.length]);
  return names;
}

// The fields of a cell a law compares, the ones that hold the cell's content, and the kind of target
// that must name each change.
const CELL_FIELDS = ["text", "n", "t", "v", "f", "fmt", "style", "colspan", "rowspan"];

const CONTENT_FIELDS = ["text", "n", "t", "v", "f"];

const targetKind = (field) => {
  if (field === "fmt") return "fmt";
  if (field === "style") return "style";
  if (field === "colspan" || field === "rowspan") return "span";
  return "content";
};

const named = (kind, granted) =>
  kind === "style" ? granted.some((one) => one === "style:*" || one.startsWith("style:")) : granted.includes(kind);

// The value a cell holds, whatever its format makes it show; a cell with no text and no cell at all
// hold the same nothing.
const contentOf = (cell) => {
  if (cell === null) return null;
  const value = cellValue(cell);
  if (cell.f !== undefined) return `f:${cell.f}:${typeof value}:${String(value)}`;
  return value;
};

// The rows and columns an action creates, anywhere in a batch: `creates` nets a delete against a
// re-insert of the same id, so the walk visits every member.
function made(action, creates) {
  if (action.t === "batch") {
    const rows = [];
    const cols = [];
    for (const one of action.actions) {
      const part = made(one, creates);
      for (const id of part.rows) rows.push(id);
      for (const id of part.cols) cols.push(id);
    }
    return { rows, cols };
  }
  return creates(action);
}

// The rows and columns an action deletes, anywhere in a batch: `needs` names them.
function removes(action) {
  if (action.t === "batch") {
    const rows = [];
    const cols = [];
    for (const one of action.actions) {
      const part = removes(one);
      for (const id of part.rows) rows.push(id);
      for (const id of part.cols) cols.push(id);
    }
    return { rows, cols };
  }
  return {
    rows: action.t === "deleteRows" ? action.rows : [],
    cols: action.t === "deleteCols" ? action.cols : [],
  };
}

// The rectangle of rows and columns every merge in a sheet covers, by id.
function mergeRects(sheet) {
  const out = [];
  sheet.rows.forEach((row, r) => {
    row.cells.forEach((cell, c) => {
      if (cell === null || cell.hidden) return;
      const rs = cell.rowspan ?? 1;
      const cs = cell.colspan ?? 1;
      if (rs === 1 && cs === 1) return;
      out.push({
        rows: sheet.rows.slice(r, r + rs).map((one) => one.id),
        cols: sheet.cols.slice(c, c + cs).map((one) => one.id),
      });
    });
  });
  return out;
}

const indexById = (records) => {
  const out = new Map();
  records.forEach((record, at) => out.set(record.id, at));
  return out;
};

// The multisets of non-blank content and style in a merge rectangle, leaving out whole records. The
// merge anchor is kept even when its record is deleted or created, because it is the value that moves.
function rectHolds(sheet, rect, skipRows, skipCols) {
  const rowsAt = indexById(sheet.rows);
  const colsAt = indexById(sheet.cols);
  const content = new Map();
  const style = new Map();
  const add = (map, value) => map.set(value, (map.get(value) ?? 0) + 1);
  for (const rowId of rect.rows) {
    if (skipRows.has(rowId) && rowId !== rect.rows[0]) continue;
    const row = sheet.rows[rowsAt.get(rowId)];
    if (!row) continue;
    for (const colId of rect.cols) {
      if (skipCols.has(colId) && colId !== rect.cols[0]) continue;
      const c = colsAt.get(colId);
      if (c === undefined) continue;
      const cell = row.cells[c] ?? null;
      if (!cell || cell.hidden) continue;
      const value = contentOf(cell);
      const drawn = cell.style !== undefined ? cell.style : null;
      if (value !== null) add(content, stable(value));
      if (drawn !== null) add(style, stable(drawn));
    }
  }
  return { content, style };
}

// The merge that covers this rectangle on one side, found by the rectangle's first cell that is on
// that side and is not a record the action deleted or created there. A delete can move a merge's
// anchor to another row, and an id the batch deleted and made again is another record, so neither
// may decide which merge is meant.
const cornerOn = (sheet, rect, skipRows, skipCols) => {
  const rows = new Set(sheet.rows.map((one) => one.id));
  const cols = new Set(sheet.cols.map((one) => one.id));
  const row = rect.rows.find((id) => rows.has(id) && !skipRows.has(id));
  const col = rect.cols.find((id) => cols.has(id) && !skipCols.has(id));
  return row === undefined || col === undefined ? null : [row, col];
};
const mergeAt = (sheet, corner) =>
  corner === null ? undefined : mergeRects(sheet).find((one) => one.rows.includes(corner[0]) && one.cols.includes(corner[1]));
const rectOn = (sheet, rect, skipRows, skipCols) => mergeAt(sheet, cornerOn(sheet, rect, skipRows, skipCols)) ?? rect;

const sameHolds = (left, right) => {
  if (left.size !== right.size) return false;
  for (const [key, count] of left) if (right.get(key) !== count) return false;
  return true;
};

// The rectangle of the merges the action itself names: a merge inside a batch exists only during the
// action, so its rectangle is measured in the state the merge runs in: the members before it are
// folded onto a scratch copy of the sheet, so a row the batch moves cannot stretch the span.
function actionRects(action, scratchOf, run) {
  const out = [];
  const scratch = scratchOf();
  const push = (merge) => {
    const sheet = scratch.sheet;
    const at = (list, id) => list.findIndex((one) => one.id === id);
    const top = at(sheet.rows, merge.from[0]);
    const bottom = at(sheet.rows, merge.to[0]);
    const left = at(sheet.cols, merge.from[1]);
    const right = at(sheet.cols, merge.to[1]);
    if (top < 0 || bottom < 0 || left < 0 || right < 0) return;
    out.push({
      rows: sheet.rows.slice(Math.min(top, bottom), Math.max(top, bottom) + 1).map((one) => one.id),
      cols: sheet.cols.slice(Math.min(left, right), Math.max(left, right) + 1).map((one) => one.id),
    });
  };
  const walk = (one) => {
    if (one.t === "batch") {
      one.actions.forEach(walk);
      return;
    }
    if (one.t === "merge") push(one);
    run(scratch, one);
  };
  walk(action);
  return out;
}

// Every cell field that changed between two sheets, keyed by row id and column id, skipping the rows
// and columns the action created or deleted.
function changedCells(before, after, skip) {
  const rowsBefore = indexById(before.rows);
  const colsBefore = indexById(before.cols);
  const colsAfter = indexById(after.cols);
  const out = [];
  for (const row of after.rows) {
    const was = rowsBefore.get(row.id);
    if (was === undefined || skip.has(row.id)) continue;
    const old = before.rows[was];
    for (const col of after.cols) {
      const colBefore = colsBefore.get(col.id);
      if (colBefore === undefined || skip.has(col.id)) continue;
      // A hidden cell is a placeholder a merge keeps: it shows nothing, so it holds nothing.
      const here = row.cells[colsAfter.get(col.id)] ?? null;
      const then = old.cells[colBefore] ?? null;
      const from = then === null || then.hidden ? null : then;
      const to = here === null || here.hidden ? null : here;
      const changed = [];
      for (const field of CELL_FIELDS) {
        const left = to === null ? undefined : to[field];
        const right = from === null ? undefined : from[field];
        // An empty text and no text show the same nothing.
        if (field === "text" && (left ?? "") === (right ?? "")) continue;
        if (left !== right) changed.push(field);
      }
      if (changed.length > 0) out.push({ row: row.id, col: col.id, from, to, changed });
    }
  }
  return out;
}

export function runList(engine, { start, actions, formulas = null, seed = 0, list = 0, name = "", counts = null, twins = 3 }) {
  const derive = engine.derive;
  const { apply, fits, needs, creates, targets, modelBacking, checkSheet, gridModel, tableHtml } = engine;
  const bytesOf = (backing) => tableHtml(backing.sheet);
  const reload = (bytes) => modelBacking(gridModel(bytes, 0), { sheetId: null });
  const begin = () => modelBacking(clone(start), { sheetId: null });

  const failure = (law, index, action, before, after, detail = null) => ({
    law,
    seed,
    list,
    table: name,
    index,
    action,
    before,
    after,
    detail,
  });

  const count = (kind, outcome) => {
    if (!counts) return;
    if (!counts[kind]) counts[kind] = { applied: 0, refused: 0 };
    counts[kind][outcome] += 1;
  };

  const random = rng((seed ^ 0x9e3779b9) >>> 0);
  const points = [];
  const wanted = Math.min(twins, actions.length);
  while (points.length < wanted) {
    const at = pick(random, actions.length);
    if (!points.includes(at)) points.push(at);
  }
  const clones = points.map((at) => ({ at, backing: null }));

  const backing = begin();
  const trail = [];

  for (let index = 0; index < actions.length; index++) {
    const action = actions[index];
    const before = bytesOf(backing);

    for (const twin of clones) {
      if (twin.at !== index) continue;
      twin.backing = reload(before);
      if (stable(twin.backing.sheet) !== stable(backing.sheet)) {
        return failure("C3 a reload reads the same sheet", index, action, before, bytesOf(twin.backing));
      }
    }

    const hadRows = new Set(backing.rows().map((row) => row.id));
    const hadCols = new Set(backing.cols().map((col) => col.id));
    const need = needs(action);
    const brought = creates(action);

    let fitted;
    try {
      fitted = fits(backing, action, { formulas });
    } catch (error) {
      if (!(error instanceof engine.GridRefused)) throw error;
      fitted = { code: error.code, detail: error.detail };
    }
    const was = clone(backing.sheet);
    const out = apply(backing, action, { derive, formulas });
    const after = bytesOf(backing);
    const applied = out.out === "applied";
    count(action.t, applied ? "applied" : "refused");
    const shape = engine.shapeOf ? engine.shapeOf(action) : null;
    if (shape !== null) count(shape, applied ? "applied" : "refused");
    trail.push({ out: out.out, code: out.code });

    for (const twin of clones) {
      if (twin.at > index) continue;
      const mirror = apply(twin.backing, action, { derive, formulas });
      if (mirror.out !== out.out || mirror.code !== out.code) {
        return failure("C3 reloading commutes with apply", index, action, before, after, `the reloaded backing says ${mirror.out} ${mirror.code ?? ""}`);
      }
    }

    if ((fitted === true) !== applied) {
      return failure("C7 fits agrees with apply", index, action, before, after, `fits ${fitted === true ? "true" : fitted.code}, apply ${out.out}`);
    }

    if (!applied) {
      if (after !== before) return failure("C4 a refusal changes nothing", index, action, before, after);
      continue;
    }

    for (const id of need.rows) if (!hadRows.has(id)) return failure("C8 needs names a present row", index, action, before, after, id);
    for (const id of need.cols) if (!hadCols.has(id)) return failure("C8 needs names a present column", index, action, before, after, id);
    for (const id of brought.rows) if (hadRows.has(id)) return failure("C8 creates names an absent row", index, action, before, after, id);
    for (const id of brought.cols) if (hadCols.has(id)) return failure("C8 creates names an absent column", index, action, before, after, id);

    const nowRows = new Set(backing.rows().map((row) => row.id));
    const nowCols = new Set(backing.cols().map((col) => col.id));
    for (const id of brought.rows) if (!nowRows.has(id)) return failure("C8 a created row exists after", index, action, before, after, id);
    for (const id of brought.cols) if (!nowCols.has(id)) return failure("C8 a created column exists after", index, action, before, after, id);

    // C9 is checked on each member of a batch in turn, against the sheet just before that member: the
    // batch's targets are its members' targets (ops.js `targets`), and the batch is applied member by
    // member, so every field the batch changes was changed by a member that must name it. Comparing
    // the sheet before a whole batch with the sheet after it mixes geometry the members moved.
    const c9Single = (was, sheet, action) => {
      const hadRows = new Set(was.rows.map((row) => row.id));
      const hadCols = new Set(was.cols.map((col) => col.id));
      const nowRows = new Set(sheet.rows.map((row) => row.id));
      const nowCols = new Set(sheet.cols.map((col) => col.id));
      // C9: co-editing sees a conflict through `targets` alone, so a change of a cell's content, of its
      // format, of its style or of its span is named by a target of that kind. A text change that only
      // re-derives the same content under a new effective format is a format change: the cell's `fmt`
      // target or the column-format target of the action that changed the column's format names it. A
      // cell inside a merge's rectangle that the action enters by creating or deleting a row or column
      // is named by that record id in `needs` and `creates`, so a person's typing in a merged area is
      // never lost without a conflict and the cell needs no target of its own. The created and deleted
      // records are the union over every member of a batch, so a delete and a re-insert of one id both
      // count even though the batch nets them to nothing.
      const listed = targets(action);
      const gone = removes(action);
      const madeAnywhere = made(action, creates);
      const skip = new Set([...madeAnywhere.rows, ...madeAnywhere.cols, ...gone.rows, ...gone.cols]);
      const cells = changedCells(was, sheet, skip);
      const lostRows = new Set([...hadRows].filter((id) => !nowRows.has(id)));
      const lostCols = new Set([...hadCols].filter((id) => !nowCols.has(id)));
      const broughtRows = new Set(madeAnywhere.rows);
      const broughtCols = new Set(madeAnywhere.cols);
      const entered = (rect) =>
        rect.rows.some((id) => broughtRows.has(id) || lostRows.has(id)) ||
        rect.cols.some((id) => broughtCols.has(id) || lostCols.has(id));
      const rects = mergeRects(was).concat(mergeRects(sheet), actionRects(action, () => modelBacking(clone(was), { sheetId: null }), (scratch, one) => apply(scratch, one, { derive, formulas })));
      const goneRows = new Set(gone.rows);
      const goneCols = new Set(gone.cols);
      const madeRows = new Set(madeAnywhere.rows);
      const madeCols = new Set(madeAnywhere.cols);
      const stillMerge = (rect) => mergeAt(sheet, cornerOn(sheet, rect, madeRows, madeCols)) !== undefined;
      const enteredAll = rects.filter(entered);
      const enteredRects = [];
      for (const rect of enteredAll) {
        const then = rectHolds(was, rectOn(was, rect, goneRows, goneCols), goneRows, goneCols);
        const now = rectHolds(sheet, rectOn(sheet, rect, madeRows, madeCols), madeRows, madeCols);
        const kinds = new Set(
          listed.filter(([, row, col]) => rect.rows.includes(row) && rect.cols.includes(col)).map(([, , , kind]) => kind),
        );
        const info = {
          rect,
          content: sameHolds(then.content, now.content),
          style: sameHolds(then.style, now.style),
          namedContent: kinds.has("content"),
          namedStyle: Array.from(kinds).some((kind) => kind === "style" || kind.startsWith("style:")),
        };
        enteredRects.push(info);
        const survives = rect.rows.some((id) => nowRows.has(id)) && rect.cols.some((id) => nowCols.has(id));
        if (!survives || !stillMerge(rect)) continue;
        if (!info.content && !info.namedContent) {
          return ["C9 an entered merge rectangle keeps its content", info.rect];
        }
        if (!info.style && !info.namedStyle) {
          return ["C9 an entered merge rectangle keeps its style", info.rect];
        }
      }
      const missing = [];
      for (const change of cells) {
        const granted = listed
          .filter(([sheet, row, col]) => row === change.row && col === change.col)
          .map(([, , , kind]) => kind);
        const columnFmt = listed.some(([, row, col, kind]) => row === "col" && col === change.col && kind === "fmt");
        const here = enteredRects.filter(
          (one) => one.rect.rows.includes(change.row) && one.rect.cols.includes(change.col),
        );
        const exemptContent = here.some((one) => one.content || one.namedContent);
        const exemptStyle = here.some((one) => one.style || one.namedStyle);
        const exemptSpan = enteredAll.some(
          (rect) => rect.rows.includes(change.row) && rect.cols.includes(change.col),
        );
        const sameContent = contentOf(change.from) === contentOf(change.to);
        const fields = change.changed;
        if (!sameContent) {
          if (!named("content", granted) && !exemptContent) missing.push(`${change.row}/${change.col} content needs content`);
        } else if (fields.some((field) => CONTENT_FIELDS.includes(field))) {
          if (!named("fmt", granted) && !columnFmt && !exemptSpan) missing.push(`${change.row}/${change.col} text needs a format target`);
        }
        for (const field of fields) {
          if (CONTENT_FIELDS.includes(field)) continue;
          if (exemptSpan && (field === "colspan" || field === "rowspan" || field === "fmt")) continue;
          const kind = targetKind(field);
          if (kind === "style" && exemptStyle) continue;
          if (!named(kind, granted)) missing.push(`${change.row}/${change.col} ${field} needs ${kind}`);
        }
      }
      if (missing.length > 0) return ["C9 targets names every change", missing.slice(0, 6)];
      return null;
    };
    const c9Of = (was, sheet, action) => {
      if (action.t !== "batch") return c9Single(was, sheet, action);
      const scratch = modelBacking(clone(was), { sheetId: null });
      const members = [];
      const flat = (one) => (one.t === "batch" ? one.actions.forEach(flat) : members.push(one));
      flat(action);
      for (let k = 0; k < members.length; k++) {
        const prev = clone(scratch.sheet);
        apply(scratch, members[k], { derive, formulas });
        const found = c9Single(prev, scratch.sheet, members[k]);
        if (found) return [found[0], { member: k, detail: found[1] }];
      }
      if (stable(scratch.sheet) !== stable(sheet)) return ["C9 a batch is its members in order", null];
      return null;
    };
    const c9 = c9Of(was, backing.sheet, action);
    if (c9) return failure(c9[0], index, action, before, after, c9[1]);

    const issues = checkSheet(backing.sheet);
    if (issues.length > 0) return failure("the check stays clean", index, action, before, after, issues);

    const parsed = gridModel(after, 0);
    if (tableHtml(parsed) !== after) return failure("C2 the bytes read back to themselves", index, action, before, after);
    if (stable(parsed) !== stable(backing.sheet)) return failure("C2 the bytes read back to the same sheet", index, action, before, after);

    const copy = modelBacking(parsed, { sheetId: null });
    const undone = apply(copy, out.inverse, { derive, formulas });
    if (undone.out !== "applied") {
      return failure("C10 the inverse applies", index, action, before, after, `${undone.code} ${undone.detail}`);
    }
    if (unstale(bytesOf(copy)) !== unstale(before)) {
      return failure("C10 the inverse restores the bytes", index, action, before, after);
    }
    const redone = apply(copy, undone.inverse, { derive, formulas });
    if (redone.out !== "applied") {
      return failure("C10 the inverse of the inverse applies", index, action, before, after, `${redone.code} ${redone.detail}`);
    }
    if (unstale(bytesOf(copy)) !== unstale(after)) {
      return failure("C10 the inverse of the inverse restores the bytes", index, action, before, after);
    }
  }

  const end = bytesOf(backing);
  for (const twin of clones) {
    if (twin.backing === null) continue;
    if (bytesOf(twin.backing) !== end) return failure("C3 a reload ends at the same bytes", actions.length, null, end, bytesOf(twin.backing));
  }

  const again = begin();
  for (let index = 0; index < actions.length; index++) {
    const second = apply(again, actions[index], { derive, formulas });
    if (second.out !== trail[index].out || second.code !== trail[index].code) {
      return failure("C1 the same list gives the same outcomes", index, actions[index], "", "");
    }
  }
  if (bytesOf(again) !== end) return failure("C1 the same list gives the same bytes", actions.length, null, end, bytesOf(again));

  return null;
}
