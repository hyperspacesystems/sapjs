/**
 * @jest-environment node
 */
// The gate for the sheet's room codec (S5): ClayJS's codec laws, C1 to C17, on workbooks the
// codec's own actions reach, with formulas, structure, tabs, sort and undo in the generator. The box
// run (`node test/grid-room/fuzz-s1.mjs --seeds 1000`) checks many more samples the same way.
import { checkCodec } from "./support/check-codec.js";
import { modelBacking } from "../../src/grid/backing-model.js";
import { gridModel } from "../../src/grid/codec/read.js";
import { tableHtml } from "../../src/grid/codec/write.js";
import { keyBetween, keysBetween } from "../../src/grid/codec/order-keys.js";
import { colName } from "../../src/grid/a1.js";
import { genAction } from "../grid/support/gen-actions.js";
import { drawingsIn, sheetCodec } from "../../src/grid/room-codec.js";
import { RESIDUAL, sample, tally } from "./support/sample.js";

global.__SAP_KEEP_CONSOLE__ = true;

const KINDS = ["set", "format", "insertRows", "deleteRows", "changeRows", "insertCols", "deleteCols", "changeCols", "merge", "freeze", "batch", "sort", "revert", "insertSheet", "deleteSheet", "renameSheet", "moveSheet"];

test("the sheet codec passes the codec laws, and every kind of action, a skipped undo and a refusal are in the samples", () => {
  tally.clear();
  const failures = checkCodec(sheetCodec, sample, { runs: 400, seed: 1, cap: 5 });
  expect(failures).toEqual([]);
  const seen = (prefix) => [...tally.keys()].some((key) => key.startsWith(prefix));
  for (const kind of KINDS) expect([kind, seen(`${kind}:applied`)]).toEqual([kind, true]);
  expect(seen("revert:applied:skipped")).toBe(true);
  expect(seen("sort:refused") || seen("insertSheet:refused")).toBe(true);
  const dropped = [...tally].filter(([key]) => RESIDUAL.has(key.split(":")[1])).reduce((sum, [, n]) => sum + n, 0);
  const applied = [...tally].filter(([key]) => key.includes(":applied")).reduce((sum, [, n]) => sum + n, 0);
  expect(dropped).toBeLessThan(applied / 50);
});

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" role="img" width="320" height="180" viewBox="0 0 320 180"><title>Sales</title><rect x="50" y="40" width="20" height="100"></rect><text x="60" y="160">a &lt; b &amp; {{c}}</text></svg>';

test("the laws hold on samples whose first tab has two charts, one past the sheet's edge, and a writer that draws every chart", () => {
  const withCharts = (random) => {
    const one = sample(random);
    one.doc.tabs[0].sheet.rules = [
      { id: "k6", pos: "V", kind: "chart", range: "C2:D5", source: "A1:B6", type: "line" },
      { id: "k8", pos: "l", kind: "chart", range: "C4:H12", source: "A1:B6", type: "area", stacked: true },
      { id: "k9", pos: "t", kind: "chart", range: "C6:H7", source: "A1:B6", type: "bar" },
    ];
    return one;
  };
  const drawn = { ...sheetCodec, write: (doc, record, extras) => sheetCodec.write(doc, record, extras ?? { drawing: () => SVG }) };
  const bytes = drawn.write(withCharts(() => 0.5).doc, {});
  expect(bytes).toContain(`<figure chart="k6" sap-ignore="">${SVG}</figure>`);
  expect(drawingsIn(bytes)("s1", "k8")).toBe(SVG);
  expect(checkCodec(drawn, withCharts, { runs: 400, seed: 1, cap: 5 })).toEqual([]);
});

const BATCH_RESIDUAL = new Set(["missing_row", "missing_col"]);
const RECORD = { v: 2, doc: "doc0123456789abc", gen: "1.00000001", commit: "c<1" };
const TEXTS = ["ink", "paper", "café 🐈", "a<b & c", '</td><td data-col="x">', "</script>"];
const FORMULAS = ["=A1+1", "=SUM(B1:B3)", "=B2*2+B$1", "=Notes!A1", "=SUM(Budget!B1:B4)", "=$A$1", "=Missing!A1"];

const seen = new Map();
const count = (key) => seen.set(key, (seen.get(key) ?? 0) + 1);
const pick = (random, list) => list[Math.floor(random() * list.length)];

let ruleSeq = 0;
let tabSeq = 0;

