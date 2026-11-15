import { readFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalGrid, domAdapter } from "../../src/grid/codec/canonical.js";
import { gridModel } from "../../src/grid/codec/read.js";
import { tableHtml } from "../../src/grid/codec/write.js";
import { createGrid, newId } from "../../src/grid/grid.js";
import { GridRefused } from "../../src/grid/ops.js";
import { splitTables } from "./support/laws.js";
import { sameTree } from "./support/same-tree.js";

global.__SAP_KEEP_CONSOLE__ = true;

const GOLDEN = join(__dirname, "..", "grid-codec", "golden");

const NONE = { records: 0, pauses: 0 };

const EMPTY_LISTS = { added: [], removed: [], changed: [] };

const golden = (file, index = 0) => tableHtml(gridModel(splitTables(readFileSync(join(GOLDEN, `${file}.html`), "utf8"))[index], 0));

const TINY = golden("tiny");

// The merged fixture after its repair: the 2x2 box at the last row reaches past the sheet, so the
// repair keeps it one row tall.
const MERGED = [
  '<table grid><colgroup><col data-id="m-c0" data-pos="8"><col data-id="m-c1" data-pos="G"><col data-id="m-c2" data-pos="V"><col data-id="m-c3" data-pos="l"></colgroup>',
  "<tbody>",
  '<tr data-id="m-r1" data-pos="8"><td colspan="3">Title</td><td hidden></td><td hidden></td><td>D1</td></tr>',
  '<tr data-id="m-r2" data-pos="G"><td rowspan="2">Tall</td><td>B2</td><td>C2</td></tr>',
  '<tr data-id="m-r3" data-pos="V"><td hidden></td><td>B3</td><td></td><td>D3</td></tr>',
  '<tr data-id="m-r4" data-pos="l"><td colspan="2">Box</td><td hidden></td></tr>',
  "</tbody></table>",
].join("\n");

const observers = [];

afterEach(() => {
  for (const observer of observers.splice(0)) observer.disconnect();
  document.body.innerHTML = "";
});

// A live table parsed from bytes into the page, inside a tab when `tab` is given, and a Grid over
// it whose new ids are rn1, rn2, ... and cn1, cn2, ... unless `options` says otherwise.
// `records()` returns the mutation records the page saw and the calls of `write` since the Grid
// was made or since the last call; `heard` lists every change event; `bytes()` is the live
// table's canonical bytes.
function live(html, { tab, options } = {}) {
  document.body.innerHTML = tab ? `<section item data-id="${tab.id}"><h2 bind="name">${tab.name}</h2>${html}</section>` : html;
  const table = document.body.querySelector("table");
  const observer = new MutationObserver(() => {});
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  observers.push(observer);
  let pauses = 0;
  const write = (fn) => {
    pauses += 1;
    return fn();
  };
  let minted = 0;
  const grid = createGrid(table, { write, today: () => 46095, newId: (prefix) => `${prefix}n${++minted}`, ...options });
  const heard = [];
  grid.on("change", (event) => heard.push(event));
  const records = () => {
    const out = { records: observer.takeRecords().length, pauses };
    pauses = 0;
    return out;
  };
  const td = (ref) => {
    const at = /^([A-Z]+)([0-9]+)$/.exec(ref);
    const c = at[1].charCodeAt(0) - 65;
    return table.querySelectorAll("tr")[Number(at[2]) - 1].querySelectorAll(":scope > td")[c];
  };
  return { table, grid, records, td, heard, bytes: () => canonicalGrid(domAdapter, table) };
}

// The merged fixture, repaired, with nothing heard and nothing recorded yet.
function repaired(options) {
  const page = live(golden("merged"), options);
  page.grid.repair();
  page.records();
  page.heard.length = 0;
  return page;
}

const refusal = (run) => {
  try {
    run();
  } catch (error) {
    return [error instanceof GridRefused, error.code];
  }
  return "ran";
};

const unstale = (bytes) => bytes.replace(/^(<table[^>]*?) stale>/, "$1>");

