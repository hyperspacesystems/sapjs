import { colName } from "../../src/grid/a1.js";
import { buildClear, buildColumnFormat, buildFormat, buildImport, buildSet, buildSetRange, GROW_COLS, GROW_ROWS } from "../../src/grid/build.js";
import { tableHtml } from "../../src/grid/codec/write.js";
import { derive } from "../../src/grid/content.js";
import { apply } from "../../src/grid/ops.js";
import { budget, counter, ids, refusal, trips, walk } from "./support/build-fixture.js";

const LINE = "1px solid #333333";
const ALL = { "border-top": LINE, "border-right": LINE, "border-bottom": LINE, "border-left": LINE };

const PINS = [
  [
    "a number into a currency column",
    budget,
    (view) => buildSet(view, "B2", 450),
    { v: 1, t: "set", sheet: "s1", cells: [["r2", "cb", 450]] },
    [`<tr data-id="r2" data-pos="G"><td>Rent</td><td n v="450">$450.00</td><td n f="=B2/B$5" v="0.8">80%</td></tr>`],
  ],
  [
    "a cell with a format and a style, a border written as its four sides",
    budget,
    (view) => buildSet(view, "A4", "Gas", { fmt: "@", style: { "font-weight": "bold", border: LINE } }),
    { v: 1, t: "set", sheet: "s1", cells: [["r4", "ca", "Gas", { fmt: "@", style: { "font-weight": "bold", ...ALL } }]] },
    [`<tr data-id="r4" data-pos="V"><td fmt="@" style="font-weight:bold;border:1px solid #333333">Gas</td></tr>`],
  ],
  [
    "null clears a cell that holds content",
    budget,
    (view) => buildSet(view, "B2", null),
    { v: 1, t: "set", sheet: "s1", cells: [["r2", "cb", null]] },
    [`<tr data-id="r2" data-pos="G"><td>Rent</td><td></td><td n f="=B2/B$5" v="0.8">80%</td></tr>`],
  ],
  [
    "a block: items with a format, a short row and a skipped item",
    budget,
    (view) => buildSetRange(view, "A2", [["Rent", 1250], [null, { content: 0.5, fmt: "0.0%" }], [undefined, null, "note"]]),
    { v: 1, t: "set", sheet: "s1", cells: [["r2", "ca", "Rent"], ["r2", "cb", 1250], ["r3", "ca", null], ["r3", "cb", 0.5, { fmt: "0.0%" }], ["r4", "cc", "note"]] },
    [
      `<tr data-id="r2" data-pos="G"><td>Rent</td><td n v="1250">$1,250.00</td><td n f="=B2/B$5" v="0.8">80%</td></tr>`,
      `<tr data-id="r3" data-pos="O"><td></td><td n v="0.5" fmt="0.0%">50.0%</td><td n f="=B3/B$5" v="0.2">20%</td></tr>`,
      `<tr data-id="r4" data-pos="V"><td></td><td></td><td>note</td></tr>`,
    ],
  ],
  [
    "grow brings the rows a cell needs, with keys after the last row",
    budget,
    (view) => buildSet(view, "B8", 5, { grow: true, newId: ids("n1", "n2") }),
    { v: 1, t: "set", sheet: "s1", rows: [{ id: "n1", pos: "p" }, { id: "n2", pos: "t" }], cells: [["n2", "cb", 5]] },
    [`<tr data-id="n1" data-pos="p"></tr>`, `<tr data-id="n2" data-pos="t"><td></td><td n v="5">$5.00</td></tr>`],
  ],
  [
    "grow brings rows and columns for a block",
    trips,
    (view) => buildSetRange(view, "B3", [[46100, "x"], [null, "y"]], { grow: true, newId: ids("ra", "rb", "cx") }),
    {
      v: 1,
      t: "set",
      sheet: "s2",
      rows: [{ id: "ra", pos: "d" }, { id: "rb", pos: "l" }],
      cols: [{ id: "cx", pos: "l" }],
      cells: [["ra", "ce", 46100], ["ra", "cx", "x"], ["rb", "cx", "y"]],
    },
    [
      `<table grid><colgroup><col data-id="cd" data-pos="G"><col data-id="ce" data-pos="V"><col data-id="cx" data-pos="l"></colgroup>`,
      `<tr data-id="ra" data-pos="d"><td></td><td n>46100</td><td>x</td></tr>`,
      `<tr data-id="rb" data-pos="l"><td></td><td></td><td>y</td></tr>`,
    ],
  ],
  [
    "clear names only the cells that hold content",
    budget,
    (view) => buildClear(view, "A2:C4"),
    { v: 1, t: "set", sheet: "s1", cells: [["r2", "ca", null], ["r2", "cb", null], ["r2", "cc", null], ["r3", "ca", null], ["r3", "cb", null], ["r3", "cc", null]] },
    [`<tr data-id="r2" data-pos="G"></tr>`, `<tr data-id="r3" data-pos="O"></tr>`],
  ],
  [
    "clear on a merge empties the anchor and keeps its span and style",
    budget,
    (view) => buildClear(view, "A6:C6"),
    { v: 1, t: "set", sheet: "s1", cells: [["r6", "ca", null]] },
    [`<tr data-id="r6" data-pos="l"><td colspan="3" style="text-align:center"></td><td hidden></td><td hidden></td></tr>`],
  ],
  [
    "clear on a whole column",
    budget,
    (view) => buildClear(view, "B:B"),
    { v: 1, t: "set", sheet: "s1", cells: [["r1", "cb", null], ["r2", "cb", null], ["r3", "cb", null], ["r5", "cb", null]] },
    [
      `<tr data-id="r1" data-pos="8"><td style="font-weight:bold">Item</td><td></td><td>Share</td></tr>`,
      `<tr data-id="r2" data-pos="G"><td>Rent</td><td></td><td n f="=B2/B$5" v="0.8">80%</td></tr>`,
      `<tr data-id="r3" data-pos="O"><td>Food</td><td></td><td n f="=B3/B$5" v="0.2">20%</td></tr>`,
      `<tr data-id="r5" data-pos="d"><td style="font-weight:bold">Total</td></tr>`,
    ],
  ],
  [
    "a format and a style on a rectangle",
    budget,
    (view) => buildFormat(view, "B2:C3", { fmt: "0.00", style: { "font-weight": "bold" } }),
    {
      v: 1,
      t: "format",
      sheet: "s1",
      cells: ["r2/cb", "r2/cc", "r3/cb", "r3/cc"].map((at) => [...at.split("/"), { fmt: "0.00", style: { "font-weight": "bold" } }]),
    },
    [
      `<tr data-id="r2" data-pos="G"><td>Rent</td><td n v="1200" fmt="0.00" style="font-weight:bold">1200.00</td><td n f="=B2/B$5" v="0.8" fmt="0.00" style="font-weight:bold">0.80</td></tr>`,
      `<tr data-id="r3" data-pos="O"><td>Food</td><td n v="300" fmt="0.00" style="font-weight:bold">300.00</td><td n f="=B3/B$5" v="0.2" fmt="0.00" style="font-weight:bold">0.20</td></tr>`,
    ],
  ],
  [
    "fmt null removes each cell's own format",
    trips,
    (view) => buildFormat(view, "B1:B2", { fmt: null }),
    { v: 1, t: "format", sheet: "s2", cells: [["r7", "ce", { fmt: null }], ["r8", "ce", { fmt: null }]] },
    [`<tr data-id="r7" data-pos="G"><td>Lisbon</td><td n>46095</td></tr>`, `<tr data-id="r8" data-pos="V"><td>Budget left</td><td n f="=5000-Budget!B5">3500</td></tr>`],
  ],
  [
    "the all preset writes four sides on every cell",
    budget,
    (view) => buildFormat(view, "A2:B3", { border: { preset: "all", line: LINE } }),
    { v: 1, t: "format", sheet: "s1", cells: ["r2/ca", "r2/cb", "r3/ca", "r3/cb"].map((at) => [...at.split("/"), { style: ALL }]) },
    [
      `<tr data-id="r2" data-pos="G"><td style="border:1px solid #333333">Rent</td><td n v="1200" style="border:1px solid #333333">$1,200.00</td><td n f="=B2/B$5" v="0.8">80%</td></tr>`,
      `<tr data-id="r3" data-pos="O"><td style="border:1px solid #333333">Food</td><td n v="300" style="border:1px solid #333333">$300.00</td><td n f="=B3/B$5" v="0.2">20%</td></tr>`,
    ],
  ],
  [
    "the outer preset writes the edge sides on the cells along each edge",
    budget,
    (view) => buildFormat(view, "A2:C4", { border: { preset: "outer", line: LINE } }),
    {
      v: 1,
      t: "format",
      sheet: "s1",
      cells: [
        ["r2", "ca", { style: { "border-top": LINE, "border-left": LINE } }],
        ["r2", "cb", { style: { "border-top": LINE } }],
        ["r2", "cc", { style: { "border-top": LINE, "border-right": LINE } }],
        ["r3", "ca", { style: { "border-left": LINE } }],
        ["r3", "cc", { style: { "border-right": LINE } }],
        ["r4", "ca", { style: { "border-bottom": LINE, "border-left": LINE } }],
        ["r4", "cb", { style: { "border-bottom": LINE } }],
        ["r4", "cc", { style: { "border-right": LINE, "border-bottom": LINE } }],
      ],
    },
    [
      `<tr data-id="r2" data-pos="G"><td style="border-top:1px solid #333333;border-left:1px solid #333333">Rent</td><td n v="1200" style="border-top:1px solid #333333">$1,200.00</td><td n f="=B2/B$5" v="0.8" style="border-top:1px solid #333333;border-right:1px solid #333333">80%</td></tr>`,
      `<tr data-id="r3" data-pos="O"><td style="border-left:1px solid #333333">Food</td><td n v="300">$300.00</td><td n f="=B3/B$5" v="0.2" style="border-right:1px solid #333333">20%</td></tr>`,
      `<tr data-id="r4" data-pos="V"><td style="border-bottom:1px solid #333333;border-left:1px solid #333333"></td><td style="border-bottom:1px solid #333333"></td><td style="border-right:1px solid #333333;border-bottom:1px solid #333333"></td></tr>`,
    ],
  ],
  [
    "the inner preset writes the right and bottom sides between cells",
    budget,
    (view) => buildFormat(view, "A2:C4", { border: { preset: "inner", line: LINE } }),
    {
      v: 1,
      t: "format",
      sheet: "s1",
      cells: [
        ["r2", "ca", { style: { "border-right": LINE, "border-bottom": LINE } }],
        ["r2", "cb", { style: { "border-right": LINE, "border-bottom": LINE } }],
        ["r2", "cc", { style: { "border-bottom": LINE } }],
        ["r3", "ca", { style: { "border-right": LINE, "border-bottom": LINE } }],
        ["r3", "cb", { style: { "border-right": LINE, "border-bottom": LINE } }],
        ["r3", "cc", { style: { "border-bottom": LINE } }],
        ["r4", "ca", { style: { "border-right": LINE } }],
        ["r4", "cb", { style: { "border-right": LINE } }],
      ],
    },
    [
      `<tr data-id="r2" data-pos="G"><td style="border-right:1px solid #333333;border-bottom:1px solid #333333">Rent</td><td n v="1200" style="border-right:1px solid #333333;border-bottom:1px solid #333333">$1,200.00</td><td n f="=B2/B$5" v="0.8" style="border-bottom:1px solid #333333">80%</td></tr>`,
      `<tr data-id="r3" data-pos="O"><td style="border-right:1px solid #333333;border-bottom:1px solid #333333">Food</td><td n v="300" style="border-right:1px solid #333333;border-bottom:1px solid #333333">$300.00</td><td n f="=B3/B$5" v="0.2" style="border-bottom:1px solid #333333">20%</td></tr>`,
      `<tr data-id="r4" data-pos="V"><td style="border-right:1px solid #333333"></td><td style="border-right:1px solid #333333"></td></tr>`,
    ],
  ],
  [
    "a column format with no cell format to clear is one changeCols",
    budget,
    (view) => buildColumnFormat(view, "A:A", "@"),
    { v: 1, t: "changeCols", sheet: "s1", cols: [{ id: "ca", fmt: "@" }] },
    [`<table grid freeze-cols="1"><colgroup><col data-id="ca" data-pos="G" fmt="@" style="width:180px"><col data-id="cb" data-pos="V" fmt="$#,##0.00"><col data-id="cc" data-pos="l" fmt="0%"></colgroup>`],
  ],
  [
    "a format on whole columns is the column format, with the style on every cell",
    trips,
    (view) => buildFormat(view, "B:B", { fmt: "0.00", style: { "font-style": "italic" } }),
    {
      v: 1,
      t: "batch",
      actions: [
        { v: 1, t: "changeCols", sheet: "s2", cols: [{ id: "ce", fmt: "0.00" }] },
        { v: 1, t: "format", sheet: "s2", cells: [["r7", "ce", { fmt: null, style: { "font-style": "italic" } }], ["r8", "ce", { fmt: null, style: { "font-style": "italic" } }]] },
      ],
    },
    [
      `<table grid><colgroup><col data-id="cd" data-pos="G"><col data-id="ce" data-pos="V" fmt="0.00"></colgroup>`,
      `<tr data-id="r7" data-pos="G"><td>Lisbon</td><td n v="46095" style="font-style:italic">46095.00</td></tr>`,
      `<tr data-id="r8" data-pos="V"><td>Budget left</td><td n f="=5000-Budget!B5" v="3500" style="font-style:italic">3500.00</td></tr>`,
    ],
  ],
  [
    "a column format of null on a column with no format removes each cell's own",
    trips,
    (view) => buildColumnFormat(view, "B:B", null),
    { v: 1, t: "format", sheet: "s2", cells: [["r7", "ce", { fmt: null }], ["r8", "ce", { fmt: null }]] },
    [`<tr data-id="r7" data-pos="G"><td>Lisbon</td><td n>46095</td></tr>`, `<tr data-id="r8" data-pos="V"><td>Budget left</td><td n f="=5000-Budget!B5">3500</td></tr>`],
  ],
];

