// The closed boundary rule: a plugin boundary that is opaque, or whose plugin has not
// installed, is one element to the engine. Lint, the pass, the plan cache, the read
// cache, the mutation bridge, the accessor walk, the green line counts and mount
// discovery all stop at it, so a saved table keeps its bytes while its plugin is absent.

import { mount, Sap } from "./helpers/mount.js";
import { watchCells } from "./helpers/cell-reads.js";
import { runtime } from "../src/sap.js";
import { MANIFEST, PLUGIN_API } from "../src/plugin-manifest.js";
import { declareFacts, setInstalled, boundaryOf, closedBoundary, insideClosedBoundary, walkVisible } from "../src/registry.js";
import { registerFeature, unregisterFeature } from "../src/pass.js";

const tick = async (n = 4) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

const GRID = { name: "grid", file: "grid", order: 5, boundaries: { grid: { opaque: true, on: "table" } }, helpers: ["cell", "range"] };
const PANEL = { name: "panel", boundaries: { panel: { opaque: false } } };

const entered = [];

// What a host does when a plugin installs: its boundary handlers join the pass and the
// registry learns that its boundaries have an owner.
const PROBES = {
  grid: { name: "grid-probe", boundary: { grid(pass, el) { entered.push(el); } } },
  panel: {
    name: "panel-probe",
    boundary: {
      panel(pass, el, plan, scopeObj, ctx) {
        entered.push(el);
        pass.walkScope(el, scopeObj, ctx);
      },
    },
  },
};

function install(plugin) {
  registerFeature(PROBES[plugin]);
  setInstalled(plugin, true);
}

beforeAll(() => {
  declareFacts(GRID);
  declareFacts(PANEL);
});

beforeEach(() => {
  entered.length = 0;
});

afterEach(() => {
  for (const plugin of Object.keys(PROBES)) {
    unregisterFeature(PROBES[plugin]);
    setInstalled(plugin, false);
  }
  Sap._reset();
});

const CELLS = `<tbody><tr><td>{{literal}}</td><td bind="x">kept</td><td calc:y="1 + 1" text="state.n * 2">saved</td><td x-text="foo">foreign</td><td><input bind="inner" value="v"></td></tr></tbody>`;

const SHEET = `<main sap state="n:num" n="2">
  <section items="sheets"><article item data-id="s1"><h2 bind="name">Budget</h2><table grid>${CELLS}</table></article></section>
  <output id="out" text="state.n * 2">4</output>
</main>`;

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html;
  return t.content.firstElementChild;
}

// Every change the mutation bridge hands the scheduler is resolved with one appFor call.
async function bridged(act) {
  await tick();
  const spy = jest.spyOn(runtime, "appFor");
  try {
    act();
    await tick();
    return spy.mock.calls.map(([target]) => target);
  } finally {
    spy.mockRestore();
  }
}

// How many times fn made the engine read a table cell. A row added to a table is the
// one node the mutation bridge may look at, so rows are not counted here.
async function cellReads(fn) {
  const cellsRead = watchCells(window, ["td"]);
  try {
    return await cellsRead.during(fn);
  } finally {
    cellsRead.stop();
  }
}

describe("dispatch: which elements are plugin boundaries", () => {
  test("the manifest ships no first party plugin yet", () => {
    expect(PLUGIN_API).toBe(1);
    expect(MANIFEST).toEqual({});
  });

  test("dispatch: a boundary is recognized only on its declared tag", () => {
    const table = el(`<table grid></table>`);
    expect(boundaryOf(table)).toEqual({ name: "grid", plugin: "grid", opaque: true, on: "table", installed: false });
    expect(closedBoundary(table)).toBe(true);
    expect(boundaryOf(el(`<div grid></div>`))).toBe(null);
    expect(closedBoundary(el(`<div grid></div>`))).toBe(false);
    expect(boundaryOf(el(`<table></table>`))).toBe(null);
  });

  test("dispatch: the engine's own boundaries keep their handlers", () => {
    declareFacts({ name: "thief", boundaries: { items: { opaque: true }, scope: { opaque: true }, each: { opaque: true }, detail: { opaque: true }, item: { opaque: true }, sap: { opaque: true } } });
    for (const own of ["items", "scope", "each", "detail", "item", "sap"]) {
      expect(boundaryOf(el(`<ul ${own}="x"></ul>`))).toBe(null);
      expect(boundaryOf(el(`<table grid ${own}="x"></table>`))).toBe(null);
    }
    const root = mount(`<main sap><ul panel items="rows"><li item><span bind="a">read</span></li></ul></main>`);
    expect(Sap._registry.get(root)._state.rows[0].a).toBe("read");
  });

  test("dispatch: an opaque boundary stays closed, any other opens when its plugin installs", () => {
    const table = el(`<table grid></table>`);
    const panel = el(`<div panel></div>`);
    expect(closedBoundary(panel)).toBe(true);
    install("panel");
    install("grid");
    expect(boundaryOf(panel).installed).toBe(true);
    expect(closedBoundary(panel)).toBe(false);
    expect(closedBoundary(table)).toBe(true);
  });

  test("dispatch: insideClosedBoundary names the enclosing closed owner, never the element itself", () => {
    const outer = el(`<div panel><table grid><tbody><tr><td><b>x</b></td></tr></tbody></table><i>y</i></div>`);
    const table = outer.querySelector("table");
    expect(insideClosedBoundary(outer.querySelector("b"))).toBe(table);
    expect(insideClosedBoundary(table)).toBe(outer);
    expect(insideClosedBoundary(outer)).toBe(null);
    install("panel");
    expect(insideClosedBoundary(table)).toBe(null);
    expect(insideClosedBoundary(outer.querySelector("i"))).toBe(null);
    expect(insideClosedBoundary(outer.querySelector("b"))).toBe(table);
  });

  test("dispatch: walkVisible visits a boundary and none of its descendants", () => {
    const tree = el(`<section><p><b></b></p><table grid><tbody><tr><td></td></tr></tbody></table><i></i></section>`);
    const seen = [];
    walkVisible(tree, (node) => seen.push(node.localName));
    expect(seen).toEqual(["section", "p", "b", "table", "i"]);
    const alone = [];
    walkVisible(tree.querySelector("table"), (node) => alone.push(node.localName));
    expect(alone).toEqual(["table"]);
  });
});

