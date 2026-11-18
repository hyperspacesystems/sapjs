// node test/mutations/grid-plugin.mjs [plugin-echo|plugin-changes|plugin-full|plugin-paused|plugin-on-table
//   |plugin-schedule|plugin-per-change|plugin-remove-parent|plugin-forget|plugin-forget-dispose
//   |plugin-api-map|plugin-unmount|plugin-ownership-old|plugin-lint-list|plugin-lint-follow
//   |plugin-lint-claim|plugin-maywrite|plugin-load-repairs|plugin-disposed]
// Each entry puts one bug back into the grid plugin, or into the row read it relies on, and names
// the test that must then fail. With no argument every entry runs, one after another.
import { pathToFileURL } from "node:url";

import { mutate } from "./harness.mjs";

const PLUGIN = "src/plugins/grid.js";
const TEST = "test/grid/plugin.test.js";

const RAW = 'a raw td.textContent = "5" gives one event with source "dom", the mirror has 5, the old v is gone and n is on the cell, with no extra pass';
const LINT = "Sap.report lists each issue code of a damaged table once, the list follows the table's issues, and the app keeps running";
const FORGOTTEN = "a removed table is forgotten: its Grid is let go, and the table is read fresh if it comes back";

const plugin = (what, find, replace, name, expects = /toEqual|toBe/) => ({ what, file: PLUGIN, find, replace, test: TEST, name, expects });

export const MUTATIONS = {
  "plugin-echo": {
    what: "the row read returns its lists even when the rows match the mirror, so the grid's own write is read as foreign",
    file: "src/grid/backing-dom.js",
    find: "    return rows.length > 0 || cells.length > 0 ? { rows, cells } : null;",
    replace: "    return { rows, cells };",
    test: TEST,
    name: "the grid's own write gives exactly one event",
    expects: /toEqual|toBe/,
  },
  "plugin-changes": plugin("begin ignores pass.changes", "        for (const [known, nodes] of touched) known.foreignWrite(nodes);\n", "", RAW),
  "plugin-full": plugin(
    "a full pass does not read a known table again",
    "          if (known !== undefined && pass.changes === null) known.rescan();\n",
    "",
    "Sap.refresh() reads every known table again",
  ),
  "plugin-paused": plugin(
    "the grid writes its derived parts outside kit.write",
    "const options = { write: kit.write,",
    "const options = { write: (fn) => fn(),",
    "a write schedules one pass, and a write of derived parts only lists no change in it",
  ),
  "plugin-on-table": plugin('the boundary drops on: "table"', 'boundaries: { grid: { opaque: true, on: "table" } },', "boundaries: { grid: { opaque: true } },", "a grid attribute on a div is ignored", /takes a <table grid> element|toEqual|toBe/),
  "plugin-schedule": plugin(
    "an applied write asks for no pass",
    'schedule: (table) => kit.schedule(table, "plugin:grid") };',
    "schedule: () => {} };",
    "on a page whose hub reports no change, a write still schedules one pass, with an empty change list, and a dependent repaints",
  ),
  "plugin-per-change": plugin(
    "each change is handed to the grid on its own",
    "        for (const [known, nodes] of touched) known.foreignWrite(nodes);",
    "        for (const [known, nodes] of touched) for (const node of nodes) known.foreignWrite([node]);",
    RAW,
  ),
  "plugin-remove-parent": plugin(
    "a removal is looked up from the removed node, which has left the table",
    'const at = change.type === "remove" ? change.parent : change.element;',
    "const at = change.element;",
    "a raw removal inside a row is read from the row it left",
  ),
  "plugin-forget": plugin("begin keeps tables that left the page", "        for (const [table, known] of tables) if (!table.isConnected) forget(table, known);\n", "", FORGOTTEN),
  "plugin-forget-dispose": plugin("forgetting a table keeps its Grid", "      unlist(table);\n      known.dispose();\n", "      unlist(table);\n", FORGOTTEN),
  "plugin-api-map": plugin(
    "Sap.grid makes a Grid the plugin does not know",
    "      tables.set(table, known);\n",
    "",
    "Sap.grid exists after install, and Sap.use called twice still gives one grid per table",
  ),
  "plugin-unmount": plugin("dispose keeps every Grid", "        for (const [table, known] of tables) forget(table, known);\n", "", "Sap.unmount leaves no listener"),
  "plugin-ownership-old": plugin(
    "the old rules are back: a formula cell's text and v and a value cell's shown text are painted",
    'ownership: [{ within: TABLE, select: "td", attrs: ["n"] }],',
    'ownership: [\n    { within: TABLE, select: "td[f]", text: true, attrs: ["v"] },\n    { within: TABLE, select: "td[v]:not([f])", text: true },\n    { within: TABLE, select: "td", attrs: ["n"] },\n  ],',
    "painted parts:",
  ),
  "plugin-lint-list": plugin("issues are never listed", "      if (codes.length === 0) return;\n", "      return;\n", LINT),
  "plugin-lint-follow": plugin(
    "the list is made once and never follows the issues",
    "if (before !== undefined && before.diag === diag && before.codes.join() === codes.join()) return;",
    "if (before !== undefined) return;",
    LINT,
  ),
  "plugin-lint-claim": plugin("lint does not know the table's own attributes", 'const OWN_ATTRIBUTES = ["freeze-cols", "stale"];', "const OWN_ATTRIBUTES = [];", LINT),
  "plugin-maywrite": plugin(
    "the grid is told every page may write",
    "mayWrite: kit.mayWrite,",
    "mayWrite: () => true,",
    "a read-only page refuses every command, and still takes a write from outside the grid",
  ),
  "plugin-load-repairs": plugin(
    "the plugin repairs a damaged table when it first meets it",
    "          list(pass, table, known ?? gridOf(table));\n",
    "          if (known === undefined && gridOf(table).issues.length > 0) gridOf(table).repair();\n          list(pass, table, known ?? gridOf(table));\n",
    "mount leaves the bytes of every fixture unchanged",
  ),
  "plugin-disposed": {
    what: "Sap.grid keeps returning a Grid the page disposed",
    file: PLUGIN,
    find: "      const known = createGrid(table, options);\n",
    replace: "      const known = tables.get(table) ?? createGrid(table, options);\n",
    test: "test/grid/plugin-dispose.test.js",
    name: "Sap.grid gives a live Grid again after the page disposed the one it had",
    expects: /toEqual|toBe/,
  },
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) mutate(MUTATIONS);
