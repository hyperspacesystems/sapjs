// The S6 gate: a person types and edits in a locale while the table keeps the neutral form, so the
// same sheet saved under any locale is byte-identical.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { tableHtml } from "../../src/grid/codec/write.js";
import { createGrid } from "../../src/grid/grid.js";
import { fromLocalFormula, neutralInput, toLocalFormula } from "../../src/grid/locale-text.js";
import { localeOf, localeTags } from "../../src/grid/locales.js";
import { readXlsx } from "./formula/support/xlsx.js";

global.__SAP_KEEP_CONSOLE__ = true;

const de = localeOf("de");

test("every corpus formula reads back the same through every locale", () => {
  const dir = join(process.cwd(), "test", "grid", "formula", "corpus");
  const formulas = [];
  for (const file of readdirSync(dir)) for (const sheet of readXlsx(join(dir, file))) for (const cell of sheet.cells) if (cell.f) formulas.push(cell.f);
  expect(formulas.length).toBeGreaterThanOrEqual(288);
  for (const tag of localeTags()) {
    const locale = localeOf(tag);
    const changed = formulas.filter((f) => fromLocalFormula(toLocalFormula(f, locale), locale) !== f);
    expect([tag, changed]).toEqual([tag, []]);
  }
});

test("German formulas, numbers, dates and booleans read as their neutral form", () => {
  expect(toLocalFormula('=SUMIF(A1:A3,">0,5",B1)+1.5', de)).toBe('=SUMMEWENN(A1:A3;">0,5";B1)+1,5');
  expect(fromLocalFormula('=ZÄHLENWENN(A1:A5;"x,y";WAHR)', de)).toBe('=COUNTIF(A1:A5,"x,y",TRUE)');
  expect(fromLocalFormula("=SUMME(A1;2,5)", de)).toBe("=SUM(A1,2.5)");
  expect(fromLocalFormula("=sum(A1;B1)", de)).toBe("=sum(A1,B1)");
  // An English comma between arguments would be read as another formula: refused.
  expect(fromLocalFormula("=SUMME(A1, B1)", de)).toBe(null);
  expect(fromLocalFormula("=SVERWEIS(3;C1:C6;1;FALSCH)", de)).toBe("=VLOOKUP(3,C1:C6,1,FALSE)");
  const read = (text) => neutralInput(text, de);
  expect([read("1.234,56"), read("12,5 %"), read("-3,5"), read("5.3.2024"), read("WAHR"), read("Hallo")]).toEqual(["1234.56", "12.5%", "-3.5", "3/5/2024", "TRUE", "Hallo"]);
});

// Bug this guards: German typing stored "1.234,56" as text, or "=SUMME(A1;A2)" untranslated, so an
// English reader of the same file saw text and #NAME?.
test("a sheet typed in German saves the same bytes as the same sheet typed in English", () => {
  const typeInto = (locale, entries) => {
    const holder = document.createElement("div");
    holder.innerHTML = tableHtml({ cols: ["A", "B", "C"].map((pos, c) => ({ id: `c${c}`, pos })), rows: ["A", "B"].map((pos, r) => ({ id: `r${r}`, pos, cells: [] })) });
    const table = holder.firstElementChild;
    const grid = createGrid(table, { locale });
    for (const [ref, text] of entries) grid.set(ref, text);
    return { html: table.outerHTML, grid, table };
  };
  const german = typeInto("de", [["A1", "1.234,56"], ["B1", "5.3.2024"], ["C1", "WAHR"], ["A2", "=SUMME(A1;2,5)"], ["B2", "12,5 %"]]);
  const english = typeInto("en-US", [["A1", "1234.56"], ["B1", "3/5/2024"], ["C1", "TRUE"], ["A2", "=SUM(A1,2.5)"], ["B2", "12.5%"]]);
  expect(german.html).toBe(english.html);
  expect(german.grid.input("A1")).toBe("1234,56");
  expect(german.grid.input("A2")).toBe("=SUMME(A1;2,5)");
  expect(german.grid.input("B1")).toBe("5.3.2024");
  // Enter on a cell without changing its editor text changes nothing.
  for (const ref of ["A1", "B1", "C1", "A2", "B2"]) german.grid.set(ref, german.grid.input(ref));
  expect(german.table.outerHTML).toBe(english.html);
});

