// The sheet's room codec: the 24 members of the live room's codec contract
// (clayjs src/live-room/codec.js) over a workbook model. The protocol core reads docs and
// actions only through these members; every replica (the room on the host, a tab's admitted copy,
// a test) applies the same actions through the same `applyWorkbook`, so they write the same bytes.
//
// A doc is plain data: { tabs: [{ id, name, pos, sheet }] } in tab order, each `sheet` a grid
// model with no `stale` mark (the mark is worked out when the bytes are written). Ids are strings:
//   S          a tab                         S/R        a row record
//   S//C       a column record               S/R/C      a cell that exists and no merge covers
//   S#...      a place a tab action needs    S/R#flat   a row a sort may move
// where S is the tab id with encodeURIComponent, so it holds no "/" or "#".
//
// The core decides an edit was saved when the file has what it needs (law C8), so this codec
// refuses an action only when something it needs is missing or something it creates exists.
// A revert (an undo in a room) is never refused for a value: a field a coworker changed since, or a
// cell that would land in a record they deleted, is left as it is, and `apply` names it in `skipped`.

import { applyWorkbook, frameOf, tabProblem } from "./workbook.js";
import { byPos, modelWorkbook } from "./workbook-backing.js";
import { boxesApart, clearedBetween, cutsFrozen, mergeBoxes, needs as needsOf, creates as createsOf, orderedCols, orderedRows, ruleRefusal, targets as targetsOf, validate as validateOne } from "./ops.js";
import { scanGrid } from "./codec/scan.js";
import { createSheetWriter } from "./codec/cached-writer.js";
import { chartsHtml, drawingProblem } from "./codec/charts.js";
import { byRule, copyRule } from "./codec/rules.js";
import { gridModel } from "./codec/read.js";
import { fnv1a, hex } from "./codec/digest.js";
import { effectiveFmt, waitsForFormatter, contentOf } from "./content.js";
import { createEngine } from "./formula/engine.js";
import { fromIds, meaning, print, shiftRows } from "./formula/text.js";
import { isKey } from "./codec/order-keys.js";

export const ROOM_CODEC_NAME = "sheet";
export const ROOM_CODEC_VERSION = 1;

// One operation per target, or per this many bytes of the action, whichever is more: 128
// operations then stay under 63 KiB on the wire even when every byte of a part is escaped once
// more inside its frame, with room for the part's saw and reviewed saw (one short digest each).
export const OP_BYTES = 224;
const UNSEEN_CAP = 500;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const TAB_KINDS = new Set(["insertSheet", "deleteSheet", "renameSheet", "moveSheet"]);
const TAB_FIELDS = { insertSheet: ["v", "t", "sheet"], deleteSheet: ["v", "t", "sheet"], renameSheet: ["v", "t", "sheet", "name"], moveSheet: ["v", "t", "sheet", "pos"] };
const NULL_REVERT = Object.freeze({ v: 1, t: "revert", of: null, step: null, wrote: [] });

// UTF-8 bytes of text, counted without TextEncoder, which some test environments (jsdom) lack. A
// lone surrogate counts as U+FFFD (3 bytes), as in TextEncoder.
function utf8(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i += 1;
    } else n += 3;
  }
  return n;
}
const fp = (text) => hex(fnv1a(text));

// ---------------------------------------------------------------------------------------------
// Ids

const esc = (sheet) => encodeURIComponent(sheet);
const tabId = (s) => esc(s);
const rowId = (s, r) => `${esc(s)}/${r}`;
const colId = (s, c) => `${esc(s)}//${c}`;
const cellId = (s, r, c) => `${esc(s)}/${r}/${c}`;
const ruleId = (s, id) => `${esc(s)}#rule:${id}`;

export function parseId(id) {
  const hash = id.indexOf("#");
  const base = hash < 0 ? id : id.slice(0, hash);
  const extra = hash < 0 ? null : id.slice(hash + 1);
  const [s, r, c] = base.split("/");
  return { sheet: decodeURIComponent(s), row: r === undefined || r === "" ? null : r, col: c === undefined || c === "" ? null : c, extra };
}

// ---------------------------------------------------------------------------------------------
// The doc

const tabIn = (doc, id) => doc.tabs.find((tab) => tab.id === id) ?? null;
// Row and column indexes per sheet. `apply` never changes a room doc's sheet in place, but
// `docOf` hands `seen` a page's live sheets, which a row insert, delete or move changes in place, so
// a lookup that finds another id at the cached place, or misses on a sheet whose length changed,
// makes the index again.
const indexes = new WeakMap();
function indexOf(sheet) {
  let index = indexes.get(sheet);
  if (!index) indexes.set(sheet, (index = { rows: new Map(sheet.rows.map((row, i) => [row.id, i])), cols: new Map(sheet.cols.map((col, i) => [col.id, i])) }));
  return index;
}
function lookup(sheet, axis, id) {
  const at = indexOf(sheet)[axis].get(id);
  const stale = at === undefined ? indexOf(sheet)[axis].size !== sheet[axis].length : sheet[axis][at]?.id !== id;
  if (!stale) return at ?? -1;
  indexes.delete(sheet);
  return indexOf(sheet)[axis].get(id) ?? -1;
}
const rowAt = (sheet, id) => lookup(sheet, "rows", id);
const colAt = (sheet, id) => lookup(sheet, "cols", id);

// The doc as a workbook backing; the backing copies each sheet, so a refused step leaves the
// doc as it was.
const workbookOf = (doc) => modelWorkbook(doc.tabs);

function take(doc, wb) {
  const tabs = wb.sheets().map((tab) => {
    const sheet = tab.backing.sheet;
    delete sheet.stale;
    return { id: tab.id, name: tab.name, pos: tab.pos, sheet };
  });
  doc.tabs.splice(0, doc.tabs.length, ...tabs);
}

// The doc a tab's workbook shows, without a copy: for `seen` on the author's view.
export const docOf = (wb) => ({ tabs: wb.sheets().map((tab) => ({ id: tab.id, name: tab.name, pos: tab.pos, sheet: tab.backing.sheet })) });

const frameOfDoc = (doc) => frameOf(modelWorkbookView(doc));
// A read-only workbook over the doc's sheets, for frames: no copy.
const modelWorkbookView = (doc) => ({ sheets: () => doc.tabs.map((tab) => ({ id: tab.id, name: tab.name, pos: tab.pos, backing: { rows: () => tab.sheet.rows, cols: () => tab.sheet.cols } })) });

// ---------------------------------------------------------------------------------------------
// Bytes: the [sheet-workbook] region's inner HTML

// Escaped as a page's own serializer escapes (the HTML fragment serialization algorithm), so a file
// the room writes and one a page saves spell a tab the same way.
const textEscape = (value) => String(value).replace(/&/g, "&amp;").replace(/\u00a0/g, "&nbsp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const attrEscape = (value) => String(value).replace(/&/g, "&amp;").replace(/\u00a0/g, "&nbsp;").replace(/"/g, "&quot;");
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', nbsp: "\u00a0", apos: "'" };
const decode = (text) =>
  text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (match, name) => {
    if (name[0] === "#") return String.fromCodePoint(/^#x/i.test(name) ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
    if (ENTITIES[name] === undefined) throw new Error(`sheet codec: unknown character reference ${match}`);
    return ENTITIES[name];
  });

// The stale mark is not kept in a doc: a tab is written stale when it holds a formula whose
// result nobody gave for these bytes (no `extras`, or none for that cell), or a value or result
// waiting for a formatter that is not loaded.
function staleOf(tab, extras) {
  const { sheet } = tab;
  for (const row of sheet.rows) {
    for (let c = 0; c < row.cells.length; c++) {
      const cell = row.cells[c];
      if (!cell || cell.hidden) continue;
      const fmt = effectiveFmt(cell, sheet.cols[c]);
      if (cell.f !== undefined) {
        const extra = extras ? extras(tab.id, row.id, sheet.cols[c]?.id) : undefined;
        if (extra === undefined || waitsForFormatter({ ...cell, ...extra }, fmt)) return true;
      } else if (waitsForFormatter(cell, fmt)) return true;
    }
  }
  return false;
}

// One cached writer per doc, for writes without results: `apply` tells it what each step
// changed (`touchWriter`). A write with `extras` uses a fresh writer, since results change without
// a step (a volatile function, a function that loads late) and nothing would tell the cache.
const writers = new WeakMap();
const writerOf = (doc) => {
  let writer = writers.get(doc);
  if (!writer) writers.set(doc, (writer = createSheetWriter()));
  return writer;
};

function touchWriter(doc, changed) {
  const writer = writers.get(doc);
  if (!writer) return;
  const drop = new Set([...changed.sheets, ...(changed.sorted ?? []), ...changed.table.map((one) => one.sheet)]);
  const parts = new Map();
  for (const key of ["rows", "cols", "cells", "results"]) {
    for (const item of changed[key] ?? []) {
      if (!parts.has(item.sheet)) parts.set(item.sheet, { rows: [], cols: [], cells: [], results: [], structure: changed.structure });
      parts.get(item.sheet)[key].push(item);
    }
  }
  for (const id of drop) writer.touch(id);
  for (const [id, part] of parts) if (!drop.has(id)) writer.touch(id, part);
}

// `extras` is the results function, or `{ result, drawing }`: `drawing(tabId, chartId)` gives the
// last drawing of a chart, which the doc never holds, so a write without one writes no figure for it.
function write(doc, record, extras = null) {
  const result = typeof extras === "function" ? extras : typeof extras?.result === "function" ? extras.result : null;
  const drawing = typeof extras?.drawing === "function" ? extras.drawing : () => undefined;
  const writer = result ? createSheetWriter() : writerOf(doc);
  let out = "";
  for (const tab of doc.tabs) {
    const sheet = staleOf(tab, result) ? { ...tab.sheet, stale: true } : tab.sheet;
    out += `<section item="" data-id="${attrEscape(tab.id)}" data-pos="${attrEscape(tab.pos)}"><h2 bind="name">${textEscape(tab.name)}</h2>${writer.table(tab.id, sheet, result)}${chartsHtml(sheet.rules, (id) => drawing(tab.id, id))}</section>\n`;
  }
  return `${out}<script type="application/json" sheet-commit="">${JSON.stringify(record ?? {}).replaceAll("<", "\\u003c")}</script>`;
}

