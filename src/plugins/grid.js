// The grid plugin. A <table grid> in an app is a sheet: the engine stays out of it, and the
// plugin gives the table its Grid, keeps the Grid's mirror equal to the table, and adds Sap.grid.
//
// The grid's own content writes are ordinary DOM writes, so they come back in the next pass's
// change list like any other write. `begin` hands each known table the nodes that changed in it,
// and the Grid reads those rows and compares them with its mirror: rows the mirror already holds
// are the grid's own write coming back and cost one row read, and a difference is a write from
// outside the grid, which the Grid takes with one change event. A full pass cannot say what
// changed, so the boundary reads its table again. Derived parts go through `kit.write`, so they
// never come back as changes, and every applied write asks for a pass on its own.
//
// A table that left the page is forgotten at the next pass: its Grid is disposed, and Sap.grid
// makes a new one if the table comes back. The kinds of issue a sheet has are listed in its
// app's report, and the list follows the sheet: it changes when the issues change and goes when
// the sheet goes. Loading writes nothing. The manifest names the plugin, so the built engine
// loads it when a page has a <table grid>; its ownership rule is in ownership.js.

import { detectDelimiter, parseDelimited, protectField, writeDelimited } from "../grid/csv.js";
import { createSheetWriter } from "../grid/codec/cached-writer.js";
import { addFormatter, adjustDecimals, fmtKind, formatValue } from "../grid/format.js";
import { addFunctions } from "../grid/formula/functions.js";
import { tokenize } from "../grid/formula/text.js";
import { createGrid, createSheets, newId } from "../grid/grid.js";
import { editText, parseInput } from "../grid/input.js";
import { sheetCodec } from "../grid/room-codec.js";
import { MANIFEST } from "../plugin-manifest.js";

const TABLE = "table[grid]";

export default {
  ...MANIFEST.grid,
  version: "0.1.0",
  api: 1,

  setup(kit) {
    const tables = new Map();
    const listed = new Map();
    // The sheets each table belongs to, so an engine stops listening once its last table is gone.
    const sheetsOf = new Map();
    const rootOf = new Map();
    const options = { write: kit.write, mayWrite: kit.mayWrite, schedule: (table) => kit.schedule(table, "plugin:grid") };

    // The Grid of a <table grid>: the same object for the same table, loaded on the first call and
    // again after the page disposed it.
    function gridOf(table) {
      const known = createGrid(table, options);
      tables.set(table, known);
      return known;
    }
    Object.assign(gridOf, {
      parseInput,
      editText,
      formatValue,
      // A code's kind ("number", "date", "text", "unknown"), and the code with one more or one
      // fewer decimal, for a host's number-format menu and decimals buttons.
      fmtKind,
      adjustDecimals,
      // The formula tokenizer, which a host's editor reads for reference outlines and picking.
      tokenize,
      csv: { detectDelimiter, parseDelimited, writeDelimited, protectField },
      newId,
      createSheetWriter: () => createSheetWriter(),
      // The sheet's codec for a ClayJS room: `clay.liveRoom(name, { codec: Sap.grid.roomCodec, ... })`.
      roomCodec: sheetCodec,
      // Every tab under `root` as one workbook with one formula engine (`createSheets`), each
      // table's Grid known to the plugin as `Sap.grid(table)` gives it. `extra` holds the host's
      // own options: `locale` ("de"), `quiet(fn)` for load results that changed only through
      // TODAY or RAND, `now` and `random`.
      sheets(root, extra = {}) {
        const made = createSheets(root, { ...options, ...extra });
        const before = new Set();
        for (const table of root.querySelectorAll(":scope > section[item] > table[grid]")) {
          if (sheetsOf.has(table)) before.add(sheetsOf.get(table));
          tables.set(table, made.grid(table));
          sheetsOf.set(table, made);
        }
        rootOf.set(made, root);
        // A rebuild of the same root (a tab renamed by another tab) replaces the old engine, which
        // would otherwise write its old cells back when a plugin arrives.
        const live = new Set(sheetsOf.values());
        for (const old of before) {
          if (live.has(old)) continue;
          old.dispose();
          rootOf.delete(old);
        }
        return made;
      },
      // Functions and number formatters added from outside, such as the grid-functions and
      // grid-formats plugins: `functions` as [name, { run, volatile? }] entries, `formatters` as
      // format.js takes them. Open sheets compute and draw again. Returns what removes them all.
      extend({ functions = [], formatters = [] } = {}) {
        const removers = [addFunctions(functions), ...formatters.map(addFormatter)];
        return () => removers.forEach((remove) => remove());
      },
    });

    function forget(table, known) {
      tables.delete(table);
      unlist(table);
      known.dispose();
      const made = sheetsOf.get(table);
      sheetsOf.delete(table);
      // The engine goes with its page's last tab: tabs added since sheets() ran are not in sheetsOf.
      const root = rootOf.get(made);
      if (made === undefined || [...sheetsOf.values()].includes(made) || (root?.isConnected && root.querySelector(":scope > section[item] > table[grid]") !== null)) return;
      made.dispose();
      rootOf.delete(made);
    }

    // Each kind of issue a sheet has, once, in the report of the app the sheet is in.
    function list(pass, table, known) {
      const diag = pass.app.diag;
      const codes = [...new Set(known.issues.map((issue) => issue.code))];
      const before = listed.get(table);
      if (before !== undefined && before.diag === diag && before.codes.join() === codes.join()) return;
      unlist(table);
      if (codes.length === 0) return;
      const records = codes.map((code) =>
        diag.warn("W60", table, {
          attr: "grid",
          key: code,
          problem: `the sheet has the issue ${code}, so it refuses every write until it is repaired`,
          fix: "Sap.grid(table).repair() puts every issue right",
        }),
      );
      listed.set(table, { diag, codes, records });
    }

    function unlist(table) {
      const before = listed.get(table);
      if (before === undefined) return;
      listed.delete(table);
      const warnings = before.diag.warnings;
      for (const record of before.records) {
        const at = warnings.indexOf(record);
        if (at !== -1) warnings.splice(at, 1);
      }
    }

    return {
      boundaries: {
        grid(pass, table) {
          const known = tables.get(table);
          if (known !== undefined && pass.changes === null) known.rescan();
          list(pass, table, known ?? gridOf(table));
        },
      },
      begin(pass) {
        for (const [table, known] of tables) if (!table.isConnected) forget(table, known);
        if (pass.changes === null) return;
        const touched = new Map();
        for (const change of pass.changes) {
          const at = change.type === "remove" ? change.parent : change.element;
          const known = tables.get(at.closest(TABLE));
          if (known === undefined) continue;
          const nodes = touched.get(known);
          if (nodes === undefined) touched.set(known, [at]);
          else nodes.push(at);
        }
        for (const [known, nodes] of touched) known.foreignWrite(nodes);
      },
      flush: () => null,
      dispose() {
        for (const [table, known] of tables) forget(table, known);
      },
      api: { grid: gridOf },
    };
  },
};