// The starting bytes with each [from, to] pair put in; every `from` is there exactly once.
function edited(start, pairs) {
  let bytes = start;
  for (const [from, to] of pairs) {
    expect([from, bytes.split(from).length - 1]).toEqual([from, 1]);
    bytes = bytes.replace(from, () => to);
  }
  return bytes;
}

const TINY_R2 = '<tr data-id="r2" data-pos="G"><td>Rent</td><td n v="1200">$1,200.00</td><td n f="=B2/B$5" v="0.8">80%</td></tr>';
const MERGED_R1 = '<tr data-id="m-r1" data-pos="8"><td colspan="3">Title</td><td hidden></td><td hidden></td><td>D1</td></tr>';

// [what, command, the bytes it gives as edits of the starting bytes, the event's structure flag]
const TINY_CASES = [
  ["insertRows at the end", (g) => g.insertRows(7, 1), [["</tbody></table>", '<tr data-id="rn1" data-pos="t"></tr>\n</tbody></table>']], true],
  [
    "insertRows like a row copies its format and not its content",
    (g) => g.insertRows(7, 2, { like: 5 }),
    [["</tbody></table>", '<tr data-id="rn1" data-pos="p"><td style="font-weight:bold"></td></tr>\n<tr data-id="rn2" data-pos="t"><td style="font-weight:bold"></td></tr>\n</tbody></table>']],
    true,
  ],
  ["deleteRows of the last row", (g) => g.deleteRows("6"), [['<tr data-id="r6" data-pos="l"><td colspan="3" style="text-align:center">Prices as of November</td><td hidden></td><td hidden></td></tr>\n', ""]], true],
  [
    "setRowHeight",
    (g) => g.setRowHeight("2:3", 30),
    [
      ['<tr data-id="r2" data-pos="G">', '<tr data-id="r2" data-pos="G" style="height:30px">'],
      ['<tr data-id="r3" data-pos="O">', '<tr data-id="r3" data-pos="O" style="height:30px">'],
    ],
    false,
  ],
  [
    "insertCols like a column copies its format",
    (g) => g.insertCols("D", 1, { like: "B" }),
    [['<col data-id="cc" data-pos="l" fmt="0%"></colgroup>', '<col data-id="cc" data-pos="l" fmt="0%"><col data-id="cn1" data-pos="t" fmt="$#,##0.00"></colgroup>']],
    true,
  ],
  [
    "deleteCols of the last column, which holds formulas, and the merge across it gets shorter",
    (g) => g.deleteCols("C"),
    [
      ['<col data-id="cc" data-pos="l" fmt="0%">', ""],
      ["<td>Share</td>", ""],
      ['<td n f="=B2/B$5" v="0.8">80%</td>', ""],
      ['<td n f="=B3/B$5" v="0.2">20%</td>', ""],
      ['<td colspan="3" style="text-align:center">Prices as of November</td><td hidden></td><td hidden></td>', '<td colspan="2" style="text-align:center">Prices as of November</td><td hidden></td>'],
    ],
    true,
  ],
  [
    "setColWidth",
    (g) => g.setColWidth("B:C", 90),
    [
      ['fmt="$#,##0.00">', 'fmt="$#,##0.00" style="width:90px">'],
      ['fmt="0%">', 'fmt="0%" style="width:90px">'],
    ],
    false,
  ],
  [
    "merge keeps the anchor's content and clears the rest",
    (g) => g.merge("A2:A3"),
    [
      ["<td>Rent</td>", '<td rowspan="2">Rent</td>'],
      ["<td>Food</td>", "<td hidden></td>"],
    ],
    true,
  ],
  ["merge over a row with no cells", (g) => g.merge("A4:C4"), [['<tr data-id="r4" data-pos="V"></tr>', '<tr data-id="r4" data-pos="V"><td colspan="3"></td><td hidden></td><td hidden></td></tr>']], true],
  [
    "unmerge named by a covered cell",
    (g) => g.unmerge("B6"),
    [['<td colspan="3" style="text-align:center">Prices as of November</td><td hidden></td><td hidden></td>', '<td style="text-align:center">Prices as of November</td>']],
    true,
  ],
  [
    "freeze",
    (g) => g.freeze({ rows: 2, cols: 0 }),
    [
      [' freeze-cols="1"', ""],
      [`</thead><tbody>\n${TINY_R2}\n`, `${TINY_R2}\n</thead><tbody>\n`],
    ],
    true,
  ],
];

