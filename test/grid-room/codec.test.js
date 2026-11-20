/**
 * @jest-environment node
 */
import { drawingsIn, sheetCodec as codec, docOf } from "../../src/grid/room-codec.js";
import { modelWorkbook } from "../../src/grid/workbook-backing.js";
import { applyWorkbook } from "../../src/grid/workbook.js";
import { gridModel } from "../../src/grid/codec/read.js";
import { tableHtml } from "../../src/grid/codec/write.js";
import { keysBetween } from "../../src/grid/codec/order-keys.js";

global.__SAP_KEEP_CONSOLE__ = true;

const RECORD = { v: 2, doc: "doc0123456789abc", gen: "1.00000001", commit: "c<1" };
const table = (rows, cols = [["a", "G"], ["b", "V"]]) =>
  gridModel(
    `<table grid><colgroup>${cols.map(([id, pos]) => `<col data-id="${id}" data-pos="${pos}">`).join("")}</colgroup>\n<tbody>\n${rows.map(([id, pos, cells]) => `<tr data-id="${id}" data-pos="${pos}">${cells}</tr>\n`).join("")}</tbody></table>`,
    0,
  );
const budget = () => table([["r1", "G", "<td>pens</td><td n>30</td>"], ["r2", "V", "<td>ink</td><td n>10</td>"], ["r3", "l", "<td>paper</td><td n>20</td>"]]);
const notes = () => table([["x1", "V", "<td>hi</td>"]]);
const book = () => ({ tabs: [{ id: "s1", name: "Budget", pos: "V", sheet: budget() }, { id: "s2", name: "Notes", pos: "l", sheet: notes() }] });
const cell = (doc, r, c) => codec.current(doc, `s1/${r}/${c}`);

test("the codec reads the workbook a page saved and writes it back the way the page does", () => {
  const doc = book();
  const canonical = codec.write(doc, RECORD);
  const page =
    `\n  <section item="" data-id="s1" data-pos="V">\n    <h2 bind="name">Budget</h2>\n    ${tableHtml(doc.tabs[0].sheet)}\n  </section>\n` +
    `  <section item="" data-id="s2" data-pos="l"><h2 bind="name" class="tab">Notes</h2>${tableHtml(doc.tabs[1].sheet)}</section>\n` +
    `  <script type="application/json" sheet-commit="">${JSON.stringify(RECORD).replaceAll("<", "\\u003c")}</script>\n`;
  const back = codec.read(page);
  expect(back.record).toEqual(RECORD);
  expect(codec.write(back.doc, back.record)).toBe(canonical);
  expect(canonical.startsWith('<section item="" data-id="s1" data-pos="V"><h2 bind="name">Budget</h2><table grid>')).toBe(true);
  expect(() => codec.read(page + '<script type="application/json" sheet-commit="">{}</script>')).toThrow("two commit records");
  expect(() => codec.read(page.replace('<table grid>', '<table grid="">'))).toThrow('tab "s1"');
  const noted = page.replace('<h2 bind="name">Budget</h2>', '<!-- a plugin note --><h2 bind="name">Budget</h2><!-- another -->');
  expect(codec.write(codec.read(noted).doc, RECORD)).toBe(canonical);
  // A result shown before its custom format's formatter loaded is written stale, read or not.
  codec.apply(doc, { v: 1, t: "set", sheet: "s1", cells: [["r1", "b", { f: "=10+20" }, { fmt: '0.00 "kg"' }]] });
  const extras = (s, r, c) => (s === "s1" && r === "r1" && c === "b" ? { text: "30", n: true } : undefined);
  const shown = codec.write(doc, RECORD, extras);
  expect(shown).toContain('<h2 bind="name">Budget</h2><table grid stale>');
  expect(codec.write(codec.read(shown).doc, RECORD, extras)).toBe(shown);
});

test("an undo after a coworker changed one of its cells puts back the others and names the changed one", () => {
  const doc = book();
  const ana = codec.apply(doc, { v: 1, t: "set", sheet: "s1", cells: [["r1", "b", 1], ["r2", "b", 2], ["r3", "b", 3]] });
  codec.apply(doc, { v: 1, t: "set", sheet: "s1", cells: [["r2", "b", 99]] });
  const undo = codec.apply(doc, ana.inverse);
  expect(undo.out).toBe("applied");
  expect([cell(doc, "r1", "b"), cell(doc, "r2", "b"), cell(doc, "r3", "b")]).toEqual([30, 99, 20]);
  expect(undo.skipped).toEqual(["s1/r2/b"]);
  expect(codec.current(doc, undo.skipped[0])).toBe(99);
  const redo = codec.apply(doc, undo.inverse);
  expect([cell(doc, "r1", "b"), cell(doc, "r2", "b"), cell(doc, "r3", "b")]).toEqual([1, 99, 3]);
  expect(redo.skipped).toEqual([]);
});

