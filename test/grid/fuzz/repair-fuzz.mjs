// node test/grid/fuzz/repair-fuzz.mjs [--lists N] [--seed S] [--out DIR] [--plant NAME] [--replay FILE]
// The repair fuzz of plan 6.4 (step D9). Each list is one damaged copy of a golden table. The model
// is broken with one to four damages (the damages of the repair's property test, plus an id outside
// the id syntax, a span far past the HTML limit and a freeze past the last column), and
// normalizeSheet runs on it, given the text of each hidden cell as a live table holds it: a second
// run changes nothing, two runs are equal, every value keeps the column a browser shows it in (see
// placesOf for hidden text) and each hidden cell's text is shown, the first holder of a valid id
// keeps it, the check is empty and the strict reader gives the bytes back. Then the damaged model
// is written as a live table and broken again as a hand or another tool writes tables (merges with
// no hidden cells, text in a hidden cell, header cells, a tfoot, cols with no colgroup, a tbody cut
// anywhere), and a Grid loads it: the load writes nothing, the repair gives the bytes
// normalizeSheet gives for the table as loaded, the repaired table is the tree its bytes parse to
// (save a header cell the repair did not redraw, which stays a <th>, and empty cells at the end of
// a row: a recorded follow-up), a second repair does nothing, two copies repair the same, a reload
// is clean, and every value is where the browser showed it, with each hidden cell's text shown.
// Where a hidden cell held text, "where" is the value's place in its row's cells when nothing else
// moved cells, else its row (placesOf), and each hidden cell's text is shown in the row and column
// it was hidden at, unless a value is drawn in that column (misplaced). A throw anywhere is a
// failure. Copies the repair is known to get wrong in a way no person meets are skipped and counted
// (noStory): hidden text beside a hidden cell with a span (the repair throws), and a span past the
// 1,000 column limit with another span past the sheet's edge (cells beside it move). Prints how many
// times each damage applied and each repair ran, and exits
// 1 on a failure or on a count of zero. A failing copy is cut down to the fewest damages that still
// fail the same check and written to DIR/repair-fuzz-failure-<seed>.json.
// --plant NAME runs normalizeSheet and the Grid from a scratch copy of the project with that
// mutation put back; the checks stay this tree's.
// --replay FILE plays a written failure's damages again and exits 1 when a check still fails.
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
const { checkSheet } = await import("../../../src/grid/check.js");
const { canonicalGrid, domAdapter, treeModel } = await import("../../../src/grid/codec/canonical.js");
const { gridModel } = await import("../../../src/grid/codec/read.js");
const { tableHtml } = await import("../../../src/grid/codec/write.js");
const { contentOf } = await import("../../../src/grid/content.js");
const { DAMAGES } = await import("../support/damage.js");
const { splitTables } = await import("../support/laws.js");
const { agentSheet } = await import("../support/agent-sheet.js");
const { sameTree } = await import("../support/same-tree.js");
const { planted } = await import("./plant.mjs");

const NAME = "repair-fuzz";
// The damaged live table of the copy being checked, for a failure that throws.
let damagedHtml = null;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

