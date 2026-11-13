// Plugin ownership rules: what a plugin paints under its own boundary, read as plain
// data with no engine and no plugin code loaded. The rules here are the ones the grid
// will ship: a formula cell owns its text, and `n` is painted on every cell.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ownsAttr, paintsOf, eachPainted, stripPaints, PLUGIN_RULES } from "../src/ownership.js";
import * as before from "./fixtures/ownership-0.7.1.js";
import { MANIFEST } from "../src/plugin-manifest.js";
import { watchCells } from "./helpers/cell-reads.js";

const GRID = [
  { within: "table[grid]", select: "td[f]", text: true },
  { within: "table[grid]", select: "td", attrs: ["n"] },
];
const TALLY = [
  { within: "ol[tally]", select: "li[total]", text: true },
  { within: "ol[tally]", select: "ol", attrs: ["sum"] },
];
const grid = (ownership = GRID) => { window.sapPlugins = [{ name: "grid", ownership }]; };
const both = () => { window.sapPlugins = [{ name: "grid", ownership: GRID }, { name: "tally", ownership: TALLY }]; };
const $ = (selector) => document.querySelector(selector);
const P = (parts) => ({ attrs: [], classes: [], vars: [], text: false, ...parts });
const SHEET = `<table grid><tbody><tr><td id="formula" n f="=A1*2">80%</td><td id="number" n>12</td><td id="typed">hello</td></tr></tbody></table>`;
// The rules this project ships. Each test starts with none, and names the ones it needs.
const SHIPPED = PLUGIN_RULES.slice();

beforeEach(() => {
  PLUGIN_RULES.length = 0;
});

afterEach(() => {
  delete window.sapPlugins;
  PLUGIN_RULES.splice(0, PLUGIN_RULES.length, ...SHIPPED);
  document.body.innerHTML = "";
});

// What asking paintsOf of every element reports, the way eachPainted walked before rules.
function oneByOne(root, live, own = { paintsOf }) {
  const out = [];
  const apps = root.nodeType === 1 && root.hasAttribute("sap") ? [root] : [...root.querySelectorAll("[sap]")].filter((app) => !app.parentElement || !app.parentElement.closest("[sap]"));
  for (const app of apps) {
    for (const el of [app, ...app.querySelectorAll("*")]) {
      const p = own.paintsOf(el, live);
      if (p) out.push([el.id || el.localName, p]);
    }
  }
  return out;
}

function walked(root, live, own = { eachPainted }) {
  const out = [];
  own.eachPainted(root, (el, p) => out.push([el.id || el.localName, p]), live);
  return out;
}

