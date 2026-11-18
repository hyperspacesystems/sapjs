// node test/grid/support/write-sessions.js
// Writes the round trip corpus that corpus.test.js replays: one JSON file per scripted session in
// test/grid/golden/sessions, holding the start, the commands, what each command did, the issues
// left at the end and the canonical bytes the live table ends with. The bytes are kept as a list
// of lines so a reviewer reads them by eye, and as a length and a sha256 for a table too long to
// read. Each script states what its commands must do and a few facts its bytes must hold, and
// this script refuses to write a session whose replay says otherwise.
//
// A session that needs the stale refresh of step D8 is written only once test/grid/stale.test.js
// exists, and is skipped with that reason until then.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";

import { keysBetween } from "../../../src/grid/codec/order-keys.js";
import { gridModel } from "../../../src/grid/codec/read.js";
import { tableHtml } from "../../../src/grid/codec/write.js";
import { splitTables } from "./laws.js";
import { linesOf, runSession } from "./session-run.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const GRID = join(HERE, "..");
const SESSIONS = join(GRID, "golden", "sessions");
const CODEC = join(GRID, "..", "grid-codec", "golden");
const REPAIR = join(GRID, "golden", "repair");
const STALE_REFRESH = existsSync(join(GRID, "stale.test.js"));
const LONGEST = 8000;

const read = (path) => readFileSync(path, "utf8");

export const sources = {
  fixture(name) {
    const [file, index] = name.split("#");
    return tableHtml(gridModel(splitTables(read(join(CODEC, `${file}.html`)))[Number(index)], 0));
  },
  repair: (name) => read(join(REPAIR, `${name}.in.html`)).trim(),
};

const table = (...lines) => lines.join("\n");

// Four plain columns and six empty rows.
const BLANK = table(
  '<table grid><colgroup><col data-id="ca" data-pos="G"><col data-id="cb" data-pos="O"><col data-id="cc" data-pos="V"><col data-id="cd" data-pos="d"></colgroup>',
  "<tbody>",
  '<tr data-id="r1" data-pos="G"></tr>',
  '<tr data-id="r2" data-pos="K"></tr>',
  '<tr data-id="r3" data-pos="O"></tr>',
  '<tr data-id="r4" data-pos="V"></tr>',
  '<tr data-id="r5" data-pos="Z"></tr>',
  '<tr data-id="r6" data-pos="d"></tr>',
  "</tbody></table>",
);

// A frozen header row and a frozen first column, a grouped number column, a merge three rows tall
// in column A, a merge two columns wide in row 4, and no formula, so every row and column can move.
const BOARD = table(
  '<table grid freeze-cols="1"><colgroup><col data-id="ca" data-pos="G"><col data-id="cb" data-pos="O" fmt="#,##0"><col data-id="cc" data-pos="V"><col data-id="cd" data-pos="d"></colgroup>',
  "<thead>",
  '<tr data-id="r1" data-pos="8"><td style="font-weight:bold">Room</td><td style="font-weight:bold">Cost</td><td style="font-weight:bold">Who</td><td style="font-weight:bold">Note</td></tr>',
  "</thead><tbody>",
  '<tr data-id="r2" data-pos="G"><td rowspan="3">Kitchen</td><td n v="1200">1,200</td><td>Ana</td><td>tiles</td></tr>',
  '<tr data-id="r3" data-pos="O"><td hidden></td><td n>300</td><td>Ben</td></tr>',
  '<tr data-id="r4" data-pos="V"><td hidden></td><td n>45</td><td colspan="2">paint and brushes</td><td hidden></td></tr>',
  '<tr data-id="r5" data-pos="d"><td>Hall</td><td n>80</td></tr>',
  '<tr data-id="r6" data-pos="l"><td>Garden</td></tr>',
  "</tbody></table>",
);

