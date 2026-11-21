// node test/mutations/grid-live.mjs [dom-mirror|dom-attr-left|dom-trailing|dom-noop|dom-paused|dom-touch-read
//   |dom-derived-loud|dom-stale-loud|dom-stale-noop|dom-attr-rewrite|dom-text-rewrite|dom-markup-kept
//   |dom-read-kept|dom-head-read|dom-row-gone|dom-row-renamed|dom-row-order|dom-rescan-blind
//   |dom-lists-mirror|dom-lists-attr-left|dom-lists-trailing|dom-lists-noop|dom-lists-paused
//   |tree-count|tree-attributes|tree-text
//   |dom-regroup|dom-append-last|dom-empty-thead|dom-col-cells|dom-frozen-move
//   |dom-group-size|dom-group-kept|dom-col-trim|dom-col-move|dom-reshape
//   |dom-parts-stale|dom-row-frozen|dom-row-count|dom-row-same|dom-row-of
//   |dom-lists-regroup|dom-lists-append-last|dom-lists-empty-thead|dom-lists-col-cells
//   |dom-lists-frozen-move
//   |ops-batch-loud|ops-batch-loud-result
//   |grid-load-writes|grid-covered|grid-rescan-mirror|grid-hidden-text|grid-same|grid-rescan-issues
//   |grid-rescan-quiet|grid-hidden-own|grid-hidden-order|grid-hidden-clean|grid-get-text|grid-area-clip
//   |grid-input-column|grid-on-remove|grid-hidden-th|grid-covered-own|grid-hidden-blank|grid-area-reversed
//   |grid-refusal-class|grid-input-today|grid-tab-item
//   |grid-needs-repair|grid-read-only|grid-dispatch|grid-adopt|grid-noop|grid-event-before
//   |grid-noop-text|grid-apply-quiet|grid-read-before-apply|grid-foreign-stale-v|grid-foreign-loud
//   |grid-repair-hidden-text|grid-repair-tidy|grid-maywrite-arg|grid-dispose
//   |grid-structure-direct|grid-structure-event|grid-structure-move|grid-structure-merge
//   |grid-command-ready|grid-command-refusing|grid-structure-mint|grid-structure-like
//   |grid-structure-col-like|grid-newid-length|grid-schedule-table
//   |grid-import-formula|grid-export-protect-all|grid-export-raw|grid-import-types|grid-import-ready
//   |grid-import-text-clean|grid-import-dispatch|grid-export-protect-default|grid-export-delimiter
//   |grid-import-delimiter|grid-delimited-refusal|grid-delimited-line
//   |grid-foreign-explains|grid-foreign-registered|grid-foreign-unknown-flags|grid-retake-column
//   |grid-retake-rescan|grid-retake-intake|dom-read-span|dom-read-late|grid-ready-intake
//   |grid-ready-setrange-rows|grid-ready-area|grid-ready-fresh|grid-apply-paused|grid-trim-grow
//   |grid-apply-value|grid-apply-text|grid-item-plain|grid-item-content|grid-item-formula
//   |grid-item-content-formula|grid-noop-parts|grid-noop-records|grid-named-guard|grid-index-csv
//   |stale-unknown|stale-early|stale-revision|budget-outerhtml|budget-always-fmt|stale-column-fmt
//   |stale-damaged-first|stale-load|stale-whole-read|stale-repair|stale-unknown-waiting
//   |stale-unknown-v
//   |repair-append-dom|repair-append-model|repair-hidden-kept|csv-import-unprotect
//   |csv-import-unprotect-any|repair-hidden-first|dom-paint-node|dom-paint-empty|dom-own-text
//   |dom-own-text-known|grid-settled-column|repair-past-splice|grid-intake-hidden
//   |grid-intake-hidden-gone|grid-settled-put-back|repair-one-run|repair-text-row-stays
//   |repair-covers-value|dom-regroup-paused|grid-import-plain|grid-import-plain-text
//   |grid-import-text-unprotect
//   |dom-col-delete-regroup
//   |grid-apply-gone|corpus-golden|corpus-reparse]
// Each entry puts one bug back into the grid's live layer and names the test that must then fail.
// With no argument every entry runs, one after another. The dom-lists entries put a bug of the
// first six back and aim it at the seeded lists, which take about twenty seconds a run. The
// entries from dom-regroup on are for the rows and columns of the live table, and their
// dom-lists entries aim at the first part of the lists of every action kind. The grid entries are
// for the Grid: its read side, its writes, from grid-structure-direct on its rows, columns,
// merges and freeze, from grid-import-formula on its CSV and TSV, and from grid-foreign-explains on
// writes from outside the grid and the edits a page and a room make. The stale entries are for the
// refresh of a table a host wrote without formatting, the budget entries for the bytes a save
// takes and the bytes typing makes, and the repair entries for a repair of rows that run past the
// last column and of text hidden under a merge, and csv-import-unprotect and
// csv-import-unprotect-any for a text column's import of what our export protected.
import { pathToFileURL } from "node:url";

import { mutate } from "./harness.mjs";

const DOM = "src/grid/backing-dom.js";
const TREE = "test/grid/support/same-tree.js";
const CELLS_TEST = "test/grid/backing-dom-cells.test.js";
const STRUCTURE_TEST = "test/grid/backing-dom-structure.test.js";

const LISTS = "set and format lists give the same bytes";
const KIND_LISTS = "lists of every action kind give the same bytes and the same tree, part 1 of 6";
const GROUPS = "the tbody groups are cut where the writer cuts them";
const THEAD = "the thead holds the frozen rows";
const COLUMNS = "a new column adds a cell to every row that reaches it";
const FOREIGN_ROWS = "read sees a row a foreign write added";
const GRID = "src/grid/grid.js";
const READ_TEST = "test/grid/grid-read.test.js";
const RESCAN = "rescan after a raw DOM edit sees the new value";
const HIDDEN = "a hidden cell that holds text is listed as hidden_text";

const dom = (what, find, replace, name, expects) => ({ what, file: DOM, find, replace, test: CELLS_TEST, name, expects });

const structure = (what, find, replace, name, expects = /toEqual|toBe/) => ({ what, file: DOM, find, replace, test: STRUCTURE_TEST, name, expects });