for (const [name, table, build, action, lines] of PINS) {
  test(`pinned: ${name}`, () => {
    const store = table();
    const before = tableHtml(store.sheet);
    const built = build(store);
    expect(tableHtml(store.sheet)).toBe(before);
    expect(built).toEqual(action);
    expect(walk(store, built).lines).toEqual(lines);
  });
}

test("a whole column format clears each cell's own format in the same batch", () => {
  const store = trips();
  const action = buildColumnFormat(store, "B:B", "0.00");
  expect(action).toEqual({
    v: 1,
    t: "batch",
    actions: [
      { v: 1, t: "changeCols", sheet: "s2", cols: [{ id: "ce", fmt: "0.00" }] },
      { v: 1, t: "format", sheet: "s2", cells: [["r7", "ce", { fmt: null }], ["r8", "ce", { fmt: null }]] },
    ],
  });
  expect(walk(store, action).lines).toEqual([
    `<table grid><colgroup><col data-id="cd" data-pos="G"><col data-id="ce" data-pos="V" fmt="0.00"></colgroup>`,
    `<tr data-id="r7" data-pos="G"><td>Lisbon</td><td n v="46095">46095.00</td></tr>`,
    `<tr data-id="r8" data-pos="V"><td>Budget left</td><td n f="=5000-Budget!B5" v="3500">3500.00</td></tr>`,
  ]);
  expect(refusal(() => buildColumnFormat(trips(), "B2", "0%"))).toBe("bad_action");
  expect(refusal(() => buildColumnFormat(trips(), "1:2", "0%"))).toBe("bad_action");
});

