// The plugin host, part by part: what Sap.use checks and installs, how a plugin is found
// and loaded, what a failed load leaves behind, the list every engine on a page shares,
// and Sap.flush. Every test starts its own engine, so no plugin outlives its test.

import { watchCells } from "./helpers/cell-reads.js";
import { detailFeature } from "../src/features/detail.js";
import { calcFeature } from "../src/features/calc.js";
import { eachFeature } from "../src/features/each.js";
import { effectFeature } from "../src/features/effect.js";
import { validationFeature } from "../src/features/validation.js";
import { projectionFeature } from "../src/features/projection.js";

const tick = async (n = 8) => { for (let i = 0; i < n; i++) await Promise.resolve(); };
// Mounting leaves change records the browser has not delivered yet; wait them out.
const settled = async () => { await tick(); await new Promise((resolve) => setTimeout(resolve, 0)); await tick(); };

// The engines of earlier tests still watch the document and clear the plan of every
// element a test adds. One more pass builds the plans again, so the passes a test
// measures start from cached plans, as on a page with one engine.
const warm = async (root) => { await settled(); root.setAttribute("warm", ""); await tick(); };

let Sap = null;

// A fresh engine. `script` is the address the engine's own script tag would have, and
// `manifest` stands in for the facts of the plugins a release ships.
function boot({ script, delays = false, manifest } = {}) {
  if (script) Object.defineProperty(document, "currentScript", { configurable: true, value: { src: script } });
  try {
    jest.isolateModules(() => {
      if (manifest) jest.doMock("../src/plugin-manifest.js", () => ({ MANIFEST: manifest, PLUGIN_API: 1 }));
      Sap = require("../src/sap.js").default;
    });
  } finally {
    delete document.currentScript;
    jest.dontMock("../src/plugin-manifest.js");
  }
  if (!delays) Sap.plugins.retryDelays.length = 0;
  return Sap;
}

function mount(html) {
  document.body.innerHTML = html;
  Sap._reset();
  const roots = [...document.querySelectorAll("[sap]")];
  for (const root of roots) Sap.mount(root);
  return roots[0];
}

const errors = () => Sap.report().errors.map((e) => [e.code, e.slug, e.el, e.problem]);
const scripts = () => [...document.head.querySelectorAll("script")];

afterEach(() => {
  jest.useRealTimers();
  if (Sap) Sap.unmount();
  Sap = null;
  delete window.sapPlugins;
  delete window.Sap;
  document.body.innerHTML = "";
  for (const s of scripts()) s.remove();
});

