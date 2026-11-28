// The grid plugin on the sapjs plugin contract, installed with Sap.use as a page would before the
// manifest names it. The first test runs with no grid plugin, so it comes first and installs
// nothing. Every other test installs the plugin itself, because Sap.use is safe to call again,
// so each one also runs alone. Sap.unmount hands the page away for good, so its test is last.

import { tokenize } from "../../src/grid/formula/text.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { parseRef } from "../../src/grid/a1.js";
import { keysBetween } from "../../src/grid/codec/order-keys.js";
import { patchGrid } from "../../src/grid/codec/patch.js";
import { gridModel } from "../../src/grid/codec/read.js";
import { tableHtml } from "../../src/grid/codec/write.js";
import { detectDelimiter, parseDelimited, protectField, writeDelimited } from "../../src/grid/csv.js";
import { adjustDecimals, fmtKind, formatValue } from "../../src/grid/format.js";
import { newId } from "../../src/grid/grid.js";
import { editText, parseInput } from "../../src/grid/input.js";
import { GridRefused } from "../../src/grid/ops.js";
import { BEACON, eachPainted, ownsAttr, paintsOf } from "../../src/ownership.js";
import gridPlugin from "../../src/plugins/grid.js";
import Sap from "../../src/sap.js";
import { splitTables } from "./support/laws.js";

const GOLDEN = join(__dirname, "..", "grid-codec", "golden");
const REPAIR = join(__dirname, "golden", "repair");

const EMPTY_LISTS = { added: [], removed: [], changed: [] };

function goldenTables() {
  const files = readdirSync(GOLDEN).filter((name) => name.endsWith(".html")).sort();
  const tables = [];
  for (const file of files) {
    splitTables(readFileSync(join(GOLDEN, file), "utf8")).forEach((src, index) => {
      tables.push({ name: `${file.replace(/\.html$/, "")}#${index}`, html: tableHtml(gridModel(src, 0)) });
    });
  }
  return tables;
}

const TINY = goldenTables().find((table) => table.name === "tiny#0").html;

const repairInputs = () =>
  readdirSync(REPAIR)
    .filter((name) => name.endsWith(".in.html"))
    .sort()
    .map((file) => ({ name: file, html: readFileSync(join(REPAIR, file), "utf8") }));

// A table of `count` data rows in one tbody, as a person writes a long table by hand: its records
// and cells are sound, and only its parts are not the writer's.
function longTable(count) {
  const rows = keysBetween(null, null, count).map((pos, r) => ({ id: `r${r}`, pos, cells: [{ text: `row ${r}` }] }));
  return tableHtml({ cols: [{ id: "ca", pos: "V" }], rows }, { groupSize: count + 1 });
}

const tab = (html) => `<div items="sheets"><section item data-id="s1"><h2 bind="name">Budget</h2>${html}</section></div>`;

// Every pass of every app, as its trigger and its change list ("type:tag" for each change, null for
// a full pass), recorded by a plugin of the test's own that runs after the grid's begin.
const passes = [];
const probe = {
  name: "probe",
  api: 1,
  setup: () => ({
    begin(pass) {
      passes.push({ trigger: pass.trigger, changes: pass.changes === null ? null : pass.changes.map((change) => `${change.type}:${change.element.localName}`) });
    },
  }),
};

const install = () => Sap.use(gridPlugin);

const observers = [];

beforeAll(() => {
  Sap.use(probe);
});

afterEach(() => {
  for (const observer of observers.splice(0)) observer.disconnect();
  delete window.clay;
  delete window.hyperclay;
});

// Mounts the first [sap] of `html` in a fresh body. `records()` counts the mutation records the
// body saw since the page was set, or since the last call; `before` is the app's markup as parsed,
// before the mount; `td(ref)` is the cell at an A1 reference of the first table.
function page(html) {
  document.body.innerHTML = html;
  const root = document.querySelector("[sap]");
  const before = root.innerHTML;
  const observer = new MutationObserver(() => {});
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  observers.push(observer);
  Sap._reset();
  Sap.mount(root);
  const table = root.querySelector("table");
  const td = (ref) => {
    const { row, col } = parseRef(ref);
    return table.rows[row].cells[col];
  };
  return { root, table, before, td, records: () => observer.takeRecords().length };
}

