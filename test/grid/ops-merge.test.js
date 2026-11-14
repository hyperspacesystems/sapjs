import { derive } from "../../src/grid/content.js";
import { checkSheet } from "../../src/grid/check.js";
import { apply, fits, GridRefused, needs, creates, targets, validate } from "../../src/grid/ops.js";
import { backing, bytesOf, keptEmpty, rowLine, S, unstale, withClears } from "./support/ops-fixture.js";
import { modelBacking } from "../../src/grid/backing-model.js";
import { sheet } from "./support/sheets.js";

const merged = (options = {}) => backing({ formula: false, box: true, ...options });
const frozenRows = () => merged({ frozen: 2 });
const frozenBoth = () => merged({ frozen: 2, freezeCols: 2 });

const action = (t, extra) => ({ v: 1, t, sheet: S, ...extra });

// The inverse of a merge that absorbed another merge is a batch that holds a batch, which validate
// refuses; this applies a batch one action at a time so that law can be checked.
// Undo and redo go through the reducer itself: a merge that absorbs another merge must redo without a
// batch inside a batch.
function applyAll(store, one) {
  return apply(store, withClears(store, one), { derive });
}

const PINS = [
  [
    "a horizontal merge",
    action("merge", { from: ["r3", "cb"], to: ["r3", "cd"] }),
    `<table grid><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td colspan=\"2\">Total</td><td hidden></td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td>a</td><td n colspan=\"3\">5</td><td hidden></td><td hidden></td></tr>\n<tr data-id=\"r4\" data-pos=\"V\"><td style=\"font-weight:bold;color:#333333\">Bold</td><td n v=\"1200\">1,200</td><td colspan=\"2\" rowspan=\"2\">Box</td><td hidden></td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td n v=\"1205\">1,205</td><td hidden></td><td hidden></td></tr>\n</tbody></table>`,
  ],
  [
    "a vertical merge",
    action("merge", { from: ["r1", "cd"], to: ["r3", "cd"] }),
    `<table grid><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Qty</td><td>Note</td><td rowspan=\"3\">Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td colspan=\"2\">Total</td><td hidden></td><td n>7</td><td hidden></td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td>a</td><td n>5</td><td fmt=\"0%\">plain</td><td hidden></td></tr>\n<tr data-id=\"r4\" data-pos=\"V\"><td style=\"font-weight:bold;color:#333333\">Bold</td><td n v=\"1200\">1,200</td><td colspan=\"2\" rowspan=\"2\">Box</td><td hidden></td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td n v=\"1205\">1,205</td><td hidden></td><td hidden></td></tr>\n</tbody></table>`,
  ],
  [
    "a 2x3 merge",
    action("merge", { from: ["r2", "ca"], to: ["r3", "cc"] }),
    `<table grid><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td colspan=\"3\" rowspan=\"2\">Total</td><td hidden></td><td hidden></td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td hidden></td><td hidden></td><td hidden></td></tr>\n<tr data-id=\"r4\" data-pos=\"V\"><td style=\"font-weight:bold;color:#333333\">Bold</td><td n v=\"1200\">1,200</td><td colspan=\"2\" rowspan=\"2\">Box</td><td hidden></td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td n v=\"1205\">1,205</td><td hidden></td><td hidden></td></tr>\n</tbody></table>`,
  ],
  [
    "a merge given bottom-right first",
    action("merge", { from: ["r3", "cd"], to: ["r3", "cb"] }),
    `<table grid><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td colspan=\"2\">Total</td><td hidden></td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td>a</td><td n colspan=\"3\">5</td><td hidden></td><td hidden></td></tr>\n<tr data-id=\"r4\" data-pos=\"V\"><td style=\"font-weight:bold;color:#333333\">Bold</td><td n v=\"1200\">1,200</td><td colspan=\"2\" rowspan=\"2\">Box</td><td hidden></td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td n v=\"1205\">1,205</td><td hidden></td><td hidden></td></tr>\n</tbody></table>`,
  ],
  [
    "a merge over the formatted anchor",
    action("merge", { from: ["r3", "cc"], to: ["r3", "cd"] }),
    `<table grid><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td colspan=\"2\">Total</td><td hidden></td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td>a</td><td n>5</td><td fmt=\"0%\" colspan=\"2\">plain</td><td hidden></td></tr>\n<tr data-id=\"r4\" data-pos=\"V\"><td style=\"font-weight:bold;color:#333333\">Bold</td><td n v=\"1200\">1,200</td><td colspan=\"2\" rowspan=\"2\">Box</td><td hidden></td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td n v=\"1205\">1,205</td><td hidden></td><td hidden></td></tr>\n</tbody></table>`,
  ],
  [
    "a merge that absorbs the 2x2",
    action("merge", { from: ["r3", "ca"], to: ["r5", "cd"] }),
    `<table grid><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td colspan=\"2\">Total</td><td hidden></td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td colspan=\"4\" rowspan=\"3\">a</td><td hidden></td><td hidden></td><td hidden></td></tr>\n<tr data-id=\"r4\" data-pos=\"V\"><td hidden></td><td hidden></td><td hidden></td><td hidden></td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td hidden></td><td hidden></td><td hidden></td><td hidden></td></tr>\n</tbody></table>`,
  ],
  [
    "a horizontal merge of two",
    action("merge", { from: ["r5", "ca"], to: ["r5", "cb"] }),
    `<table grid><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td colspan=\"2\">Total</td><td hidden></td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td>a</td><td n>5</td><td fmt=\"0%\">plain</td></tr>\n<tr data-id=\"r4\" data-pos=\"V\"><td style=\"font-weight:bold;color:#333333\">Bold</td><td n v=\"1200\">1,200</td><td colspan=\"2\" rowspan=\"2\">Box</td><td hidden></td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td colspan=\"2\">Form</td><td hidden></td><td hidden></td><td hidden></td></tr>\n</tbody></table>`,
  ],
  [
    "a merge of the whole top row",
    action("merge", { from: ["r1", "ca"], to: ["r1", "cd"] }),
    `<table grid><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td colspan=\"4\">Name</td><td hidden></td><td hidden></td><td hidden></td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td colspan=\"2\">Total</td><td hidden></td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td>a</td><td n>5</td><td fmt=\"0%\">plain</td></tr>\n<tr data-id=\"r4\" data-pos=\"V\"><td style=\"font-weight:bold;color:#333333\">Bold</td><td n v=\"1200\">1,200</td><td colspan=\"2\" rowspan=\"2\">Box</td><td hidden></td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td n v=\"1205\">1,205</td><td hidden></td><td hidden></td></tr>\n</tbody></table>`,
  ],
  [
    "unmerge the 1x2",
    action("unmerge", { row: "r2", col: "ca" }),
    `<table grid><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td>Total</td><td></td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td>a</td><td n>5</td><td fmt=\"0%\">plain</td></tr>\n<tr data-id=\"r4\" data-pos=\"V\"><td style=\"font-weight:bold;color:#333333\">Bold</td><td n v=\"1200\">1,200</td><td colspan=\"2\" rowspan=\"2\">Box</td><td hidden></td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td n v=\"1205\">1,205</td><td hidden></td><td hidden></td></tr>\n</tbody></table>`,
  ],
  [
    "unmerge the 2x2",
    action("unmerge", { row: "r4", col: "cc" }),
    `<table grid><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td colspan=\"2\">Total</td><td hidden></td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td>a</td><td n>5</td><td fmt=\"0%\">plain</td></tr>\n<tr data-id=\"r4\" data-pos=\"V\"><td style=\"font-weight:bold;color:#333333\">Bold</td><td n v=\"1200\">1,200</td><td>Box</td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td n v=\"1205\">1,205</td></tr>\n</tbody></table>`,
  ],
  [
    "freeze rows",
    action("freeze", { rowsThrough: "r3" }),
    `<table grid><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<thead>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td colspan=\"2\">Total</td><td hidden></td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td>a</td><td n>5</td><td fmt=\"0%\">plain</td></tr>\n</thead><tbody>\n<tr data-id=\"r4\" data-pos=\"V\"><td style=\"font-weight:bold;color:#333333\">Bold</td><td n v=\"1200\">1,200</td><td colspan=\"2\" rowspan=\"2\">Box</td><td hidden></td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td n v=\"1205\">1,205</td><td hidden></td><td hidden></td></tr>\n</tbody></table>`,
  ],
  [
    "freeze columns",
    action("freeze", { colsThrough: "cb" }),
    `<table grid freeze-cols=\"2\"><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td colspan=\"2\">Total</td><td hidden></td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td>a</td><td n>5</td><td fmt=\"0%\">plain</td></tr>\n<tr data-id=\"r4\" data-pos=\"V\"><td style=\"font-weight:bold;color:#333333\">Bold</td><td n v=\"1200\">1,200</td><td colspan=\"2\" rowspan=\"2\">Box</td><td hidden></td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td n v=\"1205\">1,205</td><td hidden></td><td hidden></td></tr>\n</tbody></table>`,
  ],
  [
    "freeze rows and columns",
    action("freeze", { rowsThrough: "r3", colsThrough: "cb" }),
    `<table grid freeze-cols=\"2\"><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<thead>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td colspan=\"2\">Total</td><td hidden></td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td>a</td><td n>5</td><td fmt=\"0%\">plain</td></tr>\n</thead><tbody>\n<tr data-id=\"r4\" data-pos=\"V\"><td style=\"font-weight:bold;color:#333333\">Bold</td><td n v=\"1200\">1,200</td><td colspan=\"2\" rowspan=\"2\">Box</td><td hidden></td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td n v=\"1205\">1,205</td><td hidden></td><td hidden></td></tr>\n</tbody></table>`,
  ],
  [
    "unfreeze rows",
    action("freeze", { rowsThrough: null }),
    `<table grid><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td colspan=\"2\">Total</td><td hidden></td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td>a</td><td n>5</td><td fmt=\"0%\">plain</td></tr>\n<tr data-id=\"r4\" data-pos=\"V\"><td style=\"font-weight:bold;color:#333333\">Bold</td><td n v=\"1200\">1,200</td><td colspan=\"2\" rowspan=\"2\">Box</td><td hidden></td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td n v=\"1205\">1,205</td><td hidden></td><td hidden></td></tr>\n</tbody></table>`,
    frozenRows,
  ],
  [
    "unfreeze columns",
    action("freeze", { colsThrough: null }),
    `<table grid><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<thead>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td colspan=\"2\">Total</td><td hidden></td><td n>7</td></tr>\n</thead><tbody>\n<tr data-id=\"r3\" data-pos=\"O\"><td>a</td><td n>5</td><td fmt=\"0%\">plain</td></tr>\n<tr data-id=\"r4\" data-pos=\"V\"><td style=\"font-weight:bold;color:#333333\">Bold</td><td n v=\"1200\">1,200</td><td colspan=\"2\" rowspan=\"2\">Box</td><td hidden></td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td n v=\"1205\">1,205</td><td hidden></td><td hidden></td></tr>\n</tbody></table>`,
    frozenBoth,
  ],
  [
    "freeze rows only",
    action("freeze", { rowsThrough: "r3" }),
    `<table grid freeze-cols=\"2\"><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<thead>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td colspan=\"2\">Total</td><td hidden></td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td>a</td><td n>5</td><td fmt=\"0%\">plain</td></tr>\n</thead><tbody>\n<tr data-id=\"r4\" data-pos=\"V\"><td style=\"font-weight:bold;color:#333333\">Bold</td><td n v=\"1200\">1,200</td><td colspan=\"2\" rowspan=\"2\">Box</td><td hidden></td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td n v=\"1205\">1,205</td><td hidden></td><td hidden></td></tr>\n</tbody></table>`,
    frozenBoth,
  ],
  [
    "a merge across the frozen column line",
    action("merge", { from: ["r1", "cb"], to: ["r1", "cc"] }),
    `<table grid freeze-cols=\"2\"><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td colspan=\"2\">Qty</td><td hidden></td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td colspan=\"2\">Total</td><td hidden></td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td>a</td><td n>5</td><td fmt=\"0%\">plain</td></tr>\n<tr data-id=\"r4\" data-pos=\"V\"><td style=\"font-weight:bold;color:#333333\">Bold</td><td n v=\"1200\">1,200</td><td colspan=\"2\" rowspan=\"2\">Box</td><td hidden></td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td n v=\"1205\">1,205</td><td hidden></td><td hidden></td></tr>\n</tbody></table>`,
    () => merged({ freezeCols: 2 }),
  ],
  [
    "a freeze of a column through the 1x2 merge",
    action("freeze", { colsThrough: "ca" }),
    `<table grid freeze-cols=\"1\"><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td colspan=\"2\">Total</td><td hidden></td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td>a</td><td n>5</td><td fmt=\"0%\">plain</td></tr>\n<tr data-id=\"r4\" data-pos=\"V\"><td style=\"font-weight:bold;color:#333333\">Bold</td><td n v=\"1200\">1,200</td><td colspan=\"2\" rowspan=\"2\">Box</td><td hidden></td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td n v=\"1205\">1,205</td><td hidden></td><td hidden></td></tr>\n</tbody></table>`,
    merged,
  ],
];

