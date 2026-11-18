// node test/grid/fuzz/engine-fuzz.mjs [--lists N] [--length L] [--seed S] [--out DIR] [--plant NAME] [--replay FILE]
// The engine fuzz of plan 6.4 (step D9). Each list mounts one golden table as a sheet of a sapjs
// page with the grid plugin installed, and a model backing beside it. Each step is one of: an
// action from the reducer's generator through Grid.apply; a Grid command with typed text (set,
// setRange, clear, format) through the Grid's dispatch; a write from outside the grid made on the
// DOM (a cell's text, a number cell's fmt, a whole row removed), taken by the next pass or by a
// full pass; a full pass with nothing changed; the table taken off the page and put back; or an
// undo as ClayJS makes one, of the last action or the last two, when each changed only cells and
// formats (the second is often a column format on a column the first wrote): the mutation records
// each action wrote outside a pause, put back last first on the DOM, one action at a time, each
// followed by the next pass or a full pass.
// After every step the live bytes equal the model's, save the `stale` mark, which the Grid sets and
// takes away by rules the reducer does not have (the model reads the live table again after a DOM
// write or an undo), the strict reader gives the bytes back, the bytes are in the normal form, the
// sheet has no issue, a table marked stale keeps the mark while a cell waits (a formula, or a
// number with no `v` showing its plain value under a format no formatter knows), an action that
// leaves a number waiting marks the table stale, and while no DOM write has come the live table is
// the tree its bytes parse to. After every step that is not an action, and at the end, a full read
// of the table finds what the mirror has. An action that changes the bytes fires one "api" event,
// one that changes nothing fires none (a batch whose parts cancel may still fire one), and its own
// writes never come back as a "dom" event. A row removed on the DOM is gone from the sheet with
// every other cell's content and format kept (the stale refresh may draw derived parts again), one
// "dom" event (and at most one "derived" one) and one revision. A DOM write leaves the value the
// value rule reads in the new text (the value it had, when the text is the one it showed), or the
// value the cell had under a new fmt. An undo gives back every cell's content and format from
// before its action (a formula's cached result is a derived part an undo leaves). A table taken off
// the page and put back loads with no edit: no write outside a pause, revision 0 and every cell's
// content and format kept, and no write at all unless it was marked stale. At the end the inverses
// of the actions since the last DOM write or undo, last first, give back the bytes they started
// from.
// Prints the per-kind applied and refused counts and exits 1 on a failure or on a count of zero (a
// run needs about 200 lists for every kind to come up). A failing list is cut down to the shortest
// one that still fails the same check and written to DIR/engine-fuzz-failure-<seed>.json.
// --plant NAME runs the engine (sapjs, the plugin, the Grid, the reducer, both backings) from a
// scratch copy of the project with that mutation put back; the checks stay this tree's.
// --replay FILE plays a written failure again and exits 1 when a check still fails.
import { JSDOM } from "jsdom";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/" });
for (const key of ["window", "document", "Node", "Element", "HTMLElement", "MutationObserver", "CustomEvent", "Event", "getComputedStyle"]) {
  globalThis[key] = key === "window" ? dom.window : dom.window[key];
}
const log = console.log;
console.log = console.warn = console.error = () => {};

const { rng } = await import("../../grid-codec/support/rng.js");
const { colName } = await import("../../../src/grid/a1.js");
const { canonicalGrid, domAdapter } = await import("../../../src/grid/codec/canonical.js");
const { gridModel } = await import("../../../src/grid/codec/read.js");
const { cellValue } = await import("../../../src/grid/codec/value.js");
const { tableHtml } = await import("../../../src/grid/codec/write.js");
const { contentOf, derive, effectiveFmt } = await import("../../../src/grid/content.js");
const { fmtKind, isBuiltin } = await import("../../../src/grid/format.js");
const { normalizeSheet } = await import("../../../src/grid/normalize.js");
const { genAction, shapeOf, SHAPES } = await import("../support/gen-actions.js");
const { listTables, splitTables } = await import("../support/laws.js");
const { agentHiddenText, agentSheet } = await import("../support/agent-sheet.js");
const { sameTree } = await import("../support/same-tree.js");
const { planted } = await import("./plant.mjs");