// Delivers what the page has queued and runs every pass it asks for, then lets one task go by.
async function settle() {
  Sap.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
  Sap.flush();
}

function listen(grid) {
  const heard = [];
  grid.on("change", (event) => heard.push(event));
  return heard;
}

const refusal = (run) => {
  try {
    run();
  } catch (error) {
    return [error instanceof GridRefused, error.code];
  }
  return "ran";
};

test("with the grid's facts declared and no plugin, the table keeps its bytes and the engine stays out of it", async () => {
  Sap.plugins.retryDelays.length = 0;
  Sap.plugins.loader = (name) => (name === "grid" ? new Promise(() => {}) : undefined);
  Sap.plugins.declare({ name: gridPlugin.name, order: gridPlugin.order, boundaries: gridPlugin.boundaries });
  const p = page(
    `<main sap state="n:num" n="1"><table grid><colgroup><col data-id="ca" data-pos="V"></colgroup><tbody><tr data-id="r1" data-pos="V"><td text="state.n + 1">saved</td><td>{{x}}</td><td bind="note">kept</td></tr></tbody></table><div grid><b text="state.n + 1">saved</b></div></main>`,
  );
  const table = p.table.outerHTML;
  await settle();
  expect([Sap.plugins.has("grid"), Sap.plugins.status().loading, Sap.grid]).toEqual([false, ["grid"], undefined]);
  expect([Sap._registry.get(p.root).halted ?? false, Sap.report().errors, p.table.outerHTML]).toEqual([false, [], table]);
  expect([p.root.querySelector("td").textContent, p.root.querySelector("b").textContent]).toEqual(["saved", "2"]);
  p.root.setAttribute("n", "5");
  await settle();
  expect([p.root.querySelector("td").textContent, p.root.querySelector("b").textContent, p.table.outerHTML]).toEqual(["saved", "6", table]);
  Sap.plugins.loader = null;
});

test("Sap.grid exists after install, and Sap.use called twice still gives one grid per table", async () => {
  const p = page(`<main sap>${TINY}</main>`);
  const api = install();
  expect(Sap.use(gridPlugin)).toBe(api);
  expect([Sap.plugins.has("grid"), typeof Sap.grid, api.grid]).toEqual([true, "function", Sap.grid]);
  expect([Sap.grid.parseInput, Sap.grid.editText, Sap.grid.formatValue, Sap.grid.newId]).toEqual([parseInput, editText, formatValue, newId]);
  expect(Sap.grid.csv).toEqual({ detectDelimiter, parseDelimited, writeDelimited, protectField });
  // Bug this guards: ClayJS's formula editor reads Sap.grid.tokenize; without it, clicking a cell
  // while typing a formula inserts no reference.
  expect(Sap.grid.tokenize).toBe(tokenize);
  // ClayJS's number-format menu and decimals buttons read these two.
  expect([Sap.grid.fmtKind, Sap.grid.adjustDecimals]).toEqual([fmtKind, adjustDecimals]);
  // A host's chart panel holds a drawing to the codec's rule and reads a save's drawings back.
  expect([Sap.grid.drawingProblem, Sap.grid.drawingsIn, Sap.grid.areaOf].map((fn) => typeof fn)).toEqual(["function", "function", "function"]);

  // Asked for before the plugin's first pass, with a raw edit in the same turn: the pass that
  // follows the install reads it.
  const g = Sap.grid(p.table);
  expect(Sap.grid(p.table)).toBe(g);
  const heard = listen(g);
  p.td("A2").textContent = "Lodging";
  await settle();
  expect([g.get("A2"), heard.map((event) => event.source), Sap.grid(p.table)]).toEqual(["Lodging", ["dom"], g]);
  expect(Sap.use(gridPlugin)).toBe(api);
  p.td("A3").textContent = "Meals";
  await settle();
  expect([g.get("A3"), heard.map((event) => event.source)]).toEqual(["Meals", ["dom", "dom"]]);
});

