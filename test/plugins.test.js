// The plugin host, through the public surface: Sap.use, Sap.plugins, Sap.flush and what
// a page sees while a plugin loads, installs or fails. These are the twenty tests of the
// design's prototype. The tests share one engine and run in order: `tally` installs in
// test 2 and stays installed.

import { mount, type, Sap } from "./helpers/mount.js";
import after from "./plugins/after.js";
import tally from "./plugins/tally.js";
import { compile } from "../src/compile.js";

const tick = async (n = 6) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

const TALLY_FACTS = { name: "tally", boundaries: { tally: { opaque: true } }, helpers: ["tally"] };

let release;

beforeAll(() => {
  Sap.plugins.retryDelays.length = 0;
  Sap.plugins.declare(TALLY_FACTS);
  Sap.plugins.loader = (name) => (name === "tally"
    ? new Promise((resolve) => { release = () => resolve({ default: tally }); })
    : Promise.reject(new Error("no such file")));
});

const PAGE = `<main sap state="n:num" n="1">
  <input bind="note" value="hi">
  <ul tally="scores"><li>3</li><li>4</li><li>{{raw}}</li><li total>7</li></ul>
  <output id="double" text="tally('scores') * 2">14</output>
  <span id="other" text="state.n + 1">2</span>
</main>`;

test("1. a directive plugin installed with Sap.use runs on the public contract", async () => {
  Sap.use(after);
  window.__hits = 0;
  const root = mount(`<main sap state="n:num" n="2"><p after="window.__hits += state.n" text="state.n"></p></main>`);
  expect(Sap.status().apps[0].ok).toBe(true);
  expect(Sap.report().warnings.filter((w) => w.attr === "after")).toHaveLength(0);
  expect(window.__hits).toBe(2);
  root.setAttribute("n", "5");
  await tick();
  expect(window.__hits).toBe(7);
  expect(root.querySelector("p").textContent).toBe("5");
});

test("2. before its plugin loads, a boundary is left as saved and helper users wait", async () => {
  const root = mount(PAGE);
  const app = Sap._registry.get(root);
  expect(app.halted).toBeFalsy();
  expect(Sap.plugins.status().loading).toContain("tally");
  expect(root.querySelector("li[total]").textContent).toBe("7");
  expect(root.querySelector("#double").textContent).toBe("14");
  expect(root.querySelector("#other").textContent).toBe("2");
  expect(root.querySelectorAll("[sap-error]")).toHaveLength(0);
  expect(root.hasAttribute("sap-error")).toBe(false);
  expect(Sap.report().errors).toHaveLength(0);

  root.querySelectorAll("li")[0].textContent = "10";
  root.setAttribute("n", "4");
  await tick();
  expect(root.querySelector("#other").textContent).toBe("2");

  release();
  await tick(12);
  expect(Sap.plugins.has("tally")).toBe(true);
  expect(root.querySelector("li[total]").textContent).toBe("14");
  expect(root.querySelector("#double").textContent).toBe("28");
  expect(root.querySelector("#other").textContent).toBe("5");
  expect(Sap.report().errors).toHaveLength(0);
});

test("3. an installed boundary re-reads only when a change lands inside it", async () => {
  const root = mount(PAGE);
  const before = Sap.tally.reads();
  type(root.querySelector("input"), "typed");
  await tick();
  root.setAttribute("n", "9");
  await tick();
  expect(root.querySelector("#other").textContent).toBe("10");
  expect(Sap.tally.reads()).toBe(before);

  root.querySelectorAll("li")[1].textContent = "40";
  await tick();
  expect(root.querySelector("li[total]").textContent).toBe("43");
  expect(root.querySelector("#double").textContent).toBe("86");
  expect(Sap.tally.reads()).toBe(before + 3);
});

test("4. pass.changes is null for mount and refresh and a list for bridge passes", async () => {
  const root = mount(PAGE);
  const seen = Sap.tally.seen;
  expect(seen[seen.length - 1]).toBe(null);
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  root.querySelectorAll("li")[0].firstChild.data = "5";
  await tick();
  expect(seen[seen.length - 1]).toEqual(["characterData:li"]);
  root.querySelectorAll("li")[0].textContent = "6";
  await tick();
  expect(seen[seen.length - 1]).toEqual(["characterData:li"]);
  const li = document.createElement("li");
  li.innerHTML = "<b>1</b>";
  root.querySelector("[tally]").insertBefore(li, root.querySelector("li[total]"));
  await tick();
  expect(seen[seen.length - 1]).toEqual(["add:li"]);
  expect(root.querySelector("li[total]").textContent).toBe("11");
  Sap.refresh();
  expect(seen[seen.length - 1]).toBe(null);
});

