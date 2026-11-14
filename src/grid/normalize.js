// The repair: every problem checkSheet reports, fixed in one declared step. A cell's content is
// never changed and no value moves to another row or column. Pure: the model in, a new model out,
// plus one entry per thing done, in the order done.

import { isKey, keysBetween } from "./codec/order-keys.js";
import { typed } from "./codec/value.js";
import { canonStyle } from "./styles.js";
import { isBuiltin } from "./format.js";

const ID = /^[A-Za-z0-9_-]{1,64}$/;

// The HTML limits on a span. A browser draws a table no wider or taller than these, so a cell past
// them is clamped before any walk reads it: no table, however written, costs more than the sheet.
const MAX_COLS = 1000;
const MAX_ROWS = 65534;

const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) out[key] = clone(value[key]);
    return out;
  }
  return value;
};

const span = (cell, key) => {
  const value = cell ? cell[key] : undefined;
  return typeof value === "number" && value > 1 ? value : 1;
};

const writeSpan = (cell, colspan, rowspan) => {
  if (colspan > 1) cell.colspan = colspan;
  else delete cell.colspan;
  if (rowspan > 1) cell.rowspan = rowspan;
  else delete cell.rowspan;
};

const after = (a, b) => a.pos > b.pos || (a.pos === b.pos && a.id > b.id);

// Rule 0: a span past the HTML limits is clamped, once per cell, before any loop sees it.
function clampSpans(sheet, repairs) {
  sheet.rows.forEach((row, r) => {
    row.cells.forEach((cell, c) => {
      if (!cell) return;
      const cs = span(cell, "colspan");
      const rs = span(cell, "rowspan");
      if (cs <= MAX_COLS && rs <= MAX_ROWS) return;
      writeSpan(cell, Math.min(cs, MAX_COLS), Math.min(rs, MAX_ROWS));
      repairs.push({ code: "span_too_big", row: r, col: c });
    });
  });
}

const at = (row, col) => `${row},${col}`;

const placeholder = () => ({ text: "", hidden: true });

// Rule 1: the HTML slot rule, decided row by row. A row is in the grid's form when the slots its
// spans cover already hold the hidden placeholders the grid writes; then the slot rule places every
// cell where it already is and the row is left alone. A row whose covered slot holds a real cell,
// or a row under a span of such a row, is ordinary HTML: the slot rule puts each cell in the first
// slot no earlier cell has taken, so every value stays in the column a browser shows it in, and the
// rows below shift as HTML shifts them, even when other rows of the table carry placeholders.
function plainHtml(sheet, repairs, textRows = new Set()) {
  const rows = sheet.rows.length;
  if (rows === 0) return;
  // A bound on the table's width once every row has taken its slots: every row can add at most its
  // own slots, so the sum over the rows is never less than the widest row the rule can build.
  let width = sheet.cols.length;
  for (const row of sheet.rows) {
    for (const cell of row.cells) width += cell ? span(cell, "colspan") : 1;
  }
  width = Math.min(width, MAX_COLS);

  const blocked = sheet.rows.map(() => new Set());
  for (let r = 0; r < rows; r++) {
    const line = sheet.rows[r];
    const hiddenAt = new Map();
    line.cells.forEach((cell, c) => {
      if (cell && cell.hidden) hiddenAt.set(c, cell);
    });
    const fill = (slot) => hiddenAt.get(slot) ?? placeholder();
    const slots = [];
    const added = [];
    let overflow = false;
    let col = 0;
    const skip = () => {
      while (blocked[r].has(col)) {
        if (slots[col] === undefined) slots[col] = fill(col);
        col++;
      }
    };
    for (const cell of line.cells) {
      skip();
      if (col >= width) {
        overflow = true;
        break;
      }
      if (cell === null || cell === undefined) {
        slots[col] = null;
        col++;
        continue;
      }
      if (cell.hidden) continue;
      const cs = span(cell, "colspan");
      const rs = span(cell, "rowspan");
      const across = Math.min(cs, width - col);
      const down = Math.min(rs, rows - r);
      slots[col] = cell;
      for (let j = 1; j < across; j++) if (slots[col + j] === undefined) slots[col + j] = fill(col + j);
      added.push([col, across, down]);
      col += cs;
    }
    if (overflow) continue;
    if (textRows.has(r)) {
      line.cells.forEach((cell, c) => {
        if (!cell || cell.hidden) return;
        const down = Math.min(span(cell, "rowspan"), rows - r);
        const across = Math.min(span(cell, "colspan"), width - c);
        for (let i = 1; i < down; i++) for (let j = 0; j < across; j++) blocked[r + i].add(c + j);
      });
      continue;
    }
    for (const [at, across, down] of added) {
      for (let i = 1; i < down; i++) for (let j = 0; j < across; j++) blocked[r + i].add(at + j);
    }
    skip();
    let furthest = -1;
    for (const column of blocked[r]) if (column > furthest) furthest = column;
    while (col <= furthest) {
      if (blocked[r].has(col) && slots[col] === undefined) slots[col] = fill(col);
      col++;
    }
    let last = -1;
    for (let i = 0; i < slots.length; i++) if (slots[i] !== undefined) last = i;
    const cells = [];
    for (let i = 0; i <= last; i++) cells.push(slots[i] === undefined ? null : slots[i]);
    const before = [];
    line.cells.forEach((cell, i) => {
      if (cell !== undefined && !(cell && cell.hidden)) before.push(i);
    });
    const placed = [];
    cells.forEach((cell, i) => {
      if (!cell || !cell.hidden) placed.push(i);
    });
    let same = before.length === placed.length;
    for (let i = 0; same && i < before.length; i++) if (before[i] !== placed[i]) same = false;
    if (same || textRows.has(r)) continue;
    line.cells = cells;
    cells.forEach((cell, c) => {
      if (cell && cell.hidden) repairs.push({ code: "merge_uncovered", row: r, col: c });
    });
  }
}

