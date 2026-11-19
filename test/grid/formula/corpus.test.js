// The conformance gate: every formula in the corpus that names only supported functions gives the
// value Google Sheets cached when it exported the workbook.
import { runCorpus } from "./support/corpus-run.js";

global.__SAP_KEEP_CONSOLE__ = true;

// Named differences. A86: Sheets' new tab has 1,000 rows, a sheet here has the rows that exist.
// A33 and A34: INDEX picking a whole row or column spills in Sheets (20, and #REF! where the spill
// is blocked); v1 has no spilled arrays, so a cell shows such a pick as #VALUE!.
const NAMED = new Set(["wb07.xlsx Sheet1!A86", "wb07.xlsx Sheet1!A33", "wb07.xlsx Sheet1!A34"]);

test("the corpus matches Google Sheets in every supported formula", () => {
  const out = runCorpus();
  const diffs = out.mismatches.filter((m) => !NAMED.has(`${m.file} ${m.sheet}!${m.ref}`));
  console.log(`corpus: matched ${out.matched} of ${out.total - out.skipped} supported formulas (${out.total} in all); unsupported: ${[...out.unsupported.keys()].join(", ") || "none"}`);
  expect(diffs.map((m) => `${m.file} ${m.sheet}!${m.ref} ${m.f} sheets ${JSON.stringify(m.want)} ours ${JSON.stringify(m.got)}`)).toEqual([]);
  expect(out.total).toBeGreaterThanOrEqual(288);
});
