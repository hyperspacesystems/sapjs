import { domBacking } from "../../src/grid/backing-dom.js";
import { modelBacking } from "../../src/grid/backing-model.js";
import { canonicalGrid, domAdapter } from "../../src/grid/codec/canonical.js";
import { keysBetween } from "../../src/grid/codec/order-keys.js";
import { gridModel } from "../../src/grid/codec/read.js";
import { cellHtml, tableHtml } from "../../src/grid/codec/write.js";
import { contentOf, derive, effectiveFmt } from "../../src/grid/content.js";
import { createGrid } from "../../src/grid/grid.js";
import { editText } from "../../src/grid/input.js";
import { apply as applyAction } from "../../src/grid/ops.js";
import { FIXTURES } from "../grid-codec/support/fixtures.js";

global.__SAP_KEEP_CONSOLE__ = true;

const TODAY = 46095;
const CEILING = 30;

const printed = [];

afterAll(() => {
  console.log(`bytes per filled cell (6.3)\n${printed.join("\n")}`);
});

afterEach(() => {
  document.body.innerHTML = "";
});

const size = (text) => Buffer.byteLength(text, "utf8");

// The shown cells that hold text or a formula, read back from canonical bytes.
const cellsOf = (bytes) => gridModel(bytes, 0).rows.flatMap((row) => row.cells.filter((cell) => cell && !cell.hidden && (cell.text !== "" || cell.f !== undefined)));

const perCell = (tables) => size(tables.join("\n")) / tables.reduce((n, bytes) => n + cellsOf(bytes).length, 0);

const fixed = (n) => n.toFixed(2);