// What an undone merge leaves behind: nothing, or an empty cell that keeps the fmt and style the
// hidden placeholder held, so a merge undone by the repair does not lose them.
const uncovered = (cell) => {
  const out = { text: "" };
  if (cell.fmt !== undefined) out.fmt = cell.fmt;
  if (cell.style !== undefined) out.style = cell.style;
  return Object.keys(out).length === 1 ? null : out;
};

// Delete a span from its origin. Every position it covered that holds a hidden cell becomes an
// empty cell, unless a span kept earlier in the walk already covers it, and every position it
// covered in a row below that holds a shown cell takes an empty cell before it, so that the cells a
// browser drew past the span keep the column it drew them in.
function undo(sheet, row, col, colspan, rowspan, kept, repairs, code = "merge_overlap") {
  const rows = sheet.rows.length;
  const cell = sheet.rows[row].cells[col];
  const shown = !cell.hidden;
  delete cell.colspan;
  delete cell.rowspan;
  for (let i = 0; i < Math.min(rowspan, rows - row); i++) {
    const target = sheet.rows[row + i];
    for (let j = 0; j < Math.min(colspan, target.cells.length - col); j++) {
      if (i === 0 && j === 0) continue;
      if (kept.has(at(row + i, col + j))) continue;
      const covered = target.cells[col + j];
      if (shown && i > 0 && !(covered && covered.hidden)) {
        target.cells.splice(col + j, 0, null);
      } else if (covered && covered.hidden) {
        target.cells[col + j] = uncovered(covered);
      }
    }
  }
  repairs.push({ code, row, col });
}

function covering(sheet, row, col) {
  const found = [];
  sheet.rows.forEach((each, r) => {
    each.cells.forEach((cell, c) => {
      if (!cell || (r === row && c === col)) return;
      const cs = span(cell, "colspan");
      const rs = span(cell, "rowspan");
      if (cs === 1 && rs === 1) return;
      if (row >= r && row < r + rs && col >= c && col < c + cs) found.push({ r, c, cs, rs });
    });
  });
  return found;
}

