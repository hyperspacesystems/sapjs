import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { derive } from "../../src/grid/content.js";
import { apply } from "../../src/grid/ops.js";
import { modelBacking } from "../../src/grid/backing-model.js";
import { normalizeSheet } from "../../src/grid/normalize.js";
import { gridModel } from "../../src/grid/codec/read.js";
import { tableHtml } from "../../src/grid/codec/write.js";
import { createSheetWriter } from "../../src/grid/codec/cached-writer.js";
import { rng } from "./support/rng.js";
import { genAction } from "../grid/support/gen-actions.js";
import { listTables, splitTables } from "../grid/support/laws.js";
import { agentHiddenText, agentSheet } from "../grid/support/agent-sheet.js";

global.__SAP_KEEP_CONSOLE__ = true;

const SEED = 20261118;
const LISTS = 300;
const LENGTH = 30;
const GROUP_SIZES = [1, 2, 3, 50];

const clone = (value) => JSON.parse(JSON.stringify(value));

function goldenTables() {
  const dir = join(__dirname, "golden");
  const tables = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".html")).sort()) {
    splitTables(readFileSync(join(dir, file), "utf8")).forEach((src, index) => {
      tables.push({ name: `${file.replace(/\.html$/, "")}#${index}`, model: gridModel(src, 0) });
    });
  }
  tables.push({ name: "agent", model: agentSheet(), hiddenText: agentHiddenText });
  return tables;
}

// The bytes with each engine result in its cell, written the plain way.
function expected(sheet, results) {
  const copy = clone(sheet);
  for (const row of copy.rows) {
    row.cells.forEach((cell, c) => {
      const extra = cell && results.get(`${row.id}\n${copy.cols[c]?.id}`);
      if (!extra || cell.f === undefined || cell.hidden) return;
      cell.text = extra.text;
      for (const key of ["v", "n", "t"]) {
        if (extra[key] === undefined || extra[key] === false) delete cell[key];
        else cell[key] = extra[key];
      }
    });
  }
  return tableHtml(copy, { groupSize: sheet.groupSize });
}

test("the cached writer writes the same bytes as tableHtml after every action of every list", () => {
  const tables = goldenTables();
  const spread = listTables(tables, LISTS);
  const random = rng(SEED);
  let failure = null;
  let applied = 0;
  let resultsTouched = 0;

  for (let list = 0; list < LISTS && failure === null; list++) {
    const table = tables.find((one) => one.name === spread[list]);
    const formulas = list % 2 === 0 ? null : {};
    const groupSize = GROUP_SIZES[list % GROUP_SIZES.length];
    const backing = modelBacking(normalizeSheet(clone(table.model), { derive, hiddenText: table.hiddenText }).sheet, { sheetId: null });
    const rand = rng(Math.floor(random() * 4294967296));
    const writer = createSheetWriter({ groupSize });
    const results = new Map();
    const extras = (sheetId, rowId, colId) => {
      if (sheetId !== "s") throw new Error(`extras asked for sheet ${sheetId}`);
      return results.get(`${rowId}\n${colId}`);
    };
    const check = (step, action) => {
      const want = expected({ ...backing.sheet, groupSize }, results);
      const got = writer.table("s", backing.sheet, extras);
      if (got !== want) failure = { table: table.name, list, step, groupSize, action, got, want };
    };

    check(-1, null);
    for (let step = 0; step < LENGTH && failure === null; step++) {
      const action = genAction(rand, backing, { invalidRate: 0.15 });
      const out = apply(backing, action, { derive, formulas });
      if (out.out === "applied") {
        applied += 1;
        writer.touch("s", out.changes);
      }
      if (rand() < 0.3 && backing.sheet.rows.length > 0 && backing.sheet.cols.length > 0) {
        // Mostly a formula cell, as an engine gives results; sometimes any cell, which has none.
        const formulaCells = [];
        backing.sheet.rows.forEach((one, r) => one.cells.forEach((cell, c) => cell?.f !== undefined && formulaCells.push([r, c])));
        const [r, c] = formulaCells.length > 0 && rand() < 0.8 ? formulaCells[Math.floor(rand() * formulaCells.length)] : [Math.floor(rand() * backing.sheet.rows.length), Math.floor(rand() * backing.sheet.cols.length)];
        const row = backing.sheet.rows[r];
        const col = backing.sheet.cols[c];
        const n = Math.floor(rand() * 1000);
        const roll = rand();
        results.set(`${row.id}\n${col.id}`, roll < 0.33 ? { text: String(n), v: undefined, t: true } : roll < 0.66 ? { text: `${n} <&>`, v: String(n), n: true } : { text: "#DIV/0!" });
        writer.touch("s", { results: [{ sheet: "s", row: row.id, col: col.id }] });
        resultsTouched += 1;
      }
      check(step, action);
    }
  }

  if (failure !== null) {
    console.log(`list ${failure.list} on ${failure.table}, step ${failure.step}, groupSize ${failure.groupSize}`);
    console.log(`  action ${JSON.stringify(failure.action)}`);
  }
  expect(failure === null ? null : { ...failure, got: failure.got.split("\n"), want: failure.want.split("\n") }).toBeNull();
  expect(applied).toBeGreaterThan(LISTS * 10);
  expect(resultsTouched).toBeGreaterThan(LISTS * 3);
});

const SHEET = {
  cols: [{ id: "a", pos: "V" }, { id: "b", pos: "l" }],
  rows: Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, pos: `${i + 1}`, cells: [{ text: `x${i}` }, { text: `y${i}` }] })),
};