describe("Sap.use", () => {
  test("install: returns the plugin's api, sets it up once, and lists it", () => {
    boot();
    let setups = 0;
    const one = { hello: () => "hi" };
    const def = { name: "one", version: "2.0.0", api: 1, setup: () => (setups++, { api: { one } }) };
    expect(Sap.plugins.has("one")).toBe(false);
    expect(Sap.plugins.api).toBe(1);
    expect(Sap.use(def)).toEqual({ one });
    expect(Sap.use(def)).toEqual({ one });
    expect(Sap.use({ ...def })).toEqual({ one });
    expect(setups).toBe(1);
    expect(Sap.one).toBe(one);
    expect(Sap.plugins.has("one")).toBe(true);
    expect(Sap.use({ name: "bare", api: 1 })).toBe(null);
    expect(Sap.plugins.status()).toEqual({ installed: ["one", "bare"], loading: [], failed: [] });
    expect(window.sapPlugins).toHaveLength(2);
    expect(window.sapPlugins[0]).toBe(def);
  });

  test("refuse: another contract number, or no name, with both numbers in the message", () => {
    boot();
    const setup = jest.fn(() => ({}));
    expect(() => Sap.use({ name: "old", api: 2, setup })).toThrow('Sap.use: plugin "old" needs a name and plugin API 1; it gives API 2');
    expect(() => Sap.use({ name: "none", setup })).toThrow(/plugin API 1; it gives API undefined/);
    expect(() => Sap.use({ api: 1, setup })).toThrow(/needs a name/);
    expect(setup).not.toHaveBeenCalled();
    expect(window.sapPlugins).toEqual([]);
    expect(Sap.plugins.status().installed).toEqual([]);
  });

  test("refuse: an api member the Sap object already has, and then nothing is installed", () => {
    boot();
    const hooks = [];
    const mountBefore = Sap.mount;
    expect(() => Sap.use({ name: "grabby", api: 1, helpers: ["grab"], setup: () => ({ helpers: { grab: () => 1 }, api: { fine: 1, mount: 2 }, begin() { hooks.push("begin"); } }) }))
      .toThrow('Sap.use: plugin "grabby" cannot add Sap.mount: the name is taken');
    expect(Sap.plugins.has("grabby")).toBe(false);
    expect(Sap.mount).toBe(mountBefore);
    expect(Sap.fine).toBeUndefined();
    mount(`<main sap><output text="1 + 1">2</output></main>`);
    expect(hooks).toEqual([]);
    for (const name of ["use", "plugins", "flush"]) {
      expect(() => Sap.use({ name: "takes-" + name, api: 1, setup: () => ({ api: { [name]: 1 } }) })).toThrow(/the name is taken/);
    }
  });

  test.each([
    ["helper", { helpers: ["twice"] }, {}],
    ["boundary", { boundaries: { panel: {} } }, { boundaries: {} }],
    ["directive", { directives: { "fill:": { key: "fills" } } }, { directives: { fill: () => 1 } }],
  ])("refuse: a %s the definition declares and setup does not supply", (what, facts, made) => {
    boot();
    expect(() => Sap.use({ name: "short", api: 1, ...facts, setup: () => ({ ...made, api: { short: 1 } }) })).toThrow(/plugin "short" cannot add "(twice|panel|fill:)" to (helpers|boundaries|directives)/);
    expect(Sap.plugins.has("short")).toBe(false);
    expect(Sap.short).toBeUndefined();
  });

  test("refuse: a helper name that is frozen, taken by another plugin, or not a plain name", () => {
    boot();
    const helper = (helperName, name) => ({ name, api: 1, helpers: [helperName], setup: () => ({ helpers: { [helperName]: () => 1 } }) });
    Sap.use(helper("twice", "has-twice"));
    for (const name of ["state", "fmt", "sum", "days", "twice", "a-b", "1st", "x y", "a(b"]) {
      expect(() => Sap.use(helper(name, "wants " + name))).toThrow(/the name is taken or not valid/);
    }
    Sap.use(helper("ok_1", "has-ok"));
    expect(Sap.plugins.status().installed).toEqual(["has-twice", "has-ok"]);
  });

  test("refuse: a boundary or directive name another plugin declared, or the engine's own", () => {
    boot();
    Sap.plugins.declare({ name: "first", boundaries: { panel: {} }, directives: { "fill:": { key: "fills" } } });
    const made = { boundaries: { panel() {}, each() {}, "fill:"() {} }, directives: { "fill:": () => 1, panel: () => 1 } };
    expect(() => Sap.use({ name: "b", api: 1, boundaries: { panel: {} }, setup: () => made })).toThrow(/cannot add "panel" to boundaries/);
    expect(() => Sap.use({ name: "c", api: 1, directives: { "fill:": { key: "x" } }, setup: () => made })).toThrow(/cannot add "fill:" to directives/);
    expect(() => Sap.use({ name: "d", api: 1, directives: { panel: { key: "x" } }, setup: () => made })).toThrow(/cannot add "panel" to directives/);
    expect(() => Sap.use({ name: "e", api: 1, boundaries: { "fill:": {} }, setup: () => made })).toThrow(/cannot add "fill:" to boundaries/);
    expect(() => Sap.use({ name: "f", api: 1, boundaries: { each: {} }, setup: () => made })).toThrow(/cannot add "each" to boundaries/);
    expect(Sap.plugins.status().installed).toEqual([]);
    Sap.plugins.declare({ name: "late", boundaries: { panel: {} }, directives: { "fill:": { key: "x" } } });
    expect(Sap.use({ name: "first", api: 1, boundaries: { panel: {} }, directives: { "fill:": { key: "fills" } }, setup: () => made })).toBe(null);
    expect(Sap.plugins.status().installed).toEqual(["first"]);
  });

  test("refuse: a helper named with a reserved word or after a global, and every other expression still works", () => {
    boot();
    const helper = (helperName) => ({ name: "has-" + helperName, api: 1, helpers: [helperName], setup: () => ({ helpers: { [helperName]: () => 1 } }) });
    window.pageFn = () => 1;
    try {
      for (const name of ["default", "class", "new", "yield", "let"]) {
        expect(() => Sap.use(helper(name))).toThrow(`Sap.use: plugin "has-${name}" cannot add "${name}" to helpers: the name is taken or not valid`);
      }
      for (const name of ["eval", "Number", "Math", "parseInt", "pageFn"]) {
        expect(() => Sap.use(helper(name))).toThrow(`Sap.use: plugin "has-${name}" cannot add "${name}": window.${name} exists; rename the helper`);
      }
    } finally {
      delete window.pageFn;
    }
    expect(Sap.plugins.status()).toEqual({ installed: [], loading: [], failed: [] });
    expect(window.sapPlugins).toEqual([]);
    const root = mount(`<main sap state="n:num" n="2"><b text="state.n + 1">saved</b><i text="Number('4') + Math.max(1, state.n)">saved</i></main>`);
    expect(root.querySelector("b").textContent).toBe("3");
    expect(root.querySelector("i").textContent).toBe("6");
    expect(Sap.report().errors).toEqual([]);
    expect(Sap.use(helper("pageFn"))).toBe(null);
    expect(Sap.plugins.has("has-pageFn")).toBe(true);
  });

  test("refuse: a helper name the page defines is refused by naming the page's global, and an element id is not one", () => {
    boot();
    const grid = () => ({ name: "grid", api: 1, helpers: ["cell", "range"], setup: () => ({ helpers: { cell: () => 1, range: () => [] } }) });
    window.range = function range() {};
    try {
      expect(() => Sap.use(grid())).toThrow(new Error(`Sap.use: plugin "grid" cannot add "range": window.range exists; rename the helper`));
    } finally {
      delete window.range;
    }
    expect(Sap.plugins.status()).toEqual({ installed: [], loading: [], failed: [] });
    expect(window.sapPlugins).toEqual([]);
    expect(() => Sap.use({ ...grid(), setup: () => ({ helpers: { cell: () => 1 } }) })).toThrow(`cannot add "range" to helpers: the name is taken or not valid, or setup does not supply it`);
    document.body.innerHTML = `<input type="range" id="range">`;
    expect(window.range).toBe(document.getElementById("range"));
    expect(Sap.use(grid())).toBe(null);
    expect(Sap.plugins.has("grid")).toBe(true);
  });

  test("refuse: a refused definition keeps no attribute and no helper name", () => {
    boot();
    const made = { boundaries: { panel() {} }, directives: { "pin:": () => ({}) }, helpers: { panelSize: () => 1 } };
    const facts = { boundaries: { panel: { opaque: true } }, directives: { "pin:": { key: "pins" } }, helpers: ["panelSize"] };
    expect(() => Sap.use({ name: "rejected", api: 1, ...facts, setup: () => ({ ...made, api: { mount() {} } }) })).toThrow(/cannot add Sap.mount/);
    expect(window.sapPlugins).toEqual([]);
    expect(Sap.plugins.status()).toEqual({ installed: [], loading: [], failed: [] });
    const root = mount(`<main sap><div panel><b text="1 + 1">saved</b></div><i text="2 + 2">saved</i><u text="panelSize()">saved</u></main>`);
    expect(root.querySelector("b").textContent).toBe("2");
    expect(root.querySelector("i").textContent).toBe("4");
    expect(Sap.plugins.status().loading).toEqual([]);
    expect(Sap.use({ name: "second", api: 1, ...facts, setup: () => made })).toBe(null);
    expect(Sap.plugins.has("second")).toBe(true);
  });

  test("refuse: facts declared before the definition stay, and the definition adds nothing to them", () => {
    boot();
    Sap.plugins.loader = () => new Promise(() => {});
    Sap.plugins.declare({ name: "half", boundaries: { kept: { opaque: true } }, helpers: ["keptHelper"] });
    expect(() => Sap.use({
      name: "half",
      api: 1,
      boundaries: { kept: { opaque: true }, extra: { opaque: true } },
      helpers: ["keptHelper", "extraHelper"],
      setup() { throw new Error("half broke"); },
    })).toThrow("half broke");
    const root = mount(`<main sap><div kept><b text="1 + 1">saved</b></div><div extra><i text="1 + 1">saved</i></div></main>
      <main sap><u text="1 + 1">saved</u><s text="typeof extraHelper(1)">saved</s></main>
      <main sap><em text="1 + 1">saved</em><q text="keptHelper(1)">saved</q></main>`);
    expect(root.querySelector("b").textContent).toBe("saved");
    expect(root.querySelector("i").textContent).toBe("2");
    expect(document.querySelector("u").textContent).toBe("2");
    expect(document.querySelector("em").textContent).toBe("saved");
    expect(Sap.plugins.status()).toEqual({ installed: [], loading: ["half"], failed: [] });
  });

  test("refuse: a refused definition is not in the shared list, unless a script put it there", () => {
    boot();
    const mine = { name: "mine", api: 1, boundaries: { mine: {} }, setup() { throw new Error("mine broke"); } };
    expect(() => Sap.use(mine)).toThrow("mine broke");
    expect(window.sapPlugins).toEqual([]);
    const theirs = { name: "theirs", api: 1, boundaries: { theirs: {} }, setup() { throw new Error("theirs broke"); } };
    window.sapPlugins.push(theirs);
    expect(() => Sap.use(theirs)).toThrow("theirs broke");
    expect(window.sapPlugins).toEqual([theirs]);
    const root = mount(`<main sap><div mine><b text="1 + 1">saved</b></div><div theirs><i text="2 + 2">saved</i></div></main>`);
    expect(root.querySelector("b").textContent).toBe("2");
    expect(root.querySelector("i").textContent).toBe("4");
  });

  test("held: a definition that waits for a plugin it requires is declared at once, and stays declared when it is refused later", async () => {
    boot();
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});
    const page = `<main sap><div nest><b text="1 + 1">saved</b></div><i text="2 + 2">saved</i></main>`;
    const child = { name: "child", api: 1, requires: ["parent"], boundaries: { nest: { opaque: true } }, setup() { throw new Error("child broke"); } };
    expect(Sap.use(child)).toBe(null);
    expect(Sap.use(child)).toBe(null);
    expect(window.sapPlugins).toEqual([child]);
    expect(mount(page).querySelector("b").textContent).toBe("saved");
    Sap.use({ name: "parent", api: 1 });
    expect(logged.mock.calls.map((c) => c[0].message)).toEqual(["child broke"]);
    expect(window.sapPlugins.map((d) => d.name)).toEqual(["child", "parent"]);
    const root = mount(page);
    await settled();
    expect(root.querySelector("b").textContent).toBe("saved");
    expect(root.querySelector("i").textContent).toBe("4");
    expect(Sap.plugins.status()).toEqual({ installed: ["parent"], loading: [], failed: ["child"] });
    expect(errors()).toEqual([["E52", "plugin-not-loaded", "main[sap] > div", 'the "child" plugin did not load: no address for plugin "child": call Sap.use(definition)']]);
  });

  test("recover: the same definition, refused once, installs when it is given again", () => {
    boot();
    let broken = true;
    const def = { name: "again", api: 1, boundaries: { again: { opaque: true } }, setup() { if (broken) throw new Error("not yet"); return { boundaries: { again(pass, el) { el.textContent = "drawn"; } } }; } };
    expect(() => Sap.use(def)).toThrow("not yet");
    broken = false;
    expect(Sap.use(def)).toBe(null);
    expect(window.sapPlugins).toEqual([def]);
    expect(mount(`<main sap><div again>saved</div></main>`).querySelector("div").textContent).toBe("drawn");
  });

  test("own: a directive named after one of the engine's own attributes is refused, and a declaration of one claims nothing", () => {
    boot();
    for (const own of ["sap", "item", "scope", "items", "detail", "each"]) {
      expect(() => Sap.use({ name: "takes-" + own, api: 1, directives: { [own]: { key: "x" } }, setup: () => ({ directives: { [own]: () => ({}) } }) }))
        .toThrow(`cannot add "${own}" to directives`);
    }
    Sap.plugins.loader = () => { throw new Error("nothing should load"); };
    Sap.plugins.declare({ name: "roots", directives: { sap: { key: "roots" }, "sap:": { key: "roots" } } });
    const root = mount(`<main sap><b text="1 + 1">saved</b></main>`);
    expect(root.querySelector("b").textContent).toBe("2");
    expect(Sap.plugins.status()).toEqual({ installed: [], loading: [], failed: [] });
    expect(Sap.use({ name: "roots", api: 1, directives: { "sap:": { key: "roots" } }, setup: () => ({ directives: { "sap:": () => ({}) } }) })).toBe(null);
  });

  test("undeclared: a handler for an attribute the plugin did not declare is never installed", () => {
    boot();
    let hits = 0;
    Sap.use({ name: "sneaky", api: 1, boundaries: { own: {} }, setup: () => ({ boundaries: { own() {}, each() { hits++; }, items() { hits++; } } }) });
    const root = mount(`<main sap><ul each="['a', 'b']" key="item"><template><li text="item"></li></template></ul></main>`);
    expect([...root.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["a", "b"]);
    expect(hits).toBe(0);
  });

  test("recover: a setup that throws installs nothing, and a working definition then installs", () => {
    boot();
    expect(() => Sap.use({ name: "fragile", api: 1, helpers: ["frag"], setup() { throw new Error("setup broke"); } })).toThrow("setup broke");
    expect(Sap.plugins.has("fragile")).toBe(false);
    expect(Sap.use({ name: "fragile", api: 1, helpers: ["frag"], setup: () => ({ helpers: { frag: () => 7 }, api: { fragile: true } }) })).toEqual({ fragile: true });
    const root = mount(`<main sap><output text="frag() + 1">saved</output></main>`);
    expect(root.querySelector("output").textContent).toBe("8");
    expect(Sap.report().errors).toEqual([]);
  });

  test("declare: a definition adds what an earlier declaration left out, and a second declaration adds nothing", () => {
    boot();
    Sap.plugins.declare({ name: "grow" });
    Sap.plugins.declare({ name: "grow", boundaries: { ignored: {} } });
    Sap.use({
      name: "grow",
      api: 1,
      boundaries: { grow: { opaque: true } },
      helpers: ["grown"],
      setup: () => ({ boundaries: { grow(pass, el) { el.textContent = "drawn"; } }, helpers: { grown: () => 3 } }),
    });
    const root = mount(`<main sap><div grow>saved</div><div ignored><b text="1 + 1">saved</b></div><output text="grown()">saved</output></main>`);
    expect(root.querySelector("[grow]").textContent).toBe("drawn");
    expect(root.querySelector("b").textContent).toBe("2");
    expect(root.querySelector("output").textContent).toBe("3");
    expect(Sap.report().errors).toEqual([]);
  });

  test("open: a boundary that is not opaque is closed until its plugin installs, and then the engine's checks reach inside", () => {
    boot();
    const facts = { name: "panel", boundaries: { panel: {} } };
    const page = `<main sap><div panel><b tex:x="1"></b></div></main>`;
    Sap.plugins.declare(facts);
    Sap.plugins.loader = () => new Promise(() => {});
    mount(page);
    expect(Sap.report().warnings).toEqual([]);
    Sap.use({ ...facts, api: 1, setup: () => ({ boundaries: { panel() {} } }) });
    mount(page);
    expect(Sap.report().warnings.map((w) => [w.code, w.attr])).toEqual([["W03", "tex:x"]]);
  });

  test("late: a plugin that installs after mount finds its directives in rows the engine has already read", async () => {
    boot();
    const root = mount(`<main sap><ul items="rows"><li item data-id="a"><b mark></b><span bind="t">one</span></li></ul></main>`);
    await warm(root);
    const hits = [];
    Sap.use({
      name: "marks",
      api: 1,
      directives: { mark: { key: "marks" } },
      setup: () => ({ directives: { mark: () => ({}) }, collect(pass, el, plan) { if (plan.marks) hits.push(pass.trigger); return false; } }),
    });
    await tick();
    expect(hits).toEqual(["plugin:marks"]);
  });

  test("requires: a definition waits for what it requires, and one that throws does not hold up the rest", () => {
    boot();
    const order = [];
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(Sap.use({ name: "bad-child", api: 1, requires: ["parent"], setup() { throw new Error("child broke"); } })).toBe(null);
    expect(Sap.use({ name: "child", api: 1, requires: ["parent", "uncle"], setup: () => (order.push("child"), { api: { child: 1 } }) })).toBe(null);
    expect(Sap.use({ name: "sibling", api: 1, requires: ["parent"], setup: () => (order.push("sibling"), {}) })).toBe(null);
    expect(order).toEqual([]);
    Sap.use({ name: "parent", api: 1, setup: () => (order.push("parent"), {}) });
    expect(order).toEqual(["parent", "sibling"]);
    expect(logged.mock.calls.map((c) => c[0].message)).toEqual(["child broke"]);
    Sap.use({ name: "uncle", api: 1 });
    expect(order).toEqual(["parent", "sibling", "child"]);
    expect(Sap.child).toBe(1);
  });

  test("order: hooks run in ascending order, then as registered, among the engine's own features", () => {
    boot();
    const log = [];
    Sap.use({ name: "late", api: 1, setup: () => ({ begin() { log.push("late"); } }) });
    Sap.use({ name: "later", api: 1, setup: () => ({ begin() { log.push("later"); } }) });
    Sap.use({ name: "early", api: 1, order: 5, setup: () => ({ begin() { log.push("early"); } }) });
    Sap.use({ name: "after-calc", api: 1, order: 25, setup: () => ({ compute(pass) { log.push("25 total " + pass.rootObj.total); } }) });
    Sap.use({ name: "before-calc", api: 1, order: 15, setup: () => ({ compute(pass) { log.push("15 total " + pass.rootObj.total); } }) });
    mount(`<main sap state="n:num" n="2" calc:total="state.n * 2"><output text="state.total">4</output></main>`);
    expect(log).toEqual(["early", "late", "later", "15 total undefined", "25 total 4"]);
  });

  test("order: the engine's own features keep the numbers a plugin orders itself against", () => {
    const own = [detailFeature, calcFeature, eachFeature, effectFeature, validationFeature, projectionFeature];
    expect(own.map((f) => [f.name, f.order])).toEqual([["detail", 10], ["calc", 20], ["each", 30], ["effect", 40], ["validation", 50], ["projection", 60]]);
  });

  test("formats: a plugin's format is added, and a name that exists is kept", () => {
    boot();
    const usd = Sap.formats.usd;
    Sap.use({ name: "fmts", api: 1, setup: () => ({ formats: { shout: (v) => String(v).toUpperCase() + "!", usd: () => "never" } }) });
    const root = mount(`<main sap state="w" w="hi"><b text:shout="state.w">HI!</b><i text:usd="5">$5</i></main>`);
    expect(Sap.formats.usd).toBe(usd);
    expect(root.querySelector("b").textContent).toBe("HI!");
    expect(Sap.report().errors).toEqual([]);
    expect(Sap.status().apps[0].mountWrites).toBe(0);
  });

  test("lint: a plugin's lint check runs for every element at mount, may claim a name and may halt", () => {
    boot();
    const seen = [];
    Sap.use({
      name: "strict",
      api: 1,
      setup: () => ({
        lint(el, halt, claimed) {
          seen.push(el.localName);
          if (el.hasAttribute("bnd")) claimed("bnd");
          if (el.hasAttribute("forbidden")) halt("E18", el, { attr: "forbidden", problem: "strict says no" });
        },
      }),
    });
    mount(`<main sap><p bnd="x"></p><b text="1 + 1">2</b></main>`);
    expect(seen).toEqual(["main", "p", "b"]);
    expect(Sap.report()).toMatchObject({ errors: [], warnings: [] });
    const root = mount(`<main sap><p forbidden></p><b text="1 + 1">saved</b></main>`);
    expect(Sap._registry.get(root).halted).toBe(true);
    expect(errors()).toEqual([["E18", "paint-on-form-control", "main[sap] > p", "strict says no"]]);
    expect(root.querySelector("b").textContent).toBe("saved");
  });

  test("wake: a plugin that installs after mount runs one pass in every connected app, and not a full one", async () => {
    boot();
    mount(`<main sap id="a"></main><main sap id="b"></main><main sap id="gone"></main>`);
    await settled();
    document.getElementById("gone").remove();
    const seen = [];
    Sap.use({ name: "late", api: 1, setup: () => ({ begin(pass) { seen.push([pass.root.id, pass.trigger, pass.full, pass.changes]); } }) });
    expect(seen).toEqual([]);
    await tick();
    expect(seen).toEqual([["a", "plugin:late", false, []], ["b", "plugin:late", false, []]]);
  });
});

