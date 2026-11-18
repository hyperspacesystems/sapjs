// A scratch copy of the project with one named mutation's bug put back, so a fuzzer can be shown
// able to fail. The working tree is never edited; the caller removes the copy when it is done.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { MUTATIONS as CSV_MUTATIONS } from "../../mutations/grid-csv.mjs";
import { MUTATIONS as FORMAT_MUTATIONS } from "../../mutations/grid-format.mjs";
import { MUTATIONS as LIVE_MUTATIONS } from "../../mutations/grid-live.mjs";
import { MUTATIONS as OPS_MUTATIONS } from "../../mutations/grid-ops.mjs";
import { MUTATIONS as PLUGIN_MUTATIONS } from "../../mutations/grid-plugin.mjs";
import { scratchCopy } from "../../mutations/harness.mjs";

// Bugs a fuzzer must catch that no mutation entry puts back. paint-replaces-text puts back the
// paint that writes a cell's text by replacing its text node, whatever the paint in the tree does.
const PLANTS = {
  "paint-replaces-text": {
    what: "a cell's text is written as a new text node, so a ClayJS undo two actions back puts the old node back beside the grid's",
    file: "src/grid/backing-dom.js",
    find: "function paint(td, cell) {",
    replace: [
      "function paint(td, cell) {",
      "  for (const name of ATTRIBUTES) setAttribute(td, name, attributeOf(cell, name));",
      "  if (td.textContent !== cell.text || td.firstElementChild !== null) td.textContent = cell.text;",
      "}",
      "",
      "function paintInTree(td, cell) {",
    ].join("\n"),
  },
};

const MUTATIONS = { ...FORMAT_MUTATIONS, ...OPS_MUTATIONS, ...CSV_MUTATIONS, ...LIVE_MUTATIONS, ...PLUGIN_MUTATIONS, ...PLANTS };

// The plan's names for planted bugs that an entry above already puts back.
const ALIASES = { "drop-n": "derive-n", "stale-dropped": "stale-early" };

// Returns the root of a copy of the project whose src holds the named bug, or throws.
export function planted(name) {
  const m = MUTATIONS[ALIASES[name] ?? name];
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