// It mounts every golden table and repair input (19 or more): under a second alone, but over
// Jest's default 5 s under hypersave's parallel checks, and a timed-out mount spills into the
// next tests.
test("mount leaves the bytes of every fixture unchanged", async () => {
  install();
  const fixtures = [...goldenTables(), ...repairInputs()];
  expect(fixtures.length).toBeGreaterThanOrEqual(19);
  const seen = [];
  for (const fixture of fixtures) {
    const p = page(`<main sap>${fixture.html}</main>`);
    await settle();
    const grid = Sap.grid(p.table);
    seen.push([fixture.name, p.records(), p.root.innerHTML === p.before, grid.size.rows === p.table.rows.length]);
  }
  expect(seen).toEqual(fixtures.map((fixture) => [fixture.name, 0, true, true]));
}, 30000);

test('a raw td.textContent = "5" gives one event with source "dom", the mirror has 5, the old v is gone and n is on the cell, with no extra pass', async () => {
  install();
  const p = page(`<main sap>${tab(TINY)}</main>`);
  const g = Sap.grid(p.table);
  const heard = listen(g);
  await settle();
  const from = passes.length;
  p.td("B2").textContent = "5";
  await settle();
  expect(heard).toEqual([{ sheet: "s1", source: "dom", structure: false, cells: [{ row: "r2", col: "cb", before: 1200, after: 5 }], rows: EMPTY_LISTS, cols: EMPTY_LISTS, revision: 1 }]);
  expect([g.get("B2"), p.td("B2").outerHTML]).toEqual([5, '<td n="" v="5">$5.00</td>']);
  expect(passes.slice(from)).toEqual([{ trigger: "mutation", changes: ["characterData:td"] }]);

  // Writes to two rows in one turn are one event.
  p.td("B2").textContent = "6";
  p.td("B3").textContent = "7";
  await settle();
  expect(heard.slice(1).map((event) => [event.source, event.cells, event.revision])).toEqual([
    [
      "dom",
      [
        { row: "r2", col: "cb", before: 5, after: 6 },
        { row: "r3", col: "cb", before: 300, after: 7 },
      ],
      2,
    ],
  ]);
});

test("a raw removal inside a row is read from the row it left", async () => {
  install();
  const p = page(`<main sap>${TINY}</main>`);
  const g = Sap.grid(p.table);
  const heard = listen(g);
  await settle();
  p.td("C3").remove();
  await settle();
  expect([g.get("C3"), heard.map((event) => [event.source, event.cells])]).toEqual([null, [["dom", [{ row: "r3", col: "cc", before: { f: "=B3/B$5" }, after: null }]]]]);
});

test("the grid's own write gives exactly one event", async () => {
  install();
  const p = page(`<main sap>${TINY}</main>`);
  const g = Sap.grid(p.table);
  const heard = listen(g);
  await settle();
  const from = passes.length;
  const event = g.set("B2", "450");
  await settle();
  expect([heard, g.revision, g.get("B2")]).toEqual([[event], 1, 450]);
  expect(event.cells).toEqual([{ row: "r2", col: "cb", before: 1200, after: 450 }]);
  expect(passes.slice(from).map((pass) => [pass.trigger, pass.changes.length > 0])).toEqual([["plugin:grid", true]]);
});

test("a write schedules one pass, and a write of derived parts only lists no change in it", async () => {
  install();
  const p = page(`<main sap>${longTable(120)}</main>`);
  const g = Sap.grid(p.table);
  await settle();
  const from = passes.length;
  const event = g.repair();
  expect([event.source, p.table.tBodies.length]).toEqual(["repair", 3]);
  await settle();
  expect(passes.slice(from)).toEqual([{ trigger: "plugin:grid", changes: [] }]);
});

