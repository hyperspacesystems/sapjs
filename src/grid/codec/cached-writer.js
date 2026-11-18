// The sheet's saved bytes, written fast: `writer.table` gives the same bytes as `tableHtml`, and
// reuses the string of each tbody group whose rows nothing touched since the last write.
//
// The caller tells the writer what changed: `touch(sheetId, changes)` with the `changes` an
// applied action returns from `apply`, or a Grid's change event as it is, plus `results`, the
// cells whose formula results the engine changed. A row named there drops the group that holds it.
// A column change, a Grid event that read the whole table again, or `structure: true` with no row
// and column lists drops the whole tab, since it may move or reshape a cell in every row.
// `touch(sheetId)` with nothing else drops the tab too, as a caller does when it starts on a table
// the writer has not followed. A write the writer is not told about is reused stale, so every
// change to the model reaches `touch`, and a change of a shape the writer does not know throws.
// One writer follows one model: the Grid's mirror and the room's admitted copy each get their own.
// `touch(sheetId)` also forgets a deleted tab's strings.

import { groupHtml, rowHtml, tableParts } from "./write.js";

const KNOWN = ["rows", "cols", "cells", "results", "rescanned", "structure"];

// A formula cell with the result the engine holds for it, as `extras(sheetId, rowId, colId)`
// gives it: `{ text, v, n, t }`, the shown text, the value, and whether it is a number or a text
// that reads as one (an absent field is not written). A cell with no formula, or one a merge
// covers, has no result to write.
function withExtras(sheetId, row, cols, extras) {
  if (!extras) return row;
  let cells = null;
  row.cells.forEach((cell, c) => {
    if (!cell || cell.f === undefined || cell.hidden || cols[c] === undefined) return;
    const extra = extras(sheetId, row.id, cols[c].id);
    if (extra === undefined) return;
    cells ??= row.cells.slice();
    const next = { ...cell, text: extra.text };
    for (const key of ["v", "n", "t"]) {
      if (extra[key] === undefined || extra[key] === false) delete next[key];
      else next[key] = extra[key];
    }
    cells[c] = next;
  });
  return cells ? { ...row, cells } : row;
}

// `apply` lists row and column changes as records; a Grid event lists their ids as added,
// removed and changed.
const listed = (part) => (Array.isArray(part) ? part : [...(part?.added ?? []), ...(part?.removed ?? []), ...(part?.changed ?? [])]);
const rowOf = (entry) => (typeof entry === "string" ? entry : entry.row);

export function createSheetWriter({ groupSize = 50 } = {}) {
  tableParts({}, { groupSize });
  const tabs = new Map();

  const tabOf = (sheetId) => {
    let tab = tabs.get(sheetId);
    if (!tab) {
      tab = { groups: new Map(), groupOf: new Map(), extras: null };
      tabs.set(sheetId, tab);
    }
    return tab;
  };

  function dropRow(tab, rowId) {
    const key = tab.groupOf.get(rowId);
    if (key === undefined) return;
    tab.groups.delete(key);
    tab.groupOf.delete(rowId);
  }

  function touch(sheetId, changes) {
    if (changes && !KNOWN.some((key) => key in changes)) throw new TypeError("grid codec: touch takes apply's changes or a Grid change event");
    const tab = tabs.get(sheetId);
    if (!tab) return;
    const lists = changes && (changes.rows !== undefined || changes.cols !== undefined);
    if (!changes || changes.rescanned || (changes.structure && !lists) || listed(changes.cols).length > 0) {
      tabs.delete(sheetId);
      return;
    }
    for (const entry of listed(changes.rows)) dropRow(tab, rowOf(entry));
    for (const change of changes.cells ?? []) dropRow(tab, change.row);
    for (const change of changes.results ?? []) dropRow(tab, change.row);
  }

  function table(sheetId, sheet, extras = null) {
    // Groups written with other results (or with none) are not this write's: the caller passes the
    // same `extras` function each time, and another one writes the whole tab again.
    let tab = tabOf(sheetId);
    if (tab.extras !== extras) {
      tabs.delete(sheetId);
      tab = tabOf(sheetId);
      tab.extras = extras;
    }
    const cols = sheet.cols ?? [];
    const line = (row) => rowHtml(withExtras(sheetId, row, cols, extras));
    const { head, data, starts } = tableParts(sheet, { groupSize, line });
    let html = head;

    // A group is known by the ids of its rows. A table where an id repeats caches nothing, since
    // a change names the repeated row once and two groups could share one key.
    const distinct = new Set(data.map((row) => row.id)).size === data.length;
    const groups = new Map();
    const groupOf = new Map();
    for (let g = 0; g < starts.length; g++) {
      const group = data.slice(starts[g], starts[g + 1] ?? data.length);
      const key = group.map((row) => row.id).join("\n");
      let bytes = distinct ? tab.groups.get(key) : undefined;
      bytes ??= groupHtml(group, line);
      if (distinct) {
        groups.set(key, bytes);
        for (const row of group) groupOf.set(row.id, key);
      }
      html += bytes;
    }
    tab.groups = groups;
    tab.groupOf = groupOf;
    return `${html}</table>`;
  }

  return { table, touch };
}
