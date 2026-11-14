import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { checkSheet } from "../../src/grid/check.js";
import { treeModel, domAdapter } from "../../src/grid/codec/canonical.js";
import { H, clean, sheet } from "./support/sheets.js";

global.__SAP_KEEP_CONSOLE__ = true;

const damaged = (damage) => {
  const model = clean();
  damage(model);
  return model;
};

const one = (code, at, id) => [{ code, ...at, ...(id === undefined ? {} : { id }) }];

test("clean sheet", () => {
  expect(checkSheet(clean())).toEqual([]);
});

test("col_id_missing", () => {
  const broken = damaged((model) => { model.cols[1].id = ""; });
  expect(checkSheet(broken)).toEqual(one("col_id_missing", { col: 1 }));
  expect(checkSheet(clean())).toEqual([]);
});

test("col_id_invalid", () => {
  const broken = damaged((model) => { model.cols[1].id = "no good"; });
  expect(checkSheet(broken)).toEqual(one("col_id_invalid", { col: 1 }, "no good"));
  expect(checkSheet(clean())).toEqual([]);
});

test("col_id_duplicate", () => {
  const broken = damaged((model) => { model.cols[2].id = "c1"; });
  expect(checkSheet(broken)).toEqual(one("col_id_duplicate", { col: 2 }, "c1"));
  expect(checkSheet(clean())).toEqual([]);
});

test("row_id_missing", () => {
  const broken = damaged((model) => { model.rows[2].id = ""; });
  expect(checkSheet(broken)).toEqual(one("row_id_missing", { row: 2 }));
  expect(checkSheet(clean())).toEqual([]);
});

test("row_id_invalid", () => {
  const broken = damaged((model) => { model.rows[2].id = "r 2"; });
  expect(checkSheet(broken)).toEqual(one("row_id_invalid", { row: 2 }, "r 2"));
  expect(checkSheet(clean())).toEqual([]);
});

test("row_id_duplicate", () => {
  const broken = damaged((model) => { model.rows[2].id = "r1"; });
  expect(checkSheet(broken)).toEqual(one("row_id_duplicate", { row: 2 }, "r1"));
  expect(checkSheet(clean())).toEqual([]);
});

test("shared id space", () => {
  const broken = damaged((model) => { model.rows[1].id = "c2"; });
  expect(checkSheet(broken)).toEqual(one("row_id_duplicate", { row: 1 }, "c2"));
  expect(checkSheet(clean())).toEqual([]);
});

test("col_pos_invalid", () => {
  const broken = damaged((model) => { model.cols[1].pos = ""; });
  expect(checkSheet(broken)).toEqual(one("col_pos_invalid", { col: 1 }));
  expect(checkSheet(clean())).toEqual([]);
});

test("col_pos_order", () => {
  const broken = damaged((model) => { model.cols[1].pos = "8"; });
  expect(checkSheet(broken)).toEqual(one("col_pos_order", { col: 1 }));
  expect(checkSheet(clean())).toEqual([]);
});

test("row_pos_invalid", () => {
  const broken = damaged((model) => { model.rows[2].pos = "?"; });
  expect(checkSheet(broken)).toEqual(one("row_pos_invalid", { row: 2 }));
  expect(checkSheet(clean())).toEqual([]);
});

test("row_pos_order", () => {
  const broken = damaged((model) => { model.rows[1].pos = "4"; });
  expect(checkSheet(broken)).toEqual(one("row_pos_order", { row: 1 }));
  expect(checkSheet(clean())).toEqual([]);
});

test("valid ties", () => {
  const tied = (ids) => sheet({
    cols: ["c0", "c1", "c2"],
    rows: ids.map((id) => [id, "5", ["x"]]),
  });
  expect(checkSheet(tied(["a", "b"]))).toEqual([]);
  expect(checkSheet(tied(["b", "a"]))).toEqual(one("row_pos_order", { row: 1 }));
});

test("row_too_long", () => {
  const broken = damaged((model) => { model.rows[0].cells = ["a", "b", "c", "d"].map((text) => ({ text })); });
  expect(checkSheet(broken)).toEqual(one("row_too_long", { row: 0 }));
  expect(checkSheet(clean())).toEqual([]);
});

test("merge_past_end", () => {
  const pastCols = damaged((model) => { model.rows[3].cells = [null, null, { text: "x", colspan: 2 }]; });
  expect(checkSheet(pastCols)).toEqual(one("merge_past_end", { row: 3, col: 2 }));
  const pastRows = damaged((model) => { model.rows[3].cells = [{ text: "x", rowspan: 2 }]; });
  expect(checkSheet(pastRows)).toEqual(one("merge_past_end", { row: 3, col: 0 }));
  expect(checkSheet(clean())).toEqual([]);
});