test("undoing a tab delete brings the tab back under a free name when another tab took its name", () => {
  const doc = book();
  const gone = codec.apply(doc, { v: 1, t: "deleteSheet", sheet: "s2" });
  codec.apply(doc, { v: 1, t: "renameSheet", sheet: "s1", name: "notes" });
  const undo = codec.apply(doc, gone.inverse);
  expect(undo.out).toBe("applied");
  expect(doc.tabs.map((tab) => tab.name)).toEqual(["notes", "Notes (2)"]);
  expect(undo.skipped).toEqual(["s2#name"]);
  expect(codec.current(doc, "s2/x1/a")).toBe("hi");
});

test("undoing a row delete still brings the row back when a merge now covers where its cells land", () => {
  const doc = book();
  const gone = codec.apply(doc, { v: 1, t: "deleteRows", sheet: "s1", rows: ["r2"] });
  codec.apply(doc, { v: 1, t: "merge", sheet: "s1", from: ["r1", "b"], to: ["r3", "b"], clears: [["r3", "b"]] });
  const undo = codec.apply(doc, gone.inverse);
  expect(undo.out).toBe("applied");
  expect(codec.has(doc, "s1/r2")).toBe(true);
  expect(codec.current(doc, "s1/r2/a")).toBe("ink");
  expect(undo.skipped).toContain("s1/r2/b");
});

test("the undo of a 20,000-cell column delete travels in frames of 128 operations, each under 63 KiB", () => {
  const rows = keysBetween(null, null, 20000).map((pos, i) => ({ id: `r${i}`, pos, cells: [{ text: `item ${i}` }, { text: '"quoted\\"' }] }));
  const doc = { tabs: [{ id: "s1", name: "Big", pos: "V", sheet: gridModel(tableHtml({ cols: [{ id: "a", pos: "G" }, { id: "b", pos: "V" }], rows }), 0) }] };
  const { inverse } = codec.apply(doc, { v: 1, t: "deleteCols", sheet: "s1", cols: ["b"] });
  const { head, parts } = codec.split({ action: inverse, saw: null, reviewed: null }, { opsPerFrame: 128 });
  const frame = (part, i) => JSON.stringify({ k: "part", gen: "1.00000001", of: "a0123456789", from: "t0123456789", key: "k0123456789", order: 123456, i, m: parts.length, size: codec.size(inverse), frame: 99999, ...part });
  expect(parts.every((part) => codec.partOps(part) <= 128)).toBe(true);
  expect(Math.max(...parts.map((part, i) => new TextEncoder().encode(frame(part, i)).length))).toBeLessThan(63 * 1024);
  expect(codec.assemble(head, parts).action).toEqual(inverse);
  for (const cells of [Array.from({ length: 20 }, (_, i) => [`r${i}`, "a", '"'.repeat(20000)]), [["r0", "a", "x".repeat(250000)], ["r0", "b", "漢".repeat(25000)]]]) {
    const paste = { v: 1, t: "set", sheet: "s1", cells };
    const big = codec.split({ action: paste, saw: codec.seen(doc, paste), reviewed: null }, { opsPerFrame: 128 });
    expect(Math.max(...big.parts.map((part, i) => new TextEncoder().encode(frame(part, i)).length))).toBeLessThan(63 * 1024);
    expect(codec.assemble(big.head, big.parts).action).toEqual(paste);
  }
});

test("a merge a coworker already made, or an unmerge a coworker already undid, counts as done and changes nothing", () => {
  const doc = book();
  const merge = { v: 1, t: "merge", sheet: "s1", from: ["r1", "b"], to: ["r2", "b"], clears: [["r2", "b"]] };
  codec.apply(doc, merge);
  const merged = codec.write(doc, RECORD);
  expect([codec.fits(doc, merge), codec.apply(doc, merge).out, codec.write(doc, RECORD)]).toEqual([true, "applied", merged]);
  const unmerge = { v: 1, t: "unmerge", sheet: "s1", row: "r1", col: "b" };
  expect(codec.apply(doc, unmerge).out).toBe("applied");
  const before = codec.write(doc, RECORD);
  expect(codec.fits(doc, unmerge)).toBe(true);
  expect(codec.apply(doc, unmerge).out).toBe("applied");
  expect(codec.write(doc, RECORD)).toBe(before);
});