const MERGED_CASES = [
  [
    "insertRows inside a merge makes it taller",
    (g) => g.insertRows(3, 1),
    [
      ['<td rowspan="2">Tall</td>', '<td rowspan="3">Tall</td>'],
      ['<tr data-id="m-r3"', '<tr data-id="rn1" data-pos="O"><td hidden></td></tr>\n<tr data-id="m-r3"'],
    ],
    true,
  ],
  [
    "deleteRows of a merge's anchor row moves the anchor down",
    (g) => g.deleteRows("2"),
    [
      ['<tr data-id="m-r2" data-pos="G"><td rowspan="2">Tall</td><td>B2</td><td>C2</td></tr>\n', ""],
      ['<tr data-id="m-r3" data-pos="V"><td hidden></td>', '<tr data-id="m-r3" data-pos="V"><td>Tall</td>'],
    ],
    true,
  ],
  [
    "moveRows to the end",
    (g) => g.moveRows("1", 5),
    [
      [`${MERGED_R1}\n`, ""],
      ["</tbody></table>", `${MERGED_R1.replace('data-pos="8"', 'data-pos="t"')}\n</tbody></table>`],
    ],
    true,
  ],
  ["setRowHeight", (g) => g.setRowHeight("1", 40), [['<tr data-id="m-r1" data-pos="8">', '<tr data-id="m-r1" data-pos="8" style="height:40px">']], false],
  [
    "insertCols inside a merge makes it wider",
    (g) => g.insertCols("B", 1),
    [
      ['<col data-id="m-c0" data-pos="8">', '<col data-id="m-c0" data-pos="8"><col data-id="cn1" data-pos="C">'],
      ['<td colspan="3">Title</td>', '<td colspan="4">Title</td><td hidden></td>'],
      ['<td rowspan="2">Tall</td>', '<td rowspan="2">Tall</td><td></td>'],
      ["<td hidden></td><td>B3</td>", "<td hidden></td><td></td><td>B3</td>"],
      ['<td colspan="2">Box</td>', '<td colspan="3">Box</td><td hidden></td>'],
    ],
    true,
  ],
  [
    "deleteCols of the anchors' column moves each anchor right",
    (g) => g.deleteCols("A"),
    [
      ['<col data-id="m-c0" data-pos="8">', ""],
      ['<td colspan="3">Title</td><td hidden></td>', '<td colspan="2">Title</td>'],
      ['<td rowspan="2">Tall</td>', ""],
      ["<td hidden></td><td>B3</td>", "<td>B3</td>"],
      ['<td colspan="2">Box</td><td hidden></td>', "<td>Box</td>"],
    ],
    true,
  ],
  [
    "moveCols to the front",
    (g) => g.moveCols("D", "A"),
    [
      ['<col data-id="m-c3" data-pos="l">', ""],
      ['<colgroup><col data-id="m-c0"', '<colgroup><col data-id="m-c3" data-pos="4"><col data-id="m-c0"'],
      ['<td colspan="3">Title</td><td hidden></td><td hidden></td><td>D1</td>', '<td>D1</td><td colspan="3">Title</td><td hidden></td><td hidden></td>'],
      ['<td rowspan="2">Tall</td>', '<td></td><td rowspan="2">Tall</td>'],
      ["<td hidden></td><td>B3</td><td></td><td>D3</td>", "<td>D3</td><td hidden></td><td>B3</td>"],
      ['<td colspan="2">Box</td>', '<td></td><td colspan="2">Box</td>'],
    ],
    true,
  ],
  ["setColWidth", (g) => g.setColWidth("A", 120), [['<col data-id="m-c0" data-pos="8">', '<col data-id="m-c0" data-pos="8" style="width:120px">']], false],
  [
    "merge of a block clears all but its anchor",
    (g) => g.merge("B2:C3"),
    [
      ["<td>B2</td><td>C2</td>", '<td colspan="2" rowspan="2">B2</td><td hidden></td>'],
      ["<td hidden></td><td>B3</td><td></td>", "<td hidden></td><td hidden></td><td hidden></td>"],
    ],
    true,
  ],
  ["unmerge named by a covered cell", (g) => g.unmerge("B1"), [['<td colspan="3">Title</td><td hidden></td><td hidden></td>', "<td>Title</td><td></td><td></td>"]], true],
  [
    "freeze",
    (g) => g.freeze({ rows: 1 }),
    [[`<tbody>\n${MERGED_R1}\n`, `<thead>\n${MERGED_R1}\n</thead><tbody>\n`]],
    true,
  ],
];

