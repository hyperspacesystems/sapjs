// Writes golden/host-vectors.json, what a host port of the strict reader and the
// value rule (HTML Clay's Go) checks itself against: every golden table and every
// hostile input with the scan result, seeded one-character mutants of two
// fixtures with theirs, and the value rule's cases plus seeded numbers.
// Offsets are left out on purpose: JavaScript counts UTF-16 units, Go counts bytes.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURES } from "./fixtures.js";
import { rng } from "./rng.js";
import { scanAt } from "./scan-helpers.js";
import { MISSES } from "./hostile-cases.js";
import { CELLS, SHOWN } from "./value-cases.js";
import { tableHtml } from "../../../src/grid/codec/write.js";
import { shown, typed } from "../../../src/grid/codec/value.js";
import { patchGrid } from "../../../src/grid/codec/patch.js";
import { buildKeys } from "./key-vectors.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, "..", "golden");
const GOLDENS = ["tiny", "merged", "styled", "formulas-formatted", "empty", "two-tabs", "escapes", "hidden", "tall-merge"];
const SEED = 20261111;
const MUTANTS = 400;
const NUMBERS = 1000;
const CHARACTERS = ["<", ">", "&", '"', "'", "=", "/", " ", "\t", "\n", "\r", "\0", "A", "a", "0", ";"];

const result = (src) => {
  const out = scanAt(src, 0);
  if (out.verdict === "miss") return { verdict: "miss" };
  return { verdict: "accept", table: out.table, cols: out.cols, rows: out.rows };
};

const scan = [];
for (const name of GOLDENS) {
  const src = readFileSync(join(GOLDEN, `${name}.html`), "utf8");
  const at = src.indexOf("<table grid");
  const table = src.slice(at, scanAt(src, at).end);
  scan.push({ name: `golden ${name}`, src: table, ...result(table) });
}
for (const [what, src] of MISSES) scan.push({ name: `hostile ${what}`, src, ...result(src) });

const random = rng(SEED);
const sources = [tableHtml(FIXTURES.tiny().sheets[0]), tableHtml(FIXTURES.escapes().sheets[0])];
for (let n = 0; scan.length < GOLDENS.length + MISSES.length + MUTANTS; n++) {
  const src = sources[n % 2];
  const at = Math.floor(random() * src.length);
  const op = Math.floor(random() * 3);
  const character = CHARACTERS[Math.floor(random() * CHARACTERS.length)];
  const mutant =
    op === 0
      ? src.slice(0, at) + character + src.slice(at)
      : op === 1
        ? src.slice(0, at) + src.slice(at + 1)
        : src.slice(0, at) + character + src.slice(at + 1);
  if (!mutant.isWellFormed()) continue;
  scan.push({ name: `mutant ${n}`, src: mutant, ...result(mutant) });
}

const numbers = [];
for (let n = 0; n < NUMBERS; n++) {
  const magnitude = 10 ** (Math.floor(random() * 30) - 12);
  const value = (random() - 0.5) * magnitude;
  const rounded = n % 3 === 0 ? Math.round(value * 100) / 100 : value;
  numbers.push([rounded, shown(rounded), typed(shown(rounded))]);
}

// Exact ties at the 15th digit: shown rounds them up (away from zero), as
// toExponential does; Go's strconv rounds half to even and must not be used as is.
const TIES = [1234567890123455, 1234567890123445, 9007199254740985, -1234567890123455, 100000000000000.5, 0.5];
for (const value of TIES) numbers.push([value, shown(value), typed(shown(value))]);

const values = {
  cells: CELLS.map(([name, cell, expected]) => [name, cell, expected]),
  shown: SHOWN.filter(([value]) => !Object.is(value, -0)).map(([value, text]) => [value, text]),
  numbers,
};

// patchGrid on golden tables: the bytes and changed counts, or the refusal. Appended
// rows are named n1, n2, ... (a counter per case), so every host gets the same bytes.
const golden = (name) => scan.find((entry) => entry.name === `golden ${name}`).src;
const frozenOnly = tableHtml({ cols: [{ id: "ca", pos: "G" }, { id: "cb", pos: "V" }], rows: [{ id: "h1", pos: "G", frozen: true, cells: [{ text: "Name" }, { text: "Qty" }] }] });
const plainBook = (cells, extra = {}) =>
  tableHtml({ cols: [{ id: "pa", pos: "G" }, { id: "pb", pos: "V" }], rows: [{ id: "p1", pos: "G", cells }], ...extra });