test("an undo leaves a coworker's formula that names a missing tab at another cell", () => {
  const doc = book();
  const ana = codec.apply(doc, { v: 1, t: "set", sheet: "s1", cells: [["r1", "a", { f: "=Q2!B2" }]] });
  codec.apply(doc, { v: 1, t: "set", sheet: "s1", cells: [["r1", "a", { f: "=Q2!C50" }]] });
  const undo = codec.apply(doc, ana.inverse);
  expect([codec.current(doc, "s1/r1/a"), undo.skipped]).toEqual([{ f: "=Q2!C50" }, ["s1/r1/a"]]);
});

test("undoing a row delete after a coworker deleted another column brings the row back without that column's cell", () => {
  const doc = { tabs: [{ id: "s1", name: "Budget", pos: "V", sheet: table([["r1", "G", "<td>pens</td><td n>30</td><td>a</td>"], ["r2", "V", "<td>ink</td><td n>10</td><td>b</td>"]], [["a", "G"], ["b", "V"], ["j", "l"]]) }] };
  const gone = codec.apply(doc, { v: 1, t: "deleteRows", sheet: "s1", rows: ["r2"] });
  codec.apply(doc, { v: 1, t: "deleteCols", sheet: "s1", cols: ["j"] });
  expect(codec.fits(doc, gone.inverse)).toBe(true);
  const undo = codec.apply(doc, gone.inverse);
  expect([codec.current(doc, "s1/r2/a"), codec.current(doc, "s1/r2/b"), undo.skipped]).toEqual(["ink", 10, ["s1/r2/j"]]);
});

test("a one-cell edit keeps the cached bytes of the tab's other rows", () => {
  const rows = keysBetween(null, null, 120).map((pos, i) => [`r${i}`, pos, `<td>x${i}</td>`]);
  const doc = { tabs: [{ id: "s1", name: "Big", pos: "V", sheet: table(rows) }] };
  codec.write(doc, RECORD);
  doc.tabs[0].sheet.rows[0].cells[0].text = "untold";
  codec.apply(doc, { v: 1, t: "set", sheet: "s1", cells: [["r119", "a", "told"]] });
  const bytes = codec.write(doc, RECORD);
  expect([bytes.includes("<td>x0</td>"), bytes.includes("<td>told</td>")]).toEqual([true, true]);
});

test("undoing a column delete is refused when a new row took the column's id", () => {
  const doc = book();
  const gone = codec.apply(doc, { v: 1, t: "deleteCols", sheet: "s1", cols: ["b"] });
  codec.apply(doc, { v: 1, t: "insertRows", sheet: "s1", rows: [{ id: "b", pos: "z" }] });
  const taken = codec.creates(gone.inverse).filter((id) => codec.has(doc, id));
  expect([taken, codec.fits(doc, gone.inverse), codec.apply(doc, gone.inverse).out]).toEqual([["s1#id:b"], false, "refused"]);
});

test("a delete shows the cells a coworker put in its rows since, also when the rows came from a paste being undone", () => {
  const doc = book();
  const paste = codec.apply(doc, { v: 1, t: "set", sheet: "s1", rows: [{ id: "r9", pos: "z" }], cells: [["r9", "a", "new"]] });
  codec.apply(doc, { v: 1, t: "set", sheet: "s1", cells: [["r9", "b", "coworker note"]] });
  expect(codec.unseen(doc, paste.inverse, codec.seen(doc, paste.inverse))).toEqual([["s1/r9/b", "coworker note"]]);
  const both = { v: 1, t: "batch", actions: [{ v: 1, t: "set", sheet: "s1", cells: [["r1", "a", "x"]] }, { v: 1, t: "deleteRows", sheet: "s1", rows: ["r9"] }] };
  const saw = codec.seen(doc, both);
  codec.apply(doc, { v: 1, t: "set", sheet: "s1", cells: [["r9", "a", "Ben again"]] });
  expect(codec.unseen(doc, both, saw)).toEqual([["s1/r9/a", "Ben again"], ["s1/r9/b", "coworker note"]]);
});

test("undoing a column format change leaves a cell a coworker typed into since", () => {
  const doc = book();
  codec.apply(doc, { v: 1, t: "changeCols", sheet: "s1", cols: [{ id: "b", fmt: '0.00 "kg"' }] });
  const ana = codec.apply(doc, { v: 1, t: "changeCols", sheet: "s1", cols: [{ id: "b", fmt: "#,##0.00" }] });
  codec.apply(doc, { v: 1, t: "set", sheet: "s1", cells: [["r1", "b", 999]] });
  const undo = codec.apply(doc, ana.inverse);
  expect([codec.current(doc, "s1/r1/b"), codec.current(doc, "s1//b#fmt"), undo.skipped]).toEqual([999, '0.00 "kg"', ["s1/r1/b"]]);
});

