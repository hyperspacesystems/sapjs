// A scratch copy of the project with one named mutation's bug put back, so a fuzzer can be shown
// able to fail. The working tree is never edited; the caller removes the copy when it is done.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { MUTATIONS as FORMAT_MUTATIONS } from "../../mutations/grid-format.mjs";
import { MUTATIONS as OPS_MUTATIONS } from "../../mutations/grid-ops.mjs";
import { scratchCopy } from "../../mutations/harness.mjs";

const MUTATIONS = { ...FORMAT_MUTATIONS, ...OPS_MUTATIONS };

// Returns the root of a copy of the project whose src holds the named bug, or throws.
export function planted(name) {
  const m = MUTATIONS[name];
  if (!m) throw new Error(`unknown plant "${name}"; known: ${Object.keys(MUTATIONS).join(", ")}`);
  const dir = scratchCopy();
  try {
    const path = join(dir, m.file);
    const source = readFileSync(path, "utf8");
    const hits = source.split(m.find).length - 1;
    if (hits !== 1) throw new Error(`plant "${name}": expected the text to replace exactly once in ${m.file}, found it ${hits} times`);
    writeFileSync(path, source.replace(m.find, () => m.replace));
    return dir;
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}
