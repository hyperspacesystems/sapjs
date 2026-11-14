import { readFileSync } from "node:fs";
import { join } from "node:path";

import { gridModel } from "../../src/grid/codec/read.js";
import { tableHtml } from "../../src/grid/codec/write.js";
import { checkSheet } from "../../src/grid/check.js";
import { modelBacking } from "../../src/grid/backing-model.js";

global.__SAP_KEEP_CONSOLE__ = true;

const GOLDEN = join(__dirname, "..", "grid-codec", "golden");
const source = readFileSync(join(GOLDEN, "tiny.html"), "utf8");
const second = source.indexOf("<table grid", source.indexOf("</table>"));

const budgetBacking = () => modelBacking(gridModel(source, 0));
const tripsBacking = () => modelBacking(gridModel(source, second));

const maps = (backing) => {
  backing.rows().forEach((row, i) => expect(backing.rowIndex(row.id)).toBe(i));
  backing.cols().forEach((col, i) => expect(backing.colIndex(col.id)).toBe(i));
};

const verify = (backing, expected) => {
  expect(tableHtml(backing.sheet)).toBe(expected);
  expect(gridModel(tableHtml(backing.sheet), 0)).toEqual(backing.sheet);
  expect(checkSheet(backing.sheet)).toEqual([]);
};

test("reads", () => {
  const backing = budgetBacking();
  expect(backing.sheetId).toBe(null);
  expect(backing.rows().map((row) => row.id)).toEqual(["r1", "r2", "r3", "r4", "r5", "r6"]);
  expect(backing.cols().map((col) => col.id)).toEqual(["ca", "cb", "cc"]);
  expect(backing.frozen()).toEqual({ rows: 1, cols: 1 });
  expect(backing.hasFormula()).toBe(true);
  expect(backing.cell(0, 0)).toEqual({ text: "Item", style: "font-weight:bold" });
  expect(backing.cell(3, 0)).toBe(null);
  expect(backing.cell(1, 7)).toBe(null);
  maps(backing);
  verify(
    backing,
    `<table grid freeze-cols="1"><colgroup><col data-id="ca" data-pos="G" style="width:180px"><col data-id="cb" data-pos="V" fmt="$#,##0.00"><col data-id="cc" data-pos="l" fmt="0%"></colgroup>
<thead>
<tr data-id="r1" data-pos="8"><td style="font-weight:bold">Item</td><td>Cost</td><td>Share</td></tr>
</thead><tbody>
<tr data-id="r2" data-pos="G"><td>Rent</td><td n v="1200">$1,200.00</td><td n f="=B2/B$5" v="0.8">80%</td></tr>
<tr data-id="r3" data-pos="O"><td>Food</td><td n v="300">$300.00</td><td n f="=B3/B$5" v="0.2">20%</td></tr>
<tr data-id="r4" data-pos="V"></tr>
<tr data-id="r5" data-pos="d"><td style="font-weight:bold">Total</td><td n f="=SUM(B2:B3)" v="1500">$1,500.00</td></tr>
<tr data-id="r6" data-pos="l"><td colspan="3" style="text-align:center">Prices as of November</td><td hidden></td><td hidden></td></tr>
</tbody></table>`,
  );
});

test("putCell", () => {
  const backing = budgetBacking();
  backing.putCell(1, 0, { text: "Lease", style: "font-style:italic" });
  expect(backing.cell(1, 0)).toEqual({ text: "Lease", style: "font-style:italic" });
  maps(backing);
  verify(
    backing,
    `<table grid freeze-cols="1"><colgroup><col data-id="ca" data-pos="G" style="width:180px"><col data-id="cb" data-pos="V" fmt="$#,##0.00"><col data-id="cc" data-pos="l" fmt="0%"></colgroup>
<thead>
<tr data-id="r1" data-pos="8"><td style="font-weight:bold">Item</td><td>Cost</td><td>Share</td></tr>
</thead><tbody>
<tr data-id="r2" data-pos="G"><td style="font-style:italic">Lease</td><td n v="1200">$1,200.00</td><td n f="=B2/B$5" v="0.8">80%</td></tr>
<tr data-id="r3" data-pos="O"><td>Food</td><td n v="300">$300.00</td><td n f="=B3/B$5" v="0.2">20%</td></tr>
<tr data-id="r4" data-pos="V"></tr>
<tr data-id="r5" data-pos="d"><td style="font-weight:bold">Total</td><td n f="=SUM(B2:B3)" v="1500">$1,500.00</td></tr>
<tr data-id="r6" data-pos="l"><td colspan="3" style="text-align:center">Prices as of November</td><td hidden></td><td hidden></td></tr>
</tbody></table>`,
  );
});

