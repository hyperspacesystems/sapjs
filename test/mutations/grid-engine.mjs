// node test/mutations/grid-engine.mjs [lost-always-false|tab-action-rebind|same-text-skip|
//   meaning-skip|self-edge|range-edges|range-coverage|place-seeding|announce|early-grid|
//   tab-action-event|outside-write|same-text-result|place-other-tab|unknown-format|regrouped|
//   past-edge-blanks|criteria-text-number|sum-range-shape|error-range|compare-digits|
//   loud-own-result]
// Each entry removes one rule from the formula engine, the workbook apply or the Grid and names the
// test that must then fail. With no argument every entry runs, one after another. An entry no test
// kills is reported, not dropped.
// The reducer's `computed` stale skip and the stale refresh not waiting on formulas with an engine
// have no entry: the engine's settle() clears the mark in the same step, so neither changes what
// anyone sees (S3 plan, Deferred).
import { mutate } from "./harness.mjs";

const ENGINE = "src/grid/formula/engine.js";
const GRID = "src/grid/grid.js";
const OPS = "src/grid/ops.js";

const ENGINE_TEST = "test/grid/formula/engine.test.js";
const GRID_TEST = "test/grid/grid-engine.test.js";
const GATE = "test/grid/formula/engine-grid.test.js";
const FUNCTIONS = "src/grid/formula/functions.js";
const FUNCTIONS_TEST = "test/grid/formula/functions.test.js";
const SHEETS_CASES = "each function and operator gives what Google Sheets gives";
const RED = /expect|Expected|Received|toBe|toEqual/;