test("on a page whose hub reports no change, a write still schedules one pass, with an empty change list, and a dependent repaints", async () => {
  install();
  window.hyperclay = { Mutation: { onAnyChange: () => () => {}, pause() {}, resume() {} } };
  const p = page(
    `<main sap><table grid><colgroup><col data-id="ca" data-pos="V"></colgroup><tbody><tr data-id="r1" data-pos="V"><td n>1</td></tr></tbody></table><output text="Sap.grid(el.closest('main').querySelector('table')).get('A1') * 2">2</output></main>`,
  );
  await settle();
  const from = passes.length;
  Sap.grid(p.table).set("A1", "21");
  await settle();
  expect(passes.slice(from)).toEqual([{ trigger: "plugin:grid", changes: [] }]);
  expect(p.root.querySelector("output").textContent).toBe("42");
});

test("a raw row insert makes the grid read the whole table again and check it", async () => {
  install();
  const p = page(`<main sap>${TINY}</main>`);
  const g = Sap.grid(p.table);
  const heard = listen(g);
  await settle();
  p.table.tBodies[0].append(p.table.querySelector('tr[data-id="r3"]').cloneNode(true));
  await settle();
  expect(heard.map((event) => [event.source, event.rescanned, event.structure])).toEqual([["dom", true, true]]);
  expect([g.size, g.issues.map((issue) => issue.code), g.get("A7")]).toEqual([{ rows: 7, cols: 3 }, ["row_id_duplicate", "row_pos_order"], "Food"]);
  expect(refusal(() => g.set("A2", "x"))).toEqual([true, "needs_repair"]);
});

test("Sap.refresh() reads every known table again", async () => {
  install();
  const p = page(`<main sap>${TINY}</main>`);
  const g = Sap.grid(p.table);
  const heard = listen(g);
  await settle();
  p.td("A2").textContent = "Lodging";
  Sap.refresh();
  expect([g.get("A2"), heard.map((event) => [event.source, event.rescanned])]).toEqual(["Lodging", [["dom", true]]]);
  await settle();
  Sap.refresh();
  expect(heard.length).toBe(1);
});

test("Sap.report lists each issue code of a damaged table once, the list follows the table's issues, and the app keeps running", async () => {
  install();
  const lint = () => Sap.report().warnings.map((warning) => [warning.code, warning.attr, warning.key]);
  const listing = (grid) => [...new Set(grid.issues.map((issue) => issue.code))].map((code) => ["W60", "grid", code]);
  const p = page(`<main sap state="n:num" n="1">${readFileSync(join(REPAIR, "duplicate-ids.in.html"), "utf8")}<output text="state.n + 1">2</output></main>`);
  const g = Sap.grid(p.table);
  expect([g.issues.map((issue) => issue.code), lint()]).toEqual([["row_id_duplicate", "row_id_duplicate"], [["W60", "grid", "row_id_duplicate"]]]);
  Sap.refresh();
  p.root.setAttribute("n", "5");
  await settle();
  expect([Sap._registry.get(p.root).halted ?? false, p.root.querySelector("output").textContent, lint()]).toEqual([false, "6", [["W60", "grid", "row_id_duplicate"]]]);

  g.repair();
  await settle();
  expect([g.issues, lint()]).toEqual([[], []]);
  const last = p.table.querySelector("tbody tr:last-child");
  last.after(last.cloneNode(true));
  await settle();
  expect(g.issues.length).toBeGreaterThan(0);
  expect(lint()).toEqual(listing(g));
  p.table.remove();
  await settle();
  expect(lint()).toEqual([]);

  // A sound table lists nothing, and the grid's own table attributes are not unknown to lint.
  page(`<main sap>${TINY.replace("<table grid", "<table grid stale")}</main>`);
  expect(Sap.report().warnings).toEqual([]);
});

test("a removed table is forgotten: its Grid is let go, and the table is read fresh if it comes back", async () => {
  install();
  const p = page(`<main sap>${TINY}</main>`);
  const g = Sap.grid(p.table);
  const heard = listen(g);
  await settle();
  p.table.remove();
  await settle();
  p.td("A2").textContent = "Lodging";
  p.root.append(p.table);
  await settle();
  const again = Sap.grid(p.table);
  expect([again === g, again.get("A2"), again.revision, heard]).toEqual([false, "Lodging", 0, []]);
});

