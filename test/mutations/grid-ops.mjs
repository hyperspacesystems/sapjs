// node test/mutations/grid-ops.mjs [check-duplicate|check-shared-ids|check-tie|check-merge|check-long-row|check-short-row
//   |normalize-first-keeps|normalize-rekey-all|normalize-content|normalize-slots|normalize-hidden-text
//   |a1-base26|model-trailing|model-index
//   |ops-refuse-late|ops-inverse-fmt|ops-inverse-new|ops-covered|ops-batch-atomic|ops-empty-cell|ops-validate-cr|ops-formula-stale
//   |ops-stale-unknown|ops-stale-batch-member|ops-stale-auto
//   |rules-inverse-set|rules-validate|rules-dom-content|rules-rewrite|rules-reanchor|rules-inverse-list|rules-restore-guard|rules-anchored-abs|rules-room-revert
//   |rules-rebound|rules-moves-stay|rules-room-refusal|rules-standalone|rules-page-undo
//   |rows-tie|rows-exists|rows-inverse-cells|rows-frozen|rows-bad-key|rows-end|rows-formula-guard
//   |cols-shift|cols-rederive|cols-own-fmt|cols-inverse-cells
//   |merge-inverse-content|merge-grow|merge-anchor|merge-overlap|merge-cut|freeze-cut|ops-flat-inverse
//   |style-order|style-shorthand|style-filter|style-field|style-drop-unknown|style-border-collapse
//   |laws-inverse-fmt|laws-inverse-cells|laws-merge-grow
//   |fix-formula-result|fix-keep-style|fix-guard-tail|fix-fits-formula|fix-batch-needs
//   |fix-frozen-cols|fix-guard-survivors|fix-guard-after|fix-anchor-fmt
//   |x-split|x-mixed|x-overlap|x-semicolon|x-bg-null|x-row-height
//   |x-merge-clears|x-merge-targets|x-custom-fmt|x-normal-custom|x-gen-sort|x-text-carry|x-text-builtin
//   |x-norm-shift|x-span-bound
//   |build-outside|build-grow-limit|build-column-format|build-area-outside|build-format-covered
//   |build-import-formula|build-empty-item
//   |build-tie|build-tie-followers|build-like-content|build-like-covered|build-mint-check
//   |build-area-order|build-move-own-place|build-merge-clears
//   |build-empty-text|build-own-fmt|build-same-column-format|build-same-style|build-column-area
//   |build-style-shape|build-block-shape|build-border-preset|build-border-line
//   |build-mint-cap|build-same-size|build-same-freeze|build-line-kind|build-insert-limit
//   |build-insert-count|build-slot-end|build-slot-before|build-move-down|build-like-fields
//   |build-freeze-past|build-freeze-count|build-unmerge-outside
//   |speed-index-rebuild|speed-remove-reindex|speed-settle-all|speed-landing-walk|speed-merge-boxes
//   |speed-frozen-insert|speed-frozen-delete|speed-needs-walk|speed-order-insert|speed-order-delete
//   |speed-guard-copy|speed-delete-replay|speed-batch-refit|speed-batch-copies
//   |speed-settle-insert|speed-settle-remove|speed-settle-move|speed-repeated-id|speed-put-id
//   |speed-top-stale|speed-top-empty|speed-box-shift|speed-box-grow|speed-frozen-kept|speed-frozen-gone
//   |speed-guard-formula|speed-delete-merge|speed-batch-fits|speed-batch-thrown|speed-batch-inplace
//   |speed-batch-untried
//   |speed-anchor-walk|speed-list-rebuild|speed-sound-refit|speed-sound-rewrite
//   |speed-repeated-fits|speed-repeated-apply|speed-repeated-found|speed-repeated-delete
//   |speed-anchor-moved|speed-anchor-shift|speed-anchor-gone]
// Each entry puts one bug back into the grid engine and names the test that must then fail. With no
// argument every entry runs, one after another.
import { pathToFileURL } from "node:url";

import { mutate } from "./harness.mjs";

const CHECK = "src/grid/check.js";
const CHECK_TEST = "test/grid/check.test.js";
const NORMALIZE = "src/grid/normalize.js";
const NORMALIZE_TEST = "test/grid/normalize.test.js";
const A1 = "src/grid/a1.js";
const A1_TEST = "test/grid/a1.test.js";
const BACKING = "src/grid/backing-model.js";
const BACKING_TEST = "test/grid/backing-model.test.js";
const OPS = "src/grid/ops.js";
const STYLES = "src/grid/styles.js";
const OPS_TEST = "test/grid/ops-cells.test.js";
const STYLES_TEST = "test/grid/styles.test.js";
const ROWS_TEST = "test/grid/ops-rows.test.js";
const COLS_TEST = "test/grid/ops-cols.test.js";
const MERGE_TEST = "test/grid/ops-merge.test.js";
const LAWS_TEST = "test/grid/laws.test.js";
const BUILD = "src/grid/build.js";
const BUILD_CELLS_TEST = "test/grid/build-cells.test.js";
const BUILD_STRUCTURE_TEST = "test/grid/build-structure.test.js";
const SPEED_TEST = "test/grid/ops-speed.test.js";

const check = (what, find, replace, name, expects) => ({ what, file: CHECK, find, replace, test: CHECK_TEST, name, expects });

const normalize = (what, find, replace, name, expects) => ({ what, file: NORMALIZE, find, replace, test: NORMALIZE_TEST, name, expects });

const a1 = (what, find, replace, name, expects) => ({ what, file: A1, find, replace, test: A1_TEST, name, expects });

const backing = (what, find, replace, name, expects) => ({ what, file: BACKING, find, replace, test: BACKING_TEST, name, expects });

const ops = (what, find, replace, name, expects) => ({ what, file: OPS, find, replace, test: OPS_TEST, name, expects });

const rows = (what, find, replace, name) => ({ what, file: OPS, find, replace, test: ROWS_TEST, name, expects: /toBe|toEqual/ });

const cols = (what, find, replace, name) => ({ what, file: OPS, find, replace, test: COLS_TEST, name, expects: /toBe|toEqual/ });

const merges = (what, find, replace, name) => ({ what, file: OPS, find, replace, test: MERGE_TEST, name, expects: /toBe|toEqual/ });

const styles = (what, find, replace, name) => ({ what, file: STYLES, find, replace, test: STYLES_TEST, name, expects: /toBe|toEqual/ });

const laws = (what, find, replace, name) => ({ what, file: OPS, find, replace, test: LAWS_TEST, name, expects: /toBe|toEqual/ });

const cellBuilders = (what, find, replace, name) => ({ what, file: BUILD, find, replace, test: BUILD_CELLS_TEST, name, expects: /toBe|toEqual/ });

const structureBuilders = (what, find, replace, name, expects = /toBe|toEqual/) => ({ what, file: BUILD, find, replace, test: BUILD_STRUCTURE_TEST, name, expects });

const speed = (what, file, find, replace, name, expects = /toBe|toEqual/) => ({ what, file, find, replace, test: SPEED_TEST, name, expects });

const COST = "the cost follows the number of rows";
const COPIES = "the sheet is copied a fixed number of times";
const ID_MAP = "the row id map answers as a walk through the rows does";
const BROUGHT = "rows brought in one action land as they do one at a time";
const DELETED = "rows deleted in one action leave what one at a time leaves";