// A start tag at `i`: its name, its attributes (a bare attribute reads as ""), and where it ends.
function startTag(src, i) {
  const open = /<([a-zA-Z][a-zA-Z0-9-]*)/y;
  open.lastIndex = i;
  const name = open.exec(src);
  if (!name) return null;
  const attrs = new Map();
  const attr = /\s+([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/y;
  let at = open.lastIndex;
  for (;;) {
    attr.lastIndex = at;
    const m = attr.exec(src);
    if (!m) break;
    attrs.set(m[1].toLowerCase(), decode(m[2] ?? m[3] ?? m[4] ?? ""));
    at = attr.lastIndex;
  }
  const close = /\s*\/?>/y;
  close.lastIndex = at;
  if (!close.exec(src)) return null;
  return { name: name[1].toLowerCase(), attrs, end: close.lastIndex };
}

// Past white space and comments, which a page may hold anywhere between the region's tags.
function space(src, i) {
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (!src.startsWith("<!--", i)) return i;
    const end = src.indexOf("-->", i + 4);
    if (end < 0) throw new Error("sheet codec: an open comment in the workbook");
    i = end + 3;
  }
}

function read(bytes) {
  const src = String(bytes);
  const tabs = [];
  let record;
  let commits = 0;
  let i = space(src, 0);
  while (i < src.length) {
    const tag = startTag(src, i);
    if (tag?.name === "section" && tag.attrs.has("item")) {
      const id = tag.attrs.get("data-id");
      if (!id) throw new Error("sheet codec: a tab with no data-id");
      if (tabs.some((tab) => tab.id === id)) throw new Error(`sheet codec: two tabs are ${JSON.stringify(id)}`);
      let at = space(src, tag.end);
      const title = startTag(src, at);
      if (title?.name !== "h2" || title.attrs.get("bind") !== "name") throw new Error(`sheet codec: tab ${JSON.stringify(id)} has no <h2 bind="name"> first`);
      const close = src.indexOf("</h2>", title.end);
      const raw = close < 0 ? null : src.slice(title.end, close);
      if (raw === null || raw.includes("<")) throw new Error(`sheet codec: tab ${JSON.stringify(id)} has a name that is not plain text`);
      at = space(src, close + 5);
      const sheet = { cols: [], rows: [] };
      try {
        at = scanGrid(src, at, { table: (table) => Object.assign(sheet, table), col: (col) => sheet.cols.push(col), row: (row) => sheet.rows.push(row), rule: (rule) => (sheet.rules ??= []).push(rule) });
      } catch (error) {
        throw new Error(`sheet codec: tab ${JSON.stringify(id)}: ${error.message}`);
      }
      delete sheet.stale;
      const rulesProblem = roomRulesProblem(sheet.rules);
      if (rulesProblem !== null) throw new Error(`sheet codec: tab ${JSON.stringify(id)}: ${rulesProblem}`);
      at = space(src, at);
      // A chart's drawing after the table is the app's output, not the room's: it is passed over.
      for (let figure = startTag(src, at); figure?.name === "figure" && figure.attrs.has("chart"); figure = startTag(src, at)) {
        const close = src.indexOf("</figure>", figure.end);
        if (close < 0) throw new Error(`sheet codec: tab ${JSON.stringify(id)} has a chart drawing that does not end`);
        if (src.slice(at, figure.end) !== `<figure chart="${attrEscape(figure.attrs.get("chart"))}" sap-ignore="">`) {
          throw new Error(`sheet codec: tab ${JSON.stringify(id)} has a chart drawing whose figure is not <figure chart="ID" sap-ignore="">`);
        }
        const problem = drawingProblem(src.slice(figure.end, close));
        if (problem !== null) throw new Error(`sheet codec: tab ${JSON.stringify(id)} has a chart drawing the codec does not read: ${problem}`);
        at = space(src, close + 9);
      }
      if (!src.startsWith("</section>", at)) throw new Error(`sheet codec: tab ${JSON.stringify(id)} holds more than its name, its table and its charts' drawings`);
      tabs.push({ id, name: decode(raw), pos: tag.attrs.get("data-pos") ?? "", sheet });
      i = space(src, at + 10);
      continue;
    }
    if (tag?.name === "script" && tag.attrs.has("sheet-commit")) {
      const close = src.indexOf("</script>", tag.end);
      if (close < 0) throw new Error("sheet codec: an open commit record");
      record = JSON.parse(src.slice(tag.end, close));
      commits += 1;
      i = space(src, close + 9);
      continue;
    }
    throw new Error(`sheet codec: unexpected content at ${i} in the workbook`);
  }
  if (commits !== 1) throw new Error(commits === 0 ? "sheet codec: the workbook has no commit record" : "sheet codec: the workbook has two commit records");
  if (tabs.length === 0) throw new Error("sheet codec: the workbook has no tab");
  tabs.sort(byPos);
  return { record, doc: { tabs } };
}

// The drawings a workbook's bytes hold, as `write`'s `extras.drawing` takes them: a writer that
// replaces these bytes keeps each chart's last drawing. It reads only tab starts and figures, so
// bytes with no commit record yet, or a tab the codec would refuse, still give their drawings; a
// drawing the codec would refuse is left out.
export function drawingsIn(bytes) {
  const src = String(bytes);
  const found = new Map();
  let tab = null;
  for (const m of src.matchAll(/<section\b[^>]*?\sdata-id="([^"]*)"[^>]*>|<figure chart="([^"]*)" sap-ignore="">/g)) {
    if (m[1] !== undefined) {
      tab = decode(m[1]);
      continue;
    }
    const close = src.indexOf("</figure>", m.index + m[0].length);
    if (tab === null || close < 0) continue;
    const html = src.slice(m.index + m[0].length, close);
    const key = `${tab}\u0000${decode(m[2])}`;
    if (drawingProblem(html) === null && !found.has(key)) found.set(key, html);
  }
  return (tab, chart) => found.get(`${tab}\u0000${chart}`);
}

// ---------------------------------------------------------------------------------------------
// Cells, fingerprints and the meaning of a formula

function cellOf(doc, s, r, c) {
  const tab = tabIn(doc, s);
  if (!tab) return { missing: true };
  const at = rowAt(tab.sheet, r);
  const col = colAt(tab.sheet, c);
  if (at < 0 || col < 0) return { missing: true };
  return { cell: tab.sheet.rows[at].cells[col] ?? null, col: tab.sheet.cols[col], tab };
}

// What a cell holds, as one string that does not change when a coworker's insert or delete
// reprints a formula: the value, or the formula's meaning in ids.
function contentKey(doc, frame, s, cell) {
  if (!cell) return "";
  if (cell.hidden) return "hidden";
  if (cell.f !== undefined) return `=${meaning(cell.f, s, frame)}`;
  return JSON.stringify(contentOf(cell));
}

function cellPrint(doc, frame, s, cell) {
  if (!cell) return fp("");
  if (cell.hidden) return fp("hidden");
  return fp([contentKey(doc, frame, s, cell), cell.fmt ?? "", cell.style ?? "", cell.colspan ?? 1, cell.rowspan ?? 1].join("\u0000"));
}

const rowPrint = (row) => fp([row.pos, row.style ?? "", row.frozen ? 1 : 0, row.hidden ? 1 : 0].join("\u0000"));
const colPrint = (col) => fp([col.pos, col.width ?? "", col.fmt ?? "", col.hidden ? 1 : 0].join("\u0000"));

// A rule's fingerprint: its saved fields as written, and its tab's rows and columns in order. A rule
// covers places, so any coworker change to which records sit where (an insert, a delete, a sort or a
// move) changes it, and an undo that would put a rule back by A1 text is skipped and named.
const rulePrint = (sheet, rule) =>
  fp([rule ? JSON.stringify(copyRule(rule)) : "~none", sheet.rows.map((row) => row.id).join(","), sheet.cols.map((col) => col.id).join(",")].join("\u0000"));

// One target's value as a fingerprint: what `seen` records and `conflicts` compares.
function targetPrint(doc, frame, target) {
  const { sheet: s, row: r, col: c, extra } = parseId(target);
  const tab = tabIn(doc, s);
  if (!tab) return fp("~gone");
  if (r !== null && c !== null) {
    const found = cellOf(doc, s, r, c);
    if (found.missing) return fp("~gone");
    const cell = found.cell;
    if (extra === null) return fp(contentKey(doc, frame, s, cell));
    if (extra === "fmt") return fp(cell?.fmt ?? "");
    if (extra === "style") return fp(cell?.style ?? "");
    return fp(`${cell?.colspan ?? 1}/${cell?.rowspan ?? 1}`);
  }
  if (r !== null) {
    const row = tab.sheet.rows[rowAt(tab.sheet, r)];
    return row ? fp(`${extra}:${row[KIND_OF[extra] ?? extra] ?? ""}`) : fp("~gone");
  }
  if (c !== null) {
    const col = tab.sheet.cols[colAt(tab.sheet, c)];
    return col ? fp(`${extra}:${col[extra] ?? ""}`) : fp("~gone");
  }
  if (extra !== null && extra.startsWith("rule:")) {
    const found = (tab.sheet.rules ?? []).find((one) => one.id === extra.slice(5)) ?? null;
    return rulePrint(tab.sheet, found);
  }
  if (extra === "name") return fp(tab.name);
  if (extra === "pos") return fp(tab.pos);
  return WROTE_KINDS[extra === "freezeCols" ? "freeze:cols" : "freeze:rows"](tab);
}

// ---------------------------------------------------------------------------------------------
// Actions: shapes

const text = (value) => typeof value === "string";
function cleanRuleId(value) {
  if (typeof value !== "string" || value === "" || value.includes("\0") || value.includes("\r")) return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && (value.charCodeAt(i + 1) & 0xfc00) === 0xdc00) i += 1;
    else if (c >= 0xd800 && c <= 0xdfff) return false;
  }
  return true;
}
const isRef = (ref) =>
  ref === null ||
  (Array.isArray(ref) && ((ref.length === 2 && ref[0] === "~" && text(ref[1])) || (ref.length === 5 && text(ref[0]) && ref.slice(1).every((id) => id === null || id === 0 || (text(id) && ID.test(id))))));