function randomRange(random, tab, chartOnly = false) {
  const rLen = Math.max(1, tab.sheet.rows.length);
  const cLen = Math.max(1, tab.sheet.cols.length);
  if (chartOnly) {
    // Half inside the sheet, half reaching past the sheet's row/col edge!
    const past = random() < 0.55;
    const r0 = Math.floor(random() * (past ? rLen + 3 : rLen));
    const c0 = Math.floor(random() * (past ? cLen + 3 : cLen));
    const r1 = r0 + Math.floor(random() * 5);
    const c1 = c0 + Math.floor(random() * 4);
    return random() < 0.15 ? `${colName(c0)}${r0 + 1}` : `${colName(c0)}${r0 + 1}:${colName(c1)}${r1 + 1}`;
  }
  const mode = random();
  const r0 = Math.floor(random() * (rLen + 2));
  const r1 = r0 + Math.floor(random() * 3);
  const c0 = Math.floor(random() * (cLen + 1));
  const c1 = c0 + Math.floor(random() * 2);
  if (mode < 0.2) return `${colName(c0)}${r0 + 1}:${colName(c1)}`;
  if (mode < 0.35) return `${colName(c0)}:${colName(c1)}`;
  return `${colName(c0)}${r0 + 1}:${colName(c1)}${r1 + 1}`;
}

function makeRule(random, doc, tab, forcedId = null, forcedPos = null) {
  ruleSeq += 1;
  const id = forcedId ?? (random() < 0.15 ? `k#${ruleSeq}` : `k${ruleSeq}`);
  const existingPos = (tab.sheet.rules ?? []).at(-1)?.pos ?? null;
  const pos = forcedPos ?? keyBetween(existingPos, null);
  const other = doc.tabs.find((t) => t.id !== tab.id) ?? tab;
  const srcPrefix = random() < 0.4 && other ? `${/^[A-Za-z_][A-Za-z0-9_.]*$/.test(other.name) ? other.name : `'${other.name.replaceAll("'", "''")}'`}!` : "";
  const kind = pick(random, ["check", "list", "when", "scale", "chart"]);
  if (kind === "check") return { id, pos, kind, range: randomRange(random, tab) };
  if (kind === "list") {
    if (random() < 0.5) {
      return {
        id,
        pos,
        kind,
        range: randomRange(random, tab),
        items: ["Open", "Done", pick(random, ["Blocked", "café 🐈"])],
        ...(random() < 0.4 ? { open: true } : {}),
      };
    }
    return { id, pos, kind, range: randomRange(random, tab), source: `${srcPrefix}A1:B3`, ...(random() < 0.3 ? { open: true } : {}) };
  }
  if (kind === "scale") {
    return {
      id,
      pos,
      kind,
      range: randomRange(random, tab),
      low: "#ffffff",
      ...(random() < 0.5 ? { mid: "#fde047" } : {}),
      high: "#22c55e",
    };
  }
  if (kind === "when") {
    const style = pick(random, ["background-color:#fecaca", "font-weight:bold;color:#dc2626", "font-style:italic"]);
    if (random() < 0.65) {
      const f = pick(random, ['=$B2="ink"', "=A2>10", "=$A$1=1", `=${srcPrefix}$A$1>0`, '=$C$9="x"']);
      return { id, pos, kind, range: randomRange(random, tab), test: "formula", f, style };
    }
    return { id, pos, kind, range: randomRange(random, tab), test: "between", a: "10", b: "50", style };
  }
  const type = pick(random, ["column", "bar", "line", "area", "pie", "scatter"]);
  return {
    id,
    pos,
    kind: "chart",
    range: randomRange(random, tab, true),
    source: `${srcPrefix}A1:B4`,
    type,
    ...(random() < 0.6 ? { title: `Chart ${ruleSeq}` } : {}),
    ...(random() < 0.4 && ["column", "bar", "area"].includes(type) ? { stacked: true } : {}),
    ...(random() < 0.3 ? { series: "rows" } : {}),
  };
}

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

function rulesActionOf(random, view) {
  const tab = pick(random, view.tabs);
  const current = tab.sheet.rules ?? [];
  const set = [];
  const remove = [];
  if (current.length > 0 && random() < 0.45) {
    const chosen = pick(random, current);
    if (random() < 0.5) remove.push(chosen.id);
    else set.push(makeRule(random, view, tab, chosen.id, chosen.pos));
  }
  if (set.length === 0 && remove.length === 0) {
    set.push(makeRule(random, view, tab));
    if (random() < 0.35) set.push(makeRule(random, view, tab));
  } else if (random() < 0.3) {
    const extra = makeRule(random, view, tab);
    if (!set.some((r) => r.id === extra.id) && !remove.includes(extra.id)) set.push(extra);
  }
  return { v: 1, t: "rules", sheet: tab.id, set, remove };
}

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

