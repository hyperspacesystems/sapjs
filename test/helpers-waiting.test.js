// Expression helpers a plugin adds, and the waiting rule. A helper is in scope of every
// expression without becoming a 14th argument. While a plugin that is known has not
// installed, an app with an expression that calls one of its helpers reads its records
// and paints nothing: the file keeps the values it was saved with.

import { mount, type, Sap } from "./helpers/mount.js";
import { compile, run, setHelpers, waitsFor, isHelperName } from "../src/compile.js";
import { dropPlans } from "../src/plan.js";
import { dropReads } from "../src/read-cache.js";
import { registerFeature, unregisterFeature } from "../src/pass.js";

const tick = async (n = 4) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

const ARGS = ["state", "item", "el", "root", "fmt", "num", "sum", "count", "avg", "min", "max", "plural", "days"];
const GRID = new Map([["cell", "grid"], ["range", "grid"]]);

// What the plugin host does when the set of helpers changes.
function helpers(installed = {}, pending = new Map()) {
  setHelpers(installed, pending);
  dropPlans();
  dropReads();
}

let last = null;
const probe = { name: "waiting-probe", begin(pass) { last = pass; } };

beforeEach(() => {
  last = null;
  registerFeature(probe);
});

afterEach(() => {
  unregisterFeature(probe);
  helpers();
  Sap._reset();
  delete window.cell;
  delete window.range;
  delete window.pageMath;
  delete window.__ran;
});