// A set's formula content may carry `refs`, the ids its author bound it to: the reducer takes
// { f, r? }, so `refs` is checked here and left out before the reducer's own check.
function withoutRefs(action) {
  if (action.t === "batch") return { ...action, actions: action.actions.map(withoutRefs) };
  if (action.t !== "set" || !Array.isArray(action.cells)) return action;
  return {
    ...action,
    cells: action.cells.map((entry) => {
      const content = Array.isArray(entry) ? entry[2] : undefined;
      if (!content || typeof content !== "object" || !("refs" in content)) return entry;
      const { refs, ...rest } = content;
      if (!Array.isArray(refs) || !refs.every(isRef) || typeof rest.f !== "string" || fromIds(rest.f, refs) === null) throw new Error("bad refs");
      return [entry[0], entry[1], rest, ...entry.slice(3)];
    }),
  };
}

function validSort(action) {
  for (const key of Object.keys(action)) if (!["v", "t", "sheet", "rows", "cols", "pos"].includes(key)) return false;
  if (!text(action.sheet) || action.sheet === "") return false;
  const ids = (list) => Array.isArray(list) && list.length > 0 && list.every((id) => text(id) && ID.test(id)) && new Set(list).size === list.length;
  if (!ids(action.rows)) return false;
  if (action.cols !== null && !ids(action.cols)) return false;
  if (action.pos !== undefined && (action.cols !== null || !Array.isArray(action.pos) || action.pos.length !== action.rows.length || !action.pos.every(isKey))) return false;
  return true;
}

// A restore entry, in one of the three shapes `rewriteAll` writes (workbook.js): a formula of a
// deleted record [s, r, c, f, ids | null | slots, null], a whole-text restore [s, r, c, f, ids,
// { ids }], or a slot restore [s, r, c, f, slots, keys].
const isSlots = (slots) =>
  slots !== null && typeof slots === "object" && !Array.isArray(slots) && text(slots.skeleton) && text(slots.src) &&
  Array.isArray(slots.keys) && slots.keys.every(text) && Array.isArray(slots.nodes) && slots.nodes.length === slots.keys.length &&
  Array.isArray(slots.refs) && slots.refs.length === slots.keys.length;
const isIds = (ids) => Array.isArray(ids) && ids.every(isRef);
function validRestore(entry) {
  if (!Array.isArray(entry) || entry.length !== 6 || !entry.slice(0, 4).every(text) || !entry[3].startsWith("=")) return false;
  const [, , , , refs, guard] = entry;
  if (guard === null) return refs === null || isIds(refs) || isSlots(refs);
  if (Array.isArray(guard)) return guard.every(text) && isSlots(refs);
  return typeof guard === "object" && Object.keys(guard).length === 1 && isIds(guard.ids) && isIds(refs);
}

// A rule restore entry, as `settleRules` writes it (workbook.js): [sheet, id, back, left], each of
// back and left null or a whole rule with that id that a rules action could write.
const validRuleRestore = (entry) =>
  Array.isArray(entry) && entry.length === 4 && text(entry[0]) && text(entry[1]) &&
  entry.slice(2).every((rule) => rule === null || (rule !== null && typeof rule === "object" && rule.id === entry[1] && ruleRefusal(rule) === null));

const isWrote = (entry) => {
  if (!Array.isArray(entry) || entry.length !== 5 || !text(entry[0]) || !text(entry[4])) return false;
  const [, r, c, kind] = entry;
  const has = (id, want) => (want ? text(id) && ID.test(id) : id === null);
  if (kind === "cell") return has(r, true) && has(c, true);
  if (text(kind) && kind.startsWith("rule:")) return cleanRuleId(kind.slice(5)) && has(r, false) && has(c, false);
  if (kind === "sort:row" || (text(kind) && kind.startsWith("row:"))) return kind in WROTE_KINDS || kind === "sort:row" ? has(r, true) && has(c, false) : false;
  if (!(kind in WROTE_KINDS)) return false;
  return kind.startsWith("col:") ? has(r, false) && has(c, true) : has(r, false) && has(c, false);
};

function validRevert(action) {
  for (const key of Object.keys(action)) if (!["v", "t", "of", "step", "wrote"].includes(key)) return false;
  if (action.of !== null && !text(action.of)) return false;
  if (!Array.isArray(action.wrote) || !action.wrote.every(isWrote)) return false;
  if (action.step === null) return action.wrote.length === 0;
  const { step } = action;
  if (!step || typeof step !== "object" || Object.keys(step).some((key) => key !== "action" && key !== "restore" && key !== "rules")) return false;
  if (!Array.isArray(step.restore) || !step.restore.every(validRestore)) return false;
  if (step.rules !== undefined && !(Array.isArray(step.rules) && step.rules.every(validRuleRestore))) return false;
  return step.action?.t !== "revert" && validate(step.action);
}

// Rules a room keeps: each one a rules action could write, no id twice. A room's doc holds
// only such rules (`read` refuses others), so an inserted tab must too; a page's own undo of a tab
// delete does not go through here.
function roomRulesProblem(rules) {
  const seen = new Set();
  let prev = null;
  for (const rule of rules ?? []) {
    const problem = ruleRefusal(rule);
    if (problem !== null) return problem;
    if (seen.has(rule.id)) return `two rules are ${JSON.stringify(rule.id)}`;
    if (prev !== null && byRule(prev, rule) >= 0) return `rules out of order at ${JSON.stringify(rule.id)}`;
    seen.add(rule.id);
    prev = rule;
  }
  return null;
}

function insertedRules(action) {
  try {
    return gridModel(action.sheet.html, 0).rules ?? [];
  } catch {
    return [];
  }
}