test("a block past the last row or column is refused without grow", () => {
  expect(refusal(() => buildSet(budget(), "A7", 1))).toBe("outside_sheet");
  expect(refusal(() => buildSet(budget(), "D1", 1))).toBe("outside_sheet");
  expect(refusal(() => buildSetRange(budget(), "A6", [["a"], ["b"]]))).toBe("outside_sheet");
  expect(refusal(() => buildSetRange(budget(), "C1", [["a", "b"]], { grow: false }))).toBe("outside_sheet");
});

test("an area past the last row or column is refused", () => {
  expect(refusal(() => buildClear(budget(), "A7"))).toBe("outside_sheet");
  expect(refusal(() => buildClear(budget(), "B:D"))).toBe("outside_sheet");
  expect(refusal(() => buildClear(budget(), "6:7"))).toBe("outside_sheet");
  expect(refusal(() => buildFormat(budget(), "A1:D2", { fmt: "0%" }))).toBe("outside_sheet");
  expect(refusal(() => buildColumnFormat(budget(), "C:D", "0%"))).toBe("outside_sheet");
});

test("grow stops at 10,000 new rows and 1,000 new columns", () => {
  expect([GROW_ROWS, GROW_COLS]).toEqual([10000, 1000]);
  const most = buildSet(budget(), "A10006", 1, { grow: true, newId: counter() });
  expect(most.rows.length).toBe(10000);
  expect(most.cells).toEqual([["g9999", "ca", 1]]);
  expect(refusal(() => buildSet(budget(), "A10007", 1, { grow: true, newId: counter() }))).toBe("too_large");
  expect(refusal(() => buildImport(budget(), "A10007", [["x"]], { newId: counter() }))).toBe("too_large");
  const widest = buildSet(budget(), `${colName(3 + 999)}1`, 1, { grow: true, newId: counter() });
  expect(widest.cols.length).toBe(1000);
  expect(refusal(() => buildSet(budget(), `${colName(3 + 1000)}1`, 1, { grow: true, newId: counter() }))).toBe("too_large");
});