// One command on a fresh page: the pinned bytes, read back unchanged by the strict reader and the
// writer, the live tree the bytes describe, one event with the structure flag, and then the
// event's inverse puts the starting bytes back.
function runCase(page, start, [what, run, pairs, structure]) {
  const want = edited(start, pairs);
  const event = run(page.grid);
  expect([what, page.bytes(), tableHtml(gridModel(want, 0)), sameTree(page.table), page.grid.issues]).toEqual([what, want, want, [], []]);
  expect([what, page.heard.length, page.heard[0] === event, event.source, event.structure, event.revision]).toEqual([what, 1, true, "api", structure, 1]);
  const undo = page.grid.apply(event.inverse);
  expect([what, undo.revision, sameTree(page.table), page.grid.issues]).toEqual([what, 2, [], []]);
  return page.bytes();
}

test("each structure command gives the pinned bytes on tiny, and its inverse gives the starting bytes back", () => {
  for (const one of TINY_CASES) {
    const page = live(TINY);
    const back = runCase(page, TINY, one);
    if (one[0].startsWith("deleteCols")) {
      // The undo writes the column's formulas back, with their results, and the reducer marks a
      // table stale whenever an action writes a formula.
      expect([back === TINY, unstale(back)]).toEqual([false, TINY]);
    } else {
      expect([one[0], back]).toEqual([one[0], TINY]);
    }
  }
});

test("each structure command gives the pinned bytes on merged, and its inverse gives the starting bytes back", () => {
  const page = live(golden("merged"));
  expect(page.grid.issues.map((issue) => issue.code)).toEqual(["merge_past_end"]);
  page.grid.repair();
  expect(page.bytes()).toBe(MERGED);
  for (const one of MERGED_CASES) {
    const back = runCase(live(MERGED), MERGED, one);
    expect([one[0], back]).toEqual([one[0], MERGED]);
  }
});

test("the change event of an insert names the new rows and the action, with ids, and the table is scheduled", () => {
  const scheduled = [];
  const page = live(TINY, { tab: { id: "s1", name: "Budget" }, options: { schedule: (target) => scheduled.push(target) } });
  const event = page.grid.insertRows(7, 1);
  expect([scheduled.length, scheduled[0] === page.table]).toEqual([1, true]);
  expect(event).toEqual({
    sheet: "s1",
    source: "api",
    action: { v: 1, t: "insertRows", sheet: "s1", rows: [{ id: "rn1", pos: "t" }] },
    inverse: { v: 1, t: "deleteRows", sheet: "s1", rows: ["rn1"] },
    cells: [],
    rows: { added: ["rn1"], removed: [], changed: [] },
    cols: EMPTY_LISTS,
    structure: true,
    revision: 1,
  });
  const moved = repaired().grid.moveCols("D", "A");
  expect([moved.cols, moved.rows, moved.structure]).toEqual([{ added: [], removed: [], changed: ["m-c3"] }, EMPTY_LISTS, true]);
});

test("an insert between two rows with one key gives the row after it a new key in the same action and event", () => {
  const TIED = [
    '<table grid><colgroup><col data-id="ca" data-pos="V"></colgroup>',
    "<tbody>",
    '<tr data-id="ra" data-pos="G"><td>a</td></tr>',
    '<tr data-id="rb" data-pos="V"><td>b</td></tr>',
    '<tr data-id="rc" data-pos="V"><td>c</td></tr>',
    "</tbody></table>",
  ].join("\n");
  const page = live(TIED);
  expect([page.bytes(), page.grid.issues]).toEqual([TIED, []]);
  const event = page.grid.insertRows(3, 1);
  expect([event.action.t, event.rows, event.structure, event.revision, page.heard.length]).toEqual(["batch", { added: ["rn1"], removed: [], changed: ["rc"] }, true, 1, 1]);
  expect(page.bytes()).toBe(
    edited(TIED, [
      ['<tr data-id="rc" data-pos="V">', '<tr data-id="rn1" data-pos="d"></tr>\n<tr data-id="rc" data-pos="l">'],
    ]),
  );
  page.grid.apply(event.inverse);
  expect(page.bytes()).toBe(TIED);
});