const grid = (what, find, replace, name, expects = /toEqual|toBe/) => ({ what, file: GRID, find, replace, test: READ_TEST, name, expects });
const WRITE_TEST = "test/grid/grid-write.test.js";
const NOOP = "a write that changes nothing writes nothing";
const DAMAGED = "a damaged table refuses set until repair, and repair gives the bytes of normalizeSheet";
const READ_ONLY = "a page that may not write refuses every command and the repair";
const FOREIGN = "a write from outside the grid is taken with its derived parts put right";
const gridWrite = (what, find, replace, name, expects = /toEqual|toBe/) => ({ what, file: GRID, find, replace, test: WRITE_TEST, name, expects });
const GRID_STRUCTURE_TEST = "test/grid/grid-structure.test.js";
const PINNED_TINY = "each structure command gives the pinned bytes on tiny, and its inverse gives the starting bytes back";
const PINNED_MERGED = "each structure command gives the pinned bytes on merged, and its inverse gives the starting bytes back";
const INSERT_ROWS = "    insertRows: command((before, count, { like } = {}) => buildInsertRows(backing, before, count, { like, newId: mint })),";
const gridStructure = (what, find, replace, name, expects = /toEqual|toBe/) => ({ what, file: GRID, find, replace, test: GRID_STRUCTURE_TEST, name, expects });
const GRID_CSV_TEST = "test/grid/grid-csv.test.js";
const KINDS_EXPORT = "a negative number is exported without an apostrophe and the text -5 units with one";
const IMPORT_HEAD = "  function importDelimited(text, at, { delimiter, types = [], formulas = false } = {}) {\n";
const gridCsv = (what, find, replace, name, expects = /toEqual|toBe/) => ({ what, file: GRID, find, replace, test: GRID_CSV_TEST, name, expects });
const FOREIGN_TEST = "test/grid/grid-foreign.test.js";
const UNDO_CELL = "a page undo of a cell's format change keeps the number: a typed look, a date, a percent and a formula's result";
const COMMAND_FIRST = "a command takes in a write from outside the grid before it reads the sheet";
const gridForeign = (what, find, replace, name, file = GRID) => ({ what, file, find, replace, test: FOREIGN_TEST, name, expects: /toEqual|toBe/ });
const EDITS_TEST = "test/grid/grid-edits.test.js";
const RESULT_ONLY = "a write that changes only a formula's result or a cell's shown text fires an event and moves the revision";
const PLAIN = "text that is not parsed, and the text and formula of an object item, are made plain as the cell editor makes them";
const NOOP_RECORDS = "a freeze, a column change or a row change that asks for what the sheet has fires no event, and one that changes something does";
const gridEdits = (what, find, replace, name, file = GRID) => ({ what, file, find, replace, test: EDITS_TEST, name, expects: /toEqual|toBe/ });
const STALE_TEST = "test/grid/stale.test.js";
const HOST_PLAIN = "a host-patched table with no formula loads with its values formatted, its revision at 0, nothing the page sees, and no stale mark";
const HOST_FORMULA = "a host-patched table with a formula loads with its values formatted and keeps its stale mark, because no engine calculated the formulas again";
const UNKNOWN_KEPT = "under a format no formatter knows, a cell keeps its text, and the stale mark stays while a number there shows its plain value";
const HOST_LIVE = "a host patch that reaches an open page is formatted when the grid reads the table again, its appended row with a derived event that leaves the revision";
const DAMAGED_STALE = "a stale table with issues is left as it is until it is repaired, and the repair formats it and removes the mark";
const stale = (what, find, replace, name) => ({ what, file: GRID, find, replace, test: STALE_TEST, name, expects: /toEqual|toBe/ });
const BUDGET_TEST = "test/grid/budget.test.js";
const budget = (what, file, find, replace, name) => ({ what, file, find, replace, test: BUDGET_TEST, name, expects: /toEqual|toBe/ });
const REPAIR_TEST = "test/grid/grid-repair.test.js";
const PAST_LAST = "rows with cells past the last column are repaired once: the new columns move no cell, the repair gives normalizeSheet's bytes, and a second repair changes nothing";
const repair = (what, file, find, replace, name) => ({ what, file, find, replace, test: REPAIR_TEST, name, expects: /toEqual|toBe/ });

const tree = (what, find, replace) => ({ what, file: TREE, find, replace, test: CELLS_TEST, name: "sameTree lists a planted difference", expects: /toEqual|toBe/ });

const NO_MIRROR = ["    mirror.putCell(r, c, next);\n", ""];
const NO_REMOVE = ["  if (value === null) node.removeAttribute(name);\n  else node.setAttribute(name, value);", "  if (value !== null) node.setAttribute(name, value);"];
const NO_TRIM = ["  trimRow(tr);\n", ""];
const NO_SAME = ["    if (sameCell(old, next)) return;\n", ""];
const ALL_PAUSED = ['    if (loud > 0 || isEdit(old, next) || (ownText.has(old) && old.text !== (next?.text ?? ""))) draw();\n    else write(draw);', "    write(draw);"];
const NO_REGROUP = ["    if (!grouped(starts)) regroup(starts);\n", ""];
const APPEND_LAST = [
  "} else if (next !== null) next.parentNode.insertBefore(tr, next);\n    else bodies[bodies.length - 1].appendChild(tr);",
  "} else bodies[bodies.length - 1].appendChild(tr);",
];
const EMPTY_THEAD = ["    thead.remove();\n    thead = null;\n", ""];
const NO_COL_CELLS = ['      if (td !== null) row.insertBefore(doc.createElement("td"), td);\n', ""];
const NO_FROZEN_MOVE = ["      setHead(rows);\n", ""];