const NAME = "engine-fuzz";
const SHEET = "sheet";

const KINDS = ["set", "format", "insertRows", "deleteRows", "changeRows", "insertCols", "deleteCols", "changeCols", "merge", "unmerge", "freeze", "batch"];
const COMMANDS = ["cmd:set", "cmd:setRange", "cmd:clear", "cmd:format"];
const OUTSIDE = ["dom:text", "dom:fmt", "dom:row", "dom:full", "pass:full", "detach", "undo:changes", "undo:full", "undo:two", "undo:two-column"];
const MARKS = ["stale:kept", "stale:marked"];

const TYPED = ["7", "-3.5", "1,200", "0", "abc", "", "TRUE", "false", "3/14/2026", "9:30 PM", "50%", "$5", "=1+1", "'=x", "1e3", " 42 ", "0.1", "12345678901234567", "2026-03-14", "-$1,200.50", "02134", "two\nlines"];
const FMTS = ["0.00", "#,##0", "$#,##0.00", "0%", "0.0%", "m/d/yyyy", "@", null];
const STYLES = [{ "font-weight": "bold" }, { color: "#cc0000" }, { "background-color": "#eeeeee", "font-weight": null }, { "text-align": "center" }];

function options(argv) {
  const out = { lists: 20000, length: 24, seed: 1, out: null, plant: null, replay: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--lists") out.lists = Number(argv[++i]);
    else if (arg === "--length") out.length = Number(argv[++i]);
    else if (arg === "--seed") out.seed = Number(argv[++i]);
    else if (arg === "--out") out.out = argv[++i];
    else if (arg === "--plant") out.plant = argv[++i];
    else if (arg === "--replay") out.replay = argv[++i];
    else {
      log(`unknown option ${arg}`);
      process.exit(2);
    }
  }
  return out;
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const pick = (rand, list) => list[Math.floor(rand() * list.length)];
// The cells left waiting for an engine or a formatter, keyed by row and column id: a formula, whose
// stored result no engine has calculated again, and a number with no `v` showing its plain value
// under a format no formatter knows (`number`).
function waitingCells(sheet) {
  const found = [];
  sheet.rows.forEach((row, r) =>
    row.cells.forEach((cell, c) => {
      if (cell === null || cell === undefined || cell.hidden === true) return;
      const fmt = effectiveFmt(cell, sheet.cols[c]);
      const number = cell.n === true && cell.v === undefined && fmtKind(fmt) === "unknown";
      if (cell.f !== undefined || number) found.push({ key: `${row.id} ${sheet.cols[c]?.id}`, row: r, col: c, text: cell.text, fmt, formula: cell.f ?? null, number });
    }),
  );
  return found;
}

const waitSign = (one) => JSON.stringify([one.text, one.fmt, one.formula]);

const unstale = (bytes) => bytes.replace(/^(<table grid(?: freeze-cols="[0-9]+")?) stale/, "$1");
const blankValue = (value) => (value === "" ? null : value);

function firstDifference(actual, expected) {
  let at = 0;
  while (at < actual.length && at < expected.length && actual[at] === expected[at]) at++;
  return { offset: at, actual: actual.slice(Math.max(0, at - 40), at + 40), expected: expected.slice(Math.max(0, at - 40), at + 40) };
}

function tablesIn(dir) {
  const tables = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".html")).sort()) {
    splitTables(readFileSync(join(dir, file), "utf8")).forEach((src, index) => {
      tables.push({ name: `${file.replace(/\.html$/, "")}#${index}`, model: gridModel(src, 0) });
    });
  }
  tables.push({ name: "agent", model: agentSheet(), hiddenText: agentHiddenText });
  return tables;
}

const page = (bytes) => `<main sap><div items="sheets"><section item data-id="${SHEET}"><h2 bind="name">Sheet</h2>${bytes}</section></div></main>`;

