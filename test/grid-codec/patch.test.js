import { FIXTURES } from "./support/fixtures.js";
import { tableHtml } from "../../src/grid/codec/write.js";
import { patchGrid } from "../../src/grid/codec/patch.js";
import { gridModel, QueryRefused } from "../../src/grid/codec/read.js";
import { CodecMiss } from "../../src/grid/codec/scan.js";

const tinySrc = () => tableHtml(FIXTURES.tiny().sheets[0]);
const ids = () => { let n = 0; return () => `new${n++}`; };

const WORKED = [
  '<table grid freeze-cols="1" stale><colgroup><col data-id="ca" data-pos="G" style="width:180px"><col data-id="cb" data-pos="V" fmt="$#,##0.00"><col data-id="cc" data-pos="l" fmt="0%"></colgroup>',
  "<thead>",
  '<tr data-id="r1" data-pos="8"><td style="font-weight:bold">Item</td><td>Cost</td><td>Share</td></tr>',
  "</thead><tbody>",
  '<tr data-id="r2" data-pos="G"><td>Rent</td><td n v="1200">$1,200.00</td><td n f="=B2/B$5" v="0.8">80%</td></tr>',
  '<tr data-id="r3" data-pos="O"><td>Food</td><td n>450</td><td n f="=B3/B$5" v="0.2">20%</td></tr>',
  '<tr data-id="r4" data-pos="V"><td>02134</td><td f="=A2"></td></tr>',
  '<tr data-id="r5" data-pos="d"><td style="font-weight:bold">Total</td><td n f="=SUM(B2:B3)" v="1500">$1,500.00</td></tr>',
  '<tr data-id="r6" data-pos="l"><td colspan="3" style="text-align:center">Prices as of November</td><td hidden></td><td hidden></td></tr>',
  '<tr data-id="new0" data-pos="t"><td>Porto</td><td>TRUE</td></tr>',
  '<tr data-id="new1" data-pos="x"><td>x</td></tr>',
  "</tbody></table>",
].join("\n");

test("the worked patch changes six cells, adds two rows and stays canonical", () => {
  const result = patchGrid(
    tinySrc(),
    [
      { range: "B3", values: [[450]] },
      { range: "A4:B4", values: [["02134", "=A2"]] },
      { append: [["Porto", true, null], ["x"]] },
    ],
    { newId: ids() },
  );
  expect(result.changed).toEqual({ cells: 6, rows: 2 });
  expect(result.bytes).toBe(WORKED);
  expect(tableHtml(gridModel(result.bytes, 0))).toBe(result.bytes);
});

test("only the start tag and the touched row change in a big sheet", () => {
  const src = tableHtml(FIXTURES["budget-20k"]().sheets[0]);
  const { bytes } = patchGrid(src, [{ range: "C10", values: [[7]] }]);
  const model = gridModel(src, 0);
  expect(model.rows[9].id).toBe("L-r10");
  const marker = `data-id="${model.rows[9].id}"`;
  const before = src.split("\n");
  const rowLine = before.findIndex((line) => line.includes(marker));
  expect(rowLine).toBeGreaterThan(0);
  const after = bytes.split("\n");
  expect(after.length).toBe(before.length);
  const differing = before.map((line, i) => (line === after[i] ? -1 : i)).filter((i) => i !== -1);
  expect(differing).toEqual([0, rowLine]);
});

const typedSheet = () => ({
  id: "p",
  name: "P",
  pos: "G",
  cols: [{ id: "a", pos: "G" }, { id: "b", pos: "V", fmt: "0%" }],
  rows: [
    {
      id: "r1",
      pos: "G",
      cells: [
        { text: "old", style: "color:#c00" },
        { text: "50%", n: true, v: "0.5", fmt: "0%" },
      ],
    },
  ],
});

const A1_CASES = [
  [12.5, { text: "12.5", n: true, style: "color:#c00" }],
  [true, { text: "TRUE", style: "color:#c00" }],
  ["123", { text: "123", t: true, style: "color:#c00" }],
  ["02134", { text: "02134", style: "color:#c00" }],
  ["=B1*2", { text: "", f: "=B1*2", style: "color:#c00" }],
  ["a\r\nb", { text: "a\nb", style: "color:#c00" }],
  [null, { text: "", style: "color:#c00" }],
];

for (const [value, expected] of A1_CASES) {
  test(`A1 set to ${JSON.stringify(value)} becomes ${JSON.stringify(expected)}`, () => {
    const { bytes } = patchGrid(tableHtml(typedSheet()), [{ range: "A1", values: [[value]] }]);
    expect(gridModel(bytes, 0).rows[0].cells[0]).toEqual(expected);
  });
}

test("B1 set to 0.75 keeps the column format and drops the stale v", () => {
  const { bytes } = patchGrid(tableHtml(typedSheet()), [{ range: "B1", values: [[0.75]] }]);
  expect(gridModel(bytes, 0).rows[0].cells[1]).toEqual({ text: "0.75", n: true, fmt: "0%" });
});