describe("a rule", () => {
  test("rule: a formula cell in table[grid] in an app owns its text, with no engine loaded", () => {
    grid();
    document.body.innerHTML = `<main sap>${SHEET}</main>`;
    expect(window.Sap).toBeUndefined();
    expect(readFileSync(join(__dirname, "..", "src", "ownership.js"), "utf8")).not.toMatch(/^\s*import\b|\brequire\(/m);
    expect(paintsOf($("#formula"))).toEqual(P({ text: true, attrs: ["n"] }));
    expect(paintsOf($("#number"))).toEqual(P({ attrs: ["n"] }));
    expect(paintsOf($("#typed"))).toEqual(P({ attrs: ["n"] }));
    expect(paintsOf($("tr"))).toBeNull();
    expect([ownsAttr($("#number"), "n"), ownsAttr($("#formula"), "f"), ownsAttr($("tr"), "n")]).toEqual([true, false, false]);
  });

  test("rule: the same cell outside an app, or in a table that is not the boundary, owns nothing", () => {
    grid();
    document.body.innerHTML = `${SHEET}<b id="loose" text="1 + 1" n>2</b><main sap><table><tbody><tr><td id="plain" n f="=1">1</td></tr></tbody></table></main>`;
    for (const id of ["#formula", "#number", "#loose", "#plain"]) {
      expect(paintsOf($(id))).toBeNull();
      expect(ownsAttr($(id), "n")).toBe(false);
    }
    expect(walked(document)).toEqual([]);
  });

  test("rule: a boundary that is not in an app is not a boundary for an app nested in it", () => {
    grid();
    document.body.innerHTML = `<table grid><tbody><tr><td><main sap><b id="core" text="1 + 1">2</b><table><tbody><tr><td id="inner" n f="=1">1</td></tr></tbody></table></main></td></tr></tbody></table>`;
    expect(paintsOf($("#core"))).toEqual(P({ text: true }));
    expect(paintsOf($("#inner"))).toBeNull();
    expect(ownsAttr($("#inner"), "n")).toBe(false);
    expect(walked(document)).toEqual([["core", P({ text: true })]]);
  });

  test("live: a predicate is asked with the plugin's name, and false turns that plugin's rules off", () => {
    grid();
    document.body.innerHTML = `<main sap>${SHEET}</main>`;
    const asked = [];
    const no = (name) => (asked.push(name), false);
    expect(paintsOf($("#formula"), no)).toBeNull();
    expect(ownsAttr($("#number"), "n", null, no)).toBe(false);
    expect(walked(document, no)).toEqual([]);
    expect([...new Set(asked)]).toEqual(["grid"]);
    const clone = $("main").cloneNode(true);
    stripPaints(clone, no);
    expect(clone.outerHTML).toBe($("main").outerHTML);

    const yes = () => true;
    expect(paintsOf($("#formula"), yes)).toEqual(P({ text: true, attrs: ["n"] }));
    expect(ownsAttr($("#number"), "n", null, yes)).toBe(true);
    expect(walked(document, yes)).toEqual(walked(document));
    expect(walked(document)).toHaveLength(3);
  });

  test("strip: stripPaints empties formula cells, removes painted attributes, and keeps what was typed", () => {
    grid();
    document.body.innerHTML = `<main sap><h1 text="state.title">Budget</h1>${SHEET}</main>`;
    const clone = $("main").cloneNode(true);
    stripPaints(clone);
    expect(clone.outerHTML).toBe(`<main sap=""><h1 text="state.title"></h1><table grid=""><tbody><tr><td id="formula" f="=A1*2"></td><td id="number">12</td><td id="typed">hello</td></tr></tbody></table></main>`);
  });

  test("removed: a row taken out of the table is still read as painted when its host is given", () => {
    grid();
    document.body.innerHTML = `<main sap>${SHEET}<p id="plain"></p></main>`;
    const body = $("tbody");
    const row = $("tr");
    const cell = $("#number");
    row.remove();
    expect(ownsAttr(cell, "n")).toBe(false);
    expect(ownsAttr(cell, "n", body)).toBe(true);
    expect(ownsAttr(cell, "n", $("#plain"))).toBe(false);
    // The engine's own paints are read the same way: none under the table, and the usual ones elsewhere.
    for (const el of [row, cell]) {
      el.setAttribute("attr:title", "1");
      expect(ownsAttr(el, "title", $("#plain"))).toBe(true);
      expect(ownsAttr(el, "title", body)).toBe(false);
    }
  });
});

describe("under a boundary", () => {
  test("boundary: only rules say what is painted there, and the boundary element keeps the engine's paints", () => {
    grid();
    document.body.innerHTML = `<main sap><table id="table" grid show="state.open" attr:title="state.t" title="x"><tbody><tr>
      <td id="cell" n text="state.x" attr:title="state.t" title="x" class:on="state.on" css:w="state.w" show="state.open">1</td>
      <td><b id="deep" text="state.x" attr:title="state.t" title="x">1</b></td>
    </tr></tbody></table></main>`;
    expect(paintsOf($("#table"))).toEqual(P({ attrs: ["title", "hidden"] }));
    expect(paintsOf($("#cell"))).toEqual(P({ attrs: ["n"] }));
    expect(paintsOf($("#deep"))).toBeNull();
    expect([ownsAttr($("#table"), "title"), ownsAttr($("#cell"), "title"), ownsAttr($("#cell"), "hidden"), ownsAttr($("#deep"), "title")]).toEqual([true, false, false, false]);
    expect(before.paintsOf($("#deep"))).toEqual(P({ text: true, attrs: ["title"] }));
  });

  test("marker: an error marker under a boundary is painted, on a cell a rule selects and on one it does not", () => {
    grid();
    document.body.innerHTML = `<main sap><table grid><tbody><tr><td id="cell" sap-error="E24">1</td><td><b id="deep" sap-error="E24">1</b></td></tr></tbody></table></main>`;
    expect(paintsOf($("#cell"))).toEqual(P({ attrs: ["n", "sap-error"] }));
    expect(paintsOf($("#deep"))).toEqual(P({ attrs: ["sap-error"] }));
    expect(ownsAttr($("#deep"), "sap-error")).toBe(true);
    expect(walked(document)).toEqual(oneByOne(document));
    expect(walked(document).map(([id]) => id)).toEqual(["cell", "td", "deep"]);
  });

  test("scope: an element the engine enters as a scope of its own does not start a boundary", () => {
    grid([{ within: "[grid]", select: "b", text: true }]);
    document.body.innerHTML = `<main sap grid><ul items="rows" grid><li item grid data-id="a"><i id="core" text="item.t">1</i><b id="b1">1</b></li></ul>
      <section scope grid><i id="core2" text="1 + 1">2</i></section><div detail="rows by state.k" grid><i id="core3" text="1">1</i></div><p each="rows" grid><i id="core4" text="1">1</i></p>
      <div grid><i id="closed" text="1 + 1">2</i><b id="b2">1</b></div></main>`;
    for (const id of ["#core", "#core2", "#core3", "#core4"]) expect(paintsOf($(id))).toEqual(P({ text: true }));
    expect(paintsOf($("#b1"))).toBeNull();
    expect(paintsOf($("#closed"))).toBeNull();
    expect(paintsOf($("#b2"))).toEqual(P({ text: true }));
    expect(walked(document)).toEqual(oneByOne(document));
    expect(walked(document).map(([id]) => id)).toEqual(["core", "core2", "core3", "core4", "b2"]);
  });
});

describe("where rules come from", () => {
  test("static: a rule in PLUGIN_RULES counts with no definition on the page", () => {
    PLUGIN_RULES.push(...GRID.map((rule) => ({ ...rule, plugin: "grid" })));
    document.body.innerHTML = `<main sap>${SHEET}</main>`;
    expect(window.sapPlugins).toBeUndefined();
    expect(paintsOf($("#formula"))).toEqual(P({ text: true, attrs: ["n"] }));
    const asked = [];
    paintsOf($("#formula"), (name) => (asked.push(name), true));
    expect(asked).toEqual(["grid", "grid"]);
  });

  test("static: the definition of a plugin that has static rules adds no second copy of them", () => {
    PLUGIN_RULES.push(...GRID.map((rule) => ({ ...rule, plugin: "grid" })));
    document.body.innerHTML = `<main sap>${SHEET}</main>`;
    grid([...GRID, { within: "table[grid]", select: "td", attrs: ["extra"] }]);
    const asked = [];
    expect(paintsOf($("#formula"), (name) => (asked.push(name), true))).toEqual(P({ text: true, attrs: ["n"] }));
    expect(asked).toEqual(["grid", "grid"]);
  });

  test("definitions: a rule counts from the moment its definition is on the page, under the definition's name", () => {
    document.body.innerHTML = `<main sap>${SHEET}</main>`;
    expect(paintsOf($("#formula"))).toBeNull();
    window.sapPlugins = [];
    expect(paintsOf($("#formula"))).toBeNull();
    window.sapPlugins.push({ name: "no-rules" }, null, { name: "sheet", ownership: [{ ...GRID[0], plugin: "ignored" }] });
    const asked = [];
    expect(paintsOf($("#formula"), (name) => (asked.push(name), true))).toEqual(P({ text: true }));
    expect(asked).toEqual(["sheet"]);
    window.sapPlugins.push({ name: "more", ownership: [GRID[1]] });
    expect(paintsOf($("#formula"))).toEqual(P({ text: true, attrs: ["n"] }));
  });

  test("foreign: a window.sapPlugins that is not a list gives no rules and no error", () => {
    document.body.innerHTML = `<main sap>${SHEET}<b id="core" text="1 + 1">2</b></main>`;
    for (const foreign of ["taken", { length: 2, 0: { name: "x", ownership: GRID } }, 7]) {
      window.sapPlugins = foreign;
      expect(paintsOf($("#formula"))).toBeNull();
      expect(walked(document)).toEqual([["core", P({ text: true })]]);
    }
  });

  test("refused: a rule that could not be asked is left out, and the rules beside it still count", () => {
    document.body.innerHTML = `<main sap>${SHEET}<b id="core" text="1 + 1">2</b></main>`;
    const bad = [
      null,
      "td",
      { select: "td", text: true },
      { within: "table[grid]", text: true },
      { within: "table[", select: "td", text: true },
      { within: "table[grid]", select: "td >", text: true },
      { within: "", select: "td", text: true },
      { within: "table[grid]", select: "td", attrs: "n" },
      { within: 7, select: "td", text: true },
    ];
    for (const rule of bad) {
      grid([rule]);
      expect(paintsOf($("#number"))).toBeNull();
      expect(ownsAttr($("#number"), "n")).toBe(false);
      expect(walked(document)).toEqual([["core", P({ text: true })]]);
    }
    grid([...bad, GRID[1]]);
    expect(paintsOf($("#number"))).toEqual(P({ attrs: ["n"] }));
    expect(walked(document).map(([id]) => id)).toEqual(["formula", "number", "typed", "core"]);
  });

  test("table: every static rule belongs to a plugin the manifest names", () => {
    expect(Array.isArray(PLUGIN_RULES)).toBe(true);
    expect(SHIPPED.filter((rule) => !MANIFEST[rule.plugin])).toEqual([]);
  });
});

describe("eachPainted with rules", () => {
  const PAGE = `<main sap id="app" sap-error="loop">
    <h1 id="h1" text="state.title" class:big="state.big">Budget</h1>
    <table id="t1" grid attr:title="state.t"><tbody>
      <tr><td id="a1">typed</td><td id="b1" n f="=A1">1</td><td id="c1" n sap-error="E24">2</td></tr>
      <tr><td id="a2" f="=B1">7</td><td id="b2"><div id="island" sap-ignore sap-error="E01"><table><tbody><tr><td id="ignored" n f="=1">1</td></tr></tbody></table><ol tally><li id="deadsum" total>3</li></ol></div><b id="bold" sap-error="E24">x</b></td>
        <td id="c2"><table id="t2" grid><tbody><tr><td id="inner" f="=1">1</td></tr></tbody></table></td>
        <td id="d2"><ol id="list" tally><li id="li1">3</li><li id="sum" total>3</li></ol><ol items="rows" tally><li id="not" total>3</li></ol></td></tr>
    </tbody></table>
    <p id="p" show="state.open" attr:title="state.t">after</p>
    <ol id="list2" tally text="state.x"><li id="li2">3</li><li id="sum2" total>3</li><li><table grid id="t3"><tbody><tr><td id="under" f="=1">1</td></tr></tbody></table></li></ol>
    <div id="off" sap-ignore><table grid><tbody><tr><td id="off-cell" n f="=1">1</td></tr></tbody></table></div>
  </main>`;

  test("walk: it visits exactly what paintsOf reports for every element, in document order", () => {
    both();
    document.body.innerHTML = PAGE;
    const visits = walked(document);
    expect(visits).toEqual(oneByOne(document));
    expect(visits.map(([id]) => id)).toEqual(["app", "h1", "t1", "a1", "b1", "c1", "a2", "b2", "island", "ignored", "bold", "c2", "inner", "d2", "list", "sum", "p", "list2", "sum2", "under"]);
    expect(Object.fromEntries(visits)).toMatchObject({
      t1: P({ attrs: ["title"] }),
      c1: P({ attrs: ["n", "sap-error"] }),
      bold: P({ attrs: ["sap-error"] }),
      inner: P({ text: true, attrs: ["n"] }),
      list: P({ attrs: ["sum"] }),
      sum: P({ text: true }),
      list2: P({ attrs: ["sum"], text: true }),
      under: P({ text: true, attrs: ["n"] }),
    });
  });

  test("walk: the same holds from a root element, for a detached copy, and with one plugin's rules off", () => {
    both();
    document.body.innerHTML = PAGE;
    expect(walked($("#app"))).toEqual(walked(document));
    const copy = document.createElement("div");
    copy.append($("#app").cloneNode(true));
    expect(walked(copy)).toEqual(walked(document));

    for (const off of ["grid", "tally"]) {
      const live = (name) => name !== off;
      expect(walked(document, live)).toEqual(oneByOne(document, live));
      expect(walked(document, live).length).toBeLessThan(walked(document).length);
    }
  });

  test("ignored: a [sap] root inside an ignored subtree is an app again, as it was before rules", () => {
    document.body.innerHTML = `<main sap><b id="a" text="1">1</b>
      <div sap-ignore><i id="dead" text="1">1</i><section sap id="again"><b id="b" text="1">1</b><table grid><tbody><tr><td id="cell" n f="=1">1</td></tr></tbody></table>
        <div template><i id="dead2" text="1">1</i><div sap sap-ignore id="never"><p sap id="deep"><b id="c" show="1">1</b></p></div></div>
        <section sap id="nested"><b id="d" text="1">1</b></section></section><i id="dead3" text="1">1</i></div>
      <b id="e" text="1">1</b></main>`;
    const old = walked(document, null, before);
    expect(old.map(([id]) => id)).toEqual(["a", "b", "c", "d", "e"]);
    grid([{ within: "ul[none]", select: "li", text: true }]);
    expect(walked(document)).toEqual(old);
    grid();
    expect(walked(document)).toEqual(oneByOne(document));
    expect(walked(document).map(([id]) => id)).toEqual(["a", "b", "cell", "c", "d", "e"]);
  });

  test("nested: a root handed in from under a boundary is asked element by element", () => {
    grid();
    document.body.innerHTML = `<main sap><table grid><tbody><tr><td id="outer" n><section sap id="root"><b id="core" text="1">1</b><table><tbody><tr><td id="cell" f="=1">1</td></tr></tbody></table></section></td></tr></tbody></table></main>`;
    expect(walked($("#root"))).toEqual(oneByOne($("#root")));
    expect(walked($("#root"))).toEqual([["cell", P({ text: true, attrs: ["n"] })]]);
    expect(walked(document).map(([id]) => id)).toEqual(["outer", "cell"]);
  });

  test("cells: a boundary is asked by selector, so no cell is read one by one", () => {
    grid();
    const sheet = (marker) => {
      let rows = "";
      for (let r = 0; r < 40; r++) rows += `<tr><td n f="=A1">1</td><td n>2</td><td>three</td><td n ${r < 2 ? marker : ""}>4</td><td>five</td></tr>`;
      return `<main sap><h1 text="state.t">T</h1><table grid><tbody>${rows}</tbody></table></main>`;
    };
    const watch = watchCells(window);
    const asked = [];
    const real = window.Element.prototype.querySelectorAll;
    window.Element.prototype.querySelectorAll = function (selector) {
      if (this.localName === "table") asked.push(selector);
      return real.call(this, selector);
    };
    try {
      document.body.innerHTML = sheet("");
      let visits = 0;
      expect(watch.during(() => eachPainted(document, () => visits++))).toBe(0);
      expect(visits).toBe(201);
      expect(asked).toEqual(["td[f]", "td", "[sap-error]"]);
      expect(watch.during(() => oneByOne(document))).toBe(240);
      expect(watch.during(() => walked(document, null, before))).toBeGreaterThan(2000);

      document.body.innerHTML = sheet(`sap-error="E24"`);
      asked.length = 0;
      expect(watch.during(() => eachPainted(document, () => {}))).toBe(0);
      expect(asked).toEqual(["td[f]", "td", "[sap-error]"]);
    } finally {
      window.Element.prototype.querySelectorAll = real;
      watch.stop();
    }
    expect(walked(document)).toEqual(oneByOne(document));
    expect(walked(document).filter(([, p]) => p.attrs.includes("sap-error"))).toHaveLength(2);
  });
});