test("putCell clears and pads", () => {
  const backing = budgetBacking();
  backing.putCell(3, 2, { text: "Tip" });
  expect(backing.cell(3, 2)).toEqual({ text: "Tip" });
  verify(
    backing,
    `<table grid freeze-cols="1"><colgroup><col data-id="ca" data-pos="G" style="width:180px"><col data-id="cb" data-pos="V" fmt="$#,##0.00"><col data-id="cc" data-pos="l" fmt="0%"></colgroup>
<thead>
<tr data-id="r1" data-pos="8"><td style="font-weight:bold">Item</td><td>Cost</td><td>Share</td></tr>
</thead><tbody>
<tr data-id="r2" data-pos="G"><td>Rent</td><td n v="1200">$1,200.00</td><td n f="=B2/B$5" v="0.8">80%</td></tr>
<tr data-id="r3" data-pos="O"><td>Food</td><td n v="300">$300.00</td><td n f="=B3/B$5" v="0.2">20%</td></tr>
<tr data-id="r4" data-pos="V"><td></td><td></td><td>Tip</td></tr>
<tr data-id="r5" data-pos="d"><td style="font-weight:bold">Total</td><td n f="=SUM(B2:B3)" v="1500">$1,500.00</td></tr>
<tr data-id="r6" data-pos="l"><td colspan="3" style="text-align:center">Prices as of November</td><td hidden></td><td hidden></td></tr>
</tbody></table>`,
  );

  backing.putCell(3, 2, null);
  expect(backing.cell(3, 2)).toBe(null);
  verify(
    backing,
    `<table grid freeze-cols="1"><colgroup><col data-id="ca" data-pos="G" style="width:180px"><col data-id="cb" data-pos="V" fmt="$#,##0.00"><col data-id="cc" data-pos="l" fmt="0%"></colgroup>
<thead>
<tr data-id="r1" data-pos="8"><td style="font-weight:bold">Item</td><td>Cost</td><td>Share</td></tr>
</thead><tbody>
<tr data-id="r2" data-pos="G"><td>Rent</td><td n v="1200">$1,200.00</td><td n f="=B2/B$5" v="0.8">80%</td></tr>
<tr data-id="r3" data-pos="O"><td>Food</td><td n v="300">$300.00</td><td n f="=B3/B$5" v="0.2">20%</td></tr>
<tr data-id="r4" data-pos="V"></tr>
<tr data-id="r5" data-pos="d"><td style="font-weight:bold">Total</td><td n f="=SUM(B2:B3)" v="1500">$1,500.00</td></tr>
<tr data-id="r6" data-pos="l"><td colspan="3" style="text-align:center">Prices as of November</td><td hidden></td><td hidden></td></tr>
</tbody></table>`,
  );
});

test("insertRow", () => {
  const backing = budgetBacking();
  backing.insertRow(4, { id: "r7", pos: "Z", cells: [{ text: "Gas" }] });
  expect(backing.rows().length).toBe(7);
  expect(backing.rowIndex("r7")).toBe(4);
  expect(backing.rowIndex("r5")).toBe(5);
  expect(backing.rowIndex("r6")).toBe(6);
  expect(backing.frozen()).toEqual({ rows: 1, cols: 1 });
  maps(backing);
  verify(
    backing,
    `<table grid freeze-cols="1"><colgroup><col data-id="ca" data-pos="G" style="width:180px"><col data-id="cb" data-pos="V" fmt="$#,##0.00"><col data-id="cc" data-pos="l" fmt="0%"></colgroup>
<thead>
<tr data-id="r1" data-pos="8"><td style="font-weight:bold">Item</td><td>Cost</td><td>Share</td></tr>
</thead><tbody>
<tr data-id="r2" data-pos="G"><td>Rent</td><td n v="1200">$1,200.00</td><td n f="=B2/B$5" v="0.8">80%</td></tr>
<tr data-id="r3" data-pos="O"><td>Food</td><td n v="300">$300.00</td><td n f="=B3/B$5" v="0.2">20%</td></tr>
<tr data-id="r4" data-pos="V"></tr>
<tr data-id="r7" data-pos="Z"><td>Gas</td></tr>
<tr data-id="r5" data-pos="d"><td style="font-weight:bold">Total</td><td n f="=SUM(B2:B3)" v="1500">$1,500.00</td></tr>
<tr data-id="r6" data-pos="l"><td colspan="3" style="text-align:center">Prices as of November</td><td hidden></td><td hidden></td></tr>
</tbody></table>`,
  );
});

