// Writes the goldens that write.test.js pins: a file for the small fixtures and
// a byte length plus sha256 for the two that are too big to keep.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURES } from "./fixtures.js";
import { tableHtml } from "../../../src/grid/codec/write.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, "..", "golden");
const HASHED = ["budget-20k", "wide-100k"];

const tableBytes = (name) => FIXTURES[name]().sheets.map((sheet) => tableHtml(sheet)).join("\n");

mkdirSync(GOLDEN, { recursive: true });

const hashes = {};
for (const name of HASHED) {
  const bytes = Buffer.from(tableBytes(name), "utf8");
  hashes[name] = {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
writeFileSync(join(GOLDEN, "hashes.json"), JSON.stringify(hashes, null, 2) + "\n");

for (const name of Object.keys(FIXTURES)) {
  if (HASHED.includes(name)) continue;
  writeFileSync(join(GOLDEN, `${name}.html`), tableBytes(name));
}

console.log(`wrote ${Object.keys(FIXTURES).length} goldens to ${GOLDEN}`);
