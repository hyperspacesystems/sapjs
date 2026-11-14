import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { checkSheet } from "../../src/grid/check.js";
import { treeModel, domAdapter } from "../../src/grid/codec/canonical.js";
import { tableHtml } from "../../src/grid/codec/write.js";
import { contentOf, derive } from "../../src/grid/content.js";
import { normalizeSheet } from "../../src/grid/normalize.js";
import { rng } from "../grid-codec/support/rng.js";
import { damage } from "./support/damage.js";
import { sheet } from "./support/sheets.js";
import { keysBetween } from "../../src/grid/codec/order-keys.js";

global.__SAP_KEEP_CONSOLE__ = true;

const REPAIR = join(__dirname, "golden", "repair");
const GOLDEN = join(__dirname, "..", "grid-codec", "golden");

const read = (path) => readFileSync(path, "utf8");
const parse = (html) => new DOMParser().parseFromString("<!DOCTYPE html><body>" + html, "text/html");
const modelOf = (html) => treeModel(domAdapter, parse(html).querySelector("table"));

const names = readdirSync(REPAIR)
  .filter((name) => name.endsWith(".in.html"))
  .map((name) => name.slice(0, -".in.html".length))
  .sort();

// The one live-table fact the model cannot hold: a hidden cell that held this text.
const hiddenTextOf = (name) => (name === "hidden-text" ? [{ row: 0, col: 1, text: "kept" }] : undefined);

const repaired = (name) =>
  normalizeSheet(modelOf(read(join(REPAIR, `${name}.in.html`))), { derive, hiddenText: hiddenTextOf(name) });

// Every value with the column a browser shows it in (plan 4.7): the HTML table slot rules again,
// written here so the repair is not checked against itself. A cell's column is the first slot no
// earlier span in the row or in the rows above has taken, and a hidden cell is not drawn at all.
const contentsOf = (sheet) => {
  const rows = sheet.rows.length;
  const blocked = sheet.rows.map(() => new Set());
  return sheet.rows.map((row, r) => {
    let col = 0;
    const list = [];
    for (const cell of row.cells) {
      if (cell && cell.hidden) continue;
      while (blocked[r].has(col)) col++;
      const content = contentOf(cell);
      if (content !== null && content !== undefined) list.push(`${col}:${JSON.stringify(content)}`);
      const colspan = cell && cell.colspan > 1 ? cell.colspan : 1;
      const rowspan = cell && cell.rowspan > 1 ? cell.rowspan : 1;
      for (let i = 1; i < rowspan; i++) {
        if (r + i >= rows) continue;
        for (let j = 0; j < colspan; j++) blocked[r + i].add(col + j);
      }
      col += colspan;
    }
    return list;
  });
};

// The HTML table slot rules, written here again so the repair is not checked against itself.
function htmlSlots(table) {
  const rows = Array.from(table.querySelectorAll("tr"));
  const blocked = rows.map(() => new Set());
  const placed = rows.map(() => []);
  rows.forEach((tr, r) => {
    let col = 0;
    for (const td of Array.from(tr.children)) {
      if (td.localName !== "td" && td.localName !== "th") continue;
      while (blocked[r].has(col)) col++;
      const colspan = Math.max(1, Number(td.getAttribute("colspan") ?? 1));
      const rowspan = Math.max(1, Number(td.getAttribute("rowspan") ?? 1));
      placed[r][col] = td.textContent;
      for (let i = 0; i < rowspan; i++) {
        for (let j = 0; j < colspan; j++) {
          if (i === 0 && j === 0) continue;
          if (r + i >= rows.length) continue;
          if (i === 0) placed[r][col + j] = "";
          else blocked[r + i].add(col + j);
        }
      }
      col += colspan;
    }
  });
  return placed;
}

function goldenModels() {
  const models = [];
  for (const file of readdirSync(GOLDEN).filter((name) => name.endsWith(".html")).sort()) {
    const doc = parse(read(join(GOLDEN, file)));
    doc.querySelectorAll("table").forEach((table) => models.push(treeModel(domAdapter, table)));
  }
  return models;
}

test("repair pairs", () => {
  expect(names.length).toBeGreaterThan(0);
  for (const name of names) {
    const { sheet } = repaired(name);
    expect(tableHtml(sheet)).toBe(read(join(REPAIR, `${name}.out.html`)).trim());
    expect(checkSheet(sheet)).toEqual([]);
  }
});

test("a second run changes nothing", () => {
  for (const name of names) {
    const first = repaired(name);
    const again = normalizeSheet(first.sheet, { derive });
    expect(again.repairs).toEqual([]);
    expect(again.sheet).toEqual(first.sheet);
  }
});

test("two runs are equal", () => {
  for (const name of names) {
    const model = modelOf(read(join(REPAIR, `${name}.in.html`)));
    const options = { derive, hiddenText: hiddenTextOf(name) };
    expect(normalizeSheet(model, options)).toEqual(normalizeSheet(model, options));
  }
});