test("removeRow", () => {
  const backing = budgetBacking();
  const removed = backing.removeRow(3);
  expect(removed).toEqual({ id: "r4", pos: "V", cells: [] });
  expect(backing.rows().length).toBe(5);
  expect(backing.rowIndex("r4")).toBe(-1);
  expect(backing.rowIndex("r5")).toBe(3);
  expect(backing.rowIndex("r6")).toBe(4);
  maps(backing);
  verify(
    backing,
    `<table grid freeze-cols="1"><colgroup><col data-id="ca" data-pos="G" style="width:180px"><col data-id="cb" data-pos="V" fmt="$#,##0.00"><col data-id="cc" data-pos="l" fmt="0%"></colgroup>
<thead>
<tr data-id="r1" data-pos="8"><td style="font-weight:bold">Item</td><td>Cost</td><td>Share</td></tr>
</thead><tbody>
<tr data-id="r2" data-pos="G"><td>Rent</td><td n v="1200">$1,200.00</td><td n f="=B2/B$5" v="0.8">80%</td></tr>
<tr data-id="r3" data-pos="O"><td>Food</td><td n v="300">$300.00</td><td n f="=B3/B$5" v="0.2">20%</td></tr>
<tr data-id="r5" data-pos="d"><td style="font-weight:bold">Total</td><td n f="=SUM(B2:B3)" v="1500">$1,500.00</td></tr>
<tr data-id="r6" data-pos="l"><td colspan="3" style="text-align:center">Prices as of November</td><td hidden></td><td hidden></td></tr>
</tbody></table>`,
  );
});

test("putRow", () => {
  const backing = budgetBacking();
  backing.putRow(0, { frozen: undefined });
  backing.putRow(3, { id: "r9", pos: "W", style: "font-weight:bold" });
  expect("frozen" in backing.rows()[0]).toBe(false);
  expect(backing.frozen()).toEqual({ rows: 0, cols: 1 });
  expect(backing.rowIndex("r1")).toBe(0);
  expect(backing.rowIndex("r4")).toBe(-1);
  expect(backing.rowIndex("r9")).toBe(3);
  maps(backing);
  verify(
    backing,
    `<table grid freeze-cols="1"><colgroup><col data-id="ca" data-pos="G" style="width:180px"><col data-id="cb" data-pos="V" fmt="$#,##0.00"><col data-id="cc" data-pos="l" fmt="0%"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td style="font-weight:bold">Item</td><td>Cost</td><td>Share</td></tr>
<tr data-id="r2" data-pos="G"><td>Rent</td><td n v="1200">$1,200.00</td><td n f="=B2/B$5" v="0.8">80%</td></tr>
<tr data-id="r3" data-pos="O"><td>Food</td><td n v="300">$300.00</td><td n f="=B3/B$5" v="0.2">20%</td></tr>
<tr data-id="r9" data-pos="W" style="font-weight:bold"></tr>
<tr data-id="r5" data-pos="d"><td style="font-weight:bold">Total</td><td n f="=SUM(B2:B3)" v="1500">$1,500.00</td></tr>
<tr data-id="r6" data-pos="l"><td colspan="3" style="text-align:center">Prices as of November</td><td hidden></td><td hidden></td></tr>
</tbody></table>`,
  );
});

test("moveRow", () => {
  const backing = budgetBacking();
  backing.moveRow(3, 1);
  backing.putRow(1, { pos: "F" });
  expect(backing.rows().map((row) => row.id)).toEqual(["r1", "r4", "r2", "r3", "r5", "r6"]);
  maps(backing);
  verify(
    backing,
    `<table grid freeze-cols="1"><colgroup><col data-id="ca" data-pos="G" style="width:180px"><col data-id="cb" data-pos="V" fmt="$#,##0.00"><col data-id="cc" data-pos="l" fmt="0%"></colgroup>
<thead>
<tr data-id="r1" data-pos="8"><td style="font-weight:bold">Item</td><td>Cost</td><td>Share</td></tr>
</thead><tbody>
<tr data-id="r4" data-pos="F"></tr>
<tr data-id="r2" data-pos="G"><td>Rent</td><td n v="1200">$1,200.00</td><td n f="=B2/B$5" v="0.8">80%</td></tr>
<tr data-id="r3" data-pos="O"><td>Food</td><td n v="300">$300.00</td><td n f="=B3/B$5" v="0.2">20%</td></tr>
<tr data-id="r5" data-pos="d"><td style="font-weight:bold">Total</td><td n f="=SUM(B2:B3)" v="1500">$1,500.00</td></tr>
<tr data-id="r6" data-pos="l"><td colspan="3" style="text-align:center">Prices as of November</td><td hidden></td><td hidden></td></tr>
</tbody></table>`,
  );
});