const vertical = () => merged({ rowspan: true });
const verticalOnly = () => merged({ rowspan: true, box: false });

const formattedBox = () => {
  const store = merged();
  apply(store, action("set", { cells: [["r4", "cc", 1234, { fmt: "#,##0", style: { "font-weight": "bold" } }]] }), { derive });
  return store;
};

const formattedMerge = () => {
  const store = merged();
  apply(store, action("set", { cells: [["r2", "ca", 4321, { fmt: "#,##0.00", style: { "font-weight": "bold" } }]] }), { derive });
  return store;
};

// A vertical merge whose anchor holds the table's only formula: deleting that row moves the formula
// down into a row that stays.
const tallFormula = () => {
  const store = merged();
  apply(store, action("set", { cells: [["r3", "ca", { f: "=B3+1" }]] }), { derive });
  apply(store, withClears(store, action("merge", { from: ["r3", "ca"], to: ["r5", "ca"] })), { derive });
  return store;
};

// A percent column holds the anchor of a merge that runs into plain columns.
const percentAnchor = () => {
  const store = backing({ formula: false, merge: false, box: false });
  apply(store, action("changeCols", { cols: [{ id: "cb", fmt: "0.0%" }] }), { derive });
  apply(store, action("set", { cells: [["r3", "cb", 0.125]] }), { derive });
  apply(store, withClears(store, action("merge", { from: ["r3", "cb"], to: ["r3", "cd"] })), { derive });
  return store;
};

