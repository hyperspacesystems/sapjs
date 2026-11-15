import {
  buildDeleteCols,
  buildDeleteRows,
  buildFreeze,
  buildInsertCols,
  buildInsertRows,
  buildMerge,
  buildMoveCols,
  buildMoveRows,
  buildSetColWidth,
  buildSetRowHeight,
  buildUnmerge,
  GROW_COLS,
  GROW_ROWS,
} from "../../src/grid/build.js";
import { tableHtml } from "../../src/grid/codec/write.js";
import { derive } from "../../src/grid/content.js";
import { apply } from "../../src/grid/ops.js";
import { budget, counter, ids, merged, refusal, tied, trips, walk } from "./support/build-fixture.js";
import { clearsOf } from "./support/ops-fixture.js";

// A stand-in formula engine: the reducer lets a structure edit through on a sheet with formulas.
const ENGINE = { formulas: {} };

const BUDGET_COLS = `<col data-id="ca" data-pos="G" style="width:180px"><col data-id="cb" data-pos="V" fmt="$#,##0.00"><col data-id="cc" data-pos="l" fmt="0%">`;

const PINS = [
  [
    "rows between two rows take keys between theirs",
    budget,
    (view) => buildInsertRows(view, 3, 2, { newId: ids("n1", "n2") }),
    { v: 1, t: "insertRows", sheet: "s1", rows: [{ id: "n1", pos: "I" }, { id: "n2", pos: "K" }] },
    { lines: [`<tr data-id="n1" data-pos="I"></tr>`, `<tr data-id="n2" data-pos="K"></tr>`], rows: "r1 r2 n1 n2 r3 r4 r5 r6" },
  ],
  [
    "a row before the first row",
    budget,
    (view) => buildInsertRows(view, 1, 1, { newId: ids("n1") }),
    { v: 1, t: "insertRows", sheet: "s1", rows: [{ id: "n1", pos: "4" }] },
    { lines: [`<tr data-id="n1" data-pos="4"></tr>`], rows: "n1 r1 r2 r3 r4 r5 r6", frozen: { rows: 2, cols: 1 } },
  ],
  [
    "rows after the last row",
    budget,
    (view) => buildInsertRows(view, "7", 2, { newId: ids("n1", "n2") }),
    { v: 1, t: "insertRows", sheet: "s1", rows: [{ id: "n1", pos: "p" }, { id: "n2", pos: "t" }] },
    { lines: [`<tr data-id="n1" data-pos="p"></tr>`, `<tr data-id="n2" data-pos="t"></tr>`], rows: "r1 r2 r3 r4 r5 r6 n1 n2" },
  ],
  [
    "a row inside a tall merge",
    merged,
    (view) => buildInsertRows(view, 3, 1, { newId: ids("n1") }),
    { v: 1, t: "insertRows", sheet: "m", rows: [{ id: "n1", pos: "O" }] },
    {
      lines: [`<tr data-id="m-r2" data-pos="G"><td rowspan="3">Tall</td><td>B2</td><td>C2</td></tr>`, `<tr data-id="n1" data-pos="O"><td hidden></td></tr>`],
      rows: "m-r1 m-r2 n1 m-r3 m-r4",
    },
  ],
  [
    "columns inside a wide merge",
    merged,
    (view) => buildInsertCols(view, "B", 2, { newId: ids("n1", "n2") }),
    { v: 1, t: "insertCols", sheet: "m", cols: [{ id: "n1", pos: "A" }, { id: "n2", pos: "C" }] },
    {
      lines: [
        `<table grid><colgroup><col data-id="m-c0" data-pos="8"><col data-id="n1" data-pos="A"><col data-id="n2" data-pos="C"><col data-id="m-c1" data-pos="G"><col data-id="m-c2" data-pos="V"><col data-id="m-c3" data-pos="l"></colgroup>`,
        `<tr data-id="m-r1" data-pos="8"><td colspan="5">Title</td><td hidden></td><td hidden></td><td hidden></td><td hidden></td><td>D1</td></tr>`,
        `<tr data-id="m-r2" data-pos="G"><td rowspan="2">Tall</td><td></td><td></td><td>B2</td><td>C2</td></tr>`,
        `<tr data-id="m-r3" data-pos="V"><td hidden></td><td></td><td></td><td>B3</td><td></td><td>D3</td></tr>`,
        `<tr data-id="m-r4" data-pos="l"><td colspan="4">Box</td><td hidden></td><td hidden></td><td hidden></td></tr>`,
      ],
      cols: "m-c0 n1 n2 m-c1 m-c2 m-c3",
    },
  ],
  [
    "columns after the last column",
    budget,
    (view) => buildInsertCols(view, "D", 2, { newId: ids("n1", "n2") }),
    { v: 1, t: "insertCols", sheet: "s1", cols: [{ id: "n1", pos: "p" }, { id: "n2", pos: "t" }] },
    { lines: [`<table grid freeze-cols="1"><colgroup>${BUDGET_COLS}<col data-id="n1" data-pos="p"><col data-id="n2" data-pos="t"></colgroup>`], cols: "ca cb cc n1 n2" },
  ],
  [
    "a column before the first column",
    budget,
    (view) => buildInsertCols(view, "A", 1, { newId: ids("n1") }),
    { v: 1, t: "insertCols", sheet: "s1", cols: [{ id: "n1", pos: "8" }] },
    {
      lines: [
        `<table grid freeze-cols="2"><colgroup><col data-id="n1" data-pos="8">${BUDGET_COLS}</colgroup>`,
        `<tr data-id="r1" data-pos="8"><td></td><td style="font-weight:bold">Item</td><td>Cost</td><td>Share</td></tr>`,
        `<tr data-id="r2" data-pos="G"><td></td><td>Rent</td><td n v="1200">$1,200.00</td><td n f="=B2/B$5" v="0.8">80%</td></tr>`,
        `<tr data-id="r3" data-pos="O"><td></td><td>Food</td><td n v="300">$300.00</td><td n f="=B3/B$5" v="0.2">20%</td></tr>`,
        `<tr data-id="r5" data-pos="d"><td></td><td style="font-weight:bold">Total</td><td n f="=SUM(B2:B3)" v="1500">$1,500.00</td></tr>`,
        `<tr data-id="r6" data-pos="l"><td></td><td colspan="3" style="text-align:center">Prices as of November</td><td hidden></td><td hidden></td></tr>`,
      ],
      cols: "n1 ca cb cc",
      frozen: { rows: 1, cols: 2 },
    },
  ],
  [
    "rows deleted by a range",
    budget,
    (view) => buildDeleteRows(view, "2:3"),
    { v: 1, t: "deleteRows", sheet: "s1", rows: ["r2", "r3"] },
    { lines: [], rows: "r1 r4 r5 r6" },
  ],
  [
    "the row that anchors a tall merge deleted",
    merged,
    (view) => buildDeleteRows(view, 2),
    { v: 1, t: "deleteRows", sheet: "m", rows: ["m-r2"] },
    { lines: [`<tr data-id="m-r3" data-pos="V"><td>Tall</td><td>B3</td><td></td><td>D3</td></tr>`], rows: "m-r1 m-r3 m-r4" },
  ],
  [
    "a column deleted from inside two merges",
    merged,
    (view) => buildDeleteCols(view, "B"),
    { v: 1, t: "deleteCols", sheet: "m", cols: ["m-c1"] },
    {
      lines: [
        `<table grid><colgroup><col data-id="m-c0" data-pos="8"><col data-id="m-c2" data-pos="V"><col data-id="m-c3" data-pos="l"></colgroup>`,
        `<tr data-id="m-r1" data-pos="8"><td colspan="2">Title</td><td hidden></td><td>D1</td></tr>`,
        `<tr data-id="m-r2" data-pos="G"><td rowspan="2">Tall</td><td>C2</td></tr>`,
        `<tr data-id="m-r3" data-pos="V"><td hidden></td><td></td><td>D3</td></tr>`,
        `<tr data-id="m-r4" data-pos="l"><td>Box</td></tr>`,
      ],
      cols: "m-c0 m-c2 m-c3",
    },
  ],
  [
    "columns deleted by a range",
    budget,
    (view) => buildDeleteCols(view, "B:C"),
    { v: 1, t: "deleteCols", sheet: "s1", cols: ["cb", "cc"] },
    {
      lines: [
        `<table grid freeze-cols="1"><colgroup><col data-id="ca" data-pos="G" style="width:180px"></colgroup>`,
        `<tr data-id="r1" data-pos="8"><td style="font-weight:bold">Item</td></tr>`,
        `<tr data-id="r2" data-pos="G"><td>Rent</td></tr>`,
        `<tr data-id="r3" data-pos="O"><td>Food</td></tr>`,
        `<tr data-id="r5" data-pos="d"><td style="font-weight:bold">Total</td></tr>`,
        `<tr data-id="r6" data-pos="l"><td style="text-align:center">Prices as of November</td></tr>`,
      ],
      cols: "ca",
    },
  ],
  [
    "rows moved down",
    budget,
    (view) => buildMoveRows(view, "2:3", 6),
    { v: 1, t: "changeRows", sheet: "s1", rows: [{ id: "r2", pos: "f" }, { id: "r3", pos: "h" }] },
    {
      lines: [
        `<tr data-id="r2" data-pos="f"><td>Rent</td><td n v="1200">$1,200.00</td><td n f="=B2/B$5" v="0.8">80%</td></tr>`,
        `<tr data-id="r3" data-pos="h"><td>Food</td><td n v="300">$300.00</td><td n f="=B3/B$5" v="0.2">20%</td></tr>`,
      ],
      rows: "r1 r4 r5 r2 r3 r6",
    },
  ],
  [
    "a row moved up",
    budget,
    (view) => buildMoveRows(view, 5, 2),
    { v: 1, t: "changeRows", sheet: "s1", rows: [{ id: "r5", pos: "C" }] },
    { lines: [`<tr data-id="r5" data-pos="C"><td style="font-weight:bold">Total</td><td n f="=SUM(B2:B3)" v="1500">$1,500.00</td></tr>`], rows: "r1 r5 r2 r3 r4 r6" },
  ],
  [
    "rows moved after the last row",
    budget,
    (view) => buildMoveRows(view, "2:3", 7),
    { v: 1, t: "changeRows", sheet: "s1", rows: [{ id: "r2", pos: "p" }, { id: "r3", pos: "t" }] },
    {
      lines: [
        `<tr data-id="r2" data-pos="p"><td>Rent</td><td n v="1200">$1,200.00</td><td n f="=B2/B$5" v="0.8">80%</td></tr>`,
        `<tr data-id="r3" data-pos="t"><td>Food</td><td n v="300">$300.00</td><td n f="=B3/B$5" v="0.2">20%</td></tr>`,
      ],
      rows: "r1 r4 r5 r6 r2 r3",
    },
  ],
  [
    "the rows of a tall merge moved together",
    merged,
    (view) => buildMoveRows(view, "2:3", 5),
    { v: 1, t: "changeRows", sheet: "m", rows: [{ id: "m-r2", pos: "p" }, { id: "m-r3", pos: "t" }] },
    {
      lines: [`<tr data-id="m-r2" data-pos="p"><td rowspan="2">Tall</td><td>B2</td><td>C2</td></tr>`, `<tr data-id="m-r3" data-pos="t"><td hidden></td><td>B3</td><td></td><td>D3</td></tr>`],
      rows: "m-r1 m-r4 m-r2 m-r3",
    },
  ],
  [
    "a column moved after the last column",
    trips,
    (view) => buildMoveCols(view, "A", "C"),
    { v: 1, t: "changeCols", sheet: "s2", cols: [{ id: "cd", pos: "l" }] },
    {
      lines: [
        `<table grid><colgroup><col data-id="ce" data-pos="V"><col data-id="cd" data-pos="l"></colgroup>`,
        `<tr data-id="r7" data-pos="G"><td n v="46095" fmt="mmm d, yyyy">Mar 14, 2026</td><td>Lisbon</td></tr>`,
        `<tr data-id="r8" data-pos="V"><td n f="=5000-Budget!B5" v="3500" fmt="$#,##0.00">$3,500.00</td><td>Budget left</td></tr>`,
      ],
      cols: "ce cd",
    },
  ],
  [
    "a column moved before the first column",
    trips,
    (view) => buildMoveCols(view, "B", "A"),
    { v: 1, t: "changeCols", sheet: "s2", cols: [{ id: "ce", pos: "8" }] },
    {
      lines: [
        `<table grid><colgroup><col data-id="ce" data-pos="8"><col data-id="cd" data-pos="G"></colgroup>`,
        `<tr data-id="r7" data-pos="G"><td n v="46095" fmt="mmm d, yyyy">Mar 14, 2026</td><td>Lisbon</td></tr>`,
        `<tr data-id="r8" data-pos="V"><td n f="=5000-Budget!B5" v="3500" fmt="$#,##0.00">$3,500.00</td><td>Budget left</td></tr>`,
      ],
      cols: "ce cd",
    },
  ],
  [
    "a height for rows",
    budget,
    (view) => buildSetRowHeight(view, "2:3", 30),
    { v: 1, t: "changeRows", sheet: "s1", rows: [{ id: "r2", height: 30 }, { id: "r3", height: 30 }] },
    {
      lines: [
        `<tr data-id="r2" data-pos="G" style="height:30px"><td>Rent</td><td n v="1200">$1,200.00</td><td n f="=B2/B$5" v="0.8">80%</td></tr>`,
        `<tr data-id="r3" data-pos="O" style="height:30px"><td>Food</td><td n v="300">$300.00</td><td n f="=B3/B$5" v="0.2">20%</td></tr>`,
      ],
    },
  ],
  [
    "a width for a column",
    budget,
    (view) => buildSetColWidth(view, "A", 120),
    { v: 1, t: "changeCols", sheet: "s1", cols: [{ id: "ca", width: 120 }] },
    { lines: [`<table grid freeze-cols="1"><colgroup>${BUDGET_COLS.replace("180px", "120px")}</colgroup>`] },
  ],
  [
    "null removes a column's width",
    budget,
    (view) => buildSetColWidth(view, "A:B", null),
    { v: 1, t: "changeCols", sheet: "s1", cols: [{ id: "ca", width: null }] },
    { lines: [`<table grid freeze-cols="1"><colgroup>${BUDGET_COLS.replace(` style="width:180px"`, "")}</colgroup>`] },
  ],
  [
    "a merge over cells that hold content",
    budget,
    (view) => buildMerge(view, "A2:B3"),
    { v: 1, t: "merge", sheet: "s1", from: ["r2", "ca"], to: ["r3", "cb"], clears: [["r2", "cb"], ["r3", "ca"], ["r3", "cb"]] },
    {
      lines: [
        `<tr data-id="r2" data-pos="G"><td colspan="2" rowspan="2">Rent</td><td hidden></td><td n f="=B2/B$5" v="0.8">80%</td></tr>`,
        `<tr data-id="r3" data-pos="O"><td hidden></td><td hidden></td><td n f="=B3/B$5" v="0.2">20%</td></tr>`,
      ],
    },
  ],
  [
    "a merge over empty cells",
    budget,
    (view) => buildMerge(view, "A4:C4"),
    { v: 1, t: "merge", sheet: "s1", from: ["r4", "ca"], to: ["r4", "cc"], clears: [] },
    { lines: [`<tr data-id="r4" data-pos="V"><td colspan="3"></td><td hidden></td><td hidden></td></tr>`] },
  ],
  [
    "a merge that takes in two merges",
    merged,
    (view) => buildMerge(view, "A1:D3"),
    {
      v: 1,
      t: "merge",
      sheet: "m",
      from: ["m-r1", "m-c0"],
      to: ["m-r3", "m-c3"],
      clears: [["m-r1", "m-c3"], ["m-r2", "m-c0"], ["m-r2", "m-c1"], ["m-r2", "m-c2"], ["m-r3", "m-c1"], ["m-r3", "m-c3"]],
    },
    {
      lines: [
        `<tr data-id="m-r1" data-pos="8"><td colspan="4" rowspan="3">Title</td><td hidden></td><td hidden></td><td hidden></td></tr>`,
        `<tr data-id="m-r2" data-pos="G"><td hidden></td><td hidden></td><td hidden></td><td hidden></td></tr>`,
        `<tr data-id="m-r3" data-pos="V"><td hidden></td><td hidden></td><td hidden></td><td hidden></td></tr>`,
      ],
    },
  ],
  [
    "a merge of a whole row widens the merge in it",
    merged,
    (view) => buildMerge(view, "4:4"),
    { v: 1, t: "merge", sheet: "m", from: ["m-r4", "m-c0"], to: ["m-r4", "m-c3"], clears: [] },
    { lines: [`<tr data-id="m-r4" data-pos="l"><td colspan="4">Box</td><td hidden></td><td hidden></td><td hidden></td></tr>`] },
  ],
  [
    "an unmerge",
    budget,
    (view) => buildUnmerge(view, "A6"),
    { v: 1, t: "unmerge", sheet: "s1", row: "r6", col: "ca" },
    { lines: [`<tr data-id="r6" data-pos="l"><td style="text-align:center">Prices as of November</td></tr>`] },
  ],
  [
    "an unmerge named by a covered cell carries the anchor",
    merged,
    (view) => buildUnmerge(view, "A3"),
    { v: 1, t: "unmerge", sheet: "m", row: "m-r2", col: "m-c0" },
    { lines: [`<tr data-id="m-r2" data-pos="G"><td>Tall</td><td>B2</td><td>C2</td></tr>`, `<tr data-id="m-r3" data-pos="V"><td></td><td>B3</td><td></td><td>D3</td></tr>`] },
  ],
  [
    "a freeze of two rows and no column",
    budget,
    (view) => buildFreeze(view, { rows: 2, cols: 0 }),
    { v: 1, t: "freeze", sheet: "s1", rowsThrough: "r2", colsThrough: null },
    { lines: [`<table grid><colgroup>${BUDGET_COLS}</colgroup>`], frozen: { rows: 2, cols: 0 } },
  ],
  [
    "a freeze of no row leaves the columns as they are",
    budget,
    (view) => buildFreeze(view, { rows: 0 }),
    { v: 1, t: "freeze", sheet: "s1", rowsThrough: null },
    { lines: ["<tbody>"], frozen: { rows: 0, cols: 1 } },
  ],
  [
    "a freeze of two columns leaves the rows as they are",
    budget,
    (view) => buildFreeze(view, { cols: 2 }),
    { v: 1, t: "freeze", sheet: "s1", colsThrough: "cb" },
    { lines: [`<table grid freeze-cols="2"><colgroup>${BUDGET_COLS}</colgroup>`], frozen: { rows: 1, cols: 2 } },
  ],
];

