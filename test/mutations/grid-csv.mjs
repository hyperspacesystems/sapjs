// node test/mutations/grid-csv.mjs [csv-doubled-quote|csv-bom|csv-quote-newline|csv-protect|csv-protect-apostrophe|csv-width-spread|csv-empty-marker]
// Each entry puts one bug back into the delimited text codec and names the test that must
// then fail. With no argument every entry runs, one after another.
import { pathToFileURL } from "node:url";

import { mutate } from "./harness.mjs";

const CSV = "src/grid/csv.js";
const CSV_TEST = "test/grid/csv.test.js";

const csv = (what, find, replace, name, expects) => ({ what, file: CSV, find, replace, test: CSV_TEST, name, expects });

export const MUTATIONS = {
  "csv-doubled-quote": csv(
    "a doubled quote inside quotes ends the field",
    `if (text[i + 1] === '"') { field += '"'; i++; }`,
    `if (false) { field += '"'; i++; }`,
    "vectors",
    /toEqual|toBe/,
  ),
  "csv-bom": csv(
    "the BOM is kept",
    "const withoutBom = (text) => String(text).replace(/^\\uFEFF/, \"\");",
    "const withoutBom = (text) => String(text);",
    "vectors",
    /toEqual|toBe/,
  ),
  "csv-quote-newline": csv(
    "a field with a line break is written unquoted",
    "/^\\uFEFF|[\"\\r\\n]/.test(text)) return",
    "/^\\uFEFF|[\"]/.test(text)) return",
    "round trip",
    /toEqual|toBe/,
  ),
  "csv-protect": csv(
    "a leading minus is not protected",
    "const PROTECTED = /^[=+\\-@\\t\\r']/;",
    "const PROTECTED = /^[=+@\\t\\r']/;",
    "protect",
    /toBe|toEqual/,
  ),
  "csv-protect-apostrophe": csv(
    "a leading apostrophe is not protected, so export then import drops it",
    "const PROTECTED = /^[=+\\-@\\t\\r']/;",
    "const PROTECTED = /^[=+\\-@\\t\\r]/;",
    "protect",
    /toBe|toEqual/,
  ),
  "csv-width-spread": csv(
    "the width is found by spreading every record into Math.max",
    "  let width = 0;\n  for (const r of records) if (r.length > width) width = r.length;\n",
    "  const width = Math.max(0, ...records.map((r) => r.length));\n",
    "large files",
    /RangeError|Maximum call stack|toThrow|thrown/,
  ),
  "csv-empty-marker": csv(
    "every one-field empty row is written as two quotes",
    "const alone = row.length === 1 && r === rows.length - 1;",
    "const alone = row.length === 1;",
    "writing",
    /toBe|toEqual/,
  ),
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) mutate(MUTATIONS);