test("a whole-width sort's undo moves every row back or none: a resize does not hold it back, a coworker's formula in a sorted row does", () => {
  const sort = { v: 1, t: "sort", sheet: "s1", rows: ["r2", "r3", "r1"], cols: null };
  const order = (doc) => doc.tabs[0].sheet.rows.map((row) => `${row.id}@${row.pos}`);
  const resized = book();
  const a = codec.apply(resized, sort);
  codec.apply(resized, { v: 1, t: "changeRows", sheet: "s1", rows: [{ id: "r2", height: 40 }] });
  expect([codec.apply(resized, a.inverse).skipped, order(resized)]).toEqual([[], ["r1@G", "r2@V", "r3@l"]]);
  const typed = book();
  const b = codec.apply(typed, sort);
  codec.apply(typed, { v: 1, t: "set", sheet: "s1", cells: [["r1", "a", { f: "=B1+B2" }]] });
  const undo = codec.apply(typed, b.inverse);
  expect([codec.current(typed, "s1/r1/a"), order(typed), undo.skipped.sort()]).toEqual([{ f: "=B1+B2" }, ["r2@G", "r3@V", "r1@l"], ["s1/r1#pos", "s1/r2#pos", "s1/r3#pos"]]);
});

test("a merge and a narrow sort show a coworker's change to a cell they write as a conflict; a whole-width sort does not", () => {
  const doc = book();
  const merge = { v: 1, t: "merge", sheet: "s1", from: ["r1", "a"], to: ["r2", "a"], clears: [["r2", "a"]] };
  const narrow = { v: 1, t: "sort", sheet: "s1", rows: ["r2", "r3", "r1"], cols: ["b"] };
  const saw = [codec.seen(doc, merge), codec.seen(doc, narrow)];
  codec.apply(doc, { v: 1, t: "set", sheet: "s1", cells: [["r2", "a", "FINAL $50,000"], ["r1", "b", 31]] });
  expect([codec.conflicts(doc, merge, saw[0]).map(([target]) => target), codec.conflicts(doc, narrow, saw[1]).map(([target]) => target)]).toEqual([["s1/r2/a"], ["s1/r1/b"]]);
  expect(codec.seen(doc, { ...narrow, cols: null })).toBe(null);
});

test("current reads a freeze line and a row height as a freeze and a resize name them", () => {
  const doc = book();
  codec.apply(doc, { v: 1, t: "freeze", sheet: "s1", rowsThrough: "r1", colsThrough: "a" });
  codec.apply(doc, { v: 1, t: "changeRows", sheet: "s1", rows: [{ id: "r2", height: 40 }] });
  expect(["s1#freezeRows", "s1#freezeCols", "s1/r2#height", "s1#name"].map((target) => codec.current(doc, target))).toEqual(["r1", "a", 40, "Budget"]);
});

test("validate refuses a tab named with half a surrogate pair and a revert whose restore entry has no guard shape", () => {
  expect(codec.validate({ v: 1, t: "renameSheet", sheet: "s1", name: "Q\ud800" })).toBe(false);
  expect(codec.validate({ v: 1, t: "renameSheet", sheet: "s1", name: "Q\ud83d\udcca" })).toBe(true);
  const revert = (guard) => ({ v: 1, t: "revert", of: null, step: { action: { v: 1, t: "set", sheet: "s1", cells: [["r1", "b", 5]] }, restore: [["s1", "r1", "b", "=A1", [["s1", "r1", "a", "r1", "a"]], guard]] }, wrote: [] });
  expect([codec.validate(revert({ ids: [["s1", "r1", "a", "r1", "a"]] })), codec.validate(revert({ ids: 7 }))]).toEqual([true, false]);
});

// Review fixes (S5). Each test names the bug that makes it fail.

test("what a page saw stays right after the page inserts a row in place", () => {
  // Fails when the row index cached per sheet is trusted after the page's sheet changed in place.
  const room = book();
  const page = modelWorkbook(book().tabs);
  const first = { v: 1, t: "set", sheet: "s1", cells: [["r2", "b", 11]] };
  codec.seen(docOf(page), first);
  const insert = { v: 1, t: "insertRows", sheet: "s1", rows: [{ id: "r0", pos: "A" }] };
  applyWorkbook(page, insert);
  codec.apply(room, insert);
  for (const edit of [{ v: 1, t: "set", sheet: "s1", cells: [["r2", "b", 12]] }, { v: 1, t: "set", sheet: "s1", cells: [["r0", "a", "new"]] }]) {
    expect(codec.conflicts(room, edit, codec.seen(docOf(page), edit))).toEqual([]);
  }
});