test("a grid attribute on a div is ignored", async () => {
  install();
  const p = page(
    `<main sap state="n:num" n="1"><div grid><b text="state.n + 1">saved</b></div><table grid><colgroup><col data-id="ca" data-pos="G"><col data-id="cb" data-pos="V"></colgroup><tbody><tr data-id="r1" data-pos="V"><td text="state.n + 1">saved</td><td>{{x}}</td></tr></tbody></table></main>`,
  );
  await settle();
  expect([p.root.querySelector("b").textContent, p.root.querySelector("td").textContent, Sap._registry.get(p.root).halted ?? false, Sap.report().errors]).toEqual([
    "2",
    "saved",
    false,
    [],
  ]);
  expect(() => Sap.grid(p.root.querySelector("div"))).toThrow(TypeError);
  expect(Sap.grid(p.table).get("B1")).toBe("{{x}}");
});

test("a read-only page refuses every command, and still takes a write from outside the grid", async () => {
  install();
  window.clay = {
    modeLifecycle: { canWrite: () => false },
    region: { resolveRegionPolicy: (node) => ({ persist: node.closest('[clay~="no-save"]') ? "none" : "full" }) },
  };
  const p = page(`<main sap>${TINY}<div clay="no-save">${TINY.replace(/data-id="(r|c)/g, 'data-id="x$1')}</div></main>`);
  const [saved, scratch] = [...p.root.querySelectorAll("table")];
  const g = Sap.grid(saved);
  const bytes = saved.outerHTML;
  const commands = [() => g.set("B2", "1"), () => g.setRange("A2", [["a", "b"]]), () => g.clear("B2:B3"), () => g.format("B2", { fmt: "0%" }), () => g.repair()];
  expect(commands.map(refusal)).toEqual(commands.map(() => [true, "read_only"]));
  expect([saved.outerHTML, g.revision]).toEqual([bytes, 0]);

  p.td("B2").textContent = "5";
  await settle();
  expect([g.get("B2"), g.revision]).toEqual([5, 1]);
  expect(Sap.grid(scratch).set("B2", "9").source).toBe("api");
});

// A host's undo as ClayJS runs it: it records the page's writes made outside a pause, and leaves out
// each attribute record the ownership rules call painted, judged on the element after the write.
// `step()` takes what was recorded since the last call, and `undo(step)` writes it back.
function hostUndo() {
  const observer = new MutationObserver(() => {});
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true, attributeOldValue: true, characterDataOldValue: true });
  observers.push(observer);
  const recorded = [];
  let depth = 0;
  window.clay = {
    undo: {
      pause() {
        if (depth++ === 0) recorded.push(...observer.takeRecords());
      },
      resume() {
        if (--depth === 0) observer.takeRecords();
      },
    },
  };
  return {
    step() {
      recorded.push(...observer.takeRecords());
      return recorded.splice(0).filter((record) => record.type !== "attributes" || !ownsAttr(record.target, record.attributeName));
    },
    undo(step) {
      for (const record of [...step].reverse()) {
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
    },
  };
}

// The painted values under root, in document order: the list a host compares between the file and
// the page to tell whether opening the page repainted it (ClayJS's paint heal builds the same list
// with eachPainted, and saves the page when the two differ).
function paintedValues(root) {
  const parts = [];
  eachPainted(root, (el, paints) => {
    parts.push(el.localName);
    for (const name of paints.attrs) if (name !== BEACON) parts.push(`${name}=${el.getAttribute(name) ?? "\u0000"}`);
    for (const token of paints.classes) parts.push(`.${token}=${el.classList.contains(token)}`);
    for (const name of paints.vars) parts.push(`${name}=${el.style.getPropertyValue(name)}`);
    if (paints.text) parts.push(`#${el.textContent}`);
  });
  return parts;
}

const MONEY = `<table grid><colgroup><col data-id="ca" data-pos="G"><col data-id="cb" data-pos="O" fmt="$#,##0.00"><col data-id="cc" data-pos="V"></colgroup><tbody><tr data-id="r1" data-pos="G"><td n>3</td><td n v="7">$7.00</td><td>end</td></tr></tbody></table>`;

