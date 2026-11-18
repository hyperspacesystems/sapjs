import { createEngine } from "../../../src/grid/formula/engine.js";
import { modelWorkbook } from "../../../src/grid/workbook-backing.js";

global.__SAP_KEEP_CONSOLE__ = true;

// The data every case reads, as Sheets would hold it:
//   A1:A6  10, 20, "x", (blank), TRUE, 30
//   B1:B6  "apple", "Banana", "apricot", "", "cherry", "a*b"
//   C1:C6  1, 2, 3, 4, 5, 6
//   D1     #DIV/0! (a formula), D2 "5" typed as text, D3 the ID "007" typed as text
//   C7:C12 blank, and the tab ends at row 12
const DATA = {
  "0,0": { text: "10", n: true },
  "1,0": { text: "20", n: true },
  "2,0": { text: "x" },
  "4,0": { text: "TRUE" },
  "5,0": { text: "30", n: true },
  "0,1": { text: "apple" },
  "1,1": { text: "Banana" },
  "2,1": { text: "apricot" },
  "4,1": { text: "cherry" },
  "5,1": { text: "a*b" },
  "0,2": { text: "1", n: true },
  "1,2": { text: "2", n: true },
  "2,2": { text: "3", n: true },
  "3,2": { text: "4", n: true },
  "4,2": { text: "5", n: true },
  "5,2": { text: "6", n: true },
  "0,3": { text: "", f: "=1/0" },
  "1,3": { text: "5", t: true },
  "2,3": { text: "007", t: true },
};

// [formula, the value Google Sheets gives]. An error is its code.
const CASES = [
  ['=SUMIF(Nope!A1:A3, "x")', "#REF!"],
  ['=COUNTIF(Nope!A1:A3, "x")', "#REF!"],
  ["=COUNTBLANK(Nope!A1:A3)", "#REF!"],
  ["=0.1+0.2=0.3", true],
  ["=COUNTBLANK(C1:C20)", 14],
  ['=COUNTIF(C1:C20, "")', 14],
  ["=COUNTIF(D1:D3, D3)", 1],
  ["=SUM(A1:A6)", 60],
  ["=SUM(A3)", 0],
  ['=SUM("x")', "#VALUE!"],
  ["=SUM(TRUE,2)", 3],
  ["=SUM(D1:D2)", "#DIV/0!"],
  ["=AVERAGE(A1:A6)", 20],
  ["=AVERAGE(A4)", "#DIV/0!"],
  ["=MIN(C1:C6)", 1],
  ["=MAX(A1:A6)", 30],
  ["=MAX(B1:B6)", 0],
  ["=COUNT(A1:A6)", 3],
  ["=COUNTA(A1:A6)", 5],
  ["=COUNTBLANK(A1:B6)", 2],
  ["=PRODUCT(C1:C4)", 24],
  ["=SUMPRODUCT(C1:C3,C4:C6)", 32],
  ["=SUMPRODUCT(C1:C3,C1:C2)", "#VALUE!"],
  ["=MEDIAN(C1:C6)", 3.5],
  ["=ROUND(2.5,0)", 3],
  ["=ROUND(-2.5,0)", -3],
  ["=ROUND(1.005,2)", 1.01],
  ["=ROUND(1234,-2)", 1200],
  ["=ROUNDUP(1.21,1)", 1.3],
  ["=ROUNDDOWN(-1.29,1)", -1.2],
  ["=INT(-1.5)", -2],
  ["=ABS(-3)", 3],
  ["=MOD(-3,2)", 1],
  ["=MOD(3,0)", "#DIV/0!"],
  ["=POWER(2,10)", 1024],
  ["=SQRT(-1)", "#NUM!"],
  ["=CEILING(2.1,0.5)", 2.5],
  ["=FLOOR(-2.5,1)", -3],
  ["=0.1+0.2", 0.30000000000000004],
  ['=SUMIF(A1:A6,">15")', 50],
  ['=SUMIF(B1:B6,"a*",C1:C6)', 10],
  ['=SUMIF(B1:B6,"a~*b",C1:C6)', 6],
  ['=COUNTIF(B1:B6,"<>")', 5],
  ['=COUNTIF(B1:B6,"")', 1],
  ['=COUNTIF(B1:B6,"banana")', 1],
  ["=COUNTIF(C1:C6,3)", 1],
  ['=COUNTIFS(C1:C6,">1",C1:C6,"<5")', 3],
  ['=SUMIFS(C1:C6,B1:B6,"a*",C1:C6,">1")', 9],
  ['=AVERAGEIF(C1:C6,">3")', 5],
  ['=AVERAGEIFS(C1:C6,C1:C6,">10")', "#DIV/0!"],
  ['=IF(A1>5,"big","small")', "big"],
  ["=IF(FALSE,1)", false],
  ["=IF(A3,1,2)", "#VALUE!"],
  ['=IFS(C1>5,"a",C1>0,"b")', "b"],
  ["=IFS(FALSE,1)", "#N/A"],
  ["=AND(TRUE,C1:C6)", true],
  ["=AND(B1:B2)", "#VALUE!"],
  ["=OR(0,FALSE)", false],
  ["=NOT(0)", true],
  ["=IFERROR(D1,7)", 7],
  ["=IFERROR(C1,7)", 1],
  ["=IFNA(NA(),8)", 8],
  ["=IFNA(D1,8)", "#DIV/0!"],
  ['=SWITCH(C2,1,"one",2,"two","other")', "two"],
  ['=SWITCH(9,1,"one")', "#N/A"],
  ["=ISBLANK(A4)", true],
  ["=ISBLANK(B4)", true],
  ["=ISNUMBER(D2)", false],
  ["=ISTEXT(D2)", true],
  ["=ISERROR(D1)", true],
  ["=ISNA(NA())", true],
  ["=ROW()", 10],
  ["=ROW(C3)", 3],
  ["=COLUMN(D1:F2)", 4],
  ["=ROWS(A1:B6)", 6],
  ["=COLUMNS(A1:C1)", 3],
  ["=ROW(A100)", 100],
  ['="a"&1.5&TRUE', "a1.5TRUE"],
  ["=2^-1", 0.5],
  ["=0^-1", "#DIV/0!"],
  ["=-A1%", -0.1],
  ['="10"+1', 11],
  ['="abc"="ABC"', true],
  ["=A4=0", true],
  ['=A4=""', true],
  ["=NOSUCH(1)", "#NAME?"],
  ["=A1:A2", "#VALUE!"],
  ["=A1:A1", 10],
  ["=#N/A", "#N/A"],
];

