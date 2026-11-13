// The tree route: a table a real HTML parser built (from a hand-edited file, or a
// browser's live DOM) back to the model and to canonical bytes. Markup inside a
// cell is reduced to its text; cell text is never trimmed.
//
// An adapter hides the tree library:
//   { name(node) -> lowercase tag name, attr(node, name) -> string | null,
//     children(node) -> element children, text(node) -> text content }

import { tableHtml } from "./write.js";

const MAX_COUNT = 9999999;

export const domAdapter = {
  name: (node) => node.localName,
  attr: (node, name) => node.getAttribute(name),
  children: (node) => Array.from(node.children),
  text: (node) => node.textContent,
};

const has = (adapter, node, name) => adapter.attr(node, name) !== null;

const cleanText = (text) => text.replace(/\r\n?/g, "\n").replace(/\0/g, "");

function count(value, min) {
  if (value === null || !/^[0-9]{1,7}$/.test(value.trim())) return undefined;
  const n = Number(value.trim());
  return n >= min && n <= MAX_COUNT ? n : undefined;
}

function cellModel(adapter, td) {
  const cell = { text: cleanText(adapter.text(td)) };
  let bare = true;
  const set = (key, value) => {
    if (value === undefined || value === null || value === false) return;
    cell[key] = value;
    bare = false;
  };
  set("n", has(adapter, td, "n"));
  set("t", has(adapter, td, "t"));
  for (const key of ["f", "v", "fmt"]) {
    const value = adapter.attr(td, key);
    set(key, value === null ? undefined : cleanText(value));
  }
  set("colspan", count(adapter.attr(td, "colspan"), 2));
  set("rowspan", count(adapter.attr(td, "rowspan"), 2));
  if (has(adapter, td, "hidden")) {
    set("hidden", true);
    cell.text = "";
  }
  const style = adapter.attr(td, "style");
  set("style", style === null ? undefined : cleanText(style));
  return bare && cell.text === "" ? null : cell;
}

function rowModel(adapter, tr, frozen) {
  const row = { id: cleanText(adapter.attr(tr, "data-id") ?? ""), pos: cleanText(adapter.attr(tr, "data-pos") ?? "") };
  if (frozen) row.frozen = true;
  const style = adapter.attr(tr, "style");
  if (style !== null) row.style = cleanText(style);
  row.cells = adapter.children(tr)
    .filter((node) => adapter.name(node) === "td" || adapter.name(node) === "th")
    .map((td) => cellModel(adapter, td));
  return row;
}

function colModel(adapter, node) {
  const col = { id: cleanText(adapter.attr(node, "data-id") ?? ""), pos: cleanText(adapter.attr(node, "data-pos") ?? "") };
  const fmt = adapter.attr(node, "fmt");
  if (fmt !== null) col.fmt = cleanText(fmt);
  const width = /width:\s*([0-9]{1,7})px/.exec(adapter.attr(node, "style") ?? "");
  if (width) col.width = Number(width[1]);
  return col;
}

// The model of a parsed table, as GRAMMAR.md's model.
export function treeModel(adapter, table) {
  const sheet = { cols: [], rows: [] };
  const freezeCols = count(adapter.attr(table, "freeze-cols"), 1);
  if (freezeCols !== undefined) sheet.freezeCols = freezeCols;
  if (has(adapter, table, "stale")) sheet.stale = true;
  const frozen = [];
  const data = [];
  for (const part of adapter.children(table)) {
    const name = adapter.name(part);
    if (name === "colgroup") {
      for (const col of adapter.children(part)) if (adapter.name(col) === "col") sheet.cols.push(colModel(adapter, col));
    } else if (name === "col") {
      sheet.cols.push(colModel(adapter, part));
    } else if (name === "thead" || name === "tbody" || name === "tfoot") {
      const into = name === "thead" ? frozen : data;
      for (const tr of adapter.children(part)) if (adapter.name(tr) === "tr") into.push(rowModel(adapter, tr, name === "thead"));
    } else if (name === "tr") {
      data.push(rowModel(adapter, part, false));
    }
  }
  sheet.rows = [...frozen, ...data];
  return sheet;
}

// Any parsed table as canonical bytes.
export function canonicalGrid(adapter, table, options) {
  return tableHtml(treeModel(adapter, table), options);
}