test("5. a change made after the pass was scheduled, in the same task, is still listed", async () => {
  const root = mount(PAGE);
  const seen = Sap.tally.seen;
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const from = seen.length;
  type(root.querySelector("input"), "x");
  root.querySelectorAll("li")[0].firstChild.data = "100";
  await tick();
  expect(seen.slice(from)).toEqual([["characterData:li"]]);
  expect(root.querySelector("li[total]").textContent).toBe("104");
});

test("6. Sap.flush settles queued changes in the same task", () => {
  const root = mount(PAGE);
  root.querySelectorAll("li")[0].firstChild.data = "1";
  expect(root.querySelector("li[total]").textContent).toBe("7");
  expect(Sap.flush()).toBe(null);
  expect(root.querySelector("li[total]").textContent).toBe("5");
  expect(root.querySelector("#double").textContent).toBe("10");
});

test("7. helpers sit outside the frozen 13 arguments, and a frozen name wins", () => {
  mount(PAGE);
  const entry = compile("tally('scores') + sum([1, 2])");
  expect(entry.fn.length).toBe(13);
  expect(entry.waits).toBe(null);
  expect(() => Sap.use({ name: "bad", api: 1, helpers: ["sum"], setup: () => ({ helpers: { sum: () => 0 } }) })).toThrow(/taken/);
  expect(Sap.plugins.has("bad")).toBe(false);
  expect(() => Sap.use({ name: "old", api: 0 })).toThrow(/plugin "old" needs a name and plugin API 1; it gives API 0/);
});

test("8. a page global with a declared helper name is the page's, not a load trigger", () => {
  window.shade = () => 3;
  Sap.plugins.declare({ name: "shades", helpers: ["shade"] });
  const root = mount(`<main sap><output text="shade() + 1">0</output></main>`);
  expect(root.querySelector("output").textContent).toBe("4");
  expect(Sap.plugins.status().loading).not.toContain("shades");
  delete window.shade;
});

test("9. a failed load keeps the file as saved, reports once, and retry recovers", async () => {
  Sap.plugins.declare({ name: "meter", boundaries: { meter: { opaque: false } }, helpers: ["meter"] });
  let attempts = 0;
  let ok = false;
  const prev = Sap.plugins.loader;
  Sap.plugins.loader = (name) => {
    if (name !== "meter") return prev(name);
    attempts++;
    return ok
      ? Promise.resolve({ default: { name: "meter", api: 1, boundaries: { meter: {} }, helpers: ["meter"], setup: () => ({ boundaries: { meter() {} }, helpers: { meter: () => 5 } }) } })
      : Promise.reject(new Error("offline"));
  };
  const root = mount(`<main sap><div meter><b text="1 + 1">keep</b></div><output text="meter() + 1">saved</output></main>`);
  await tick(20);
  expect(attempts).toBe(1);
  expect(Sap.plugins.status().failed).toContain("meter");
  expect(root.querySelector("b").textContent).toBe("keep");
  expect(root.querySelector("output").textContent).toBe("saved");
  expect(Sap.report().errors.map((e) => e.code)).toEqual(["E52"]);
  ok = true;
  await Sap.plugins.retry();
  await tick(12);
  expect(root.querySelector("output").textContent).toBe("6");
  expect(Sap.report().errors).toEqual([]);
  Sap.plugins.loader = prev;
});

test("10. the plugins attribute on the root loads what it names", async () => {
  let asked = 0;
  const prev = Sap.plugins.loader;
  Sap.plugins.loader = (name) => (name === "named" ? (asked++, Promise.resolve({ default: { name: "named", api: 1, setup: () => ({ api: { named: 1 } }) } })) : prev(name));
  mount(`<main sap plugins="named"><output text="1 + 1">2</output></main>`);
  await tick(12);
  expect(asked).toBe(1);
  expect(Sap.plugins.has("named")).toBe(true);
  expect(Sap.named).toBe(1);
  expect(Sap.report().warnings).toEqual([]);
  Sap.plugins.loader = prev;
});

test("11. a plugin that requires another installs after it", () => {
  const order = [];
  expect(Sap.use({ name: "child", api: 1, requires: ["parent"], setup: () => (order.push("child"), {}) })).toBe(null);
  expect(Sap.plugins.has("child")).toBe(false);
  Sap.use({ name: "parent", api: 1, setup: () => (order.push("parent"), {}) });
  expect(order).toEqual(["parent", "child"]);
  expect(Sap.plugins.has("child")).toBe(true);
});