describe("mount: a declared boundary whose plugin is not installed", () => {
  test("mount: the saved table keeps its HTML byte for byte, with no error, warning or write", async () => {
    document.body.innerHTML = SHEET;
    const saved = document.querySelector("table").outerHTML;
    const root = mount(SHEET);
    const table = root.querySelector("table");
    const status = Sap.status().apps[0];
    expect(table.outerHTML).toBe(saved);
    expect(status.ok).toBe(true);
    expect(Sap.report().errors).toEqual([]);
    expect(Sap.report().warnings).toEqual([]);
    expect(status.mountWrites).toBe(0);
    expect(entered).toEqual([]);
    const state = Sap._registry.get(root)._state;
    expect(Object.keys(state.sheets[0])).toEqual(["name"]);
    expect("y" in state).toBe(false);

    root.setAttribute("n", "3");
    await tick();
    expect(root.querySelector("#out").textContent).toBe("6");
    expect(table.outerHTML).toBe(saved);
    Sap.refresh();
    expect(table.outerHTML).toBe(saved);
    expect(Sap.report().errors).toEqual([]);
  });

  test("mount: a grid attribute on a div is ordinary markup", () => {
    const root = mount(`<main sap><div grid><b text="1 + 1">saved</b></div></main>`);
    expect(root.querySelector("b").textContent).toBe("2");
    mount(`<main sap><div grid><p>{{literal}}</p></div></main>`);
    expect(Sap.report().errors.map((e) => e.code)).toEqual(["E02"]);
  });

  test("dispatch: an installed opaque boundary calls its handler once a pass and the engine reads nothing inside", async () => {
    install("grid");
    const root = mount(SHEET);
    const table = root.querySelector("table");
    const saved = table.outerHTML;
    expect(entered).toEqual([table]);
    root.setAttribute("n", "5");
    await tick();
    expect(entered).toEqual([table, table]);
    expect(root.querySelector("#out").textContent).toBe("10");
    expect(table.outerHTML).toBe(saved);
    expect(Object.keys(Sap._registry.get(root)._state.sheets[0])).toEqual(["name"]);
  });

  test("dispatch: a boundary that is not opaque is entered once its plugin installs", () => {
    const page = `<main sap><div panel><b text="1 + 1">saved</b></div></main>`;
    let root = mount(page);
    expect(root.querySelector("b").textContent).toBe("saved");
    expect(entered).toEqual([]);
    install("panel");
    root = mount(page);
    expect(entered).toContain(root.querySelector("[panel]"));
    expect(root.querySelector("b").textContent).toBe("2");
  });
});

