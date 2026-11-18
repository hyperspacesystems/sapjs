// The round trip corpus (plan 6.1): every session in golden/sessions replayed on a live table, with
// six checks each. The live table ends at the session's bytes. The actions the commands dispatched,
// applied to a model backing, end at the same bytes. The strict reader takes the bytes and the
// writer gives them back. The bytes parsed into a new document load into a new Grid with no write
// and the same bytes. The inverses, applied last to first, give back the bytes the commands started
// from. The sheet check finds what the session pins, which is nothing for every session that does
// not start damaged and stop there. On top of those, when the commands start from the normal form
// (two codec goldens keep a `t` the value rule does not need and a short color), the declared
// repair of the end state changes nothing, and every cell typed back as its own editor text
// changes no byte.
//
// test/grid/support/write-sessions.js writes the session files.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { colName } from "../../src/grid/a1.js";
import { modelBacking } from "../../src/grid/backing-model.js";
import { checkSheet } from "../../src/grid/check.js";
import { canonicalGrid, domAdapter, treeModel } from "../../src/grid/codec/canonical.js";
import { gridModel } from "../../src/grid/codec/read.js";
import { typed } from "../../src/grid/codec/value.js";
import { tableHtml } from "../../src/grid/codec/write.js";
import { derive } from "../../src/grid/content.js";
import { createGrid } from "../../src/grid/grid.js";
import { normalizeSheet } from "../../src/grid/normalize.js";
import { apply } from "../../src/grid/ops.js";
import { splitTables } from "./support/laws.js";
import { parseTable } from "./support/same-tree.js";
import { byteDiff, bytesOf, runSession, startHtml } from "./support/session-run.js";

global.__SAP_KEEP_CONSOLE__ = true;

const SESSIONS = join(__dirname, "golden", "sessions");
const CODEC = join(__dirname, "..", "grid-codec", "golden");
const REPAIR = join(__dirname, "golden", "repair");
const STALE_REFRESH = existsSync(join(__dirname, "stale.test.js"));
const STALE_SESSIONS = ["host-patch-load-plain", "host-patch-load-formulas"];
const EDITED_CELLS = 400;

const read = (path) => readFileSync(path, "utf8");

const sources = {
  fixture(name) {
    const [file, index] = name.split("#");
    return tableHtml(gridModel(splitTables(read(join(CODEC, `${file}.html`)))[Number(index)], 0));
  },
  repair: (name) => read(join(REPAIR, `${name}.in.html`)).trim(),
};

const sessions = readdirSync(SESSIONS)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => JSON.parse(read(join(SESSIONS, file))));

const unstale = (bytes) => bytes.replace(/^(<table grid(?: freeze-cols="[0-9]+")?) stale/, "$1");

const sha256 = (bytes) => createHash("sha256").update(bytes, "utf8").digest("hex");

// Whether the bytes are the session's: its lines, or its length and hash for a long table.
function pinned(session, bytes) {
  if (session.bytes !== undefined) return byteDiff(bytes, bytesOf(session.bytes));
  return bytes.length === session.length && sha256(bytes) === session.sha256 ? null : { length: bytes.length, sha256: sha256(bytes) };
}

// The steps the commands took, applied to a model backing of the table as it loaded: each
// dispatched action, and each repair with the hidden text it showed again. A sheet with issues
// refuses in the Grid before the reducer runs, so those steps are left out. Gives the bytes, and
// what the reducer and the live table did with each action.
function modelBytes(run) {
  let model = modelBacking(treeModel(domAdapter, parseTable(run.startBytes)), { sheetId: "" });
  const outs = [];
  const live = [];
  for (const step of run.steps) {
    if (step.action === undefined) {
      model = modelBacking(normalizeSheet(model.sheet, { derive, hiddenText: step.repair }).sheet, { sheetId: "" });
      continue;
    }
    if (step.out === "needs_repair") continue;
    const out = apply(model, step.action, { derive });
    outs.push(out.out === "applied" ? "applied" : out.code);
    live.push(step.out);
  }
  return { bytes: tableHtml(model.sheet), outs, live };
}

// The bytes parsed by the HTML parser into a new document, loaded by a new Grid: the mutation
// records the load made, the bytes the new table gives and its issues.
function reload(bytes) {
  const doc = document.implementation.createHTMLDocument("");
  doc.body.innerHTML = bytes;
  const table = doc.body.querySelector("table");
  const observer = new MutationObserver(() => {});
  observer.observe(doc.body, { childList: true, subtree: true, attributes: true, characterData: true });
  const grid = createGrid(table);
  const records = observer.takeRecords().length;
  observer.disconnect();
  return { records, bytes: canonicalGrid(domAdapter, table), issues: grid.issues.map((issue) => issue.code) };
}

// Every cell of a sheet with no issue typed back as its own editor text: the cells whose bytes
// that changed.
function retyped(run) {
  const { rows, cols } = run.grid.size;
  if (run.issues.length > 0 || rows * cols > EDITED_CELLS) return [];
  const moved = [];
  for (let r = 1; r <= rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ref = `${colName(c)}${r}`;
      const before = canonicalGrid(domAdapter, run.table);
      run.grid.set(ref, run.grid.input(ref));
      if (canonicalGrid(domAdapter, run.table) !== before) moved.push(ref);
    }
  }
  return moved;
}