// What an agent writes: no colgroup, no ids or keys, header cells, and plain HTML spans with no
// placeholder cells.
const AGENT = table(
  "<table grid>",
  "<tr><th>Item</th><th>Qty</th><th>Note</th></tr>",
  '<tr><td colspan="2">Totals</td><td>checked</td></tr>',
  '<tr><td rowspan="2">Box</td><td>3</td><td>a</td></tr>',
  "<tr><td>4</td><td>b</td></tr>",
  "</table>",
);

// Fifty data rows, one full tbody group: one more row needs a second group.
const FIFTY = table(
  '<table grid><colgroup><col data-id="ca" data-pos="V"></colgroup>',
  "<tbody>",
  ...keysBetween(null, null, 50).map((pos, r) => `<tr data-id="r${r + 1}" data-pos="${pos}"><td>row ${r + 1}</td></tr>`),
  "</tbody></table>",
);

// Parts a hand or another tool writes: bare cols with no colgroup, a header cell, 55 rows in one
// tbody and a tfoot.
const PART_KEYS = keysBetween(null, null, 57);
const PARTS = table(
  '<table grid><col data-id="ca" data-pos="G"><col data-id="cb" data-pos="V">',
  `<thead><tr data-id="h" data-pos="${PART_KEYS[0]}"><th>Name</th><th>Qty</th></tr></thead>`,
  "<tbody>",
  ...PART_KEYS.slice(1, 56).map((pos, r) => `<tr data-id="r${r + 1}" data-pos="${pos}"><td>item ${r + 1}</td><td n>${r + 1}</td></tr>`),
  "</tbody>",
  `<tfoot><tr data-id="f" data-pos="${PART_KEYS[56]}"><td>Total</td><td n>1540</td></tr></tfoot>`,
  "</table>",
);

// An id outside the id syntax, a freeze past the last column and a span far past the sheet.
const BAD_IDS = table(
  '<table grid freeze-cols="9"><colgroup><col data-id="bad id" data-pos="G"><col data-id="cb" data-pos="V"></colgroup>',
  "<tbody>",
  '<tr data-id="r1" data-pos="G"><td colspan="1500">Wide</td></tr>',
  '<tr data-id="r1" data-pos="V"><td>a</td><td>b</td></tr>',
  "</tbody></table>",
);

const blank = { html: BLANK };
const board = { html: BOARD };

const change = (count) => Array(count).fill("change");

const REPAIRS = ["duplicate-ids", "keys-out-of-order", "no-ids", "orphan", "overlap", "past-edge", "plain-colspan", "short-cols", "valid-ties"];

const FIXTURES = [
  ["empty", "empty#0"],
  ["escapes", "escapes#0"],
  ["formulas-formatted", "formulas-formatted#0"],
  ["merged", "merged#0", ["merge_past_end"]],
  ["styled", "styled#0"],
  ["tiny-budget", "tiny#0"],
  ["tiny-trip", "tiny#1"],
  ["two-tabs-counter", "two-tabs#0"],
  ["two-tabs-ledger", "two-tabs#1"],
];

