// node test/grid/formula/corpus.mjs: the conformance corpus's match count, every unsupported
// function, and each formula whose result differs from the one Google Sheets cached.
import { runCorpus } from "./support/corpus-run.js";

const out = runCorpus();
const supported = out.total - out.skipped;
for (const m of out.mismatches) console.log(`DIFF ${m.file} ${m.sheet}!${m.ref} ${m.f}  sheets: ${JSON.stringify(m.want)}  ours: ${JSON.stringify(m.got)}`);
console.log(`matched ${out.matched} of ${supported} supported formulas (${out.total} in all); unsupported: ${[...out.unsupported].map(([name, n]) => `${name} ${n}`).join(", ") || "none"}`);
process.exitCode = out.mismatches.length > 0 ? 1 : 0;