// The inverses applied last to first on the live table: the bytes they lead to, without the stale
// mark, which a new formula sets and no action takes away.
function undone(run) {
  for (const inverse of [...run.inverses].reverse()) run.grid.apply(inverse);
  return unstale(canonicalGrid(domAdapter, run.table));
}

// What the HTML table slot rules put in each column of each row of the table as written: every
// value with the column a browser shows it in.
function browserColumns(html) {
  const doc = document.implementation.createHTMLDocument("");
  doc.body.innerHTML = html;
  const rows = Array.from(doc.querySelectorAll("tr"));
  const blocked = rows.map(() => new Set());
  const found = [];
  rows.forEach((tr, r) => {
    let col = 0;
    for (const td of Array.from(tr.children)) {
      if (td.localName !== "td" && td.localName !== "th") continue;
      while (blocked[r].has(col)) col++;
      const colspan = Math.max(1, Number(td.getAttribute("colspan") ?? 1));
      const rowspan = Math.max(1, Number(td.getAttribute("rowspan") ?? 1));
      if (td.textContent !== "") found.push({ ref: `${colName(col)}${r + 1}`, value: typed(td.textContent) });
      for (let i = 1; i < rowspan && r + i < rows.length; i++) for (let j = 0; j < colspan; j++) blocked[r + i].add(col + j);
      col += colspan;
    }
  });
  return found;
}

afterEach(() => {
  document.body.innerHTML = "";
});

test("the corpus holds at least 30 sessions, and the stale sessions once step D8 is in", () => {
  const names = sessions.map((session) => session.name);
  expect(names.length).toBeGreaterThanOrEqual(30);
  expect(new Set(names).size).toBe(names.length);
  const fixtures = names.filter((name) => name.startsWith("fixture-"));
  expect(fixtures.length).toBe(9);
  if (STALE_REFRESH) expect(names).toEqual(expect.arrayContaining(STALE_SESSIONS));
});

test("the byte comparison reports the offset of one changed byte", () => {
  const session = sessions.find((one) => one.bytes !== undefined && bytesOf(one.bytes).length > 200);
  const bytes = bytesOf(session.bytes);
  const at = Math.floor(bytes.length / 2);
  const changed = bytes.slice(0, at) + (bytes[at] === "x" ? "y" : "x") + bytes.slice(at + 1);
  expect(pinned(session, bytes)).toBeNull();
  expect(pinned(session, changed)?.offset).toBe(at);
  const long = sessions.find((one) => one.sha256 !== undefined);
  expect(pinned(long, sources.fixture(long.start.fixture))).toBeNull();
  expect(pinned(long, sources.fixture(long.start.fixture).replace("<td", "<td "))).not.toBeNull();
});

test.each(sessions.map((session) => [session.name, session]))("corpus session %s", (name, session) => {
  const run = runSession(session, { doc: document, sources });
  const stale = STALE_SESSIONS.includes(name);

  expect([name, "load", stale || run.loadRecords === 0, run.startIssues, run.outcomes]).toEqual([name, "load", true, session.startIssues, session.outcomes]);
  expect([name, "the live bytes are the session's", pinned(session, run.bytes)]).toEqual([name, "the live bytes are the session's", null]);

  const model = modelBytes(run);
  expect([name, "the model backing", model.outs, byteDiff(model.bytes, run.bytes)]).toEqual([name, "the model backing", model.live, null]);

  const strict = gridModel(run.bytes, 0);
  expect([name, "the strict reader", byteDiff(tableHtml(strict), run.bytes)]).toEqual([name, "the strict reader", null]);

  const again = reload(run.bytes);
  expect([name, "a reload", again.records, byteDiff(again.bytes, run.bytes), again.issues]).toEqual([name, "a reload", 0, null, run.issues]);

  expect([name, "the check", checkSheet(strict).map((issue) => issue.code), run.issues]).toEqual([name, "the check", session.issues, session.issues]);
  if (run.issues.length === 0 && normalizeSheet(gridModel(run.base, 0), { derive }).repairs.length === 0) {
    const tidy = normalizeSheet(strict, { derive });
    expect([name, "the repair of the end", tidy.repairs, byteDiff(tableHtml(tidy.sheet), run.bytes)]).toEqual([name, "the repair of the end", [], null]);
  }

  expect([name, "typed back as its editor text", retyped(run)]).toEqual([name, "typed back as its editor text", []]);
  expect([name, "the inverses", byteDiff(undone(run), unstale(run.base))]).toEqual([name, "the inverses", null]);

  if (session.agent) {
    const repaired = createGrid(parseTable(run.base));
    const misplaced = browserColumns(startHtml(session.start, sources)).filter(({ ref, value }) => repaired.get(ref) !== value);
    expect([name, "every value in its browser column", misplaced]).toEqual([name, "every value in its browser column", []]);
  }
  if (session.repaired !== undefined) {
    expect([name, "the repair file", byteDiff(run.base, read(join(REPAIR, `${session.repaired}.out.html`)).trim())]).toEqual([name, "the repair file", null]);
  }
});