for (const [name, table, build, action, left] of PINS) {
  test(`pinned: ${name}`, () => {
    const store = table();
    const before = tableHtml(store.sheet);
    const built = build(store);
    expect(tableHtml(store.sheet)).toBe(before);
    expect(built).toEqual(action);
    const landed = walk(store, built, ENGINE);
    for (const part of Object.keys(left)) expect(landed[part]).toEqual(left[part]);
  });
}

test("an insert between two records that share a key gives fresh keys only from the insert point onward", () => {
  const store = tied();
  const action = buildInsertRows(store, 3, 1, { newId: ids("n1") });
  expect(action).toEqual({
    v: 1,
    t: "batch",
    actions: [
      { v: 1, t: "changeRows", sheet: "t", rows: [{ id: "r3", pos: "d" }, { id: "r4", pos: "h" }] },
      { v: 1, t: "insertRows", sheet: "t", rows: [{ id: "n1", pos: "Z" }] },
    ],
  });
  expect(walk(store, action)).toEqual({
    lines: [`<tr data-id="n1" data-pos="Z"></tr>`, `<tr data-id="r3" data-pos="d"><td>a3</td></tr>`, `<tr data-id="r4" data-pos="h"><td>a4</td></tr>`],
    rows: "r1 r2 n1 r3 r4 r5",
    cols: "ca cb cc cd ce",
    frozen: { rows: 0, cols: 0 },
  });

  const two = buildInsertRows(store, 4, 2, { newId: ids("n1", "n2") });
  expect(two).toEqual({
    v: 1,
    t: "batch",
    actions: [
      { v: 1, t: "changeRows", sheet: "t", rows: [{ id: "r4", pos: "h" }] },
      { v: 1, t: "insertRows", sheet: "t", rows: [{ id: "n1", pos: "Z" }, { id: "n2", pos: "d" }] },
    ],
  });
  expect(walk(store, two).rows).toBe("r1 r2 r3 n1 n2 r4 r5");

  const column = buildInsertCols(store, "C", 1, { newId: ids("n1") });
  expect(column).toEqual({
    v: 1,
    t: "batch",
    actions: [
      { v: 1, t: "changeCols", sheet: "t", cols: [{ id: "cc", pos: "d" }, { id: "cd", pos: "h" }] },
      { v: 1, t: "insertCols", sheet: "t", cols: [{ id: "n1", pos: "Z" }] },
    ],
  });
  expect(walk(store, column).cols).toBe("ca cb n1 cc cd ce");
});