function validate(action) {
  if (!action || typeof action !== "object" || Array.isArray(action) || action.v !== 1) return false;
  try {
    if (action.t === "revert") return validRevert(action);
    if (action.t === "sort") return validSort(action);
    if (TAB_KINDS.has(action.t)) return Object.keys(action).every((key) => TAB_FIELDS[action.t].includes(key)) && tabProblem(action) === null && (action.t !== "insertSheet" || roomRulesProblem(insertedRules(action)) === null);
    validateOne(withoutRefs(action));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Actions: ids

const sheetOf = (action) => (action.t === "batch" ? action.actions[0]?.sheet : action.t === "insertSheet" ? action.sheet.id : action.sheet);
const uniq = (list) => [...new Set(list)];

function reducerTargets(action) {
  return uniq(
    targetsOf(withoutRefs(action)).map(([s, a, b, field]) => {
      if (a === "row") return field === "exists" ? rowId(s, b) : `${rowId(s, b)}#${field}`;
      if (a === "col") return field === "exists" ? colId(s, b) : `${colId(s, b)}#${field}`;
      if (a === "table") return `${tabId(s)}#${field}`;
      if (a === "rule") return ruleId(s, b);
      if (field === "content") return cellId(s, a, b);
      return `${cellId(s, a, b)}#${field.startsWith("style") ? "style" : field}`;
    }),
  );
}

// The cells a set or a format writes whose row and column are there before it: each must not be
// a merge's covered position. A batch that merges, unmerges or moves records names none (a cell
// it writes may be covered before it and free after an earlier part of it).
function cellPlaces(action) {
  if (action.t === "batch") {
    if (action.actions.some((one) => one.t !== "set" && one.t !== "format")) return [];
    if (action.actions.some((one) => (one.rows?.length ?? 0) > 0 || (one.cols?.length ?? 0) > 0)) return [];
    return uniq(action.actions.flatMap(cellPlaces));
  }
  if (action.t !== "set" && action.t !== "format") return [];
  const made = createsOf(action);
  return action.cells.filter(([r, c]) => !made.rows.includes(r) && !made.cols.includes(c)).map(([r, c]) => cellId(action.sheet, r, c));
}

const mergePlace = (action) =>
  `${tabId(action.sheet)}#merge:${action.from[0]}/${action.from[1]}:${action.to[0]}/${action.to[1]}:${fp((action.clears ?? []).map((pair) => pair.join("/")).sort().join(","))}`;

function places(action) {
  if (action.t === "merge") return [mergePlace(action)];
  if (action.t === "freeze" && typeof action.rowsThrough === "string") return [`${tabId(action.sheet)}#freeze:${action.rowsThrough}`];
  if (action.t === "changeRows" && action.rows.some((one) => one.pos !== undefined)) return [`${tabId(action.sheet)}#rows:${action.rows.filter((one) => one.pos !== undefined).map((one) => `${one.id}@${one.pos}`).join(",")}`];
  if (action.t === "changeCols" && action.cols.some((one) => one.pos !== undefined)) return [`${tabId(action.sheet)}#cols:${action.cols.filter((one) => one.pos !== undefined).map((one) => `${one.id}@${one.pos}`).join(",")}`];
  return cellPlaces(action);
}

// Records only: what a revert's step needs (a revert's other places become skipped cells).
function recordNeeds(action) {
  if (action.t === "sort") return [tabId(action.sheet), ...action.rows.map((r) => rowId(action.sheet, r)), ...(action.cols ?? []).map((c) => colId(action.sheet, c))];
  if (action.t === "insertSheet") return [];
  // A workbook keeps one tab: a place, not a value, so an undo that would delete the last tab is
  // refused by its needs ("Can't undo: it is the last tab").
  if (action.t === "deleteSheet") return [tabId(action.sheet), `${tabId(action.sheet)}#others`];
  if (TAB_KINDS.has(action.t)) return [tabId(action.sheet)];
  const plain = withoutRefs(action);
  const want = needsOf(plain);
  const s = sheetOf(plain);
  return uniq([tabId(s), ...want.rows.map((r) => rowId(s, r)), ...want.cols.map((c) => colId(s, c))]);
}

function needs(action) {
  if (action.t === "revert") return action.step ? revertNeeds(action.step.action) : [];
  // A new tab needs no free name: one a coworker's new tab took first gets "Sheet 2 (2)" (`apply`).
  if (action.t === "insertSheet") return [];
  if (action.t === "renameSheet") return [tabId(action.sheet), `${tabId(action.sheet)}#name:${action.name.toLowerCase()}`];
  if (action.t === "sort") {
    const flat = action.cols === null ? "flat" : `flat:${action.cols.join(",")}`;
    return [...recordNeeds(action), ...action.rows.map((r) => `${rowId(action.sheet, r)}#${flat}`)];
  }
  return uniq([...recordNeeds(action), ...places(withoutRefs(action))]);
}

function creates(action) {
  if (action.t === "revert") return action.step ? creates(action.step.action) : [];
  if (action.t === "insertSheet") return [tabId(action.sheet.id)];
  if (TAB_KINDS.has(action.t) || action.t === "sort") return [];
  const made = createsOf(withoutRefs(action));
  const s = sheetOf(action);
  return [...made.rows.map((r) => rowId(s, r)), ...made.cols.map((c) => colId(s, c)), ...[...made.rows, ...made.cols].map((id) => `${tabId(s)}#id:${id}`)];
}

function removes(action) {
  if (action.t === "revert") return action.step ? removes(action.step.action) : [];
  if (action.t === "deleteSheet") return [tabId(action.sheet)];
  if (action.t === "batch") {
    const made = new Set(creates(action));
    return uniq(action.actions.flatMap(removes)).filter((id) => !made.has(id) && !action.actions.some((one) => creates(one).includes(id)));
  }
  if (action.t === "deleteRows") return action.rows.map((r) => rowId(action.sheet, r));
  if (action.t === "deleteCols") return action.cols.map((c) => colId(action.sheet, c));
  return [];
}

function targets(action) {
  if (!action || typeof action !== "object") return [];
  if (action.t === "revert") return action.step ? targets(action.step.action) : [];
  if (action.t === "insertSheet") return [`${tabId(action.sheet.id)}#name`, `${tabId(action.sheet.id)}#pos`];
  if (action.t === "renameSheet") return [`${tabId(action.sheet)}#name`];
  if (action.t === "moveSheet") return [`${tabId(action.sheet)}#pos`];
  if (action.t === "deleteSheet") return [];
  if (action.t === "sort") {
    if (action.cols === null) return action.rows.map((r) => `${rowId(action.sheet, r)}#pos`);
    return action.rows.flatMap((r) => action.cols.map((c) => cellId(action.sheet, r, c)));
  }
  return reducerTargets(action);
}

function has(doc, id) {
  const { sheet: s, row: r, col: c, extra } = parseId(id);
  const tab = tabIn(doc, s);
  if (extra !== null && r === null && c === null) {
    if (extra === "others") return doc.tabs.some((one) => one.id !== s);
    if (extra.startsWith("id:")) return !!tab && (rowAt(tab.sheet, extra.slice(3)) >= 0 || colAt(tab.sheet, extra.slice(3)) >= 0);
    if (extra.startsWith("name:")) return !doc.tabs.some((one) => one.id !== s && one.name.toLowerCase() === extra.slice(5));
    if (!tab) return false;
    const view = modelView(tab);
    if (extra.startsWith("merge:")) return mergeFits(view, extra.slice(6));
    if (extra.startsWith("freeze:")) {
      const at = rowAt(tab.sheet, extra.slice(7));
      return at >= 0 && !cutsFrozen(view, at + 1);
    }
    if (extra.startsWith("rows:") || extra.startsWith("cols:")) {
      const axis = extra.slice(0, 4);
      const records = extra.slice(5).split(",").map((one) => {
        const [id, pos] = one.split("@");
        return { id, pos };
      });
      const index = axis === "rows" ? (id) => rowAt(tab.sheet, id) : (id) => colAt(tab.sheet, id);
      if (records.some((one) => index(one.id) < 0)) return false;
      const order = axis === "rows" ? orderedRows(view, records) : orderedCols(view, records);
      return boxesApart(view, order, axis) === null;
    }
    return false;
  }
  if (!tab) return false;
  if (r === null && c === null) return true;
  if (c === null) {
    const at = rowAt(tab.sheet, r);
    if (at < 0) return false;
    if (extra === null) return true;
    if (extra === "flat") return !tab.sheet.rows[at].frozen && !mergeBoxes(modelView(tab)).some((box) => box.rs > 1 && box.row <= at && box.bottom >= at);
    if (extra.startsWith("flat:")) {
      const cols = extra.slice(5).split(",").map((id) => colAt(tab.sheet, id));
      return cols.every((col) => col >= 0) && !mergeBoxes(modelView(tab)).some((box) => box.row <= at && box.bottom >= at && cols.some((col) => box.col <= col && box.right >= col));
    }
    return false;
  }
  if (r === null) return colAt(tab.sheet, c) >= 0;
  const at = rowAt(tab.sheet, r);
  const col = colAt(tab.sheet, c);
  return at >= 0 && col >= 0 && !tab.sheet.rows[at].cells[col]?.hidden;
}

// The reducer's merge checks, read from the place id, or the merge already made exactly.
function mergeFits(view, spec) {
  const [from, to, digest] = spec.split(":");
  const [r0, c0] = from.split("/");
  const [r1, c1] = to.split("/");
  const ri = [view.rowIndex(r0), view.rowIndex(r1)];
  const ci = [view.colIndex(c0), view.colIndex(c1)];
  if (ri.some((x) => x < 0) || ci.some((x) => x < 0)) return false;
  const top = Math.min(...ri), bottom = Math.max(...ri), left = Math.min(...ci), right = Math.max(...ci);
  if (top === bottom && left === right) return false;
  const anchor = view.cell(top, left);
  if (sameMerge(anchor, top, bottom, left, right)) return true;
  const boxes = mergeBoxes(view);
  if (boxes.some((box) => box.row <= bottom && box.bottom >= top && box.col <= right && box.right >= left && !(box.row >= top && box.bottom <= bottom && box.col >= left && box.right <= right))) return false;
  const frozen = view.frozen().rows;
  if (top < frozen && bottom >= frozen) return false;
  return fp(clearedBetween(view, top, bottom, left, right).map((pair) => pair.join("/")).sort().join(",")) === digest;
}

const sameMerge = (anchor, top, bottom, left, right) => !!anchor && (anchor.rowspan ?? 1) === bottom - top + 1 && (anchor.colspan ?? 1) === right - left + 1 && (anchor.rowspan !== undefined || anchor.colspan !== undefined);

// A read-only backing over a tab's sheet, for the reducer's merge helpers.
function modelView(tab) {
  const sheet = tab.sheet;
  const { rows, cols } = indexOf(sheet);
  return {
    sheetId: tab.id,
    sheet,
    rows: () => sheet.rows,
    cols: () => sheet.cols,
    rowIndex: (id) => rows.get(id) ?? -1,
    colIndex: (id) => cols.get(id) ?? -1,
    cell: (r, c) => sheet.rows[r]?.cells[c] ?? null,
    frozen: () => ({ rows: sheet.rows.filter((row) => row.frozen).length, cols: sheet.freezeCols ?? 0 }),
  };
}

// ---------------------------------------------------------------------------------------------
// Apply

const placed = (doc, action) => needs(action).every((id) => has(doc, id)) && creates(action).every((id) => !has(doc, id));

// What an action left in each field it wrote, and what its undo will write: a revert puts a field
// back only while it still holds this. One entry per cell, and per row, column, tab and freeze
// field, so an undo of a column's format is not held back by a coworker's change of its width. A
// whole-width sort's rows are judged by their key and their formulas (`sort:row`), since its undo
// moves the rows back and shifts their formulas.
const WROTE_KINDS = {
  "row:pos": (row) => fp(row.pos),
  "row:style": (row) => fp(row.style ?? ""),
  "col:pos": (col) => fp(col.pos),
  "col:width": (col) => fp(String(col.width ?? "")),
  "col:fmt": (col) => fp(col.fmt ?? ""),
  "tab:name": (tab) => fp(tab.name),
  "tab:pos": (tab) => fp(tab.pos),
  "freeze:rows": (tab) => fp(tab.sheet.rows.filter((row) => row.frozen).map((row) => row.id).join(",")),
  "freeze:cols": (tab) => fp(String(tab.sheet.freezeCols ?? 0)),
};
const KIND_OF = { pos: "pos", height: "style", rowstyle: "style", width: "width", fmt: "fmt", name: "name", freezeRows: "rows", freezeCols: "cols" };

function sortRowPrint(doc, frame, s, sheet, row) {
  const formulas = row.cells.map((cell, c) => (cell && !cell.hidden && cell.f !== undefined ? `${sheet.cols[c].id}=${contentKey(doc, frame, s, cell)}` : null)).filter((one) => one !== null);
  return fp([row.pos, row.frozen ? 1 : 0, ...formulas].join("\u0000"));
}

// The wrote entry's kind for a target, or null for a target no undo writes back (a record's
// existence, a span, which the cell's own entry covers).
function wroteKind(target, sorted) {
  const { row: r, col: c, extra } = parseId(target);
  if (r !== null && c !== null) return "cell";
  if (extra === null) return null;
  if (r !== null && sorted && extra === "pos") return "sort:row";
  if (r === null && c === null && extra.startsWith("rule:")) return extra;
  const kind = r !== null ? `row:${KIND_OF[extra]}` : c !== null ? `col:${KIND_OF[extra]}` : extra === "name" || extra === "pos" ? `tab:${extra}` : `freeze:${KIND_OF[extra]}`;
  return WROTE_KINDS[kind] ? kind : null;
}

// The target id a wrote entry guards: what `skipped` names, and what `current` reads.
function wroteTarget([s, r, c, kind]) {
  if (kind === "cell") return cellId(s, r, c);
  if (kind === "sort:row" || kind === "row:pos") return `${rowId(s, r)}#pos`;
  if (kind === "row:style") return `${rowId(s, r)}#rowstyle`;
  if (kind.startsWith("col:")) return `${colId(s, c)}#${kind.slice(4)}`;
  if (kind.startsWith("tab:")) return `${tabId(s)}#${kind.slice(4)}`;
  if (kind.startsWith("rule:")) return `${tabId(s)}#${kind}`;
  return `${tabId(s)}#${kind === "freeze:rows" ? "freezeRows" : "freezeCols"}`;
}

// A wrote entry's field as it is now, or null when its cell, row, column or tab is gone.
function fieldPrint(doc, frame, [s, r, c, kind]) {
  const tab = tabIn(doc, s);
  if (!tab) return null;
  if (kind === "cell") {
    const found = cellOf(doc, s, r, c);
    return found.missing ? null : cellPrint(doc, frame, s, found.cell);
  }
  if (kind === "sort:row" || kind.startsWith("row:")) {
    const row = tab.sheet.rows[rowAt(tab.sheet, r)];
    return !row ? null : kind === "sort:row" ? sortRowPrint(doc, frame, s, tab.sheet, row) : WROTE_KINDS[kind](row);
  }
  if (kind.startsWith("col:")) {
    const col = tab.sheet.cols[colAt(tab.sheet, c)];
    return col ? WROTE_KINDS[kind](col) : null;
  }
  if (kind.startsWith("rule:")) {
    const found = (tab.sheet.rules ?? []).find((one) => one.id === kind.slice(5)) ?? null;
    return rulePrint(tab.sheet, found);
  }
  return WROTE_KINDS[kind](tab);
}

function wroteOf(doc, frame, list, sorted) {
  const out = new Map();
  for (const target of list) {
    const kind = wroteKind(target, sorted);
    if (kind === null) continue;
    const { sheet: s, row: r, col: c } = parseId(target);
    const entry = [s, kind === "cell" || kind === "sort:row" || kind.startsWith("row:") ? r : null, kind === "cell" || kind.startsWith("col:") ? c : null, kind];
    const now = fieldPrint(doc, frame, entry);
    if (now !== null) out.set(wroteTarget(entry), [...entry, now]);
  }
  return [...out.values()];
}

const stillHolds = (doc, frame, entry) => fieldPrint(doc, frame, entry) === entry[4];
const unpack = (one) => (one === null ? [] : one.t === "batch" ? one.actions : [one]);
const growth = (s, action) => [action.rows?.length ? { v: 1, t: "insertRows", sheet: s, rows: action.rows } : null, action.cols?.length ? { v: 1, t: "insertCols", sheet: s, cols: action.cols } : null].filter(Boolean);
const oneOrBatch = (parts) => (parts.length === 0 ? null : parts.length === 1 ? parts[0] : { v: 1, t: "batch", actions: parts });

// The step without the parts that write a field a coworker changed since (`skipped`), and without
// the cells and fields that land in a row or column a coworker deleted since, which go in
// `dropped`. `live` follows the rows and columns there are as the parts of a batch run. Null when
// nothing is left. A sort goes whole or not at all: part of a sort would put two rows on one key.
function filterStep(doc, action, skipped, dropped, live = null) {
  if (action === null) return null;
  const s = sheetOf(action);
  const tab = tabIn(doc, s);
  const state = live ?? { rows: new Set(tab?.sheet.rows.map((row) => row.id)), cols: new Set(tab?.sheet.cols.map((col) => col.id)) };
  if (action.t === "batch") {
    // A format change's undo carries each cell's shown text; a column whose format a coworker
    // changed since keeps the text that format shows.
    const kept = new Set(action.actions.filter((one) => one.t === "changeCols").flatMap((one) => one.cols.filter((col) => col.fmt !== undefined && skipped.has(`${colId(one.sheet, col.id)}#fmt`)).map((col) => col.id)));
    const carried = (entry) => kept.has(entry[1]) && entry[3] !== undefined && Object.keys(entry[3]).length === 1 && entry[3].text !== undefined;
    const actions = action.actions.flatMap((one) => unpack(filterStep(doc, one.t === "set" && kept.size > 0 ? { ...one, cells: one.cells.filter((entry) => !carried(entry)) } : one, skipped, dropped, state)));
    return actions.length === 0 ? null : { ...action, actions };
  }
  if (TAB_KINDS.has(action.t)) {
    if (action.t === "renameSheet") return skipped.has(`${tabId(s)}#name`) ? null : action;
    if (action.t === "moveSheet") return skipped.has(`${tabId(s)}#pos`) ? null : action;
    return action;
  }
  // A whole-width sort's undo leaves out the rows a coworker deleted since and sorts the rest.
  if (action.t === "sort") {
    const keep = action.rows.flatMap((r, i) => (state.rows.has(r) ? [i] : []));
    const ids = keep.map((i) => `${rowId(s, action.rows[i])}#pos`);
    if (keep.length === 0 || ids.some((id) => skipped.has(id))) {
      dropped.push(...ids.filter((id) => !skipped.has(id)));
      return null;
    }
    if (keep.length === action.rows.length) return action;
    return { ...action, rows: keep.map((i) => action.rows[i]), ...(action.pos ? { pos: keep.map((i) => action.pos[i]) } : {}) };
  }
  const made = createsOf(withoutRefs(action));
  for (const r of made.rows) state.rows.add(r);
  for (const c of made.cols) state.cols.add(c);
  const there = (r, c) => (r === null || state.rows.has(r)) && (c === null || state.cols.has(c));
  if (action.t === "deleteRows" || action.t === "deleteCols") {
    const axis = action.t === "deleteRows" ? "rows" : "cols";
    const ids = action[axis].filter((id) => state[axis].has(id));
    for (const id of ids) state[axis].delete(id);
    if (ids.length === action[axis].length) return action;
    return ids.length > 0 ? { ...action, [axis]: ids } : null;
  }
  if (action.t === "set" || action.t === "format") {
    const cells = action.cells.filter(([r, c]) => {
      if (skipped.has(cellId(s, r, c))) return false;
      if (there(r, c)) return true;
      dropped.push(cellId(s, r, c));
      return false;
    });
    if (cells.length === action.cells.length && cells.length > 0) return action;
    return cells.length > 0 ? { ...action, cells } : oneOrBatch(growth(s, action));
  }
  if (action.t === "insertRows" || action.t === "insertCols") {
    const axis = action.t === "insertRows" ? "rows" : "cols";
    const records = action[axis].map(({ cells, ...record }) => {
      if (!cells) return record;
      const kept = cells.filter((entry) => {
        const [r, c] = axis === "rows" ? [record.id, entry[0]] : [entry[0], record.id];
        if (there(r, c)) return true;
        dropped.push(cellId(s, r, c));
        return false;
      });
      return kept.length > 0 ? { ...record, cells: kept } : record;
    });
    return { ...action, [axis]: records };
  }
  if (action.t === "changeRows" || action.t === "changeCols") {
    const axis = action.t === "changeRows" ? "rows" : "cols";
    const idOf = (id) => (axis === "rows" ? rowId(s, id) : colId(s, id));
    const list = action[axis].flatMap((one) => {
      if (!state[axis].has(one.id)) {
        dropped.push(idOf(one.id));
        return [];
      }
      const next = { ...one };
      for (const field of Object.keys(one)) {
        if (field === "id") continue;
        const target = `${idOf(one.id)}#${axis === "rows" && (field === "height" || field === "style") ? "rowstyle" : field}`;
        if (skipped.has(target)) delete next[field];
      }
      return Object.keys(next).length > 1 ? [next] : [];
    });
    return list.length === 0 ? null : { ...action, [axis]: list };
  }
  if (action.t === "rules") {
    const set = action.set.filter((rule) => !skipped.has(ruleId(s, rule.id)));
    const remove = action.remove.filter((id) => !skipped.has(ruleId(s, id)));
    if (set.length === action.set.length && remove.length === action.remove.length) return action;
    return set.length === 0 && remove.length === 0 ? null : { ...action, set, remove };
  }
  if (action.t === "merge") {
    const cells = [action.from, ...(action.clears ?? [])].map(([r, c]) => cellId(s, r, c));
    if (!cells.some((id) => skipped.has(id))) return action;
    dropped.push(...cells.filter((id) => !skipped.has(id)));
    return null;
  }
  if (action.t === "unmerge") {
    const id = cellId(s, action.row, action.col);
    if (skipped.has(id) || !there(action.row, action.col)) return null;
    return action;
  }
  if (action.t === "freeze") {
    const next = { v: 1, t: "freeze", sheet: s };
    if (action.rowsThrough !== undefined && !skipped.has(`${tabId(s)}#freezeRows`) && (action.rowsThrough === null || state.rows.has(action.rowsThrough))) next.rowsThrough = action.rowsThrough;
    if (action.colsThrough !== undefined && !skipped.has(`${tabId(s)}#freezeCols`) && (action.colsThrough === null || state.cols.has(action.colsThrough))) next.colsThrough = action.colsThrough;
    return next.rowsThrough === undefined && next.colsThrough === undefined ? null : next;
  }
  return action;
}

// The step with its records only: inserts without the cells `keep` refuses, sets that grow the sheet
// as plain inserts, no merge or unmerge. A revert falls back to it when the reducer refuses the
// whole step for something a coworker did since (a merge over the place a row's cells come back
// to), so the row still comes back; the cells and merges it leaves out go in `lost`.
function recordsOnly(action, lost, keep = () => false) {
  if (action.t === "batch") return oneOrBatch(action.actions.flatMap((one) => unpack(recordsOnly(one, lost, keep))));
  if (action.t === "rules") return null;
  const s = action.sheet;
  if (action.t === "merge" || action.t === "unmerge") {
    lost.push(cellId(s, ...(action.t === "merge" ? action.from : [action.row, action.col])));
    return null;
  }
  if (action.t === "set" || action.t === "format") {
    for (const [r, c] of action.cells) lost.push(cellId(s, r, c));
    return oneOrBatch(growth(s, action));
  }
  if (action.t === "insertRows" || action.t === "insertCols") {
    const axis = action.t === "insertRows" ? "rows" : "cols";
    return {
      ...action,
      [axis]: action[axis].map(({ cells, ...record }) => {
        const kept = [];
        for (const entry of cells ?? []) {
          if (keep(s, axis, entry[0])) kept.push(entry);
          else lost.push(axis === "rows" ? cellId(s, record.id, entry[0]) : cellId(s, entry[0], record.id));
        }
        return kept.length ? { ...record, cells: kept } : record;
      }),
    };
  }
  return action;
}

// A tab an undo brings back keeps its cells even when another tab took its name since: it comes
// back as "Notes (2)", and its name counts as skipped.
function freeNamed(doc, action, skipped) {
  if (action?.t !== "insertSheet") return action;
  const taken = (name) => doc.tabs.some((tab) => tab.name.toLowerCase() === name.toLowerCase());
  if (!taken(action.sheet.name)) return action;
  let n = 2;
  while (taken(`${action.sheet.name} (${n})`)) n += 1;
  skipped.add(`${tabId(action.sheet.id)}#name`);
  return { ...action, sheet: { ...action.sheet, name: `${action.sheet.name} (${n})` } };
}

// What a revert's step needs: the tab, and for a tab action its records and the last-tab place.
// Rows and columns a coworker deleted since are not needs: the cells that land in them are dropped
// and named in `skipped`, and a row or column the step would delete that is already gone is left
// out of the step (ClayJS law C15 counts it removed), so the rest of the undo still happens.
function revertNeeds(action) {
  return TAB_KINDS.has(action.t) ? recordNeeds(action) : [tabId(sheetOf(action))];
}

// An undo in a room. Each field the undone action wrote is put back only while it still holds what
// that action left (`wrote`); what a coworker changed since is left as it is and named in `skipped`.
// Then three attempts, each on a fresh workbook: the kept step; its records with the cells no merge
// now covers; its records alone. The first the reducer takes wins.
function applyRevert(doc, action) {
  if (action.step === null) return { out: "applied", inverse: NULL_REVERT, skipped: [] };
  const frame = frameOfDoc(doc);
  const skipped = new Set(action.wrote.filter((entry) => !stillHolds(doc, frame, entry)).map(wroteTarget));
  const dropped = [];
  const kept = freeNamed(doc, filterStep(doc, action.step.action, skipped, dropped), skipped);
  const tries = kept === null ? [] : [{ step: kept, lost: [] }];
  const made = { rows: new Set(), cols: new Set() };
  for (const part of kept === null || TAB_KINDS.has(kept.t) || kept.t === "sort" ? [] : unpack(kept)) {
    const one = createsOf(withoutRefs(part));
    for (const r of one.rows) made.rows.add(r);
    for (const c of one.cols) made.cols.add(c);
  }
  // First the cells outside every merge a landing record could grow, then the records alone.
  const clear = (s, axis, other) => {
    if ((axis === "rows" ? made.cols : made.rows).has(other)) return true;
    const tab = tabIn(doc, s);
    const at = !tab ? -1 : axis === "rows" ? colAt(tab.sheet, other) : rowAt(tab.sheet, other);
    return at >= 0 && !mergeBoxes(modelView(tab)).some((box) => (axis === "rows" ? box.rs > 1 && box.col <= at && box.right >= at : box.cs > 1 && box.row <= at && box.bottom >= at));
  };
  for (const keep of [clear, undefined]) {
    if (kept === null) break;
    const lost = [];
    const bare = recordsOnly(kept, lost, keep);
    if (bare !== null && !tries.some((one) => JSON.stringify(one.step) === JSON.stringify(bare))) tries.push({ step: bare, lost });
  }
  // Last, the step's deletes alone: an undo that takes away records does so even when the reducer
  // refuses the rest, because `removes` names them and the core counts them gone. Not for a step
  // that also brings records back: that one is refused below, so nothing it creates goes missing.
  const deletes = kept === null || TAB_KINDS.has(kept.t) || kept.t === "sort" || creates(action).length > 0 ? null : oneOrBatch(unpack(kept).filter((part) => part.t === "deleteRows" || part.t === "deleteCols"));
  if (deletes !== null && !tries.some((one) => JSON.stringify(one.step) === JSON.stringify(deletes))) {
    const gone = new Set(unpack(deletes).flatMap((part) => (part.t === "deleteRows" ? part.rows : part.cols)));
    const lost = action.wrote.map(wroteTarget).filter((target) => {
      const { row: r, col: c } = parseId(target);
      return !gone.has(r) && !gone.has(c);
    });
    tries.push({ step: deletes, lost });
  }
  let refused = null;
  for (const one of tries) {
    const gone = new Set([...skipped, ...dropped, ...one.lost]);
    const restore = action.step.restore.filter(([s, r, c]) => !gone.has(cellId(s, r, c)));
    const wb = workbookOf(doc);
    const out = applyWorkbook(wb, { action: one.step, restore, rules: (action.step.rules ?? []).filter(([s, id]) => !gone.has(ruleId(s, id))) }, {});
    if (out.out !== "applied") {
      refused = out;
      continue;
    }
    take(doc, wb);
    return { out: "applied", inverse: revertOf(doc, one.step, out.inverse), skipped: uniq([...skipped, ...dropped, ...one.lost]), changed: out.changed };
  }
  // Nothing of the step could be put back. A step that brings records back is refused, so the
  // person sees that the undo did not happen; any other is applied as nothing, every part skipped.
  if (refused !== null && creates(action).length > 0) return { out: "refused", inverse: null, code: refused.code, detail: refused.detail };
  return { out: "applied", inverse: NULL_REVERT, skipped: uniq([...action.wrote.map(wroteTarget), ...dropped]) };
}

// The revert that undoes `action`, which just applied with workbook inverse `step`: `wrote` guards
// every field the action wrote and every field its undo will write (a format change's undo also
// writes each cell's shown text). A new tab's cells count as written.
function revertOf(doc, action, step) {
  const made = action.t === "insertSheet" ? [...cellsOfRecord(doc, action.sheet.id, "tab").map(([id]) => id), ...(tabIn(doc, action.sheet.id)?.sheet.rules ?? []).map((rule) => ruleId(action.sheet.id, rule.id))] : [];
  const sorted = action.t === "sort" && action.cols === null;
  return { v: 1, t: "revert", of: null, step, wrote: wroteOf(doc, frameOfDoc(doc), [...targets(action), ...(step ? targets(step.action) : []), ...made, ...(step?.rules ?? []).map(([s, id]) => ruleId(s, id))], sorted) };
}

function apply(doc, action) {
  if (!placed(doc, action)) return { out: "refused", inverse: null };
  let out;
  if (action.t === "revert") out = applyRevert(doc, action);
  // A merge already made, or an unmerge of a block a coworker already unmerged, shows what its author
  // wanted: applied, changing nothing.
  else if ((action.t === "merge" && sameMerge(...mergeBox(doc, action))) || (action.t === "unmerge" && !isAnchor(doc, action))) out = { out: "applied", inverse: NULL_REVERT, skipped: [] };
  else {
    const named = new Set();
    const step = freeNamed(doc, action, named);
    const wb = workbookOf(doc);
    const done = applyWorkbook(wb, step, {});
    if (done.out !== "applied") return { out: "refused", inverse: null, code: done.code, detail: done.detail };
    take(doc, wb);
    out = { out: "applied", inverse: revertOf(doc, step, done.inverse), skipped: [...named], changed: done.changed };
  }
  if (out.changed) touchWriter(doc, out.changed);
  return out;
}

function isAnchor(doc, { sheet, row, col }) {
  const found = cellOf(doc, sheet, row, col);
  return !found.missing && !!found.cell && ((found.cell.rowspan ?? 1) > 1 || (found.cell.colspan ?? 1) > 1);
}

function mergeBox(doc, action) {
  const tab = tabIn(doc, action.sheet);
  const view = modelView(tab);
  const ri = [view.rowIndex(action.from[0]), view.rowIndex(action.to[0])];
  const ci = [view.colIndex(action.from[1]), view.colIndex(action.to[1])];
  const top = Math.min(...ri), bottom = Math.max(...ri), left = Math.min(...ci), right = Math.max(...ci);
  return [view.cell(top, left), top, bottom, left, right];
}

// ---------------------------------------------------------------------------------------------
// What the author saw, conflicts and removals

// Value targets: what an author saw and a conflict names. A merge's cleared cells and a narrow
// sort's cells are judged like a paste's (design 3.7); a whole-width sort's row keys, like any
// move, are not, so a coworker's edit stays on its line.
const VALUE_KINDS = new Set(["set", "format", "changeRows", "changeCols", "merge", "sort", "renameSheet", "freeze", "rules", "batch"]);
const isValueTarget = (target) => {
  const { row: r, col: c, extra } = parseId(target);
  if (r !== null && c !== null) return extra !== "span";
  if (r !== null || c !== null) return extra !== null && extra !== "pos";
  return extra === "name" || extra === "freezeRows" || extra === "freezeCols" || (extra !== null && extra.startsWith("rule:"));
};
const valueTargets = (action) => (VALUE_KINDS.has(action.t) ? targets(action).filter(isValueTarget) : []);

// A removed record as the author saw it: its own fields and every cell in it.
function recordPrint(doc, frame, s, kind, id) {
  const tab = tabIn(doc, s);
  if (!tab) return fp("~gone");
  const cells = (list) => list.filter(Boolean).sort();
  if (kind === "tab") {
    return fp([tab.name, tab.pos, tab.sheet.freezeCols ?? 0, ...cells(tab.sheet.cols.map((col) => `${col.id}=${colPrint(col)}`)), ...cells(tab.sheet.rows.map((row) => `${row.id}=${recordPrint(doc, frame, s, "row", row.id)}`)), ...cells((tab.sheet.rules ?? []).map((rule) => `${rule.id}=${rulePrint(tab.sheet, rule)}`))].join("\u0000"));
  }
  if (kind === "row") {
    const at = rowAt(tab.sheet, id);
    if (at < 0) return fp("~gone");
    const row = tab.sheet.rows[at];
    return fp([rowPrint(row), ...cells(row.cells.map((cell, c) => (cell && !cell.hidden ? `${tab.sheet.cols[c].id}=${cellPrint(doc, frame, s, cell)}` : "")))].join("\u0000"));
  }
  const at = colAt(tab.sheet, id);
  if (at < 0) return fp("~gone");
  return fp([colPrint(tab.sheet.cols[at]), ...cells(tab.sheet.rows.map((row) => (row.cells[at] && !row.cells[at].hidden ? `${row.id}=${cellPrint(doc, frame, s, row.cells[at])}` : "")))].join("\u0000"));
}

function removedOf(action) {
  return removes(action).map((id) => {
    const { sheet: s, row: r, col: c } = parseId(id);
    return { s, id, kind: r !== null ? "row" : c !== null ? "col" : "tab", of: r ?? c ?? s };
  });
}

// The saw: one fingerprint per value target, then one per removed record (a batch may both write
// and delete). A revert carries its own guard (`wrote`), so its author's view adds nothing.
function seen(doc, action) {
  if (action.t === "revert") return null;
  const values = valueTargets(action);
  const gone = removedOf(action);
  if (values.length === 0 && gone.length === 0) return null;
  const frame = frameOfDoc(doc);
  return [...values.map((target) => targetPrint(doc, frame, target)), ...gone.map((one) => recordPrint(doc, frame, one.s, one.kind, one.of))];
}

function conflicts(doc, action, saw) {
  if (action.t === "revert") return [];
  const values = valueTargets(action);
  if (values.length === 0) return [];
  const frame = frameOfDoc(doc);
  const out = [];
  values.forEach((target, i) => {
    const now = targetPrint(doc, frame, target);
    if (!Array.isArray(saw) || saw[i] !== now) out.push([target, now]);
  });
  return out;
}

function review(action, saw, cells) {
  const values = valueTargets(action);
  if (values.length === 0) return saw;
  const now = new Map(cells.map(([target, print]) => [target, print]));
  const tail = Array.isArray(saw) ? saw.slice(values.length) : removedOf(action).map(() => fp("~unseen"));
  return [...values.map((target, i) => now.get(target) ?? (Array.isArray(saw) ? saw[i] : fp("~unseen"))), ...tail];
}

function cellsOfRecord(doc, s, kind, id) {
  const tab = tabIn(doc, s);
  if (!tab) return [];
  const out = [];
  const each = (r, c) => {
    const cell = tab.sheet.rows[r].cells[c];
    if (cell && !cell.hidden && (cell.f !== undefined || cell.text !== "")) out.push([cellId(s, tab.sheet.rows[r].id, tab.sheet.cols[c].id), contentOf(cell)]);
  };
  if (kind === "row") {
    const at = rowAt(tab.sheet, id);
    if (at >= 0) tab.sheet.rows[at].cells.forEach((_, c) => each(at, c));
  } else if (kind === "col") {
    const at = colAt(tab.sheet, id);
    if (at >= 0) tab.sheet.rows.forEach((row, r) => each(r, at));
  } else {
    tab.sheet.rows.forEach((row, r) => row.cells.forEach((_, c) => each(r, c)));
  }
  return out;
}

const rulesOfTab = (doc, s) => (tabIn(doc, s)?.sheet.rules ?? []).map((rule) => [ruleId(s, rule.id), copyRule(rule)]);
const itemsOfRecord = (doc, s, kind, id) => (kind === "tab" ? [...cellsOfRecord(doc, s, kind, id), ...rulesOfTab(doc, s)] : cellsOfRecord(doc, s, kind, id));

// What a removal deletes that its author did not see: for a revert (an undo of an insert, or of a
// paste that grew the sheet), each cell of a removed record that differs from what the undone
// action wrote; for any other action, the cells of each record that changed since the saw, or one
// `[recordId, null]` entry when only the record's own fields changed.
function unseen(doc, action, saw) {
  const gone = removedOf(action);
  if (gone.length === 0) return [];
  const frame = frameOfDoc(doc);
  const out = [];
  if (action.t === "revert") {
    const wrote = new Map(action.wrote.filter((entry) => entry[3] === "cell").map((entry) => [cellId(entry[0], entry[1], entry[2]), entry[4]]));
    const wroteRules = new Map(action.wrote.filter((entry) => entry[3].startsWith("rule:")).map((entry) => [`${tabId(entry[0])}#${entry[3]}`, entry[4]]));
    for (const one of gone) {
      if (one.kind === "tab") {
        for (const [target, rule] of rulesOfTab(doc, one.s)) {
          if (wroteRules.get(target) !== rulePrint(tabIn(doc, one.s).sheet, rule)) out.push([target, rule]);
        }
      }
      for (const [target, content] of cellsOfRecord(doc, one.s, one.kind, one.of)) {
        const { row: r, col: c } = parseId(target);
        if (wrote.get(target) !== cellPrint(doc, frame, one.s, cellOf(doc, one.s, r, c).cell)) out.push([target, content]);
      }
    }
    return out.slice(0, UNSEEN_CAP);
  }
  if (saw === null) return gone.flatMap((one) => itemsOfRecord(doc, one.s, one.kind, one.of)).slice(0, UNSEEN_CAP);
  if (!Array.isArray(saw)) return [];
  const offset = valueTargets(action).length;
  let changed = null;
  gone.forEach((one, i) => {
    if (saw[offset + i] === recordPrint(doc, frame, one.s, one.kind, one.of)) return;
    changed ??= one.id;
    out.push(...itemsOfRecord(doc, one.s, one.kind, one.of));
  });
  if (out.length === 0 && changed !== null) return [[changed, null]];
  return out.slice(0, UNSEEN_CAP);
}

// ---------------------------------------------------------------------------------------------
// Holds, preview, describe, current

// A copy `apply` may work on: `apply` puts new sheets in the doc and never changes one in
// place, so the copy shares the original's sheets until then.
const copyOf = (doc) => ({ tabs: [...doc.tabs] });

function holds(doc, action) {
  if (!needs(action).every((id) => has(doc, id))) return false;
  const copy = copyOf(doc);
  if (apply(copy, action).out !== "applied") return false;
  return write(copy, null) === write(doc, null);
}

function preview(doc, actions) {
  const copy = copyOf(doc);
  for (const action of actions) apply(copy, action);
  return copy;
}

const COLS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const colName = (n) => {
  let out = "";
  for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) out = COLS[(n - 1) % 26] + out;
  return out;
};

function current(doc, target) {
  const { sheet: s, row: r, col: c, extra } = parseId(target);
  const tab = tabIn(doc, s);
  if (!tab) return null;
  if (r !== null && c !== null) {
    const found = cellOf(doc, s, r, c);
    if (found.missing) return null;
    if (extra === "fmt") return found.cell?.fmt ?? null;
    if (extra === "style") return found.cell?.style ?? null;
    return contentOf(found.cell);
  }
  if (r !== null) {
    const row = tab.sheet.rows[rowAt(tab.sheet, r)];
    if (!row) return null;
    if (extra === "height") return Number(/(?:^|;)\s*height:\s*(\d+)px/.exec(row.style ?? "")?.[1] ?? NaN) || null;
    return extra === null ? row.id : row[KIND_OF[extra] ?? extra] ?? null;
  }
  if (c !== null) {
    const col = tab.sheet.cols[colAt(tab.sheet, c)];
    return !col ? null : extra === null ? col.id : col[extra] ?? null;
  }
  if (extra !== null && extra.startsWith("rule:")) {
    const found = (tab.sheet.rules ?? []).find((one) => one.id === extra.slice(5));
    return found ? copyRule(found) : null;
  }
  // A freeze line as a freeze action names it: the last frozen row or column, or null.
  if (extra === "freezeRows") return tab.sheet.rows.filter((row) => row.frozen).at(-1)?.id ?? null;
  if (extra === "freezeCols") return tab.sheet.cols[(tab.sheet.freezeCols ?? 0) - 1]?.id ?? null;
  if (extra === "pos") return tab.pos;
  return tab.name;
}

const TITLES = {
  set: "Edit cells",
  format: "Format cells",
  insertRows: "Insert rows",
  deleteRows: "Delete rows",
  changeRows: "Move or resize rows",
  insertCols: "Insert columns",
  deleteCols: "Delete columns",
  changeCols: "Move or resize columns",
  merge: "Merge cells",
  unmerge: "Unmerge cells",
  freeze: "Freeze",
  batch: "Edit cells",
  insertSheet: "Add a tab",
  deleteSheet: "Delete a tab",
  renameSheet: "Rename a tab",
  moveSheet: "Move a tab",
  sort: "Sort",
  rules: "Edit rules",
  revert: "Undo",
};

const RULE_LABELS = {
  check: "Checkbox",
  list: "Dropdown",
  when: "Conditional format",
  scale: "Color scale",
  chart: "Chart",
};

function label(doc, target, stored = null) {
  const { sheet: s, row: r, col: c, extra } = parseId(target);
  const tab = tabIn(doc, s);
  if (!tab) return s;
  const name = tab.name;
  if (r === null && c === null && extra !== null && extra.startsWith("rule:")) {
    const id = extra.slice(5);
    const rule = stored ?? current(doc, target);
    if (!rule) return `${name}: Rule ${id}`;
    if (rule.kind === "chart" && rule.title) return `${name}: ${rule.title}`;
    return `${name}: ${RULE_LABELS[rule.kind] ?? "Rule"} ${rule.range}`;
  }
  const ri = r === null ? -1 : rowAt(tab.sheet, r);
  const ci = c === null ? -1 : colAt(tab.sheet, c);
  if (ri >= 0 && ci >= 0) return `${name}!${colName(ci)}${ri + 1}`;
  if (ri >= 0) return `${name}!${ri + 1}:${ri + 1}`;
  if (ci >= 0) return `${name}!${colName(ci)}:${colName(ci)}`;
  return name;
}

function decodeStoredValue(doc, sheetId, content) {
  if (content === null || content === undefined || typeof content !== "object") return content ?? null;
  if (typeof content.f === "string") {
    const bound = Array.isArray(content.refs) ? fromIds(content.f, content.refs) : null;
    return { f: bound === null ? content.f : print(bound, sheetId, null, frameOfDoc(doc)) };
  }
  return content;
}

// What the action stores at a target, as `current` reads it: a formula sent with ids is printed in
// the doc's frame, as `apply` would write it. The last part of a batch to write it wins.
function storedOf(doc, action, target) {
  const { sheet: s, row: r, col: c, extra } = parseId(target);
  const parts = action.t === "batch" ? action.actions : [action];
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (part.t === "rules" && part.sheet === s && r === null && c === null && extra !== null && extra.startsWith("rule:")) {
      const id = extra.slice(5);
      if (part.remove.includes(id)) return null;
      const entry = part.set.find((rule) => rule.id === id);
      if (!entry) continue;
      return copyRule(entry);
    }
    // A one-column sort writes into a row the cell of the row it puts in that row's place.
    if (part.t === "sort" && part.cols !== null && extra === null && part.cols.includes(c)) {
      const tab = tabIn(doc, part.sheet);
      const was = tab ? part.rows.map((id) => rowAt(tab.sheet, id)) : [];
      if (was.length === 0 || was.some((at) => at < 0)) continue;
      const slots = was.slice().sort((x, y) => x - y);
      const k = slots.indexOf(rowAt(tab.sheet, r));
      if (k < 0) continue;
      // The sort moves a formula as a copy moves it: shifted by the rows between its two places.
      const stored = current(doc, cellId(part.sheet, part.rows[k], c));
      return stored !== null && typeof stored === "object" && typeof stored.f === "string" ? { ...stored, f: shiftRows(stored.f, slots[k] - was[k]) } : stored;
    }
    if (part.t === "set" && extra === null) {
      const entry = part.cells.find(([row, col]) => row === r && col === c);
      if (!entry) continue;
      return decodeStoredValue(doc, part.sheet, entry[2]);
    }
    if (part.t === "insertRows" && part.sheet === s && extra === null && r !== null && c !== null) {
      const row = (part.rows ?? []).find((one) => one.id === r);
      if (!row?.cells) continue;
      const tab = tabIn(doc, s);
      for (let idx = 0; idx < row.cells.length; idx++) {
        const entry = row.cells[idx];
        if (Array.isArray(entry)) {
          if (entry[0] === c) return decodeStoredValue(doc, s, entry[1]);
        } else if (tab?.sheet.cols[idx]?.id === c) {
          return decodeStoredValue(doc, s, entry);
        }
      }
    }
    if (part.t === "insertCols" && part.sheet === s && extra === null && r !== null && c !== null) {
      const col = (part.cols ?? []).find((one) => one.id === c);
      if (!col?.cells) continue;
      const tab = tabIn(doc, s);
      for (let idx = 0; idx < col.cells.length; idx++) {
        const entry = col.cells[idx];
        if (Array.isArray(entry)) {
          if (entry[0] === r) return decodeStoredValue(doc, s, entry[1]);
        } else if (tab?.sheet.rows[idx]?.id === r) {
          return decodeStoredValue(doc, s, entry);
        }
      }
    }
    if (part.t === "format" && (extra === "fmt" || extra === "style")) {
      const entry = part.cells.find(([row, col]) => row === r && col === c);
      if (entry?.[2]?.[extra] !== undefined) return entry[2][extra];
    }
    if (part.t === "renameSheet" && extra === "name") return part.name;
    if (part.t === "freeze" && (extra === "freezeRows" || extra === "freezeCols")) {
      const through = extra === "freezeRows" ? part.rowsThrough : part.colsThrough;
      if (through !== undefined) return through;
    }
    if ((part.t === "changeRows" || part.t === "changeCols") && extra !== null) {
      const record = (part.rows ?? part.cols).find((one) => one.id === (part.t === "changeRows" ? r : c));
      const field = extra === "rowstyle" ? "style" : extra;
      if (record?.[field] !== undefined) return record[field];
    }
  }
  return null;
}

