// The patch writer: sets ranges and appends rows in one canonical grid, rewriting
// only the rows it touches and the table start tag (which gains `stale`, since a
// host cannot format or recalculate). A table that is not canonical throws
// CodecMiss: the host answers 409 (decision A3).
//
// ops: [{ range: "B3", values: [[450]] } | { append: [["Porto", 12]] }]
// Values are typed input: null clears the content (fmt and style stay), a number
// or boolean is that value, a string starting with "=" is a formula, any other
// string is text (forced with `t` when the value rule would read it otherwise).

import { scanGrid } from "./scan.js";
import { rowHtml } from "./write.js";
import { parseRange, QueryRefused } from "./read.js";
import { shown, typed } from "./value.js";
import { isKey, keyBetween } from "./order-keys.js";

const GROUP_SIZE = 50;

function randomId() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
  return `r${Array.from(bytes, (b) => (b % 36).toString(36)).join("")}`;
}

function content(value) {
  if (value === null) return {};
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new QueryRefused("bad_value", `${value} is not a finite number`);
    return { text: shown(value), n: true };
  }
  if (typeof value === "boolean") return { text: shown(value) };
  if (typeof value !== "string") throw new QueryRefused("bad_value", "a value is a number, true, false, text or null");
  if (value.includes("\0")) throw new QueryRefused("bad_value", "text holds a NUL character");
  const text = value.replace(/\r\n?/g, "\n");
  if (text.startsWith("=")) return { text: "", f: text };
  return typed(text) === text || text === "" ? { text } : { text, t: true };
}

function setCell(old, value) {
  const cell = { text: "", ...content(value) };
  for (const key of ["fmt", "colspan", "rowspan", "style"]) if (old && old[key] !== undefined) cell[key] = old[key];
  return Object.keys(cell).length === 1 && cell.text === "" ? null : cell;
}

function checkGrid(values, what) {
  if (!Array.isArray(values) || values.length === 0 || !values.every((row) => Array.isArray(row))) {
    throw new QueryRefused("bad_patch", `${what} is a non-empty array of rows, each an array of values`);
  }
}

function readGrid(src) {
  const grid = { cols: [], rows: [], groups: [], startEnd: 0, table: null };
  grid.end = scanGrid(src, 0, {
    table: (table) => { grid.table = table; },
    col: (col) => grid.cols.push(col),
    row: (row, start, end) => grid.rows.push({ row, start, end }),
    group: (start, end, frozen) => grid.groups.push({ start, end, frozen, rows: 0 }),
  });
  grid.startEnd = src.indexOf(">") + 1;
  let row = 0;
  for (const group of grid.groups) {
    while (row < grid.rows.length && grid.rows[row].start < group.end) {
      group.rows++;
      row++;
    }
  }
  return grid;
}

function applyRange(grid, op, edited) {
  checkGrid(op.values, "values");
  const { r0, c0, r1, c1 } = parseRange(op.range);
  const height = op.values.length;
  const width = Math.max(...op.values.map((row) => row.length));
  const single = r0 === r1 && c0 === c1;
  if (!single && (height !== r1 - r0 + 1 || op.values.some((row) => row.length !== c1 - c0 + 1))) {
    throw new QueryRefused("bad_patch", `values must be ${r1 - r0 + 1} rows of ${c1 - c0 + 1} for range ${op.range}`);
  }
  if (r0 + height > grid.rows.length || c0 + width > grid.cols.length) {
    throw new QueryRefused("outside_sheet", `range ${op.range} reaches past the sheet's rows or columns; append new rows instead`);
  }
  let cells = 0;
  op.values.forEach((values, i) => {
    const index = r0 + i;
    const row = edited.get(index) ?? { ...grid.rows[index].row, cells: [...grid.rows[index].row.cells] };
    values.forEach((value, j) => {
      const col = c0 + j;
      const old = row.cells[col] ?? null;
      if (old && old.hidden) throw new QueryRefused("covered_cell", `range ${op.range} writes into a merged cell's covered position`);
      while (row.cells.length <= col) row.cells.push(null);
      row.cells[col] = setCell(old, value);
      cells++;
    });
    edited.set(index, row);
  });
  return cells;
}

function lastKey(grid, appended) {
  if (appended.length > 0) return appended[appended.length - 1].pos;
  for (let i = grid.rows.length - 1; i >= 0; i--) if (isKey(grid.rows[i].row.pos)) return grid.rows[i].row.pos;
  return null;
}

// Returns { bytes, changed: { cells, rows } }.
export function patchGrid(src, ops, { newId = randomId } = {}) {
  if (!Array.isArray(ops) || ops.length === 0) throw new QueryRefused("bad_patch", "patch is a non-empty list of operations");
  const grid = readGrid(src);
  const ids = new Set([...grid.rows.map(({ row }) => row.id), ...grid.cols.map((col) => col.id)]);
  const edited = new Map();
  const appended = [];
  let cells = 0;

  for (const op of ops) {
    if (op && typeof op.range === "string" && op.append === undefined) {
      cells += applyRange(grid, op, edited);
    } else if (op && op.append !== undefined && op.range === undefined) {
      checkGrid(op.append, "append");
      for (const values of op.append) {
        if (values.length > grid.cols.length) throw new QueryRefused("outside_sheet", "an appended row has more values than the sheet has columns");
        let id = newId();
        while (ids.has(id)) id = newId();
        ids.add(id);
        const row = { id, pos: keyBetween(lastKey(grid, appended), null), cells: values.map((value) => setCell(null, value)) };
        cells += row.cells.filter(Boolean).length;
        appended.push(row);
      }
    } else {
      throw new QueryRefused("bad_patch", "an operation is { range, values } or { append }");
    }
  }

  const edits = [];
  const { freezeCols } = grid.table;
  edits.push({ start: 0, end: grid.startEnd, bytes: `<table grid${freezeCols ? ` freeze-cols="${freezeCols}"` : ""} stale>` });
  for (const [index, row] of edited) edits.push({ start: grid.rows[index].start, end: grid.rows[index].end, bytes: rowHtml(row) });

  if (appended.length > 0) {
    const last = grid.groups[grid.groups.length - 1];
    let room = last && !last.frozen ? GROUP_SIZE - last.rows : 0;
    let at = last && !last.frozen ? last.end - "</tbody>".length : grid.end - "</table>".length;
    let rest = appended;
    if (room > 0) {
      edits.push({ start: at, end: at, bytes: rest.slice(0, room).map((row) => `${rowHtml(row)}\n`).join("") });
      rest = rest.slice(room);
    }
    at = grid.end - "</table>".length;
    let bytes = "";
    for (let i = 0; i < rest.length; i += GROUP_SIZE) {
      bytes += `<tbody>\n${rest.slice(i, i + GROUP_SIZE).map((row) => `${rowHtml(row)}\n`).join("")}</tbody>`;
    }
    if (bytes) edits.push({ start: at, end: at, bytes });
  }

  edits.sort((a, b) => a.start - b.start);
  let out = "";
  let from = 0;
  for (const edit of edits) {
    out += src.slice(from, edit.start) + edit.bytes;
    from = edit.end;
  }
  out += src.slice(from);
  return { bytes: out, changed: { cells, rows: appended.length } };
}