mutate({
  "lost-always-false": {
    what: "a formula holding a record the step deleted is not bound again (rule 7 can leave its text the same)",
    file: ENGINE,
    find: "  const lost = (entry) =>\n    entry.refs.some((ref) => {",
    replace: "  const lost = (entry) =>\n    false && entry.refs.some((ref) => {",
    test: ENGINE_TEST,
    name: "a formula whose row a plain write deleted reads the cell its text names",
    expects: RED,
  },
  "tab-action-rebind": {
    what: "a formula naming a tab is not bound again after a tab action, though the same text names other cells",
    file: ENGINE,
    find: "        if (entry.floating || (renamed && entry.named) || lost(entry)) {",
    replace: "        if (entry.floating || false || lost(entry)) {",
    test: ENGINE_TEST,
    name: "a formula naming a tab by a name it no longer has is #REF! after a rename outside the workbook apply",
    expects: RED,
  },
  "same-text-skip": {
    what: "a changed formula cell whose text is the same is not bound again after a structural step",
    file: ENGINE,
    find: "        if (!reframed && old?.f === cell.f) {",
    replace: "        if (old?.f === cell.f) {",
    test: GATE,
    name: "a full computation after every step finds the results the engine holds",
    expects: RED,
  },
  "meaning-skip": {
    what: "a formula a rewrite printed again is never computed, even when it now means other cells",
    file: ENGINE,
    find: "        if (old !== undefined && results.has(key) && meaning(old) !== null && meaning(old) === meaning(entry)) {",
    replace: "        if (old !== undefined && results.has(key) && meaning(old) !== null) {",
    test: GATE,
    name: "a full computation after every step finds the results the engine holds",
    expects: RED,
  },
  "self-edge": {
    what: "a formula that reads its own cell is not an edge, so it is not a cycle",
    file: ENGINE,
    find: "      if (target === i) self.add(i);\n",
    replace: "",
    test: ENGINE_TEST,
    name: "a two-formula cycle and a formula that reads itself get #REF! with reason circular",
    expects: RED,
  },
  "range-edges": {
    what: "a range makes no edge to the formulas it covers, so a cycle through a range is not seen",
    file: ENGINE,
    find: "          if (r >= box[0] && r <= box[1] && c >= box[2] && c <= box[3]) edge(i, j);",
    replace: "          if (false) edge(i, j);",
    test: GATE,
    name: "a full computation after every step finds the results the engine holds",
    expects: RED,
  },
  "range-coverage": {
    what: "a changed cell does not dirty the formulas whose range covers it",
    file: ENGINE,
    find: "        if (box !== null && r >= box[0] && r <= box[1] && c >= box[2] && c <= box[3]) take(item.entry);",
    replace: "        if (false) take(item.entry);",
    test: ENGINE_TEST,
    name: "computed after an edit counts only the formulas that read it",
    expects: RED,
  },
  "place-seeding": {
    what: "a ROW() or COLUMN() formula on a tab whose rows or columns moved is not computed again",
    file: ENGINE,
    find: "        else if (entry.place && (moved.has(entry.sheet) || entry.refs.some((ref) => moved.has(ref.s)))) seeds.push(entry.key);",
    replace: "        else if (false) seeds.push(entry.key);",
    test: ENGINE_TEST,
    name: "=ROW() follows its row after a row insert above it",
    expects: RED,
  },

  announce: {
    what: "a Grid never tells the engine what its step changed, so no other tab hears it or the results",
    file: GRID,
    find: "      if (engine !== null) engine.announce(out.changed, id);\n",
    replace: "",
    test: GRID_TEST,
    name: "Sap.grid.sheets registers each table, so Sap.grid(table) returns the same Grid as the engine's",
    expects: RED,
  },


  "early-grid": {
    what: "a Grid made before the page's engine stays the table's Grid",
    file: GRID,
    find: "  if (known !== undefined && (engine === null || engines.get(known) === engine)) return known;",
    replace: "  if (known !== undefined) return known;",
    test: GRID_TEST,
    name: "a Grid made before createSheets gives way to the engine's Grid",
    expects: RED,
  },
  "tab-action-event": {
    what: "a tab action through a Grid returns null, losing its inverse",
    file: GRID,
    find: "    const tabsChanged = engine !== null && out.changed.sheets.length > 0;",
    replace: "    const tabsChanged = false;",
    test: GRID_TEST,
    name: "a tab rename through a Grid returns its event, whose inverse takes it back",
    expects: RED,
  },
  "outside-write": {
    what: "a write from outside the grid is never told to the engine",
    file: GRID,
    find: "    recompute(event.rescanned ? null : event.cells);\n",
    replace: "",
    test: GRID_TEST,
    name: "a write from outside the grid computes the formulas that read it",
    expects: RED,
  },
  "same-text-result": {
    what: "a formula set again to its own text is skipped without its result written back",
    file: ENGINE,
    find: "          kept.push(old);\n",
    replace: "",
    test: ENGINE_TEST,
    name: "a set of a formula to the text it already has keeps its result in the cell",
    expects: RED,
  },
  "place-other-tab": {
    what: "ROW or COLUMN reading another tab is computed again only when its own tab moves",
    file: ENGINE,
    find: "(moved.has(entry.sheet) || entry.refs.some((ref) => moved.has(ref.s)))",
    replace: "moved.has(entry.sheet)",
    test: ENGINE_TEST,
    name: "=ROW(Budget!B2) on another tab follows a row insert on Budget",
    expects: RED,
  },
  "unknown-format": {
    what: "a result under a format no formatter knows is written plain over its saved text",
    file: ENGINE,
    find: '      if (fmtKind(effectiveFmt(cell, column)) === "unknown" && !isError(value) && cellValue(cell) === value) continue;\n',
    replace: "",
    test: ENGINE_TEST,
    name: "a result under a format no formatter knows keeps the text it was saved with",
    expects: RED,
  },
  regrouped: {
    what: "every range on a tab is computed again after any row or column change there",
    file: ENGINE,
    find: " && regrouped(ref, entry.parsed.refs[i])",
    replace: "",
    test: GATE,
    name: "the budget computes through createSheets, and a row insert computes only the ranges it lands in",
    expects: RED,
  },
  "past-edge-blanks": {
    what: "a range past the tab's edge counts no blanks there",
    file: FUNCTIONS,
    find: "    return count + range.outside;",
    replace: "    return count;",
    test: FUNCTIONS_TEST,
    name: SHEETS_CASES,
    expects: RED,
  },
  "criteria-text-number": {
    what: "a criterion that reads as a number matches only numbers, not the same text",
    file: FUNCTIONS,
    find: '      equal = (value) => sameNumber(value, operand) || (typeof value === "string" && value.toLowerCase() === text);',
    replace: "      equal = (value) => value === operand;",
    test: FUNCTIONS_TEST,
    name: SHEETS_CASES,
    expects: RED,
  },
  "sum-range-shape": {
    what: "a SUMIF sum range of another shape is read past its edge, outside the graph",
    file: FUNCTIONS,
    find: '  if (totalled.height !== first.height || totalled.width !== first.width) return error("#VALUE!");\n',
    replace: "",
    test: FUNCTIONS_TEST,
    name: "a SUMIF whose sum range is not the criteria's shape shows #VALUE!",
    expects: RED,
  },
  "error-range": {
    what: "a conditional function over a range that is an error counts zero matches",
    file: FUNCTIONS,
    find: "  for (let k = 0; k < pairs.length; k += 2) if (isError(pairs[k])) return pairs[k];\n",
    replace: "",
    test: FUNCTIONS_TEST,
    name: SHEETS_CASES,
    expects: RED,
  },
  "compare-digits": {
    what: "numbers compare at full float precision, so 0.1+0.2 is not 0.3",
    file: "src/grid/formula/values.js",
    find: "  if (ra === 0) return Number(a.toPrecision(15)) - Number(b.toPrecision(15));",
    replace: "  if (ra === 0) return a - b;",
    test: FUNCTIONS_TEST,
    name: SHEETS_CASES,
    expects: RED,
  },
  "loud-own-result": {
    what: "the result of a formula the step typed is not part of the step's edit",
    file: ENGINE,
    find: "(own !== null && own.has(entry.key) && tab.backing.loudly ? loud : writes)",
    replace: "writes",
    test: GRID_TEST,
    name: "a page undo of typing a formula over a number gives the number and the totals back",
    expects: RED,
  },
});