// A seeded random number in [0, 1), the same in every process.
function seeded(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

// The sheet's rows and columns with no cells, as a live table, and a Grid over it.
function empty(sheet) {
  const skeleton = { ...sheet, rows: sheet.rows.map(({ cells, ...row }) => ({ ...row, cells: [] })) };
  document.body.innerHTML = tableHtml(skeleton);
  const table = document.body.querySelector("table");
  return { skeleton, table, grid: createGrid(table, { today: () => TODAY }) };
}

// The sheet built through g.setRange, from each cell's editor text: typed input, as a person or a
// paste gives it.
function typed(sheet) {
  const page = empty(sheet);
  const block = sheet.rows.map((row) => sheet.cols.map((col, c) => editText(contentOf(row.cells[c] ?? null), effectiveFmt(row.cells[c] ?? null, col), TODAY)));
  const event = page.grid.setRange("A1", block);
  return { ...page, event };
}

const ledger = () => FIXTURES["budget-20k"]().sheets[0];

// A sheet of empty rows and columns, with columns of this format.
function blankSheet(rows, cols, fmt = null) {
  return {
    id: "s",
    name: "Sheet",
    pos: "G",
    cols: keysBetween(null, null, cols).map((pos, c) => ({ id: `c${c}`, pos, ...(fmt ? { fmt } : null) })),
    rows: keysBetween(null, null, rows).map((pos, r) => ({ id: `r${r}`, pos, cells: [] })),
  };
}

test("check 1: budget-20k built through setRange gives the writer's bytes for the same model, at or under 30 bytes per filled cell, and not table.outerHTML", () => {
  const sheets = FIXTURES["budget-20k"]().sheets;
  const tables = [];
  const results = sheets.map((sheet) => {
    const page = typed(sheet);
    const bytes = domBacking(page.table).bytes();
    const model = modelBacking(page.skeleton);
    expect(applyAction(model, page.event.action, { derive }).out).toBe("applied");
    tables.push(bytes);
    return [bytes === tableHtml(model.sheet), page.table.outerHTML !== bytes];
  });
  expect(results).toEqual(sheets.map(() => [true, true]));
  const average = perCell(tables);
  printed.push(`check 1, budget-20k typed through setRange: ${fixed(average)} (${sheets.map((sheet, i) => `${sheet.name} ${fixed(perCell([tables[i]]))}`).join(", ")})`);
  expect(average).toBeLessThanOrEqual(CEILING);
});

test("check 2: budget-20k parsed into jsdom and written through canonicalGrid stays at or under 30 bytes per filled cell", () => {
  const sheets = FIXTURES["budget-20k"]().sheets;
  const tables = sheets.map((sheet) => {
    document.body.innerHTML = tableHtml(sheet);
    return canonicalGrid(domAdapter, document.body.querySelector("table"));
  });
  const average = perCell(tables);
  printed.push(`check 2, budget-20k parsed into jsdom: ${fixed(average)}`);
  expect(tables).toEqual(sheets.map((sheet) => tableHtml(sheet)));
  expect(average).toBeLessThanOrEqual(CEILING);
});

// Check 3 types grouped numbers and currency in the column's own look, and dates as m/d/yyyy into
// the ledger's mmm d, yyyy column: a look of the same kind, which the cell must not take as its own.
test("check 3: the ceiling holds after 1,000 g.set calls typing grouped numbers, currency and dates into columns that already have that format, and no typed cell takes a format of its own", () => {
  const sheet = ledger();
  const page = typed({ ...sheet, rows: sheet.rows.slice(0, 101) });
  page.grid.format("B:D", { fmt: "#,##0" });
  page.grid.format("P:P", { fmt: "mmm d, yyyy" });
  const columns = [
    ["B", "#,##0"],
    ["C", "#,##0"],
    ["D", "#,##0"],
    ["M", "$#,##0.00"],
    ["N", "$#,##0.00"],
    ["P", "mmm d, yyyy"],
  ];
  const cols = gridModel(domBacking(page.table).bytes(), 0).cols;
  expect(columns.map(([letter]) => cols[letter.charCodeAt(0) - 65].fmt)).toEqual(columns.map(([, fmt]) => fmt));
  const random = seeded(63);
  const typedAt = new Set();
  for (let k = 0; k < 1000; k++) {
    const [letter, fmt] = columns[k % columns.length];
    const ref = `${letter}${2 + (Math.floor(k / columns.length) % 100)}`;
    const text =
      fmt === "#,##0"
        ? (1000 + Math.floor(random() * 9000)).toLocaleString("en-US")
        : fmt === "$#,##0.00"
          ? `$${(1 + Math.floor(random() * 99900) / 100).toFixed(2)}`
          : `${1 + Math.floor(random() * 12)}/${1 + Math.floor(random() * 28)}/2026`;
    page.grid.set(ref, text);
    typedAt.add(ref);
  }
  const bytes = domBacking(page.table).bytes();
  const model = gridModel(bytes, 0);
  const ids = model.cols.map((col) => col.id);
  const at = (ref) => model.rows[Number(ref.slice(1)) - 1].cells[ref.charCodeAt(0) - 65];
  const cells = [...typedAt].map(at);
  const typedBytes = cells.reduce((sum, cell) => sum + size(cellHtml(cell)), 0) / cells.length;
  const sheetBytes = perCell([bytes]);
  printed.push(`check 3, 101 rows of budget-20k after 1,000 g.set calls: ${fixed(sheetBytes)} for the sheet, ${fixed(typedBytes)} for the ${cells.length} cells typed into`);
  expect(ids.length).toBe(20);
  expect({ sheet: sheetBytes <= CEILING, typed: typedBytes <= CEILING, ownFormats: cells.filter((cell) => cell.fmt !== undefined).length }).toEqual({ sheet: true, typed: true, ownFormats: 0 });
});

test("printed: 20,000 grouped numbers, each with its own format against one column format", () => {
  const random = seeded(20000);
  const block = Array.from({ length: 2000 }, () => Array.from({ length: 10 }, () => (1000 + Math.floor(random() * 9000)).toLocaleString("en-US")));
  const counts = [null, "#,##0"].map((fmt) => {
    const page = empty(blankSheet(2000, 10, fmt));
    page.grid.setRange("A1", block);
    const bytes = domBacking(page.table).bytes();
    const cells = cellsOf(bytes);
    return [cells.length, cells.reduce((sum, cell) => sum + size(cellHtml(cell)), 0) / cells.length, perCell([bytes])];
  });
  printed.push(`grouped numbers, own format on every cell: ${fixed(counts[0][1])} per cell, ${fixed(counts[0][2])} for the sheet`);
  printed.push(`grouped numbers, one column format: ${fixed(counts[1][1])} per cell, ${fixed(counts[1][2])} for the sheet`);
  expect(counts.map(([n]) => n)).toEqual([20000, 20000]);
});