export const MUTATIONS = {
  "dom-mirror": dom("the table is written and the mirror is not", ...NO_MIRROR, "putCell writes the mirror and the table together", /toEqual|toBe/),
  "dom-attr-left": dom(
    "an attribute the new cell does not have stays on the element",
    ...NO_REMOVE,
    "putCell removes the attributes the new cell does not have",
    /toEqual|toBe/,
  ),
  "dom-trailing": dom("the empty cells at a row's end are kept", ...NO_TRIM, "putCell pads a short row and drops the empty cells", /toEqual|toBe/),
  "dom-noop": dom("a putCell that changes nothing still goes to the table", ...NO_SAME, "a putCell that changes nothing writes nothing", /toEqual|toBe/),
  "dom-paused": dom(
    "a content write is made inside the paused path",
    ...ALL_PAUSED,
    "a content or format write is announced and a derived write is paused",
    /toEqual|toBe/,
  ),
  "dom-touch-read": dom(
    "the touched rows are not read from the table before a write",
    "  function read(indexes) {\n",
    "  function read(indexes) {\n    return null;\n",
    "the touched rows are read before a write",
    /toEqual|toBe/,
  ),

  "dom-derived-loud": dom(
    "a write of derived parts only is made as an ordinary write",
    "    else write(draw);",
    "    else draw();",
    "a content or format write is announced and a derived write is paused",
    /toEqual|toBe/,
  ),
  "dom-stale-loud": dom(
    "the stale mark is written outside the paused path",
    'write(() => setAttribute(table, "stale", next));',
    'setAttribute(table, "stale", next);',
    "setStale marks the table inside the paused path",
    /toEqual|toBe/,
  ),
  "dom-stale-noop": dom(
    "the paused path is entered for a stale mark the table already has",
    '    if (table.getAttribute("stale") !== next) write(',
    "    write(",
    "setStale marks the table inside the paused path",
    /toEqual|toBe/,
  ),
  "dom-attr-rewrite": dom(
    "an attribute that already holds its value is written again",
    "  if (node.getAttribute(name) === value) return;\n",
    "",
    "a content or format write is announced and a derived write is paused",
    /toEqual|toBe/,
  ),
  "dom-text-rewrite": dom(
    "a text that is already in the cell is written again",
    "    if (only.data !== cell.text) only.data = cell.text;",
    "    only.data = cell.text;",
    "a content or format write is announced and a derived write is paused",
    /toEqual|toBe/,
  ),
  "dom-markup-kept": dom(
    "markup inside a cell stays when its text is the new text",
    " || td.firstElementChild !== null",
    "",
    "putCell removes the attributes the new cell does not have",
    /toEqual|toBe/,
  ),
  "dom-read-kept": dom(
    "a foreign write is listed and the mirror does not take it",
    "        puts.push(() => mirror.putCell(r, c, is === null ? null : { ...is }));\n",
    "",
    "read takes a foreign write into the mirror",
    /toEqual|toBe/,
  ),
  "dom-head-read": dom(
    "the table's columns are not read before a write",
    "!sameHead(treeModel(headAdapter, table), mirror.sheet) || ",
    "",
    "a column, a frozen column count or a stale mark that changed",
    /toEqual|toBe/,
  ),
  "dom-row-gone": structure("a row that came, left or moved is not seen when the table is read", " || !sameRows(found)", "", FOREIGN_ROWS),
  "dom-row-renamed": dom(
    "a row whose id, position key or group changed is not taken as a change of structure",
    '      if (changed.some((key) => key !== "style")) return reread();\n',
    "",
    "a row whose id, position key or group changed",
    /toEqual|toBe/,
  ),
  "dom-rescan-blind": dom(
    "a scan of the whole table never says the table differed",
    "!sameSheet(fresh, mirror.sheet)",
    "false",
    "rescan reads the table again",
    /toEqual|toBe/,
  ),
  "dom-row-order": dom(
    "the row elements are listed in document order, frozen rows not first",
    'const into = name === "thead" ? frozen : data;',
    "const into = data;",
    "rows are found in the tree reader's order",
    /toEqual|toBe/,
  ),

  "dom-lists-mirror": dom("the table is written and the mirror is not", ...NO_MIRROR, LISTS, /the mirror's bytes are the model's/),
  "dom-lists-attr-left": dom("an attribute the new cell does not have stays on the element", ...NO_REMOVE, LISTS, /the live table's bytes are the model's/),
  "dom-lists-trailing": dom("the empty cells at a row's end are kept", ...NO_TRIM, LISTS, /the live table is the tree its bytes parse to/),
  "dom-lists-noop": dom("a putCell that changes nothing still goes to the table", ...NO_SAME, LISTS, /an edit is announced, a derived write is paused/),
  "dom-lists-paused": dom("a content write is made inside the paused path", ...ALL_PAUSED, LISTS, /an edit is announced, a derived write is paused/),

  "tree-count": tree(
    "sameTree does not count child elements",
    "  if (here.length !== there.length) {\n    out.push(`${path}: ${here.length} child elements where the bytes give ${there.length}`);\n  }\n",
    "",
  ),
  "tree-attributes": tree("sameTree does not compare attributes", "  if (mine !== theirs) out.push(`${path}: ${mine} where the bytes give ${theirs}`);\n", ""),
  "tree-text": tree("sameTree does not compare the text of a cell", "  if (isCell(parsed) && live.textContent !== parsed.textContent) {", "  if (false) {"),

  "dom-regroup": structure("the tbody groups are not put right after a row comes or goes", ...NO_REGROUP, GROUPS),
  "dom-append-last": structure("every new row goes in the last tbody", ...APPEND_LAST, GROUPS),
  "dom-empty-thead": structure("a thead with no row left stays in the table", ...EMPTY_THEAD, THEAD),
  "dom-col-cells": structure("a new column adds no cell to a row that reaches it", ...NO_COL_CELLS, COLUMNS),
  "dom-frozen-move": structure("a row that becomes frozen stays in its tbody", ...NO_FROZEN_MOVE, THEAD),

  "dom-group-size": structure("the groups are cut at another size than the writer's", "const GROUP = 50;", "const GROUP = 40;", GROUPS),
  "dom-group-kept": structure("a tbody that lost its last row stays in the table", "      bodies[g].remove();\n", "", GROUPS),
  "dom-col-trim": structure(
    "a removed column leaves empty cells at a row's end",
    "      td.remove();\n      trimRow(row);\n    }\n    if (spanned) settle();\n    return record;",
    "      td.remove();\n    }\n    if (spanned) settle();\n    return record;",
    COLUMNS,
  ),
  "dom-col-move": structure(
    "a moved column leaves its cells where they were",
    "      const td = cellAt(row, from, false);\n      td.remove();\n      row.insertBefore(td, cellAt(row, to, false));\n",
    "",
    COLUMNS,
  ),
  "dom-reshape": structure(
    "a row primitive works on parts the writer did not write",
    "    if (canonical) return false;\n",
    "    return false;\n",
    "a table with other parts gets the writer's parts",
  ),
  "dom-parts-stale": structure("the table's parts are not taken again when it is read", "    take(found);\n", "", "read takes the table's parts as they are now"),
  "dom-row-frozen": structure("a row a foreign write froze is not seen", "found.head === head && ", "", FOREIGN_ROWS),
  "dom-row-count": structure("a last row a foreign write took away is not seen", "found.rows.length === trs.length && ", "", FOREIGN_ROWS),
  "dom-row-same": structure("a row a foreign write put in another row's place is not seen", "found.rows.every((tr, r) => tr === trs[r])", "true", FOREIGN_ROWS),
  "dom-row-of": structure(
    "a row is looked up by its id alone",
    "return trs[r] === tr ? r : trs.indexOf(tr);",
    "return r;",
    "rowIndexOf finds the row that holds a node",
  ),

  "dom-lists-regroup": structure("the tbody groups are not put right after a row comes or goes", ...NO_REGROUP, KIND_LISTS, /the live table is the tree its bytes parse to/),
  "dom-lists-append-last": structure("every new row goes in the last tbody", ...APPEND_LAST, KIND_LISTS, /the live table's bytes are the model's/),
  "dom-lists-empty-thead": structure("a thead with no row left stays in the table", ...EMPTY_THEAD, KIND_LISTS, /the live table is the tree its bytes parse to/),
  "dom-lists-col-cells": structure("a new column adds no cell to a row that reaches it", ...NO_COL_CELLS, KIND_LISTS, /the live table's bytes are the model's/),
  "dom-lists-frozen-move": structure("a row that becomes frozen stays in its tbody", ...NO_FROZEN_MOVE, KIND_LISTS, /the live table's bytes are the model's/),

  "grid-load-writes": grid(
    "loading gives the table the writer's parts",
    "  const backing = domBacking(table, { write, sheetId: id });\n",
    "  const backing = domBacking(table, { write, sheetId: id });\n  backing.tidy();\n",
    "loading writes nothing",
  ),
  "grid-covered": grid("a covered cell is not marked covered", "const covered = found?.hidden === true;", "const covered = false;", "a covered cell reads null"),
  "grid-rescan-mirror": grid("rescan keeps the old mirror", "const differed = backing.rescan();", "const differed = true;", RESCAN),
  "grid-hidden-text": grid(
    "a hidden cell's text is not collected from the table",
    "[...checkSheet(backing.sheet), ...hiddenText(table, backing), ...rulesBlock(table, backing)]",
    "[...checkSheet(backing.sheet), ...rulesBlock(table, backing)]",
    HIDDEN,
  ),
  "grid-same": grid("a second call for a table makes a second Grid", "  if (known !== undefined && (engine === null || engines.get(known) === engine)) return known;\n", "", "the same table gives the same Grid"),
  "grid-rescan-issues": grid(
    "rescan keeps the issues found at load",
    "    if (differed) retake(old);\n    check();\n",
    "    if (differed) retake(old);\n",
    RESCAN,
  ),
  "grid-rescan-quiet": grid("a rescan that found nothing still tells the listeners", "return differed ? whole() : null;", "return whole();", RESCAN),
  "grid-hidden-own": grid("a hidden cell of a table inside a cell is listed as this table's", " || !ownRow(table, td.parentNode)", "", HIDDEN),
  "grid-hidden-order": grid("hidden text is listed in the table's element order", "  return found.sort((a, b) => a.row - b.row || a.col - b.col);", "  return found;", HIDDEN),
  "grid-hidden-clean": grid("hidden text keeps CR and NUL", "const text = cleanText(td.textContent);", "const text = td.textContent;", HIDDEN),
  "grid-get-text": grid(
    "get of one cell gives the shown text",
    "return cellValue(locate(ref).own);",
    "return locate(ref).own?.text ?? null;",
    "get gives the values the codec's readRange gives",
  ),
  "grid-area-clip": grid(
    "an area is not clipped to the sheet's last row",
    "bottom: Math.min(r1 ?? Infinity, backing.rows().length - 1)",
    "bottom: r1 ?? backing.rows().length - 1",
    "get gives the values the codec's readRange gives",
    /cells|toEqual/,
  ),
  "grid-input-column": grid(
    "the editor text ignores the column's format",
    "return editorText(own, effectiveFmt(own, column));",
    "return editorText(own, effectiveFmt(own, undefined));",
    "input gives the editor text of each kind of cell",
  ),
  "grid-on-remove": grid("the function on returns removes nothing", "      listeners.delete(listener);\n", "", "on adds a listener and returns what removes it"),
  "grid-hidden-th": grid("a hidden th is not looked at", 'table.querySelectorAll("td[hidden], th[hidden]")', 'table.querySelectorAll("td[hidden]")', HIDDEN),
  "grid-covered-own": grid(
    "a covered cell reads what the table keeps on it",
    "return { own: covered ? null : found, column: backing.cols()[col], covered };",
    "return { own: found, column: backing.cols()[col], covered };",
    "a covered cell reads null",
  ),
  "grid-hidden-blank": grid("white space alone in a hidden cell is listed", 'if (text.trim() === "" || ', 'if (text === "" || ', HIDDEN),
  "grid-area-reversed": grid(
    "get refuses an area written from its far corner",
    '  spanOf,\n} from "./build.js";',
    '} from "./build.js";\nimport { parseArea as spanOf } from "./a1.js";',
    "get gives the values the codec's readRange gives",
    /reversed/,
  ),
  "grid-refusal-class": grid(
    "a refused reference throws the A1 reader's error",
    "      if (error instanceof QueryRefused) throw new GridRefused(error.code, error.message);\n",
    "",
    "get gives the values the codec's readRange gives",
  ),
  "grid-input-today": grid(
    "the editor text is found without today",
    "const text = editText(content, fmt, today());",
    "const text = editText(content, fmt, undefined);",
    "input gives the editor text of each kind of cell",
  ),
  "grid-tab-item": grid("a section with no item attribute is a tab", 'table.parentElement.matches("section[item]")', 'table.parentElement.matches("section")', "sheet and size describe the tab and the table"),
  "grid-needs-repair": gridWrite(
    "a sheet with issues takes writes",
    'if (issues.length > 0) throw new GridRefused("needs_repair"',
    'if (false) throw new GridRefused("needs_repair"',
    DAMAGED,
  ),
  "grid-read-only": gridWrite(
    "a command does not ask whether the page may write",
    '    if (!mayWrite(table)) throw new GridRefused("read_only", "this page may not write");\n    const rows = rowsOf();',
    "    const rows = rowsOf();",
    READ_ONLY,
  ),
  "grid-dispatch": gridWrite(
    "clear writes without dispatch",
    "    clear: command((area) => buildClear(backing, area), true),",
    "    clear: run((area) => {\n      ready();\n      return apply(trimmed(buildClear(backing, area)));\n    }),",
    "a dispatch that records and does not apply leaves the bytes unchanged for every command",
  ),
  "grid-adopt": gridWrite(
    "a typed look always becomes the cell's format",
    "const fmt = formats ? adoptFmt(effective, column?.fmt ?? null, parsed.fmt) : undefined;",
    "const fmt = formats ? parsed.fmt : undefined;",
    "a typed look becomes the cell's format only when the cell shows another kind",
  ),
  "grid-noop": gridWrite("content a cell already holds is written again", "      if (!sameContent(entry[2], held)) cells.push(entry);", "      if (true) cells.push(entry);", NOOP),
  "grid-event-before": gridWrite(
    "the event's before holds the new content",
    "before: first === undefined ? change.before : first.before, after: change.after",
    "before: change.after, after: change.after",
    "one event and one revision step per write, and get reads the new value at once",
  ),
  "grid-noop-text": gridWrite("a cell's own editor text is parsed as fresh input", "    if (item === editorText(own, effective) && (formulas || own?.f === undefined)) return contentOf(own);\n", "", NOOP),
  "grid-apply-quiet": gridWrite(
    "an applied write that changed nothing still tells the listeners",
    "      if (held.has(key) && same) continue;\n",
    "",
    NOOP,
  ),
  "grid-read-before-apply": gridForeign(
    "apply does not read the rows it touches first",
    "      if (fresh === null || rest.length > 0) intake(rest);\n",
    "",
    "apply takes in a write from outside the grid in the rows it touches before it applies",
  ),
  "grid-foreign-stale-v": gridWrite(
    "a foreign text edit keeps the old v",
    '  if (cell.v !== undefined && cell.text !== (before?.text ?? "") && (known ? !explains(cell, fmt) : cell.v === before?.v && fmt === effectiveFmt(before, beforeColumn))) delete cell.v;\n',
    "",
    FOREIGN,
  ),
  "grid-foreign-loud": gridWrite(
    "the derived parts of a foreign write are put right as an edit",
    "write(() => backing.putCell(backing.rowIndex(row), c, next));",
    "backing.putCell(backing.rowIndex(row), c, next);",
    FOREIGN,
  ),
  "grid-repair-hidden-text": gridWrite(
    "repair does not show the text of hidden cells",
    'hiddenText: issues.filter((issue) => issue.code === "hidden_text")',
    "hiddenText: []",
    DAMAGED,
  ),
  "grid-repair-tidy": gridWrite(
    "repair leaves the table's parts as they are",
    "const tidied = backing.tidy();",
    "const tidied = false;",
    "repair gives a hand-written table the writer's parts, and leaves a canonical table alone",
  ),
  "grid-maywrite-arg": gridWrite(
    "a command asks whether the page may write without naming the table",
    '    if (!mayWrite(table)) throw new GridRefused("read_only", "this page may not write");\n    const rows = rowsOf();',
    '    if (!mayWrite()) throw new GridRefused("read_only", "this page may not write");\n    const rows = rowsOf();',
    READ_ONLY,
  ),
  "grid-dispose": gridWrite("dispose keeps the table's Grid", "    if (grids.get(table) === grid) grids.delete(table);\n", "", "dispose forgets the table"),
  "grid-structure-direct": gridStructure(
    "insertRows applies without dispatch",
    INSERT_ROWS,
    "    insertRows: refusing((before, count, { like } = {}) => {\n      ready();\n      return apply(buildInsertRows(backing, before, count, { like, newId: mint }));\n    }),",
    "every structure command sends one action to dispatch and writes nothing itself",
  ),
  "grid-structure-event": gridStructure("an insert's event has no structure: true", 'const RESHAPING = new Set(["insert", "delete", "move"]);', 'const RESHAPING = new Set(["delete", "move"]);', PINNED_TINY),
  "grid-structure-move": gridStructure("a move's event has no structure: true", 'const RESHAPING = new Set(["insert", "delete", "move"]);', 'const RESHAPING = new Set(["insert", "delete"]);', PINNED_MERGED),
  "grid-structure-merge": gridStructure(
    "a merge's event has no structure: true",
    'const remerges = (action) => (action.t === "batch" ? action.actions.some(remerges) : action.t === "merge" || action.t === "unmerge");',
    "const remerges = () => false;",
    PINNED_TINY,
  ),
  "grid-command-ready": gridStructure(
    "a structure command runs on a page that may not write and on a sheet with issues",
    "    run((...args) => {\n      ready(area ? () => rowsIn(args[0]) : undefined);\n",
    "    run((...args) => {\n",
    "a page that may not write, and a sheet with issues, refuse every structure command",
  ),
  "grid-command-refusing": gridStructure(
    "a structure command lets the A1 reader's error through",
    "  const command = (build, area = false) =>\n    run(",
    "  const command = (build, area = false) =>\n    (",
    "a structure command refuses a bad argument as GridRefused",
  ),
  "grid-structure-mint": gridStructure(
    "insertRows takes its ids from the default newId and not the Grid's",
    "buildInsertRows(backing, before, count, { like, newId: mint })",
    "buildInsertRows(backing, before, count, { like, newId })",
    PINNED_TINY,
  ),
  "grid-structure-like": gridStructure("insertRows drops like", "buildInsertRows(backing, before, count, { like, newId: mint })", "buildInsertRows(backing, before, count, { newId: mint })", PINNED_TINY),
  "grid-structure-col-like": gridStructure("insertCols drops like", "buildInsertCols(backing, before, count, { like, newId: mint })", "buildInsertCols(backing, before, count, { newId: mint })", PINNED_TINY),
  "grid-newid-length": gridStructure(
    "a new id has six random letters or digits",
    "new Uint8Array(8)",
    "new Uint8Array(6)",
    "new rows and columns take their ids from the Grid's newId, which gives the prefix and eight letters or digits",
  ),
  "grid-schedule-table": gridStructure(
    "apply schedules the reducer's table changes and not the table",
    "parts.length > 0 || tabsChanged });\n    schedule(table);",
    "parts.length > 0 || tabsChanged });\n    schedule(parts);",
    "the change event of an insert names the new rows and the action, with ids, and the table is scheduled",
  ),
  "grid-import-formula": gridCsv(
    "an import keeps formulas unless told not to",
    IMPORT_HEAD,
    "  function importDelimited(text, at, { delimiter, types = [], formulas = true } = {}) {\n",
    "a field =1+1 arrives as text, and as a formula only with formulas: true",
  ),
  "grid-export-protect-all": gridCsv(
    "protect puts an apostrophe before numbers, dates and booleans too",
    '      return protect && typeof value === "string" ? protectField(text) : text;',
    "      return protect ? protectField(text) : text;",
    KINDS_EXPORT,
  ),
  "grid-export-raw": gridCsv("a raw export writes the shown text", '      let text = values === "raw" ? shown(value) : one?.text ?? "";', '      let text = one?.text ?? "";', KINDS_EXPORT),
  "grid-import-types": gridCsv("an import parses a column typed text", '    const asText = (j) => types[j] === "text";', "    const asText = () => false;", "a column typed text keeps 02134"),
  "grid-import-text-clean": gridCsv(
    "a field of a column typed text keeps its CR LF line breaks",
    "    if (!detect) return plain(item);\n",
    "    if (!detect) return item;\n",
    "a column typed text keeps 02134",
  ),
  "grid-import-dispatch": gridCsv(
    "an import writes without dispatch",
    "    return send(buildImport(backing, at, itemsAt(at, fields, (j) => !asText(j), true, { data: true, formulas }), { formulas, newId: mint }));",
    "    return apply(trimmed(buildImport(backing, at, itemsAt(at, fields, (j) => !asText(j), true, { data: true, formulas }), { formulas, newId: mint })));",
    "an import is one action and one change event, and the sheet grows to hold it",
  ),
  "grid-import-ready": gridCsv(
    "an import runs on a page that may not write and on a sheet with issues",
    "    let block;\n    ready(() => {\n",
    "    let block;\n    ((rowsOf) => rowsOf())(() => {\n",
    "export reads a page that may not write and a sheet with issues; import refuses both, and writes nothing",
  ),
  "grid-export-protect-default": gridCsv(
    "an export protects text unless told not to",
    '{ delimiter = ",", values = "shown", protect = false } = {}',
    '{ delimiter = ",", values = "shown", protect = true } = {}',
    KINDS_EXPORT,
  ),
  "grid-export-delimiter": gridCsv(
    "an export writes commas whatever the delimiter",
    'return writeDelimited(eachRow(box, field), { delimiter: local ? ";" : delimiter });',
    "return writeDelimited(eachRow(box, field));",
    "export writes CR LF, quotes a field that holds the delimiter, a quote or a line break, and TSV is the same with a tab",
  ),
  "grid-import-delimiter": gridCsv(
    "an import detects the delimiter when it is given one",
    'block = parseDelimited(text, { delimiter: delimiter ?? (locale.point === "," ? detectDelimiter(text, { decimalComma: true }) : undefined) });',
    "block = parseDelimited(text);",
    "export writes CR LF, quotes a field that holds the delimiter, a quote or a line break, and TSV is the same with a tab",
  ),
  "grid-delimited-refusal": gridCsv(
    "an unclosed quote throws the tokenizer's own error",
    '      if (error instanceof DelimitedError) throw Object.assign(new GridRefused(error.code.replaceAll("-", "_"), error.message), { line: error.line });\n',
    "",
    "delimited text and options that cannot be read refuse as GridRefused",
  ),
  "grid-delimited-line": gridCsv(
    "an unclosed quote's refusal has no line number",
    "{ line: error.line }",
    "{}",
    "delimited text and options that cannot be read refuse as GridRefused",
  ),
  "grid-foreign-explains": gridForeign(
    "a write from outside the grid that changed the text drops a v the cell's format still shows",
    " && (known ? !explains(cell, fmt) : cell.v === before?.v && fmt === effectiveFmt(before, beforeColumn))) delete cell.v;",
    ") delete cell.v;",
    UNDO_CELL,
  ),
  "grid-foreign-registered": gridForeign(
    "a format an added formatter knows counts as unknown to a write from outside the grid",
    'import { fmtKind, onFormattersChanged } from "./format.js";',
    'import { fmtKind as kindOf, isBuiltin, onFormattersChanged } from "./format.js";\nconst fmtKind = (fmt) => (fmt === null || isBuiltin(fmt) ? kindOf(fmt) : "unknown");',
    "a format an added formatter knows is put right after a write from outside the grid",
  ),
  "grid-foreign-unknown-flags": gridForeign(
    "a write from outside the grid under an unknown format keeps its number and text marks as written",
    "  if (!known && cell.v !== undefined) return cell;\n",
    "  if (!known) return cell;\n",
    "under a format no formatter knows, a write from outside the grid gets its number and text marks put right and keeps its own text",
  ),
  "grid-retake-column": gridForeign(
    "a column whose format changed outside the grid keeps its cells as they were drawn",
    "const redrawn = old.cols[oc].fmt !== column.fmt && after?.fmt === undefined;",
    "const redrawn = false;",
    "a page undo of a whole-column format draws that column's cells again",
  ),
  "grid-retake-rescan": gridForeign(
    "a whole read of the table puts no derived part right",
    "    if (differed) retake(old);\n",
    "",
    "a write from outside the grid that also changes a column gets the cell's derived parts put right",
  ),
  "grid-retake-intake": gridForeign(
    "a row read that turned into a whole read puts no derived part right",
    "      retake(old);\n",
    "",
    "a page undo of a whole-column format is taken in by the next command when no pass ran first",
  ),
  "dom-read-span": gridForeign(
    "a row read takes a merge change in the rows it read only",
    "        if (SPAN_FIELDS.some((key) => fieldOf(was, key) !== fieldOf(is, key))) return reread();\n",
    "",
    "a merge made or undone from outside the grid is read across all its rows",
    DOM,
  ),
  "dom-read-late": gridForeign(
    "a row read changes the mirror before it decides to read the whole table",
    "        puts.push(() => mirror.putCell(r, c, is === null ? null : { ...is }));\n",
    "        mirror.putCell(r, c, is === null ? null : { ...is });\n",
    "a write from outside the grid read with a merge change in a later row still gets its derived parts put right",
    DOM,
  ),
  "grid-ready-intake": gridForeign("a command reads the mirror without taking in a write from outside the grid", "    const event = intake(rows);\n", "    const event = null;\n", COMMAND_FIRST),
  "grid-ready-setrange-rows": gridForeign("a set reads none of the rows it writes first", "    ready(() => rowsFrom(at, block));\n", "    ready();\n", COMMAND_FIRST),
  "grid-ready-area": gridForeign("a clear, a format or a merge reads none of the rows it names first", "      ready(area ? () => rowsIn(args[0]) : undefined);\n", "      ready();\n", COMMAND_FIRST),
  "grid-ready-fresh": gridForeign("a command's apply skips every row it touches", "    fresh = event?.rescanned ? true : new Set(rows);\n", "    fresh = true;\n", COMMAND_FIRST),
  "grid-apply-paused": gridEdits(
    "every write apply makes is hidden from the page",
    "engine === null ? applyAction(backing, action, { derive }) :",
    "engine === null ? write(() => applyAction(backing, action, { derive })) :",
    "an edit is a write the page sees, and a formula's new result through apply is a write it does not see that still fires an event",
  ),
  "grid-trim-grow": gridEdits(
    "a grow paste whose cells change nothing keeps an empty set",
    "    if (cells.length === 0 && (action.rows !== undefined || action.cols !== undefined)) return action;\n",
    "",
    "a grow paste of empty cells that bring a format adds the rows with the format",
  ),
  "grid-apply-value": gridEdits("a write that changes only a value fires no event", " && cellValue(was) === cellValue(now)", "", RESULT_ONLY),
  "grid-apply-text": gridEdits("a write that changes only the shown text fires no event", ' && (was?.text ?? "") === (now?.text ?? "")', "", RESULT_ONLY),
  "grid-item-plain": gridEdits("text that is not parsed is kept with its carriage returns", "    if (!detect) return plain(item);\n", "    if (!detect) return item;\n", PLAIN),
  "grid-item-content": gridEdits("an object item's text is kept with its carriage returns", "  if (typeof content === \"string\") return { ...item, content: plain(content) };\n", "", PLAIN),
  "grid-item-formula": gridEdits("a formula item is kept with its carriage returns", "  if (typeof item.f === \"string\") return { ...item, f: plain(item.f) };\n", "", PLAIN),
  "grid-item-content-formula": gridEdits(
    "an object item's formula is kept with its carriage returns",
    '  if (content !== null && typeof content === "object" && typeof content.f === "string") return { ...item, content: { ...content, f: plain(content.f) } };\n',
    "",
    PLAIN,
  ),
  "grid-noop-parts": gridEdits("a freeze to the counts the sheet has fires an event", ".filter((part) => part.before !== part.after)", "", NOOP_RECORDS),
  "grid-noop-records": gridEdits("a row or column change to what the record has fires an event", "before.get(change[key]) !== after.get(change[key])", "true", NOOP_RECORDS),
  "grid-named-guard": gridEdits(
    "apply reads the cells of an action of the wrong shape",
    '    if (action?.t === "batch") return Array.isArray(action.actions) ? action.actions.flatMap(named) : [];\n    return (action?.t === "set" || action?.t === "format") && Array.isArray(action.cells) ? action.cells.filter(Array.isArray) : [];',
    '    return action.t === "batch" ? action.actions.flatMap(named) : action.t === "set" || action.t === "format" ? action.cells : [];',
    "apply refuses an action of the wrong shape as bad_action",
  ),
  "grid-apply-gone": gridEdits(
    "apply reads a cell of a row or column the action took away",
    "      if (r < 0 || c < 0) continue;\n",
    "",
    "deleting every row of a merge down a column, or every column of a merge across a row, fires one event whose inverse puts the merge back",
  ),
  "grid-import-plain": {
    what: "an import parses a field under its cell's format",
    file: GRID,
    find: 'fmt: data && fmtKind(effective) !== "text" ? null : effective',
    replace: "fmt: effective",
    test: "test/grid/grid-csv-plain.test.js",
    name: "an import reads a field as plain data",
    expects: /toEqual|toBe/,
  },
  "grid-import-plain-text": {
    what: "an import parses a field in a text cell as plain data too",
    file: GRID,
    find: 'fmt: data && fmtKind(effective) !== "text" ? null : effective',
    replace: "fmt: data ? null : effective",
    test: "test/grid/grid-csv-plain.test.js",
    name: "an import reads a field as plain data",
    expects: /toEqual|toBe/,
  },
  "grid-import-text-unprotect": {
    what: "an import into a text cell keeps the apostrophe our export with protect wrote",
    file: GRID,
    find: 'const text = data && fmtKind(effective) === "text" ? unprotected(item) : local;',
    replace: "const text = local;",
    test: "test/grid/grid-csv-plain.test.js",
    name: "a protected export imported back over text and percent columns",
    expects: /toEqual|toBe/,
  },
  "grid-index-csv": gridEdits(
    "the grid index leaves out the delimited text helpers",
    'export { DelimitedError, detectDelimiter, parseDelimited, writeDelimited, protectField } from "./csv.js";\n',
    "",
    "the grid index exports the delimited text helpers",
    "src/grid/index.js",
  ),
  "stale-unknown": stale("cells under a format no formatter knows are formatted again", 'if (fmtKind(look) === "unknown") {', "if (false) {", UNKNOWN_KEPT),
  "stale-early": stale(
    "the stale mark goes while a formula is waiting",
    "        if (cell.f !== undefined) {\n          if (engine === null) waiting = true;\n          return;\n        }\n",
    "        if (cell.f !== undefined) return;\n",
    HOST_FORMULA,
  ),
  "stale-revision": stale("the refresh moves the revision", '    return emit({ source: "derived", structure: false,', '    revision += 1;\n    return emit({ source: "derived", structure: false,', HOST_PLAIN),
  "budget-outerhtml": budget(
    "the bytes are taken from outerHTML",
    DOM,
    "    bytes: () => canonicalGrid(domAdapter, table),",
    "    bytes: () => table.outerHTML,",
    "check 1: budget-20k built through setRange gives the writer's bytes for the same model, at or under 30 bytes per filled cell, and not table.outerHTML",
  ),
  "budget-always-fmt": budget(
    "typed input always writes its format, also over a format of the same kind",
    "src/grid/content.js",
    "    return brought === columnFmt ? null : brought;\n  }\n  return undefined;\n}",
    "    return brought === columnFmt ? null : brought;\n  }\n  return brought === columnFmt ? null : brought;\n}",
    "check 3: the ceiling holds after 1,000 g.set calls typing grouped numbers, currency and dates into columns that already have that format, and no typed cell takes a format of its own",
  ),
  "stale-column-fmt": stale("the refresh reads only the cell's own format", "        const look = effectiveFmt(cell, column);", "        const look = cell.fmt ?? null;", HOST_PLAIN),
  "stale-damaged-first": stale(
    "the refresh writes into a table with issues",
    "    if (backing.sheet.stale !== true || issues.length > 0) return null;",
    "    if (backing.sheet.stale !== true) return null;",
    DAMAGED_STALE,
  ),
  "stale-load": stale("loading leaves a stale table as the host wrote it", "\n  refresh();\n\n  // What a step another Grid", "\n\n  // What a step another Grid", HOST_PLAIN),
  "stale-whole-read": stale(
    "a whole read leaves a host patch unformatted",
    "structure: true, cells: [], rows: noRecords(), cols: noRecords() });\n    refresh();\n",
    "structure: true, cells: [], rows: noRecords(), cols: noRecords() });\n",
    HOST_LIVE,
  ),
  "stale-repair": stale("a repair leaves the stale mark", "    schedule(table);\n    refresh();\n", "    schedule(table);\n", DAMAGED_STALE),
  "stale-unknown-waiting": stale(
    "a plain number under a format no formatter knows leaves nothing waiting",
    "          if (waitsForFormatter(cell, look)) waiting = true;\n",
    "",
    UNKNOWN_KEPT,
  ),
  "stale-unknown-v": {
    what: "every number under a format no formatter knows keeps the mark, formatted or not",
    file: "src/grid/content.js",
    find: 'cell?.n === true && cell.v === undefined && fmtKind(fmt) === "unknown"',
    replace: 'cell?.n === true && fmtKind(fmt) === "unknown"',
    test: STALE_TEST,
    name: UNKNOWN_KEPT,
    expects: /toEqual|toBe/,
  },
  "repair-append-dom": repair("a column added after the last one moves the cells of a row that reaches it in the table", DOM, "    if (c === colEls.length - 1) return col;\n", "", PAST_LAST),
  "repair-append-model": repair(
    "a column added after the last one moves the cells of a row that reaches it in the mirror",
    "src/grid/backing-model.js",
    "      if (c < store.cols.length - 1) for (const row of store.rows) if (row.cells.length > c) row.cells.splice(c, 0, null);",
    "      for (const row of store.rows) if (row.cells.length > c) row.cells.splice(c, 0, null);",
    PAST_LAST,
  ),
  "repair-hidden-kept": repair(
    "a hidden cell shown again under a merge down a column takes an empty cell before it",
    "src/grid/normalize.js",
    "const kept = (r, c, cell) => shownCells.has(cell);",
    "const kept = () => false;",
    "text in a hidden cell under a merge down a column is shown where it was, and the cells beside it keep their columns",
  ),
  "repair-hidden-first": repair(
    "each hidden text is shown and its merge undone before the next is shown, at a place read before the undo moved its row",
    "src/grid/normalize.js",
    "    shownCells.add(shown);\n  }\n  const kept = (r, c, cell) => shownCells.has(cell);\n  for (const cell of shownCells) {\n    for (let place = placeOf(sheet, cell); place !== null; place = placeOf(sheet, cell)) {\n",
    "    shownCells.add(shown);\n    const kept = (r, c, cell) => shownCells.has(cell);\n    for (let place = placeOf(sheet, shown); place !== null; place = placeOf(sheet, shown)) {\n",
    "two hidden texts under one merge down a column, the second in a row with no placeholder for the merge: repair keeps every text, and the row's shown cell stays in the column the page drew it in",
  ),
  "repair-past-splice": repair(
    "a shown cell under an undone merge in a row below takes an empty cell before it, so a hidden text shown in that row moves a column right",
    "src/grid/normalize.js",
    "        past.push(covered ?? null);\n        target.cells[col + j] = null;\n",
    "        target.cells.splice(col + j, 0, null);\n",
    "a merge down and across over a row with its own value and a hidden note: repair keeps the value in the column the page drew it in and shows the note where it was",
  ),
  "repair-text-row-stays": repair(
    "an undone span moves a shown cell of a row with hidden text one column right, as in a row the slot rule placed",
    "src/grid/normalize.js",
    " && !stays(row + i)) {",
    ") {",
    "a repair keeps a row with hidden text in the columns its cells sit at",
  ),
  "repair-covers-value": repair(
    "a kept span is filled with placeholders over a value an earlier undo moved under it",
    "src/grid/normalize.js",
    "      if (coversValue(sheet, r, c, cs, rs)) {\n",
    "      if (false) {\n",
    "a repair that undoes a span over a value keeps that value even when another span it kept now covers it",
  ),
  "repair-one-run": repair(
    "the repair runs once, so a table whose first run leaves work for a second needs a second repair",
    "src/grid/normalize.js",
    "const RUNS = 4;",
    "const RUNS = 1;",
    "one repair settles a table whose first run leaves work for a second",
  ),
  "grid-intake-hidden": repair(
    "a write from outside the grid that puts text in a cell hidden under a merge is not checked, so the sheet does not refuse until repair",
    "src/grid/grid.js",
    '      if (indexes.some(hidesText) || issues.some((issue) => issue.code === "hidden_text" && indexes.includes(issue.row))) check();\n',
    "",
    "text a write from outside the grid puts in a cell hidden under a merge is found at once: an unmerge refuses until a repair shows it",
  ),
  "grid-intake-hidden-gone": repair(
    "a write from outside the grid that takes away the text of a cell hidden under a merge leaves its issue",
    "src/grid/grid.js",
    ' || issues.some((issue) => issue.code === "hidden_text" && indexes.includes(issue.row))) check();',
    ") check();",
    "hidden text a write from outside the grid takes away again leaves no issue",
  ),
  "dom-paint-node": {
    what: "a cell's text is written as a new text node, so an undo record kept from an edit before names a node no longer there",
    file: "src/grid/backing-dom.js",
    find: "  if (only !== null && only === td.lastChild && only.nodeType === only.TEXT_NODE && cell.text !== \"\") {\n",
    replace: "  if (false) {\n",
    test: "test/grid/grid-undo.test.js",
    name: "two undos after a column format put back the typed number, then the text it replaced",
    expects: /toEqual|toBe/,
  },
  "dom-paint-empty": {
    what: "a cleared cell keeps an empty text node, which a parser of its bytes does not build",
    file: "src/grid/backing-dom.js",
    find: " && cell.text !== \"\") {\n",
    replace: ") {\n",
    test: "test/grid/grid-undo.test.js",
    name: "after a column format, undo takes away the text node typed into an emptied cell, then puts back the text it cleared",
    expects: /toEqual|toBe/,
  },
  "dom-own-text": {
    what: "a column format change writes over text no formatter can make again as a write that is not an edit, so an undo cannot put it back",
    file: "src/grid/backing-dom.js",
    find: '    if (loud > 0 || isEdit(old, next) || (ownText.has(old) && old.text !== (next?.text ?? ""))) draw();\n',
    replace: "    if (loud > 0 || isEdit(old, next)) draw();\n",
    test: "test/grid/grid-undo.test.js",
    name: "an undo of a column format over a format no formatter knows puts back the text that format showed, with its number",
    expects: /toEqual|toBe/,
  },
  "dom-own-text-known": {
    what: "a column format change writes every cell of the column as an edit, under a known format too",
    file: "src/grid/backing-dom.js",
    find: '&& fmtKind(effectiveFmt(held, column)) === "unknown") ownText.add(held);',
    replace: ") ownText.add(held);",
    test: "test/grid/grid-undo.test.js",
    name: "two undos after a column format put back the typed number, then the text it replaced",
    expects: /toEqual|toBe/,
  },
  "grid-settled-column": {
    what: "a foreign write that changes a column's format and its cells' text drops the number of a cell under a format no formatter knows",
    file: GRID,
    find: ": cell.v === before?.v && fmt === effectiveFmt(before, beforeColumn))",
    replace: ": cell.v === before?.v && cell.fmt === before?.fmt)",
    test: "test/grid/grid-undo.test.js",
    name: "an undo of a column format over a format no formatter knows puts back the text that format showed, with its number",
    expects: /toEqual|toBe/,
  },
  "ops-batch-loud": {
    what: "a batch redraws a formatted column's cells as writes that are not edits, so an undo of the batch puts back the redrawn text of a cell a later action cleared, without its number",
    file: "src/grid/ops.js",
    find: '(action?.t === "batch" && backing.loudly ? backing.loudly(run) : run())',
    replace: "run()",
    test: "test/grid/grid-undo.test.js",
    name: "an undo of one batch that formats a column and clears a number typed before it gives back the number",
    expects: /toEqual|toBe/,
  },
  "ops-batch-loud-result": {
    what: "a batch shows a formula's result as a write that is not an edit, so an undo of the batch leaves the result beside the text it puts back",
    file: "src/grid/ops.js",
    find: '(action?.t === "batch" && backing.loudly ? backing.loudly(run) : run())',
    replace: "run()",
    test: "test/grid/grid-undo.test.js",
    name: "an undo of one batch that writes a formula over text and then gives it a result gives back the text",
    expects: /toEqual|toBe/,
  },
  "dom-regroup-paused": {
    what: "a row edit moves rows between tbodies as a derived write, so an undo of the edit puts rows back out of order",
    file: DOM,
    find: "    if (!grouped(starts)) regroup(starts);\n",
    replace: "    if (!grouped(starts)) write(() => regroup(starts));\n",
    test: "test/grid/grid-undo.test.js",
    name: "an undo of a row move, a delete and an insert across the 50-row group cut",
    expects: /toEqual|toBe/,
  },
  "dom-col-delete-regroup": {
    what: "a column delete that ends a long vertical merge leaves the rows in the long group, so the live table is not the tree its bytes give",
    file: DOM,
    find: "    if (spanned) settle();\n",
    replace: "",
    test: "test/grid/backing-dom-structure.test.js",
    name: "lists of every action kind give the same bytes and the same tree, part 5 of 6",
    expects: /the live table is the tree its bytes parse to/,
  },
  "grid-settled-put-back": {
    what: "a write from outside the grid that changed the text keeps a v it put back that does not give that text",
    file: GRID,
    find: "(known ? !explains(cell, fmt) : cell.v === before?.v",
    replace: "(known ? cell.v === before?.v && !explains(cell, fmt) : cell.v === before?.v",
    test: "test/grid/grid-foreign.test.js",
    name: "a write from outside the grid that puts other text and another v in a formatted cell is read as the text",
    expects: /toEqual|toBe/,
  },
  "csv-import-unprotect": {
    what: "an import into a column typed text keeps the apostrophe our export wrote",
    file: GRID,
    find: "    const fields = block.map((line) => line.map((field, j) => (asText(j) ? unprotected(field) : field)));\n",
    replace: "    const fields = block;\n",
    test: "test/grid/grid-csv-protect.test.js",
    name: "an export with protect, imported into columns typed text, gives back the same text",
    expects: /toEqual|toBe/,
  },
  "csv-import-unprotect-any": {
    what: "an import into a column typed text drops every leading apostrophe, not only the one our export wrote",
    file: GRID,
    find: "const unprotected = (field) => (field.startsWith(\"'\") && protectField(field.slice(1)) === field ? field.slice(1) : field);\n",
    replace: "const unprotected = (field) => (field.startsWith(\"'\") ? field.slice(1) : field);\n",
    test: "test/grid/grid-csv-protect.test.js",
    name: "an apostrophe our export did not write stays in a column typed text, so text exported without protect comes back the same",
    expects: /toEqual|toBe/,
  },
  "corpus-golden": {
    what: "derive drops n on the value 0",
    file: "src/grid/content.js",
    find: '    const cell = { text: typeof text === "string" ? text : raw, n: true };\n',
    replace: '    const cell = { text: typeof text === "string" ? text : raw };\n    if (content !== 0) cell.n = true;\n',
    test: "test/grid/corpus.test.js",
    name: "corpus session",
    expects: /toEqual|toBe/,
  },
  "corpus-reparse": {
    what: "the DOM backing leaves an old v on a cell that no longer needs one",
    file: DOM,
    find: "  for (const name of ATTRIBUTES) setAttribute(td, name, attributeOf(cell, name));\n",
    replace: '  for (const name of ATTRIBUTES) if (name !== "v" || cell.v !== undefined) setAttribute(td, name, attributeOf(cell, name));\n',
    test: "test/grid/corpus.test.js",
    name: "corpus session",
    expects: /toEqual|toBe/,
  },
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) mutate(MUTATIONS);