// Bug this guards: a German CSV "1,25;3,50" split on its decimal commas into three columns.
test("a German CSV with decimal commas imports as two numbers", () => {
  const holder = document.createElement("div");
  holder.innerHTML = tableHtml({ cols: ["A", "B", "C"].map((pos, c) => ({ id: `c${c}`, pos })), rows: [{ id: "r0", pos: "A", cells: [] }] });
  const grid = createGrid(holder.firstElementChild, { locale: "de" });
  grid.importDelimited("1,25;3,50", "A1");
  expect([grid.input("A1"), grid.input("B1"), grid.input("C1")]).toEqual(["1,25", "3,5", ""]);
});

const germanGrid = (cols = 3, rows = 2) => {
  const holder = document.createElement("div");
  holder.innerHTML = tableHtml({ cols: Array.from({ length: cols }, (_, c) => ({ id: `c${c}`, pos: "ABCDEF"[c] })), rows: Array.from({ length: rows }, (_, r) => ({ id: `r${r}`, pos: "ABCDEF"[r], cells: [] })) });
  return createGrid(holder.firstElementChild, { locale: "de" });
};

// Bugs these guard (S6 review): a time typed in German was stored as text; "3.14" was stored as the
// text "14/3", which nobody typed; "=ROUND(A1,2)" was read as ROUND(A1.2).
test("German typing keeps times, keeps what it cannot read, and refuses an English comma", () => {
  const grid = germanGrid();
  grid.set("A1", "9:30");
  grid.set("B1", "3.14");
  grid.set("C1", "2024-03-05");
  expect([grid.input("A1"), grid.input("B1"), grid.input("C1")]).toEqual(["9:30:00", "'3.14", "5.3.2024"]);
  expect(() => grid.set("A2", "=ROUND(A1,2)")).toThrow(/between arguments/);
  expect(() => grid.set("A2", "=SUMME(A1, B1)")).toThrow(/between arguments/);
  grid.set("A2", "=SUMME(1,5;2)");
  expect(grid.input("A2")).toBe("=SUMME(1,5;2)");
});

// Bug this guards: a German export then import changed 1.5 into 1 May and 1.234 into 1234.
test("a German CSV export imports back unchanged, and a one-column CSV keeps its decimal commas", () => {
  const grid = germanGrid(3, 2);
  for (const [ref, text] of [["A1", "1,5"], ["B1", "1,234"], ["C1", "0,125"], ["A2", "5.3.2024"], ["B2", "Hallo"]]) grid.set(ref, text);
  const before = ["A1", "B1", "C1", "A2", "B2"].map((ref) => grid.input(ref));
  for (const values of ["raw", "shown"]) {
    const copy = germanGrid(3, 2);
    copy.importDelimited(grid.toDelimited(undefined, { values }), "A1");
    expect(["A1", "B1", "C1", "A2", "B2"].map((ref) => copy.input(ref))).toEqual(before.map((text, i) => (values === "raw" && i === 3 ? copy.input("A2") : text)));
  }
  const column = germanGrid(1, 3);
  column.importDelimited("Betrag\n1,25\n3,50", "A1");
  expect([column.input("A1"), column.input("A2"), column.input("A3")]).toEqual(["Betrag", "1,25", "3,5"]);
});

// Bugs these guard (S6 review, second seat): "=2.500*12" computed 2.5*12; "12€50" stored 1250;
// "true" in German became WAHR; a "@" text cell stored "1.25" for typed "1,25"; a values-only
// paste of "=SUMME(A1;B1)" stored "=SUM(A1,B1)", text nobody pasted.
test("German typing leaves alone what German does not read as a number, and text cells keep what was typed", () => {
  const grid = germanGrid(3, 2);
  expect(() => grid.set("A1", "=2.500*12")).toThrow(/between arguments/);
  grid.set("A1", "12€50");
  grid.set("B1", "true");
  grid.set("C1", ",5");
  expect([grid.input("A1"), grid.input("B1"), grid.input("C1")]).toEqual(["12€50", "'true", "0,5"]);
  grid.setRange("A2", [["=SUMME(A1;B1)"]], { formulas: false });
  expect(grid.input("A2")).toBe("'=SUMME(A1;B1)");

  const holder = document.createElement("div");
  holder.innerHTML = tableHtml({ cols: [{ id: "c0", pos: "A" }], rows: [{ id: "r0", pos: "A", cells: [{ text: "", fmt: "@" }] }] });
  const text = createGrid(holder.firstElementChild, { locale: "de" });
  text.set("A1", "1,25");
  expect(text.input("A1")).toBe("1,25");
  text.set("A1", "1,26");
  expect(holder.querySelector("td").textContent).toBe("1,26");
});