test("a new tab whose name a coworker's new tab took first comes in under a free name", () => {
  // Fails when a new tab needs its name free: Ana's tab, and everything typed in it, is refused.
  const doc = book();
  codec.apply(doc, { v: 1, t: "insertSheet", sheet: { id: "t1", name: "Sheet 2", pos: "t", html: "<table grid></table>" } });
  const ana = { v: 1, t: "insertSheet", sheet: { id: "t2", name: "Sheet 2", pos: "u", html: "<table grid></table>" } };
  expect(codec.fits(doc, ana)).toBe(true);
  const out = codec.apply(doc, ana);
  expect(out.out).toBe("applied");
  expect(out.skipped).toEqual(["t2#name"]);
  expect(doc.tabs.find((tab) => tab.id === "t2").name).toBe("Sheet 2 (2)");
});

test("holds is false for an edit the codec refuses", () => {
  // Fails when holds compares bytes only: a refused edit leaves the copy unchanged, so it looked held.
  const doc = book();
  const again = { v: 1, t: "insertRows", sheet: "s1", rows: [{ id: "r2", pos: "Z", cells: [["a", "new row"]] }] };
  expect(codec.needs(again).every((id) => codec.has(doc, id))).toBe(true);
  expect(codec.apply(structuredClone(doc), again).out).toBe("refused");
  expect(codec.holds(doc, again)).toBe(false);
});

test("a row delete whose author saw nothing names every value it takes away", () => {
  // Fails when unseen returns nothing for a missing saw.
  const doc = book();
  const del = { v: 1, t: "deleteRows", sheet: "s1", rows: ["r2"] };
  expect(codec.unseen(doc, del, null).map(([target]) => target)).toEqual(["s1/r2/a", "s1/r2/b"]);
});

test("undoing a row delete that cut a merge leaves a coworker's later edit in the merged cell", () => {
  // Fails when the revert puts the merge back over a cell a coworker changed since, clearing it.
  const doc = { tabs: [{ id: "s1", name: "Budget", pos: "V", sheet: table([["r1", "G", "<td>Header</td><td n>30</td>"], ["r2", "V", "<td></td><td n>10</td>"], ["r3", "l", "<td>paper</td><td n>20</td>"]]) }] };
  codec.apply(doc, { v: 1, t: "merge", sheet: "s1", from: ["r1", "a"], to: ["r2", "a"], clears: [] });
  const del = codec.apply(doc, { v: 1, t: "deleteRows", sheet: "s1", rows: ["r1"] });
  codec.apply(doc, { v: 1, t: "set", sheet: "s1", cells: [["r2", "a", "FINAL"]] });
  const undo = codec.apply(doc, del.inverse);
  expect(undo.out).toBe("applied");
  expect([cell(doc, "r1", "a"), cell(doc, "r2", "a")]).toEqual(["Header", "FINAL"]);
  expect(undo.skipped).toContain("s1/r2/a");
});

test("an undo leaves a coworker's formula that changed only its $ locks", () => {
  // Fails when a formula's meaning leaves out $, so =B1 and =$B$1 compare equal.
  const doc = book();
  codec.apply(doc, { v: 1, t: "set", sheet: "s1", cells: [["r3", "a", { f: "=$B$1" }]] });
  const ana = codec.apply(doc, { v: 1, t: "set", sheet: "s1", cells: [["r3", "a", { f: "=B1*2" }]] });
  codec.apply(doc, { v: 1, t: "set", sheet: "s1", cells: [["r3", "a", { f: "=$B$1*2" }]] });
  const undo = codec.apply(doc, ana.inverse);
  expect(undo.skipped).toEqual(["s1/r3/a"]);
  expect(cell(doc, "r3", "a")).toEqual({ f: "=$B$1*2" });
});

test("undoing a one-column sort after a coworker moved a row gives each row its own value back", () => {
  // Fails when a narrow sort's undo is a sort back by place: the moved row takes another row's value.
  const doc = book();
  const sort = codec.apply(doc, { v: 1, t: "sort", sheet: "s1", rows: ["r2", "r3", "r1"], cols: ["b"] });
  expect([cell(doc, "r1", "b"), cell(doc, "r2", "b"), cell(doc, "r3", "b")]).toEqual([10, 20, 30]);
  codec.apply(doc, { v: 1, t: "changeRows", sheet: "s1", rows: [{ id: "r2", pos: "A" }] });
  const undo = codec.apply(doc, sort.inverse);
  expect(undo.out).toBe("applied");
  expect([cell(doc, "r1", "b"), cell(doc, "r2", "b"), cell(doc, "r3", "b")]).toEqual([30, 10, 20]);
});