test("grown rows and columns sort after the last ones", () => {
  const most = buildSet(budget(), "A10006", 1, { grow: true, newId: counter() });
  const keys = ["l", ...most.rows.map((row) => row.pos)];
  expect(keys.every((key, i) => i === 0 || keys[i - 1] < key)).toBe(true);
  expect(new Set(most.rows.map((row) => row.id)).size).toBe(10000);
});

test("an import grows the sheet and writes a formula as text unless the caller allows formulas", () => {
  const store = budget();
  const action = buildImport(store, "A7", [["Gas", 40, { f: "=B7/B$5" }], ["Water", 25]], { newId: ids("i1", "i2") });
  expect(action).toEqual({
    v: 1,
    t: "set",
    sheet: "s1",
    rows: [{ id: "i1", pos: "p" }, { id: "i2", pos: "t" }],
    cells: [["i1", "ca", "Gas"], ["i1", "cb", 40], ["i1", "cc", "=B7/B$5"], ["i2", "ca", "Water"], ["i2", "cb", 25]],
  });
  expect(walk(store, action).lines).toEqual([
    `<tr data-id="i1" data-pos="p"><td>Gas</td><td n v="40">$40.00</td><td>=B7/B$5</td></tr>`,
    `<tr data-id="i2" data-pos="t"><td>Water</td><td n v="25">$25.00</td></tr>`,
  ]);

  const allowed = budget();
  const kept = buildImport(allowed, "A7", [["Gas", { f: "=1+1" }]], { formulas: true, newId: ids("i1") });
  expect(kept).toEqual({ v: 1, t: "set", sheet: "s1", rows: [{ id: "i1", pos: "t" }], cells: [["i1", "ca", "Gas"], ["i1", "cb", { f: "=1+1" }]] });
  expect(walk(allowed, kept).lines).toEqual([
    `<table grid freeze-cols="1" stale><colgroup><col data-id="ca" data-pos="G" style="width:180px"><col data-id="cb" data-pos="V" fmt="$#,##0.00"><col data-id="cc" data-pos="l" fmt="0%"></colgroup>`,
    `<tr data-id="i1" data-pos="t"><td>Gas</td><td f="=1+1"></td></tr>`,
  ]);

  expect(buildSetRange(budget(), "A4", [[{ f: "=1+1" }]]).cells).toEqual([["r4", "ca", { f: "=1+1" }]]);
  expect(buildSetRange(budget(), "A4", [[{ f: "=1+1" }]], { formulas: false }).cells).toEqual([["r4", "ca", "=1+1"]]);
});