const GROWING = [
  [
    "a row inside the 2x2",
    action("insertRows", { rows: [{ id: "rm", pos: "W" }] }),
    `<table grid><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td colspan=\"2\">Total</td><td hidden></td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td>a</td><td n>5</td><td fmt=\"0%\">plain</td></tr>\n<tr data-id=\"r4\" data-pos=\"V\"><td style=\"font-weight:bold;color:#333333\">Bold</td><td n v=\"1200\">1,200</td><td colspan=\"2\" rowspan=\"3\">Box</td><td hidden></td></tr>\n<tr data-id=\"rm\" data-pos=\"W\"><td></td><td></td><td hidden></td><td hidden></td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td n v=\"1205\">1,205</td><td hidden></td><td hidden></td></tr>\n</tbody></table>`,
    merged,
  ],
  [
    "a row inside a 2x1",
    action("insertRows", { rows: [{ id: "rm", pos: "P" }] }),
    `<table grid><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td colspan=\"2\">Total</td><td hidden></td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td rowspan=\"3\">a</td><td n>5</td><td fmt=\"0%\">plain</td></tr>\n<tr data-id=\"rm\" data-pos=\"P\"><td hidden></td></tr>\n<tr data-id=\"r4\" data-pos=\"V\"><td hidden></td><td n v=\"1200\">1,200</td><td colspan=\"2\" rowspan=\"2\">Box</td><td hidden></td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td n v=\"1205\">1,205</td><td hidden></td><td hidden></td></tr>\n</tbody></table>`,
    vertical,
  ],
  [
    "a column inside a 1x2",
    action("insertCols", { cols: [{ id: "cm", pos: "C" }] }),
    `<table grid><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cm\" data-pos=\"C\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td></td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td colspan=\"3\">Total</td><td hidden></td><td hidden></td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td>a</td><td></td><td n>5</td><td fmt=\"0%\">plain</td></tr>\n<tr data-id=\"r4\" data-pos=\"V\"><td style=\"font-weight:bold;color:#333333\">Bold</td><td></td><td n v=\"1200\">1,200</td><td colspan=\"2\" rowspan=\"2\">Box</td><td hidden></td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td></td><td n v=\"1205\">1,205</td><td hidden></td><td hidden></td></tr>\n</tbody></table>`,
    merged,
  ],
  [
    "a column inside the 2x2",
    action("insertCols", { cols: [{ id: "cm", pos: "U" }] }),
    `<table grid><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cm\" data-pos=\"U\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Qty</td><td>Note</td><td></td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td colspan=\"2\">Total</td><td hidden></td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td>a</td><td n>5</td><td fmt=\"0%\">plain</td></tr>\n<tr data-id=\"r4\" data-pos=\"V\"><td style=\"font-weight:bold;color:#333333\">Bold</td><td n v=\"1200\">1,200</td><td colspan=\"3\" rowspan=\"2\">Box</td><td hidden></td><td hidden></td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td n v=\"1205\">1,205</td><td hidden></td><td hidden></td><td hidden></td></tr>\n</tbody></table>`,
    merged,
  ],
];