function insertedCellsOf(doc, shown) {
  const out = [];
  const parts = shown.t === "batch" ? shown.actions : [shown];
  for (const part of parts) {
    if (part.t === "insertRows") {
      const tab = tabIn(doc, part.sheet);
      const name = tab?.name ?? part.sheet;
      const cols = tab?.sheet.cols ?? [];
      for (const [rIdx, row] of (part.rows ?? []).entries()) {
        for (const [cIdx, entry] of (row.cells ?? []).entries()) {
          const isPair = Array.isArray(entry);
          const colIdVal = isPair ? entry[0] : (cols[cIdx]?.id ?? `c${cIdx + 1}`);
          const rawVal = isPair ? entry[1] : entry;
          if (rawVal === null || rawVal === undefined || rawVal === "") continue;
          const stored = decodeStoredValue(doc, part.sheet, rawVal);
          const ci = isPair ? colAt(tab?.sheet ?? { cols: [], rows: [] }, colIdVal) : cIdx;
          const target = cellId(part.sheet, row.id, colIdVal);
          const cellLabel = ci >= 0 ? `${name}!${colName(ci)} (row ${rIdx + 1})` : label(doc, target, stored);
          out.push({ target, label: cellLabel, stored });
        }
      }
    } else if (part.t === "insertCols") {
      const tab = tabIn(doc, part.sheet);
      const name = tab?.name ?? part.sheet;
      const rows = tab?.sheet.rows ?? [];
      for (const [cIdx, col] of (part.cols ?? []).entries()) {
        for (const [rIdx, entry] of (col.cells ?? []).entries()) {
          const isPair = Array.isArray(entry);
          const rowIdVal = isPair ? entry[0] : (rows[rIdx]?.id ?? `r${rIdx + 1}`);
          const rawVal = isPair ? entry[1] : entry;
          if (rawVal === null || rawVal === undefined || rawVal === "") continue;
          const stored = decodeStoredValue(doc, part.sheet, rawVal);
          const ri = isPair ? rowAt(tab?.sheet ?? { cols: [], rows: [] }, rowIdVal) : rIdx;
          const target = cellId(part.sheet, rowIdVal, col.id);
          const cellLabel = ri >= 0 ? `${name}!${colName(cIdx)}${ri + 1}` : label(doc, target, stored);
          out.push({ target, label: cellLabel, stored });
        }
      }
    } else if (part.t === "insertSheet") {
      const spec = part.sheet && typeof part.sheet === "object" ? part.sheet : part;
      const sId = typeof part.sheet === "string" ? part.sheet : (spec.id ?? "s1");
      const sName = spec.name ?? sId;
      const cols = spec.cols ?? [];
      for (const [rIdx, row] of (spec.rows ?? []).entries()) {
        const rId = row.id ?? `r${rIdx + 1}`;
        for (const [cIdx, entry] of (row.cells ?? []).entries()) {
          const isPair = Array.isArray(entry);
          const colIdVal = isPair ? entry[0] : (cols[cIdx]?.id ?? `c${cIdx + 1}`);
          const rawVal = isPair ? entry[1] : entry;
          if (rawVal === null || rawVal === undefined || rawVal === "") continue;
          const stored = decodeStoredValue(doc, sId, rawVal);
          const colPos = isPair ? cols.findIndex((one) => one.id === colIdVal) : cIdx;
          const cellLabel = `${sName}!${colName(colPos >= 0 ? colPos : cIdx)}${rIdx + 1}`;
          out.push({ target: cellId(sId, rId, colIdVal), label: cellLabel, stored });
        }
      }
    }
  }
  return out;
}