test("12. a failed load fires sap:plugin-failed once", async () => {
  Sap.plugins.declare({ name: "gone", boundaries: { gone: { opaque: true } } });
  const heard = [];
  const on = (e) => heard.push([e.detail.plugin, e.detail.error.message]);
  document.addEventListener("sap:plugin-failed", on);
  mount(`<main sap><div gone>x</div></main>`);
  await tick(20);
  Sap.refresh();
  await tick(20);
  document.removeEventListener("sap:plugin-failed", on);
  expect(heard).toEqual([["gone", "no such file"]]);
});

test("13. a boundary limited to one tag is ordinary markup on any other tag", async () => {
  Sap.plugins.declare({ name: "grid", boundaries: { grid: { opaque: true, on: "table" } }, helpers: ["cell", "range"] });
  const root = mount(`<main sap><div grid><b id="in-div" text="1 + 1">saved</b></div><table grid><tbody><tr><td id="in-table" text="1 + 1">saved</td><td>{{x}}</td></tr></tbody></table></main>`);
  expect(root.querySelector("#in-div").textContent).toBe("2");
  expect(root.querySelector("#in-table").textContent).toBe("saved");
  expect(Sap._registry.get(root).halted).toBeFalsy();
  await tick(20);
  expect(Sap.plugins.status().failed).toContain("grid");
});

test("14. a pass the DOM did not cause has an empty change list", async () => {
  const root = mount(PAGE);
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const seen = Sap.tally.seen;
  const from = seen.length;
  type(root.querySelector("input"), "typed");
  await tick();
  expect(seen.slice(from)).toEqual([[]]);
});

describe("15. a pending helper anywhere keeps the saved page", () => {
  beforeAll(() => {
    Sap.plugins.declare({ name: "lateh", helpers: ["late"] });
    const prev = Sap.plugins.loader;
    Sap.plugins.loader = (name) => (name === "lateh" ? new Promise(() => {}) : prev(name));
  });
  const cases = {
    calc: `<main sap calc:x="late() + 1"><output text="state.x">saved</output></main>`,
    effect: `<main sap><output effect="late()" text="1 + 1">saved</output></main>`,
    invalid: `<main sap><input bind="a" invalid="late() ? 'no' : ''"><output text="1 + 1">saved</output></main>`,
    each: `<main sap><ul each="late()"><template><li text="item"></li></template></ul><output text="1 + 1">saved</output></main>`,
    detail: `<main sap state="open"><ul items="cards"><li item data-id="a"><span bind="t">A</span></li></ul><section detail="cards by late()"><b text="item.t">saved</b></section><output text="1 + 1">saved</output></main>`,
  };
  for (const [name, html] of Object.entries(cases)) {
    test(name, async () => {
      const root = mount(html);
      await tick();
      expect({ errors: Sap.report().errors.map((e) => e.code), text: root.querySelector("output").textContent, halted: !!Sap._registry.get(root).halted })
        .toEqual({ errors: [], text: "saved", halted: false });
      expect(Sap.plugins.status().loading).toContain("lateh");
    });
  }
});

test("16. Sap.plugins.ready is null with nothing to wait for, and otherwise resolves on install or on the time limit", async () => {
  document.body.innerHTML = `<main sap><output text="1 + 1"></output></main>`;
  expect(Sap.plugins.ready(document)).toBe(null);

  Sap.plugins.declare({ name: "early", boundaries: { early: { opaque: true, on: "section" } } });
  let give;
  const prev = Sap.plugins.loader;
  Sap.plugins.loader = (name) => (name === "early" ? new Promise((r) => { give = () => r({ default: { name: "early", api: 1, boundaries: { early: { opaque: true, on: "section" } }, setup: () => ({ boundaries: { early(pass, el) { el.textContent = "painted"; } } }) } }); }) : prev(name));
  document.body.innerHTML = `<div early>not a section</div><section early>outside any app</section>`;
  expect(Sap.plugins.ready(document)).toBe(null);
  document.body.innerHTML = `<div early>not a section</div><main sap><section early>saved</section></main>`;
  Sap._reset();
  const waited = Sap.plugins.ready(document, 5000);
  expect(typeof waited.then).toBe("function");
  let done = false;
  waited.then(() => { done = true; });
  await tick(8);
  expect(done).toBe(false);
  give();
  await tick(12);
  expect(done).toBe(true);
  Sap.mount(document.querySelector("[sap]"));
  expect(document.querySelector("section").textContent).toBe("painted");

  Sap.plugins.declare({ name: "never", boundaries: { never: { opaque: true } } });
  Sap.plugins.loader = (name) => (name === "never" ? new Promise(() => {}) : prev(name));
  document.body.innerHTML = `<main sap><p never>saved</p></main>`;
  const t0 = Date.now();
  await Sap.plugins.ready(document, 30);
  expect(Date.now() - t0).toBeGreaterThanOrEqual(25);
  expect(Sap.plugins.has("never")).toBe(false);
  Sap.plugins.loader = prev;
});