const many = (n) => Array.from({ length: n }, (_, i) => [`row ${i + 1}`, i + 1]);
const PATCHES = [
  ["one number", "tiny", [{ range: "B3", values: [[450]] }]],
  ["a rectangle of mixed values", "tiny", [{ range: "A2:C3", values: [["Rent2", 1300, "=B2/B$5"], [null, true, "0123"]] }]],
  ["text the rule would read as a value", "tiny", [{ range: "A2:A5", values: [["TRUE"], ["123"], ["12.50"], ["-0"]] }]],
  ["a formula, an empty string and a cleared cell", "tiny", [{ range: "A2:C2", values: [["=SUM(B2:B3)", "", null]] }]],
  ["numbers print with at most 15 digits", "tiny", [{ range: "B2:B3", values: [[0.1 + 0.2], [1234567890123445]] }]],
  ["a line break is normalized", "tiny", [{ range: "A3", values: [["a\r\nb\rc"]] }]],
  ["a single cell takes a wider value row", "tiny", [{ range: "A2", values: [["x", "y"]] }]],
  ["append two rows", "tiny", [{ append: [["Porto", 12], ["x"]] }]],
  ["set and append in one patch", "tiny", [{ range: "B2", values: [[1]] }, { append: [["z", 2, 3]] }]],
  ["append past a full group", "tiny", [{ append: many(60) }]],
  ["append to a sheet with only a frozen row", frozenOnly, [{ append: [["a", 1], ["b", 2]] }]],
  ["merged anchor keeps its span", "merged", [{ range: "A1", values: [["new"]] }]],
  ["a number under a column format marks a sheet with no formula stale", "hidden", [{ range: "B1", values: [[0.5]] }]],
  ["an appended number under a column format marks a sheet with no formula stale", "hidden", [{ append: [[1, 0.5]] }]],
  ["a formula into a sheet with no formula marks it stale", plainBook([{ text: "1", n: true }]), [{ range: "B1", values: [["=A1*2"]] }]],
  ["an appended formula marks a sheet with no formula stale", plainBook([{ text: "1", n: true }]), [{ append: [["=A1*2", "ok"]] }]],
  ["a number into a cell format under a plain column marks it stale", plainBook([{ text: "1.00", n: true, fmt: "0.00" }]), [{ range: "A1", values: [[2]] }]],
  ["a number under the Text format leaves no mark", plainBook([{ text: "x" }], { cols: [{ id: "pa", pos: "G", fmt: "@" }, { id: "pb", pos: "V" }] }), [{ range: "A1", values: [[1042]] }]],
  ["clearing the only formula leaves no mark", plainBook([{ text: "1", n: true }, { text: "", f: "=A1" }]), [{ range: "B1", values: [[null]] }]],
  ["text into a table already marked stale keeps the mark", plainBook([{ text: "x" }], { stale: true }), [{ range: "B1", values: [["y"]] }]],
  ["styled cell keeps its style and format", "styled", [{ range: "A1:B1", values: [[1, "x"]] }]],
  ["escapes survive a neighbour edit", "escapes", [{ range: "A1", values: [["<b> & \"q\""]] }]],
  ["a hidden row keeps hidden when a cell in it changes", "hidden", [{ range: "A2", values: [["x"]] }]],
  ["append after a group a merge made longer", "tall-merge", [{ append: many(40) }]],
  ["refuse an empty patch", "tiny", []],
  ["refuse an operation with range and append", "tiny", [{ range: "A1", values: [[1]], append: [[1]] }]],
  ["refuse values that are not rows", "tiny", [{ range: "A1", values: [1] }]],
  ["refuse a shape mismatch", "tiny", [{ range: "A1:B2", values: [[1, 2]] }]],
  ["refuse a range past the sheet", "tiny", [{ range: "Z99", values: [[1]] }]],
  ["refuse a bad range", "tiny", [{ range: "A0", values: [[1]] }]],
  ["refuse an object value", "tiny", [{ range: "A1", values: [[{}]] }]],
  ["refuse a NUL in text", "tiny", [{ range: "A1", values: [["a\u0000b"]] }]],
  ["refuse an appended row wider than the sheet", "tiny", [{ append: [[1, 2, 3, 4]] }]],
  ["refuse a write into a covered cell", "merged", [{ range: "B1", values: [["x"]] }]],
  ["refuse in the second operation with no partial result", "tiny", [{ range: "A2", values: [["ok"]] }, { range: "Z1", values: [[1]] }]],
  ["a hand-edited table is a miss", '<table grid><colgroup><col data-id="ca" data-pos="G"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="G"><td class="x">x</td></tr>\n</tbody></table>', [{ range: "A1", values: [[1]] }]],
];
const patches = PATCHES.map(([name, source, ops]) => {
  const src = source.startsWith("<") ? source : golden(source);
  let next = 0;
  try {
    const { bytes, changed, stale } = patchGrid(src, ops, { newId: () => `n${++next}` });
    return { name, src, ops, bytes, changed, stale };
  } catch (error) {
    return { name, src, ops, error: { type: error.name, code: error.code ?? null, message: error.message } };
  }
});

writeFileSync(join(GOLDEN, "host-vectors.json"), JSON.stringify({ scan, values, patches, keys: buildKeys() }) + "\n");
const accepted = scan.filter((entry) => entry.verdict === "accept").length;
console.log(`wrote ${scan.length} scan cases (${accepted} accepted), ${values.cells.length} cells, ${numbers.length} numbers, ${patches.length} patches (${patches.filter((p) => p.error).length} refused)`);
