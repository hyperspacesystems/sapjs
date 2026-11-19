import { bind, cornersUnordered, frameFrom, fromIds, idsOf, lossy, originalSlots, parse, print, restoreSlots, slotsOf, standard, tokenize } from "../../../src/grid/formula/text.js";

global.__SAP_KEEP_CONSOLE__ = true;

const rowsOf = (id, count, extra = []) => [...extra, ...Array.from({ length: count }, (_, i) => `${id}r${i + 1}`)];
const colsOf = (id, count) => Array.from({ length: count }, (_, i) => `${id}c${i + 1}`);

const tab = (id, name, rows, cols) => ({ id, name, rows, cols });
const frame = (...tabs) => frameFrom(tabs);

const book = frame(tab("s1", "Budget", rowsOf("s1", 100), colsOf("s1", 3)), tab("s2", "Notes", rowsOf("s2", 8), colsOf("s2", 2)));
const oneTab = frame(tab("s1", "Budget", rowsOf("s1", 100), colsOf("s1", 3)));

const printed = (f, homeId, before, after) => print(bind(f, homeId, before), homeId, before, after);

test("tokenize spans", () => {
  const src = "SUM(A1:B $2)+3.5";
  expect(tokenize(src).map((token) => src.slice(token.start, token.end))).toEqual(["SUM", "(", "A1", ":", "B", "$2", ")", "+", "3.5"]);
  expect(tokenize("B2")[0]).toEqual({ type: "cell", sheet: null, col: "B", row: 2, absCol: false, absRow: false, start: 0, end: 2 });
  expect(tokenize("'Q1 2026'!B2")[0]).toMatchObject({ type: "cell", sheet: "Q1 2026", col: "B", row: 2, start: 0, end: 12 });
});

test("row ranges parse past a tab name or a dollar", () => {
  for (const [src, sheet] of [["Budget!1:5", "Budget"], ["$1:$5", null]]) {
    const parsed = parse(src);
    expect(parsed.error).toBeUndefined();
    expect(parsed.refs).toHaveLength(1);
    expect(parsed.refs[0].type).toBe("range");
    expect(parsed.refs[0].sheet).toBe(sheet);
    expect([parsed.refs[0].from.col, parsed.refs[0].from.row, parsed.refs[0].to.col, parsed.refs[0].to.row]).toEqual([null, 1, null, 5]);
  }
  expect(parse("Budget!$1:$5").refs[0]).toMatchObject({ type: "range", sheet: "Budget" });
  expect(parse("1:5").refs[0]).toMatchObject({ type: "range", from: { row: 1 }, to: { row: 5 } });
});

test("parse errors", () => {
  expect(parse("SUM(")).toEqual({ error: "#ERROR!", at: 4 });
  expect(parse("A1:")).toEqual({ error: "#ERROR!", at: 3 });
  expect(bind("=SUM(", "s1", book)).toBe(null);
});

test("bind then print in the same frame gives the printer's spelling", () => {
  expect(printed("=sum(a1)", "s1", book, book)).toBe("=sum(A1)");
  expect(printed("=SUM($a$1:b2)", "s1", book, book)).toBe("=SUM($A$1:B2)");
  expect(printed("=SUM(A:A)", "s1", book, book)).toBe("=SUM(A:A)");
  expect(printed("=SUM(1:5)", "s1", book, book)).toBe("=SUM(1:5)");
});

test("tab names are quoted as the tokenizer reads them", () => {
  const spaced = frame(tab("s1", "Budget", rowsOf("s1", 20), colsOf("s1", 3)), tab("s2", "Q1 2026", rowsOf("s2", 10), colsOf("s2", 3)));
  expect(printed("='Q1 2026'!B2", "s1", spaced, spaced)).toBe("='Q1 2026'!B2");
  expect(idsOf(bind("='Q1 2026'!B2", "s1", spaced))).toEqual([["s2", "s2r2", "s2c2", "s2r2", "s2c2"]]);
  const cut = frame(tab("s1", "Budget", rowsOf("s1", 20), colsOf("s1", 3)), tab("s2", "Sheet's copy", rowsOf("s2", 10), colsOf("s2", 3)));
  expect(printed("='Sheet''s copy'!B2", "s1", cut, cut)).toBe("='Sheet''s copy'!B2");
  const cellish = frame(tab("s1", "Budget", rowsOf("s1", 20), colsOf("s1", 3)), tab("s2", "AB12", rowsOf("s2", 10), colsOf("s2", 3)));
  expect(printed("=AB12!B2", "s1", cellish, cellish)).toBe("='AB12'!B2");
  expect(idsOf(bind(printed("=AB12!B2", "s1", cellish, cellish), "s1", cellish))).toEqual([["s2", "s2r2", "s2c2", "s2r2", "s2c2"]]);
});

test("a reference follows its records, a floating end keeps its number", () => {
  const after = frame(tab("s1", "Budget", rowsOf("s1", 100, ["s1r0"]), colsOf("s1", 3)), tab("s2", "Notes", rowsOf("s2", 8), colsOf("s2", 2)));
  expect(printed("=SUM(A2:A1000)", "s1", oneTab, after)).toBe("=SUM(A3:A1000)");
  expect(printed("=SUM(B2:B5)", "s1", book, book)).toBe("=SUM(B2:B5)");
  expect(printed("=Budget!B5", "s2", book, book)).toBe("=Budget!B5");
});