describe("helpers", () => {
  test("signature: a compiled function has 13 parameters with and without helpers", () => {
    expect(compile("state.a + 1").fn.length).toBe(13);
    helpers({ twice: (n) => n * 2, cell: () => 5 });
    const entry = compile("twice(state.a) + cell()");
    expect(entry.fn.length).toBe(13);
    expect(run(entry, { state: { a: 4 }, item: null, root: {} })).toBe(13);
    expect(compile("el.id = String(twice(3))", true).fn.length).toBe(13);
  });

  test("unchanged path: with no helper the compiler makes the same function it always made", () => {
    const made = jest.spyOn(globalThis, "Function");
    try {
      compile("state.unchanged + 1");
      expect(made.mock.calls).toEqual([[...ARGS, '"use strict"; return (state.unchanged + 1);']]);
      compile("el.unchanged = 1", true);
      expect(made.mock.calls[1]).toEqual([...ARGS, '"use strict";\nel.unchanged = 1']);

      made.mockClear();
      helpers({}, GRID);
      compile("state.unchanged + 2");
      expect(made.mock.calls).toEqual([[...ARGS, '"use strict"; return (state.unchanged + 2);']]);

      made.mockClear();
      helpers({ twice: (n) => n * 2 });
      compile("state.unchanged + 3");
      expect(made.mock.calls).toEqual([["twice", `return function(${ARGS.join(",")}){"use strict"; return (state.unchanged + 3);\n}`]]);
    } finally {
      made.mockRestore();
    }
  });

  test("a helper is in scope of every kind of expression", async () => {
    helpers({ twice: (n) => n * 2 });
    const root = mount(`<main sap state="n:num" n="4">
      <b id="calc" calc:d="twice(state.n)" text="state.d">8</b>
      <b id="attr" attr:title="'x' + twice(1)" class:big="twice(state.n) > 4" title="x2" class="big">t</b>
      <ul id="each" each="[twice(1), twice(2)]" key="String(twice(item))"><template><li text="item"></li></template></ul>
      <input id="q" bind="q" value="9" invalid="twice(state.q) > 10 &amp;&amp; 'too big'">
      <b effect="window.__ran = twice(state.n)"></b>
      <button id="set" set:n="twice(state.n)">double</button>
    </main>`);
    expect(Sap.report().errors).toEqual([]);
    expect(Sap.status().apps[0].mountWrites).toBe(0);
    expect([...root.querySelectorAll("#each li")].map((li) => li.textContent)).toEqual(["2", "4"]);
    expect(root.querySelector("#q").validationMessage).toBe("too big");
    expect(window.__ran).toBe(8);
    root.querySelector("#set").click();
    await tick();
    expect(root.querySelector("#calc").textContent).toBe("16");
    expect(root.getAttribute("n")).toBe("8");
  });

  test("a helper that throws is reported like any failing expression", () => {
    helpers({ boom: () => { throw new Error("no"); } });
    mount(`<main sap><b text="boom()">kept</b></main>`);
    expect(Sap.report().errors.map((e) => e.code)).toEqual(["E24"]);
    expect(document.querySelector("b").textContent).toBe("kept");
  });

  test("frozen: the 13 argument names are never helper names, and a helper name is a plain name", () => {
    for (const name of ARGS) expect([name, isHelperName(name)]).toEqual([name, false]);
    for (const name of ["a-b", "1st", "x y", "a(b", "a.b", "", "a, b", "a = 1", "...a", "{ a }", "$x"]) expect([name, isHelperName(name)]).toEqual([name, false]);
    for (const name of ["cell", "range", "_x", "ok_1", "Cell"]) expect([name, isHelperName(name)]).toEqual([name, true]);
  });

  test("reserved: a word the language keeps from being a parameter is never a helper name", () => {
    const reserved = ["default", "class", "function", "return", "new", "delete", "typeof", "void", "in", "if", "for", "var", "const", "this", "null", "true", "false", "super", "enum", "import", "export"];
    const strict = ["let", "static", "yield", "eval", "arguments", "implements", "interface", "package", "private", "protected", "public"];
    for (const name of [...reserved, ...strict]) expect([name, isHelperName(name)]).toEqual([name, false]);
    for (const name of ["defaults", "classy", "returns", "lets", "of", "async", "get", "set"]) expect([name, isHelperName(name)]).toEqual([name, true]);
  });

  test("globals: a name the browser or the page already has as a global is never a helper name", () => {
    for (const name of ["Number", "Math", "Date", "String", "JSON", "Object", "parseInt", "isNaN", "NaN", "undefined", "window", "document", "setTimeout", "toString", "Sap"]) {
      expect([name, isHelperName(name)]).toEqual([name, false]);
    }
    expect(isHelperName("pageThing")).toBe(true);
    for (const value of [(n) => n, { a: 1 }, 7, "", null, undefined]) {
      window.pageThing = value;
      expect([String(value), isHelperName("pageThing")]).toEqual([String(value), false]);
    }
    delete window.pageThing;
    expect(isHelperName("pageThing")).toBe(true);
  });

  test("globals: an element the browser lists under its id does not take a helper name", () => {
    document.body.innerHTML = `<input type="range" id="range"><form name="cell"></form>`;
    expect(window.range).toBe(document.getElementById("range"));
    expect(isHelperName("range")).toBe(true);
    expect(isHelperName("cell")).toBe(true);
    helpers({}, GRID);
    expect(waitsFor("range(1)")).toBe("grid");
  });
});