function options(argv) {
  const out = { lists: 20000, seed: 1, out: null, plant: null, replay: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--lists") out.lists = Number(argv[++i]);
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
const pick = (random, list) => list[Math.floor(random() * list.length)];
const stable = (value) => JSON.stringify(value);

// Damages beyond the property test's: an id outside the id syntax, a span past the HTML limits on
// the last cell of a row, and a freeze past the last column.
function invalidId(model, random) {
  const records = [...model.cols, ...model.rows];
  if (records.length === 0) return false;
  pick(random, records).id = random() < 0.5 ? "bad id" : "x".repeat(65);
  return true;
}

function spanTooBig(model, random) {
  const ends = model.rows.map((row) => row.cells[row.cells.length - 1]).filter((cell) => cell && !cell.hidden);
  if (ends.length === 0) return false;
  const cell = pick(random, ends);
  if (random() < 0.5) cell.colspan = 1500;
  else cell.rowspan = 70000;
  return true;
}

function freezePastEnd(model, random) {
  model.freezeCols = model.cols.length + 1 + Math.floor(random() * 3);
  return true;
}

const MODEL_DAMAGES = [...DAMAGES, invalidId, spanTooBig, freezePastEnd];

// Damages to the live table that no model holds: what a hand or another tool writes.
function plainSpans(table) {
  const placeholders = Array.from(table.querySelectorAll("td[hidden]")).filter((td) => td.textContent === "" && td.attributes.length === 1);
  if (placeholders.length === 0) return false;
  for (const td of placeholders) td.remove();
  return true;
}

function hiddenText(table, random) {
  const hidden = Array.from(table.querySelectorAll("td[hidden]"));
  if (hidden.length === 0) return false;
  pick(random, hidden).textContent = pick(random, ["kept", "note 2", "kept\nnext line"]);
  return true;
}

function headerCell(table, random) {
  const cells = Array.from(table.querySelectorAll("td")).filter((td) => !td.hidden);
  if (cells.length === 0) return false;
  const td = pick(random, cells);
  const th = table.ownerDocument.createElement("th");
  for (const { name, value } of Array.from(td.attributes)) th.setAttribute(name, value);
  th.append(...td.childNodes);
  td.replaceWith(th);
  return true;
}

function footRow(table) {
  const rows = Array.from(table.querySelectorAll("tbody > tr"));
  if (rows.length < 2 || table.tFoot !== null) return false;
  const foot = table.ownerDocument.createElement("tfoot");
  foot.append(rows[rows.length - 1]);
  table.append(foot);
  for (const body of Array.from(table.tBodies)) if (body.rows.length === 0) body.remove();
  return true;
}

function bareCols(table) {
  const group = table.querySelector("colgroup");
  if (group === null) return false;
  group.replaceWith(...group.childNodes);
  return true;
}

function cutGroups(table, random) {
  const rows = Array.from(table.querySelectorAll("tbody > tr"));
  if (rows.length < 2) return false;
  const all = table.ownerDocument.createElement("tbody");
  all.append(...rows);
  for (const body of Array.from(table.tBodies)) body.remove();
  const at = 1 + Math.floor(random() * (rows.length - 1));
  const second = table.ownerDocument.createElement("tbody");
  second.append(...rows.slice(at));
  table.insertBefore(all, table.tFoot);
  table.insertBefore(second, table.tFoot);
  return true;
}

const DOM_DAMAGES = [plainSpans, hiddenText, headerCell, footRow, bareCols, cutGroups];
const KINDS = [...MODEL_DAMAGES, ...DOM_DAMAGES].map((one) => one.name);

// Every value with the column a browser shows it in: the HTML table slot rules, written here so
// the repair is not checked against itself. A hidden cell is not drawn. A value a browser draws
// past column 1,000 (behind a span it clamps to 1,000) keeps only its row (moves): no sheet holds
// that column, so the repair cannot keep it there.
function contentsOf(sheet) {
  const blocked = sheet.rows.map(() => new Set());
  const found = [];
  sheet.rows.forEach((row, r) => {
    let col = 0;
    for (const cell of row.cells) {
      if (cell && cell.hidden) continue;
      while (blocked[r].has(col)) col++;
      const content = contentOf(cell);
      if (content !== null && content !== undefined) found.push(`${r}:${col < 1000 ? col : "past"}:${stable(content)}`);
      const colspan = cell && cell.colspan > 1 ? Math.min(cell.colspan, 1000) : 1;
      const rowspan = cell && cell.rowspan > 1 ? cell.rowspan : 1;
      for (let i = 1; i < rowspan && r + i < sheet.rows.length; i++) for (let j = 0; j < colspan; j++) blocked[r + i].add(col + j);
      col += colspan;
    }
  });
  return found;
}

// Where each value sits, for the check that no value moves. With no hidden text, by the column a
// browser draws it in. With hidden text and no other damage that moves cells ("index"), by its
// place in its row's cells: showing a hidden cell's text keeps every cell where the HTML has it,
// the shown cell in its own place. Otherwise ("row"), by its row alone. `held` adds each hidden
// cell's text where it is shown.
function placesOf(sheet, held, how) {
  if (how === "column") return contentsOf(sheet);
  const out = [];
  const key = (r, c, content) => (how === "index" ? `${r}#${c}:${stable(content)}` : `${r}:${stable(content)}`);
  sheet.rows.forEach((row, r) =>
    row.cells.forEach((cell, c) => {
      const content = cell && !cell.hidden ? contentOf(cell) : null;
      if (content !== null && content !== undefined) out.push(key(r, c, content));
    }),
  );
  for (const item of held) out.push(key(item.row, item.col, item.text));
  return out;
}

// The hidden texts not shown in the row and column they were hidden at, of those whose column no
// value of `before` is drawn in (there the value keeps the column, so the text cannot have it).
function misplaced(before, after, held, counts) {
  const drawn = new Set(contentsOf(before).map((entry) => entry.split(":").slice(0, 2).join(":")));
  const free = held.filter((item) => !drawn.has(`${item.row}:${item.col}`));
  if (counts !== null) counts.crowded += held.length - free.length;
  return free.filter((item) => stable(contentOf(after.rows[item.row]?.cells[item.col] ?? null)) !== stable(item.text));
}

// Damages that keep every cell at its place in its row, for the model and for the live table.
const KEEP_MODEL = new Set(["clearId", "copyId", "invalidKey", "swapKeys", "longRow", "orphanHidden", "invalidId", "freezePastEnd"]);
const KEEP_DOM = new Set(["hiddenText", "headerCell", "footRow", "bareCols", "cutGroups"]);
const keepsPlaces = (plan, dom) => plan.model.every((one) => KEEP_MODEL.has(one.kind)) && (!dom || plan.dom.every((one) => KEEP_DOM.has(one.kind)));

// A copy of the live table without the empty cells at the end of each row: markup a repair leaves
// until the row is next written (a recorded follow-up, with the <th> it leaves).
function withoutLeftovers(table) {
  const copy = table.cloneNode(true);
  for (const tr of Array.from(copy.rows)) {
    for (let td = tr.lastElementChild; td !== null && td.attributes.length === 0 && td.childNodes.length === 0; td = tr.lastElementChild) td.remove();
  }
  return copy;
}

// The first holder of each id in the id syntax, by axis and index: the record a repair keeps the
// id on.
function firstHolders(sheet) {
  const seen = new Set();
  const kept = [];
  const walk = (records, axis) =>
    records.forEach((record, index) => {
      if (typeof record.id !== "string" || !ID.test(record.id) || seen.has(record.id)) return;
      seen.add(record.id);
      kept.push({ axis, index, id: record.id });
    });
  walk(sheet.cols, "cols");
  walk(sheet.rows, "rows");
  return kept;
}

function goldenTables() {
  const dir = fileURLToPath(new URL("../../grid-codec/golden/", import.meta.url));
  const tables = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".html")).sort()) {
    splitTables(readFileSync(join(dir, file), "utf8")).forEach((src, index) => tables.push({ name: `${file.replace(/\.html$/, "")}#${index}`, model: gridModel(src, 0) }));
  }
  tables.push({ name: "agent", model: agentSheet() });
  return tables;
}