test("one row out of order rewrites one key", () => {
  const { repairs } = repaired("keys-out-of-order");
  const orders = repairs.filter((repair) => repair.code === "row_pos_order");
  expect(orders).toEqual([{ code: "row_pos_order", row: 4, from: "9", to: "t" }]);
});

// merged.html is a byte-for-byte codec fixture shared with the Go mirror, so it stays as written: its
// last row holds a rowspan="2" that runs past the end of the table, which the repair clamps.
const KNOWN = [{ file: "merged.html", table: 0, repairs: [{ code: "merge_past_end", row: 3, col: 0, from: "2 x 2", to: "2 x 1" }] }];

test("golden fixtures need no repair", () => {
  const files = readdirSync(GOLDEN).filter((name) => name.endsWith(".html")).sort();
  const bad = [];
  let tables = 0;
  for (const file of files) {
    parse(read(join(GOLDEN, file)))
      .querySelectorAll("table")
      .forEach((table, index) => {
        tables++;
        const { sheet, repairs } = normalizeSheet(treeModel(domAdapter, table));
        expect(checkSheet(sheet)).toEqual([]);
        if (repairs.length) bad.push({ file, table: index, repairs });
      });
  }
  console.log(`${tables} golden table(s) checked in ${files.length} file(s)`);
  expect(tables).toBeGreaterThan(0);
  expect(bad).toEqual(KNOWN);
});

test("plain HTML keeps every value in its column", () => {
  const slots = htmlSlots(parse(read(join(REPAIR, "plain-colspan.in.html"))).querySelector("table"));
  const { sheet } = repaired("plain-colspan");
  const values = slots.flat().filter((value) => Boolean(value));
  const wrong = [];
  slots.forEach((line, r) => {
    line.forEach((value, c) => {
      if (!value) return;
      const cell = sheet.rows[r] && sheet.rows[r].cells[c];
      if (!cell || cell.text !== value) wrong.push([r, c, value]);
    });
  });
  console.log(`${values.length} value(s) kept their HTML column in plain-colspan`);
  expect(values.length).toBeGreaterThan(0);
  expect(wrong).toEqual([]);
});

test("content is never changed", () => {
  const random = rng(20261118);
  const bases = goldenModels();
  expect(bases.length).toBeGreaterThan(0);
  let damagedWithIssue = 0;
  for (let copy = 0; copy < 2000; copy++) {
    const before = JSON.parse(JSON.stringify(bases[Math.floor(random() * bases.length)]));
    damage(before, random);
    if (checkSheet(before).length > 0) damagedWithIssue++;
    const { sheet } = normalizeSheet(before, copy % 2 === 0 ? { derive } : {});
    expect(contentsOf(sheet)).toEqual(contentsOf(before));
    expect(checkSheet(sheet)).toEqual([]);
  }
  console.log(`${damagedWithIssue} of 2000 damaged copies had an issue before the repair`);
  expect(damagedWithIssue).toBeGreaterThan(0);
});

// The damage Opus's review ran: golden copies broken at random, and every value must still sit in
// the column a browser shows it in after the repair.
test("a damaged copy keeps every value in its browser column", () => {
  const random = rng(7);
  const bases = goldenModels();
  expect(bases.length).toBeGreaterThan(0);
  const byDamage = {};
  let moved = 0;
  for (let copy = 0; copy < 3000; copy++) {
    const before = JSON.parse(JSON.stringify(bases[Math.floor(random() * bases.length)]));
    const names = damage(before, random);
    const shown = contentsOf(before);
    const { sheet } = normalizeSheet(before, copy % 2 === 0 ? { derive } : {});
    const after = contentsOf(sheet);
    if (JSON.stringify(after) !== JSON.stringify(shown)) {
      moved++;
      const key = [...new Set(names)].sort().join("+");
      byDamage[key] = (byDamage[key] ?? 0) + 1;
    }
    expect(after).toEqual(shown);
  }
  console.log(`${moved} of 3000 damaged copies moved a value out of its column: ${JSON.stringify(byDamage)}`);
  expect(moved).toBe(0);
});

test("a span past the HTML limits is clamped before any walk", () => {
  const huge = sheet({
    cols: ["c1"],
    rows: [["r1", "8", [{ text: "x", colspan: 9999999, rowspan: 9999999 }]]],
  });
  const start = Date.now();
  const { sheet: repairedSheet, repairs } = normalizeSheet(huge);
  const took = Date.now() - start;
  expect(repairs.filter((repair) => repair.code === "span_too_big")).toEqual([{ code: "span_too_big", row: 0, col: 0 }]);
  expect(repairedSheet.cols.length).toBeLessThanOrEqual(1000);
  expect(checkSheet(repairedSheet)).toEqual([]);
  expect(took).toBeLessThan(200);
});