describe("an app whose root is not in the page", () => {
  test("wake: it gets no pass when a plugin installs", async () => {
    boot();
    mount(`<main sap id="a"></main>`);
    await settled();
    const loose = document.createElement("main");
    loose.id = "loose";
    loose.setAttribute("sap", "");
    Sap.mount(loose);
    expect(Sap.status().apps).toHaveLength(2);
    const seen = [];
    Sap.use({ name: "late", api: 1, setup: () => ({ begin(pass) { seen.push(pass.root.id); } }) });
    await tick();
    expect(seen).toEqual(["a"]);
  });
});

describe("directives and paint kinds", () => {
  const fill = (log) => ({
    name: "fill",
    api: 1,
    directives: { "fill:": { key: "fills" }, glow: { key: "glows" } },
    setup: (kit) => ({
      directives: {
        "fill:": (tail, value) => (log.push(["fill:", tail, value]), { prop: tail, entry: kit.compile(value) }),
        glow: (tail, value) => (log.push(["glow", tail, value]), value === "skip" ? undefined : { on: value }),
      },
      collect(pass, el, plan, ctx) {
        if (plan.glows) log.push(["glows", el.localName, plan.glows]);
        if (!plan.fills) return false;
        for (const def of plan.fills) pass.paints.push({ def: { kind: "fill", ...def }, el, ctx });
      },
      paintKinds: {
        fill(p) {
          const value = String(kit.runWith(p.def.entry, p.ctx.state, p.ctx.item, p.el, p.ctx.root));
          if (p.el.style.getPropertyValue(p.def.prop) === value) return 0;
          p.el.style.setProperty(p.def.prop, value);
          return 1;
        },
      },
    }),
  });

  test("parse: a prefix and an exact name are parsed once into plan[key], and a paint kind draws them", async () => {
    boot();
    const log = [];
    Sap.use(fill(log));
    const root = mount(`<main sap state="c" c="red"><p fill:color="state.c" glow="soft" style="color: red;">x</p><i glow="skip"></i></main>`);
    expect(log).toEqual([["fill:", "color", "state.c"], ["glow", "", "soft"], ["glows", "p", [{ on: "soft" }]], ["glow", "", "skip"]]);
    expect(Sap.report()).toMatchObject({ errors: [], warnings: [] });
    expect(Sap.status().apps[0].mountWrites).toBe(0);
    await warm(root);
    log.length = 0;
    root.setAttribute("c", "blue");
    await tick();
    expect(root.querySelector("p").style.color).toBe("blue");
    expect(log).toEqual([["glows", "p", [{ on: "soft" }]]]);
  });

  test("writes: what a plugin's paint kind returns is counted as a write", () => {
    boot();
    Sap.use(fill([]));
    mount(`<main sap state="c" c="red"><p fill:color="state.c">x</p></main>`);
    expect(Sap.status().apps[0].mountWrites).toBe(1);
    expect(document.querySelector("p").style.color).toBe("red");
  });

  test("impure: a row that holds an impure directive is read again on every pass", async () => {
    boot();
    Sap.use({
      name: "marks",
      api: 1,
      directives: { mark: { key: "marks" }, volatile: { key: "volatiles", impure: true } },
      setup: () => ({ directives: { mark: () => ({}), volatile: () => ({}) }, collect: () => false }),
    });
    const root = mount(`<main sap state="n:num" n="1"><ul items="rows">
      <li item data-id="a"><span bind="t">one</span></li>
      <li item data-id="b"><i mark></i><b bind="t">two</b></li>
      <li item data-id="c"><i volatile></i><em bind="t">three</em></li>
    </ul><output text="state.n">1</output></main>`);
    await warm(root);
    const readsOf = (tag) => {
      const watch = watchCells(window, [tag]);
      try {
        return watch.during(() => { root.setAttribute("n", String(Number(root.getAttribute("n")) + 1)); Sap.flush(); });
      } finally {
        watch.stop();
      }
    };
    expect(readsOf("span")).toBe(0);
    expect(readsOf("b")).toBe(0);
    expect(readsOf("em")).toBeGreaterThan(0);
    expect(root.querySelector("output").textContent).toBe("4");
  });

  test("wanted: a directive whose plugin is declared and not installed asks for the plugin", async () => {
    boot();
    const asked = [];
    let hits = 0;
    const facts = { name: "ping", directives: { ping: { key: "pings" } } };
    Sap.plugins.declare(facts);
    Sap.plugins.loader = (name) => {
      asked.push(name);
      return Promise.resolve({ ...facts, api: 1, setup: () => ({ directives: { ping: () => ({}) }, collect(pass, el, plan) { if (plan.pings) hits++; return false; } }) });
    };
    mount(`<main sap><ul items="rows"><li item data-id="a"><b ping></b></li></ul><output text="1 + 1">2</output></main>`);
    expect(Sap.report()).toMatchObject({ errors: [], warnings: [] });
    expect(hits).toBe(0);
    await tick();
    expect(asked).toEqual(["ping"]);
    expect(Sap.plugins.has("ping")).toBe(true);
    expect(hits).toBe(1);
  });

  test("waits: a directive expression that calls a pending helper stops the app like any other", () => {
    boot();
    Sap.plugins.declare({ name: "math", helpers: ["cube"] });
    Sap.plugins.loader = () => new Promise(() => {});
    Sap.use(fill([]));
    const root = mount(`<main sap state="n:num" n="2"><p fill:width="cube(state.n) + 'px'">x</p><output text="state.n + 1">saved</output></main>`);
    expect(root.querySelector("output").textContent).toBe("saved");
    expect(root.querySelector("p").style.width).toBe("");
    expect(Sap.report().errors).toEqual([]);
    expect(Sap.plugins.status().loading).toEqual(["math"]);
  });
});