// Rule 2: a hidden cell that held text in the live table is shown again, and any merge that
// covers it is undone.
function showHiddenText(sheet, hiddenText, repairs) {
  if (!Array.isArray(hiddenText)) return;
  for (const item of hiddenText) {
    const row = sheet.rows[item.row];
    if (!row) continue;
    while (row.cells.length <= item.col) row.cells.push(null);
    const cell = row.cells[item.col] ?? { text: "" };
    const shown = { ...cell, text: typeof item.text === "string" ? item.text : "" };
    delete shown.hidden;
    row.cells[item.col] = shown;
    for (const each of covering(sheet, item.row, item.col)) {
      undo(sheet, each.r, each.c, each.cs, each.rs, new Set(), repairs, "hidden_text");
    }
  }
}

function widthOf(sheet) {
  let width = sheet.cols.length;
  for (const row of sheet.rows) width = Math.max(width, row.cells.length);
  return width;
}

// Rule 3: clamp a span that runs past the sheet, undo a span whose covered positions hold content
// or another span, turn an orphan hidden cell into an empty cell, and fill a kept span's
// positions with hidden cells.
function brokenMerges(sheet, repairs) {
  const rows = sheet.rows.length;
  const width = widthOf(sheet);
  const keptCovers = new Set();
  const keptOrigins = new Set();

  for (let r = 0; r < rows; r++) {
    const line = sheet.rows[r];
    for (let c = 0; c < line.cells.length; c++) {
      const cell = line.cells[c];
      if (!cell) continue;
      if (cell.hidden) {
        delete cell.colspan;
        delete cell.rowspan;
        continue;
      }
      let cs = span(cell, "colspan");
      let rs = span(cell, "rowspan");
      if (cs === 1 && rs === 1) continue;

      const clampedCols = Math.min(cs, width - c);
      const clampedRows = Math.min(rs, rows - r);
      if (clampedCols !== cs || clampedRows !== rs) {
        repairs.push({ code: "merge_past_end", row: r, col: c, from: `${cs} x ${rs}`, to: `${clampedCols} x ${clampedRows}` });
        writeSpan(cell, clampedCols, clampedRows);
        cs = clampedCols;
        rs = clampedRows;
        if (cs === 1 && rs === 1) continue;
      }

      let broken = false;
      for (let i = 0; i < rs && !broken; i++) {
        for (let j = 0; j < cs && !broken; j++) {
          if (i === 0 && j === 0) continue;
          const rr = r + i;
          const cc = c + j;
          const target = sheet.rows[rr];
          const other = target ? target.cells[cc] : undefined;
          if (other && !other.hidden) broken = true;
          else if (other && (span(other, "colspan") > 1 || span(other, "rowspan") > 1)) broken = true;
          else if (keptCovers.has(at(rr, cc))) broken = true;
        }
      }
      if (broken) {
        undo(sheet, r, c, cs, rs, keptCovers, repairs);
        continue;
      }

      keptOrigins.add(at(r, c));
      for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) if (i > 0 || j > 0) keptCovers.add(at(r + i, c + j));
    }
  }

  for (let r = 0; r < rows; r++) {
    const line = sheet.rows[r];
    for (let c = 0; c < line.cells.length; c++) {
      const cell = line.cells[c];
      if (!cell || !cell.hidden) continue;
      if (keptCovers.has(at(r, c)) || keptOrigins.has(at(r, c))) continue;
      line.cells[c] = null;
      repairs.push({ code: "hidden_orphan", row: r, col: c });
    }
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < sheet.rows[r].cells.length; c++) {
      const cell = sheet.rows[r].cells[c];
      if (!cell) continue;
      const cs = span(cell, "colspan");
      const rs = span(cell, "rowspan");
      if (cs === 1 && rs === 1) continue;
      for (let i = 0; i < rs; i++) {
        for (let j = 0; j < cs; j++) {
          if (i === 0 && j === 0) continue;
          const target = sheet.rows[r + i];
          if (!target) continue;
          while (target.cells.length <= c + j) target.cells.push(null);
          const here = target.cells[c + j];
          if (here && here.hidden) continue;
          target.cells[c + j] = placeholder();
          repairs.push({ code: "merge_uncovered", row: r + i, col: c + j });
        }
      }
    }
  }
}

// Rule 4: a column for every cell past the end of the column list. Rules 5 and 6 name them.
function shortColumns(sheet, repairs) {
  const width = widthOf(sheet);
  while (sheet.cols.length < width) {
    repairs.push({ code: "row_too_long", col: sheet.cols.length });
    sheet.cols.push({ id: "", pos: "" });
  }
}