test("a deleted single cell is #REF!, a deleted range end moves toward the edge", () => {
  const removed = frame(tab("s1", "Budget", rowsOf("s1", 100).filter((id) => id !== "s1r5"), colsOf("s1", 3)));
  expect(printed("=B5", "s1", oneTab, removed)).toBe("=#REF!");
  expect(printed("=SUM(B2:B5)", "s1", oneTab, removed)).toBe("=SUM(B2:B4)");
  expect(printed("=SUM(A2:A1000)", "s1", oneTab, frame(tab("s1", "Budget", rowsOf("s1", 100, ["s1r0"]), colsOf("s1", 3))))).toBe("=SUM(A3:A1000)");
});

test("idsOf writes 0 past the edge and a name for an unknown tab, and fromIds reads both", () => {
  const ids = idsOf(bind("=SUM(A2:A1000)", "s1", oneTab));
  expect(ids).toEqual([["s1", "s1r2", "s1c1", 0, "s1c1"]]);
  expect(printed("=SUM(A2:A1000)", "s1", oneTab, oneTab)).toBe("=SUM(A2:A1000)");
  const back = fromIds("=SUM(A2:A1000)", ids);
  expect(print(back, "s1", null, oneTab)).toBe("=SUM(A2:A1000)");

  const named = idsOf(bind("=Totals!B2", "s1", oneTab));
  expect(named).toEqual([["~", "Totals"]]);
  expect(fromIds("=Totals!B2", named)).toMatchObject({ refs: [{ unbound: true, name: "Totals" }] });
  expect(print(fromIds("=Totals!B2", named), "s1", null, oneTab)).toBe("=Totals!B2");
});

test("lossy names a cut or shrunken reference", () => {
  const removed = frame(tab("s1", "Budget", rowsOf("s1", 100).filter((id) => id !== "s1r5"), colsOf("s1", 3)));
  expect(lossy(bind("=SUM(B2:B5)", "s1", oneTab), removed)).toBe(true);
  expect(lossy(bind("=SUM(B2:B4)", "s1", oneTab), removed)).toBe(false);
  expect(lossy(bind("=B5", "s1", oneTab), removed)).toBe(true);
});

test("slot keys hold a range's corners in one order", () => {
  const slots = slotsOf("=SUM(B2:B5)", "s1", oneTab);
  expect(slots.keys).toEqual(["s1|s1r2|s1r5|s1c2|s1c2"]);
  expect(slotsOf("=SUM(B5:B2)", "s1", oneTab).keys).toEqual(slots.keys);
  expect(cornersUnordered(idsOf(bind("=SUM(B2:B5)", "s1", oneTab)))).toBe(cornersUnordered([["s1", "s1r5", "s1c2", "s1r2", "s1c2"]]));

  const original = originalSlots("=SUM(B2:B5)", "s1", oneTab);
  expect(restoreSlots("=SUM(#REF!)", "s1", oneTab, original, slotsOf("=SUM(#REF!)", "s1", oneTab).keys)).toBe("=SUM(B2:B5)");
  expect(restoreSlots("=SUM(B2:B3)", "s1", oneTab, original, slotsOf("=SUM(B2:B3)", "s1", oneTab).keys)).toBe("=SUM(B2:B5)");
  expect(restoreSlots("=SUM(B2:B8)", "s1", oneTab, original, slotsOf("=SUM(B2:B3)", "s1", oneTab).keys)).toBe("=SUM(B2:B8)");
  expect(restoreSlots("=SUM(B2:B3)+1", "s1", oneTab, original, slotsOf("=SUM(B2:B3)", "s1", oneTab).keys)).toBe(null);
});

test("ZZZ sorts past every column the sheet has", () => {
  const after = frame(tab("s1", "Budget", rowsOf("s1", 100, ["s1r0"]), colsOf("s1", 3)));
  expect(idsOf(bind("=ZZZ1", "s1", oneTab))).toEqual([["s1", "s1r1", 0, "s1r1", 0]]);
  expect(printed("=ZZZ1", "s1", oneTab, after)).toBe("=ZZZ2");
});

// Bug: a range open at one end (`B2:B`, the common Sheets way to total a column below a header)
// printed as #REF!, so the formula was lost on the next row insert.
test("a range open at one end keeps its open end and follows its bound end", () => {
  const inserted = frame(tab("s1", "Budget", rowsOf("s1", 100, ["new"]), colsOf("s1", 3)));
  const deleted = frame(tab("s1", "Budget", rowsOf("s1", 100).filter((id) => id !== "s1r2"), colsOf("s1", 3)));
  expect(printed("=SUM(A2:A)", "s1", oneTab, oneTab)).toBe("=SUM(A2:A)");
  expect(printed("=SUM(A2:A)", "s1", oneTab, inserted)).toBe("=SUM(A3:A)");
  expect(printed("=SUM(A2:A)", "s1", oneTab, deleted)).toBe("=SUM(A2:A)");
  expect(printed("=SUM($B$2:B)+Budget!C5:C", "s2", book, book)).toBe("=SUM($B$2:B)+Budget!C5:C");
  expect(printed("=SUM(A200:A)", "s1", oneTab, inserted)).toBe("=SUM(A200:A)");
});

test("the standard spelling capitalizes names and prints references from the tabs' names", () => {
  expect(standard("=sum(a1:a3)", "s1", book)).toBe("=SUM(A1:A3)");
  expect(standard("=budget!b2*2", "s2", book)).toBe("=Budget!B2*2");
  expect(standard("=if(true, a2:a, false)", "s1", book)).toBe("=IF(TRUE, A2:A, FALSE)");
  expect(standard("=sum(", "s1", book)).toBe("=sum(");
});