describe("which expressions wait", () => {
  test("calls: only a plain call to a pending helper waits", () => {
    expect(waitsFor("cell('A1')")).toBe(null);
    helpers({}, GRID);
    for (const src of ["cell('A1')", "1 + cell ('A1')", "sum(range('A1:A3'))", "!cell(1)", "[cell(1)]", "x=>cell(x)"]) expect(waitsFor(src)).toBe("grid");
    for (const src of ["state.cell(1)", "mycell(1)", "$cell(1)", "cellar(1)", "state.cell", "cell", "item.range (1)", "_range(1)"]) expect(waitsFor(src)).toBe(null);
    expect(compile("cell('A1') + 1").waits).toBe("grid");
    expect(compile("state.n + 1").waits).toBe(null);
  });

  test("calls: a helper of an installed plugin is not waited for", () => {
    helpers({ cell: () => 1 }, new Map([["range", "grid"]]));
    expect(waitsFor("cell(1)")).toBe(null);
    expect(waitsFor("range(1)")).toBe("grid");
  });

  test("taken: a pending name that already means something is not waited for", () => {
    helpers({ cell: () => 1 }, new Map([["sum", "bad"], ["state", "bad"], ["cell", "other"], ["a(b", "bad"], ["range", "grid"]]));
    for (const src of ["sum(state.rows, 'n')", "state(1)", "cell(1)", "a(b(1)"]) expect(waitsFor(src)).toBe(null);
    expect(waitsFor("range(1)")).toBe("grid");
    const root = mount(`<main sap><ul items="rows"><li item data-id="a" state="n:num" n="2"></li></ul><output text="sum(state.rows, 'n') + cell()">saved</output></main>`);
    expect(root.querySelector("output").textContent).toBe("3");
  });

  test("global: a function the page defines under the same name is the page's, and nothing waits", async () => {
    window.cell = (n) => n + 3;
    helpers({}, GRID);
    expect(waitsFor("cell(1)")).toBe(null);
    expect(waitsFor("range(1)")).toBe("grid");
    const root = mount(`<main sap state="n:num" n="4"><output text="cell(state.n)">saved</output></main>`);
    expect(root.querySelector("output").textContent).toBe("7");
    expect(last.waiting.size).toBe(0);
    expect(Sap.report().errors).toEqual([]);
  });
});

describe("which expressions wait: strings and later globals", () => {
  test("strings: a helper name inside a string literal is not a call", () => {
    helpers({}, GRID);
    for (const src of [
      "'Date range (' + state.from + ')'",
      '"Date range (" + state.from + ")"',
      "'cell(1)'",
      "state.label + ': range (' + state.n + ')'",
      "'it\\'s a range (' + state.n",
      '"say \\"cell (\\" now"',
      "`Date range (${state.from})`",
      "`cell(1)`",
      "state.note || 'no cell (yet)'",
    ]) expect([src, waitsFor(src)]).toEqual([src, null]);
  });

  test("strings: a call beside or between string literals still waits", () => {
    helpers({}, GRID);
    for (const src of [
      "'Total: ' + cell('A1')",
      "cell('range (')",
      "'a' + 'b' + range('A1:A3') + 'c'",
      '"x" + cell("A1")',
      "'it\\'s ' + cell(1)",
      "`${cell('A1')} items`",
      "`it's ${cell('A1')}`",
      "state.ok ? 'range (' : range(1)",
    ]) expect([src, waitsFor(src)]).toEqual([src, "grid"]);
  });

  test("strings: an app whose text only names a pending helper inside a string paints", () => {
    helpers({}, GRID);
    const root = mount(`<main sap state="from" from="May"><output text="'Date range (' + state.from + ')'">saved</output></main>`);
    expect(root.querySelector("output").textContent).toBe("Date range (May)");
    expect(last.waiting.size).toBe(0);
    expect(Sap.report().errors).toEqual([]);
  });

  test("later: a function the page defines after the helper was declared is the page's, and nothing waits", () => {
    helpers({}, GRID);
    expect(waitsFor("cell(1) + range(2)")).toBe("grid");
    window.cell = (n) => n + 3;
    expect(waitsFor("cell(1)")).toBe(null);
    expect(waitsFor("cell(1) + range(2)")).toBe("grid");
    window.range = (n) => n * 2;
    expect(waitsFor("cell(1) + range(2)")).toBe(null);
    const root = mount(`<main sap state="n:num" n="4"><output text="cell(state.n) + range(state.n)">saved</output></main>`);
    expect(root.querySelector("output").textContent).toBe("15");
    expect(last.waiting.size).toBe(0);
    expect(Sap.report().errors).toEqual([]);
  });
});