test("painted parts: only n is painted, so a formula's text and v and a value cell's shown text are the file's", () => {
  install();
  const p = page(`<main sap>${TINY}</main>`);
  const painted = (ref) => {
    const paints = paintsOf(p.td(ref));
    return paints && [paints.text, paints.attrs.slice().sort()];
  };
  expect(["C2", "B2", "A2", "A1", "C6"].map(painted)).toEqual([
    [false, ["n"]],
    [false, ["n"]],
    [false, ["n"]],
    [false, ["n"]],
    [false, ["n"]],
  ]);
  expect([ownsAttr(p.td("C2"), "v"), ownsAttr(p.td("B2"), "v"), ownsAttr(p.td("C2"), "n"), ownsAttr(p.td("B2"), "n")]).toEqual([false, false, true, true]);
  expect([paintsOf(p.table), paintsOf(p.table.querySelector("col")), paintsOf(p.table.rows[1])]).toEqual([null, null, null]);
});

test("painted parts: a host's undo of a formula typed over $7.00 gives back the number 7", async () => {
  install();
  const p = page(`<main sap>${MONEY}</main>`);
  const g = Sap.grid(p.table);
  await settle();
  const host = hostUndo();
  g.set("B1", "=A1*2");
  await settle();
  const step = host.step();
  expect([p.td("B1").getAttribute("f"), p.td("B1").hasAttribute("v"), p.td("B1").textContent]).toEqual(["=A1*2", false, ""]);
  host.undo(step);
  await settle();
  expect([g.get("B1"), p.td("B1").getAttribute("v"), p.td("B1").textContent, p.td("B1").hasAttribute("f")]).toEqual([7, "7", "$7.00", false]);
});

test("painted parts: opening a sheet an agent wrote repaints its text, and the page's painted values are still the file's", async () => {
  install();
  const file = `<main sap>${patchGrid(MONEY, [{ range: "B1", values: [[1234.5]] }]).bytes}</main>`;
  expect([file.includes("<table grid stale>"), file.includes("<td n>1234.5</td>")]).toEqual([true, true]);
  const saved = paintedValues(new DOMParser().parseFromString(file, "text/html"));
  const p = page(file);
  await settle();
  expect([p.td("B1").textContent, p.td("B1").getAttribute("v"), p.table.hasAttribute("stale")]).toEqual(["$1,234.50", "1234.5", false]);
  expect(paintedValues(document)).toEqual(saved);
});

test("Sap.unmount leaves no listener", async () => {
  install();
  const p = page(`<main sap>${TINY}</main>`);
  const g = Sap.grid(p.table);
  const heard = listen(g);
  await settle();
  Sap.unmount();
  p.td("B2").textContent = "9";
  g.set("A2", "Lodging");
  await settle();
  expect([heard, p.td("A2").textContent]).toEqual([[], "Lodging"]);
  expect(Sap.grid(p.table)).not.toBe(g);
});

// Bug this guards: the engine was let go with the last tab sheets() had seen, so after adding a
// tab and deleting the first, functions that arrived never reached the tab still open.
test("deleting the first tab after adding one keeps the page's engine", async () => {
  install();
  const sheet = (prefix, cells) => ({ cols: [{ id: `${prefix}c1`, pos: "A" }], rows: [{ id: `${prefix}r1`, pos: "A", cells }] });
  const p = page(`<main sap><div id="book" items="tabs"><section item data-id="s1" data-pos="A"><h2>One</h2>${tableHtml(sheet("s1", [{ text: "1", n: true }]))}</section></div></main>`);
  const book = p.root.querySelector("#book");
  const made = Sap.grid.sheets(book);
  await settle();
  const first = made.grid(book.querySelector("table"));
  first.apply({ v: 1, t: "insertSheet", sheet: { id: "s2", name: "Two", pos: "B", html: tableHtml(sheet("s2", [{ text: "", f: "=TWICE(2)" }])) } });
  first.apply({ v: 1, t: "deleteSheet", sheet: "s1" });
  await settle();
  const remove = Sap.grid.extend({ functions: [["TWICE", { run: ([x]) => 2 * x }]] });
  try {
    expect(book.querySelector("table td").textContent).toBe("4");
  } finally {
    remove();
  }
});