test("an insert beside a run of shared keys, not inside it, is one plain insert", () => {
  expect(buildInsertRows(tied(), 2, 1, { newId: ids("n1") })).toEqual({ v: 1, t: "insertRows", sheet: "t", rows: [{ id: "n1", pos: "K" }] });
  expect(buildInsertRows(tied(), 5, 1, { newId: ids("n1") })).toEqual({ v: 1, t: "insertRows", sheet: "t", rows: [{ id: "n1", pos: "d" }] });
  const store = tied();
  expect(walk(store, buildInsertRows(store, 5, 1, { newId: ids("n1") })).rows).toBe("r1 r2 r3 r4 n1 r5");
});

test("a move between records that share a key gives the ones after it fresh keys", () => {
  const store = tied();
  const down = buildMoveRows(store, 1, 4);
  expect(down).toEqual({ v: 1, t: "changeRows", sheet: "t", rows: [{ id: "r1", pos: "Z" }, { id: "r4", pos: "d" }] });
  expect(walk(store, down).rows).toBe("r2 r3 r1 r4 r5");

  const up = buildMoveRows(store, 5, 3);
  expect(up).toEqual({ v: 1, t: "changeRows", sheet: "t", rows: [{ id: "r5", pos: "d" }, { id: "r3", pos: "l" }, { id: "r4", pos: "t" }] });
  expect(walk(store, up).rows).toBe("r1 r2 r5 r3 r4");

  const within = buildMoveRows(store, 2, 4);
  expect(within).toEqual({ v: 1, t: "changeRows", sheet: "t", rows: [{ id: "r2", pos: "Z" }, { id: "r4", pos: "d" }] });
  expect(walk(store, within).rows).toBe("r1 r3 r2 r4 r5");

  const column = buildMoveCols(store, "A", "D");
  expect(column).toEqual({ v: 1, t: "changeCols", sheet: "t", cols: [{ id: "ca", pos: "Z" }, { id: "cd", pos: "d" }] });
  expect(walk(store, column).cols).toBe("cb cc ca cd ce");
});