const opts = options(process.argv.slice(2));

let root = null;
try {
  if (opts.plant) root = planted(opts.plant);
  const base = root ? pathToFileURL(join(root, "src/grid/")).href : new URL("../../../src/grid/", import.meta.url).href;
  const load = (file) => import(base + file);
  const [normalize, grid, content] = await Promise.all([load("normalize.js"), load("grid.js"), load("content.js")]);
  const engine = { normalizeSheet: normalize.normalizeSheet, createGrid: grid.createGrid, derive: content.derive };

  const tables = goldenTables().filter((table) => table.model.rows.length * Math.max(1, table.model.cols.length) <= 5000);
  const counts = { repairs: {}, damages: {}, copies: 0, live: 0, skipped: {}, crowded: 0 };
  if (opts.replay !== null) {
    process.exitCode = replay(engine, tables, opts.replay, counts);
  } else {
    const random = rng(opts.seed);
    let first = null;
    const started = Date.now();

    for (let index = 0; index < opts.lists && first === null; index++) {
      const seed = Math.floor(random() * 4294967296);
      const plan = damagePlan(rng(seed), tables);
      const failure = runCopy(engine, tables, plan, counts);
      if (failure !== null) first = { list: index, seed, plan, failure };
    }

    if (first !== null) {
      let plan = first.plan;
      let cut = true;
      while (cut) {
        cut = false;
        for (const part of ["model", "dom"]) {
          for (let at = plan[part].length - 1; at >= 0 && !cut; at--) {
            const candidate = { ...plan, [part]: plan[part].slice(0, at).concat(plan[part].slice(at + 1)) };
            const again = runCopy(engine, tables, candidate, null);
            if (again !== null && again.check === first.failure.check) {
              plan = candidate;
              cut = true;
            }
          }
        }
      }
      const last = runCopy(engine, tables, plan, null) ?? first.failure;
      log(`${last.check}, on ${plan.table}, list ${first.list}, seed ${first.seed}`);
      log(`  damages ${JSON.stringify({ model: plan.model.map((one) => one.kind), dom: plan.dom.map((one) => one.kind) })}`);
      log(`  detail ${JSON.stringify(last.detail)}`);
      if (opts.out) {
        mkdirSync(opts.out, { recursive: true });
        const file = join(opts.out, `${NAME}-failure-${first.seed}.json`);
        writeFileSync(file, JSON.stringify({ seed: first.seed, list: first.list, check: last.check, detail: last.detail, plan, html: last.html ?? null }, null, 2) + "\n");
        log(`failure written to ${file}`);
      }
    }

    for (const kind of KINDS) log(`${kind}: applied ${counts.damages[kind] ?? 0}`);
    log(`repairs: ${Object.entries(counts.repairs).map(([code, n]) => `${code} ${n}`).join(", ") || "none"}`);
    for (const [reason, n] of Object.entries(counts.skipped)) log(`skipped ${n}: ${reason}`);
    log(`hidden texts checked by row only, a value being drawn in their column: ${counts.crowded}`);
    log(`lists ${opts.lists}, copies ${counts.copies}, live ${counts.live}, failures ${first === null ? 0 : 1}, ${Date.now() - started} ms`);
    const zero = KINDS.some((kind) => (counts.damages[kind] ?? 0) === 0) || Object.keys(counts.repairs).length === 0 || counts.live === 0;
    if (zero) log("one of the counts is zero");
    process.exitCode = first !== null || zero ? 1 : 0;
  }
} finally {
  if (root) rmSync(root, { recursive: true, force: true });
}