describe("helper calls beside template text", () => {
  test("label: a helper name in template text after a hole asks for no plugin, and the app paints", async () => {
    boot();
    Sap.plugins.declare({ name: "grid", helpers: ["cell", "range"] });
    Sap.plugins.loader = () => { throw new Error("nothing should load"); };
    const root = mount('<main sap state="n:num" n="3"><output text="`${state.n} items in range (all)`">saved</output><b text="state.n">saved</b></main>');
    await tick();
    expect(root.querySelector("output").textContent).toBe("3 items in range (all)");
    expect(root.querySelector("b").textContent).toBe("3");
    expect(Sap.plugins.status()).toEqual({ installed: [], loading: [], failed: [] });
    expect(errors()).toEqual([]);
  });

  test("call: a helper call after template text asks for its plugin, and the app paints when it arrives", async () => {
    boot();
    Sap.plugins.declare({ name: "grid", helpers: ["cell"] });
    const asked = [];
    Sap.plugins.loader = (name) => {
      asked.push(name);
      return Promise.resolve({ name, api: 1, helpers: ["cell"], setup: () => ({ helpers: { cell: (ref) => (ref === "B2" ? 40 : 5) } }) });
    };
    const root = mount('<main sap state="n:num" n="3"><output text="`${state.n}: ` + cell(1) + ` units`">saved</output><i text="`${state.n}\'s total: ` + String(cell(\'B2\'))">saved</i></main>');
    expect(root.querySelector("output").textContent).toBe("saved");
    expect(errors()).toEqual([]);
    await tick();
    expect(asked).toEqual(["grid"]);
    expect(root.querySelector("output").textContent).toBe("3: 5 units");
    expect(root.querySelector("i").textContent).toBe("3's total: 40");
    expect(errors()).toEqual([]);
  });

  test("global: a function the page defines after mount ends the wait on the next refresh", () => {
    boot();
    Sap.plugins.declare({ name: "math", helpers: ["pageMath"] });
    Sap.plugins.loader = () => new Promise(() => {});
    const root = mount(`<main sap state="n:num" n="3"><output text="pageMath(state.n)">saved</output><b text="state.n">saved</b></main>`);
    expect(root.querySelector("output").textContent).toBe("saved");
    window.pageMath = (n) => n * 2;
    try {
      Sap.refresh();
      expect(root.querySelector("output").textContent).toBe("6");
      expect(root.querySelector("b").textContent).toBe("3");
      expect(errors()).toEqual([]);
    } finally {
      delete window.pageMath;
    }
  });
});

describe("the kit", () => {
  test("kit: one frozen set of the engine's own tools", async () => {
    boot();
    let kit = null;
    const passes = [];
    Sap.use({ name: "tools", api: 1, setup(k) { kit = k; return { begin(pass) { passes.push(pass.trigger); }, api: { tools: { v: 1 } } }; } });
    Sap.use({ name: "peer", api: 1, setup: (k) => ({ api: { peerSeesSameKit: k === kit } }) });
    expect(Object.isFrozen(kit)).toBe(true);
    expect(Object.keys(kit).sort()).toEqual([
      "api", "appFor", "apps", "capability", "clearBeacon", "compile", "drainPlans", "forgetRow", "load", "mayWrite",
      "planOf", "plugin", "run", "runWith", "schedule", "setBeacon", "version", "write",
    ]);
    expect([kit.api, kit.version]).toEqual([1, Sap.version]);
    expect(kit.plugin("tools")).toEqual({ tools: { v: 1 } });
    expect(kit.plugin("peer")).toEqual({ peerSeesSameKit: true });
    expect(kit.plugin("nobody")).toBe(null);
    expect(kit.runWith(kit.compile("state.n + 1"), { n: 2 }, null, null, {})).toBe(3);

    const root = mount(`<main sap state="n:num" n="1"><output text="state.n">1</output></main>`);
    const out = root.querySelector("output");
    const app = Sap._registry.get(root);
    expect(kit.appFor(out)).toBe(app);
    expect(kit.apps()).toEqual([app]);
    await settled();
    passes.length = 0;

    kit.write(() => root.setAttribute("n", "2"));
    await tick();
    expect(passes).toEqual([]);
    expect(out.textContent).toBe("1");

    kit.schedule(out);
    kit.schedule(document.body);
    await tick();
    expect(passes).toEqual(["plugin"]);
    expect(out.textContent).toBe("2");

    kit.schedule(app, "tools:recalc");
    await tick();
    expect(passes).toEqual(["plugin", "tools:recalc"]);

    kit.setBeacon(out, "E24");
    expect(out.getAttribute("sap-error")).toBe("E24");
    kit.clearBeacon(out);
    expect(out.hasAttribute("sap-error")).toBe(false);
  });
});

