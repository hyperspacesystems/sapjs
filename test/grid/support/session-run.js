// One scripted session of the round trip corpus, replayed on a live <table grid>: the start table
// is parsed into a document, a Grid loads it with a fixed day and ids minted in order, and each
// command runs as a page would call it. `write-sessions.js` writes what a replay gives into the
// session files, and `corpus.test.js` replays every file and checks it.
//
// A session is { name, about, start, commands, outcomes, issues, bytes }. The start is a table of
// the codec's goldens (`fixture`, such as "tiny#0"), optionally after a host patch (`patch`, the
// ops of `patchGrid`), a repair input (`repair`, the name of a file in golden/repair), or HTML of
// its own (`html`). A command is [method, ...arguments] on the Grid; an "apply" goes through the
// Grid's dispatch, as a room's action does. Its outcome is "change" (the
// command fired a change event), "nothing" (it wrote nothing) or "refused <code>".

import { canonicalGrid, domAdapter } from "../../../src/grid/codec/canonical.js";
import { patchGrid } from "../../../src/grid/codec/patch.js";
import { createGrid } from "../../../src/grid/grid.js";
import { GridRefused } from "../../../src/grid/ops.js";

export const TODAY = 46095;

const OBSERVED = { childList: true, subtree: true, attributes: true, characterData: true };

// The HTML a session starts from. `sources.fixture(name)` and `sources.repair(name)` read the files.
export function startHtml(start, sources) {
  if (start.html !== undefined) return start.html;
  if (start.repair !== undefined) return sources.repair(start.repair);
  const bytes = sources.fixture(start.fixture);
  return start.patch === undefined ? bytes : patchGrid(bytes, start.patch).bytes;
}

const outcomeOf = (event) => (event === null ? "nothing" : "change");

// The bytes as a list of lines, the form a session file keeps them in so they read by eye.
export const linesOf = (bytes) => bytes.split("\n");

export const bytesOf = (lines) => lines.join("\n");

// The first byte where two texts differ, with a little of each around it, or null when they are equal.
export function byteDiff(actual, expected) {
  if (actual === expected) return null;
  let at = 0;
  while (at < actual.length && at < expected.length && actual[at] === expected[at]) at++;
  return { offset: at, actual: actual.slice(Math.max(0, at - 30), at + 30), expected: expected.slice(Math.max(0, at - 30), at + 30) };
}

// Replays a session in `doc`. Returns the live table and its Grid, the mutation records the load
// made, the start bytes and issues, each command's outcome, the steps the model replays (each
// dispatched action with what the live table did with it, "applied" or the refusal code, and each
// repair with the hidden text it showed again), and the inverses of
// the commands since the last repair with the bytes they lead back to.
export function runSession(session, { doc, sources }) {
  const host = doc.createElement("div");
  host.innerHTML = startHtml(session.start, sources);
  doc.body.append(host);
  const table = host.querySelector("table");
  const observer = new doc.defaultView.MutationObserver(() => {});
  observer.observe(host, OBSERVED);
  let minted = 0;
  const grid = createGrid(table, { today: () => TODAY, newId: (prefix) => `${prefix}s${++minted}` });
  const loadRecords = observer.takeRecords().length;
  observer.disconnect();
  const startBytes = canonicalGrid(domAdapter, table);
  const startIssues = grid.issues.map((issue) => issue.code);
  const steps = [];
  const outcomes = [];
  let inverses = [];
  let base = startBytes;
  grid.dispatch = (action) => {
    const step = { action, out: "applied" };
    steps.push(step);
    try {
      return grid.apply(action);
    } catch (error) {
      step.out = error.code;
      throw error;
    }
  };
  for (const [call, ...args] of session.commands) {
    if (call === "repair") {
      const hiddenText = grid.issues.filter((issue) => issue.code === "hidden_text");
      outcomes.push(outcomeOf(grid.repair()));
      steps.push({ repair: hiddenText });
      inverses = [];
      base = canonicalGrid(domAdapter, table);
      continue;
    }
    try {
      const event = call === "apply" ? grid.dispatch(...args) : grid[call](...args);
      outcomes.push(outcomeOf(event));
      if (event !== null && event.inverse !== undefined) inverses.push(event.inverse);
    } catch (error) {
      if (!(error instanceof GridRefused)) throw error;
      outcomes.push(`refused ${error.code}`);
    }
  }
  return {
    host,
    table,
    grid,
    loadRecords,
    startBytes,
    startIssues,
    steps,
    outcomes,
    inverses,
    base,
    bytes: canonicalGrid(domAdapter, table),
    issues: grid.issues.map((issue) => issue.code),
  };
}
