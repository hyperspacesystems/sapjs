import { FIXTURES } from "./support/fixtures.js";
import { rng } from "./support/rng.js";
import { rowHtml, colHtml, tableHtml } from "../../src/grid/codec/write.js";
import { scanAt } from "./support/scan-helpers.js";

const NAMES = Object.keys(FIXTURES);
const SEED = 20261111;
const MUTANTS = 2000;
const CHARACTERS = ["<", ">", "&", '"', "'", "=", "/", " ", "\t", "\n", "\r", "\0", "A", "a", "0", ";"];

function fixpoint(src, result) {
  for (const { row, bytes } of result.rows) expect(rowHtml(row)).toBe(bytes);
  const cols = result.cols.map(colHtml).join("");
  const at = src.indexOf("<colgroup>") + 10;
  expect(src.startsWith(cols, at)).toBe(true);
}

test("every fixture's every sheet is a fixpoint of the writer", () => {
  let rows = 0;
  for (const name of NAMES) {
    for (const sheet of FIXTURES[name]().sheets) {
      const src = tableHtml(sheet);
      const result = scanAt(src, 0);
      expect(result.verdict).toBe("accept");
      rows += result.rows.length;
      fixpoint(src, result);
    }
  }
  expect(rows).toBeGreaterThan(0);
});

test("2000 seeded mutants are either refused or a fixpoint", () => {
  const sources = [tableHtml(FIXTURES.tiny().sheets[0]), tableHtml(FIXTURES.escapes().sheets[0])];
  const random = rng(SEED);
  let accepted = 0;

  for (let n = 0; n < MUTANTS; n++) {
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

    const result = scanAt(mutant, 0);
    if (result.verdict !== "accept") continue;
    accepted++;
    fixpoint(mutant, result);
  }

  if (!(accepted > 0 && accepted < MUTANTS)) throw new Error(`accepted ${accepted} of ${MUTANTS} mutants`);
  expect(accepted).toBeGreaterThan(0);
  expect(accepted).toBeLessThan(MUTANTS);
});