describe("lint and the accessor walk stay out", () => {
  test("lint: moustaches inside a closed boundary do not halt the app", () => {
    const root = mount(`<main sap><table grid><tbody><tr><td>{{literal}}</td><td><b>{{ nested }}</b></td></tr></tbody></table><output text="1 + 1">2</output></main>`);
    expect(Sap.report().errors).toEqual([]);
    expect(Sap._registry.get(root).halted).toBeFalsy();
    expect(root.hasAttribute("sap-error")).toBe(false);
  });

  test("lint: moustaches outside the boundary, and inside an installed open one, still halt", () => {
    mount(`<main sap><table grid><tbody><tr><td>fine</td></tr></tbody></table><p>{{ x }}</p></main>`);
    expect(Sap.report().errors.map((e) => e.code)).toEqual(["E02"]);
    mount(`<main sap><div panel><p>{{ x }}</p></div></main>`);
    expect(Sap.report().errors).toEqual([]);
    install("panel");
    mount(`<main sap><div panel><p>{{ x }}</p></div></main>`);
    expect(Sap.report().errors.map((e) => e.code)).toEqual(["E02"]);
  });

  test("lint: the boundary element itself is still checked, and nothing inside it is", () => {
    mount(`<main sap><table grid x-text="foo"><tbody><tr><td>fine</td></tr></tbody></table></main>`);
    expect(Sap.report().errors.map((e) => e.code)).toEqual(["E01"]);
    mount(`<main sap><table grid><tbody><tr><td x-text="foo" state="a a"><input type="file" bind="f"></td></tr></tbody></table></main>`);
    expect(Sap.report().errors).toEqual([]);
    expect(Sap.report().warnings).toEqual([]);
  });

  test("lint: a declared boundary name is never reported as a mistyped directive", () => {
    declareFacts({ name: "freezer", boundaries: { freezer: { opaque: true } } });
    mount(`<main sap><div freezer>kept</div><div freezes>typo</div></main>`);
    expect(Sap.report().warnings.map((w) => [w.code, w.attr])).toEqual([["W03", "freezes"]]);
  });

  test("scope: the accessor finds no bind and no list inside the boundary", () => {
    const root = mount(`<main sap><section items="sheets"><article item data-id="s1"><h2 bind="name">Budget</h2>
      <table grid><tbody items="inner"><tr item><td bind="x">kept</td></tr></tbody></table></article></section></main>`);
    const sheet = Sap(root.querySelector("article"));
    expect(sheet.name).toBe("Budget");
    expect(sheet.x).toBeUndefined();
    expect(sheet.inner).toBeUndefined();
    expect(Sap(root.querySelector("table")).$el).toBe(root.querySelector("article"));
  });
});