test("an undone merge keeps the fmt and style of the cell it uncovers", () => {
  const model = sheet({
    cols: ["c1", "c2", "c3"],
    rows: [
      ["r1", "8", [{ text: "A", colspan: 2 }, { text: "", hidden: true, colspan: 2, fmt: "0.00", style: "color:#ff0000" }]],
      ["r2", "G", ["B", "C", "D"]],
    ],
  });
  const { sheet: repairedSheet, repairs } = normalizeSheet(model);
  expect(repairedSheet.rows[0].cells).toEqual([
    { text: "A" },
    { text: "", fmt: "0.00", style: "color:#ff0000" },
  ]);
  expect(repairs).toEqual([{ code: "merge_overlap", row: 0, col: 0 }]);
  expect(checkSheet(repairedSheet)).toEqual([]);
});

test("a merge undone for a hidden cell that held text is a hidden_text repair", () => {
  const { repairs } = repaired("hidden-text");
  expect(repairs).toEqual([{ code: "hidden_text", row: 0, col: 0 }]);
});

test("a format the grid does not know keeps the cell's text", () => {
  const html = `<table><colgroup><col data-id="c1" data-pos="8"></colgroup><tbody><tr data-id="r1" data-pos="8"><td n v="12345" fmt="0.0,&quot;k&quot;" style="font-weight:bold;color:#ff0000">12.3k</td></tr></tbody></table>`;
  const { sheet, repairs } = normalizeSheet(modelOf(html), { derive });
  expect(sheet.rows[0].cells[0]).toEqual({ text: "12.3k", n: true, v: "12345", fmt: "0.0,\"k\"", style: "font-weight:bold;color:#ff0000" });
  expect(repairs).toEqual([]);
});

test("the repair does not write hidden text over a value", () => {
  const model = sheet({
    cols: ["c1", "c2", "c3"],
    rows: [["r1", "8", ["Name", { text: "internal note", hidden: true }, "Amount"]]],
  });
  const { sheet: repairedSheet } = normalizeSheet(model, { derive, hiddenText: [{ row: 0, col: 1, text: "internal note" }] });
  expect(repairedSheet.rows[0].cells.map((cell) => cell && cell.text)).toEqual(["Name", "internal note", "Amount"]);
});

test("stacked huge spans repair under the bound", () => {
  const positions = keysBetween(null, null, 30);
  const rows = Array.from({ length: 30 }, (_, r) => [
    `r${r}`,
    positions[r],
    [0, 1, 2].map((m) => ({ text: `x${r}.${m}`, colspan: 1000, rowspan: 65534 })),
  ]);
  const model = sheet({ cols: [["c0", "G"]], rows });
  const started = Date.now();
  const { sheet: repairedSheet } = normalizeSheet(model, { derive });
  const took = Date.now() - started;
  expect(took).toBeLessThan(300);
  expect(repairedSheet.cols.length).toBeLessThanOrEqual(1000);
  expect(checkSheet(repairedSheet)).toEqual([]);
});

test("a hidden note beside a rowspan keeps every value in the column the browser draws", () => {
  const model = sheet({
    cols: ["c0", "c1", "c2", "c3"],
    rows: [
      ["r0", "8", ["Name", { text: "", hidden: true }, { text: "Amount", rowspan: 2 }]],
      ["r1", "G", ["Rent", "1200"]],
      ["r2", "O", ["Food", "300"]],
    ],
  });
  const { sheet: repairedSheet, repairs } = normalizeSheet(model, {
    derive,
    hiddenText: [{ row: 0, col: 1, text: "note" }],
  });
  expect(repairedSheet.rows.map((row) => row.cells)).toEqual([
    [{ text: "Name" }, { text: "note" }, { text: "Amount", rowspan: 2 }],
    [{ text: "Rent" }, { text: "1200", n: true }, { text: "", hidden: true }],
    [{ text: "Food" }, { text: "300", n: true }],
  ]);
  expect(repairs).toEqual([
    { code: "merge_uncovered", row: 1, col: 2 },
    { code: "cell_normal", row: 1, col: 1 },
    { code: "cell_normal", row: 2, col: 1 },
  ]);
  expect(contentsOf(repairedSheet)).toEqual([
    ['0:"Name"', '1:"note"', '2:"Amount"'],
    ['0:"Rent"', "1:1200"],
    ['0:"Food"', "1:300"],
  ]);
  expect(checkSheet(repairedSheet)).toEqual([]);
});

test("a thousand rows of stacked spans repair under the bound, in linear time", () => {
  const positions = keysBetween(null, null, 1000);
  const rows = Array.from({ length: 1000 }, (_, r) => [
    `r${r}`,
    positions[r],
    [0, 1, 2].map((m) => ({ text: `x${r}.${m}`, colspan: 1000, rowspan: 65534 })),
  ]);
  const model = sheet({ cols: [["c0", "G"]], rows });
  const started = Date.now();
  const { sheet: repairedSheet } = normalizeSheet(model, { derive });
  const took = Date.now() - started;
  expect(took).toBeLessThan(1000);
  expect(repairedSheet.cols.length).toBeLessThanOrEqual(1000);
  expect(checkSheet(repairedSheet)).toEqual([]);
});