const SHRINKING = [
  [
    "a covered row",
    action("deleteRows", { rows: ["r4"] }),
    `<table grid><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td colspan=\"2\">Total</td><td hidden></td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td>a</td><td n>5</td><td fmt=\"0%\">plain</td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td n v=\"1205\">1,205</td><td colspan=\"2\">Box</td><td hidden></td></tr>\n</tbody></table>`,
    vertical,
  ],
  [
    "a covered column",
    action("deleteCols", { cols: ["cb"] }),
    `<table grid><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td>Total</td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td>a</td><td fmt=\"0%\">plain</td></tr>\n<tr data-id=\"r4\" data-pos=\"V\"><td style=\"font-weight:bold;color:#333333\">Bold</td><td colspan=\"2\" rowspan=\"2\">Box</td><td hidden></td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td hidden></td><td hidden></td></tr>\n</tbody></table>`,
    merged,
  ],
  [
    "a covered column of the 2x2",
    action("deleteCols", { cols: ["cd"] }),
    `<table grid><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Qty</td><td>Note</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td colspan=\"2\">Total</td><td hidden></td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td>a</td><td n>5</td><td fmt=\"0%\">plain</td></tr>\n<tr data-id=\"r4\" data-pos=\"V\"><td style=\"font-weight:bold;color:#333333\">Bold</td><td n v=\"1200\">1,200</td><td rowspan=\"2\">Box</td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td n v=\"1205\">1,205</td><td hidden></td></tr>\n</tbody></table>`,
    merged,
  ],
];

