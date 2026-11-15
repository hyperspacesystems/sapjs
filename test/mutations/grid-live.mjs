// node test/mutations/grid-live.mjs [dom-mirror|dom-attr-left|dom-trailing|dom-noop|dom-paused|dom-touch-read
//   |dom-derived-loud|dom-stale-loud|dom-stale-noop|dom-attr-rewrite|dom-text-rewrite|dom-markup-kept
//   |dom-read-kept|dom-head-read|dom-row-gone|dom-row-renamed|dom-row-order|dom-rescan-blind
//   |dom-lists-mirror|dom-lists-attr-left|dom-lists-trailing|dom-lists-noop|dom-lists-paused
//   |tree-count|tree-attributes|tree-text
//   |dom-regroup|dom-append-last|dom-empty-thead|dom-col-cells|dom-frozen-move
//   |dom-group-size|dom-group-kept|dom-regroup-loud|dom-col-trim|dom-col-move|dom-reshape
//   |dom-parts-stale|dom-row-frozen|dom-row-count|dom-row-same|dom-row-of
//   |dom-lists-regroup|dom-lists-append-last|dom-lists-empty-thead|dom-lists-col-cells
//   |dom-lists-frozen-move
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
//   |grid-apply-gone]
// Each entry puts one bug back into the grid's live layer and names the test that must then fail.
// With no argument every entry runs, one after another. The dom-lists entries put a bug of the
// first six back and aim it at the seeded lists, which take about twenty seconds a run. The
// entries from dom-regroup on are for the rows and columns of the live table, and their
// dom-lists entries aim at the first part of the lists of every action kind. The grid entries are
// for the Grid: its read side, its writes, from grid-structure-direct on its rows, columns,
// merges and freeze, from grid-import-formula on its CSV and TSV, and from grid-foreign-explains on
// writes from outside the grid and the edits a page and a room make.
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

const tree = (what, find, replace) => ({ what, file: TREE, find, replace, test: CELLS_TEST, name: "sameTree lists a planted difference", expects: /toEqual|toBe/ });

const NO_MIRROR = ["    mirror.putCell(r, c, next);\n", ""];
const NO_REMOVE = ["  if (value === null) node.removeAttribute(name);\n  else node.setAttribute(name, value);", "  if (value !== null) node.setAttribute(name, value);"];
const NO_TRIM = ["  trimRow(tr);\n", ""];
const NO_SAME = ["    if (sameCell(old, next)) return;\n", ""];
const ALL_PAUSED = ["    if (isEdit(old, next)) draw();\n    else write(draw);", "    write(draw);"];
const NO_REGROUP = ["    if (!grouped(starts)) write(() => regroup(starts));\n", ""];
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
    "  if (td.textContent !== cell.text || td.firstElementChild !== null) td.textContent = cell.text;",
    "  td.textContent = cell.text;",
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
  "dom-regroup-loud": structure(
    "the moves that put the groups right are made as ordinary writes",
    "    if (!grouped(starts)) write(() => regroup(starts));\n",
    "    if (!grouped(starts)) regroup(starts);\n",
    "an insert at the top of a 1,000 row sheet",
  ),
  "dom-col-trim": structure(
    "a removed column leaves empty cells at a row's end",
    "      td.remove();\n      trimRow(row);\n    }\n    return record;",
    "      td.remove();\n    }\n    return record;",
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
    "[...checkSheet(backing.sheet), ...hiddenText(table, backing)]",
    "[...checkSheet(backing.sheet)]",
    HIDDEN,
  ),
  "grid-same": grid("a second call for a table makes a second Grid", "  if (known !== undefined) return known;\n", "", "the same table gives the same Grid"),
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
    "return editText(contentOf(own), effectiveFmt(own, column), today());",
    "return editText(contentOf(own), effectiveFmt(own, undefined), today());",
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
    "effectiveFmt(own, column), today());",
    "effectiveFmt(own, column), undefined);",
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
  "grid-noop-text": gridWrite("a cell's own editor text is parsed as fresh input", "    if (item === editText(contentOf(own), effective, today())) return contentOf(own);\n", "", NOOP),
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
    '  if (cell.v !== undefined && cell.v === before?.v && cell.text !== (before?.text ?? "") && (known ? !explains(cell, fmt) : cell.fmt === before?.fmt)) delete cell.v;\n',
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
    "parts.length > 0 });\n    schedule(table);",
    "parts.length > 0 });\n    schedule(parts);",
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
  "grid-export-raw": gridCsv("a raw export writes the shown text", '      const text = values === "raw" ? shown(value) : one?.text ?? "";', '      const text = one?.text ?? "";', KINDS_EXPORT),
  "grid-import-types": gridCsv("an import parses a column typed text", '    const asText = (j) => types[j] === "text";', "    const asText = () => false;", "a column typed text keeps 02134"),
  "grid-import-text-clean": gridCsv(
    "a field of a column typed text keeps its CR LF line breaks",
    "    if (!detect) return plain(item);\n",
    "    if (!detect) return item;\n",
    "a column typed text keeps 02134",
  ),
  "grid-import-dispatch": gridCsv(
    "an import writes without dispatch",
    "    return send(buildImport(backing, at, itemsAt(at, block, (j) => !asText(j), true), { formulas, newId: mint }));",
    "    return apply(trimmed(buildImport(backing, at, itemsAt(at, block, (j) => !asText(j), true), { formulas, newId: mint })));",
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
    "return writeDelimited(eachRow(box, field), { delimiter });",
    "return writeDelimited(eachRow(box, field));",
    "export writes CR LF, quotes a field that holds the delimiter, a quote or a line break, and TSV is the same with a tab",
  ),
  "grid-import-delimiter": gridCsv(
    "an import detects the delimiter when it is given one",
    "block = parseDelimited(text, { delimiter });",
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
    " && (known ? !explains(cell, fmt) : cell.fmt === before?.fmt)) delete cell.v;",
    ") delete cell.v;",
    UNDO_CELL,
  ),
  "grid-foreign-registered": gridForeign(
    "a format an added formatter knows counts as unknown to a write from outside the grid",
    'import { fmtKind } from "./format.js";',
    'import { fmtKind as kindOf, isBuiltin } from "./format.js";\nconst fmtKind = (fmt) => (fmt === null || isBuiltin(fmt) ? kindOf(fmt) : "unknown");',
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
    "    const out = applyAction(backing, action, { derive });\n",
    "    const out = write(() => applyAction(backing, action, { derive }));\n",
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
  "grid-index-csv": gridEdits(
    "the grid index leaves out the delimited text helpers",
    'export { DelimitedError, detectDelimiter, parseDelimited, writeDelimited, protectField } from "./csv.js";\n',
    "",
    "the grid index exports the delimited text helpers",
    "src/grid/index.js",
  ),
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) mutate(MUTATIONS);