test("a write reuses the group of rows nobody touched, and a touched row or result drops only its group", () => {
  const sheet = clone(SHEET);
  const writer = createSheetWriter({ groupSize: 2 });
  writer.table("s", sheet);
  sheet.rows[0].cells[0].text = "untold";
  sheet.rows[4].cells[0].text = "told";
  writer.touch("s", { cells: [{ sheet: "s", row: "r4", col: "a" }] });
  const bytes = writer.table("s", sheet);
  expect([bytes.includes("<td>x0</td>"), bytes.includes("<td>told</td>")]).toEqual([true, true]);
  writer.touch("s", { results: [{ sheet: "s", row: "r1", col: "b" }] });
  expect(writer.table("s", sheet)).toBe(tableHtml(sheet, { groupSize: 2 }));
});

test("a column change, or a touch that names nothing, drops the whole tab", () => {
  const sheet = clone(SHEET);
  const writer = createSheetWriter({ groupSize: 2 });
  writer.table("s", sheet);
  sheet.rows[0].cells[0].text = "moved";
  writer.touch("s", { rows: [], cols: [{ sheet: "s", col: "a", kind: "move" }], cells: [] });
  expect(writer.table("s", sheet)).toBe(tableHtml(sheet, { groupSize: 2 }));
  sheet.rows[3].cells[1].text = "reloaded";
  writer.touch("s");
  expect(writer.table("s", sheet)).toBe(tableHtml(sheet, { groupSize: 2 }));
});

test("a structure change named with no row or column lists drops the whole tab, and a change of an unknown shape throws", () => {
  const sheet = clone(SHEET);
  const writer = createSheetWriter({ groupSize: 2 });
  writer.table("s", sheet);
  sheet.rows[0].cells.reverse();
  writer.touch("s", { cells: [], results: [], structure: true });
  expect(writer.table("s", sheet)).toBe(tableHtml(sheet, { groupSize: 2 }));
  expect(() => writer.touch("s", { out: "applied", changes: { cells: [] } })).toThrow(TypeError);
});

test("a result is written into its formula cell only, never into a cell with no formula or one a merge covers", () => {
  const sheet = clone(SHEET);
  sheet.rows[0].cells[0] = { text: "1", n: true, f: "=1", v: "1" };
  sheet.rows[1].cells[0] = { text: "", hidden: true };
  const writer = createSheetWriter({ groupSize: 2 });
  const bytes = writer.table("s", sheet, () => ({ text: "9", v: "9", n: true }));
  expect(bytes).toBe(tableHtml({ ...sheet, rows: [{ ...sheet.rows[0], cells: [{ ...sheet.rows[0].cells[0], text: "9", v: "9" }, sheet.rows[0].cells[1]] }, ...sheet.rows.slice(1)] }, { groupSize: 2 }));
});

test("a Grid change event drops the groups of the rows it names, and one that read the whole table drops the tab", () => {
  const sheet = clone(SHEET);
  const writer = createSheetWriter({ groupSize: 2 });
  const plain = () => tableHtml(sheet, { groupSize: 2 });
  writer.table("s", sheet);
  const event = (fields) => ({ source: "dom", structure: false, cells: [], rows: { added: [], removed: [], changed: [] }, cols: { added: [], removed: [], changed: [] }, ...fields });
  sheet.rows[1].style = "height:30px";
  writer.touch("s", event({ rows: { added: [], removed: [], changed: ["r1"] } }));
  expect(writer.table("s", sheet)).toBe(plain());
  sheet.rows[3].cells[0].text = "typed";
  writer.touch("s", event({ cells: [{ row: "r3", col: "a", before: null, after: null }] }));
  expect(writer.table("s", sheet)).toBe(plain());
  sheet.rows[5].cells[1].text = "moved";
  writer.touch("s", event({ cols: { added: [], removed: [], changed: ["b"] } }));
  expect(writer.table("s", sheet)).toBe(plain());
  sheet.rows[0].cells[1].text = "read again";
  writer.touch("s", event({ rescanned: true, structure: true }));
  expect(writer.table("s", sheet)).toBe(plain());
});

test("a write with other results, or with none, writes every group again", () => {
  const sheet = clone(SHEET);
  sheet.rows[4].cells[0] = { text: "1", n: true, f: "=1", v: "1" };
  const writer = createSheetWriter({ groupSize: 2 });
  const results = () => ({ text: "9", v: "9", n: true });
  writer.table("s", sheet);
  const withResult = { ...sheet, rows: sheet.rows.map((row, r) => (r === 4 ? { ...row, cells: [{ ...row.cells[0], text: "9", v: "9" }, row.cells[1]] } : row)) };
  expect(writer.table("s", sheet, results)).toBe(tableHtml(withResult, { groupSize: 2 }));
  expect(writer.table("s", sheet)).toBe(tableHtml(sheet, { groupSize: 2 }));
});

test("each tab keeps its own groups", () => {
  const one = clone(SHEET);
  const two = clone(SHEET);
  const writer = createSheetWriter({ groupSize: 2 });
  writer.table("one", one);
  writer.table("two", two);
  two.rows[0].cells[0].text = "two";
  writer.touch("two", { cells: [{ sheet: "two", row: "r0", col: "a" }] });
  expect([writer.table("one", one), writer.table("two", two)]).toEqual([tableHtml(one, { groupSize: 2 }), tableHtml(two, { groupSize: 2 })]);
});

test("a table where a row id repeats is written whole every time", () => {
  const sheet = clone(SHEET);
  sheet.rows[3].id = "r0";
  const writer = createSheetWriter({ groupSize: 2 });
  writer.table("s", sheet);
  sheet.rows[3].cells[0].text = "second r0";
  expect(writer.table("s", sheet)).toBe(tableHtml(sheet, { groupSize: 2 }));
});