test("an empty item over an empty or covered cell is left out", () => {
  const store = budget();
  const action = buildSetRange(store, "A6", [["Note", null, null]]);
  expect(action).toEqual({ v: 1, t: "set", sheet: "s1", cells: [["r6", "ca", "Note"]] });
  expect(walk(store, action).lines).toEqual([`<tr data-id="r6" data-pos="l"><td colspan="3" style="text-align:center">Note</td><td hidden></td><td hidden></td></tr>`]);

  const covered = budget();
  const refused = apply(covered, buildSetRange(covered, "A6", [["Note", "x"]]), { derive });
  expect([refused.out, refused.code]).toEqual(["refused", "covered_cell"]);
});

test("empty text in a block is no content", () => {
  const store = budget();
  const action = buildSetRange(store, "A6", [["Note", "", ""]]);
  expect(action).toEqual({ v: 1, t: "set", sheet: "s1", cells: [["r6", "ca", "Note"]] });
  expect(walk(store, action).lines).toEqual([`<tr data-id="r6" data-pos="l"><td colspan="3" style="text-align:center">Note</td><td hidden></td><td hidden></td></tr>`]);

  expect(buildSet(budget(), "A4", "")).toBe(null);
  expect(buildSet(budget(), "B2", "")).toEqual(buildSet(budget(), "B2", null));
  expect(buildSetRange(budget(), "A4", [[{ f: "" }]], { formulas: false })).toBe(null);
  expect(buildImport(budget(), "A7", [["", ""], ["x", ""]], { newId: ids("i1", "i2") })).toEqual({
    v: 1,
    t: "set",
    sheet: "s1",
    rows: [{ id: "i1", pos: "p" }, { id: "i2", pos: "t" }],
    cells: [["i2", "ca", "x"]],
  });
});