test("like copies formats and never content", () => {
  const dated = trips();
  const row = buildInsertRows(dated, 3, 1, { newId: ids("n1"), like: 1 });
  expect(row).toEqual({ v: 1, t: "insertRows", sheet: "s2", rows: [{ id: "n1", pos: "l", cells: [["ce", null, { fmt: "mmm d, yyyy" }]] }] });
  expect(walk(dated, row, ENGINE).lines).toEqual([`<tr data-id="n1" data-pos="l"><td></td><td fmt="mmm d, yyyy"></td></tr>`]);

  const store = budget();
  const bold = [["ca", null, { css: "font-weight:bold" }]];
  const header = buildInsertRows(store, 2, 2, { newId: ids("n1", "n2"), like: 1 });
  expect(header).toEqual({ v: 1, t: "insertRows", sheet: "s1", rows: [{ id: "n1", pos: "A", cells: bold }, { id: "n2", pos: "C", cells: bold }] });
  expect(header.rows[0].cells[0][2] === header.rows[1].cells[0][2]).toBe(false);
  expect(walk(store, header, ENGINE).lines).toEqual([`<tr data-id="n1" data-pos="A"><td style="font-weight:bold"></td></tr>`, `<tr data-id="n2" data-pos="C"><td style="font-weight:bold"></td></tr>`]);

  expect(apply(store, buildSetRowHeight(store, 2, 30), { derive, ...ENGINE }).out).toBe("applied");
  const tall = buildInsertRows(store, 3, 1, { newId: ids("n1"), like: 2 });
  expect(tall).toEqual({ v: 1, t: "insertRows", sheet: "s1", rows: [{ id: "n1", pos: "K", style: "height:30px" }] });
  expect(walk(store, tall, ENGINE).lines).toEqual([`<tr data-id="n1" data-pos="K" style="height:30px"></tr>`]);

  expect(buildInsertCols(budget(), "B", 1, { newId: ids("n1"), like: "B" })).toEqual({ v: 1, t: "insertCols", sheet: "s1", cols: [{ id: "n1", pos: "O", fmt: "$#,##0.00" }] });

  const column = buildInsertCols(dated, "B", 1, { newId: ids("n1"), like: "B" });
  expect(column).toEqual({
    v: 1,
    t: "insertCols",
    sheet: "s2",
    cols: [{ id: "n1", pos: "O", cells: [["r7", null, { fmt: "mmm d, yyyy" }], ["r8", null, { fmt: "$#,##0.00" }]] }],
  });
  expect(walk(dated, column, ENGINE).lines).toEqual([
    `<table grid><colgroup><col data-id="cd" data-pos="G"><col data-id="n1" data-pos="O"><col data-id="ce" data-pos="V"></colgroup>`,
    `<tr data-id="r7" data-pos="G"><td>Lisbon</td><td fmt="mmm d, yyyy"></td><td n v="46095" fmt="mmm d, yyyy">Mar 14, 2026</td></tr>`,
    `<tr data-id="r8" data-pos="V"><td>Budget left</td><td fmt="$#,##0.00"></td><td n f="=5000-Budget!B5" v="3500" fmt="$#,##0.00">$3,500.00</td></tr>`,
  ]);
});