function tabActionOf(random, doc) {
  const tab = pick(random, doc.tabs);
  const last = doc.tabs.at(-1).pos;
  switch (Math.floor(random() * 5)) {
    case 0: {
      tabSeq += 1;
      const name = random() < 0.2 ? "notes" : `Tab ${tabSeq}`;
      const sheet = sheetOf(random, 3, 2, `t${tabSeq}`);
      if (random() < 0.4) sheet.rules = [{ id: `tk${tabSeq}`, pos: "G", kind: "chart", range: "B2:E6", source: "A1:B3", type: "line" }];
      return { v: 1, t: "insertSheet", sheet: { id: `t${tabSeq}`, name, pos: keyBetween(last, null), html: tableHtml(sheet) } };
    }
    case 1:
      return { v: 1, t: "deleteSheet", sheet: tab.id };
    case 2:
      return { v: 1, t: "renameSheet", sheet: tab.id, name: random() < 0.3 ? pick(random, ["Budget", "NOTES"]) : `Named ${Math.floor(random() * 9)}` };
    default:
      return { v: 1, t: "moveSheet", sheet: tab.id, pos: random() < 0.5 ? keyBetween(null, doc.tabs[0].pos) : keyBetween(last, null) };
  }
}

function actionOf(random, view, inverses) {
  const roll = random();
  if (roll < 0.16 && inverses.length) return pick(random, inverses);
  if (roll < 0.36) return rulesActionOf(random, view);
  if (roll < 0.46) return tabActionOf(random, view);
  const tab = pick(random, view.tabs);
  if (roll < 0.54) return sortOf(random, tab, random() < 0.5);
  if (roll < 0.62 && tab.sheet.rows.length && tab.sheet.cols.length) {
    const row = pick(random, tab.sheet.rows);
    const col = pick(random, tab.sheet.cols);
    return { v: 1, t: "set", sheet: tab.id, cells: [[row.id, col.id, { f: pick(random, FORMULAS) }]] };
  }
  return retag(genAction(random, modelBacking(structuredClone(tab.sheet), { sheetId: null }), { invalidRate: 0 }), tab.id);
}

// The law run with rules actions in the samples: a rule the samples' author adds, changes or removes
// travels as its A1 text, and charts reach past the sheet's edge.
function rulesSample(random, { length = 9 } = {}) {
  ruleSeq = 0;
  tabSeq = 0;
  const doc = {
    tabs: [
      { id: "s1", name: "Budget", pos: "V", sheet: sheetOf(random, 5, 4, "a") },
      { id: "s2", name: "Notes", pos: "l", sheet: sheetOf(random, 4, 3, "b") },
    ],
  };
  if (random() < 0.6) {
    doc.tabs[0].sheet.rules = [
      makeRule(random, doc, doc.tabs[0], "init1", "G"),
      { id: "init_chart", pos: "V", kind: "chart", range: "C3:G9", source: "A1:B4", type: "area", stacked: true },
    ];
  }
  const scratch = structuredClone(doc);
  const actions = [];
  const inverses = [];
  const history = [];
  for (let tries = 0; actions.length < length && tries < length * 20; tries++) {
    const stale = history.length > 0 && random() < 0.35;
    const action = actionOf(random, stale ? pick(random, history.slice(-3)) : scratch, inverses);
    if (action === null) continue;
    const placed = sheetCodec.needs(action).every((id) => sheetCodec.has(scratch, id)) && sheetCodec.creates(action).every((id) => !sheetCodec.has(scratch, id));
    const out = sheetCodec.apply(scratch, action);
    if (out.out !== "applied" && placed && (RESIDUAL.has(out.code) || (action.t === "batch" && BATCH_RESIDUAL.has(out.code)))) {
      count(`${action.t}:${out.code}`);
      continue;
    }
    count(`${action.t}:${out.out}${out.skipped?.length ? ":skipped" : ""}`);
    actions.push(action);
    history.push(structuredClone(scratch));
    if (out.out === "applied") inverses.push(out.inverse);
  }
  return { doc, record: RECORD, actions };
}

test("the codec laws hold with rules actions in the samples", () => {
  seen.clear();
  const failures = checkCodec(sheetCodec, rulesSample, { runs: 400, seed: 1, cap: 5 });
  expect(failures).toEqual([]);
  expect(seen.get("rules:applied") ?? 0).toBeGreaterThan(200);
  expect(seen.get("revert:applied:skipped") ?? 0).toBeGreaterThan(5);
});