test("a block item's format equal to its column's is not written", () => {
  const store = budget();
  const action = buildSet(store, "C4", 0.25, { fmt: "0%" });
  expect(action).toEqual({ v: 1, t: "set", sheet: "s1", cells: [["r4", "cc", 0.25]] });
  expect(walk(store, action).lines).toEqual([`<tr data-id="r4" data-pos="V"><td></td><td></td><td n v="0.25">25%</td></tr>`]);

  expect(buildSetRange(budget(), "B2", [[{ content: 5, fmt: "$#,##0.00" }, { content: 0.5, fmt: "0.0%" }]]).cells).toEqual([["r2", "cb", 5], ["r2", "cc", 0.5, { fmt: "0.0%" }]]);
  expect(buildImport(budget(), "B7", [[{ content: 7, fmt: "$#,##0.00" }]], { newId: ids("i1") }).cells).toEqual([["i1", "cb", 7]]);
  expect(buildSet(budget(), "D1", 1, { fmt: "0%", grow: true, newId: ids("n1") }).cells).toEqual([["r1", "n1", 1, { fmt: "0%" }]]);

  expect(apply(store, buildSet(store, "C4", 0.25, { fmt: "0.0%" }), { derive }).out).toBe("applied");
  expect(buildSet(store, "C4", 0.5, { fmt: "0.0%" }).cells).toEqual([["r4", "cc", 0.5]]);
  const back = buildSet(store, "C4", 0.5, { fmt: "0%" });
  expect(back.cells).toEqual([["r4", "cc", 0.5, { fmt: null }]]);
  expect(walk(store, back).lines).toEqual([`<tr data-id="r4" data-pos="V"><td></td><td></td><td n v="0.5">50%</td></tr>`]);
});