test("like leaves out a cell the new records are covered in", () => {
  const store = budget();
  const action = buildInsertCols(store, "C", 1, { newId: ids("n1"), like: "A" });
  expect(action).toEqual({
    v: 1,
    t: "insertCols",
    sheet: "s1",
    cols: [{ id: "n1", pos: "d", width: 180, cells: [["r1", null, { css: "font-weight:bold" }], ["r5", null, { css: "font-weight:bold" }]] }],
  });
  expect(walk(store, action, ENGINE).lines).toEqual([
    `<table grid freeze-cols="1"><colgroup><col data-id="ca" data-pos="G" style="width:180px"><col data-id="cb" data-pos="V" fmt="$#,##0.00"><col data-id="n1" data-pos="d" style="width:180px"><col data-id="cc" data-pos="l" fmt="0%"></colgroup>`,
    `<tr data-id="r1" data-pos="8"><td style="font-weight:bold">Item</td><td>Cost</td><td style="font-weight:bold"></td><td>Share</td></tr>`,
    `<tr data-id="r2" data-pos="G"><td>Rent</td><td n v="1200">$1,200.00</td><td></td><td n f="=B2/B$5" v="0.8">80%</td></tr>`,
    `<tr data-id="r3" data-pos="O"><td>Food</td><td n v="300">$300.00</td><td></td><td n f="=B3/B$5" v="0.2">20%</td></tr>`,
    `<tr data-id="r5" data-pos="d"><td style="font-weight:bold">Total</td><td n f="=SUM(B2:B3)" v="1500">$1,500.00</td><td style="font-weight:bold"></td></tr>`,
    `<tr data-id="r6" data-pos="l"><td colspan="4" style="text-align:center">Prices as of November</td><td hidden></td><td hidden></td><td hidden></td></tr>`,
  ]);

  const beside = buildInsertCols(budget(), "D", 1, { newId: ids("n1"), like: "A" });
  expect(beside.cols[0].cells).toEqual([["r1", null, { css: "font-weight:bold" }], ["r5", null, { css: "font-weight:bold" }], ["r6", null, { css: "text-align:center" }]]);
});

