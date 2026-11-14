// Every structural problem in a sheet model, in a stable order: ids, then order
// keys, then row length, then merges, then freeze. Pure: the model in, a list out.

import { isKey } from "./codec/order-keys.js";

const ID = /^[A-Za-z0-9_-]{1,64}$/;

const text = (value) => (typeof value === "string" ? value : "");

// a is strictly after b by (pos, id), both compared as plain strings.
const after = (a, b) => a.pos > b.pos || (a.pos === b.pos && a.id > b.id);

function checkIds(sheet, issues) {
  const seen = new Set();
  const walk = (records, axis) => {
    records.forEach((record, index) => {
      const id = text(record.id);
      if (id === "") {
        issues.push({ code: `${axis}_id_missing`, [axis]: index });
        return;
      }
      if (!ID.test(id)) {
        issues.push({ code: `${axis}_id_invalid`, [axis]: index, id });
        return;
      }
      const duplicate = seen.has(id);
      seen.add(id);
      if (duplicate) issues.push({ code: `${axis}_id_duplicate`, [axis]: index, id });
    });
  };
  walk(sheet.cols, "col");
  walk(sheet.rows, "row");
}

function checkOrder(records, axis, issues) {
  let last = null;
  records.forEach((record, index) => {
    if (!isKey(record.pos)) {
      issues.push({ code: `${axis}_pos_invalid`, [axis]: index });
      return;
    }
    const here = { pos: record.pos, id: text(record.id) };
    if (last !== null && !after(here, last)) issues.push({ code: `${axis}_pos_order`, [axis]: index });
    last = here;
  });
}

const span = (cell, key) => {
  const value = cell[key];
  return typeof value === "number" && value > 1 ? value : 1;
};

// The HTML limits on a span: a browser draws no table wider or taller than these, so a span past
// them is reported once and then read as the limit, and every walk over it costs at most the sheet.
const MAX_COLS = 1000;
const MAX_ROWS = 65534;

function checkMerges(sheet, issues) {
  const rows = sheet.rows.length;
  const cols = sheet.cols.length;
  const key = (r, c) => `${r},${c}`;
  const spans = new Map();
  const covered = new Map();
  for (let r = 0; r < rows; r++) {
    const cells = sheet.rows[r].cells;
    for (let c = 0; c < cells.length; c++) {
      const cell = cells[c];
      if (!cell) continue;
      const cs = Math.min(span(cell, "colspan"), MAX_COLS);
      const rs = Math.min(span(cell, "rowspan"), MAX_ROWS);
      if (cs === 1 && rs === 1) continue;
      if (span(cell, "colspan") > MAX_COLS || span(cell, "rowspan") > MAX_ROWS) {
        issues.push({ code: "span_too_big", row: r, col: c });
      }
      spans.set(key(r, c), { cs, rs });
      const down = Math.min(rs, rows - r);
      const across = Math.min(cs, cols - c);
      for (let i = 0; i < down; i++) {
        for (let j = 0; j < across; j++) {
          const at = key(r + i, c + j);
          covered.set(at, (covered.get(at) ?? 0) + 1);
        }
      }
    }
  }
  for (let r = 0; r < rows; r++) {
    const cells = sheet.rows[r].cells;
    for (let c = 0; c < Math.max(cells.length, cols); c++) {
      const cell = cells[c] ?? null;
      const at = key(r, c);
      const own = spans.get(at);
      if (own && (c + own.cs > cols || r + own.rs > rows)) issues.push({ code: "merge_past_end", row: r, col: c });
      const hits = covered.get(at) ?? 0;
      const hidden = Boolean(cell && cell.hidden);
      if (hits > 1) {
        issues.push({ code: "merge_overlap", row: r, col: c });
      } else if (!own && hits > 0 && !hidden) {
        issues.push({ code: "merge_uncovered", row: r, col: c });
      } else if (hidden && hits === 0) {
        issues.push({ code: "hidden_orphan", row: r, col: c });
      }
    }
  }
}

function checkFreeze(sheet, issues) {
  let bad = typeof sheet.freezeCols === "number" && sheet.freezeCols > sheet.cols.length;
  let unfrozen = false;
  for (const row of sheet.rows) {
    if (row.frozen) {
      if (unfrozen) {
        bad = true;
        break;
      }
    } else unfrozen = true;
  }
  if (bad) issues.push({ code: "freeze_range" });
}

// Each issue is { code, row?, col?, id? }: row and col are 0-based indexes into
// sheet.rows and sheet.cols (or the cell's position), id is the offending id when
// there is one. An empty array means the sheet is clean.
export function checkSheet(sheet) {
  const issues = [];
  checkIds(sheet, issues);
  checkOrder(sheet.cols, "col", issues);
  checkOrder(sheet.rows, "row", issues);
  sheet.rows.forEach((row, index) => {
    if (row.cells.length > sheet.cols.length) issues.push({ code: "row_too_long", row: index });
  });
  checkMerges(sheet, issues);
  checkFreeze(sheet, issues);
  return issues;
}