test("insertCol", () => {
  const backing = tripsBacking();
  backing.insertCol(1, { id: "cf", pos: "O", fmt: "0.00", width: 90 });
  expect(backing.cols().map((col) => col.id)).toEqual(["cd", "cf", "ce"]);
  expect(backing.rows()[0].cells.length).toBe(3);
  expect(backing.colIndex("cf")).toBe(1);
  expect(backing.colIndex("ce")).toBe(2);
  maps(backing);
  verify(
    backing,
    `<table grid><colgroup><col data-id="cd" data-pos="G"><col data-id="cf" data-pos="O" fmt="0.00" style="width:90px"><col data-id="ce" data-pos="V"></colgroup>
<tbody>
<tr data-id="r7" data-pos="G"><td>Lisbon</td><td></td><td n v="46095" fmt="mmm d, yyyy">Mar 14, 2026</td></tr>
<tr data-id="r8" data-pos="V"><td>Budget left</td><td></td><td n f="=5000-Budget!B5" v="3500" fmt="$#,##0.00">$3,500.00</td></tr>
</tbody></table>`,
  );
});

test("removeCol", () => {
  const backing = tripsBacking();
  const removed = backing.removeCol(0);
  expect(removed).toEqual({ id: "cd", pos: "G" });
  expect(backing.cols().map((col) => col.id)).toEqual(["ce"]);
  expect(backing.colIndex("cd")).toBe(-1);
  expect(backing.colIndex("ce")).toBe(0);
  expect(backing.hasFormula()).toBe(true);
  maps(backing);
  verify(
    backing,
    `<table grid><colgroup><col data-id="ce" data-pos="V"></colgroup>
<tbody>
<tr data-id="r7" data-pos="G"><td n v="46095" fmt="mmm d, yyyy">Mar 14, 2026</td></tr>
<tr data-id="r8" data-pos="V"><td n f="=5000-Budget!B5" v="3500" fmt="$#,##0.00">$3,500.00</td></tr>
</tbody></table>`,
  );
});

test("removeCol drops trailing cells", () => {
  const backing = modelBacking({
    cols: [{ id: "c1", pos: "G" }, { id: "c2", pos: "V" }, { id: "c3", pos: "l" }],
    rows: [{ id: "r1", pos: "G", cells: [{ text: "a" }, null, { text: "b" }] }],
  });
  backing.removeCol(2);
  expect(backing.rows()[0].cells).toEqual([{ text: "a" }]);
  maps(backing);
  verify(
    backing,
    `<table grid><colgroup><col data-id="c1" data-pos="G"><col data-id="c2" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="G"><td>a</td></tr>
</tbody></table>`,
  );
});

test("putCol", () => {
  const backing = tripsBacking();
  backing.putCol(0, { fmt: "0%" });
  backing.putCol(0, { fmt: undefined });
  backing.putCol(1, { id: "ch", fmt: "0.00", width: 120 });
  expect("fmt" in backing.cols()[0]).toBe(false);
  expect(backing.cols().map((col) => col.id)).toEqual(["cd", "ch"]);
  expect(backing.colIndex("ce")).toBe(-1);
  expect(backing.colIndex("ch")).toBe(1);
  maps(backing);
  verify(
    backing,
    `<table grid><colgroup><col data-id="cd" data-pos="G"><col data-id="ch" data-pos="V" fmt="0.00" style="width:120px"></colgroup>
<tbody>
<tr data-id="r7" data-pos="G"><td>Lisbon</td><td n v="46095" fmt="mmm d, yyyy">Mar 14, 2026</td></tr>
<tr data-id="r8" data-pos="V"><td>Budget left</td><td n f="=5000-Budget!B5" v="3500" fmt="$#,##0.00">$3,500.00</td></tr>
</tbody></table>`,
  );
});