// The page's undo as ClayJS has it: sapjs pauses it around every write that is not an edit, so the
// records outside a pause are the ones an undo puts back.
const recorder = { observer: null, depth: 0, unpaused: [], paused: 0 };
window.clay = {
  undo: {
    pause() {
      if (recorder.depth++ === 0 && recorder.observer !== null) recorder.unpaused.push(...recorder.observer.takeRecords());
    },
    resume() {
      if (--recorder.depth === 0 && recorder.observer !== null) recorder.paused += recorder.observer.takeRecords().length;
    },
  },
};
const takeUnpaused = () => {
  if (recorder.observer !== null) recorder.unpaused.push(...recorder.observer.takeRecords());
  return recorder.unpaused.splice(0);
};

// Puts records back, last first, as an undo does.
function revert(records) {
  for (const record of [...records].reverse()) {
    if (record.type === "characterData") record.target.data = record.oldValue;
    else if (record.type === "attributes") {
      if (record.oldValue === null) record.target.removeAttribute(record.attributeName);
      else record.target.setAttribute(record.attributeName, record.oldValue);
    } else {
      for (const node of record.addedNodes) node.remove();
      const next = record.nextSibling?.parentNode === record.target ? record.nextSibling : null;
      for (const node of record.removedNodes) record.target.insertBefore(node, next);
    }
  }
}

// Whether an action changes a column's format.
const formatsColumn = (action) => (action.t === "batch" ? action.actions.some(formatsColumn) : action.t === "changeCols" && action.cols.some((col) => "fmt" in col));

// The ids of the columns an action writes cells in or formats.
const columnsOf = (action) => {
  if (action.t === "batch") return action.actions.flatMap(columnsOf);
  if (action.t === "changeCols") return action.cols.map((col) => col.id);
  return (action.cells ?? []).filter(Array.isArray).map((cell) => cell[1]);
};

// The contents and formats a table's bytes hold: what an undo gives back. A formula's cached result
// is a derived part, written inside a pause, so an undo leaves it; the stale mark too.
function contents(bytes) {
  const sheet = gridModel(bytes, 0);
  const cell = (one) => one && { content: contentOf(one), fmt: one.fmt, style: one.style, colspan: one.colspan, rowspan: one.rowspan, hidden: one.hidden };
  return JSON.stringify({ ...sheet, stale: undefined, rows: sheet.rows.map((row) => ({ ...row, cells: row.cells.map(cell) })) });
}

// Record ids the Grid's commands mint come from crypto.getRandomValues; a seeded source per list
// makes a list replay with the same ids.
let idRandom = rng(1);
Object.defineProperty(globalThis, "crypto", {
  configurable: true,
  value: {
    getRandomValues(bytes) {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(idRandom() * 256);
      return bytes;
    },
  },
});

const opts = options(process.argv.slice(2));

