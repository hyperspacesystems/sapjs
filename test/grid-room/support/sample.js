// Samples for the room codec's laws (check-codec.js): a two-tab workbook the codec's own actions can
// reach, and actions on it. Most actions come from the grid fuzzer's generator (test/grid/support/
// gen-actions.js) on the tab they are aimed at; the rest are tab actions, sorts and reverts of
// earlier actions, taken in any order so a revert meets a coworker's later change.
//
// The actions are worked out on a copy of the document in order, as checkCodec applies them. An
// action the reducer refuses for a reason its needs do not say is left out and counted under its
// refusal code, but only for the codes RESIDUAL names: any other such refusal stays in the list,
// and checkCodec reports it as a broken C8.

import { sheetCodec as codec } from "../../../src/grid/room-codec.js";
import { modelBacking } from "../../../src/grid/backing-model.js";
import { gridModel } from "../../../src/grid/codec/read.js";
import { tableHtml } from "../../../src/grid/codec/write.js";
import { keyBetween, keysBetween } from "../../../src/grid/codec/order-keys.js";
import { genAction } from "../../grid/support/gen-actions.js";

// Reducer refusals the codec's needs cannot name (the plan's Deferred list says why each is
// left): an insert whose cells land inside a merge, a record landing among frozen rows, a merge
// that an insert would grow across the frozen line, and a batch whose later part meets what an
// earlier part made.
export const RESIDUAL = new Set(["covered_cell", "bad_action", "merge_cut", "merge_stale", "exists", "missing_row", "missing_col", "merge_overlap"]);

export const tally = new Map();
const count = (key) => tally.set(key, (tally.get(key) ?? 0) + 1);

const RECORD = { v: 2, doc: "doc0123456789abc", gen: "1.00000001", commit: "c<1" };
const TEXTS = ["ink", "paper", "café 🐈", "a<b & c", '</td><td data-col="x">', "</script>", "  padded  "];
const FORMULAS = ["=A1+1", "=SUM(B1:B3)", "=B2*2+B$1", "=Notes!A1", "=SUM(Budget!B1:B4)", "=$A$1", "=Missing!A1"];

const pick = (random, list) => list[Math.floor(random() * list.length)];

function sheetOf(random, rows, cols, prefix) {
  const rk = keysBetween(null, null, rows);
  const ck = keysBetween(null, null, cols);
  const sheet = { cols: ck.map((pos, i) => ({ id: `${prefix}c${i}`, pos })), rows: rk.map((pos, i) => ({ id: `${prefix}r${i}`, pos, cells: [] })) };
  for (const row of sheet.rows) {
    for (let c = 0; c < cols; c++) {
      const roll = random();
      row.cells.push(roll < 0.35 ? { text: String(Math.floor(random() * 100)), n: true } : roll < 0.55 ? { text: pick(random, TEXTS) } : roll < 0.7 ? { f: pick(random, FORMULAS), text: "" } : null);
    }
    while (row.cells.length && row.cells.at(-1) === null) row.cells.pop();
  }
  return gridModel(tableHtml(sheet), 0);
}

const retag = (action, sheet) => (action.t === "batch" ? { ...action, actions: action.actions.map((one) => retag(one, sheet)) } : { ...action, sheet });

function sortOf(random, tab, narrow) {
  const rows = tab.sheet.rows.map((row) => row.id).filter(() => random() < 0.6);
  if (rows.length < 2) return null;
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  if (!narrow) return { v: 1, t: "sort", sheet: tab.id, rows, cols: null };
  const cols = tab.sheet.cols.map((col) => col.id).filter(() => random() < 0.5);
  return cols.length === 0 ? null : { v: 1, t: "sort", sheet: tab.id, rows, cols };
}

let made = 0;
function tabActionOf(random, doc) {
  const tab = pick(random, doc.tabs);
  const last = doc.tabs.at(-1).pos;
  switch (Math.floor(random() * 5)) {
    case 0: {
      made += 1;
      const name = random() < 0.2 ? "notes" : `Tab ${made}`;
      return { v: 1, t: "insertSheet", sheet: { id: `t${made}`, name, pos: keyBetween(last, null), html: tableHtml(sheetOf(random, 3, 2, `t${made}`)) } };
    }
    case 1:
      return { v: 1, t: "deleteSheet", sheet: tab.id };
    case 2:
      return { v: 1, t: "renameSheet", sheet: tab.id, name: random() < 0.3 ? pick(random, ["Budget", "NOTES"]) : `Named ${Math.floor(random() * 9)}` };
    default:
      return { v: 1, t: "moveSheet", sheet: tab.id, pos: random() < 0.5 ? keyBetween(null, doc.tabs[0].pos) : keyBetween(last, null) };
  }
}

function actionOf(random, doc, inverses) {
  const roll = random();
  if (roll < 0.15 && inverses.length) return pick(random, inverses);
  if (roll < 0.25) return tabActionOf(random, doc);
  const tab = pick(random, doc.tabs);
  if (roll < 0.35) return sortOf(random, tab, random() < 0.5);
  if (roll < 0.42 && tab.sheet.rows.length && tab.sheet.cols.length) {
    const row = pick(random, tab.sheet.rows);
    const col = pick(random, tab.sheet.cols);
    return { v: 1, t: "set", sheet: tab.id, cells: [[row.id, col.id, { f: pick(random, FORMULAS) }]] };
  }
  return retag(genAction(random, modelBacking(structuredClone(tab.sheet), { sheetId: null }), { invalidRate: 0 }), tab.id);
}

export function sample(random, { length = 8 } = {}) {
  made = 0;
  const doc = { tabs: [{ id: "s1", name: "Budget", pos: "V", sheet: sheetOf(random, 6, 4, "a") }, { id: "s2", name: "Notes", pos: "l", sheet: sheetOf(random, 5, 3, "b") }] };
  const scratch = structuredClone(doc);
  const actions = [];
  const inverses = [];
  for (let tries = 0; actions.length < length && tries < length * 20; tries++) {
    const action = actionOf(random, scratch, inverses);
    if (action === null) continue;
    const placed = codec.needs(action).every((id) => codec.has(scratch, id)) && codec.creates(action).every((id) => !codec.has(scratch, id));
    const out = codec.apply(scratch, action);
    if (out.out !== "applied" && placed && RESIDUAL.has(out.code)) {
      count(`${action.t}:${out.code}`);
      continue;
    }
    count(`${action.t}:${out.out}${out.skipped?.length ? ":skipped" : ""}`);
    actions.push(action);
    if (out.out === "applied") inverses.push(out.inverse);
  }
  return { doc, record: RECORD, actions };
}