test("a request for what the sheet already has gives no action", () => {
  expect(buildColumnFormat(budget(), "B:B", "$#,##0.00")).toBe(null);
  expect(buildColumnFormat(budget(), "A:A", null)).toBe(null);
  expect(buildColumnFormat(budget(), "B:C", "0%")).toEqual({ v: 1, t: "changeCols", sheet: "s1", cols: [{ id: "cb", fmt: "0%" }] });
  expect(buildSetRange(budget(), "C4", [[{ content: null, fmt: "0%" }]])).toBe(null);
  expect(buildSet(budget(), "A4", null, { fmt: null, style: { color: null } })).toBe(null);

  expect(buildFormat(budget(), "A1:C6", { border: { preset: "none" } })).toBe(null);
  expect(buildFormat(budget(), "A2:B3", { style: { color: null, "background-color": null } })).toBe(null);
  expect(buildFormat(budget(), "A1:B3", { style: { color: null, "font-weight": null } })).toEqual({ v: 1, t: "format", sheet: "s1", cells: [["r1", "ca", { style: { "font-weight": null } }]] });

  const store = budget();
  expect(apply(store, buildFormat(store, "A2:B3", { border: { preset: "all", line: LINE } }), { derive }).out).toBe("applied");
  const none = buildFormat(store, "A1:C4", { border: { preset: "none" } });
  expect(none.cells.map(([row, col]) => `${row}/${col}`)).toEqual(["r2/ca", "r2/cb", "r3/ca", "r3/cb"]);
});

test("a request that names nothing to write gives no action", () => {
  expect(buildSet(budget(), "A4", null)).toBe(null);
  expect(buildSetRange(budget(), "A4", [[null, null], []])).toBe(null);
  expect(buildSetRange(budget(), "A9", [[null]], { grow: true, newId: counter() })).toBe(null);
  expect(buildClear(budget(), "4:4")).toBe(null);
  expect(buildClear(budget(), "B6:C6")).toBe(null);
  expect(buildFormat(budget(), "A2:B3", {})).toBe(null);
  expect(buildFormat(budget(), "B6:C6", { fmt: "0%", style: { color: "#333333" } })).toBe(null);
});

test("a format skips a merge's covered cells, and an outer border on a merged cell is on its anchor", () => {
  const store = budget();
  const action = buildFormat(store, "A6:C6", { border: { preset: "outer", line: LINE } });
  expect(action).toEqual({ v: 1, t: "format", sheet: "s1", cells: [["r6", "ca", { style: ALL }]] });
  expect(walk(store, action).lines).toEqual([
    `<tr data-id="r6" data-pos="l"><td colspan="3" style="text-align:center;border:1px solid #333333">Prices as of November</td><td hidden></td><td hidden></td></tr>`,
  ]);
});