// A written failure played again: its damages on a fresh copy. Returns the exit code.
function replay(engine, tables, file, counts) {
  const saved = JSON.parse(readFileSync(file, "utf8"));
  const failure = runCopy(engine, tables, saved.plan, counts);
  for (const [reason, n] of Object.entries(counts.skipped)) log(`skipped ${n}: ${reason}`);
  if (failure === null) log(`${file}: no check fails`);
  else log(`${failure.check}, on ${saved.plan.table}\n  detail ${JSON.stringify(failure.detail)}`);
  return failure === null ? 0 : 1;
}

// The damages of one copy, each with its own seed so a shorter list replays the rest the same.
function damagePlan(random, tables) {
  const table = pick(random, tables).name;
  const model = Array.from({ length: 1 + Math.floor(random() * 4) }, () => ({ kind: pick(random, MODEL_DAMAGES).name, seed: Math.floor(random() * 4294967296) }));
  const dom = Array.from({ length: Math.floor(random() * 3) }, () => ({ kind: pick(random, DOM_DAMAGES).name, seed: Math.floor(random() * 4294967296) }));
  return { table, model, dom };
}

// Copies the repair is known to get wrong in a way no person meets (recorded follow-ups with no
// story): skipped and counted by reason.
function noStory(model, plan, held) {
  const cells = model.rows.flatMap((row) => row.cells).filter(Boolean);
  const hiddenText = held.length > 0 || plan.dom.some((one) => one.kind === "hiddenText");
  if (hiddenText && cells.some((cell) => cell.hidden && (cell.colspan > 1 || cell.rowspan > 1))) return "hidden text and a hidden cell with a span (the repair throws)";
  if (plan.model.some((one) => one.kind === "spanPastEdge") && cells.some((cell) => !cell.hidden && cell.colspan > 1000)) return "a span past the 1,000 column limit and another span past the sheet's edge (the repair narrows the other span and cells beside it move left)";
  return null;
}