function describe(action, doc) {
  if (!action || typeof action !== "object") return { title: "Edit", cells: [] };
  const shown = action.t === "revert" ? action.step?.action ?? action : action;
  const cells = valueTargets(shown).map((target) => {
    const stored = storedOf(doc, shown, target);
    return { target, label: label(doc, target, stored), stored };
  });
  if (shown.t === "insertRows" || shown.t === "insertCols" || shown.t === "insertSheet") {
    cells.push(...insertedCellsOf(doc, shown));
  }
  return {
    title: TITLES[action.t] ?? "Edit",
    cells,
  };
}

// ---------------------------------------------------------------------------------------------
// Size, operations and parts

const size = (action) => utf8(JSON.stringify(action));
const ops = (action) => Math.max(1, targets(action).length, Math.ceil(size(action) / OP_BYTES));

// The bytes one UTF-16 unit of a part's text costs on the wire, where the frame escapes the text
// once more as JSON: `"` and `\` take two, and a character takes its UTF-8 bytes (a surrogate
// pair four, counted on its first half). The text is JSON already, so it holds no control character.
function wireBytes(src, i) {
  const c = src.charCodeAt(i);
  if (c === 0x22 || c === 0x5c) return 2;
  if (c < 0x80) return 1;
  if (c < 0x800) return 2;
  if (c >= 0xd800 && c <= 0xdbff) return 4;
  return c >= 0xdc00 && c <= 0xdfff ? 0 : 3;
}