let root = null;
try {
  if (opts.plant) root = planted(opts.plant);
  const base = root ? pathToFileURL(join(root, "src/")).href : new URL("../../../src/", import.meta.url).href;
  const load = (file) => import(base + file);
  const [sap, plugin, ops, backingModel, content] = await Promise.all([load("sap.js"), load("plugins/grid.js"), load("grid/ops.js"), load("grid/backing-model.js"), load("grid/content.js")]);
  const Sap = sap.default;
  Sap.use(plugin.default);
  const engine = { apply: ops.apply, GridRefused: ops.GridRefused, modelBacking: backingModel.modelBacking, derive: content.derive };

  const tables = tablesIn(fileURLToPath(new URL("../../grid-codec/golden/", import.meta.url)));
  for (const table of tables) table.start = normalizeSheet(clone(table.model), { derive, hiddenText: table.hiddenText }).sheet;
  if (opts.replay !== null) {
    process.exitCode = replay(engine, Sap, tables, opts.replay);
  } else {
    const spread = listTables(tables, opts.lists);
    const counts = {};
    const random = rng(opts.seed);
    let first = null;
    const started = Date.now();

    for (let index = 0; index < opts.lists && first === null; index++) {
      const table = tables.find((one) => one.name === spread[index]);
      const seed = Math.floor(random() * 4294967296);
      const run = play(engine, Sap, table.start, { seed, length: opts.length, counts });
      if (run.failure !== null) first = { table: table.name, list: index, seed, start: table.start, steps: run.steps, failure: run.failure };
      // A page yields between lists, as a browser does: the scheduler's zero-delay timer holds the
      // last page until it fires.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    if (first !== null) {
      let shortest = first.steps.slice(0, first.failure.step + 1);
      let cut = true;
      while (cut) {
        cut = false;
        for (let at = shortest.length - 1; at >= 0; at--) {
          const candidate = shortest.slice(0, at).concat(shortest.slice(at + 1));
          const again = play(engine, Sap, first.start, { seed: first.seed, recorded: candidate });
          if (again.failure !== null && again.failure.check === first.failure.check) {
            shortest = candidate;
            cut = true;
            break;
          }
        }
      }
      const last = play(engine, Sap, first.start, { seed: first.seed, recorded: shortest }).failure ?? first.failure;
      log(`${last.check}, on ${first.table}, list ${first.list}, step ${last.step}, seed ${first.seed}`);
      log(`  step ${JSON.stringify(shortest[last.step] ?? null)}`);
      log(`  detail ${JSON.stringify(last.detail)}`);
      log(`  shortest list of ${shortest.length}: ${JSON.stringify(shortest)}`);
      if (opts.out) {
        mkdirSync(opts.out, { recursive: true });
        const file = join(opts.out, `${NAME}-failure-${first.seed}.json`);
        writeFileSync(file, JSON.stringify({ seed: first.seed, table: first.table, list: first.list, check: last.check, detail: last.detail, steps: shortest }, null, 2) + "\n");
        log(`failure written to ${file}`);
      }
    }

    for (const kind of KINDS.concat(SHAPES, COMMANDS, OUTSIDE, MARKS)) {
      const one = counts[kind] ?? {};
      log(`${kind}: ${Object.entries(one).map(([what, n]) => `${what} ${n}`).join(", ") || "none"}`);
    }
    log(`lists ${opts.lists}, steps ${counts.steps ?? 0}, failures ${first === null ? 0 : 1}, ${Date.now() - started} ms`);

    const zero =
      KINDS.some((kind) => (counts[kind]?.applied ?? 0) === 0 || (counts[kind]?.refused ?? 0) === 0) ||
      SHAPES.some((shape) => (counts[shape]?.applied ?? 0) === 0) ||
      COMMANDS.concat(OUTSIDE, MARKS).some((kind) => (counts[kind]?.applied ?? 0) === 0);
    if (zero) log("one of the counts is zero");
    process.exitCode = first !== null || zero ? 1 : 0;
  }
} finally {
  if (root) rmSync(root, { recursive: true, force: true });
}

// A written failure played again: its steps on its table, with its seed. Returns the exit code.
function replay(engine, Sap, tables, file) {
  const saved = JSON.parse(readFileSync(file, "utf8"));
  const table = tables.find((one) => one.name === saved.table);
  const run = play(engine, Sap, table.start, { seed: saved.seed, recorded: saved.steps.filter((one) => !one.end) });
  if (run.failure === null) log(`${file}: every check passes`);
  else log(`${run.failure.check}, on ${saved.table}, step ${run.failure.step}, seed ${saved.seed}\n  detail ${JSON.stringify(run.failure.detail)}`);
  return run.failure === null ? 0 : 1;
}