// One damaged copy: the model leg, then the live leg. Returns the first failure or null.
function runCopy(engine, tables, plan, counts) {
  damagedHtml = null;
  try {
    return copyChecks(engine, tables, plan, counts);
  } catch (error) {
    return { check: "no step throws", detail: String(error?.stack ?? error).split("\n").slice(0, 4).join(" | "), html: damagedHtml };
  }
}

function copyChecks(engine, tables, plan, counts) {
  const { normalizeSheet, createGrid, derive } = engine;
  const tally = (kind) => {
    if (counts !== null) counts.damages[kind] = (counts.damages[kind] ?? 0) + 1;
  };
  const fail = (check, detail, html) => ({ check, detail, html });
  if (counts !== null) counts.copies += 1;

  const model = clone(tables.find((one) => one.name === plan.table).model);
  for (const one of plan.model) if (MODEL_DAMAGES.find((damage) => damage.name === one.kind)(model, rng(one.seed))) tally(one.kind);

  const held = [];
  model.rows.forEach((row, r) =>
    row.cells.forEach((cell, c) => {
      if (!cell || !cell.hidden || !cell.text) return;
      held.push({ code: "hidden_text", row: r, col: c, text: cell.text });
      cell.text = "";
    }),
  );
  const skip = noStory(model, plan, held);
  if (skip !== null) {
    if (counts !== null) counts.skipped[skip] = (counts.skipped[skip] ?? 0) + 1;
    return null;
  }
  const first = normalizeSheet(clone(model), { derive, hiddenText: held });
  if (stable(normalizeSheet(clone(model), { derive, hiddenText: held })) !== stable(first)) return fail("two runs of the repair are equal", null);
  const again = normalizeSheet(clone(first.sheet), { derive });
  if (again.repairs.length > 0 || stable(again.sheet) !== stable(first.sheet)) return fail("a second run of the repair changes nothing", again.repairs.slice(0, 4));
  const issues = checkSheet(first.sheet);
  if (issues.length > 0) return fail("the check is empty after the repair", issues.slice(0, 4));
  const how = held.length === 0 ? "column" : keepsPlaces(plan, false) ? "index" : "row";
  const placesBefore = placesOf(model, held, how);
  const placesAfter = placesOf(first.sheet, [], how);
  const { lost, added } = moves(placesBefore, placesAfter);
  if (lost.length > 0 || added.length > 0) return fail(`every value keeps its place (by ${how}), and each hidden cell's text is shown`, { lost: lost.slice(0, 4), added: added.slice(0, 4) });
  const astray = misplaced(model, first.sheet, held, counts);
  if (astray.length > 0) return fail("each hidden cell's text is shown in the row and column it was hidden at", astray.slice(0, 4));
  const renamed = firstHolders(model).filter(({ axis, index, id }) => first.sheet[axis][index]?.id !== id);
  if (renamed.length > 0) return fail("the first holder of a valid id keeps it", renamed.slice(0, 4));
  const bytes = tableHtml(first.sheet);
  if (tableHtml(gridModel(bytes, 0)) !== bytes) return fail("the strict reader gives the repaired bytes back", null);

  let html;
  try {
    html = tableHtml(model);
  } catch {
    return null;
  }
  document.body.innerHTML = `<div>${html}</div>`;
  const table = document.querySelector("table");
  for (const item of held) table.rows[item.row].children[item.col].textContent = item.text;
  for (const one of plan.dom) if (DOM_DAMAGES.find((damage) => damage.name === one.kind)(table, rng(one.seed))) tally(one.kind);
  const damaged = table.outerHTML;
  damagedHtml = damaged;
  const before = treeModel(domAdapter, table);
  if (counts !== null) counts.live += 1;

  const observer = new MutationObserver(() => {});
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  const grid = createGrid(table);
  const loaded = observer.takeRecords().length;
  observer.disconnect();
  if (loaded > 0) return fail("loading a damaged table writes nothing", loaded, damaged);
  const shown = grid.issues.filter((issue) => issue.code === "hidden_text");
  const expected = normalizeSheet(clone(before), { derive, hiddenText: shown });
  if (counts !== null) for (const repair of expected.repairs) counts.repairs[repair.code] = (counts.repairs[repair.code] ?? 0) + 1;

  grid.repair();
  const live = canonicalGrid(domAdapter, table);
  const want = tableHtml(expected.sheet);
  if (live !== want) return fail("the live repair gives the bytes of normalizeSheet", firstDifference(live, want), damaged);
  if (tableHtml(gridModel(live, 0)) !== live) return fail("the strict reader gives the live repair's bytes back", null, damaged);
  if (checkSheet(gridModel(live, 0)).length > 0 || grid.issues.length > 0) return fail("the live repair leaves no issue", grid.issues.map((issue) => issue.code), damaged);
  const parts = sameTree(withoutLeftovers(table), live).filter((line) => !line.endsWith("<th> where the bytes give <td>"));
  if (parts.length > 0) return fail("the repaired table is the tree its bytes parse to", parts.slice(0, 4), damaged);
  if (grid.repair() !== null || canonicalGrid(domAdapter, table) !== live) return fail("a second live repair does nothing", null, damaged);

  const placing = shown.length === 0 ? "column" : keepsPlaces(plan, true) ? "index" : "row";
  const browser = placesOf(before, shown, placing);
  const after = placesOf(gridModel(live, 0), [], placing);
  const { lost: moved, added: extra } = moves(browser, after);
  if (moved.length > 0 || extra.length > 0) return fail(`every value of the live table keeps its place (by ${placing}), and each hidden cell's text is shown`, { lost: moved.slice(0, 4), added: extra.slice(0, 4) }, damaged);
  const strayed = misplaced(before, gridModel(live, 0), shown, counts);
  if (strayed.length > 0) return fail("each hidden cell's text of the live table is shown in the row and column it was hidden at", strayed.slice(0, 4), damaged);

  const copy = document.createElement("div");
  copy.innerHTML = damaged;
  document.body.append(copy);
  const twin = createGrid(copy.querySelector("table"));
  twin.repair();
  if (canonicalGrid(domAdapter, copy.querySelector("table")) !== live) return fail("two copies of a damaged table repair the same", null, damaged);

  const reload = document.createElement("div");
  reload.innerHTML = live;
  document.body.append(reload);
  const watch = new MutationObserver(() => {});
  watch.observe(reload, { childList: true, subtree: true, attributes: true, characterData: true });
  const reloaded = createGrid(reload.querySelector("table"));
  const written = watch.takeRecords().length;
  watch.disconnect();
  if (written > 0 || reloaded.issues.length > 0 || canonicalGrid(domAdapter, reload.querySelector("table")) !== live) return fail("the repaired bytes reload clean", { written, issues: reloaded.issues.map((issue) => issue.code) }, damaged);
  return null;
}