test("moveCol", () => {
  const backing = tripsBacking();
  backing.moveCol(0, 1);
  backing.putCol(1, { pos: "l" });
  expect(backing.cols().map((col) => col.id)).toEqual(["ce", "cd"]);
  expect(backing.colIndex("ce")).toBe(0);
  expect(backing.colIndex("cd")).toBe(1);
  maps(backing);
  verify(
    backing,
    `<table grid><colgroup><col data-id="ce" data-pos="V"><col data-id="cd" data-pos="l"></colgroup>
<tbody>
<tr data-id="r7" data-pos="G"><td n v="46095" fmt="mmm d, yyyy">Mar 14, 2026</td><td>Lisbon</td></tr>
<tr data-id="r8" data-pos="V"><td n f="=5000-Budget!B5" v="3500" fmt="$#,##0.00">$3,500.00</td><td>Budget left</td></tr>
</tbody></table>`,
  );
});

test("setFrozen", () => {
  const backing = budgetBacking();
  backing.setFrozen({ rows: 2, cols: 2 });
  expect(backing.frozen()).toEqual({ rows: 2, cols: 2 });
  verify(
    backing,
    `<table grid freeze-cols="2"><colgroup><col data-id="ca" data-pos="G" style="width:180px"><col data-id="cb" data-pos="V" fmt="$#,##0.00"><col data-id="cc" data-pos="l" fmt="0%"></colgroup>
<thead>
<tr data-id="r1" data-pos="8"><td style="font-weight:bold">Item</td><td>Cost</td><td>Share</td></tr>
<tr data-id="r2" data-pos="G"><td>Rent</td><td n v="1200">$1,200.00</td><td n f="=B2/B$5" v="0.8">80%</td></tr>
</thead><tbody>
<tr data-id="r3" data-pos="O"><td>Food</td><td n v="300">$300.00</td><td n f="=B3/B$5" v="0.2">20%</td></tr>
<tr data-id="r4" data-pos="V"></tr>
<tr data-id="r5" data-pos="d"><td style="font-weight:bold">Total</td><td n f="=SUM(B2:B3)" v="1500">$1,500.00</td></tr>
<tr data-id="r6" data-pos="l"><td colspan="3" style="text-align:center">Prices as of November</td><td hidden></td><td hidden></td></tr>
</tbody></table>`,
  );

  backing.setFrozen({ rows: 0, cols: 0 });
  expect(backing.frozen()).toEqual({ rows: 0, cols: 0 });
  verify(
    backing,
    `<table grid><colgroup><col data-id="ca" data-pos="G" style="width:180px"><col data-id="cb" data-pos="V" fmt="$#,##0.00"><col data-id="cc" data-pos="l" fmt="0%"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td style="font-weight:bold">Item</td><td>Cost</td><td>Share</td></tr>
<tr data-id="r2" data-pos="G"><td>Rent</td><td n v="1200">$1,200.00</td><td n f="=B2/B$5" v="0.8">80%</td></tr>
<tr data-id="r3" data-pos="O"><td>Food</td><td n v="300">$300.00</td><td n f="=B3/B$5" v="0.2">20%</td></tr>
<tr data-id="r4" data-pos="V"></tr>
<tr data-id="r5" data-pos="d"><td style="font-weight:bold">Total</td><td n f="=SUM(B2:B3)" v="1500">$1,500.00</td></tr>
<tr data-id="r6" data-pos="l"><td colspan="3" style="text-align:center">Prices as of November</td><td hidden></td><td hidden></td></tr>
</tbody></table>`,
  );

  backing.setFrozen({ rows: 1 });
  expect(backing.frozen()).toEqual({ rows: 1, cols: 0 });
  verify(
    backing,
    `<table grid><colgroup><col data-id="ca" data-pos="G" style="width:180px"><col data-id="cb" data-pos="V" fmt="$#,##0.00"><col data-id="cc" data-pos="l" fmt="0%"></colgroup>
<thead>
<tr data-id="r1" data-pos="8"><td style="font-weight:bold">Item</td><td>Cost</td><td>Share</td></tr>
</thead><tbody>
<tr data-id="r2" data-pos="G"><td>Rent</td><td n v="1200">$1,200.00</td><td n f="=B2/B$5" v="0.8">80%</td></tr>
<tr data-id="r3" data-pos="O"><td>Food</td><td n v="300">$300.00</td><td n f="=B3/B$5" v="0.2">20%</td></tr>
<tr data-id="r4" data-pos="V"></tr>
<tr data-id="r5" data-pos="d"><td style="font-weight:bold">Total</td><td n f="=SUM(B2:B3)" v="1500">$1,500.00</td></tr>
<tr data-id="r6" data-pos="l"><td colspan="3" style="text-align:center">Prices as of November</td><td hidden></td><td hidden></td></tr>
</tbody></table>`,
  );
});