// Rule 5: rows and columns share one id space. The first holder of a valid id keeps it; the rest
// get the lowest free name.
function fixIds(sheet, repairs) {
  const keepers = new Set();
  const plan = [];
  const collect = (records, axis) => {
    records.forEach((record, index) => {
      const id = typeof record.id === "string" ? record.id : "";
      const keeps = ID.test(id) && !keepers.has(id);
      if (keeps) keepers.add(id);
      plan.push({ record, axis, index, id, keeps });
    });
  };
  collect(sheet.cols, "col");
  collect(sheet.rows, "row");

  const taken = new Set(keepers);
  let nextCol = 1;
  let nextRow = 1;
  for (const item of plan) {
    if (item.keeps) continue;
    let name;
    if (item.axis === "col") {
      while (taken.has(`c${nextCol}`)) nextCol++;
      name = `c${nextCol}`;
      nextCol++;
    } else {
      while (taken.has(`r${nextRow}`)) nextRow++;
      name = `r${nextRow}`;
      nextRow++;
    }
    taken.add(name);
    const why = item.id === "" ? "missing" : ID.test(item.id) ? "duplicate" : "invalid";
    repairs.push({ code: `${item.axis}_id_${why}`, [item.axis]: item.index, from: item.id, to: name });
    item.record.id = name;
  }
}

// Rule 6: keep the longest already-increasing run of records with valid keys, drop the right of
// two equal-key kept neighbors that has records between them, and give every other record a key.
function fixOrder(sheet, axis, repairs) {
  const records = axis === "col" ? sheet.cols : sheet.rows;
  const n = records.length;
  if (n === 0) return;

  const keys = records.map((record) => (isKey(record.pos) ? record.pos : null));
  const ids = records.map((record) => (typeof record.id === "string" ? record.id : ""));

  const pairs = [];
  for (let i = 0; i < n; i++) if (keys[i] !== null) pairs.push({ pos: keys[i], id: ids[i], index: i });
  pairs.sort((a, b) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rank = new Array(n).fill(-1);
  let size = 0;
  for (let i = 0; i < pairs.length; i++) {
    if (i > 0 && pairs[i].pos === pairs[i - 1].pos && pairs[i].id === pairs[i - 1].id) rank[pairs[i].index] = rank[pairs[i - 1].index];
    else rank[pairs[i].index] = size++;
  }

  const tree = new Array(size + 1).fill(0);
  const best = (upTo) => {
    let top = 0;
    for (let x = upTo; x > 0; x -= x & -x) if (tree[x] > top) top = tree[x];
    return top;
  };
  const put = (slot, value) => {
    for (let x = slot; x <= size; x += x & -x) if (value > tree[x]) tree[x] = value;
  };
  const length = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    if (keys[i] === null) continue;
    const slot = size - rank[i];
    length[i] = 1 + best(slot - 1);
    put(slot, length[i]);
  }

  let kept = [];
  let pick = -1;
  for (let i = 0; i < n; i++) if (keys[i] !== null && (pick === -1 || length[i] > length[pick])) pick = i;
  while (pick !== -1) {
    kept.push(pick);
    const want = length[pick] - 1;
    let next = -1;
    for (let j = pick + 1; j < n && want > 0; j++) {
      if (keys[j] === null || length[j] !== want) continue;
      if (after({ pos: keys[j], id: ids[j] }, { pos: keys[pick], id: ids[pick] })) {
        next = j;
        break;
      }
    }
    pick = next;
  }

  let dropped = true;
  while (dropped && kept.length > 1) {
    dropped = false;
    for (let k = 0; k + 1 < kept.length; k++) {
      if (keys[kept[k]] === keys[kept[k + 1]] && kept[k + 1] > kept[k] + 1) {
        kept.splice(k + 1, 1);
        dropped = true;
        break;
      }
    }
  }

  const stay = new Set(kept);
  let i = 0;
  while (i < n) {
    if (stay.has(i)) {
      i++;
      continue;
    }
    const start = i;
    while (i < n && !stay.has(i)) i++;
    const left = start > 0 ? keys[start - 1] : null;
    const right = i < n ? keys[i] : null;
    const fresh = keysBetween(left, right, i - start);
    for (let x = 0; x < i - start; x++) {
      const record = records[start + x];
      const code = `${axis}_pos_${isKey(record.pos) ? "order" : "invalid"}`;
      const from = typeof record.pos === "string" ? record.pos : "";
      repairs.push({ code, [axis]: start + x, from, to: fresh[x] });
      record.pos = fresh[x];
    }
  }
}