const ANCHORS = [
  [
    "the anchor row of a formatted 2x2",
    action("deleteRows", { rows: ["r4"] }),
    `<table grid><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td colspan=\"2\">Total</td><td hidden></td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td>a</td><td n>5</td><td fmt=\"0%\">plain</td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td n v=\"1205\">1,205</td><td n v=\"1234\" fmt=\"#,##0\" colspan=\"2\" style=\"font-weight:bold\">1,234</td><td hidden></td></tr>\n</tbody></table>`,
    formattedBox,
  ],
  [
    "the anchor column of a formatted 1x2",
    action("deleteCols", { cols: ["ca"] }),
    `<table grid><colgroup><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td n v=\"4321\" fmt=\"#,##0.00\" style=\"font-weight:bold\">4,321.00</td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td n>5</td><td fmt=\"0%\">plain</td></tr>\n<tr data-id=\"r4\" data-pos=\"V\"><td n v=\"1200\">1,200</td><td colspan=\"2\" rowspan=\"2\">Box</td><td hidden></td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td n v=\"1205\">1,205</td><td hidden></td><td hidden></td></tr>\n</tbody></table>`,
    formattedMerge,
  ],
  [
    "the anchor column of a percent merge",
    action("deleteCols", { cols: ["cb"] }),
    `<table grid><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td>Total</td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td>a</td><td n v=\"0.125\" fmt=\"0.0%\" colspan=\"2\">12.5%</td><td hidden></td></tr>\n<tr data-id=\"r4\" data-pos=\"V\"><td style=\"font-weight:bold;color:#333333\">Bold</td><td></td><td>TRUE</td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td></tr>\n</tbody></table>`,
    percentAnchor,
  ],
];

const PLAINED = [
  [
    "the anchor row of a 2x1",
    action("deleteRows", { rows: ["r3"] }),
    `<table grid><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td colspan=\"2\">Total</td><td hidden></td><td n>7</td></tr>\n<tr data-id=\"r4\" data-pos=\"V\"><td>a</td><td n v=\"1200\">1,200</td><td></td><td>TRUE</td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td n v=\"1205\">1,205</td></tr>\n</tbody></table>`,
    verticalOnly,
  ],
  [
    "the covered row of a 2x1",
    action("deleteRows", { rows: ["r4"] }),
    `<table grid><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td colspan=\"2\">Total</td><td hidden></td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td>a</td><td n>5</td><td fmt=\"0%\">plain</td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td n v=\"1205\">1,205</td></tr>\n</tbody></table>`,
    verticalOnly,
  ],
];

const MOVED = [
  [
    "the whole 2x1 to the end",
    action("changeRows", { rows: [{ id: "r3", pos: "z" }, { id: "r4", pos: "zz" }] }),
    `<table grid><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td colspan=\"2\">Total</td><td hidden></td><td n>7</td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td n v=\"1205\">1,205</td></tr>\n<tr data-id=\"r3\" data-pos=\"z\"><td rowspan=\"2\">a</td><td n>5</td><td fmt=\"0%\">plain</td></tr>\n<tr data-id=\"r4\" data-pos=\"zz\"><td hidden></td><td n v=\"1200\">1,200</td><td></td><td>TRUE</td></tr>\n</tbody></table>`,
    verticalOnly,
  ],
];

const UNDER_MERGES = [...GROWING, ...SHRINKING, ...ANCHORS, ...PLAINED, ...MOVED];

test("pinned", () => {
  for (const [name, one, bytes, make = merged] of PINS) {
    const store = make();
    const out = apply(store, withClears(store, one), { derive });
    expect([name, out.out]).toEqual([name, "applied"]);
    expect([name, bytesOf(store)]).toEqual([name, bytes]);
    expect([name, keptEmpty(store.sheet)]).toEqual([name, []]);
  }
});

test("merge clears and the inverse brings it back", () => {
  for (const [name, one, bytes, make = merged] of PINS) {
    const store = make();
    const before = bytesOf(store);
    const out = apply(store, withClears(store, one), { derive });
    expect([name, out.out]).toEqual([name, "applied"]);
    const back = applyAll(store, out.inverse);
    expect([name, back.out]).toEqual([name, "applied"]);
    expect([name, unstale(bytesOf(store))]).toEqual([name, before]);
    const again = applyAll(store, back.inverse);
    expect([name, again.out]).toEqual([name, "applied"]);
    expect([name, bytesOf(store)]).toEqual([name, bytes]);
  }

  const store = merged();
  const before = bytesOf(store);
  const out = apply(store, withClears(store, action("merge", { from: ["r3", "ca"], to: ["r5", "cd"] })), { derive });
  expect(out.changes.cells.map((one) => [one.row, one.col, one.before])).toEqual([
    ["r3", "cb", 5],
    ["r3", "cc", "plain"],
    ["r3", "cd", null],
    ["r4", "ca", "Bold"],
    ["r4", "cb", 1200],
    ["r4", "cc", "Box"],
    ["r4", "cd", null],
    ["r5", "ca", "Form"],
    ["r5", "cb", 1205],
    ["r5", "cc", null],
    ["r5", "cd", null],
  ]);
  expect(out.changes.cells.every((one) => one.after === null)).toBe(true);
  // The inverse unmerges, restores the cleared cells, then merges the absorbed 2x2 again.
  expect(out.inverse.actions.map((one) => one.t)).toEqual(["unmerge", "set", "merge"]);
  expect(out.inverse.actions[1].cells).toEqual([
    ["r3", "cb", 5, { fmt: null }],
    ["r3", "cc", "plain", { fmt: "0%" }],
    ["r4", "ca", "Bold", { fmt: null, css: "font-weight:bold;color:#333333" }],
    ["r4", "cb", 1200, { fmt: null }],
    ["r4", "cc", "Box", { fmt: null }],
    ["r5", "ca", "Form", { fmt: null }],
    ["r5", "cb", 1205, { fmt: null }],
  ]);
  expect(out.inverse.actions[2]).toEqual(action("merge", { from: ["r4", "cc"], to: ["r5", "cd"], clears: [] }));
  expect(applyAll(store, out.inverse).out).toBe("applied");
  expect(bytesOf(store)).toBe(before);
  expect(rowLine(bytesOf(store), "r4")).toContain('style="font-weight:bold;color:#333333">Bold');
  expect(rowLine(bytesOf(store), "r3")).toContain('<td fmt="0%">plain</td>');
});