test("clearing a text-only cell removes it from the row", () => {
  const sheet = {
    id: "t",
    name: "T",
    pos: "G",
    cols: [{ id: "a", pos: "G" }],
    rows: [{ id: "r1", pos: "G", cells: [{ text: "only" }] }],
  };
  const { bytes } = patchGrid(tableHtml(sheet), [{ range: "A1", values: [[null]] }]);
  expect(gridModel(bytes, 0).rows[0].cells).toEqual([]);
});

test("appending past a full group keeps the sheet canonical", () => {
  const src = tableHtml(FIXTURES["budget-20k"]().sheets[0]);
  const before = gridModel(src, 0);
  const appends = Array.from({ length: 120 }, (_, i) => [i + 1]);
  const { bytes, changed } = patchGrid(src, [{ append: appends }], { newId: ids() });
  const after = gridModel(bytes, 0);
  expect(after.rows.length).toBe(before.rows.length + 120);
  expect(changed).toEqual({ cells: 120, rows: 120 });
  expect(tableHtml(after)).toBe(bytes);
  let previous = before.rows[before.rows.length - 1].pos;
  for (const row of after.rows.slice(before.rows.length)) {
    expect(row.pos > previous).toBe(true);
    previous = row.pos;
  }
});

test("a sheet with only a frozen row gains its first body group", () => {
  const sheet = {
    id: "f",
    name: "F",
    pos: "G",
    cols: [{ id: "c", pos: "G" }],
    rows: [{ id: "h", pos: "G", frozen: true, cells: [{ text: "H" }] }],
  };
  const src = tableHtml(sheet);
  const { bytes, changed } = patchGrid(src, [{ append: [["a"]] }], { newId: () => "n1" });
  expect(changed).toEqual({ cells: 1, rows: 1 });
  expect(bytes.indexOf("<tbody>")).toBeGreaterThan(bytes.indexOf("</thead>"));
  expect(bytes).toContain('<tbody>\n<tr data-id="n1" ');
  expect(tableHtml(gridModel(bytes, 0))).toBe(bytes);
});

const refusal = (ops) => {
  try {
    patchGrid(tinySrc(), ops);
  } catch (error) {
    return error;
  }
  throw new Error(`patch ${JSON.stringify(ops)} was accepted`);
};

const REFUSALS = [
  [[{ range: "B6", values: [[1]] }], "covered_cell"],
  [[{ range: "A9", values: [[1]] }], "outside_sheet"],
  [[{ range: "D1", values: [[1]] }], "outside_sheet"],
  [[{ range: "A1:B1", values: [[1]] }], "bad_patch"],
  [[{ append: [[1, 2, 3, 4]] }], "outside_sheet"],
  [[{ range: "A1", values: [[{}]] }], "bad_value"],
  [[{ range: "A1", values: [[Infinity]] }], "bad_value"],
  [[{ range: "A1", values: [["a\0b"]] }], "bad_value"],
  [[], "bad_patch"],
  [[{ range: "A1" }], "bad_patch"],
  [[{ range: "A1", values: [[1]], append: [[1]] }], "bad_patch"],
  [[{ foo: 1 }], "bad_patch"],
  [[{ range: "a1", values: [[1]] }], "bad_range"],
];

for (const [ops, code] of REFUSALS) {
  test(`refuses ${JSON.stringify(ops)} with ${code}`, () => {
    const error = refusal(ops);
    expect(error).toBeInstanceOf(QueryRefused);
    expect(error.code).toBe(code);
  });
}

test("a hand-edited table is a codec miss, not a refusal", () => {
  const src = tinySrc().replace("<td>Rent", "<td>Rent &copy;");
  expect(src).not.toBe(tinySrc());
  expect(() => patchGrid(src, [{ range: "B3", values: [[1]] }])).toThrow(CodecMiss);
  let error = null;
  try {
    patchGrid(src, [{ range: "B3", values: [[1]] }]);
  } catch (caught) {
    error = caught;
  }
  expect(error instanceof CodecMiss).toBe(true);
  expect(error instanceof QueryRefused).toBe(false);
});

test("a refusal in the second operation returns no partial result", () => {
  let result;
  let error = null;
  try {
    result = patchGrid(tinySrc(), [{ range: "B3", values: [[1]] }, { range: "B6", values: [[1]] }]);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(QueryRefused);
  expect(error.code).toBe("covered_cell");
  expect(result).toBeUndefined();
});

test("a newId that collides with an existing row is skipped", () => {
  let calls = 0;
  const newId = () => (calls++ === 0 ? "r2" : "fresh");
  const { bytes } = patchGrid(tinySrc(), [{ append: [["x"]] }], { newId });
  expect(gridModel(bytes, 0).rows[6].id).toBe("fresh");
  expect(calls).toBe(2);
});