describe("loading", () => {
  test("manifest: a plugin the release ships facts for is known from the start, and loads when a page asks", async () => {
    boot({ manifest: { chart: { name: "chart", file: "chart-file", boundaries: { chart: { opaque: true } }, helpers: ["charted"] } } });
    const asked = [];
    Sap.plugins.loader = (name, facts) => { asked.push([name, facts.file, facts.helpers]); return new Promise(() => {}); };
    mount(`<main sap id="a"><div chart><b text="1 + 1">saved</b></div></main><main sap id="b"><i text="charted()">saved</i><u text="1 + 1">saved</u></main>`);
    expect([...document.querySelectorAll("b, i, u")].map((el) => el.textContent)).toEqual(["saved", "saved", "saved"]);
    await tick();
    expect(asked).toEqual([["chart", "chart-file", ["charted"]]]);
    expect(Sap.plugins.status()).toEqual({ installed: [], loading: ["chart"], failed: [] });
    expect(Sap.report()).toMatchObject({ errors: [], warnings: [] });
  });

  test("requires: what a plugin requires loads first, and the promise gives the plugin's api", async () => {
    boot();
    const asked = [];
    const defs = {
      base: { name: "base", api: 1, setup: () => ({ api: { base: 1 } }) },
      pack: { name: "pack", api: 1, requires: ["base"], setup: (kit) => ({ api: { pack: kit.plugin("base") } }) },
    };
    Sap.plugins.declare({ name: "pack", requires: ["base"] });
    Sap.plugins.loader = (name, facts) => { asked.push([name, facts.requires || null]); return Promise.resolve({ default: defs[name] }); };
    const loaded = Sap.plugins.load("pack");
    loaded.catch(() => {});
    expect(Sap.plugins.load("pack")).toBe(loaded);
    expect(Sap.use("pack")).toBe(loaded);
    expect(Sap.plugins.status().loading.sort()).toEqual(["base", "pack"]);
    expect(await loaded).toEqual({ pack: { base: 1 } });
    expect(asked).toEqual([["base", null], ["pack", ["base"]]]);
    expect(Sap.plugins.status()).toEqual({ installed: ["base", "pack"], loading: [], failed: [] });
    expect(await Sap.plugins.load("pack")).toEqual({ pack: { base: 1 } });
    expect(asked).toHaveLength(2);
  });

  test("retry: one try, one more after 1 second, and one more after 4 seconds", async () => {
    jest.useFakeTimers({ doNotFake: ["queueMicrotask", "nextTick", "performance"] });
    boot({ delays: true });
    expect(Sap.plugins.retryDelays).toEqual([1000, 4000]);
    let attempts = 0;
    Sap.plugins.loader = () => (++attempts < 3 ? Promise.reject(new Error("offline")) : Promise.resolve({ name: "slow", api: 1, setup: () => ({ api: { slow: 1 } }) }));
    const loaded = Sap.plugins.load("slow");
    loaded.catch(() => {});
    await tick();
    expect(attempts).toBe(1);
    jest.advanceTimersByTime(999);
    await tick();
    expect(attempts).toBe(1);
    jest.advanceTimersByTime(1);
    await tick();
    expect(attempts).toBe(2);
    jest.advanceTimersByTime(3999);
    await tick();
    expect(attempts).toBe(2);
    expect(Sap.plugins.status()).toEqual({ installed: [], loading: ["slow"], failed: [] });
    jest.advanceTimersByTime(1);
    await tick();
    expect(attempts).toBe(3);
    expect(await loaded).toEqual({ slow: 1 });
    expect(Sap.plugins.status()).toEqual({ installed: ["slow"], loading: [], failed: [] });
  });

  test("retry: after the third failure the plugin has failed, with one event and the last error", async () => {
    jest.useFakeTimers({ doNotFake: ["queueMicrotask", "nextTick", "performance"] });
    boot({ delays: true });
    let attempts = 0;
    const heard = [];
    const on = (e) => heard.push([e.detail.plugin, e.detail.error.message]);
    document.addEventListener("sap:plugin-failed", on);
    try {
      Sap.plugins.loader = () => Promise.reject(new Error("offline " + ++attempts));
      const loaded = Sap.plugins.load("down");
      loaded.catch(() => {});
      await tick();
      jest.advanceTimersByTime(1000);
      await tick();
      expect(attempts).toBe(2);
      expect(heard).toEqual([]);
      expect(Sap.plugins.status()).toEqual({ installed: [], loading: ["down"], failed: [] });
      jest.advanceTimersByTime(4000);
      await tick();
      expect(attempts).toBe(3);
      await expect(loaded).rejects.toThrow("offline 3");
      expect(heard).toEqual([["down", "offline 3"]]);
      expect(Sap.plugins.status()).toEqual({ installed: [], loading: [], failed: ["down"] });
      jest.advanceTimersByTime(60000);
      await tick();
      expect(attempts).toBe(3);
    } finally {
      document.removeEventListener("sap:plugin-failed", on);
    }
  });

  test("retry: a plugin that installs by another road while a retry waits is not fetched again", async () => {
    jest.useFakeTimers({ doNotFake: ["queueMicrotask", "nextTick", "performance"] });
    boot({ delays: true });
    let attempts = 0;
    Sap.plugins.loader = () => Promise.reject(new Error("offline " + ++attempts));
    const loaded = Sap.plugins.load("patient");
    loaded.catch(() => {});
    await tick();
    expect(attempts).toBe(1);
    Sap.use({ name: "patient", api: 1, setup: () => ({ api: { patient: 1 } }) });
    for (const ms of [1000, 4000, 60000]) {
      jest.advanceTimersByTime(ms);
      await tick();
      expect(attempts).toBe(1);
    }
    expect(await loaded).toEqual({ patient: 1 });
    expect(Sap.plugins.status()).toEqual({ installed: ["patient"], loading: [], failed: [] });
  });

  test("script: with no loader a plugin loads from base + file, in a tag a save drops, removed once loaded", async () => {
    boot();
    Sap.plugins.base = "https://files.example/sap-plugins/";
    Sap.plugins.declare({ name: "st", file: "st-file" });
    const loaded = Sap.plugins.load("st");
    await tick();
    expect(scripts()).toHaveLength(1);
    const tag = scripts()[0];
    expect(tag.getAttribute("src")).toBe("https://files.example/sap-plugins/st-file.js");
    expect(tag.getAttribute("clay")).toBe("editor-ui");
    // What a plugin file does when it runs and finds another engine, or none, as window.Sap.
    window.sapPlugins.push({ name: "st", api: 1, setup: () => ({ api: { st: 1 } }) });
    tag.dispatchEvent(new Event("load"));
    expect(await loaded).toEqual({ st: 1 });
    expect(scripts()).toHaveLength(0);
  });

  test("script: a declared url is the address, and a loader that passes on a name falls back to the tag", async () => {
    boot();
    Sap.plugins.base = "https://files.example/p/";
    Sap.plugins.declare({ name: "third", url: "https://other.example/third.js" });
    const calls = [];
    Sap.plugins.loader = (name, facts) => { calls.push([name, facts.url]); return undefined; };
    Sap.plugins.load("third").catch(() => {});
    Sap.plugins.load("plain").catch(() => {});
    await tick();
    expect(calls).toEqual([["third", "https://other.example/third.js"], ["plain", undefined]]);
    expect(scripts().map((s) => s.getAttribute("src"))).toEqual(["https://other.example/third.js", "https://files.example/p/plain.js"]);
  });

  test("script: a download that fails removes the tag and names the address", async () => {
    boot();
    Sap.plugins.base = "https://files.example/p/";
    const loaded = Sap.plugins.load("gone");
    await tick();
    scripts()[0].dispatchEvent(new Event("error"));
    await expect(loaded).rejects.toThrow("could not load https://files.example/p/gone.js");
    expect(scripts()).toHaveLength(0);
    expect(Sap.plugins.status().failed).toEqual(["gone"]);
  });

  test("script: a file that loads and registers nothing is a failed load", async () => {
    boot();
    Sap.plugins.base = "https://files.example/p/";
    const loaded = Sap.plugins.load("quiet");
    await tick();
    scripts()[0].dispatchEvent(new Event("load"));
    await expect(loaded).rejects.toThrow('plugin "quiet" loaded and did not register');
    expect(Sap.plugins.status().failed).toEqual(["quiet"]);
  });

  test("script: a file whose setup throws is a failed load with that message", async () => {
    boot();
    Sap.plugins.base = "https://files.example/p/";
    const loaded = Sap.plugins.load("broken");
    await tick();
    window.sapPlugins.push({ name: "broken", api: 1, setup() { throw new Error("broken setup"); } });
    scripts()[0].dispatchEvent(new Event("load"));
    await expect(loaded).rejects.toThrow("broken setup");
  });

  test("script: an engine with no address of its own says to pass the definition", async () => {
    boot();
    expect(Sap.plugins.base).toBe(null);
    await expect(Sap.plugins.load("lost")).rejects.toThrow('no address for plugin "lost": call Sap.use(definition)');
    expect(scripts()).toHaveLength(0);
  });

  test.each([
    ["https://cdn.jsdelivr.net/npm/@panphora/sapjs/dist/sap.min.js", "https://cdn.jsdelivr.net/npm/@panphora/sapjs@VERSION/dist/sap-plugins/"],
    ["https://cdn.jsdelivr.net/npm/@panphora/sapjs@0.6.0/dist/sap-core.min.js", "https://cdn.jsdelivr.net/npm/@panphora/sapjs@VERSION/dist/sap-plugins/"],
    ["https://cdn.jsdelivr.net/npm/@panphora/sapjs", "https://cdn.jsdelivr.net/npm/@panphora/sapjs@VERSION/dist/sap-plugins/"],
    ["https://unpkg.com/@panphora/sapjs@latest/dist/sap.js", "https://unpkg.com/@panphora/sapjs@VERSION/dist/sap-plugins/"],
    ["https://cdn.jsdelivr.net/npm/@panphora/sapjs-extras/dist/x.js", "https://cdn.jsdelivr.net/npm/@panphora/sapjs-extras/dist/sap-plugins/"],
    ["https://clayjs.com/v1/sap.js", "https://clayjs.com/v1/sap-plugins/"],
    ["file:///Users/me/app/vendor/sap.min.js", "file:///Users/me/app/vendor/sap-plugins/"],
    ["capacitor://localhost/vendor/sap.min.js", "capacitor://localhost/vendor/sap-plugins/"],
    ["tauri://localhost/assets/sap.js", "tauri://localhost/assets/sap-plugins/"],
    ["chrome-extension://abcdefghijklmnop/lib/sap-core.min.js", "chrome-extension://abcdefghijklmnop/lib/sap-plugins/"],
  ])("address: an engine at %s keeps its plugins at %s", (script, expected) => {
    boot({ script });
    expect(Sap.plugins.base).toBe(expected.replace("VERSION", Sap.version));
  });

  test.each([
    "data:text/javascript;base64,KGZ1bmN0aW9uKCl7fSkoKQ==",
    "blob:https://app.example/0b5e7a2c",
    "about:blank",
  ])("address: an engine whose own script is at %s starts, and has no folder for plugin files", async (script) => {
    boot({ script });
    expect(Sap.plugins.base).toBe(null);
    const root = mount(`<main sap><b text="1 + 1">saved</b></main>`);
    expect(root.querySelector("b").textContent).toBe("2");
    await expect(Sap.plugins.load("lost")).rejects.toThrow('no address for plugin "lost"');
  });

  describe("ready", () => {
    const KIT = { name: "kit", helpers: ["twice"], directives: { ping: { key: "pings" }, "fill:": { key: "fills" } }, boundaries: { frame: { opaque: true } } };
    const kitDef = () => ({
      ...KIT,
      api: 1,
      setup: () => ({ helpers: { twice: (n) => n * 2 }, directives: { ping: () => ({}), "fill:": () => ({}) }, boundaries: { frame() {} }, collect: () => false }),
    });

    test.each([
      ["a helper call in a text", `<main sap><b text="twice(2)">4</b></main>`],
      ["a helper call in a calc", `<main sap calc:double="twice(2)"></main>`],
      ["a helper call in an each", `<main sap><ul each="[twice(2)]" key="item"><template><li text="item"></li></template></ul></main>`],
      ["a helper call in a row", `<main sap><ul items="rows"><li item data-id="a"><b text="twice(item.n)">4</b></li></ul></main>`],
      ["a directive by its exact name", `<main sap><ul items="rows"><li item data-id="a"><b ping></b></li></ul></main>`],
      ["a directive by its prefix", `<main sap><b fill:color="'red'"></b></main>`],
      ["a boundary attribute", `<main sap><section><div frame><b text="1 + 1">saved</b></div></section></main>`],
    ])("ready: %s asks for the plugin before any app is mounted", async (what, html) => {
      boot();
      Sap.plugins.declare(KIT);
      const asked = [];
      Sap.plugins.loader = (name) => { asked.push(name); return Promise.resolve(kitDef()); };
      document.body.innerHTML = html;
      const pending = Sap.plugins.ready();
      expect(pending).not.toBe(null);
      await pending;
      expect(asked).toEqual(["kit"]);
      expect(Sap.plugins.has("kit")).toBe(true);
      expect(Sap.plugins.ready()).toBe(null);
    });

    test.each([
      ["under sap-ignore", `<main sap><div sap-ignore><b text="twice(2)">4</b><i ping></i><div frame></div></div></main>`],
      ["outside every app", `<div frame></div><b text="twice(2)">4</b><i ping></i><main sap></main>`],
      ["inside a string or after a dot", `<main sap state="n:num" n="1"><b text="'twice(' + state.n + ')'">twice(1)</b><i text="String(state.twice)"></i></main>`],
      ["in an attribute that is not an expression", `<main sap><b title="twice(2)" data-note="ping"></b></main>`],
    ])("ready: markup %s asks for nothing", (what, html) => {
      boot();
      Sap.plugins.declare(KIT);
      Sap.plugins.loader = () => { throw new Error("nothing should load"); };
      document.body.innerHTML = html;
      expect(Sap.plugins.ready()).toBe(null);
    });

    // The markup is kept out of the document, so no app mounts and asks on its own.
    test("ready: the root it is given counts when it is the app itself, and when it sits inside an app", async () => {
      boot();
      Sap.plugins.declare(KIT);
      const asked = [];
      Sap.plugins.loader = (name) => { asked.push(name); return Promise.resolve(name === "kit" ? kitDef() : { name, api: 1 }); };
      const holder = document.createElement("div");
      holder.innerHTML = `<main sap><p>plain</p><div frame></div></main><aside sap plugins="other"></aside>`;
      expect(Sap.plugins.ready(holder.querySelector("p"))).toBe(null);
      await Sap.plugins.ready(holder.querySelector("[frame]"));
      expect(asked).toEqual(["kit"]);
      holder.querySelector("main").setAttribute("plugins", "extra");
      await Sap.plugins.ready(holder.querySelector("main"));
      expect(asked).toEqual(["kit", "extra"]);
      expect(Sap.plugins.ready(holder.querySelector("main"))).toBe(null);
      await Sap.plugins.ready(holder);
      expect(asked).toEqual(["kit", "extra", "other"]);
      expect(Sap.plugins.ready(holder)).toBe(null);
    });

    test("ready: an element inside an app counts the plugins= list of that app's root, and of no other app", async () => {
      boot();
      const asked = [];
      Sap.plugins.loader = (name) => { asked.push(name); return Promise.resolve({ name, api: 1 }); };
      const holder = document.createElement("div");
      holder.innerHTML = `<main sap plugins="extra"><section><p>plain</p></section></main><aside sap plugins="other"><p>plain</p></aside>`;
      const pending = Sap.plugins.ready(holder.querySelector("main p"));
      expect(pending).not.toBe(null);
      await pending;
      expect(asked).toEqual(["extra"]);
      expect(Sap.plugins.ready(holder.querySelector("main p"))).toBe(null);
      await Sap.plugins.ready(holder.querySelector("aside p"));
      expect(asked).toEqual(["extra", "other"]);
    });

    test("ready: two plugins whose helpers one expression calls are both waited for, and the app then paints in its first pass", async () => {
      boot();
      const defs = {
        mathA: { name: "mathA", api: 1, helpers: ["twice"], setup: () => ({ helpers: { twice: (n) => n * 2 } }) },
        mathB: { name: "mathB", api: 1, helpers: ["thrice"], setup: () => ({ helpers: { thrice: (n) => n * 3 } }) },
      };
      for (const { name, helpers } of Object.values(defs)) Sap.plugins.declare({ name, helpers });
      const asked = [];
      Sap.plugins.loader = (name) => { asked.push(name); return Promise.resolve(defs[name]); };
      const holder = document.createElement("div");
      holder.innerHTML = `<main sap><output text="twice(2) + thrice(3)">saved</output></main>`;
      await Sap.plugins.ready(holder);
      expect(asked).toEqual(["mathA", "mathB"]);
      expect(Sap.plugins.status()).toEqual({ installed: ["mathA", "mathB"], loading: [], failed: [] });
      expect(Sap.plugins.ready(holder)).toBe(null);
      expect(mount(holder.innerHTML).querySelector("output").textContent).toBe("13");
    });

    test("ready: two plugin directives on one element are both waited for", async () => {
      boot();
      const defs = {
        ink: { name: "ink", api: 1, directives: { ink: { key: "inks" } }, setup: () => ({ directives: { ink: () => ({}) } }) },
        frame: { name: "frame", api: 1, directives: { frame: { key: "frames" } }, setup: () => ({ directives: { frame: () => ({}) } }) },
      };
      for (const { name, directives } of Object.values(defs)) Sap.plugins.declare({ name, directives });
      const asked = [];
      Sap.plugins.loader = (name) => { asked.push(name); return Promise.resolve(defs[name]); };
      const holder = document.createElement("div");
      holder.innerHTML = `<main sap><output ink frame>saved</output></main>`;
      await Sap.plugins.ready(holder);
      expect(asked.sort()).toEqual(["frame", "ink"]);
      expect(Sap.plugins.status().installed.sort()).toEqual(["frame", "ink"]);
      expect(Sap.plugins.ready(holder)).toBe(null);
    });

    test.each([["ink frame"], ["frame ink"]])("ready: <output %s> asks for ink while frame fails to load, and ink is then applied", async (attrs) => {
      boot();
      const hits = [];
      const defs = {
        ink: { name: "ink", api: 1, directives: { ink: { key: "inks" } }, setup: () => ({ directives: { ink: () => ({}) }, collect(pass, el, plan) { if (plan.inks) hits.push(el.tagName); return false; } }) },
        frame: { name: "frame", api: 1, directives: { frame: { key: "frames" } }, setup: () => ({ directives: { frame: () => ({}) } }) },
      };
      for (const { name, directives } of Object.values(defs)) Sap.plugins.declare({ name, directives });
      const asked = [];
      Sap.plugins.loader = (name) => { asked.push(name); return name === "frame" ? Promise.reject(new Error("offline")) : Promise.resolve(defs[name]); };
      const holder = document.createElement("div");
      holder.innerHTML = `<main sap><output ${attrs}>saved</output></main>`;
      await Sap.plugins.ready(holder);
      expect(asked).toContain("ink");
      expect(Sap.plugins.status()).toEqual({ installed: ["ink"], loading: [], failed: ["frame"] });
      expect(mount(holder.innerHTML).querySelector("output").textContent).toBe("saved");
      expect(hits).toEqual(["OUTPUT"]);
    });

    // A loader that is asked a fourth time never answers, so a call that keeps asking
    // stays open and does not spin forever.
    test("ready: a plugin that fails is asked for once in a call, and the promise resolves well before the time limit", async () => {
      boot();
      Sap.plugins.declare({ name: "gone", helpers: ["gone"] });
      const asked = [];
      Sap.plugins.loader = (name) => { asked.push(name); return asked.length > 3 ? new Promise(() => {}) : Promise.reject(new Error("offline")); };
      const holder = document.createElement("div");
      holder.innerHTML = `<main sap><output text="gone(1)">saved</output></main>`;
      const resolves = (promise) => Promise.race([promise.then(() => true), tick(200).then(() => false)]);
      expect(await resolves(Sap.plugins.ready(holder))).toBe(true);
      expect(asked).toEqual(["gone"]);
      expect(Sap.plugins.status()).toEqual({ installed: [], loading: [], failed: ["gone"] });
      expect(await resolves(Sap.plugins.ready(holder))).toBe(true);
      expect(asked).toEqual(["gone", "gone"]);
    });

    test("ready: an app that is mounted and waits for a helper is seen, and the promise is the load already under way", async () => {
      boot();
      Sap.plugins.declare(KIT);
      let arrive = null;
      let asked = 0;
      Sap.plugins.loader = () => { asked++; return new Promise((resolve) => { arrive = resolve; }); };
      const root = mount(`<main sap><b text="twice(2)">saved</b></main>`);
      await tick();
      expect(Sap.plugins.status().loading).toEqual(["kit"]);
      const pending = Sap.plugins.ready(root);
      expect(pending).not.toBe(null);
      arrive(kitDef());
      await pending;
      await tick();
      expect(asked).toBe(1);
      expect(root.querySelector("b").textContent).toBe("4");
      expect(Sap.plugins.ready(root)).toBe(null);
    });

    test("ready: while every known plugin is installed it reads no element", () => {
      boot();
      document.body.innerHTML = `<main sap plugins="kit"><b text="1 + 1">2</b><i text="2 + 2">4</i></main>`;
      const reads = jest.spyOn(Element.prototype, "attributes", "get");
      try {
        Sap.use(kitDef());
        reads.mockClear();
        expect(Sap.plugins.ready()).toBe(null);
        expect(reads).not.toHaveBeenCalled();
        Sap.plugins.declare({ name: "absent", helpers: ["absent"] });
        expect(Sap.plugins.ready()).toBe(null);
        expect(reads).toHaveBeenCalled();
      } finally {
        reads.mockRestore();
      }
    });
  });

  test("ready: a plugins= list on a root counts, and what is installed or outside a root does not", async () => {
    boot();
    Sap.use({ name: "have", api: 1 });
    const asked = [];
    Sap.plugins.loader = (name) => { asked.push(name); return Promise.resolve({ name, api: 1 }); };
    document.body.innerHTML = `<main sap plugins="have  extra"></main><div plugins="ignored"></div>`;
    await Sap.plugins.ready();
    expect(asked).toEqual(["extra"]);
    expect(Sap.plugins.has("extra")).toBe(true);
    expect(Sap.plugins.ready()).toBe(null);
  });
});

