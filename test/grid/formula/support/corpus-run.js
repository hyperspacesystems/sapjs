// Runs the conformance corpus: each .xlsx workbook exported from Google Sheets is loaded into a
// model workbook, the engine computes it, and every formula cell is compared with the value Sheets
// cached. A formula naming a function the engine lacks is counted as unsupported, not compared.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { shown, typed } from "../../../../src/grid/codec/value.js";
import { createEngine } from "../../../../src/grid/formula/engine.js";
import { lookupFunction } from "../../../../src/grid/formula/functions.js";
import { tokenize } from "../../../../src/grid/formula/text.js";
import { modelWorkbook } from "../../../../src/grid/workbook-backing.js";
import { readXlsx } from "./xlsx.js";

// Run from the repo root, as npm test and the CLI both are.
export const CORPUS = join(process.cwd(), "test", "grid", "formula", "corpus");

const contentOf = (value) => {
  if (typeof value === "number") return { text: shown(value), n: true };
  if (typeof value === "boolean") return { text: value ? "TRUE" : "FALSE" };
  if (typeof value === "string") return typed(value) === value ? { text: value } : { text: value, t: true };
  return null;
};

const key = (i) => `k${String(i).padStart(5, "0")}`;

function workbookOf(sheets) {
  return modelWorkbook(
    sheets.map((sheet, s) => {
      const rows = Math.max(1, ...sheet.cells.map((cell) => cell.row + 1));
      const cols = Math.max(1, ...sheet.cells.map((cell) => cell.col + 1));
      const model = {
        cols: Array.from({ length: cols }, (_, c) => ({ id: `s${s}c${c}`, pos: key(c) })),
        rows: Array.from({ length: rows }, (_, r) => ({ id: `s${s}r${r}`, pos: key(r), cells: [] })),
      };
      for (const cell of sheet.cells) {
        const content = cell.f !== null ? { text: "", f: cell.f } : contentOf(cell.value);
        if (content === null) continue;
        const row = model.rows[cell.row].cells;
        while (row.length < cell.col) row.push(null);
        row[cell.col] = content;
      }
      return { id: `s${s}`, name: sheet.name, pos: key(s), sheet: model };
    }),
  );
}

const missing = (f) => tokenize(f.slice(1)).filter((token) => token.type === "name" && lookupFunction(token.value) === null).map((token) => token.value);

const same = (got, want) => {
  if (want !== null && typeof want === "object") return got !== null && typeof got === "object" && got.error === want.error;
  if (typeof want === "number") return typeof got === "number" && Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want));
  if (want === null || want === "") return got === null || got === "";
  return got === want;
};

// { matched, total, skipped, unsupported: Map(name -> formulas naming it), mismatches: [{ file, sheet,
// ref, f, want, got }] }: `skipped` counts formulas naming a function the engine lacks.
export function runCorpus(files = readdirSync(CORPUS).filter((name) => name.endsWith(".xlsx")).sort()) {
  const out = { matched: 0, total: 0, skipped: 0, unsupported: new Map(), mismatches: [] };
  for (const file of files) {
    const sheets = readXlsx(join(CORPUS, file));
    const engine = createEngine(workbookOf(sheets));
    engine.load();
    sheets.forEach((sheet, s) => {
      for (const cell of sheet.cells) {
        if (cell.f === null) continue;
        out.total += 1;
        const lacks = missing(cell.f);
        if (lacks.length > 0) {
          out.skipped += 1;
          for (const name of new Set(lacks)) out.unsupported.set(name, (out.unsupported.get(name) ?? 0) + 1);
          continue;
        }
        const got = engine.result(`s${s}`, `s${s}r${cell.row}`, `s${s}c${cell.col}`);
        if (same(got, cell.value)) out.matched += 1;
        else out.mismatches.push({ file, sheet: sheet.name, ref: cell.ref, f: cell.f, want: cell.value, got });
      }
    });
    engine.dispose();
  }
  return out;
}