test("undoing a sort after a coworker deleted one of its rows still puts the other rows back", () => {
  // Fails when a sort's undo needs every row it sorted: the undo is refused and nothing comes back.
  for (const cols of [["b"], null]) {
    const doc = { tabs: [{ id: "s1", name: "Budget", pos: "V", sheet: table([["r1", "G", "<td>pens</td><td n>30</td>"], ["r2", "V", "<td>ink</td><td n>10</td>"], ["r3", "l", "<td>paper</td><td n>20</td>"], ["r4", "t", ""]]) }] };
    const sort = codec.apply(doc, { v: 1, t: "sort", sheet: "s1", rows: ["r2", "r3", "r1", "r4"], cols });
    expect(codec.apply(doc, { v: 1, t: "deleteRows", sheet: "s1", rows: ["r4"] }).out).toBe("applied");
    expect(codec.apply(doc, sort.inverse).out).toBe("applied");
    expect(doc.tabs[0].sheet.rows.map((row) => row.id)).toEqual(["r1", "r2", "r3"]);
    expect([cell(doc, "r1", "b"), cell(doc, "r2", "b"), cell(doc, "r3", "b")]).toEqual([30, 10, 20]);
  }
});

test("a one-column sort's conflict shows the value it would write in each cell", () => {
  // Fails when describe has no stored value for a sort: the dialog shows every cell blank.
  const stored = codec.describe({ v: 1, t: "sort", sheet: "s1", rows: ["r2", "r3", "r1"], cols: ["b"] }, book()).cells;
  expect(Object.fromEntries(stored.map((one) => [one.target, one.stored]))).toEqual({ "s1/r1/b": 10, "s1/r2/b": 20, "s1/r3/b": 30 });
});

test("an undo of a column width keeps the width a coworker set since", () => {
  // Fails when a changeCols undo writes a field a coworker changed: Ben's 300 goes back to the old width.
  const doc = book();
  const ana = codec.apply(doc, { v: 1, t: "changeCols", sheet: "s1", cols: [{ id: "b", width: 120 }] });
  codec.apply(doc, { v: 1, t: "changeCols", sheet: "s1", cols: [{ id: "b", width: 300 }] });
  const undo = codec.apply(doc, ana.inverse);
  expect(undo.out).toBe("applied");
  expect(codec.current(doc, "s1//b#width")).toBe(300);
  expect(undo.skipped).toEqual(["s1//b#width"]);
});

test("an undo of a freeze keeps the freeze line a coworker moved since", () => {
  // Fails when a freeze undo ignores a coworker's change: Ben's freeze through row 2 is removed.
  const doc = book();
  const ana = codec.apply(doc, { v: 1, t: "freeze", sheet: "s1", rowsThrough: "r1" });
  codec.apply(doc, { v: 1, t: "freeze", sheet: "s1", rowsThrough: "r2" });
  const undo = codec.apply(doc, ana.inverse);
  expect(undo.out).toBe("applied");
  expect(codec.current(doc, "s1#freezeRows")).toBe("r2");
  expect(undo.skipped).toEqual(["s1#freezeRows"]);
});

test("an undo of a column width still happens when a coworker changed only the column's format", () => {
  // Fails when width and format share one guard: Ana's width undo is skipped because Ben changed the format.
  const doc = book();
  const ana = codec.apply(doc, { v: 1, t: "changeCols", sheet: "s1", cols: [{ id: "b", width: 120 }] });
  codec.apply(doc, { v: 1, t: "changeCols", sheet: "s1", cols: [{ id: "b", fmt: "$#,##0" }] });
  const undo = codec.apply(doc, ana.inverse);
  expect(undo.out).toBe("applied");
  expect([codec.current(doc, "s1//b#width"), codec.current(doc, "s1//b#fmt")]).toEqual([null, "$#,##0"]);
  expect(undo.skipped).toEqual([]);
});

const formulas = () => ({ tabs: [{ id: "s1", name: "Budget", pos: "V", sheet: table([["r1", "G", '<td n>1</td><td f="=A1*2"></td>'], ["r2", "V", '<td n>2</td><td f="=A2*3"></td>'], ["r3", "l", '<td n>3</td><td f="=A3*4"></td>']]) }] });

test("undoing a one-column sort of formulas after a coworker inserted a row at the top gives each formula back on its own row", () => {
  // Fails when the undo's cell write carries formula text not bound to row ids: each formula reads the row above its own.
  const doc = formulas();
  const sort = codec.apply(doc, { v: 1, t: "sort", sheet: "s1", rows: ["r2", "r3", "r1"], cols: ["b"] });
  expect(codec.apply(doc, { v: 1, t: "insertRows", sheet: "s1", rows: [{ id: "r0", pos: "A" }] }).out).toBe("applied");
  expect(codec.apply(doc, sort.inverse).out).toBe("applied");
  expect([cell(doc, "r1", "b"), cell(doc, "r2", "b"), cell(doc, "r3", "b")]).toEqual([{ f: "=A2*2" }, { f: "=A3*3" }, { f: "=A4*4" }]);
});