describe("a plugin that did not load", () => {
  const chart = { name: "chart", boundaries: { chart: { opaque: true } } };
  const working = { ...chart, api: 1, setup: () => ({ boundaries: { chart(pass, el) { el.textContent = "drawn"; } } }) };

  test("E52: the first element that asked carries the report and the marker, once per pass", async () => {
    boot();
    Sap.plugins.declare(chart);
    Sap.plugins.loader = () => Promise.reject(new Error("offline"));
    const root = mount(`<main sap state="n:num" n="1"><div id="c1" chart>saved</div><div id="c2" chart>saved</div><output text="state.n">1</output></main>`);
    expect(errors()).toEqual([]);
    await tick(12);
    expect(errors()).toEqual([["E52", "plugin-not-loaded", "div#c1", 'the "chart" plugin did not load: offline']]);
    expect(Sap.report().errors[0].fix).toMatch(/Sap\.plugins\.retry\(\)/);
    expect(root.querySelector("#c1").getAttribute("sap-error")).toBe("E52");
    expect(root.querySelector("#c2").hasAttribute("sap-error")).toBe(false);
    expect(root.hasAttribute("sap-error")).toBe(false);
    expect(root.querySelector("#c1").textContent).toBe("saved");

    root.setAttribute("n", "2");
    await tick();
    expect(root.querySelector("output").textContent).toBe("2");
    expect(errors()).toHaveLength(1);
    expect(Sap.plugins.status()).toEqual({ installed: [], loading: [], failed: ["chart"] });

    Sap.use(working);
    expect(root.querySelector("#c1").hasAttribute("sap-error")).toBe(false);
    await tick();
    expect(errors()).toEqual([]);
    expect(root.querySelector("#c1").textContent).toBe("drawn");
    expect(Sap.plugins.status()).toEqual({ installed: ["chart"], loading: [], failed: [] });
  });

  test("E52: the marker write is not a change, so a failed plugin does not keep the app running passes", async () => {
    boot();
    Sap.plugins.declare(chart);
    Sap.plugins.loader = () => Promise.reject(new Error("offline"));
    const passes = [];
    Sap.use({ name: "probe", api: 1, setup: () => ({ begin(pass) { passes.push(pass.trigger); } }) });
    mount(`<main sap><div chart>saved</div></main>`);
    await settled();
    await settled();
    expect(passes).toEqual(["mount", "plugin-failed:chart"]);
    expect(document.querySelector("[chart]").getAttribute("sap-error")).toBe("E52");
  });

  test("E52: a directive that asks from inside a kept row is reported on every pass", async () => {
    boot();
    Sap.plugins.declare({ name: "ping", directives: { ping: { key: "pings" } } });
    Sap.plugins.loader = () => Promise.reject(new Error("offline"));
    const root = mount(`<main sap state="n:num" n="1"><ul items="rows"><li item data-id="a"><b ping></b><span bind="t">one</span></li></ul><output text="state.n">1</output></main>`);
    await warm(root);
    expect(errors()).toEqual([["E52", "plugin-not-loaded", "main[sap] > ul > li > b", 'the "ping" plugin did not load: offline']]);
    for (const n of ["2", "3"]) {
      root.setAttribute("n", n);
      await tick();
      expect(root.querySelector("output").textContent).toBe(n);
      expect(errors()).toHaveLength(1);
    }
  });

  test("E52: an app that waits for a failed plugin's helper reports at its root and keeps its saved values", async () => {
    boot();
    Sap.plugins.declare({ name: "math", helpers: ["cube"] });
    Sap.plugins.loader = () => Promise.reject(new Error("offline"));
    const root = mount(`<main sap state="n:num" n="2"><output text="cube(state.n)">8</output><b text="state.n">saved</b></main>`);
    await tick(12);
    expect(errors()).toEqual([["E52", "plugin-not-loaded", "main[sap]", 'the "math" plugin did not load: offline']]);
    expect(root.getAttribute("sap-error")).toBe("E52");
    expect(root.querySelector("output").textContent).toBe("8");
    expect(root.querySelector("b").textContent).toBe("saved");
  });

  test("online: when the browser comes back online every failed plugin is tried again", async () => {
    boot();
    let up = false;
    let attempts = 0;
    Sap.plugins.declare(chart);
    Sap.plugins.loader = () => (attempts++, up ? Promise.resolve(working) : Promise.reject(new Error("offline")));
    const root = mount(`<main sap><div chart>saved</div></main>`);
    await tick(12);
    expect([attempts, Sap.plugins.status().failed]).toEqual([1, ["chart"]]);
    up = true;
    window.dispatchEvent(new Event("online"));
    await tick(12);
    expect(attempts).toBe(2);
    expect(Sap.plugins.has("chart")).toBe(true);
    expect(root.querySelector("div").textContent).toBe("drawn");
  });

  test("retry: by name tries that plugin only, and resolves when the try has settled", async () => {
    boot();
    const asked = [];
    Sap.plugins.loader = (name) => { asked.push(name); return Promise.reject(new Error("offline")); };
    await Promise.allSettled([Sap.plugins.load("a"), Sap.plugins.load("b")]);
    expect(Sap.plugins.status().failed).toEqual(["a", "b"]);
    asked.length = 0;
    await Sap.plugins.retry("b");
    expect(asked).toEqual(["b"]);
    await Sap.plugins.retry();
    expect(asked).toEqual(["b", "a", "b"]);
  });
});