test("on a sheet with formulas a command that moves a row or column refuses needs_formula_engine and leaves the bytes unchanged", () => {
  const FORMULAS = golden("formulas-formatted");
  const refused = [
    [FORMULAS, "a middle insert", (g) => g.insertRows(5, 1)],
    [TINY, "a middle insert", (g) => g.insertRows(3, 1)],
    [TINY, "a middle delete", (g) => g.deleteRows("4")],
    [TINY, "a row move", (g) => g.moveRows("4", 7)],
    [TINY, "a column insert before a formula", (g) => g.insertCols("B", 1)],
    [TINY, "a column delete before a formula", (g) => g.deleteCols("A")],
    [FORMULAS, "a column move", (g) => g.moveCols("E", "A")],
  ];
  for (const [start, what, run] of refused) {
    const page = live(start);
    expect([what, refusal(() => run(page.grid))]).toEqual([what, [true, "needs_formula_engine"]]);
    expect([what, page.records(), page.bytes(), page.grid.revision, page.heard]).toEqual([what, NONE, start, 0, []]);
  }
  const page = live(FORMULAS);
  page.grid.insertRows(11, 1);
  expect([page.grid.size, page.grid.revision]).toEqual([{ rows: 11, cols: 5 }, 1]);
});

test("a move, a merge, a freeze or a size the reducer refuses leaves the bytes unchanged", () => {
  const refused = [
    [TINY, "a column move that reorders a merge", (g) => g.moveCols("C", "A"), "merge_cut"],
    [TINY, "a merge across the frozen line", (g) => g.merge("A1:A2"), "merge_cut"],
    [TINY, "a merge that overlaps another", (g) => g.merge("A5:B6"), "merge_overlap"],
    [MERGED, "a freeze line through a merge", (g) => g.freeze({ rows: 2 }), "merge_cut"],
    [TINY, "a row height of 0", (g) => g.setRowHeight("2", 0), "bad_action"],
    [TINY, "a width that is not whole", (g) => g.setColWidth("A", 1.5), "bad_action"],
  ];
  for (const [start, what, run, code] of refused) {
    const page = live(start);
    expect([what, refusal(() => run(page.grid))]).toEqual([what, [true, code]]);
    expect([what, page.records(), page.bytes(), page.grid.revision, page.heard]).toEqual([what, NONE, start, 0, []]);
  }
});

test("every structure command sends one action to dispatch and writes nothing itself", () => {
  for (const [start, cases] of [[TINY, TINY_CASES], [MERGED, MERGED_CASES]]) {
    for (const [what, run, pairs] of cases) {
      const page = live(start);
      const recorded = [];
      page.grid.dispatch = (action) => {
        recorded.push(action);
        return "recorded";
      };
      expect([what, run(page.grid)]).toEqual([what, "recorded"]);
      expect([what, page.records(), page.bytes(), recorded.length, page.grid.revision, page.heard]).toEqual([what, NONE, start, 1, 0, []]);
      page.grid.apply(recorded[0]);
      expect([what, page.bytes()]).toEqual([what, edited(start, pairs)]);
    }
  }
});

test("a page that may not write, and a sheet with issues, refuse every structure command", () => {
  const cases = [...TINY_CASES, ...MERGED_CASES];
  for (const [mayWrite, code] of [[() => false, "read_only"], [() => true, "needs_repair"]]) {
    const page = live(golden("merged"), { options: { mayWrite } });
    const start = page.bytes();
    const recorded = [];
    page.grid.dispatch = (action) => recorded.push(action);
    for (const [what, run] of cases) expect([what, refusal(() => run(page.grid))]).toEqual([what, [true, code]]);
    expect([recorded, page.records(), page.bytes(), page.grid.revision]).toEqual([[], NONE, start, 0]);
  }
});