test("an id the sheet has, or one this action has taken, is asked for again", () => {
  const rows = buildInsertRows(budget(), 3, 2, { newId: ids("r2", "n1", "n1", "ca", "n2") });
  expect(rows.rows.map((row) => row.id)).toEqual(["n1", "n2"]);
  const cols = buildInsertCols(budget(), "D", 2, { newId: ids("cb", "r1", "n1", "n1", "n2") });
  expect(cols.cols.map((col) => col.id)).toEqual(["n1", "n2"]);

  const asked = [];
  const newId = (prefix) => {
    asked.push(prefix);
    return `x${asked.length}`;
  };
  buildInsertRows(budget(), 3, 2, { newId });
  buildInsertCols(budget(), "B", 1, { newId });
  expect(asked).toEqual(["r", "r", "c"]);
});

test("a newId that keeps giving taken ids is refused after 100 tries", () => {
  expect(refusal(() => buildInsertRows(budget(), 3, 1, { newId: ids() }))).toBe("bad_action");
  expect(refusal(() => buildInsertRows(budget(), 3, 2, { newId: ids("n1") }))).toBe("bad_action");
  expect(refusal(() => buildInsertCols(budget(), "B", 1, { newId: () => "r1" }))).toBe("bad_action");
  const after = (taken) => {
    let asked = 0;
    return () => (asked++ < taken ? "r1" : "n1");
  };
  expect(buildInsertRows(budget(), 3, 1, { newId: after(99) }).rows[0].id).toBe("n1");
  expect(refusal(() => buildInsertRows(budget(), 3, 1, { newId: after(100) }))).toBe("bad_action");
});

test("a reversed range names the same records in sheet order", () => {
  expect(buildDeleteRows(budget(), "3:2")).toEqual({ v: 1, t: "deleteRows", sheet: "s1", rows: ["r2", "r3"] });
  expect(buildDeleteRows(budget(), "C3:B2")).toEqual(buildDeleteRows(budget(), "2:3"));
  expect(buildMoveRows(budget(), "3:2", 6)).toEqual(buildMoveRows(budget(), "2:3", 6));
  expect(buildSetRowHeight(budget(), "5:4", 30).rows).toEqual([{ id: "r4", height: 30 }, { id: "r5", height: 30 }]);
  expect(buildDeleteCols(budget(), "C:B")).toEqual({ v: 1, t: "deleteCols", sheet: "s1", cols: ["cb", "cc"] });
  expect(buildDeleteCols(budget(), "C3:B2")).toEqual(buildDeleteCols(budget(), "B:C"));
  expect(buildMerge(budget(), "B3:A2")).toEqual(buildMerge(budget(), "A2:B3"));
});