describe("window.sapPlugins", () => {
  test("foreign: a value another script put there is left alone, and plugins still install", () => {
    for (const foreign of ["taken by another script", { length: 0 }, () => {}, 7]) {
      window.sapPlugins = foreign;
      boot();
      expect(Sap.use({ name: "solo", api: 1, setup: () => ({ api: { solo: 1 } }) })).toEqual({ solo: 1 });
      expect(window.sapPlugins).toBe(foreign);
      Sap.unmount();
    }
  });

  test("early: definitions that arrived before the engine install when it starts, and a broken one does not stop the rest", () => {
    const order = [];
    window.sapPlugins = [
      { name: "broken", api: 1, setup() { throw new Error("broken setup"); } },
      { name: "first", api: 1, setup: () => (order.push("first"), {}) },
      { name: "needs", api: 1, requires: ["later"], setup: () => (order.push("needs"), {}) },
      { name: "later", api: 1, setup: () => (order.push("later"), {}) },
    ];
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});
    boot();
    expect(order).toEqual(["first", "later", "needs"]);
    expect(Sap.plugins.status().installed).toEqual(["first", "later", "needs"]);
    expect(logged.mock.calls.map((c) => c[0].message)).toEqual(["broken setup"]);
    expect(window.sapPlugins).toHaveLength(4);
  });

  test("second engine: it installs every definition the first one saw, with its own kit", () => {
    boot();
    const first = Sap;
    const kits = [];
    first.use({ name: "both", api: 1, setup: (kit) => (kits.push(kit), { api: { both: kits.length } }) });
    boot();
    expect(Sap).not.toBe(first);
    expect(kits).toHaveLength(2);
    expect(kits[0]).not.toBe(kits[1]);
    expect([first.both, Sap.both]).toEqual([1, 2]);
    expect(window.sapPlugins).toHaveLength(1);
    first.unmount();
  });

  test("unmount: plugins let go, and a definition or a download that arrives later installs nothing", async () => {
    boot();
    const log = [];
    const heard = [];
    const on = (e) => heard.push(e.detail.plugin);
    document.addEventListener("sap:plugin-failed", on);
    try {
      let give = null;
      Sap.use({ name: "held", api: 1, setup: () => ({ dispose() { log.push("dispose held"); } }) });
      Sap.use({ name: "plain", api: 1 });
      Sap.plugins.loader = (name) => (name === "late" ? new Promise((resolve) => { give = resolve; }) : Promise.reject(new Error("offline")));
      await Sap.plugins.load("down").catch(() => {});
      expect(heard).toEqual(["down"]);
      const loaded = Sap.plugins.load("late");
      await tick();
      Sap.unmount();
      expect(log).toEqual(["dispose held"]);
      expect(Sap.plugins.status()).toEqual({ installed: [], loading: ["late"], failed: [] });
      expect(Sap.use({ name: "after", api: 1, setup: () => (log.push("setup after"), {}) })).toBe(null);
      give({ name: "late", api: 1, setup: () => (log.push("setup late"), {}) });
      expect(await loaded).toBe(null);
      expect(await Sap.plugins.load("other")).toBe(null);
      window.dispatchEvent(new Event("online"));
      await tick(12);
      expect(log).toEqual(["dispose held"]);
      expect(heard).toEqual(["down"]);
    } finally {
      document.removeEventListener("sap:plugin-failed", on);
    }
  });
});