// The payload as JSON text cut into pieces: one part per `opsPerFrame` operations, each piece about
// the same number of bytes on the wire. A piece never ends between the two halves of a surrogate
// pair.
function split({ action, saw, reviewed }, limits) {
  const total = ops(action);
  const count = Math.max(1, Math.ceil(total / limits.opsPerFrame));
  const textOf = JSON.stringify({ action, saw: saw ?? null, reviewed: reviewed ?? null });
  let wire = 0;
  for (let i = 0; i < textOf.length; i++) wire += wireBytes(textOf, i);
  const parts = [];
  let at = 0;
  let used = 0;
  for (let i = 0; i < count; i++) {
    let end = at;
    const goal = i === count - 1 ? Infinity : ((i + 1) * wire) / count;
    while (end < textOf.length && used < goal) used += wireBytes(textOf, end++);
    if (end < textOf.length && wireBytes(textOf, end) === 0) end += 1;
    parts.push({ n: i === count - 1 ? total - limits.opsPerFrame * (count - 1) : limits.opsPerFrame, text: textOf.slice(at, end) });
    at = end;
  }
  const emptied = (value) => (value ? (Array.isArray(value) ? [] : {}) : value);
  const head = { action: { v: 1, t: action.t, ...(text(action.sheet) ? { sheet: action.sheet } : {}) }, saw: emptied(saw), reviewed: emptied(reviewed) };
  return { head, parts };
}