test("a row is named by its number, as a number or as text, and a column by its letters", () => {
  expect(buildDeleteRows(budget(), 4)).toEqual({ v: 1, t: "deleteRows", sheet: "s1", rows: ["r4"] });
  expect(buildDeleteRows(budget(), "4")).toEqual(buildDeleteRows(budget(), 4));
  expect(buildDeleteRows(budget(), "4:4")).toEqual(buildDeleteRows(budget(), 4));
  expect(buildDeleteRows(budget(), "B4")).toEqual(buildDeleteRows(budget(), 4));
  expect(buildDeleteCols(budget(), "B")).toEqual({ v: 1, t: "deleteCols", sheet: "s1", cols: ["cb"] });
  expect(buildDeleteCols(budget(), "B:B")).toEqual(buildDeleteCols(budget(), "B"));
  expect(buildDeleteCols(budget(), "B4")).toEqual(buildDeleteCols(budget(), "B"));
  expect(buildInsertRows(budget(), "3", 1, { newId: ids("n1") })).toEqual(buildInsertRows(budget(), 3, 1, { newId: ids("n1") }));
});

test("a block moved to its own place gives no action", () => {
  for (const before of [4, 3, 2]) expect(buildMoveRows(budget(), "2:3", before)).toBe(null);
  for (const before of ["C", "B"]) expect(buildMoveCols(budget(), "B", before)).toBe(null);
  expect(buildMoveRows(budget(), "2:3", 1)).toEqual({ v: 1, t: "changeRows", sheet: "s1", rows: [{ id: "r2", pos: "2" }, { id: "r3", pos: "4" }] });
  expect(buildMoveRows(budget(), "2:3", 5)).toEqual({ v: 1, t: "changeRows", sheet: "s1", rows: [{ id: "r2", pos: "X" }, { id: "r3", pos: "Z" }] });
});

test("a block moved down lands before the record the request names", () => {
  const store = budget();
  const one = buildMoveRows(store, 2, 4);
  expect(one).toEqual({ v: 1, t: "changeRows", sheet: "s1", rows: [{ id: "r2", pos: "S" }] });
  expect(walk(store, one, ENGINE)).toEqual({
    lines: [`<tr data-id="r2" data-pos="S"><td>Rent</td><td n v="1200">$1,200.00</td><td n f="=B2/B$5" v="0.8">80%</td></tr>`],
    rows: "r1 r3 r2 r4 r5 r6",
    cols: "ca cb cc",
    frozen: { rows: 1, cols: 1 },
  });

  const keys = tied();
  const column = buildMoveCols(keys, "A", "C");
  expect(column).toEqual({ v: 1, t: "changeCols", sheet: "t", cols: [{ id: "ca", pos: "Z" }, { id: "cc", pos: "d" }, { id: "cd", pos: "h" }] });
  expect(walk(keys, column).cols).toBe("cb ca cc cd ce");
});

test("a request for what the sheet already has gives no action", () => {
  expect(buildSetColWidth(budget(), "A", 180)).toBe(null);
  expect(buildSetColWidth(budget(), "B:C", null)).toBe(null);
  expect(buildSetRowHeight(budget(), "2:3", null)).toBe(null);

  const store = budget();
  expect(apply(store, buildSetRowHeight(store, 2, 30), { derive, ...ENGINE }).out).toBe("applied");
  expect(buildSetRowHeight(store, 2, 30)).toBe(null);
  expect(buildSetRowHeight(store, "2:3", 30)).toEqual({ v: 1, t: "changeRows", sheet: "s1", rows: [{ id: "r3", height: 30 }] });
  expect(buildSetRowHeight(store, "2:3", null)).toEqual({ v: 1, t: "changeRows", sheet: "s1", rows: [{ id: "r2", height: null }] });

  expect(buildFreeze(budget(), { rows: 1 })).toBe(null);
  expect(buildFreeze(budget(), { rows: 1, cols: 1 })).toBe(null);
  expect(buildFreeze(trips(), { rows: 0, cols: 0 })).toBe(null);
  expect(buildFreeze(budget(), { rows: 1, cols: 2 })).toEqual({ v: 1, t: "freeze", sheet: "s1", colsThrough: "cb" });
  expect(buildFreeze(budget(), { rows: 0, cols: 1 })).toEqual({ v: 1, t: "freeze", sheet: "s1", rowsThrough: null });
});

test("a merge names every other cell in it that holds something", () => {
  for (const [table, area] of [[budget, "A2:B3"], [budget, "A5:C6"], [budget, "A1:C5"], [merged, "A1:D3"], [merged, "A2:D4"]]) {
    const store = table();
    const action = buildMerge(store, area);
    expect(action.clears.length > 0).toBe(true);
    expect(action.clears).toEqual(clearsOf(store, action.from, action.to));
  }
  const store = budget();
  const grown = buildMerge(store, "A5:C6");
  expect(grown.clears).toEqual([["r5", "cb"], ["r6", "ca"]]);
  expect(walk(store, grown, ENGINE).lines).toEqual([
    `<tr data-id="r5" data-pos="d"><td colspan="3" rowspan="2" style="font-weight:bold">Total</td><td hidden></td><td hidden></td></tr>`,
    `<tr data-id="r6" data-pos="l"><td hidden></td><td hidden></td><td hidden></td></tr>`,
  ]);
});

