// node test/mutations/grid-ops.mjs [check-duplicate|check-shared-ids|check-tie|check-merge|check-long-row|check-short-row
//   |normalize-first-keeps|normalize-rekey-all|normalize-content|normalize-slots|normalize-hidden-text
//   |a1-base26|model-trailing|model-index
//   |ops-refuse-late|ops-inverse-fmt|ops-inverse-new|ops-covered|ops-batch-atomic|ops-empty-cell|ops-validate-cr|ops-formula-stale
//   |rows-tie|rows-exists|rows-inverse-cells|rows-frozen|rows-bad-key|rows-end|rows-formula-guard
//   |cols-shift|cols-rederive|cols-own-fmt|cols-inverse-cells
//   |merge-inverse-content|merge-grow|merge-anchor|merge-overlap|merge-cut|freeze-cut|ops-flat-inverse
//   |style-order|style-shorthand|style-filter|style-field|style-drop-unknown|style-border-collapse
//   |laws-inverse-fmt|laws-inverse-cells|laws-merge-grow
//   |fix-formula-result|fix-keep-style|fix-guard-tail|fix-fits-formula|fix-batch-needs
//   |fix-frozen-cols|fix-guard-survivors|fix-guard-after|fix-anchor-fmt
//   |x-split|x-mixed|x-overlap|x-semicolon|x-bg-null|x-row-height
//   |x-merge-clears|x-merge-targets|x-custom-fmt|x-normal-custom|x-gen-sort|x-text-carry|x-text-builtin
//   |x-norm-shift|x-span-bound]
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
  "normalize-content": normalize(
    "a covered position that holds content is emptied when its merge is undone",
    "      } else if (covered && covered.hidden) {\n        target.cells[col + j] = uncovered(covered);",
    "      } else if (covered) {\n        target.cells[col + j] = null;",
    "repair pairs",
    /toBe|toEqual/,
  ),
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
    "        for (let i = done.length - 1; i >= 0; i--) apply(backing, done[i], { derive, formulas });\n",
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
    'if (action.t === "set" && action.cells.some((entry) => isFormula(entry[2]))) backing.setStale(true);',
    "",
    "stale",
    /toBe|toEqual/,
  ),
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
    find: "  return holdsFormula(backing, rows, cols) || holdsFormula(after, rows, cols);",
    replace: "  return backing.hasFormula();",
    test: ROWS_TEST,
    name: "formula guard",
    expects: /toBe|toEqual/,
  },
  "fix-guard-after": {
    what: "the guard looks only at formulas that are there before the action",
    file: OPS,
    find: "  return holdsFormula(backing, rows, cols) || holdsFormula(after, rows, cols);",
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
  "x-gen-sort": laws(
    "a move with several records applies only the first",
    '    if (cut !== null) return cutRefusal(cut);\n  }\n  if (guarded(backing, action, formulas) && movesRows(backing, action)) return engineRefusal();\n  for (const record of action.rows) {',
    '    if (cut !== null) return cutRefusal(cut);\n  }\n  if (guarded(backing, action, formulas) && movesRows(backing, action)) return engineRefusal();\n  for (const record of action.rows.slice(0, 1)) {',
    "reducer laws over seeded lists",
  ),
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
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) mutate(MUTATIONS);