// Each script: name, about, start, commands, and what the replay must show: `outcomes` (every
// command a change when left out), `has` and `lacks` (text the end bytes hold and do not hold),
// `issues` at the end (none when left out) and `needs` (a later step the session waits for).
export const SCRIPTS = [
  ...FIXTURES.map(([name, fixture, issues]) => ({
    name: `fixture-${name}`,
    about: `the codec golden ${fixture} loads with no write and keeps its bytes`,
    start: { fixture },
    commands: [],
    issues,
  })),

  {
    name: "input-numbers",
    about: "typed numbers: plain, grouped, a leading point, zero typed and as a value, currency, percent, each with the format its look brings",
    start: blank,
    commands: [
      ["set", "A1", "1,200"],
      ["set", "B1", "-7.5"],
      ["set", "C1", ".5"],
      ["set", "D1", "0"],
      ["set", "A2", 0],
      ["set", "B2", "$5"],
      ["set", "C2", "-$1,200.50"],
      ["set", "D2", "50%"],
      ["set", "A3", "12.5%"],
      ["set", "B3", "1,200.50"],
      ["set", "C3", "  42  "],
      ["set", "D3", "-0"],
    ],
    has: ['<td n v="1200" fmt="#,##0">1,200</td>', "<td n>0</td>", '<td n v="-1200.5" fmt="$#,##0.00">-$1,200.50</td>', '<td n v="0.125" fmt="0.00%">12.50%</td>'],
  },
  {
    name: "input-dates",
    about: "typed dates in every US form, and a date that is not on the calendar stays text",
    start: blank,
    commands: [
      ["set", "A1", "3/14/2026"],
      ["set", "B1", "3/14/26"],
      ["set", "C1", "3/14/30"],
      ["set", "D1", "3-14-2026"],
      ["set", "A2", "2026-03-14"],
      ["set", "B2", "3/14"],
      ["set", "C2", "Mar 14, 2026"],
      ["set", "D2", "march 14 2026"],
      ["set", "A3", "14 Mar 2026"],
      ["set", "B3", "Mar 14"],
      ["set", "C3", "2/30/2026"],
      ["set", "D3", "1/1/1900"],
    ],
    has: ['<td n v="46095" fmt="m/d/yyyy">3/14/2026</td>', '<td n v="46095" fmt="yyyy-mm-dd">2026-03-14</td>', '<td n v="46095" fmt="mmm d, yyyy">Mar 14, 2026</td>', "<td>2/30/2026</td>"],
  },
  {
    name: "input-times",
    about: "typed times and date-times are fractions of a day with the format they were typed in",
    start: blank,
    commands: [
      ["set", "A1", "9:30"],
      ["set", "B1", "9:30:15"],
      ["set", "C1", "9:30 PM"],
      ["set", "D1", "12:00 AM"],
      ["set", "A2", "3/14/2026 9:30"],
      ["set", "B2", "3/14/2026 9:30:15"],
    ],
    has: ['fmt="h:mm AM/PM">9:30 PM</td>'],
  },
  {
    name: "input-text",
    about: "forms that stay text in v1, the apostrophe, a lone = and a lone apostrophe, booleans, and text kept exactly as typed",
    start: blank,
    commands: [
      ["set", "A1", "'0123"],
      ["set", "B1", "'"],
      ["set", "C1", "="],
      ["set", "D1", "+5"],
      ["set", "A2", "(5)"],
      ["set", "B2", "1e5"],
      ["set", "C2", "5."],
      ["set", "D2", "02134"],
      ["set", "A3", "4111111111111111"],
      ["set", "B3", "true"],
      ["set", "C3", "FALSE"],
      ["set", "D3", "  padded  "],
      ["set", "A4", "a<b & c"],
      ["set", "B4", "line\r\nbreak"],
      ["set", "C4", "'TRUE"],
      ["set", "D4", "12,34"],
    ],
    outcomes: ["change", "nothing", ...change(14)],
    has: ["<td>0123</td>", "<td>+5</td>", "<td>02134</td>", "<td>TRUE</td>", "<td>  padded  </td>", "<td>a&lt;b &amp; c</td>", "<td t>TRUE</td>"],
  },
  {
    name: "input-formulas",
    about: "a formula is kept as typed with empty text and marks the table stale, and a format on it waits for its result",
    start: blank,
    commands: [
      ["set", "A1", "5"],
      ["set", "B1", "=A1+1"],
      ["set", "C1", "=SUM(A1:B1)"],
      ["format", "C1", { fmt: "$#,##0.00" }],
      ["setRange", "D1", [[{ content: { f: "=A1*2" }, style: { color: "#ff0000" } }]]],
    ],
    has: ["<table grid stale>", '<td f="=A1+1"></td>', '<td f="=SUM(A1:B1)" fmt="$#,##0.00"></td>'],
  },
  {
    name: "input-values",
    about: "values given as values, not typed text: a number, minus zero, booleans, a large number and null",
    start: blank,
    commands: [
      ["set", "A1", 450],
      ["set", "B1", -0],
      ["set", "C1", true],
      ["set", "D1", false],
      ["set", "A2", 1e21],
      ["set", "B2", 0.1],
      ["set", "C2", 123456789012345],
      ["set", "A1", null],
    ],
    has: ["<td n>1000000000000000000000</td>", "<td>TRUE</td>"],
  },
  {
    name: "input-into-formats",
    about: "typed input meets the cell's format: a look of the same kind keeps the format, another kind brings its own, and a plain number in a percent cell is a percent",
    start: { fixture: "tiny#0" },
    commands: [
      ["set", "B3", "1,200"],
      ["set", "B2", "$7"],
      ["set", "C2", "20"],
      ["set", "C3", "25%"],
      ["format", "A4", { fmt: "0.00" }],
      ["set", "A4", "1,200"],
    ],
    has: ['<td n v="1200" fmt="#,##0">1,200</td>', '<td n v="7">$7.00</td>', '<td n v="0.2">20%</td>', '<td n v="1200" fmt="0.00">1200.00</td>'],
  },
  {
    name: "input-text-column",
    about: "under the format @ everything typed is text, a leading = and a grouped number included",
    start: blank,
    commands: [
      ["format", "A:A", { fmt: "@" }],
      ["set", "A1", "=1+1"],
      ["set", "A2", "1,200"],
      ["set", "A3", "007"],
      ["set", "A4", "TRUE"],
    ],
    has: ['<col data-id="ca" data-pos="G" fmt="@">', "<td>=1+1</td>", "<td t>TRUE</td>"],
  },
  {
    name: "set-nothing",
    about: "a command for what the sheet already holds writes nothing",
    start: { fixture: "tiny#0" },
    commands: [
      ["set", "B2", 1200],
      ["set", "A2", "Rent"],
      ["format", "B2", { fmt: "$#,##0.00" }],
      ["format", "A1", { style: { "font-weight": "bold" } }],
      ["clear", "A4:C4"],
    ],
    outcomes: ["nothing", "nothing", "nothing", "nothing", "nothing"],
  },

  {
    name: "set-range-block",
    about: "a block of typed text, values and neutral items is one action; detect: false keeps text and formulas: false keeps a formula as text",
    start: blank,
    commands: [
      ["setRange", "A1", [["Item", "Qty", "Price"], ["Box", "3", "$4.50"], ["Tape", { content: 2, fmt: "0.00" }, { content: "x", style: { "font-weight": "bold" } }]]],
      ["setRange", "D1", [["1,200"], ["=A1"]], { detect: false }],
      ["setRange", "A4", [["=B2*2", "3/14/2026"]], { formulas: false }],
      ["setRange", "A5", [["1,200", "50%"]], { formats: false }],
    ],
    has: ["<td n>1200</td>", "<td n>0.5</td>", '<td n v="4.5" fmt="$#,##0.00">$4.50</td>', '<td n v="2" fmt="0.00">2.00</td>', '<td style="font-weight:bold">x</td>', "<td>1,200</td>", "<td>=B2*2</td>"],
  },
  {
    name: "set-range-grow",
    about: "a block past the sheet is refused without grow and brings its rows and columns with it",
    start: blank,
    commands: [
      ["setRange", "C5", [["a", "b", "c"], ["1", "2", "3"], ["x", "y", "z"]]],
      ["setRange", "C5", [["a", "b", "c"], ["1", "2", "3"], ["x", "y", "z"]], { grow: true }],
      ["set", "A10", "far", { grow: true }],
      ["set", "A10011", "too far", { grow: true }],
    ],
    outcomes: ["refused outside_sheet", "change", "change", "refused too_large"],
    has: ['<col data-id="cs2" data-pos="p">', '<tr data-id="rs5" data-pos="y"><td>far</td></tr>'],
  },
  {
    name: "clear",
    about: "clear empties content, formulas included, and keeps each cell's own format and style",
    start: { fixture: "tiny#0" },
    commands: [["clear", "A2:C3"], ["clear", "A1"]],
    lacks: ["Rent", "Food", "=B2/B$5"],
  },
  {
    name: "format-cells",
    about: "a cell's own format is set, removed and set to its column's format, and zero is formatted like any number",
    start: blank,
    commands: [
      ["setRange", "A1", [[0, 1.5, -2], [1200, 0.25, 0]]],
      ["format", "A1:C2", { fmt: "0.00" }],
      ["format", "B2", { fmt: "0%" }],
      ["format", "A1", { fmt: null }],
      ["format", "C1:C2", { fmt: "$#,##0.00" }],
    ],
    has: ["<td n>0</td>", '<td n v="0" fmt="$#,##0.00">$0.00</td>', '<td n v="0.25" fmt="0%">25%</td>'],
  },
  {
    name: "format-style",
    about: "style properties in one written order, and the border presets",
    start: blank,
    commands: [
      ["setRange", "A1", [["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]]],
      ["format", "A1:C1", { style: { "font-weight": "bold", color: "rgb(255, 0, 0)", "background-color": "#EEE" } }],
      ["format", "A2", { style: { "font-style": "italic", "text-align": "center" } }],
      ["format", "A1:C3", { border: { preset: "outer", line: "1px solid #333333" } }],
      ["format", "B2", { border: { preset: "all", line: "2px dashed #ff0000" } }],
      ["format", "A1:C1", { style: { "font-weight": null } }],
      ["format", "C3", { border: { preset: "none" } }],
      ["format", "A2:C3", { border: { preset: "inner", line: "1px dotted #999999" } }],
      ["format", "A1:A3", { border: { preset: "left", line: "3px double #0000ff" } }],
    ],
    has: ['<td style="border-top:2px dashed #ff0000;border-right:1px dotted #999999;border-bottom:1px dotted #999999;border-left:2px dashed #ff0000">e</td>'],
  },
  {
    name: "format-column",
    about: "a format on whole columns is the column default, and its cells lose their own",
    start: { fixture: "tiny#1" },
    commands: [["format", "B:B", { fmt: "0.00" }], ["format", "A:B", { fmt: "#,##0" }]],
    has: ['<col data-id="ce" data-pos="V" fmt="#,##0">'],
    lacks: ['fmt="mmm d, yyyy"'],
  },

  {
    name: "insert-rows",
    about: "rows inserted in the middle and at the end, the end ones copying the format of a row and not its content",
    start: board,
    commands: [["insertRows", 6, 1], ["insertRows", 8, 2, { like: 1 }]],
    has: ['<tr data-id="rs1" data-pos="h"></tr>', '<tr data-id="rs3" data-pos="t"><td style="font-weight:bold"></td>'],
  },
  {
    name: "delete-rows",
    about: "deleting rows at the end, and the inverse puts the records back with their cells",
    start: board,
    commands: [["deleteRows", "5:6"]],
    lacks: ["Hall", "Garden"],
  },
  {
    name: "move-rows",
    about: "rows moved to the end and up past a merge, keeping their ids and cells",
    start: board,
    commands: [["moveRows", "5", 7], ["moveRows", "6", 2]],
  },
  {
    name: "row-height",
    about: "a row height is height:Npx first in the row's style, and a frozen row keeps its place",
    start: board,
    commands: [["setRowHeight", "2:3", 30], ["setRowHeight", "1", 24], ["setRowHeight", "2", 40]],
    has: ['<tr data-id="r2" data-pos="G" style="height:40px">', '<tr data-id="r1" data-pos="8" style="height:24px">'],
  },
  {
    name: "insert-cols",
    about: "a column inserted in the middle widens the merge it lands in, and one at the end copies a column's format",
    start: board,
    commands: [["insertCols", "D", 1], ["insertCols", "F", 1, { like: "B" }]],
    has: ['<td colspan="3">paint and brushes</td>', '<col data-id="cs2" data-pos="p" fmt="#,##0">'],
  },
  {
    name: "delete-cols",
    about: "deleting a column a merge spans makes the merge narrower, and one cell wide loses its span",
    start: board,
    commands: [["deleteCols", "D"]],
    has: ["<td>paint and brushes</td>"],
  },
  {
    name: "move-cols",
    about: "a column moved to the front and one moved to the end",
    start: board,
    commands: [["moveCols", "C", "B"], ["moveCols", "B", "E"]],
    outcomes: ["refused merge_cut", "change"],
  },
  {
    name: "col-width",
    about: "a column width is <col style=\"width:Npx\">",
    start: board,
    commands: [["setColWidth", "A:B", 140], ["setColWidth", "D", 60]],
    has: ['<col data-id="ca" data-pos="G" style="width:140px">'],
  },
  {
    name: "merge",
    about: "a merge keeps its anchor's content, clears the rest and hides the covered cells, and its inverse brings the cleared content back",
    start: board,
    commands: [["merge", "B5:C6"], ["merge", "D2:D3"]],
    has: ['<td n colspan="2" rowspan="2">80</td>', '<td rowspan="2">tiles</td>'],
  },
  {
    name: "merge-absorb",
    about: "a merge that holds a smaller merge absorbs it",
    start: board,
    commands: [["merge", "C4:D5"]],
    has: ['<td colspan="2" rowspan="2">paint and brushes</td>'],
  },
  {
    name: "unmerge",
    about: "unmerge named by a covered cell or by the anchor shows the covered cells as empty cells",
    start: board,
    commands: [["unmerge", "A3"], ["unmerge", "C4"]],
    has: ["<td>Kitchen</td>"],
    lacks: ["hidden"],
  },
  {
    name: "freeze",
    about: "freeze moves rows between the thead and the tbody and writes freeze-cols",
    start: board,
    commands: [["freeze", { rows: 0, cols: 2 }], ["freeze", { rows: 1, cols: 0 }]],
    lacks: ["freeze-cols"],
  },
  {
    name: "apply-batch",
    about: "an action a room hands to apply, a batch of a set and a row change, applies whole",
    start: board,
    commands: [
      [
        "apply",
        {
          v: 1,
          t: "batch",
          actions: [
            { v: 1, t: "set", sheet: "", cells: [["r5", "cc", "Cleo"], ["r6", "cb", 15, { fmt: "$#,##0.00" }]] },
            { v: 1, t: "changeRows", sheet: "", rows: [{ id: "r6", height: 28 }] },
          ],
        },
      ],
    ],
    has: ['<tr data-id="r6" data-pos="l" style="height:28px"><td>Garden</td><td n v="15" fmt="$#,##0.00">$15.00</td></tr>'],
  },

  {
    name: "tbody-regroup",
    about: "rows inserted at the top of a full group move one row across each later group, and deleting them leaves one group again",
    start: { html: FIFTY },
    commands: [["insertRows", 1, 2], ["insertRows", 30, 1], ["deleteRows", "1:2"]],
  },
  {
    name: "insert-frozen",
    about: "a row inserted before the last frozen row is frozen",
    start: board,
    commands: [["insertRows", 1, 1], ["insertRows", 3, 1]],
  },
  {
    name: "insert-in-merge",
    about: "a row inserted inside a vertical merge makes it taller and gets a hidden cell in its columns",
    start: board,
    commands: [["insertRows", 3, 1]],
    has: ['<td rowspan="4">Kitchen</td>', '<tr data-id="rs1" data-pos="K"><td hidden></td></tr>'],
  },
  {
    name: "delete-in-merge",
    about: "deleting a row inside a merge makes it shorter",
    start: board,
    commands: [["deleteRows", "3"]],
    has: ['<td rowspan="2">Kitchen</td>'],
  },
  {
    name: "delete-anchor",
    about: "deleting the row that holds a merge's anchor moves the anchor, with its content, to the next row of the merge",
    start: board,
    commands: [["deleteRows", "2"]],
    has: ['<tr data-id="r3" data-pos="O"><td rowspan="2">Kitchen</td>'],
  },
  {
    name: "span-collapse",
    about: "a merge that reaches one cell loses its span attributes",
    start: board,
    commands: [["deleteRows", "3:4"]],
    has: ['<tr data-id="r2" data-pos="G"><td>Kitchen</td>'],
  },
  {
    name: "merge-refusals",
    about: "a move or a freeze that cuts a merge, and a merge that overlaps another in part, are refused and change nothing",
    start: board,
    commands: [["moveRows", "3", 7], ["freeze", { rows: 2 }], ["merge", "B3:C4"], ["merge", "B1:B2"]],
    outcomes: ["refused merge_cut", "refused merge_cut", "refused merge_overlap", "refused merge_cut"],
  },
  {
    name: "tie-rule",
    about: "an insert between two records that share a key gives the run fresh keys in one batch",
    start: { repair: "valid-ties" },
    commands: [["insertRows", 2, 1]],
  },
  {
    name: "formula-guard",
    about: "with no formula engine, a row or column edit that moves a record of a table with formulas is refused, and an append is not",
    start: { fixture: "formulas-formatted#0" },
    commands: [["insertRows", 5, 1], ["deleteRows", "3"], ["moveCols", "E", "A"], ["insertRows", 11, 1], ["insertCols", "F", 1]],
    outcomes: ["refused needs_formula_engine", "refused needs_formula_engine", "refused needs_formula_engine", "change", "change"],
  },

  {
    name: "import-csv",
    about: "CSV with quotes, a quoted line break and a text column, imported as one action that grows the sheet; a field =1+1 stays text",
    start: blank,
    commands: [["importDelimited", 'Name,Qty,Zip\r\n"Smith, Ann",3,02134\r\nBo,=1+1,07030\r\n"two\r\nlines","1,200","""q"""\r\nLast,TRUE,9', "A1", { types: ["auto", "auto", "text"] }]],
    has: ["<td>Smith, Ann</td>", "<td>=1+1</td>", "<td>two\nlines</td>", '<td n v="1200" fmt="#,##0">1,200</td>', '<td>"q"</td>', "<td t>9</td>"],
  },
  {
    name: "import-tsv-formulas",
    about: "TSV imported from a cell inside the sheet with formulas: true brings formulas, and the sheet grows to hold it",
    start: blank,
    commands: [["importDelimited", "a\t=1+1\nb\t=SUM(B2:B3)\nc\t7", "C5", { delimiter: "\t", formulas: true }]],
    has: ["<table grid stale>", '<td f="=1+1"></td>'],
  },

  ...REPAIRS.map((name) => ({
    name: `repair-${name}`,
    about: `the repair input ${name} lists its issues, and repair gives the bytes of ${name}.out.html`,
    start: { repair: name },
    commands: [["repair"]],
    outcomes: [name === "valid-ties" ? "nothing" : "change"],
    repaired: name,
  })),
  {
    name: "repair-hidden-text",
    about: "a hidden cell that holds text is listed as hidden_text and repair shows the text again",
    start: { html: read(join(REPAIR, "hidden-text.in.html")).trim().replace("<td hidden></td>", "<td hidden>kept</td>") },
    commands: [["repair"]],
    repaired: "hidden-text",
  },
  {
    name: "repair-merged-fixture",
    about: "the merged golden's merge past the last row is clamped by the repair, and the sheet then takes writes",
    start: { fixture: "merged#0" },
    commands: [["set", "D1", "x"], ["repair"], ["set", "D1", "x"]],
    outcomes: ["refused needs_repair", "change", "change"],
  },
  {
    name: "repair-parts",
    about: "a table with bare cols, a header cell, 55 rows in one tbody and a tfoot gets the writer's parts from the repair",
    start: { html: PARTS },
    commands: [["repair"]],
    lacks: ["tfoot", "<th>"],
  },
  {
    name: "repair-bad-ids",
    about: "an id outside the id syntax, a repeated id, a freeze past the last column and a span far past the sheet",
    start: { html: BAD_IDS },
    commands: [["repair"]],
    has: ['<table grid freeze-cols="2">', '<td colspan="2">Wide</td>'],
    lacks: ["bad id", "1500"],
  },
  {
    name: "repair-agent-table",
    about: "an agent's table with header cells, no ids and plain spans is repaired with every value in the column a browser shows it in",
    start: { html: AGENT },
    commands: [["repair"], ["set", "C4", "c"]],
    agent: true,
  },

  {
    name: "host-patch-load-plain",
    about: "a host patch writes a plain value and stale; a tab that loads the table formats the value and, with no formula waiting, removes stale",
    start: { fixture: "styled#0", patch: [{ range: "B3", values: [[0.25]] }] },
    commands: [["set", "B2", "10%"]],
    has: ['<td n v="0.25">25.0%</td>'],
    lacks: [" stale"],
    needs: "D8",
  },
  {
    name: "host-patch-load-formulas",
    about: "a host patch on a table with formulas: the loaded tab formats the patched value, and stale stays while formulas wait",
    start: { fixture: "tiny#0", patch: [{ range: "B3", values: [[450]] }] },
    commands: [["set", "A3", "Groceries"]],
    has: ['<td n v="450">$450.00</td>', "<table grid freeze-cols=\"1\" stale>"],
    needs: "D8",
  },
];

const fail = (script, message) => {
  throw new Error(`session ${script.name}: ${message}`);
};

// The session file for one script, after a replay that shows what the script states.
export function sessionOf(script, doc) {
  const run = runSession(script, { doc, sources });
  run.host.remove();
  const outcomes = script.outcomes ?? change(script.commands.length);
  if (JSON.stringify(run.outcomes) !== JSON.stringify(outcomes)) fail(script, `the commands did ${JSON.stringify(run.outcomes)}, the script says ${JSON.stringify(outcomes)}`);
  if (JSON.stringify(run.issues) !== JSON.stringify(script.issues ?? [])) fail(script, `the sheet ends with the issues ${JSON.stringify(run.issues)}`);
  for (const text of script.has ?? []) if (!run.bytes.includes(text)) fail(script, `the bytes do not hold ${text}`);
  for (const text of script.lacks ?? []) if (run.bytes.includes(text)) fail(script, `the bytes hold ${text}`);
  if (script.repaired !== undefined && run.bytes !== read(join(REPAIR, `${script.repaired}.out.html`)).trim()) fail(script, `the bytes are not ${script.repaired}.out.html`);
  const session = { name: script.name, about: script.about, start: script.start, commands: script.commands, outcomes, startIssues: run.startIssues, issues: run.issues };
  for (const key of ["repaired", "agent", "needs"]) if (script[key] !== undefined) session[key] = script[key];
  if (run.bytes.length <= LONGEST) session.bytes = linesOf(run.bytes);
  else session.sha256 = createHash("sha256").update(run.bytes, "utf8").digest("hex");
  session.length = run.bytes.length;
  return session;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { window } = new JSDOM("<!doctype html><body></body>");
  mkdirSync(SESSIONS, { recursive: true });
  for (const file of readdirSync(SESSIONS)) if (file.endsWith(".json")) rmSync(join(SESSIONS, file));
  let written = 0;
  for (const script of SCRIPTS) {
    if (script.needs === "D8" && !STALE_REFRESH) {
      console.log(`skipped ${script.name}: it needs the stale refresh of step D8, and test/grid/stale.test.js does not exist yet`);
      continue;
    }
    writeFileSync(join(SESSIONS, `${script.name}.json`), JSON.stringify(sessionOf(script, window.document), null, 2) + "\n");
    written += 1;
  }
  console.log(`wrote ${written} sessions to ${SESSIONS}`);
}