export const MUTATIONS = {
  "check-duplicate": check(
    "no repeated id is reported",
    "if (duplicate) issues.push(",
    "if (false) issues.push(",
    "row_id_duplicate",
    /toBe|toEqual/,
  ),
  "check-shared-ids": check(
    "rows and columns get separate id spaces",
    "      const duplicate = seen.has(id);\n      seen.add(id);",
    "      const shared = `${axis}:${id}`;\n      const duplicate = seen.has(shared);\n      seen.add(shared);",
    "shared id space",
    /toBe|toEqual/,
  ),
  "check-tie": check(
    "order compares pos alone, so valid ties are reported",
    "a.pos === b.pos && a.id > b.id",
    "false",
    "valid ties",
    /toBe|toEqual/,
  ),
  "check-merge": check(
    "a covered position is not checked for a hidden cell",
    "!own && hits > 0 && !hidden",
    "!own && hits > 0",
    "merge_uncovered",
    /toBe|toEqual/,
  ),
  "check-long-row": check(
    "long rows are not reported",
    "if (row.cells.length > sheet.cols.length)",
    "if (false)",
    "row_too_long",
    /toBe|toEqual/,
  ),
  "check-short-row": check(
    "merge positions past a short row's own cells are not checked",
    "c < Math.max(cells.length, cols); c++",
    "c < cells.length; c++",
    "a covered position past a short row's cells",
    /toBe|toEqual/,
  ),
  "normalize-first-keeps": normalize(
    "both holders of a repeated id get new names",
    "if (item.keeps) continue;",
    "if (false) continue;",
    "repair pairs",
    /toBe|toEqual/,
  ),
  "normalize-rekey-all": normalize(
    "every record gets a new key",
    "const stay = new Set(kept);",
    "const stay = new Set();",
    "repair pairs",
    /toBe|toEqual/,
  ),
  "normalize-content": {
    what: "a covered position that holds content is emptied when its merge is undone",
    file: NORMALIZE,
    find: "      } else if (covered && covered.hidden) {\n        target.cells[col + j] = uncovered(covered);",
    replace: "      } else if (covered) {\n        target.cells[col + j] = null;",
    test: "test/grid/grid-repair.test.js",
    name: "a merge across a row undone for the hidden text under it keeps the other text it covered",
    expects: /toBe|toEqual/,
  },
  "normalize-slots": normalize(
    "the plain HTML slot rule is skipped",
    "    if (same || textRows.has(r)) continue;",
    "    if (true) continue;",
    "plain HTML keeps every value in its column",
    /toBe|toEqual/,
  ),
  "normalize-hidden-text": normalize(
    "a hidden cell that held text comes back blank",
    'const shown = { ...cell, text: typeof item.text === "string" ? item.text : "" };',
    'const shown = { ...cell, text: "" };',
    "repair pairs",
    /toBe|toEqual/,
  ),
  "a1-base26": a1(
    "column letters roll over one short of Z, so every name past AZ is wrong",
    "    rest = Math.floor((rest - 1) / 26);",
    "    rest = Math.floor(rest / 26);",
    "column names",
    /toBe|toEqual/,
  ),
  "model-trailing": backing(
    "putCell keeps the trailing empty cells it pads with",
    "      cells[c] = cell ?? null;\n      trim(cells);",
    "      cells[c] = cell ?? null;",
    "putCell clears and pads",
    /toBe|toEqual/,
  ),
  "model-index": backing(
    "a removed row stays in the row id map",
    "      rowIds.delete(record.id);\n",
    "",
    "removeRow",
    /toBe|toEqual/,
  ),
  "ops-refuse-late": ops(
    "the covered-cell check runs after the putCell, so the cell before it is written anyway",
    "    if (backing.cell(r, c)?.hidden) return coveredRefusal(entry[0], entry[1]);\n    backing.putCell(r, c, next);",
    "    backing.putCell(r, c, next);\n    if (backing.cell(r, c)?.hidden) return coveredRefusal(entry[0], entry[1]);",
    "refused changes nothing",
    /toBe|toEqual/,
  ),
  "ops-inverse-fmt": ops(
    "the inverse leaves out the old fmt",
    "  const restore = { fmt: old && old.fmt !== undefined ? old.fmt : null };",
    "  const restore = {};",
    "inverse restores the bytes",
    /toBe|toEqual/,
  ),
  "ops-inverse-new": ops(
    "the inverse records the new content instead of the old",
    "  return [entry[0], entry[1], inverseContent(old), restore];",
    "  return [entry[0], entry[1], inverseContent(next), restore];",
    "inverse restores the bytes",
    /toBe|toEqual/,
  ),
  "ops-covered": ops(
    "a write into a merge's covered position is not refused",
    "    if (backing.cell(r, c)?.hidden) return coveredRefusal(entry[0], entry[1]);",
    "    if (false) return coveredRefusal(entry[0], entry[1]);",
    "refused changes nothing",
    /toBe|toEqual/,
  ),
  "ops-batch-atomic": ops(
    "a refused action in a batch leaves the ones before it applied",
    "        for (let i = done.length - 1; i >= 0; i--) applyOne(backing, done[i], { derive, formulas, computed });\n",
    "",
    "batch is all or nothing",
    /toBe|toEqual/,
  ),
  "ops-empty-cell": ops(
    "an empty cell with no format is kept as { text: '' } instead of null",
    "  if (style !== undefined) next.style = style;\n  return blank(next) ? null : next;",
    "  if (style !== undefined) next.style = style;\n  return next;",
    "pinned: clearing a cell",
    /toBe|toEqual/,
  ),
  "ops-validate-cr": ops(
    "a carriage return in text is accepted",
    '  if (typeof value !== "string") bad(`${what} is not text`);\n  if (value.includes("\\0")) bad(`${what} holds a NUL`);\n  if (value.includes("\\r")) bad(`${what} holds a carriage return`);',
    '  if (typeof value !== "string") bad(`${what} is not text`);\n  if (value.includes("\\0")) bad(`${what} holds a NUL`);\n  if (false) bad(`${what} holds a carriage return`);',
    "validate",
    /toBe|toEqual/,
  ),
  "rows-tie": rows(
    "order compares pos alone, so two rows with one key land in the order they came",
    "  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;",
    "  return 0;",
    "ties land in id order",
  ),
  "rows-exists": rows(
    "a new id that is already in the sheet is not refused",
    "    if (backing.rowIndex(record.id) >= 0 || backing.colIndex(record.id) >= 0) {",
    "    if (false) {",
    "exists",
  ),
  "rows-inverse-cells": rows(
    "the inverse of a delete leaves out the row\u0027s cells",
    "  if (cells.length > 0) record.cells = cells;",
    "  if (false) record.cells = cells;",
    "delete comes back whole",
  ),
  "rows-frozen": rows(
    "a row inserted before the last frozen row is not frozen",
    "    if (record.frozen === true || at < frozen) backing.setFrozen({ rows: frozen + 1 });",
    "    if (record.frozen === true) backing.setFrozen({ rows: frozen + 1 });",
    "frozen",
  ),
  "rows-bad-key": rows(
    "an order key that is not a key is accepted",
    '  if (!isKey(value)) throw new GridRefused("bad_key", `${what} is not an order key`);',
    '  if (false) throw new GridRefused("bad_key", `${what} is not an order key`);',
    "refusals",
  ),
  "rows-end": rows(
    "a new row goes at the end instead of where its key sorts",
    "  for (let i = 0; i < rows.length; i++) if (compareRows(rows[i], record) > 0) return i;",
    "  return rows.length;",
    "pinned: insert in the middle",
  ),
  "rows-formula-guard": rows(
    "the formula guard is removed",
    "const guarded = (backing, action, formulas) => {\n  if (formulas !== null) return false;",
    "const guarded = (backing, action, formulas) => {\n  return false;",
    "formula guard",
  ),
  "cols-shift": cols(
    "a column insert puts the record in place but leaves the rows\u0027 cells where they were",
    "    backing.insertCol(at, record);",
    "    backing.insertCol(backing.cols().length, record);\n    backing.cols().splice(at, 0, backing.cols().pop());\n    backing.putCol(at, record);",
    "cells follow their column",
  ),
  "cols-rederive": cols(
    "a column fmt change does not derive the cells again",
    "deriveColCells(backing, action, from, derive)",
    "[]",
    "column format derives again",
  ),
  "cols-own-fmt": cols(
    "cells with their own fmt are derived again too, under the column\u0027s format",
    "    if (old.fmt !== undefined) return;",
    "    if (false) return;",
    "column format derives again",
  ),
  "cols-inverse-cells": cols(
    "the inverse of a column delete leaves out the column\u0027s cells",
    "  if (cells.length) record.cells = cells;",
    "  if (false) record.cells = cells;",
    "delete comes back whole",
  ),
  "merge-inverse-content": merges(
    "the inverse of a merge leaves out the cleared cells",
    "  if (restore.length > 0) actions.push({ v: 1, t: \"set\", sheet: action.sheet, cells: restore });\n  for (const box of boxes) {",
    "  for (const box of boxes) {",
    "merge clears and the inverse brings it back",
  ),
  "merge-grow": merges(
    "an insert inside a merge does not grow the span",
    "{ ...backing.cell(box.row, box.col), rowspan: box.rs + 1 }",
    "{ ...backing.cell(box.row, box.col), rowspan: box.rs }",
    "insert grows a merge",
  ),
  "merge-anchor": merges(
    "the anchor that moves down loses its content",
    "  const content = contentOf(anchor);",
    "  const content = null;",
    "deleting the anchor moves it",
  ),
  "merge-overlap": merges(
    "a merge that crosses the edge of another is not refused",
    "  if (boxes.some((box) => touches(box, top, bottom, left, right) && !holds(box, top, bottom, left, right))) {",
    "  if (false) {",
    "refusals",
  ),
  "merge-cut": merges(
    "a merge across the frozen row line is not refused",
    "  if (top < frozen.rows && bottom >= frozen.rows) {",
    "  if (false) {",
    "refusals",
  ),
  "freeze-cut": merges(
    "a freeze line that cuts a merge is not refused",
    "  if (cutsFrozen(backing, nextRows)) {",
    "  if (false) {",
    "refusals",
  ),
  "ops-formula-stale": ops(
    "a new formula does not mark the table stale",
    'if (!computed && action.t === "set" && action.cells.some((entry) => isFormula(entry[2]))) backing.setStale(true);',
    "",
    "stale",
    /toBe|toEqual/,
  ),
  "ops-stale-unknown": {
    what: "a number written under a format no formatter knows leaves the table unmarked in the reducer, so the model backing and the live table disagree",
    file: OPS,
    find: "  if (out.out === \"applied\" && leavesWaiting(backing, out.changes.cells)) backing.setStale(true);\n",
    replace: "",
    test: "test/grid/stale.test.js",
    name: "a host writing through the model backing gets the same stale mark and bytes as the live table: marked for a number under a format no formatter knows, not under a known format or none",
    expects: /toBe|toEqual/,
  },
  "ops-stale-batch-member": {
    what: "each action of a batch is judged on its own, so a batch that shows a number plain between two of its actions marks the table",
    file: OPS,
    find: "      const out = each(backing, one, { derive, formulas, computed });\n",
    replace: "      const out = marked(backing, each(backing, one, { derive, formulas, computed }));\n",
    test: "test/grid/ops-cells.test.js",
    name: "a batch judges its stale mark once, on the cells it leaves: a number it shows plain and then clears marks nothing",
    expects: /toBe|toEqual/,
  },
  "ops-stale-auto": {
    what: "every number shown as its plain value marks the table, under a known format or none too",
    file: "src/grid/content.js",
    find: 'return cell?.n === true && cell.v === undefined && fmtKind(fmt) === "unknown";',
    replace: "return cell?.n === true && cell.v === undefined;",
    test: "test/grid/stale.test.js",
    name: "a host writing through the model backing gets the same stale mark and bytes as the live table: marked for a number under a format no formatter knows, not under a known format or none",
    expects: /toBe|toEqual/,
  },
  "style-order": styles(
    "styles are written in the order they came in",
    "const ordered = pairs.slice().sort((a, b) => STYLE_PROPERTIES.indexOf(a[0]) - STYLE_PROPERTIES.indexOf(b[0]));",
    "const ordered = pairs;",
    "one order for every input order",
  ),
  "style-shorthand": styles(
    "a color is not normalized, so one idea has many spellings",
    "const colorOf = (value) => {",
    "const colorOf = (value) => {\n  return value;",
    "spelling",
  ),
  "style-filter": styles(
    "filterStyle is skipped, so a url() value is written",
    "  const filtered = filterStyle(text);",
    "  const filtered = text;",
    "hostile input",
  ),
  "style-field": {
    what: "one style target for the whole map instead of one per property",
    file: OPS,
    find: "for (const property of Object.keys(extra.style)) out.push([action.sheet, entry[0], entry[1], `style:${targetOf(property, extra.style[property])}`]);",
    replace: "out.push([action.sheet, entry[0], entry[1], \"style\"]);",
    test: STYLES_TEST,
    name: "styles through actions",
    expects: /toBe|toEqual/,
  },
  "style-drop-unknown": styles(
    "a value outside the spelling tables is dropped",
    "return [\"font-weight\", value];",
    "return null;",
    "a value outside the tables is kept",
  ),
  "style-border-collapse": styles(
    "four equal sides are not collapsed into one border",
    "const equal = allSides && sides.every((value) => value === sides[0]);",
    "const equal = false;",
    "borders",
  ),
  "ops-flat-inverse": merges(
    "a batch's inverse keeps an inner batch nested, so a redo after an undo is refused",
    "actions: flatInverse(done) }",
    "actions: done.slice().reverse() }",
    "merge clears and the inverse brings it back",
    /toBe|toEqual/,
  ),
  "laws-inverse-fmt": laws(
    "the inverse leaves out the old fmt",
    "  const restore = { fmt: old && old.fmt !== undefined ? old.fmt : null };",
    "  const restore = {};",
    "reducer laws over seeded lists",
  ),
  "laws-inverse-cells": laws(
    "the inverse of a delete leaves out the row's cells",
    "  if (cells.length > 0) record.cells = cells;",
    "  if (false) record.cells = cells;",
    "reducer laws over seeded lists",
  ),
  "laws-merge-grow": laws(
    "an insert inside a merge does not grow the span",
    "{ ...backing.cell(box.row, box.col), rowspan: box.rs + 1 }",
    "{ ...backing.cell(box.row, box.col), rowspan: box.rs }",
    "reducer laws over seeded lists",
  ),
  "fix-formula-result": {
    what: "an inverse restoring a formula leaves out its stored result",
    file: OPS,
    find: "return { f: cell.f, r: typed(cell.v ?? cell.text, cell.t === true) };",
    replace: "return { f: cell.f };",
    test: ROWS_TEST,
    name: "delete comes back whole",
    expects: /toBe|toEqual/,
  },
  "fix-keep-style": {
    what: "canonStyle drops the declarations the engine did not write",
    file: STYLES,
    find: "if (kept.length > 0) parts.push(kept.join(\";\"));",
    replace: "if (false) parts.push(kept.join(\";\"));",
    test: STYLES_TEST,
    name: "a style the engine did not write keeps its look",
    expects: /toBe|toEqual/,
  },
  "fix-guard-tail": {
    what: "the formula guard refuses a delete of a tail block",
    file: OPS,
    find: "  const boxes = mergeRecords(backing);\n  if (guarded(backing, action, formulas) && movesRows(backing, action)) return engineRefusal();\n  for (const id of action.rows) {",
    replace: "  const boxes = mergeRecords(backing);\n  if (guarded(backing, action, formulas) && action.rows.length > 1) return engineRefusal();\n  for (const id of action.rows) {",
    test: ROWS_TEST,
    name: "formula guard",
    expects: /toBe|toEqual/,
  },
  "fix-fits-formula": {
    what: "the trial derive drops a formula written earlier in the action",
    file: OPS,
    find: "const trial = (content, fmt, result) => derivePlain(content, fmt, result);",
    replace: "const trial = () => ({ text: \"\" });",
    test: ROWS_TEST,
    name: "fits agrees with apply",
    expects: /toBe|toEqual/,
  },
  "fix-batch-needs": {
    what: "needs of a batch ignores what an earlier action creates",
    file: OPS,
    find: "      for (const id of part.rows) if (!madeRows.has(id) && !rows.includes(id)) rows.push(id);",
    replace: "      for (const id of part.rows) if (!rows.includes(id)) rows.push(id);",
    test: ROWS_TEST,
    name: "needs, creates, targets",
    expects: /toBe|toEqual/,
  },
  "fix-frozen-cols": {
    what: "the column frozen line limits merges again",
    file: OPS,
    find: "  if (top < frozen.rows && bottom >= frozen.rows) {",
    replace: "  if ((top < frozen.rows && bottom >= frozen.rows) || (left < frozen.cols && right >= frozen.cols)) {",
    test: MERGE_TEST,
    name: "pinned",
    expects: /toBe|toEqual/,
  },
  "fix-guard-survivors": {
    what: "the guard counts every formula in the table",
    file: OPS,
    find: "  return backing.hasFormula() && (holdsFormula(backing, rows, cols) || holdsFormula(after, rows, cols));",
    replace: "  return backing.hasFormula();",
    test: ROWS_TEST,
    name: "formula guard",
    expects: /toBe|toEqual/,
  },
  "fix-guard-after": {
    what: "the guard looks only at formulas that are there before the action",
    file: OPS,
    find: "  return backing.hasFormula() && (holdsFormula(backing, rows, cols) || holdsFormula(after, rows, cols));",
    replace: "  return holdsFormula(backing, rows, cols);",
    test: MERGE_TEST,
    name: "refusals",
    expects: /toBe|toEqual/,
  },
  "x-split": styles(
    "a declaration splits on every ;",
    'else if (ch === ";" && depth === 0) {',
    'else if (ch === ";") {',
    "a declaration splits the way css does",
  ),
  "x-mixed": styles(
    "canonStyle reorders a mixed style",
    "  if (isMixedStyle(css)) {",
    "  if (false) {",
    "a kept declaration in the way of a listed property",
  ),
  "x-overlap": styles(
    "applying a style map leaves an overlapping kept declaration",
    "      if (!covers(name, property)) next.push([name, value, trimmed]);\n      else for (const [left, text] of remainder(name, value, property)) next.push([left, value, text]);",
    "      next.push([name, value, trimmed]);",
    "a kept declaration in the way of a listed property",
  ),
  "x-semicolon": {
    what: "a style value may hold a second declaration",
    file: OPS,
    find: '/[;{}<\\0\\r\\n]/.test(value)',
    replace: 'false',
    test: STYLES_TEST,
    name: "a style value holds one declaration, not two",
    expects: /toBe|toEqual/,
  },
  "x-bg-null": {
    what: "a background key null leaves a stored background colour",
    file: OPS,
    find: '      if (property === "background") kept.delete("background-color");',
    replace: '      if (false) kept.delete("background-color");',
    test: STYLES_TEST,
    name: "a background key names the background colour",
    expects: /toBe|toEqual/,
  },
  "x-row-height": {
    what: "the height inverse drops the row\u0027s whole style",
    file: OPS,
    find: '      before.style = row.style === undefined ? "" : row.style;',
    replace: "      before.height = null;",
    test: ROWS_TEST,
    name: "undo of a height change puts the row style back",
    expects: /toBe|toEqual/,
  },
  "x-merge-clears": merges(
    "apply ignores the cells a merge names",
    "if (!sameIds(clearedBetween(backing, top, bottom, left, right), action.clears ?? [])) {",
    "if (false && !sameIds(clearedBetween(backing, top, bottom, left, right), action.clears ?? [])) {",
    "refusals",
  ),
  "x-merge-targets": laws(
    "targets of a merge leaves out the cells it clears",
    '    for (const [row, col] of action.clears ?? []) {\n      out.push(\n        [action.sheet, row, col, "content"],\n        [action.sheet, row, col, "fmt"],\n        [action.sheet, row, col, "style:*"],\n        [action.sheet, row, col, "span"],\n      );\n    }\n',
    "",
    "reducer laws over seeded lists",
  ),
  "x-custom-fmt": ops(
    "cellFor derives a cell whose format the grid does not know",
    "const keepText = !set && old && (fmt === old.fmt || (fmt !== undefined && fmt === oldEffective)) && effective !== null && !isBuiltin(effective);",
    "const keepText = false;",
    "a format the grid does not know keeps the cell\u0027s text",
    /toBe|toEqual/,
  ),
  "x-normal-custom": normalize(
    "normalForm derives a cell whose format the grid does not know",
    "const custom = fmt !== null && !isBuiltin(fmt);",
    "const custom = false;",
    "a format the grid does not know keeps the cell\u0027s text",
    /toBe|toEqual/,
  ),
  // The mutant crashes the engine on the second record before a law can compare: that counts.
  "x-gen-sort": { ...laws(
    "a move with several records applies only the first",
    '    if (cut !== null) return cutRefusal(cut);\n  }\n  if (guarded(backing, action, formulas) && movesRows(backing, action)) return engineRefusal();\n  for (const record of action.rows) {',
    '    if (cut !== null) return cutRefusal(cut);\n  }\n  if (guarded(backing, action, formulas) && movesRows(backing, action)) return engineRefusal();\n  for (const record of action.rows.slice(0, 1)) {',
    "reducer laws over seeded lists",
  ), expects: /toBe|toEqual|TypeError/ },
  "x-text-carry": ops(
    "the delete inverse leaves out the text of a cell whose format the grid does not know",
    '    const extra = cellExtra(cell, col);\n    cells.push([row.id, inverseContent(cell), extra]);',
    '    const extra = cellExtra(cell, col);\n    delete extra.text;\n    cells.push([row.id, inverseContent(cell), extra]);',
    "undo brings back a custom format\u0027s text after a delete of the column",
    /toBe|toEqual/,
  ),
  "x-text-builtin": ops(
    "apply accepts a text under a format the grid knows",
    "if (extra.text !== undefined && effective !== null && !isBuiltin(effective)) {",
    "if (extra.text !== undefined) {",
    "apply ignores a text under a built-in format",
    /toBe|toEqual/,
  ),
  "x-norm-shift": normalize(
    "an undone merge splices its covered placeholders out, so every later value moves one column left",
    "        target.cells[col + j] = uncovered(covered);",
    "        { target.cells.splice(col + j, 1); target.cells.push(null); }",
    "a damaged copy keeps every value in its browser column",
    /toEqual|toBe/,
  ),
  "x-span-bound": check(
    "the cover loop is not bounded by the sheet",
    "      const down = Math.min(rs, rows - r);\n      const across = Math.min(cs, cols - c);",
    "      const down = rs;\n      const across = cs;",
    "span_too_big",
    /toBe|toEqual|Map maximum size/,
  ),
  "fix-anchor-fmt": {
    what: "a moved anchor does not take its old effective format",
    file: OPS,
    find: "  const own = oldFmt === null ? undefined : oldFmt === hereFmt ? anchor.fmt : oldFmt;",
    replace: "  const own = anchor.fmt;",
    test: MERGE_TEST,
    name: "deleting the anchor moves it",
    expects: /toBe|toEqual/,
  },
  "x5-cr": rows(
    "a whole style accepts a carriage return, which the writer cannot write",
    '  if (typeof value !== "string") bad(`${what} is text`);\n  if (value.includes("\\0")) bad(`${what} holds a NUL`);\n  if (value.includes("\\r")) bad(`${what} holds a carriage return`);',
    '  if (typeof value !== "string") bad(`${what} is text`);\n  if (value.includes("\\0")) bad(`${what} holds a NUL`);',
    "invalid actions",
  ),
  "y-whole-style": {
    what: "a row's style must be a whole style the engine writes",
    file: OPS,
    find: 'function checkWholeStyle(value, what) {\n  if (typeof value !== "string") bad(`${what} is text`);',
    replace: 'function checkWholeStyle(value, what) {\n  if (typeof value !== "string") bad(`${what} is text`);\n  if (what.startsWith("rows") && canonStyle(value) !== value) bad(`${what} is not a whole style the engine writes`);',
    test: ROWS_TEST,
    name: "undo of a row delete puts back a hand-written style",
    expects: /toBe|toEqual/,
  },
  "y-shorthand": styles(
    "the overlap expands a kept border again",
    'const covers = (name, property) => {\n  if (name === property) return true;\n  if (property === "background-color" && name === "background") return true;\n  return false;\n};\n\n// Y2: an edit never expands a shorthand or drops a declaration it does not name. The new declaration\n// is appended after every other one, so it wins over a shorthand before it in CSS.\nconst remainder = () => [];',
    'const covers = (name, property) => {\n  if (name === property) return true;\n  if (property === "background-color" && name === "background") return true;\n  if (name === "border") return BORDER_SIDES.includes(property);\n  return false;\n};\n\nconst remainder = (name, value, property) =>\n  name === "border" ? BORDER_SIDES.filter((one) => one !== property).map((one) => [one, `${one}:${value}`]) : [];',
    "a kept declaration in the way of a listed property",
  ),
  "y-redo": {
    what: "a mixed style edit is stored without canonStyle",
    file: OPS,
    find: "if (isMixedStyle(oldStyle)) return canonStyle(mixedNext(oldStyle, changes));",
    replace: "if (isMixedStyle(oldStyle)) return mixedNext(oldStyle, changes);",
    test: STYLES_TEST,
    name: "redo after undo of a mixed style edit brings the edit back",
    expects: /toBe|toEqual/,
  },
  "y-hidden-text": normalize(
    "plainHtml rewrites the rows hiddenText handles",
    "function plainHtml(sheet, repairs, textRows = new Set()) {",
    "function plainHtml(sheet, repairs, textRows = new Set()) {\n  textRows = new Set();",
    "the repair does not write hidden text over a value",
    /toBe|toEqual/,
  ),
  "y-stacked-spans": normalize(
    "the slot walk is not bounded by the column clamp",
    "  width = Math.min(width, MAX_COLS);",
    "  width = width;",
    "stacked huge spans repair under the bound",
    /toBe|toEqual/,
  ),
  "y-anchor-text": laws(
    "a moved anchor loses its text",
    "  const content = contentOf(anchor);",
    "  const content = null;",
    "reducer laws over seeded lists",
  ),
  "y-anchor-style": laws(
    "a moved anchor loses its style",
    "  if (anchor.style !== undefined) next.style = anchor.style;",
    "",
    "reducer laws over seeded lists",
  ),
  "y-resize-target": rows(
    "a height change does not name the row style it touches",
    '      if (record.height !== undefined) {\n        out.push([action.sheet, "row", record.id, "height"]);\n        out.push([action.sheet, "row", record.id, "rowstyle"]);\n      }',
    '      if (record.height !== undefined) out.push([action.sheet, "row", record.id, "height"]);',
    "needs, creates, targets",
  ),
  "build-outside": cellBuilders(
    "a block past the last row or column is built without grow",
    "if (!grow) refuse(",
    "if (false) refuse(",
    "a block past the last row or column is refused without grow",
  ),
  "build-grow-limit": cellBuilders(
    "grow has no limit",
    "if (moreRows > GROW_ROWS || moreCols > GROW_COLS) {",
    "if (false) {",
    "grow stops at 10,000 new rows and 1,000 new columns",
  ),
  "build-column-format": cellBuilders(
    "a whole column format leaves each cell's own format in place",
    'return format === null ? defaults : { v: 1, t: "batch", actions: [defaults, format] };',
    "return defaults;",
    "a whole column format clears each cell's own format in the same batch",
  ),
  "build-area-outside": cellBuilders(
    "an area past the last row or column is not refused",
    "if (rect.bottom >= rows || rect.right >= cols) refuse(",
    "if (false) refuse(",
    "an area past the last row or column is refused",
  ),
  "build-format-covered": cellBuilders(
    "a format names a merge's covered cells",
    "    if (cell && cell.hidden) return;\n",
    "",
    "a format skips a merge's covered cells",
  ),
  "build-import-formula": cellBuilders(
    "an import always keeps formulas",
    "{ grow: true, formulas, newId }",
    "{ grow: true, formulas: true, newId }",
    "an import grows the sheet and writes a formula as text",
  ),
  "build-empty-item": cellBuilders(
    "an empty item is written over an empty or covered cell",
    "      if (content === null && extra === undefined && !hasContent(old)) return;\n",
    "",
    "an empty item over an empty or covered cell is left out",
  ),
  "build-tie": structureBuilders(
    "no tie rule: an insert between two records that share a key throws",
    "  if (low !== null) while (end < others.length && others[end].pos === low) end++;\n",
    "",
    "an insert between two records that share a key",
    /is not before/,
  ),
  "build-tie-followers": structureBuilders(
    "the records after the insert point keep the shared key, so the new record lands after them",
    "followers: others.slice(at, end).map(",
    "followers: others.slice(at, at).map(",
    "an insert between two records that share a key",
  ),
  "build-like-content": structureBuilders(
    "like copies each cell's content",
    "cells.push([other.id, null, extra]);",
    "cells.push([other.id, cellValue(cell), extra]);",
    "like copies formats and never content",
  ),
  "build-like-covered": structureBuilders(
    "like writes into a cell the new record is covered in",
    "if (!cell || cell.hidden || covered.has(cross)) return;",
    "if (!cell || cell.hidden) return;",
    "like leaves out a cell the new records are covered in",
  ),
  "build-mint-check": structureBuilders(
    "an id the sheet has is accepted",
    "      if (!free(id)) continue;\n",
    "",
    "an id the sheet has, or one this action has taken, is asked for again",
  ),
  "build-area-order": structureBuilders(
    "a reversed range names the wrong rows",
    "Math.max(a.row, b.row)",
    "b.row",
    "a reversed range names the same records in sheet order",
  ),
  "build-move-own-place": structureBuilders(
    "a block moved to its own place gets new keys",
    "  if (at >= first && at <= last + 1) return null;\n",
    "",
    "a block moved to its own place gives no action",
  ),
  "build-merge-clears": structureBuilders(
    "a merge names no cell to clear",
    "&& cell && !blank(cell)) clears.push(",
    "&& false) clears.push(",
    "a merge names every other cell in it that holds something",
  ),
  "build-empty-text": cellBuilders(
    "empty text in a block is written as content",
    'const content = raw === "" ? null : raw;',
    "const content = raw;",
    "empty text in a block is no content",
  ),
  "build-own-fmt": cellBuilders(
    "a cell takes a format equal to its column's as its own",
    "const want = fmt === colFmt ? null : fmt;",
    "const want = fmt;",
    "a block item's format equal to its column's is not written",
  ),
  "build-same-column-format": cellBuilders(
    "a column format the column already shows is written again",
    ".filter((col) => (col.fmt ?? null) !== fmt)",
    "",
    "a request for what the sheet already has gives no action",
  ),
  "build-same-style": cellBuilders(
    "a style property a cell does not hold is removed from it",
    "if (map[property] !== null || held.has(property)) out[property]",
    "out[property]",
    "a request for what the sheet already has gives no action",
  ),
  "build-column-area": cellBuilders(
    "a column format takes an area that is not whole columns",
    "if (!rectOf(view, area).wholeCols) refuse(",
    "if (false) refuse(",
    "a whole column format clears each cell's own format in the same batch",
  ),
  "build-style-shape": cellBuilders(
    "a style that is not an object of properties is taken",
    'if (style === null || typeof style !== "object" || Array.isArray(style)) refuse(',
    "if (false) refuse(",
    "a request the builders cannot read is refused with a code",
  ),
  "build-block-shape": cellBuilders(
    "a block that is not a list of rows is taken",
    "if (!Array.isArray(block) || !block.every(Array.isArray)) refuse(",
    "if (false) refuse(",
    "a request the builders cannot read is refused with a code",
  ),
  "build-border-preset": cellBuilders(
    "a border with an unknown preset is taken",
    'if (border === null || typeof border !== "object" || !PRESETS.includes(border.preset)) refuse(',
    "if (false) refuse(",
    "a request the builders cannot read is refused with a code",
  ),
  "build-border-line": cellBuilders(
    "a border preset with no line is taken",
    'if (border.preset !== "none" && typeof border.line !== "string") refuse(',
    "if (false) refuse(",
    "a request the builders cannot read is refused with a code",
  ),
  "build-mint-cap": structureBuilders(
    "a newId that keeps giving taken ids is asked one more time",
    "const MINT_TRIES = 100;",
    "const MINT_TRIES = 101;",
    "a newId that keeps giving taken ids is refused after 100 tries",
  ),
  "build-same-size": structureBuilders(
    "a height or width a record already has is written again",
    ".filter((record) => axis.sizeOf(record) !== size)",
    "",
    "a request for what the sheet already has gives no action",
  ),
  "build-same-freeze": structureBuilders(
    "a freeze count the sheet already has is written again",
    "if (count !== frozen[axis.name]) action[axis.through] = through;",
    "action[axis.through] = through;",
    "a request for what the sheet already has gives no action",
  ),
  "build-line-kind": structureBuilders(
    "an area of whole columns names every row",
    "if (rect[axis.crossWhole]) refuse(",
    "if (false) refuse(",
    "a request the builders cannot read is refused with a code",
  ),
  "build-insert-limit": structureBuilders(
    "an insert has no limit",
    "if (count > axis.limit) refuse(",
    "if (false) refuse(",
    "a count at the limit builds and one more is refused",
  ),
  "build-insert-count": structureBuilders(
    "an insert takes a count that is not a whole number from 1",
    "if (!Number.isInteger(count) || count < 1) refuse(",
    "if (false) refuse(",
    "a request the builders cannot read is refused with a code",
  ),
  "build-slot-end": structureBuilders(
    "new records go further than one past the last record",
    "if (at > axis.records(view).length) refuse(",
    "if (false) refuse(",
    "a request past the sheet's last row or column is refused",
  ),
  "build-slot-before": structureBuilders(
    "new records go before something that is not a row number or a column name",
    "if (at < 0) refuse(",
    "if (false) refuse(",
    "a request the builders cannot read is refused with a code",
  ),
  "build-move-down": structureBuilders(
    "a block moved down lands its own length too far",
    "at < first ? at : at - moved.length",
    "at",
    "a block moved down lands before the record the request names",
  ),
  "build-like-fields": structureBuilders(
    "like copies no field of the record",
    "  for (const key of axis.copied) if (record[key] !== undefined) fields[key] = record[key];\n",
    "",
    "like copies formats and never content",
  ),
  "build-freeze-past": structureBuilders(
    "a freeze takes more records than the sheet has",
    "if (count > records.length) refuse(",
    "if (false) refuse(",
    "a request past the sheet's last row or column is refused",
  ),
  "build-freeze-count": structureBuilders(
    "a freeze takes a count that is not a whole number from 0",
    "if (!Number.isInteger(count) || count < 0) refuse(",
    "if (false) refuse(",
    "a request the builders cannot read is refused with a code",
  ),
  "build-unmerge-outside": structureBuilders(
    "an unmerge takes a cell past the sheet",
    "if (row >= view.rows().length || col >= view.cols().length) refuse(",
    "if (false) refuse(",
    "a request past the sheet's last row or column is refused",
  ),
  "speed-index-rebuild": speed(
    "every row that comes in builds the whole row id map again",
    BACKING,
    "      const fresh = distinct && !rowIds.has(row.id);",
    "      const fresh = false;",
    COST,
  ),
  "speed-remove-reindex": speed(
    "every row that leaves gives each row after it a new place in the row id map at once",
    BACKING,
    "      if (distinct) settled = Math.min(settled, r);\n      else for (let i = r; i < store.rows.length; i++) rowIds.set(store.rows[i].id, i);",
    "      for (let i = r; i < store.rows.length; i++) rowIds.set(store.rows[i].id, i);",
    COST,
  ),
  "speed-settle-all": speed(
    "a lookup that finds a place out of date puts every later row right, not only the rows up to the one it wants",
    BACKING,
    "      if (row.id === id) break;\n",
    "",
    COST,
  ),
  "speed-landing-walk": speed(
    "every record walks the rows from the top to find where it lands",
    OPS,
    "const at = top !== null && compareRows(top, record) <= 0 ? rows.length : landing(rows, record);",
    "const at = landing(rows, record);",
    COST,
  ),
  "speed-merge-boxes": speed(
    "the merge boxes are read from the whole sheet for every record",
    OPS,
    "    const grown = boxes.filter((box) => box.row < at && at <= box.bottom);",
    "    const grown = mergeBoxes(backing).filter((box) => box.row < at && at <= box.bottom);",
    COST,
  ),
  "speed-frozen-insert": speed(
    "the frozen rows are counted again for every record an insert brings",
    OPS,
    "    const at = lands(record);\n",
    "    const at = lands(record);\n    frozen = backing.frozen().rows;\n",
    COST,
  ),
  "speed-frozen-delete": speed(
    "the frozen rows are counted again for every row a delete takes",
    OPS,
    "    const at = backing.rowIndex(id);\n    const was = backing.rows()[at].frozen === true;",
    "    const at = backing.rowIndex(id);\n    frozen = backing.frozen().rows;\n    const was = backing.rows()[at].frozen === true;",
    COST,
  ),
  "speed-needs-walk": speed(
    "needs walks the list of brought ids for every cell",
    OPS,
    "    if (!seenRows.has(entry[0])) rows.push(entry[0]);\n    if (!seenCols.has(entry[1])) cols.push(entry[1]);\n",
    "    if (!rows.includes(entry[0]) && !brought.rows.includes(entry[0])) rows.push(entry[0]);\n    if (!cols.includes(entry[1]) && !brought.cols.includes(entry[1])) cols.push(entry[1]);\n",
    COST,
  ),
  "speed-order-insert": speed(
    "the formula guard walks the order from the top for every record an insert brings",
    OPS,
    "order.splice(lands(record), 0, { id: record.id, pos: record.pos });",
    "order.splice(landing(order, record), 0, { id: record.id, pos: record.pos });",
    COST,
  ),
  "speed-order-delete": speed(
    "the formula guard walks the order from the top for every row a delete takes",
    OPS,
    "    return records.filter((record) => !gone.delete(record.id)).map((record) => record.id);",
    "    const order = records.map((record) => record.id);\n    for (const id of gone) {\n      const at = order.findIndex((one) => one === id);\n      if (at >= 0) order.splice(at, 1);\n    }\n    return order;",
    COST,
  ),
  "speed-guard-copy": speed(
    "the formula guard writes the action on a copy of a sheet that has no formula",
    OPS,
    "  if (!ruled && !backing.hasFormula()) return false;\n",
    "  if (!ruled) return false;\n",
    COPIES,
  ),
  "speed-delete-replay": speed(
    "a delete that changes no merge still writes its insert on a copy of the sheet",
    OPS,
    "  if (boxes.some((box) => box.changed)) {",
    "  if (true) {",
    COPIES,
  ),
  "speed-batch-refit": speed(
    "a batch that fits has tried is tried again, action by action, as it is written",
    OPS,
    "  return applyFitted(backing, action, options);\n",
    "  return applyFitted(backing, action, options, apply);\n",
    COPIES,
  ),
  "speed-batch-copies": speed(
    "fits copies the sheet for every action of a batch",
    OPS,
    "      fitted = fitOne(scratch, one, { formulas, inPlace: true });",
    "      fitted = fitOne(scratch, one, { formulas });\n      if (fitted === true) fitOne(scratch, one, { formulas, inPlace: true });",
    COPIES,
  ),
  "speed-settle-insert": speed(
    "a row that comes in after rows that wait for their place marks them as in place",
    BACKING,
    "        if (settled >= r) settled = r + 1;",
    "        settled = r + 1;",
    ID_MAP,
  ),
  "speed-settle-remove": speed(
    "the rows after one that leaves keep their old place in the row id map",
    BACKING,
    "      if (distinct) settled = Math.min(settled, r);",
    "      if (distinct) settled = Math.min(settled, store.rows.length);",
    ID_MAP,
  ),
  "speed-settle-move": speed(
    "the rows a moved row passes on its way up keep their old place in the row id map",
    BACKING,
    "      if (distinct) settled = Math.min(settled, from, to);",
    "      if (distinct) settled = Math.min(settled, from);",
    ID_MAP,
  ),
  "speed-repeated-id": speed(
    "a table with a repeated row id gets the lazy row id map",
    BACKING,
    "    distinct = rowIds.size === settled;",
    "    distinct = true;",
    "a table with a repeated row id",
  ),
  "speed-put-id": backing(
    "a row that gets a new id keeps its old one in the row id map",
    "      if (\"id\" in fields || !distinct) indexRows();",
    "      if (!distinct) indexRows();",
    "putRow",
    /toBe|toEqual/,
  ),
  "speed-top-stale": speed(
    "a record that lands at the end is not the one the next record is compared with",
    OPS,
    "    if (at === rows.length) top = record;\n",
    "",
    BROUGHT,
  ),
  "speed-top-empty": speed(
    "a sheet with no row is asked for its last row",
    OPS,
    "const at = top !== null && compareRows(top, record) <= 0 ? rows.length : landing(rows, record);",
    "const at = compareRows(top, record) <= 0 ? rows.length : landing(rows, record);",
    "a sheet with no row takes rows",
    /Cannot read properties of null/,
  ),
  "speed-box-shift": speed(
    "a merge below a row that came in is still looked for at its old rows",
    OPS,
    "    if (box.row >= at) {\n      box.row += 1;\n      box.bottom += 1;\n    } else if (box.bottom >= at) {",
    "    if (box.row < at && box.bottom >= at) {",
    BROUGHT,
  ),
  "speed-box-grow": speed(
    "a merge a row landed inside is still taken for as tall as before",
    OPS,
    "    } else if (box.bottom >= at) {\n      box.bottom += 1;\n      box.rs += 1;\n    }",
    "    }",
    BROUGHT,
  ),
  "speed-frozen-kept": speed(
    "an insert counts the frozen rows once and does not add the ones it brings",
    OPS,
    "    frozen = nextFrozen;\n",
    "",
    BROUGHT,
  ),
  "speed-frozen-gone": speed(
    "a delete counts the frozen rows once and does not take off the ones it removes",
    OPS,
    "      frozen -= 1;\n",
    "",
    DELETED,
  ),
  "speed-guard-formula": rows(
    "the formula guard is skipped on a sheet that has a formula",
    "  if (!ruled && !backing.hasFormula()) return false;",
    "  if (!ruled && backing.hasFormula()) return false;",
    "formula guard",
  ),
  "speed-delete-merge": speed(
    "a delete that changes a merge does not put the merge back in its inverse",
    OPS,
    "  if (boxes.some((box) => box.changed)) {",
    "  if (false) {",
    DELETED,
  ),
  "speed-batch-fits": speed(
    "fits lets a batch through when one of its actions is refused",
    OPS,
    "    if (fitted !== true) return fitted;\n  }\n  return true;",
    "  }\n  return true;",
    "fits answers with the code of the action that stops a batch",
  ),
  "speed-batch-thrown": speed(
    "fits throws when an action inside a batch is refused as it is written",
    OPS,
    "      if (err instanceof GridRefused) return { code: err.code, detail: err.detail };\n",
    "",
    "fits answers with the code of the action that stops a batch",
    /GridRefused/,
  ),
  "speed-batch-inplace": rows(
    "fits tries each action of a batch on the sheet as it was before the batch",
    "  const scratch = inPlace ? backing : modelBacking(snapshot(backing.sheet), { sheetId: backing.sheetId });",
    "  const scratch = modelBacking(snapshot(backing.sheet), { sheetId: backing.sheetId });",
    "fits agrees with apply",
  ),
  "speed-batch-untried": speed(
    "a batch nobody tried writes each action with no fits step",
    OPS,
    "  return marked(backing, applyFitted(backing, action, options, applyOne));",
    "  return marked(backing, applyFitted(backing, action, options));",
    "a batch nobody tried still refuses an action whole",
  ),
  "speed-anchor-walk": speed(
    "a delete looks the anchor row of every merge up again for each row that goes",
    OPS,
    "      const anchorAt = followed ? box.anchorAt : box.anchor === null ? -1 : backing.rowIndex(box.anchor);",
    "      const anchorAt = box.anchor === null ? -1 : backing.rowIndex(box.anchor);",
    COST,
  ),
  "speed-list-rebuild": speed(
    "every row that comes in builds the list of row changes again",
    OPS,
    '    rows.push({ sheet: action.sheet, row: record.id, kind: "insert" });',
    '    rows.splice(0, rows.length, ...rows, { sheet: action.sheet, row: record.id, kind: "insert" });',
    COST,
  ),
  "speed-sound-refit": speed(
    "fits tries every batch the long way, each action on a copy of its own",
    OPS,
    "  if (!findsRows(backing)) {",
    "  if (true) {",
    COPIES,
  ),
  "speed-sound-rewrite": speed(
    "apply writes every batch the long way, with each action tried again",
    OPS,
    '  if (action.t === "batch" && !findsRows(backing)) return applyFitted(backing, action, options, applyOne);',
    '  if (action.t === "batch") return applyFitted(backing, action, options, applyOne);',
    COPIES,
  ),
  "speed-repeated-fits": speed(
    "fits tries a batch the short way on a sheet with a repeated row id",
    OPS,
    "  if (!findsRows(backing)) {",
    "  if (false) {",
    "a batch that deletes one row of a repeated id and brings the id back is refused, as it was",
  ),
  "speed-repeated-apply": speed(
    "apply writes a batch the short way on a sheet that does not find every row",
    OPS,
    '  if (action.t === "batch" && !findsRows(backing)) return applyFitted(backing, action, options, applyOne);\n',
    "",
    "a batch that names a row the sheet no longer finds is refused whole, as it was",
  ),
  "speed-repeated-found": speed(
    "a row counts as found wherever its id leads",
    OPS,
    "backing.rows().every((row, i) => backing.rowIndex(row.id) === i);",
    "backing.rows().every((row, i) => backing.rowIndex(row.id) >= 0);",
    "a batch that deletes one row of a repeated id and brings the id back is refused, as it was",
  ),
  "speed-repeated-delete": speed(
    "a delete follows the anchor row of a merge by its index on a sheet with a repeated row id",
    OPS,
    "  const followed = findsRows(backing);",
    "  const followed = true;",
    "a delete under a merge whose anchor row has a repeated id leaves the merge, as it did",
  ),
  "speed-anchor-moved": speed(
    "a merge whose anchor moves down a row is not followed there",
    OPS,
    "        box.anchorAt = at + 1;\n",
    "",
    DELETED,
  ),
  "speed-anchor-shift": speed(
    "a merge under a row that goes keeps the index its anchor row had",
    OPS,
    "box.anchorAt > at ? box.anchorAt - 1 : box.anchorAt;",
    "box.anchorAt;",
    DELETED,
  ),
  "speed-anchor-gone": speed(
    "a merge whose anchor row goes is followed on to the row that takes its place",
    OPS,
    "box.anchorAt = box.anchorAt === at ? -1 : box.anchorAt > at",
    "box.anchorAt = box.anchorAt > at",
    DELETED,
  ),
  "rules-inverse-set": {
    what: "a rules action's inverse forgets a rule it replaced or removed",
    file: "src/grid/ops.js",
    find: "    if (old !== undefined) inverse.set.push(old);",
    replace: "    if (old !== undefined) void old;",
    test: "test/grid/ops-merge.test.js",
    name: "a rules action adds, replaces and removes rules, and its inverse puts them back",
    expects: /expect|Expected|Received|toBe|toEqual|toThrow/,
  },
  "rules-validate": {
    what: "a rules action is never checked, so a rule naming another tab or a bad formula is written",
    file: "src/grid/ops.js",
    find: "  if (action.t === \"rules\") return checkRules(action);",
    replace: "  if (action.t === \"rules\") return;",
    test: "test/grid/ops-merge.test.js",
    name: "a rules action is refused when its range names another tab, its formula does not parse, its style is not in cleanStyle form, an id is named twice, or it is inside a batch",
    expects: /expect|Expected|Received|toBe|toEqual|toThrow/,
  },
  "rules-dom-content": {
    what: "the DOM backing writes rules as the template's text, which a reader never sees",
    file: "src/grid/backing-dom.js",
    find: "    block.innerHTML = `\\n${rules.map(ruleHtml).join(\"\\n\")}\\n`;",
    replace: "    block.textContent = `\\n${rules.map(ruleHtml).join(\"\\n\")}\\n`;",
    test: "test/grid/backing-dom-structure.test.js",
    name: "setRules writes the rules block a reader reads back",
    expects: /expect|Expected|Received|toBe|toEqual|toThrow/,
  },
  "rules-rewrite": {
    what: "rules stay where they were after rows go in above them",
    file: "src/grid/workbook.js",
    find: "  const rebound = before === null ? new Set() : rewriteRules(run, before, frameOf(run.wb), TAB.has(action.t));",
    replace: "  const rebound = new Set();",
    test: "test/grid/workbook.test.js",
    name: "a row inserted above a dropdown moves its range, and the undo moves it back",
    expects: /expect|Expected|Received|toBe|toEqual|toThrow/,
  },
  "rules-reanchor": {
    what: "a conditional format's formula is not moved to the range's new top row, so it becomes #REF!",
    file: "src/grid/workbook.js",
    find: "    out.f = tabStep ? moveFormula(rule.f, sid, before, after) : moveAnchored(rule.f, sid, before, after, now.row - was.row, now.col - was.col);",
    replace: "      out.f = moveFormula(rule.f, sid, before, after);",
    test: "test/grid/workbook.test.js",
    name: "a conditional format comparing each row with the row above keeps working when rows come and go",
    expects: /expect|Expected|Received|toBe|toEqual|toThrow/,
  },
  "rules-inverse-list": {
    what: "the inverse of a step carries no rules list, so a rule a delete removed never comes back",
    file: "src/grid/workbook.js",
    find: "  if (changes.length > 0) inverse.rules = changes;",
    replace: "",
    test: "test/grid/workbook.test.js",
    name: "deleting every row of a rule removes it, and the undo brings it back",
    expects: /expect|Expected|Received|toBe|toEqual|toThrow/,
  },
  "rules-restore-guard": {
    what: "an undo puts back a rule a coworker changed since",
    file: "src/grid/workbook.js",
    find: "    if (sameRule(rulesBefore.get(ruleKey(sheet, id))?.rule, left)) restoreRule(run, sheet, id, back);",
    replace: "    restoreRule(run, sheet, id, back);",
    test: "test/grid/workbook.test.js",
    name: "an undo leaves a rule a coworker changed since",
    expects: /expect|Expected|Received|toBe|toEqual|toThrow/,
  },
  "rules-anchored-abs": {
    what: "moveAnchored moves the row of a $ part with the corner",
    file: "src/grid/formula/text.js",
    find: "        const r = hasRow ? (token.absRow ? place(was.rows, now.rowAt, token.row - 1) : token.row - 1 + rows) : 0;",
    replace: "        const r = hasRow ? token.row - 1 + rows : 0;",
    test: "test/grid/formula/text.test.js",
    name: "moveAnchored moves relative parts with the corner and keeps $ parts on their rows",
    expects: /expect|Expected|Received|toBe|toEqual|toThrow/,
  },
  "rules-rebound": {
    what: "the inverse forgets a rule whose reference rebound, so the row it moved off keeps it",
    file: "src/grid/workbook.js",
    find: "    if (sameRule(was?.rule, now?.rule) && !rebound.has(key)) continue;",
    replace: "    if (sameRule(was?.rule, now?.rule)) continue;",
    test: "test/grid/workbook.test.js",
    name: "deleting the top row of an open-ended checkbox column and undoing gives the row its checkbox back",
    expects: /expect|Expected|Received|toBe|toEqual|toThrow/,
  },
  "rules-moves-stay": {
    what: "a row move drags a rule's range with the row, so the range follows the drag",
    file: "src/grid/workbook.js",
    find: "  const ruleFrame = rulesBefore !== null && (TAB.has(action.t) || resizes(action)) ? frameOf(wb) : null;",
    replace: "  const ruleFrame = rulesBefore !== null && (TAB.has(action.t) || structural(action)) ? frameOf(wb) : null;",
    test: "test/grid/workbook.test.js",
    name: "moving a row inside a rule's range leaves the range where it is",
    expects: /expect|Expected|Received|toBe|toEqual|toThrow/,
  },
  "rules-room-refusal": {
    what: "a room accepts a rule restore whose rule no rules action could write",
    file: "src/grid/room-codec.js",
    find: "rule.id === entry[1] && ruleRefusal(rule) === null",
    replace: "rule.id === entry[1]",
    test: "test/grid-room/codec.test.js",
    name: "a room refuses an undo whose rule restore holds a rule no rules action could write",
    expects: /expect|Expected|Received|toBe|toEqual|toThrow/,
  },
  "rules-standalone": {
    what: "a grid with rules and no engine writes a row insert under its rules",
    file: "src/grid/ops.js",
    find: "  const ruled = backing.rules().length > 0;",
    replace: "  const ruled = false;",
    test: "test/grid/grid-structure.test.js",
    name: "a grid with rules and no formula engine refuses a row insert above its rules",
    expects: /expect|Expected|Received|toBe|toEqual|toThrow/,
  },
  "rules-page-undo": {
    what: "the DOM backing never reads a rules block the page put back",
    file: "src/grid/backing-dom.js",
    find: " || (part.localName === \"template\" && part.hasAttribute(\"rules\"))",
    replace: "",
    test: "test/grid/grid-structure.test.js",
    name: "a rules block the page put back is read before the next rules write",
    expects: /expect|Expected|Received|toBe|toEqual|toThrow/,
  },
  "rules-room-revert": {
    what: "a room refuses an undo whose step carries rule restores",
    file: "src/grid/room-codec.js",
    find: "key !== \"action\" && key !== \"restore\" && key !== \"rules\")",
    replace: "key !== \"action\" && key !== \"restore\")",
    test: "test/grid-room/codec.test.js",
    name: "undoing a row insert on a tab with rules is accepted in a room",
    expects: /expect|Expected|Received|toBe|toEqual|toThrow/,
  },
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) mutate(MUTATIONS);