describe("cache, mutation, debug and discovery stay out", () => {
  test("mutation: adding a row inside the table is one change", async () => {
    const root = mount(SHEET);
    const tbody = root.querySelector("tbody");
    const row = el(`<table><tbody><tr><td><b>1</b></td><td>2</td></tr></tbody></table>`).querySelector("tr");
    expect(await bridged(() => tbody.appendChild(row))).toEqual([row]);
  });

  test("mutation: adding a wrapper around a grid lists the wrapper and the grid, and visits no cell", async () => {
    const root = mount(SHEET);
    const wrapper = el(`<div><p><b id="fresh" text="state.n + 1"></b></p><table grid>${CELLS}</table></div>`);
    let targets;
    const reads = await cellReads(async () => {
      targets = await bridged(() => root.appendChild(wrapper));
    });
    expect(targets.map((t) => t.localName)).toEqual(["div", "p", "b", "table"]);
    expect(reads).toBe(0);
    expect(root.querySelector("#fresh").textContent).toBe("3");
  });

  test("mutation: removing a row still names its former parent, and a cell edit still reaches the app", async () => {
    install("grid");
    const root = mount(SHEET);
    const tbody = root.querySelector("tbody");
    const table = root.querySelector("table");
    expect(await bridged(() => tbody.firstElementChild.lastElementChild.setAttribute("f", "=A1"))).toEqual([tbody.firstElementChild.lastElementChild]);
    expect(entered).toEqual([table, table]);
    expect(await bridged(() => tbody.firstElementChild.remove())).toEqual([tbody]);
    expect(entered).toEqual([table, table, table]);
  });

  test("cache: a row added inside the boundary is not walked, and sibling records still invalidate", async () => {
    const root = mount(`<main sap>
      <ul items="notes"><li item data-id="a"><span bind="t">one</span></li></ul>
      <table grid><tbody></tbody></table>
      <output id="first" text="state.notes[0].t">one</output>
    </main>`);
    const row = el(`<table><tbody><tr><td bind="q">1</td><td text="1 + 1">2</td></tr></tbody></table>`).querySelector("tr");
    const reads = await cellReads(async () => {
      root.querySelector("tbody").appendChild(row);
      await tick();
    });
    expect(reads).toBe(0);
    expect(row.outerHTML).toBe(`<tr><td bind="q">1</td><td text="1 + 1">2</td></tr>`);

    root.querySelector("span").textContent = "two";
    root.querySelector("ul").setAttribute("data-touch", "1");
    await tick();
    expect(root.querySelector("#first").textContent).toBe("two");
    root.querySelector("#first").setAttribute("text", "state.notes[0].t + '!'");
    await tick();
    expect(root.querySelector("#first").textContent).toBe("two!");
  });

  test("debug: the green line counts stop at the boundary and are unchanged outside it", () => {
    const outside = `<button trigger-add="notes">add</button><ul items="notes"><li item template><span bind="t"></span></li><li item data-id="a" set:n="1"><span bind="t">one</span></li><li item data-id="b"><span bind="t">two</span></li></ul>`;
    const inside = `<table grid><tbody items="fake"><tr item><td set:n="2" trigger-remove>x</td></tr><tr item><td>y</td></tr></tbody></table>`;
    const plain = mount(`<main sap state="n:num" n="0">${outside}</main>`);
    const expected = {
      actions: [...plain.querySelectorAll("*")].filter((node) => [...node.attributes].some((a) => /^(set:|trigger-)/.test(a.name))).length,
      lists: plain.querySelectorAll("[items]").length,
      rows: plain.querySelectorAll("[item]:not([template])").length,
    };
    expect(expected).toEqual({ actions: 2, lists: 1, rows: 2 });
    const before = Sap.status().apps[0];
    expect({ actions: before.actions, lists: before.lists, rows: before.rows }).toEqual(expected);
    const line = Sap.greenLine(Sap._registry.get(plain));

    const withGrid = mount(`<main sap state="n:num" n="0">${outside}${inside}</main>`);
    const after = Sap.status().apps[0];
    expect({ actions: after.actions, lists: after.lists, rows: after.rows }).toEqual(expected);
    expect(Sap.greenLine(Sap._registry.get(withGrid)).replace(/[\d.]+ms$/, "")).toBe(line.replace(/[\d.]+ms$/, ""));
  });

  test("debug: an app root that is itself an item is not counted among its own rows", () => {
    const root = mount(`<ul items="cards"><li sap item data-id="card"><ul items="notes"><li item data-id="a"><b bind="t">one</b></li><li item data-id="b"><b bind="t">two</b></li></ul></li></ul>`);
    expect(root.localName).toBe("li");
    const view = Sap.status().apps[0];
    expect(view.ok).toBe(true);
    expect({ lists: view.lists, rows: view.rows }).toEqual({ lists: 1, rows: root.querySelectorAll("[item]:not([template])").length });
    expect(Sap.greenLine(Sap._registry.get(root))).toContain(" · lists 1 · rows 2 · ");
  });

  test("debug: without a boundary the counts are what the whole-root selectors gave", () => {
    const root = mount(`<ul sap items="lists" trigger-add="lists" state="n:num" n="0">
      <li item template><b bind="t"></b></li>
      <li item data-id="a" set:n="1" move:up><b bind="t">one</b><ol items="steps"><li item data-id="s"><i bind="s">x</i></li></ol></li>
      <li item data-id="b"><b bind="t">two</b><div sap-ignore><p item trigger-remove>ignored</p></div></li>
    </ul>`);
    const all = [root, ...root.querySelectorAll("*")];
    const expected = {
      actions: all.filter((node) => [...node.attributes].some((a) => /^(set:|move:|sort:|trigger-add$|trigger-remove$|trigger-reset$)/.test(a.name))).length,
      lists: (root.hasAttribute("items") ? 1 : 0) + root.querySelectorAll("[items]").length,
      rows: root.querySelectorAll("[item]:not([template])").length,
    };
    expect(expected).toEqual({ actions: 3, lists: 2, rows: 4 });
    const view = Sap.status().apps[0];
    expect({ actions: view.actions, lists: view.lists, rows: view.rows }).toEqual(expected);
  });

  test("discovery: a [sap] root inside the table is not mounted", () => {
    document.body.innerHTML = `<main sap id="outer"><table grid><tbody><tr><td><div sap id="inner"><b text="1 + 1">saved</b></div></td></tr></tbody></table></main><aside sap id="beside"><b text="1 + 1">saved</b></aside>`;
    Sap._reset();
    Sap.mount();
    expect([...Sap._registry.keys()].map((root) => root.id)).toEqual(["outer", "beside"]);
    expect(document.querySelector("#inner b").textContent).toBe("saved");
    expect(document.querySelector("#beside b").textContent).toBe("2");
  });

  test("textarea: a persisted textarea inside the table is not rehydrated", () => {
    const root = mount(`<main sap><textarea id="out" data-value="restored">stale</textarea>
      <table grid><tbody><tr><td><textarea id="in" data-value="restored">stale</textarea></td></tr></tbody></table></main>`);
    expect(root.querySelector("#out").value).toBe("restored");
    expect(root.querySelector("#out").hasAttribute("data-value")).toBe(false);
    expect(root.querySelector("#in").outerHTML).toBe(`<textarea id="in" data-value="restored">stale</textarea>`);
  });
});