test("each function and operator gives what Google Sheets gives", () => {
  const rows = 12;
  const cells = { ...DATA };
  CASES.forEach(([f], i) => {
    cells[`9,${4 + i}`] = { text: "", f };
  });
  const width = 4 + CASES.length;
  const sheet = {
    cols: Array.from({ length: width }, (_, c) => ({ id: `c${c}`, pos: `a${String(c).padStart(3, "0")}` })),
    rows: Array.from({ length: rows }, (_, r) => ({ id: `r${r}`, pos: `a${String(r).padStart(3, "0")}`, cells: [] })),
  };
  for (const [at, cell] of Object.entries(cells)) {
    const [r, c] = at.split(",").map(Number);
    const row = sheet.rows[r];
    while (row.cells.length < c) row.cells.push(null);
    row.cells[c] = cell;
  }
  const engine = createEngine(modelWorkbook([{ id: "s", name: "Data", pos: "A", sheet }]));
  engine.load();
  const got = CASES.map(([f], i) => {
    const value = engine.result("s", "r9", `c${4 + i}`);
    return [f, value !== null && typeof value === "object" ? value.error : value];
  });
  expect(got).toEqual(CASES);
});

// Sheets stretches a SUMIF sum range of another shape from its first cell; v1 shows #VALUE!,
// because the stretched cells are not in the graph and the total would not follow them.
test("a SUMIF whose sum range is not the criteria's shape shows #VALUE!", () => {
  const sheet = {
    cols: [0, 1, 2].map((c) => ({ id: `c${c}`, pos: `a${c}` })),
    rows: [0, 1, 2].map((r) => ({ id: `r${r}`, pos: `a${r}`, cells: r === 0 ? [{ text: "1", n: true }, { text: "5", n: true }, { text: "", f: '=SUMIF(A1:A3, ">0", B1)' }] : [] })),
  };
  const engine = createEngine(modelWorkbook([{ id: "s", name: "Data", pos: "A", sheet }]));
  engine.load();
  expect(engine.result("s", "r0", "c2")).toEqual({ error: "#VALUE!" });
});