test("a one-column sort's conflict shows each formula as the sort writes it", () => {
  // Fails when describe shows the source row's formula unshifted: the dialog shows a formula the sort does not write.
  const stored = codec.describe({ v: 1, t: "sort", sheet: "s1", rows: ["r2", "r3", "r1"], cols: ["b"] }, formulas()).cells;
  expect(Object.fromEntries(stored.map((one) => [one.target, one.stored]))).toEqual({ "s1/r1/b": { f: "=A1*3" }, "s1/r2/b": { f: "=A2*4" }, "s1/r3/b": { f: "=A3*2" } });
});

test("undoing a sort of rows that shared one order key after a coworker deleted a row still puts the rows back", () => {
  // Fails when the undo leaves out a deleted row but keeps its order key: the undo is refused and the rows stay sorted.
  const doc = { tabs: [{ id: "s1", name: "Budget", pos: "V", sheet: table([["r1", "G", "<td>pens</td><td n>50</td>"], ["r2", "V", "<td>ink</td><td n>30</td>"], ["r3", "V", "<td>paper</td><td n>10</td>"], ["r4", "l", "<td>tape</td><td n>5</td>"]]) }] };
  const sort = codec.apply(doc, { v: 1, t: "sort", sheet: "s1", rows: ["r3", "r2", "r1", "r4"], cols: null });
  expect(sort.out).toBe("applied");
  expect(codec.apply(doc, { v: 1, t: "deleteRows", sheet: "s1", rows: ["r4"] }).out).toBe("applied");
  expect(codec.apply(doc, sort.inverse).out).toBe("applied");
  expect(doc.tabs[0].sheet.rows.map((row) => row.id)).toEqual(["r1", "r2", "r3"]);
});

test("undoing a sort of rows that shared one order key after a coworker inserted a row among them keeps that row in its place", () => {
  // Fails when the undo always writes the rows' old keys: they move past Ben's row, and his =B3*2 reads another row.
  const cols = [["a", "G"], ["b", "M"], ["c", "V"]];
  const doc = { tabs: [{ id: "s1", name: "Budget", pos: "G", sheet: table([["r1", "G", "<td>pens</td><td n>50</td>"], ["r2", "d", "<td>ink</td><td n>30</td>"], ["r3", "d", "<td>paper</td><td n>10</td>"]], cols) }] };
  const sort = codec.apply(doc, { v: 1, t: "sort", sheet: "s1", rows: ["r3", "r2", "r1"], cols: null });
  expect(doc.tabs[0].sheet.rows.map((row) => `${row.id}@${row.pos}`)).toEqual(["r3@G", "r2@S", "r1@d"]);
  expect(codec.apply(doc, { v: 1, t: "insertRows", sheet: "s1", rows: [{ id: "rb", pos: "Y" }] }).out).toBe("applied");
  expect(codec.apply(doc, { v: 1, t: "set", sheet: "s1", cells: [["rb", "b", 7], ["rb", "c", { f: "=B3*2" }]] }).out).toBe("applied");
  expect(codec.apply(doc, sort.inverse).out).toBe("applied");
  expect(doc.tabs[0].sheet.rows.map((row) => row.id)).toEqual(["r1", "r2", "rb", "r3"]);
  expect(cell(doc, "rb", "c")).toEqual({ f: "=B3*2" });
});

test("undoing a paste that added rows after a coworker deleted one of them puts back the cells it overwrote", () => {
  // Fails when the undo needs every row it would delete: it is refused once Ben deleted one, and Ana's overwritten cells never come back.
  const doc = book();
  const paste = codec.apply(doc, { v: 1, t: "set", sheet: "s1", rows: [{ id: "r4", pos: "t" }, { id: "r5", pos: "u" }], cells: [["r2", "b", 0], ["r3", "b", 0], ["r4", "b", 0], ["r5", "b", 0]] });
  expect(paste.out).toBe("applied");
  expect(codec.apply(doc, { v: 1, t: "deleteRows", sheet: "s1", rows: ["r5"] }).out).toBe("applied");
  expect(codec.fits(doc, paste.inverse)).toBe(true);
  expect(codec.apply(doc, paste.inverse).out).toBe("applied");
  expect(doc.tabs[0].sheet.rows.map((row) => row.id)).toEqual(["r1", "r2", "r3"]);
  expect([cell(doc, "r1", "b"), cell(doc, "r2", "b"), cell(doc, "r3", "b")]).toEqual([30, 10, 20]);
});