test("a merge names the anchor of the merge it swallows", () => {
  const one = withClears(merged(), action("merge", { from: ["r3", "ca"], to: ["r5", "cd"] }));
  expect(targets(one)).toContainEqual([S, "r4", "cc", "content"]);
  expect(targets(one)).toContainEqual([S, "r4", "cc", "span"]);
  expect(apply(merged(), one, { derive }).out).toBe("applied");

  const named = one.clears.filter(([row, col]) => !(row === "r4" && col === "cc"));
  const out = apply(merged(), { ...one, clears: named }, { derive });
  expect([out.out, out.code]).toEqual(["refused", "merge_stale"]);

});

const REFUSED = [
  ["a partial overlap", action("merge", { from: ["r2", "cb"], to: ["r2", "cd"] }), merged, "merge_overlap"],
  ["a merge across the frozen row line", action("merge", { from: ["r2", "cd"], to: ["r3", "cd"] }), frozenRows, "merge_cut"],
  ["a freeze line through the 2x2 merge", action("freeze", { rowsThrough: "r4" }), merged, "merge_cut"],
  ["a 1x1 merge", action("merge", { from: ["r3", "ca"], to: ["r3", "ca"] }), merged, "bad_action"],
  ["an unmerge of a plain cell", action("unmerge", { row: "r3", col: "ca" }), merged, "bad_action"],
  ["a merge whose clears miss a cell it would empty", action("merge", { from: ["r3", "cb"], to: ["r3", "cd"], clears: [] }), merged, "merge_stale"],
  ["a merge whose clears name a blank cell", action("merge", { from: ["r3", "cb"], to: ["r3", "cd"], clears: [["r3", "cc"], ["r3", "cd"]] }), merged, "merge_stale"],
  ["a missing row", action("merge", { from: ["r9", "ca"], to: ["r3", "ca"] }), merged, "missing_row"],
  ["a missing column", action("merge", { from: ["r3", "cz"], to: ["r3", "cd"] }), merged, "missing_col"],
  ["a freeze of a missing row", action("freeze", { rowsThrough: "r9" }), merged, "missing_row"],
  ["a freeze of a missing column", action("freeze", { colsThrough: "cz" }), merged, "missing_col"],
  ["a set into a covered position", action("set", { cells: [["r2", "cb", 5]] }), merged, "covered_cell"],
  ["a format into a covered position", action("format", { cells: [["r2", "cb", { fmt: "0" }]] }), merged, "covered_cell"],
  ["the anchor row of a merge that holds a formula", action("deleteRows", { rows: ["r3"] }), tallFormula, "needs_formula_engine"],
];

test("refusals", () => {
  for (const [name, one, make, code] of REFUSED) {
    const store = make();
    const before = bytesOf(store);
    const out = apply(store, withClears(store, one), { derive });
    expect([name, out.out, out.code]).toEqual([name, "refused", code]);
    expect([name, bytesOf(store)]).toEqual([name, before]);
  }
});

const roundTrip = (name, one, bytes, make) => {
  const store = make();
  const before = bytesOf(store);
  const out = apply(store, withClears(store, one), { derive });
  expect([name, out.out]).toEqual([name, "applied"]);
  expect([name, bytesOf(store)]).toEqual([name, bytes]);
  expect([name, keptEmpty(store.sheet)]).toEqual([name, []]);
  const back = applyAll(store, out.inverse);
  expect([name, back.out]).toEqual([name, "applied"]);
  expect([name, unstale(bytesOf(store))]).toEqual([name, before]);
  return out;
};

test("insert grows a merge", () => {
  for (const [name, one, bytes, make] of GROWING) roundTrip(name, one, bytes, make);

  const store = merged();
  const before = bytesOf(store);
  const out = apply(store, action("insertRows", { rows: [{ id: "rm", pos: "W", cells: [["cc", "x"]] }] }), { derive });
  expect([out.out, out.code]).toEqual(["refused", "covered_cell"]);
  expect(bytesOf(store)).toBe(before);
});

test("delete shrinks a merge", () => {
  for (const [name, one, bytes, make] of SHRINKING) roundTrip(name, one, bytes, make);
});