// One list on a fresh page: generated from `seed` and `length`, or the `recorded` steps again.
// Returns the steps it took, concrete enough to replay, and the first failure or null.
function play(engine, Sap, start, { seed, length = 0, recorded = null, counts = null }) {
  const rand = rng(seed);
  idRandom = rng((seed ^ 0x5bd1e995) >>> 0);
  const count = (kind, what) => {
    if (counts === null) return;
    counts[kind] = counts[kind] ?? {};
    counts[kind][what] = (counts[kind][what] ?? 0) + 1;
  };

  document.body.innerHTML = page(tableHtml(start));
  const app = document.querySelector("[sap]");
  Sap._reset();
  Sap.mount(app);
  const section = app.querySelector("section");
  const table = section.querySelector("table");
  const observer = new MutationObserver(() => {});
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true, attributeOldValue: true, characterDataOldValue: true });
  recorder.observer = observer;
  recorder.depth = 0;
  takeUnpaused();
  const heard = [];
  const dispatched = [];
  let grid = null;
  const attach = () => {
    grid = Sap.grid(table);
    grid.on("change", (event) => heard.push(event));
    grid.dispatch = (action) => {
      dispatched.push(action);
      return grid.apply(action);
    };
  };
  attach();

  let model = engine.modelBacking(clone(start), { sheetId: SHEET });
  let baseBytes = tableHtml(model.sheet);
  let current = canonicalGrid(domAdapter, table);
  let inverses = [];
  let clean = true;
  let history = [];
  let chain = [];
  let marked = start.stale === true;
  let waiting = new Map(waitingCells(start).map((one) => [one.key, waitSign(one)]));
  const steps = [];
  let failure = null;

  const bytesNow = () => canonicalGrid(domAdapter, table);
  const fail = (check, detail = null) => {
    if (failure === null) failure = { check, step: steps.length - 1, detail };
    return failure;
  };
  const refusal = (run) => {
    try {
      return { event: run() };
    } catch (error) {
      if (!(error instanceof engine.GridRefused)) throw error;
      return { code: error.code };
    }
  };
  const resync = (bytes) => {
    model = engine.modelBacking(gridModel(bytes, 0), { sheetId: SHEET });
    baseBytes = tableHtml(model.sheet);
    inverses = [];
  };
  const rowElement = (id) => Array.from(table.rows).find((tr) => tr.getAttribute("data-id") === id) ?? null;
  const ref = (r, c) => `${colName(c)}${r + 1}`;

  // The cells a DOM write may target: written cells and empty ones inside a row, not covered, not
  // a formula, and under no format or a built-in one (a cell under a format the grid does not
  // know keeps what the DOM wrote); with `numbers`, only cells holding a number.
  function targets(numbers) {
    const found = [];
    const known = (fmt) => fmt === null || fmt === undefined || isBuiltin(fmt);
    model.rows().forEach((row, r) => {
      row.cells.forEach((cell, c) => {
        if (cell?.hidden === true || cell?.f !== undefined) return;
        if (!known(effectiveFmt(cell, model.cols()[c])) || !known(model.cols()[c]?.fmt ?? null)) return;
        if (numbers && typeof cellValue(cell) !== "number") return;
        if (!numbers && c >= model.cols().length) return;
        found.push({ row: row.id, col: model.cols()[c].id });
      });
    });
    return found;
  }

  // The data rows a person can delete from the DOM with nothing merged in them.
  function deletable() {
    if (model.rows().length < 3) return [];
    const frozen = model.frozen().rows;
    return model
      .rows()
      .filter((row, r) => r >= frozen && row.cells.every((cell) => cell === null || (cell.hidden !== true && cell.colspan === undefined && cell.rowspan === undefined)))
      .map((row) => row.id);
  }

  function box(rand) {
    const rows = model.rows().length;
    const cols = model.cols().length;
    const r = Math.floor(rand() * (rows + 1));
    const c = Math.floor(rand() * (cols + 1));
    return { r, c, h: 1 + Math.floor(rand() * 3), w: 1 + Math.floor(rand() * 3) };
  }

  function generate() {
    if (history.length > 0 && rand() < 0.35) return { undo: rand() < 0.5 ? "changes" : "full", back: history.length > 1 && rand() < 0.6 ? 2 : 1 };
    if (history.length === 1 && rand() < 0.3) {
      const cols = columnsOf(history[0].action)
        .map((id) => model.colIndex(id))
        .filter((c) => c >= 0);
      if (cols.length > 0) {
        const c = pick(rand, cols);
        return { command: "format", args: [`${colName(c)}:${colName(c)}`, { fmt: pick(rand, FMTS.filter((fmt) => fmt !== null)) }] };
      }
    }
    const roll = rand();
    if (roll < 0.62) return { action: genAction(rand, model, { invalidRate: 0.15 }) };
    if (roll < 0.76) {
      const kind = pick(rand, ["set", "set", "setRange", "clear", "format"]);
      const { r, c, h, w } = box(rand);
      if (kind === "set") return { command: "set", args: [ref(r, c), pick(rand, TYPED)] };
      if (kind === "setRange") {
        const block = Array.from({ length: h }, () => Array.from({ length: w }, () => pick(rand, TYPED)));
        const how = pick(rand, [{}, {}, { detect: false }, { formats: false }, { grow: true }]);
        return { command: "setRange", args: [ref(r, c), block, how] };
      }
      const area = `${ref(r, c)}:${ref(r + h - 1, c + w - 1)}`;
      if (kind === "clear") return { command: "clear", args: [area] };
      return { command: "format", args: [area, rand() < 0.6 ? { fmt: pick(rand, FMTS) } : { style: pick(rand, STYLES) }] };
    }
    const pass = rand() < 0.75 ? "changes" : "full";
    if (roll < 0.86) {
      const list = targets(false);
      if (list.length > 0) return { dom: "text", ...pick(rand, list), text: pick(rand, TYPED), pass };
    } else if (roll < 0.92) {
      const list = targets(true);
      if (list.length > 0) return { dom: "fmt", ...pick(rand, list), fmt: pick(rand, FMTS.filter((fmt) => fmt !== "@")), pass };
    } else if (roll < 0.95) {
      const list = deletable();
      if (list.length > 0) return { dom: "row", row: pick(rand, list), pass };
    } else if (roll < 0.98) {
      return { pass: "full" };
    } else {
      return { detach: true };
    }
    return { pass: "full" };
  }

  // The stale rules, on each state the page passes through: a table marked stale keeps the mark
  // while a cell waits, and an action (`api`) that leaves a number waiting marks the table stale.
  function staleRules(sheet, api) {
    const waits = waitingCells(sheet);
    const was = waiting;
    const kept = marked && waits.length > 0;
    marked = sheet.stale === true;
    waiting = new Map(waits.map((one) => [one.key, waitSign(one)]));
    if (kept && !marked) return fail("a waiting cell keeps the table stale", waits[0]);
    if (kept) count("stale:kept", "applied");
    const left = api ? waits.find((one) => one.number && was.get(one.key) !== waitSign(one)) : undefined;
    if (left !== undefined && !marked) return fail("an action that leaves a number waiting marks the table stale", left);
    if (left !== undefined) count("stale:marked", "applied");
    return null;
  }

  // The checks every state passes. `bytes` are the live table's bytes, read once per state. A full
  // read of the table (`whole`) runs after every step that wrote on the DOM or ran a pass, and at
  // the end of the list.
  function check(bytes = bytesNow(), whole = true) {
    current = bytes;
    const strict = gridModel(bytes, 0);
    if (tableHtml(strict) !== bytes) return fail("the strict reader gives the bytes back", firstDifference(tableHtml(strict), bytes));
    const normal = normalizeSheet(strict, { derive });
    if (normal.repairs.length > 0) return fail("every state is in the normal form", normal.repairs.slice(0, 4));
    if (grid.issues.length > 0) return fail("the sheet has no issue", grid.issues.map((issue) => issue.code));
    if (staleRules(strict, !whole)) return failure;
    if (clean) {
      const found = sameTree(table, bytes);
      if (found.length > 0) return fail("the live table is the tree its bytes parse to", found.slice(0, 4));
    }
    if (!whole) return null;
    heard.length = 0;
    if (grid.rescan()) return fail("a full read of the table finds what the mirror has", heard[0] ?? null);
    return null;
  }

  // Applies an action to the model and compares the outcome and the bytes with the live table's.
  function mirror(action, live, before) {
    const out = engine.apply(model, action, { derive: engine.derive });
    const said = out.out === "applied" ? "applied" : out.code;
    const did = live.code ?? "applied";
    if (said !== did) return fail("the live table answers as the model does", { live: did, model: said });
    const bytes = (current = bytesNow());
    if (unstale(bytes) !== unstale(tableHtml(model.sheet))) return fail("the live bytes are the model's", firstDifference(unstale(bytes), unstale(tableHtml(model.sheet))));
    // The stale mark alone fires no event (Grid.apply's contract); the stale rule is checked on its own.
    if (live.event === null && unstale(bytes) !== unstale(before)) return fail("an action that changes the bytes fires an event", firstDifference(unstale(bytes), unstale(before)));
    if (live.event && bytes === before && action.t !== "batch") return fail("an action that changes nothing fires no event", null);
    if (live.event) inverses.push(live.event.inverse);
    return null;
  }

  // What an undo of this step puts back: its records, when it applied an action. Row and column
  // changes are undone too, since the moves that keep the tbody groups are ordinary writes.
  function remember(action, live, before, records) {
    history = action !== null && live.event ? [...chain, { records, before, action, column: formatsColumn(action) }] : [];
  }

  function events(live, sync) {
    const told = sync.map((event) => event.source);
    const want = live.event ? ["api"] : [];
    if (told.join() !== want.join()) return fail("an action tells its listeners once", { told, event: live.event !== null && live.event !== undefined });
    Sap.flush();
    const echoed = heard.splice(0).map((event) => event.source);
    if (echoed.length > 0) return fail("the grid's own writes do not come back as a change", echoed);
    return null;
  }

  function step(one) {
    chain = history;
    history = [];
    takeUnpaused();
    if (one.end) return null;
    if (one.undo !== undefined) {
      const back = one.back ?? 1;
      if (chain.length < back) return null;
      const undone = chain.slice(-back).reverse();
      for (const [at, entry] of undone.entries()) {
        revert(entry.records);
        if (one.undo === "full") Sap.refresh();
        else Sap.flush();
        takeUnpaused();
        heard.length = 0;
        const bytes = bytesNow();
        if (contents(bytes) !== contents(entry.before)) return fail("an undo of an action's own records gives back every cell's content and format", { back, undone: at + 1, ...firstDifference(contents(bytes), contents(entry.before)) });
        if (at < undone.length - 1 && staleRules(gridModel(bytes, 0), false)) return failure;
      }
      count(`undo:${one.undo}`, "applied");
      if (back === 2) count("undo:two", "applied");
      if (back === 2 && undone[0].column) count("undo:two-column", "applied");
      const bytes = bytesNow();
      resync(bytes);
      return check(bytes);
    }
    if (one.action !== undefined) {
      const action = one.action;
      const before = current;
      heard.length = 0;
      const live = refusal(() => grid.apply(action));
      remember(action, live, before, takeUnpaused());
      count(action.t, live.code === undefined ? "applied" : "refused");
      const shape = shapeOf(action);
      if (shape !== null && live.code === undefined) count(shape, "applied");
      if (events(live, heard.splice(0)) || mirror(action, live, before)) return failure;
      return check(current, false);
    }

    if (one.command !== undefined) {
      const before = current;
      heard.length = 0;
      dispatched.length = 0;
      const live = refusal(() => grid[one.command](...one.args));
      remember(dispatched.length === 1 ? dispatched[0] : null, live, before, takeUnpaused());
      count(`cmd:${one.command}`, live.code !== undefined ? "refused" : live.event === null ? "unchanged" : "applied");
      if (events(live, heard.splice(0))) return failure;
      if (dispatched.length > 1) return fail("a command dispatches at most one action", dispatched.length);
      if (dispatched.length === 1) {
        if (mirror(dispatched[0], live, before)) return failure;
      } else if ((current = bytesNow()) !== before) return fail("a command that dispatched nothing changes nothing", firstDifference(current, before));
      if (check(current, false)) return failure;
      if (live.event && one.command === "set") {
        const at = one.args[0];
        const again = refusal(() => grid.set(at, grid.input(at)));
        if (again.code !== undefined || again.event !== null) return fail("a cell typed back as its own editor text changes nothing", { at, input: grid.input(at), out: again.code ?? "changed" });
      }
      return null;
    }

    if (one.dom !== undefined) {
      const tr = rowElement(one.row);
      if (tr === null) return null;
      const c = one.col === undefined ? -1 : model.colIndex(one.col);
      const td = c < 0 ? null : tr.children[c] ?? null;
      if (one.dom !== "row" && (td === null || td.hidden || td.hasAttribute("f"))) return null;
      const at = one.dom === "row" ? null : ref(model.rowIndex(one.row), c);
      const was = at === null ? null : grid.get(at);
      if (one.dom === "fmt" && typeof was !== "number") return null;
      if (one.dom === "row" && !deletable().includes(one.row)) return null;
      const hadT = td?.hasAttribute("t") === true;
      const oldText = td?.textContent ?? null;
      if (one.dom === "text") td.textContent = one.text;
      else if (one.dom === "fmt") {
        if (one.fmt === null) td.removeAttribute("fmt");
        else td.setAttribute("fmt", one.fmt);
      } else {
        tr.remove();
        model.removeRow(model.rowIndex(one.row));
      }
      count(`dom:${one.dom}`, "applied");
      if (one.pass === "full") count("dom:full", "applied");
      heard.length = 0;
      const revision = grid.revision;
      if (one.pass === "full") Sap.refresh();
      else Sap.flush();
      const told = heard.splice(0).map((event) => event.source);
      const bytes = bytesNow();
      if (one.dom === "row") {
        const want = tableHtml(model.sheet);
        if (contents(bytes) !== contents(want)) return fail("a row removed on the DOM is gone from the sheet", firstDifference(unstale(bytes), unstale(want)));
        if (grid.revision !== revision + 1 || !["dom", "dom,derived"].includes(told.join())) return fail("a row removed on the DOM is one change and one revision", { told, revisions: grid.revision - revision });
        if (unstale(bytes) !== unstale(want)) count("dom:row", "derived");
      }
      if (one.dom === "text") {
        const want = one.text === oldText ? blankValue(was) : blankValue(cellValue(one.text === "" ? null : { text: one.text, ...(hadT ? { t: true } : {}) }));
        if (blankValue(grid.get(at)) !== want) return fail("a cell's text written on the DOM reads as the value rule reads it", { at, text: one.text, value: grid.get(at), want });
      }
      if (one.dom === "fmt") {
        if (grid.get(at) !== was) return fail("a number cell keeps its value under a fmt written on the DOM", { at, fmt: one.fmt, value: grid.get(at), was });
        const want = one.fmt ?? model.cols()[c].fmt ?? null;
        if (grid.cell(at).effectiveFmt !== want) return fail("a fmt written on the DOM is the cell's format", { at, fmt: grid.cell(at).effectiveFmt, want });
      }
      if (one.dom !== "fmt") clean = false;
      resync(bytes);
      return check(bytes);
    }

    if (one.detach) {
      const parent = table.parentNode;
      const next = table.nextSibling;
      table.remove();
      Sap.flush();
      parent.insertBefore(table, next);
      takeUnpaused();
      recorder.paused = 0;
      heard.length = 0;
      Sap.flush();
      const unpaused = takeUnpaused().length;
      const paused = recorder.paused;
      const bytes = bytesNow();
      attach();
      if (unpaused > 0 || (paused > 0 && current === unstale(current)) || grid.revision !== 0 || contents(bytes) !== contents(current)) {
        return fail("a table put back loads with no edit", { unpaused, paused, revision: grid.revision, ...firstDifference(bytes, current) });
      }
      count("detach", "applied");
      if (paused > 0) count("detach", "derived");
      if (bytes !== current) resync(bytes);
      return check(bytes);
    }

    const before = current;
    heard.length = 0;
    Sap.refresh();
    count("pass:full", "applied");
    if (heard.length > 0) return fail("a full pass over a table nothing changed tells no listener", heard.map((event) => event.source));
    const bytes = bytesNow();
    if (bytes !== before) return fail("a full pass over a table nothing changed writes nothing", firstDifference(bytes, before));
    return check(bytes);
  }

  const total = recorded === null ? length : recorded.length;
  for (let i = 0; i < total && failure === null; i++) {
    const one = recorded === null ? generate() : recorded[i];
    steps.push(one);
    if (counts !== null) counts.steps = (counts.steps ?? 0) + 1;
    try {
      step(one);
    } catch (error) {
      fail("no step throws", String(error?.stack ?? error).split("\n").slice(0, 4).join(" | "));
    }
  }

  if (failure === null && check()) steps.push({ end: true });
  if (failure === null) {
    try {
      for (const inverse of inverses.reverse()) grid.apply(inverse);
      const end = unstale(bytesNow());
      if (end !== unstale(baseBytes)) {
        steps.push({ end: true });
        fail("the inverses bring back the bytes they started from", firstDifference(end, unstale(baseBytes)));
      }
    } catch (error) {
      steps.push({ end: true });
      fail("the inverses apply", String(error?.code ?? error));
    }
  }
  observer.disconnect();
  recorder.observer = null;
  return { steps, failure };
}