describe("which expressions wait: template text after a hole", () => {
  test("holes: template text after a hole is text, whatever it holds", () => {
    helpers({}, GRID);
    for (const src of [
      "`${state.n} items in range (all)`",
      "`${state.a} cell(1) ${state.b} range (2)`",
      "`${state.a}${state.b} range (${state.c}) cell(2)`",
      "`${state.a}` + `${state.b} cell(1)`",
      "`a ${ `b ${state.c} cell(1)` } range (d)`",
      "`${ {a: 1}.a } range (x)`",
      "`${ {a: `cell(1)`}.a } cell(1)`",
      "`${ [1].map((v) => { return v; }) } range (x)`",
      "`${ (() => { return `${1} cell(1)` })() } range (2)`",
      "`${'}'} range (1)`",
      "`\\${ range (1) }`",
      "`a \\` range (1)`",
      "({a: 1}).a + ` range (x)`",
      "[1].map((v) => { return v }) + ` in range (all)`",
      "{ if (state.a) { el.title = `${state.a} range (x)` } }",
    ]) expect([src, waitsFor(src)]).toEqual([src, null]);
  });

  test("holes: a call after template text, or in a later hole, still waits", () => {
    helpers({}, GRID);
    for (const src of [
      "`${state.n}: ` + cell(1) + ` units`",
      "`${state.name}'s total: ` + String(cell('B2'))",
      "`${state.a} and ${cell(1)}`",
      "`${state.a}${state.b}'${cell(1)}`",
      "`${state.a} it's ${state.b} ` + range(2)",
      "`${state.a}` + `${state.b}'` + cell(1)",
      "`a ${ `b ${cell(1)} c` } d`",
      "`${ {a: 1}.a + cell(1) } x`",
      "`${ {a: 1}.a } x` + cell(1)",
      "`${ {a: `x`}.a }` + cell(1)",
      "`${ [1].map((v) => { return v; }) } it's` + cell(1)",
      "`${'}'}` + cell(1)",
      "`\\${` + cell(1)",
      "`a \\` b` + cell(1)",
      "'}' + cell(1) + `'`",
    ]) expect([src, waitsFor(src)]).toEqual([src, "grid"]);
  });

  test("braces: a } that ends an object or a block is followed by code, also before a template", () => {
    helpers({}, GRID);
    for (const src of [
      "({a: 1}).a + cell(1) + `x`",
      "[1].map((v) => { return `${v}'` }) + cell(1)",
      "{ if (state.a) { el.title = `${state.a}'s` } cell(1) }",
    ]) expect([src, waitsFor(src)]).toEqual([src, "grid"]);
  });

  test("spread: a call whose result is spread still waits, and a spread member does not", () => {
    helpers({}, GRID);
    for (const src of ["Math.max(...range('A1:A9'))", "[...range('A1:A3'), 1]", "sum(...cell('A1'))", "[... range(1)]"]) expect([src, waitsFor(src)]).toEqual([src, "grid"]);
    for (const src of ["[...state.range(1)]", "[...state.rows].length", "Math.max(...item.cell(2))"]) expect([src, waitsFor(src)]).toEqual([src, null]);
  });

  test("holes: an app whose label names a helper in template text after a hole paints", () => {
    helpers({}, GRID);
    const root = mount('<main sap state="n:num" n="3"><output text="`${state.n} items in range (all)`">saved</output><b text="state.n">saved</b></main>');
    expect(root.querySelector("output").textContent).toBe("3 items in range (all)");
    expect(root.querySelector("b").textContent).toBe("3");
    expect(last.waiting.size).toBe(0);
    expect(Sap.report().errors).toEqual([]);
  });

  test("holes: an app that calls a helper after template text waits, and paints once the helper is there", async () => {
    helpers({}, GRID);
    const root = mount(`<main sap state="n:num" n="3">
      <output id="a" text="\`\${state.n}: \` + cell(1) + \` units\`">saved</output>
      <output id="b" text="\`\${state.n}'s total: \` + String(cell('B2'))">saved</output>
      <b text="state.n">saved</b><input id="title" bind="title" value="t">
    </main>`);
    expect([...last.waiting]).toEqual(["grid"]);
    expect(root.querySelector("#a").textContent).toBe("saved");
    expect(root.querySelector("#b").textContent).toBe("saved");
    expect(root.querySelector("b").textContent).toBe("saved");
    expect(Sap.report().errors).toEqual([]);

    helpers({ cell: (ref) => (ref === "B2" ? 40 : 5), range: () => [] });
    type(root.querySelector("#title"), "typed");
    await tick();
    expect(root.querySelector("#a").textContent).toBe("3: 5 units");
    expect(root.querySelector("#b").textContent).toBe("3's total: 40");
    expect(root.querySelector("b").textContent).toBe("3");
    expect(Sap.report().errors).toEqual([]);
  });
});