function assemble(head, parts) {
  const whole = JSON.parse(parts.map((part) => part.text).join(""));
  return { action: whole.action, saw: head.saw === undefined ? undefined : whole.saw, reviewed: head.reviewed === undefined ? undefined : whole.reviewed };
}

const partOps = (part) => part.n;

const docBytes = (doc) => utf8(JSON.stringify(doc));

// Each tab's print as the codec compares it: name, place, frozen columns, columns, rows, each cell's
// content, format, style and spans, and the rules; no results or shown text. Two docs whose digests
// are equal hold the same sheet for a room.
function digest(doc) {
  const frame = frameOfDoc(doc);
  return Object.fromEntries(doc.tabs.map((tab) => [tab.id, recordPrint(doc, frame, tab.id, "tab", tab.id)]));
}

// Calculates every formula in `doc` without a DOM and returns the `extras` function `write` takes.
// Volatile functions run through `quiet` (David's answer 7). A formula that calls an unloaded
// function (or reads one) returns undefined so `write` keeps its tab marked `stale` for a browser
// that loads the extended pack. Disposes the temporary engine before returning.
export function results(doc, options = {}) {
  const hasFormula = doc.tabs.some((tab) => tab.sheet.rows.some((row) => row.cells.some((cell) => cell && !cell.hidden && cell.f !== undefined)));
  if (!hasFormula) return () => undefined;
  const wb = modelWorkbook(doc.tabs);
  const engine = createEngine(wb, { quiet: (fn) => fn(), ...options });
  const computed = new Map();
  try {
    engine.load();
    const pending = engine.unresolved();
    for (const tab of doc.tabs) {
      const { rows, cols } = tab.sheet;
      for (const row of rows) {
        for (let c = 0; c < row.cells.length; c++) {
          const cell = row.cells[c];
          if (!cell || cell.hidden || cell.f === undefined) continue;
          const col = cols[c];
          if (!col) continue;
          const key = `${tab.id}\u0000${row.id}\u0000${col.id}`;
          if (pending.has(key)) continue;
          const extra = engine.extras(tab.id, row.id, col.id);
          if (extra !== undefined) computed.set(key, extra);
        }
      }
    }
  } finally {
    engine.dispose();
  }
  return (tabId, rowId, colId) => computed.get(`${tabId}\u0000${rowId}\u0000${colId}`);
}

export const sheetCodec = Object.freeze({
  name: ROOM_CODEC_NAME,
  version: ROOM_CODEC_VERSION,
  read,
  write,
  docBytes,
  validate,
  apply,
  size,
  ops,
  split,
  assemble,
  partOps,
  targets,
  creates,
  needs,
  removes,
  has,
  seen,
  fits: (doc, action) => validate(action) && placed(doc, action) && apply(copyOf(doc), action).out === "applied",
  conflicts,
  unseen,
  review,
  holds,
  describe,
  current,
  digest,
  preview,
  drawingsIn,
  results,
});
