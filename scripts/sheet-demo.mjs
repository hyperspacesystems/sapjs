// The S2 demo: a two-tab sheet document where a row goes in above a total. The total's formula
// keeps meaning the same five cells, the other tab's formula keeps meaning that total, and the
// undo gives back the same bytes on every tab. Prints the formulas before and after, then the
// three checks. Exits 1 when a check fails.

import { applyWorkbook, modelWorkbook } from "../src/grid/index.js";
import { buildInsertRows } from "../src/grid/build.js";
import { gridModel } from "../src/grid/codec/read.js";
import { tableHtml } from "../src/grid/codec/write.js";

const BUDGET = `<table grid><colgroup><col data-id="budgetA" data-pos="A"><col data-id="budgetB" data-pos="B"></colgroup>
<tbody>
<tr data-id="budget1" data-pos="A"><td></td><td n v="10">10</td></tr>
<tr data-id="budget2" data-pos="B"><td></td><td n v="20">20</td></tr>
<tr data-id="budget3" data-pos="C"><td></td><td n v="30">30</td></tr>
<tr data-id="budget4" data-pos="D"><td></td><td n v="40">40</td></tr>
<tr data-id="budget5" data-pos="E"><td></td><td n v="50">50</td></tr>
<tr data-id="budget6" data-pos="F"><td>Total</td><td n f="=SUM(B1:B5)" v="150">150</td></tr>
</tbody></table>`;

const NOTES = `<table grid><colgroup><col data-id="notesA" data-pos="A"><col data-id="notesB" data-pos="B"></colgroup>
<tbody>
<tr data-id="notes1" data-pos="A"><td>Total</td><td n f="=Budget!B6" v="150">150</td></tr>
</tbody></table>`;

const wb = modelWorkbook([
  { id: "s1", name: "Budget", pos: "A", sheet: gridModel(BUDGET, 0) },
  { id: "s2", name: "Notes", pos: "B", sheet: gridModel(NOTES, 0) },
]);

const formulas = () => {
  const [budget, notes] = wb.sheets().map((tab) => tab.backing);
  const total = budget.rows().findIndex((row) => row.id === "budget6");
  const note = notes.rows().findIndex((row) => row.id === "notes1");
  return [budget.cell(total, 1)?.f ?? null, notes.cell(note, 1)?.f ?? null];
};

const bytes = () => wb.sheets().map((tab) => tableHtml(tab.backing.sheet).replace("<table grid stale>", "<table grid>"));

let n = 0;
const newId = (prefix) => `${prefix}inserted${n++}`;

const first = bytes();
console.log(`before: ${formulas().join("  ")}`);

const step = applyWorkbook(wb, buildInsertRows(wb.sheets()[0].backing, "3", 1, { newId }));
console.log(`after:  ${formulas().join("  ")}`);

const [total, note] = formulas();
const checks = [total === "=SUM(B1:B6)", note === "=Budget!B7"];

const undone = step.out === "applied" ? applyWorkbook(wb, step.inverse) : step;
const back = bytes();
const same = undone.out === "applied" && back.every((html, i) => html === first[i]);
checks.push(same);

console.log(`the total keeps meaning the five rows: ${checks[0]}`);
console.log(`the other tab keeps meaning the total: ${checks[1]}`);
console.log(`undo gives back the same bytes: ${checks[2]}`);

if (checks.some((check) => check !== true)) process.exitCode = 1;