describe("Sap.flush", () => {
  const PAGE = `<main sap state="n:num" n="1"><output text="state.n">1</output></main>`;

  test("flush: each plugin finishes its own work, and the passes that work queues run in the same call", () => {
    boot();
    let todo = null;
    let calls = 0;
    Sap.use({ name: "lazy", api: 1, setup: () => ({ flush() { calls++; if (todo) todo(); todo = null; return null; } }) });
    const root = mount(PAGE);
    todo = () => root.setAttribute("n", "5");
    expect(Sap.flush()).toBe(null);
    expect(root.querySelector("output").textContent).toBe("5");
    expect(calls).toBe(2);
  });

  test("flush: a plugin that cannot finish in this task makes Sap.flush return a promise of the settled page", async () => {
    boot();
    let busy = false;
    let finish = null;
    const root = mount(PAGE);
    Sap.use({
      name: "slow",
      api: 1,
      setup: () => ({
        flush() {
          if (!busy) return null;
          return new Promise((resolve) => { finish = () => { busy = false; root.setAttribute("n", "9"); resolve(); }; });
        },
      }),
    });
    busy = true;
    const done = Sap.flush();
    expect(typeof done.then).toBe("function");
    expect(root.querySelector("output").textContent).toBe("1");
    finish();
    expect(await done).toBe(null);
    expect(root.querySelector("output").textContent).toBe("9");
  });

  test("flush: a plugin whose work never ends is asked eight times, and the call returns", () => {
    boot();
    let calls = 0;
    const root = mount(PAGE);
    Sap.use({ name: "restless", api: 1, setup: (kit) => ({ flush() { calls++; kit.schedule(root); return null; } }) });
    expect(Sap.flush()).toBe(null);
    expect(calls).toBe(8);
  });

  test("flush: with no plugin it settles queued changes and returns null", () => {
    boot();
    const root = mount(PAGE);
    root.setAttribute("n", "3");
    expect(root.querySelector("output").textContent).toBe("1");
    expect(Sap.flush()).toBe(null);
    expect(root.querySelector("output").textContent).toBe("3");
  });
});