// Rule 7: a freeze past the columns is clamped, and a frozen row after an unfrozen one thaws.
function fixFreeze(sheet, repairs) {
  let changed = false;
  if (typeof sheet.freezeCols === "number" && sheet.freezeCols > sheet.cols.length) {
    changed = true;
    if (sheet.cols.length === 0) delete sheet.freezeCols;
    else sheet.freezeCols = sheet.cols.length;
  }
  let unfrozen = false;
  for (const row of sheet.rows) {
    if (!row.frozen) {
      unfrozen = true;
      continue;
    }
    if (unfrozen) {
      delete row.frozen;
      changed = true;
    }
  }
  if (changed) repairs.push({ code: "freeze_range" });
}

const sameCell = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  const left = Object.keys(a);
  const right = Object.keys(b);
  if (left.length !== right.length) return false;
  return left.every((key) => a[key] === b[key]);
};

const keptValues = (cell) => {
  const kept = {};
  for (const key of ["text", "n", "t", "v", "f"]) if (cell[key] !== undefined) kept[key] = cell[key];
  return kept;
};

// Rule 8: every shown cell put in normal form, with its own fmt and span left exactly as they were
// and its style in the order the engine writes.
function normalForm(sheet, derive, repairs) {
  if (typeof derive !== "function") return;
  sheet.rows.forEach((row, r) => {
    row.cells.forEach((cell, c) => {
      if (!cell || cell.hidden) return;
      const raw = cell.v ?? cell.text;
      const value = typed(raw, cell.t === true);
      const content = cell.f !== undefined ? { f: cell.f } : value;
      const column = sheet.cols[c];
      const fmt = cell.fmt !== undefined ? cell.fmt : column && column.fmt !== undefined ? column.fmt : null;
      // A format the formatter does not know keeps the text the sheet was written with (plan 4.9).
      const custom = fmt !== null && !isBuiltin(fmt);
      const made = custom ? null : derive(content, fmt, cell.f !== undefined ? value : undefined);
      const own = {};
      if (cell.fmt !== undefined) own.fmt = cell.fmt;
      if (cell.colspan !== undefined) own.colspan = cell.colspan;
      if (cell.rowspan !== undefined) own.rowspan = cell.rowspan;
      if (cell.style !== undefined) {
        const style = canonStyle(cell.style);
        if (style !== undefined) own.style = style;
      }
      const next = custom
        ? (Object.keys(keptValues(cell)).length > 0 || Object.keys(own).length > 0 ? { ...keptValues(cell), ...own } : null)
        : made === null
          ? (Object.keys(own).length > 0 ? { text: "", ...own } : null)
          : { ...made, ...own };
      if (sameCell(cell, next)) return;
      row.cells[c] = next;
      repairs.push({ code: "cell_normal", row: r, col: c });
    });
  });
}

// Fixes every issue checkSheet reports. Returns { sheet, repairs }: a new sheet, and one entry per
// thing done, in the order done. Same input, same output, in every process.
export function normalizeSheet(sheet, { derive, hiddenText } = {}) {
  const model = clone(sheet);
  const repairs = [];
  clampSpans(model, repairs);
  plainHtml(model, repairs, new Set(Array.isArray(hiddenText) ? hiddenText.map((item) => item.row) : []));
  showHiddenText(model, hiddenText, repairs);
  brokenMerges(model, repairs);
  shortColumns(model, repairs);
  fixIds(model, repairs);
  fixOrder(model, "col", repairs);
  fixOrder(model, "row", repairs);
  fixFreeze(model, repairs);
  normalForm(model, derive, repairs);
  return { sheet: model, repairs };
}