describe("a page global defined after the first read", () => {
  test("refresh: a function the page defines after mount releases the app on the next refresh", () => {
    helpers({}, new Map([["pageMath", "math"]]));
    const root = mount(`<main sap state="n:num" n="3"><output text="pageMath(state.n)">saved</output><b text="state.n">saved</b></main>`);
    expect(root.querySelector("output").textContent).toBe("saved");
    expect(root.querySelector("b").textContent).toBe("saved");
    expect([...last.waiting]).toEqual(["math"]);

    window.pageMath = (n) => n * 2;
    Sap.refresh();
    expect(last.waiting.size).toBe(0);
    expect(root.querySelector("output").textContent).toBe("6");
    expect(root.querySelector("b").textContent).toBe("3");
    expect(Sap.report().errors).toEqual([]);
  });

  test("cache: an entry that waits is read again when it is next asked for, and any other entry is kept", () => {
    helpers({}, GRID);
    expect(compile("state.n + 1")).toBe(compile("state.n + 1"));
    const waiting = compile("cell(1) + 1");
    expect(waiting.waits).toBe("grid");
    expect(compile("cell(1) + 1").waits).toBe("grid");

    window.cell = (n) => n + 3;
    const free = compile("cell(1) + 1");
    expect(free.waits).toBe(null);
    expect(compile("cell(1) + 1")).toBe(free);
    expect(run(free, { state: {}, item: null, root: {} })).toBe(5);
  });
});