test("a command that asks for what the sheet already has writes nothing and returns null", () => {
  const asks = [
    [TINY, "a width the column has", (g) => g.setColWidth("A", 180)],
    [TINY, "a merge that is there", (g) => g.merge("A6:C6")],
    [TINY, "a merge given from its far corner", (g) => g.merge("C6:A6")],
    [TINY, "a merge of one cell", (g) => g.merge("A2")],
    [TINY, "unmerge of a cell in no merge", (g) => g.unmerge("A2")],
    [TINY, "the frozen counts there are", (g) => g.freeze({ rows: 1, cols: 1 })],
    [TINY, "a freeze that names no count", (g) => g.freeze({})],
    [MERGED, "a row moved to where it is", (g) => g.moveRows("2", 2)],
    [MERGED, "rows moved to just after themselves", (g) => g.moveRows("2:3", 4)],
    [MERGED, "a column moved to where it is", (g) => g.moveCols("B", "B")],
  ];
  for (const [start, what, run] of asks) {
    const page = live(start);
    const recorded = [];
    page.grid.dispatch = (action) => recorded.push(action);
    expect([what, run(page.grid), recorded, page.records(), page.bytes(), page.grid.revision]).toEqual([what, null, [], NONE, start, 0]);
  }
});

test("a structure command refuses a bad argument as GridRefused", () => {
  const bad = [
    ["a row number 0", (g) => g.insertRows(0, 1), "bad_action"],
    ["a row past the one after the last", (g) => g.insertRows(8, 1), "outside_sheet"],
    ["a count of 0", (g) => g.insertRows(7, 0), "bad_action"],
    ["a count that is not whole", (g) => g.insertRows(7, 1.5), "bad_action"],
    ["a count over the limit", (g) => g.insertRows(7, 10001), "too_large"],
    ["a like past the sheet", (g) => g.insertRows(7, 1, { like: 9 }), "outside_sheet"],
    ["a delete past the sheet", (g) => g.deleteRows("9"), "outside_sheet"],
    ["columns given to a row command", (g) => g.deleteRows("B:C"), "bad_action"],
    ["rows given to a column command", (g) => g.deleteCols("2:3"), "bad_action"],
    ["a merge past the sheet", (g) => g.merge("A1:Z9"), "outside_sheet"],
    ["a lowercase reference", (g) => g.unmerge("b6"), "bad_range"],
    ["more frozen rows than the sheet has", (g) => g.freeze({ rows: 99 }), "outside_sheet"],
    ["a negative frozen count", (g) => g.freeze({ cols: -1 }), "bad_action"],
  ];
  for (const [what, run, code] of bad) {
    const page = live(TINY);
    expect([what, refusal(() => run(page.grid))]).toEqual([what, [true, code]]);
    expect([what, page.records(), page.bytes(), page.grid.revision]).toEqual([what, NONE, TINY, 0]);
  }
});

test("a structure command takes a write from outside the grid first, so its inverse puts that write back", () => {
  const page = repaired();
  page.td("B3").textContent = "x";
  const written = page.bytes();
  const event = page.grid.deleteRows("3");
  expect(page.heard.map((one) => [one.source, one.revision])).toEqual([
    ["dom", 2],
    ["api", 3],
  ]);
  page.grid.apply(event.inverse);
  expect([page.bytes(), written === MERGED]).toEqual([written, false]);
});

test("new rows and columns take their ids from the Grid's newId, which gives the prefix and eight letters or digits", () => {
  const ids = Array.from({ length: 1000 }, () => newId("r"));
  expect([ids.every((id) => /^r[0-9a-z]{8}$/.test(id)), new Set(ids).size]).toEqual([true, 1000]);
  const page = live(TINY, { options: { newId } });
  const rows = page.grid.insertRows(7, 3).rows.added;
  const cols = page.grid.insertCols("D", 2).cols.added;
  expect([rows.map((id) => /^r[0-9a-z]{8}$/.test(id)), cols.map((id) => /^c[0-9a-z]{8}$/.test(id))]).toEqual([
    [true, true, true],
    [true, true],
  ]);
});