// The places of `before` that `after` lacks (lost) and the reverse (added). A value placed "past"
// column 1,000 before may sit in any column of its row after.
function moves(before, after) {
  let lost = missing(before, after);
  let added = missing(after, before);
  for (const entry of lost.filter((one) => /^\d+:past:/.test(one))) {
    const [row, , ...rest] = entry.split(":");
    const content = rest.join(":");
    const at = added.findIndex((one) => one.startsWith(`${row}:`) && one.slice(one.indexOf(":", row.length + 1) + 1) === content);
    if (at === -1) continue;
    added = added.filter((one, i) => i !== at);
    lost = lost.filter((one) => one !== entry);
  }
  return { lost, added };
}

// The entries of `want` that `have` lacks, counting repeats.
function missing(want, have) {
  const left = new Map();
  for (const entry of have) left.set(entry, (left.get(entry) ?? 0) + 1);
  const out = [];
  for (const entry of want) {
    const n = left.get(entry) ?? 0;
    if (n === 0) out.push(entry);
    else left.set(entry, n - 1);
  }
  return out;
}

function firstDifference(actual, expected) {
  let at = 0;
  while (at < actual.length && at < expected.length && actual[at] === expected[at]) at++;
  return { offset: at, actual: actual.slice(Math.max(0, at - 40), at + 40), expected: expected.slice(Math.max(0, at - 40), at + 40) };
}