describe("the waiting rule", () => {
  const PAGE = `<main sap state="n:num" n="4">
    <output id="a" text="cell('A1')">7</output>
    <output id="b" text="state.n + 1" attr:title="'n' + state.n">saved</output>
    <input id="title" bind="title" value="t">
    <ul items="notes"><li item data-id="x"><span bind="t">one</span><b text="item.t + cell('B1')">row</b></li></ul>
  </main>`;

  test("stop: an app with a pending helper keeps every saved value and reports nothing", async () => {
    helpers({}, GRID);
    document.body.innerHTML = PAGE;
    const saved = document.querySelector("[sap]").outerHTML;
    const root = mount(PAGE);
    expect(root.outerHTML).toBe(saved);
    expect([...last.waiting]).toEqual(["grid"]);
    expect(Sap.report().errors).toEqual([]);
    expect(Sap.report().warnings).toEqual([]);
    expect(Sap.status().apps[0]).toMatchObject({ ok: true, errors: 0, warnings: 0, mountWrites: 0 });

    type(root.querySelector("#title"), "typed");
    await tick();
    root.setAttribute("n", "9");
    await tick();
    Sap.refresh();
    expect(root.querySelector("#a").textContent).toBe("7");
    expect(root.querySelector("#b").outerHTML).toBe(`<output id="b" text="state.n + 1" attr:title="'n' + state.n">saved</output>`);
    expect(root.querySelector("li b").textContent).toBe("row");
    expect(Sap.report().errors).toEqual([]);
    expect(root.querySelector("#title").value).toBe("typed");
  });

  test("stop: once the helper is there, one ordinary pass paints everything", async () => {
    helpers({}, GRID);
    const root = mount(PAGE);
    root.setAttribute("n", "9");
    await tick();
    expect(root.querySelector("#b").textContent).toBe("saved");

    helpers({ cell: (ref) => (ref === "A1" ? 12 : "!"), range: () => [] });
    type(root.querySelector("#title"), "typed");
    await tick();
    expect(last.full).toBe(false);
    expect(last.waiting.size).toBe(0);
    expect(root.querySelector("#a").textContent).toBe("12");
    expect(root.querySelector("#b").textContent).toBe("10");
    expect(root.querySelector("#b").getAttribute("title")).toBe("n9");
    expect(root.querySelector("li b").textContent).toBe("one!");
    expect(Sap.report().errors).toEqual([]);
  });

  test("stop: an app that calls no pending helper paints, beside one that waits", () => {
    helpers({}, GRID);
    document.body.innerHTML = `<main sap id="waits"><output text="cell('A1') + 1">saved</output></main><main sap id="free" state="n:num" n="4"><output text="state.n + 1">saved</output></main>`;
    Sap._reset();
    Sap.mount();
    expect(document.querySelector("#waits output").textContent).toBe("saved");
    expect(document.querySelector("#free output").textContent).toBe("5");
  });

  const WHERE = {
    "calc:": {
      html: `<b id="it" calc:total="cell('A1') * 2" text="state.total">saved</b>`,
      after: (root) => expect(root.querySelector("#it").textContent).toBe("24"),
    },
    each: {
      html: `<ul id="it" each="range('A1:A2')" key="item"><template><li text="item"></li></template></ul>`,
      after: (root) => expect([...root.querySelectorAll("#it li")].map((li) => li.textContent)).toEqual(["a", "b"]),
    },
    "each key": {
      html: `<ul id="it" each="['a', 'b']" key="item + cell('A1')"><template><li text="item"></li></template></ul>`,
      after: (root) => expect([...root.querySelectorAll("#it li")].map((li) => li.textContent)).toEqual(["a", "b"]),
    },
    detail: {
      html: `<ul items="notes"><li item data-id="12"><span bind="t">one</span></li></ul><section id="it" detail="notes by cell('A1')" hidden><b text="item.t">saved</b></section>`,
      after: (root) => {
        expect(root.querySelector("#it").hidden).toBe(false);
        expect(root.querySelector("#it b").textContent).toBe("one");
      },
    },
    effect: {
      html: `<b id="it" effect="window.__ran = cell('A1')"></b>`,
      before: () => expect(window.__ran).toBeUndefined(),
      after: () => expect(window.__ran).toBe(12),
    },
    invalid: {
      html: `<input id="it" bind="q" value="1" invalid="cell('A1') > 3 &amp;&amp; 'too big'">`,
      before: (root) => expect(root.querySelector("#it").validationMessage).toBe(""),
      after: (root) => expect(root.querySelector("#it").validationMessage).toBe("too big"),
    },
  };

  test.each(Object.keys(WHERE))("where: a pending call inside %s stops the app the same way", async (name) => {
    const { html, before, after } = WHERE[name];
    const page = `<main sap state="n:num" n="4">${html}<output id="other" text="state.n + 1">saved</output><input id="title" bind="title" value="t"></main>`;
    helpers({}, GRID);
    document.body.innerHTML = page;
    const saved = document.querySelector("[sap]").outerHTML;
    const root = mount(page);
    type(root.querySelector("#title"), "typed");
    await tick();
    expect(root.outerHTML).toBe(saved);
    expect([...last.waiting]).toEqual(["grid"]);
    expect(Sap.report().errors).toEqual([]);
    expect(Sap.report().warnings).toEqual([]);
    if (before) before(root);

    helpers({ cell: () => 12, range: () => ["a", "b"] });
    type(root.querySelector("#title"), "again");
    await tick();
    expect(root.querySelector("#other").textContent).toBe("5");
    expect(Sap.report().errors).toEqual([]);
    after(root);
  });
});