test("deleting the anchor moves it", () => {
  for (const [name, one, bytes, make] of ANCHORS) roundTrip(name, one, bytes, make);

  const store = formattedBox();
  const before = bytesOf(store);
  const out = apply(store, action("deleteRows", { rows: ["r4"] }), { derive });
  expect(out.out).toBe("applied");
  expect(rowLine(bytesOf(store), "r5")).toContain('<td n v="1234" fmt="#,##0" colspan="2" style="font-weight:bold">1,234</td>');
  expect(rowLine(bytesOf(store), "r5")).not.toContain("rowspan");
  expect(out.changes.cells).toEqual([{ sheet: S, row: "r5", col: "cc", before: null, after: 1234 }]);
  const back = applyAll(store, out.inverse);
  expect(back.out).toBe("applied");
  expect(bytesOf(store)).toBe(before);

  const across = formattedMerge();
  const acrossBefore = bytesOf(across);
  const gone = apply(across, action("deleteCols", { cols: ["ca"] }), { derive });
  expect(gone.out).toBe("applied");
  expect(rowLine(bytesOf(across), "r2")).toContain('<td n v="4321" fmt="#,##0.00" style="font-weight:bold">4,321.00</td>');
  expect(rowLine(bytesOf(across), "r2")).not.toContain("colspan");
  const again = applyAll(across, gone.inverse);
  expect(again.out).toBe("applied");
  expect(bytesOf(across)).toBe(acrossBefore);

  const percent = percentAnchor();
  const percentBefore = bytesOf(percent);
  const cut = apply(percent, action("deleteCols", { cols: ["cb"] }), { derive });
  expect(cut.out).toBe("applied");
  const percentAfter = bytesOf(percent);
  expect(rowLine(percentAfter, "r3")).toContain('<td n v="0.125" fmt="0.0%" colspan="2">12.5%</td>');
  const undone = applyAll(percent, cut.inverse);
  expect(undone.out).toBe("applied");
  expect(bytesOf(percent)).toBe(percentBefore);
  const redone = applyAll(percent, undone.inverse);
  expect(redone.out).toBe("applied");
  expect(bytesOf(percent)).toBe(percentAfter);
});

test("a 2-row merge becomes plain", () => {
  for (const [name, one, bytes, make] of PLAINED) roundTrip(name, one, bytes, make);

  for (const rows of [["r3"], ["r4"]]) {
    const store = verticalOnly();
    const out = apply(store, action("deleteRows", { rows }), { derive });
    expect([rows, out.out]).toEqual([rows, "applied"]);
    expect([rows, bytesOf(store).includes("rowspan")]).toEqual([rows, false]);
    expect([rows, checkSheet(store.sheet)]).toEqual([rows, []]);
  }
});

const CUT = [
  ["one row of the merge away", action("changeRows", { rows: [{ id: "r3", pos: "z" }] }), verticalOnly],
  ["its covered row away", action("changeRows", { rows: [{ id: "r4", pos: "1" }] }), verticalOnly],
  ["the two rows out of order", action("changeRows", { rows: [{ id: "r4", pos: "z" }, { id: "r3", pos: "zz" }] }), verticalOnly],
  ["a merge column away", action("changeCols", { cols: [{ id: "cb", pos: "z" }] }), merged],
  ["the two columns out of order", action("changeCols", { cols: [{ id: "cb", pos: "8a" }, { id: "ca", pos: "8b" }] }), merged],
];

test("cutting moves refuse", () => {
  for (const [name, one, make] of CUT) {
    const store = make();
    const before = bytesOf(store);
    const fit = fits(store, one);
    expect([name, fit === true ? true : fit.code]).toEqual([name, "merge_cut"]);
    const out = apply(store, withClears(store, one), { derive });
    expect([name, out.out, out.code]).toEqual([name, "refused", "merge_cut"]);
    expect([name, bytesOf(store)]).toEqual([name, before]);
  }
  for (const [name, one, bytes, make] of MOVED) roundTrip(name, one, bytes, make);
});

test("checkSheet stays clean", () => {
  for (const [name, one, , make = merged] of [...PINS, ...UNDER_MERGES]) {
    const store = make();
    expect([name, checkSheet(store.sheet)]).toEqual([name, []]);
    const out = apply(store, withClears(store, one), { derive });
    expect([name, out.out]).toEqual([name, "applied"]);
    expect([name, checkSheet(store.sheet)]).toEqual([name, []]);
    const back = applyAll(store, out.inverse);
    expect([name, back.out]).toEqual([name, "applied"]);
    expect([name, checkSheet(store.sheet)]).toEqual([name, []]);
  }
});

test("fits agrees with apply", () => {
  let applied = 0;
  let refused = 0;
  const cases = [
    ...PINS.map(([name, one, , make = merged]) => [name, one, make]),
    ...UNDER_MERGES.map(([name, one, , make]) => [name, one, make]),
    ...REFUSED.map(([name, one, make]) => [name, one, make]),
    ...CUT.map(([name, one, make]) => [name, one, make]),
  ];
  for (const [name, one, make] of cases) {
    const read = make();
    const before = bytesOf(read);
    const fit = fits(read, withClears(read, one));
    expect([name, bytesOf(read)]).toEqual([name, before]);
    const store = make();
    const out = apply(store, withClears(store, one), { derive });
    expect([name, fit === true]).toEqual([name, out.out === "applied"]);
    if (fit === true) applied++;
    else refused++;
  }
  expect(applied).toBeGreaterThan(0);
  expect(refused).toBeGreaterThan(0);
});