test("setStale", () => {
  const backing = budgetBacking();
  backing.setStale(true);
  expect(backing.sheet.stale).toBe(true);
  verify(
    backing,
    `<table grid freeze-cols="1" stale><colgroup><col data-id="ca" data-pos="G" style="width:180px"><col data-id="cb" data-pos="V" fmt="$#,##0.00"><col data-id="cc" data-pos="l" fmt="0%"></colgroup>
<thead>
<tr data-id="r1" data-pos="8"><td style="font-weight:bold">Item</td><td>Cost</td><td>Share</td></tr>
</thead><tbody>
<tr data-id="r2" data-pos="G"><td>Rent</td><td n v="1200">$1,200.00</td><td n f="=B2/B$5" v="0.8">80%</td></tr>
<tr data-id="r3" data-pos="O"><td>Food</td><td n v="300">$300.00</td><td n f="=B3/B$5" v="0.2">20%</td></tr>
<tr data-id="r4" data-pos="V"></tr>
<tr data-id="r5" data-pos="d"><td style="font-weight:bold">Total</td><td n f="=SUM(B2:B3)" v="1500">$1,500.00</td></tr>
<tr data-id="r6" data-pos="l"><td colspan="3" style="text-align:center">Prices as of November</td><td hidden></td><td hidden></td></tr>
</tbody></table>`,
  );

  backing.setStale(false);
  expect("stale" in backing.sheet).toBe(false);
  maps(backing);
  verify(
    backing,
    `<table grid freeze-cols="1"><colgroup><col data-id="ca" data-pos="G" style="width:180px"><col data-id="cb" data-pos="V" fmt="$#,##0.00"><col data-id="cc" data-pos="l" fmt="0%"></colgroup>
<thead>
<tr data-id="r1" data-pos="8"><td style="font-weight:bold">Item</td><td>Cost</td><td>Share</td></tr>
</thead><tbody>
<tr data-id="r2" data-pos="G"><td>Rent</td><td n v="1200">$1,200.00</td><td n f="=B2/B$5" v="0.8">80%</td></tr>
<tr data-id="r3" data-pos="O"><td>Food</td><td n v="300">$300.00</td><td n f="=B3/B$5" v="0.2">20%</td></tr>
<tr data-id="r4" data-pos="V"></tr>
<tr data-id="r5" data-pos="d"><td style="font-weight:bold">Total</td><td n f="=SUM(B2:B3)" v="1500">$1,500.00</td></tr>
<tr data-id="r6" data-pos="l"><td colspan="3" style="text-align:center">Prices as of November</td><td hidden></td><td hidden></td></tr>
</tbody></table>`,
  );
});

test("hasFormula count", () => {
  const backing = budgetBacking();
  expect(backing.hasFormula()).toBe(true);
  backing.putCell(5, 2, { text: "x", f: "=A1" });
  expect(backing.cell(5, 2)).toEqual({ text: "x", f: "=A1" });
  expect(backing.hasFormula()).toBe(true);
  backing.putCell(5, 2, null);
  expect(backing.hasFormula()).toBe(true);
  backing.removeRow(2);
  expect(backing.hasFormula()).toBe(true);
  backing.removeCol(2);
  expect(backing.hasFormula()).toBe(true);
  backing.removeRow(3);
  expect(backing.hasFormula()).toBe(false);
});

test("input is copied", () => {
  const sheet = gridModel(source, 0);
  const before = JSON.parse(JSON.stringify(sheet));
  const backing = modelBacking(sheet);
  backing.putCell(0, 0, { text: "Changed" });
  backing.insertRow(0, { id: "r0", pos: "4", cells: [{ text: "New" }] });
  backing.removeCol(2);
  backing.setFrozen({ rows: 0 });
  backing.setStale(true);
  expect(sheet).toEqual(before);

  const other = gridModel(source, 0);
  const wrapped = modelBacking(other);
  other.rows[0].cells[0].text = "Outside";
  other.cols.push({ id: "cz", pos: "t" });
  other.freezeCols = 3;
  expect(wrapped.cell(0, 0)).toEqual({ text: "Item", style: "font-weight:bold" });
  expect(wrapped.cols().length).toBe(3);
  expect(wrapped.frozen()).toEqual({ rows: 1, cols: 1 });
});