test("the one edge presets write one side along that edge, and none removes all four", () => {
  const sides = (preset) => buildFormat(budget(), "A2:C4", { border: { preset, line: LINE } }).cells.map(([row, col, extra]) => [`${row}/${col}`, extra.style]);
  expect(sides("top")).toEqual(["r2/ca", "r2/cb", "r2/cc"].map((at) => [at, { "border-top": LINE }]));
  expect(sides("bottom")).toEqual(["r4/ca", "r4/cb", "r4/cc"].map((at) => [at, { "border-bottom": LINE }]));
  expect(sides("left")).toEqual(["r2/ca", "r3/ca", "r4/ca"].map((at) => [at, { "border-left": LINE }]));
  expect(sides("right")).toEqual(["r2/cc", "r3/cc", "r4/cc"].map((at) => [at, { "border-right": LINE }]));

  const store = budget();
  const start = tableHtml(store.sheet);
  expect(apply(store, buildFormat(store, "A2:B3", { border: { preset: "all", line: LINE } }), { derive }).out).toBe("applied");
  const none = buildFormat(store, "A2:B3", { border: { preset: "none" } });
  expect(none.cells[0]).toEqual(["r2", "ca", { style: { "border-top": null, "border-right": null, "border-bottom": null, "border-left": null } }]);
  expect(apply(store, none, { derive }).out).toBe("applied");
  expect(tableHtml(store.sheet)).toBe(start);
});

test("a format equal to the column's is not written on a cell", () => {
  const store = budget();
  expect(buildFormat(store, "B2:B4", { fmt: "$#,##0.00" })).toBe(null);
  expect(apply(store, buildFormat(store, "B2", { fmt: "0.00" }), { derive }).out).toBe("applied");
  const action = buildFormat(store, "B2:B3", { fmt: "$#,##0.00" });
  expect(action).toEqual({ v: 1, t: "format", sheet: "s1", cells: [["r2", "cb", { fmt: null }]] });
  expect(walk(store, action).lines).toEqual([`<tr data-id="r2" data-pos="G"><td>Rent</td><td n v="1200">$1,200.00</td><td n f="=B2/B$5" v="0.8">80%</td></tr>`]);
});

test("an area names the same cells whichever corner is written first", () => {
  expect(buildClear(budget(), "C3:A2")).toEqual(buildClear(budget(), "A2:C3"));
  expect(buildClear(budget(), "A3:C2")).toEqual(buildClear(budget(), "A2:C3"));
  expect(buildClear(budget(), "3:2")).toEqual(buildClear(budget(), "2:3"));
  expect(buildColumnFormat(budget(), "C:B", "0.00")).toEqual(buildColumnFormat(budget(), "B:C", "0.00"));
});

test("a request the builders cannot read is refused with a code", () => {
  for (const area of ["A:5", "b2", "A1:B2:C3", "", 7, null]) expect(refusal(() => buildClear(budget(), area))).toBe("bad_range");
  expect(refusal(() => buildSet(budget(), "A1:B2", 1))).toBe("bad_range");
  expect(refusal(() => buildSetRange(budget(), "A1", "x"))).toBe("bad_action");
  expect(refusal(() => buildSetRange(budget(), "A1", ["x"]))).toBe("bad_action");
  expect(refusal(() => buildSet(budget(), "A1", 1, { style: "color:red" }))).toBe("bad_action");
  expect(refusal(() => buildFormat(budget(), "A1", { style: null }))).toBe("bad_action");
  expect(refusal(() => buildFormat(budget(), "A1", { border: "all" }))).toBe("bad_action");
  expect(refusal(() => buildFormat(budget(), "A1", { border: { preset: "thick", line: LINE } }))).toBe("bad_action");
  expect(refusal(() => buildFormat(budget(), "A1", { border: { preset: "all" } }))).toBe("bad_action");
});

test("a view with no sheet id builds for the sheet with the empty id", () => {
  const store = budget(null);
  const action = buildSet(store, "A2", "x");
  expect(action.sheet).toBe("");
  expect(apply(store, action, { derive }).out).toBe("applied");
});