test("a tab's rules survive a room read and write", () => {
  const doc = book();
  const rules = [{ id: "k1", pos: "G", kind: "check", range: "A1:A9" }];
  doc.tabs[0].sheet.rules = rules;
  const back = codec.read(codec.write(doc, RECORD));
  expect(back.doc.tabs[0].sheet.rules).toEqual(rules);
});

test("a room refuses an undo whose rule restore holds a rule no rules action could write", () => {
  const revert = (rules) => ({ v: 1, t: "revert", of: null, step: { action: { v: 1, t: "set", sheet: "s1", cells: [["r1", "b", 5]] }, restore: [], rules }, wrote: [] });
  const anyStyle = ["s1", "k", { id: "k", pos: "V", kind: "when", range: "A1:A9", test: "gt", a: "1", style: "position:fixed" }, null];
  const carriageReturn = ["s1", "k", { id: "k", pos: "V", kind: "check", range: "A1\rB2" }, null];
  expect([codec.validate(revert([anyStyle])), codec.validate(revert([carriageReturn]))]).toEqual([false, false]);
});

test("undoing a row insert on a tab with rules is accepted in a room", () => {
  const doc = book();
  const rule = { id: "k1", pos: "G", kind: "list", range: "B2:B3", items: ["Open", "Done"] };
  doc.tabs[0].sheet.rules = [rule];
  const out = codec.apply(doc, { v: 1, t: "insertRows", sheet: "s1", rows: [{ id: "r0", pos: "A" }] });
  expect(out.out).toBe("applied");
  expect(doc.tabs[0].sheet.rules[0].range).toBe("B3:B4");
  expect(codec.fits(doc, out.inverse)).toBe(true);
  expect(codec.apply(doc, out.inverse).out).toBe("applied");
  expect(doc.tabs[0].sheet.rules[0].range).toBe("B2:B3");
});

test("a chart's drawing is read past, written back from drawingsIn, and refused when its figure is not the one the codec writes", () => {
  const svg = '<svg><rect x="1"></rect></svg>';
  const doc = book();
  doc.tabs[0].sheet.rules = [{ id: "g", pos: "G", kind: "chart", range: "A1:B2", source: "A1:B2", type: "column" }];
  const bytes = codec.write(doc, RECORD, { drawing: () => svg });
  expect(bytes).toContain(`<figure chart="g" sap-ignore="">${svg}</figure>`);
  const back = codec.read(bytes);
  expect(back.doc.tabs[0].sheet.rules).toEqual(doc.tabs[0].sheet.rules);
  expect(codec.write(back.doc, RECORD, { drawing: drawingsIn(bytes) })).toBe(bytes);
  expect(codec.write(doc, RECORD)).not.toContain("<figure");
  expect(() => codec.read(bytes.replace("<rect", "<!-- x --><rect"))).toThrow("does not read");
  expect(() => codec.read(bytes.replace("<table grid>", `<figure chart="g" sap-ignore="">${svg}</figure><table grid>`))).toThrow();
  expect(() => codec.read(bytes.replace('sap-ignore=""', 'onclick="x" sap-ignore=""'))).toThrow('<figure chart="ID" sap-ignore="">');
  expect(() => codec.read(bytes.replace(' sap-ignore=""', ""))).toThrow('<figure chart="ID" sap-ignore="">');
});

test("drawingsIn reads drawings from bytes with no commit record", () => {
  const svg = '<svg><rect x="1"></rect></svg>';
  const first = { tabs: [{ id: "s1", name: "Budget", pos: "V", sheet: budget() }, { id: "s2", name: "Notes", pos: "l", sheet: notes() }] };
  first.tabs[0].sheet.rules = [{ id: "k1", pos: "G", kind: "chart", range: "A1:B2", source: "A1:B2", type: "column" }];
  const written = codec.write(first, RECORD, { drawing: () => svg });
  const bytes = written.replace(/<script type="application\/json" sheet-commit=""[^]*?<\/script>/, "").replace('</table>', "</table><p>hand edited</p>");
  expect(bytes).not.toContain("sheet-commit");
  expect(drawingsIn(bytes)("s1", "k1")).toBe(svg);
  expect(drawingsIn(bytes)("s2", "k1")).toBeUndefined();
});

test("a room writes and reads back a chart id with a no-break space", () => {
  const svg = '<svg><rect x="1"></rect></svg>';
  const doc = book();
  doc.tabs[0].sheet.rules = [{ id: "a\u00a0b", pos: "G", kind: "chart", range: "A1:B2", source: "A1:B2", type: "column" }];
  const bytes = codec.write(doc, RECORD, { drawing: () => svg });
  expect(bytes).toContain('chart="a&nbsp;b"');
  expect(codec.read(bytes).doc.tabs[0].sheet.rules).toEqual(doc.tabs[0].sheet.rules);
});