test("a request that names nothing to write gives no action", () => {
  expect(buildMerge(budget(), "A2")).toBe(null);
  expect(buildMerge(budget(), "A6:C6")).toBe(null);
  expect(buildMerge(merged(), "A2:A3")).toBe(null);
  expect(buildUnmerge(budget(), "A2")).toBe(null);
  expect(buildFreeze(budget(), {})).toBe(null);
  expect(buildFreeze(budget())).toBe(null);
});

test("a count at the limit builds and one more is refused", () => {
  expect(buildInsertRows(budget(), 7, GROW_ROWS, { newId: counter() }).rows.length).toBe(10000);
  expect(refusal(() => buildInsertRows(budget(), 7, GROW_ROWS + 1, { newId: counter() }))).toBe("too_large");
  expect(buildInsertCols(budget(), "D", GROW_COLS, { newId: counter() }).cols.length).toBe(1000);
  expect(refusal(() => buildInsertCols(budget(), "D", GROW_COLS + 1, { newId: counter() }))).toBe("too_large");
});

test("a request past the sheet's last row or column is refused", () => {
  const past = [
    () => buildInsertRows(budget(), 8, 1, { newId: counter() }),
    () => buildInsertCols(budget(), "E", 1, { newId: counter() }),
    () => buildInsertRows(budget(), 3, 1, { newId: counter(), like: 7 }),
    () => buildDeleteRows(budget(), 7),
    () => buildDeleteRows(budget(), "6:7"),
    () => buildDeleteCols(budget(), "D"),
    () => buildMoveRows(budget(), 2, 8),
    () => buildMoveRows(budget(), 7, 1),
    () => buildMoveCols(budget(), "A", "E"),
    () => buildSetRowHeight(budget(), 7, 30),
    () => buildSetColWidth(budget(), "D", 30),
    () => buildMerge(budget(), "A6:D6"),
    () => buildUnmerge(budget(), "A7"),
    () => buildUnmerge(budget(), "D1"),
    () => buildFreeze(budget(), { rows: 7 }),
    () => buildFreeze(budget(), { cols: 4 }),
    () => buildFreeze(budget(), { rows: 1, cols: 4 }),
  ];
  expect(past.map(refusal)).toEqual(past.map(() => "outside_sheet"));
});

test("a request the builders cannot read is refused with a code", () => {
  const bad = [
    () => buildInsertRows(budget(), 3, 0, { newId: counter() }),
    () => buildInsertRows(budget(), 3, 1.5, { newId: counter() }),
    () => buildInsertRows(budget(), 3, "2", { newId: counter() }),
    () => buildInsertRows(budget(), 0, 1, { newId: counter() }),
    () => buildInsertRows(budget(), "B", 1, { newId: counter() }),
    () => buildInsertRows(budget(), "2:3", 1, { newId: counter() }),
    () => buildInsertCols(budget(), 2, 1, { newId: counter() }),
    () => buildInsertRows(budget(), 3, 1, { newId: counter(), like: "B:C" }),
    () => buildDeleteRows(budget(), "B:C"),
    () => buildDeleteCols(budget(), "2:3"),
    () => buildMoveRows(budget(), "A:B", 1),
    () => buildMoveRows(budget(), 2, "B"),
    () => buildSetRowHeight(budget(), "A:A", 30),
    () => buildSetColWidth(budget(), "1:1", 30),
    () => buildFreeze(budget(), { rows: -1 }),
    () => buildFreeze(budget(), { rows: "2" }),
    () => buildFreeze(budget(), { cols: 1.5 }),
  ];
  expect(bad.map(refusal)).toEqual(bad.map(() => "bad_action"));

  const unread = [
    () => buildDeleteRows(budget(), "B"),
    () => buildDeleteRows(budget(), 0),
    () => buildDeleteRows(budget(), [4]),
    () => buildDeleteCols(budget(), 4),
    () => buildMerge(budget(), "A:5"),
    () => buildUnmerge(budget(), "A6:C6"),
    () => buildUnmerge(budget(), 6),
  ];
  expect(unread.map(refusal)).toEqual(unread.map(() => "bad_range"));
});

test("the reducer's rules stay the reducer's: a builder builds, the reducer refuses", () => {
  const refused = (store, action, options) => apply(store, action, { derive, ...options }).code;
  const sums = budget();
  expect(refused(sums, buildInsertRows(sums, 3, 1, { newId: ids("n1") }))).toBe("needs_formula_engine");
  expect(refused(sums, buildMerge(sums, "A1:B2"), ENGINE)).toBe("merge_cut");
  expect(refused(sums, buildMoveCols(sums, "C", "A"), ENGINE)).toBe("merge_cut");
  expect(refused(sums, buildSetRowHeight(sums, 2, 0), ENGINE)).toBe("bad_action");
  const boxes = merged();
  expect(refused(boxes, buildMoveRows(boxes, 2, 5))).toBe("merge_cut");
  expect(refused(boxes, buildFreeze(boxes, { rows: 2 }))).toBe("merge_cut");
  expect(refused(boxes, buildMerge(boxes, "B1:B2"))).toBe("merge_overlap");
});