test("merge_overlap", () => {
  const overlapping = (tall) => sheet({
    cols: ["c0", "c1", "c2"],
    rows: [
      ["r0", "8", [tall ? { text: "A", rowspan: 2 } : "A", "b", "c"]],
      ["r1", "G", [{ text: "B", colspan: 2 }, H, "d"]],
    ],
  });
  expect(checkSheet(overlapping(true))).toEqual(one("merge_overlap", { row: 1, col: 0 }));
  expect(checkSheet(overlapping(false))).toEqual([]);
});

test("merge_uncovered", () => {
  const covered = (shown) => sheet({
    cols: ["c0", "c1", "c2"],
    rows: [
      ["r0", "8", ["a", "b", "c"]],
      ["r1", "G", [{ text: "B", colspan: 2 }, shown ? "shown" : H, "d"]],
    ],
  });
  expect(checkSheet(covered(true))).toEqual(one("merge_uncovered", { row: 1, col: 1 }));
  expect(checkSheet(covered(false))).toEqual([]);
});

test("hidden_orphan", () => {
  const orphan = (lost) => sheet({
    cols: ["c0", "c1", "c2"],
    rows: [
      ["r0", "8", ["a", "b", "c"]],
      ["r1", "G", ["a", lost ? H : "b", "c"]],
    ],
  });
  expect(checkSheet(orphan(true))).toEqual(one("hidden_orphan", { row: 1, col: 1 }));
  expect(checkSheet(orphan(false))).toEqual([]);
});

test("span_too_big", () => {
  const huge = sheet({
    cols: ["c1"],
    rows: [["r1", "8", [{ text: "x", colspan: 9999999, rowspan: 9999999 }]]],
  });
  const start = Date.now();
  const issues = checkSheet(huge);
  const took = Date.now() - start;
  expect(issues).toEqual([
    { code: "span_too_big", row: 0, col: 0 },
    { code: "merge_past_end", row: 0, col: 0 },
  ]);
  expect(took).toBeLessThan(200);
  expect(checkSheet(clean())).toEqual([]);
});

test("freeze_range", () => {
  const wide = damaged((model) => { model.freezeCols = 4; });
  expect(checkSheet(wide)).toEqual([{ code: "freeze_range" }]);
  const late = damaged((model) => { model.rows[2].frozen = true; });
  expect(checkSheet(late)).toEqual([{ code: "freeze_range" }]);
  expect(checkSheet(clean())).toEqual([]);
});

// merged.html is a byte-for-byte codec fixture shared with the Go mirror, so it stays as written. Its last row
// holds a rowspan="2" that runs past the end of the table: a real issue, which the repair (step R2) clamps.
const KNOWN = [{ file: "merged.html", table: 0, issues: [{ code: "merge_past_end", row: 3, col: 0 }] }];

test("a covered position past a short row's cells", () => {
  const short = sheet({ cols: ["a", "b", "c"], rows: [["r1", "1", [{ text: "Wide", colspan: 3 }]], ["r2", "2", ["x"]]] });
  expect(checkSheet(short)).toEqual([
    { code: "merge_uncovered", row: 0, col: 1 },
    { code: "merge_uncovered", row: 0, col: 2 },
  ]);
  const twin = sheet({ cols: ["a", "b", "c"], rows: [["r1", "1", [{ text: "Wide", colspan: 3 }, H, H]], ["r2", "2", ["x"]]] });
  expect(checkSheet(twin)).toEqual([]);
});

test("golden fixtures are clean", () => {
  const dir = join(__dirname, "..", "grid-codec", "golden");
  const files = readdirSync(dir).filter((name) => name.endsWith(".html"));
  const bad = [];
  let tables = 0;
  for (const file of files) {
    const html = readFileSync(join(dir, file), "utf8");
    const doc = new DOMParser().parseFromString("<!DOCTYPE html><body>" + html, "text/html");
    doc.querySelectorAll("table").forEach((table, index) => {
      tables++;
      const issues = checkSheet(treeModel(domAdapter, table));
      if (issues.length) bad.push({ file, table: index, issues });
    });
  }
  console.log(`${tables} golden table(s) checked in ${files.length} file(s)`);
  expect(tables).toBeGreaterThan(0);
  expect(bad).toEqual(KNOWN);
});