test("validate", () => {
  const invalid = [
    ["a from that is not a pair", action("merge", { from: "r1/ca", to: ["r3", "cd"] })],
    ["a to with three ids", action("merge", { from: ["r1", "ca"], to: ["r3", "cd", "x"] })],
    ["a from with an id outside the syntax", action("merge", { from: ["r 1", "ca"], to: ["r3", "cd"] })],
    ["an unmerge without a row", action("unmerge", { col: "ca" })],
    ["an unmerge with a column that is not an id", action("unmerge", { row: "r2", col: "c c" })],
    ["a freeze with neither field", action("freeze", {})],
    ["a freeze through a number", action("freeze", { rowsThrough: 5 })],
    ["an unknown field on a merge", action("merge", { from: ["r1", "ca"], to: ["r3", "cd"], rows: [] })],
    ["a clears that is not a list", action("merge", { from: ["r1", "ca"], to: ["r3", "cd"], clears: "r1/ca" })],
    ["a clears entry that is not a pair", action("merge", { from: ["r1", "ca"], to: ["r3", "cd"], clears: [["r1"]] })],
    ["a clears that names a cell twice", action("merge", { from: ["r1", "ca"], to: ["r3", "cd"], clears: [["r1", "cc"], ["r1", "cc"]] })],
  ];
  for (const [name, one] of invalid) {
    let caught = null;
    try {
      validate(one);
    } catch (err) {
      caught = err;
    }
    expect([name, caught instanceof GridRefused]).toEqual([name, true]);
    expect([name, caught.code]).toEqual([name, "bad_action"]);
  }
  expect(validate(action("merge", { from: ["r1", "ca"], to: ["r3", "cd"] }))).toBe(undefined);
  expect(validate(action("freeze", { rowsThrough: null, colsThrough: "cb" }))).toBe(undefined);
  expect(validate({ v: 1, t: "batch", actions: [action("unmerge", { row: "r2", col: "ca" }), action("freeze", { rowsThrough: "r1" })] })).toBe(undefined);
});

test("needs, creates, targets", () => {
  const merge = action("merge", { from: ["r3", "cd"], to: ["r3", "cb"] });
  expect(needs(merge)).toEqual({ rows: ["r3"], cols: ["cd", "cb"] });
  expect(creates(merge)).toEqual({ rows: [], cols: [] });
  expect(targets(merge)).toEqual([
    [S, "r3", "cd", "content"],
    [S, "r3", "cd", "span"],
    [S, "r3", "cb", "content"],
    [S, "r3", "cb", "span"],
  ]);
  const clearing = action("merge", { from: ["r3", "cd"], to: ["r4", "cb"], clears: [["r3", "cc"]] });
  expect(needs(clearing)).toEqual({ rows: ["r3", "r4"], cols: ["cd", "cb", "cc"] });
  expect(targets(clearing)).toEqual([
    [S, "r3", "cd", "content"],
    [S, "r3", "cd", "span"],
    [S, "r4", "cb", "content"],
    [S, "r4", "cb", "span"],
    [S, "r3", "cb", "content"],
    [S, "r3", "cb", "span"],
    [S, "r4", "cd", "content"],
    [S, "r4", "cd", "span"],
    [S, "r3", "cc", "content"],
    [S, "r3", "cc", "fmt"],
    [S, "r3", "cc", "style:*"],
    [S, "r3", "cc", "span"],
  ]);

  const unmerge = action("unmerge", { row: "r2", col: "ca" });
  expect(needs(unmerge)).toEqual({ rows: ["r2"], cols: ["ca"] });
  expect(creates(unmerge)).toEqual({ rows: [], cols: [] });
  expect(targets(unmerge)).toEqual([
    [S, "r2", "ca", "content"],
    [S, "r2", "ca", "span"],
  ]);

  const freeze = action("freeze", { rowsThrough: null, colsThrough: "cb" });
  expect(needs(freeze)).toEqual({ rows: [], cols: ["cb"] });
  expect(creates(freeze)).toEqual({ rows: [], cols: [] });
  expect(targets(freeze)).toEqual([
    [S, "table", "", "freezeRows"],
    [S, "table", "", "freezeCols"],
  ]);
});

test("deleting the first row of a custom-format merge keeps its text", () => {
  const model = sheet({
    cols: [["ca", "8"], ["cb", "G"]],
    rows: [["r1", "8", [{ text: "12.3k", n: true, v: "12345", rowspan: 2 }]], ["r2", "G", [{ text: "", hidden: true }]]],
  });
  model.cols[0].fmt = '0.0,"k"';
  const store = modelBacking(model, { sheetId: S });
  const out = apply(store, { v: 1, t: "deleteRows", sheet: S, rows: ["r1"] }, { derive });
  expect(out.out).toBe("applied");
  expect(rowLine(bytesOf(store), "r2")).toEqual(expect.stringContaining("12.3k"));
});
