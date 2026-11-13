// pass.changes: what the mutation bridge reported inside an app since its last pass, or
// null when the pass cannot say (mount, refresh, a report that had to be dropped). Every
// change is in exactly one pass's list, including one made after a pass was queued and
// one that replaces a text node. Sap.flush() settles what is queued in the same task.

import { mount, type, Sap } from "./helpers/mount.js";
import { registerFeature, unregisterFeature } from "../src/pass.js";
import { declareFacts, setInstalled } from "../src/registry.js";
import { withDomMutationPaused } from "../src/mutation-bridge.js";

const tick = async (n = 4) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

const name = (node) => node.id || node.localName;

function describeChange(c) {
  if (c.type === "attribute") return `attribute:${name(c.element)}@${c.attribute}`;
  if (c.type === "characterData") return `characterData:${name(c.element)}`;
  return `${c.type}:${name(c.element)}<${name(c.parent)}`;
}

const seen = [];
const probe = {
  name: "changes-probe",
  begin(pass) {
    seen.push({
      app: pass.root.id,
      changes: pass.changes && pass.changes.map(describeChange),
      full: pass.full,
      trigger: pass.trigger,
      list: pass.changes,
    });
  },
};

const passes = () => seen.map(({ changes, full, trigger }) => ({ changes, full, trigger }));

beforeEach(() => {
  seen.length = 0;
  registerFeature(probe);
});

afterEach(() => {
  unregisterFeature(probe);
  Sap._reset();
  delete window.hyperclay;
});

const PAGE = `<main sap id="app" state="n:num" n="1">
  <input id="title" bind="title" value="Workbook">
  <ul id="notes" items="notes"><li item data-id="a"><span id="first" bind="t">one</span></li></ul>
  <output id="out" text="state.notes.map((x) => x.t).join(',') + ' ' + state.n + ' ' + state.title">one 1 Workbook</output>
</main>`;

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html;
  return t.content.firstElementChild;
}

describe("what a pass is told", () => {
  test("mount and Sap.refresh() are full passes: changes is null", () => {
    mount(PAGE);
    expect(passes()).toEqual([{ changes: null, full: true, trigger: "mount" }]);
    Sap.refresh();
    expect(passes()[1]).toEqual({ changes: null, full: true, trigger: "refresh" });
  });

  test("a pass the DOM did not cause gets an empty list, not null", async () => {
    const root = mount(PAGE);
    type(root.querySelector("#title"), "Plan");
    await tick();
    expect(passes().slice(1)).toEqual([{ changes: [], full: false, trigger: "input title" }]);
    expect(Object.isFrozen(seen[1].list)).toBe(true);
    expect(root.querySelector("#out").textContent).toBe("one 1 Plan");
  });

  test("an attribute change names its element and its attribute", async () => {
    const root = mount(PAGE);
    root.setAttribute("n", "2");
    await tick();
    expect(passes().slice(1)).toEqual([{ changes: ["attribute:app@n"], full: false, trigger: "mutation" }]);
    expect(seen[1].list[0]).toEqual({ type: "attribute", element: root, attribute: "n" });
    expect(root.querySelector("#out").textContent).toBe("one 2 Workbook");
  });

  test("an edit to a text node is one characterData entry on its element", async () => {
    const root = mount(PAGE);
    root.querySelector("#first").firstChild.data = "seven";
    await tick();
    expect(passes().slice(1)).toEqual([{ changes: ["characterData:first"], full: false, trigger: "mutation" }]);
    expect(root.querySelector("#out").textContent).toBe("seven 1 Workbook");
  });

  test("text: replacing the text node with textContent is one characterData entry, and the page repaints", async () => {
    const root = mount(PAGE);
    const span = root.querySelector("#first");
    span.textContent = "five";
    await tick();
    expect(passes().slice(1)).toEqual([{ changes: ["characterData:first"], full: false, trigger: "mutation" }]);
    expect(seen[1].list[0]).toEqual({ type: "characterData", element: span });
    expect(root.querySelector("#out").textContent).toBe("five 1 Workbook");

    span.textContent = "";
    await tick();
    expect(passes()[2].changes).toEqual(["characterData:first"]);
    expect(root.querySelector("#out").textContent).toBe(" 1 Workbook");

    span.append("back");
    await tick();
    expect(passes()[3].changes).toEqual(["characterData:first"]);
    expect(root.querySelector("#out").textContent).toBe("back 1 Workbook");
  });

  test("text: a text change inside an ignored subtree is not reported", async () => {
    const root = mount(`<main sap id="app"><div sap-ignore><p id="p">kept</p></div><output text="1 + 1">2</output></main>`);
    root.querySelector("#p").textContent = "changed";
    await tick();
    expect(passes()).toHaveLength(1);
  });

  test("an added row lists the row and what is in it, each with the parent it was added to", async () => {
    const root = mount(PAGE);
    const list = root.querySelector("#notes");
    const row = el(`<li item id="row" data-id="b"><span id="second" bind="t">two</span></li>`);
    list.appendChild(row);
    await tick();
    expect(passes().slice(1)).toEqual([{ changes: ["add:row<notes", "add:second<notes"], full: false, trigger: "mutation" }]);
    expect(seen[1].list[0]).toEqual({ type: "add", element: row, parent: list });
    expect(root.querySelector("#out").textContent).toBe("one,two 1 Workbook");

    row.remove();
    await tick();
    expect(passes()[2].changes).toEqual(["remove:row<notes"]);
    expect(seen[2].list[0]).toEqual({ type: "remove", element: row, parent: list });
  });

  test("a row added inside an opaque boundary is exactly one entry", async () => {
    declareFacts({ name: "ledger", boundaries: { ledger: { opaque: true, on: "table" } } });
    setInstalled("ledger", true);
    try {
      const root = mount(`<main sap id="app"><table ledger><tbody id="body"></tbody></table></main>`);
      const row = el(`<table><tbody><tr id="row"><td><b>1</b></td><td>2</td></tr></tbody></table>`).querySelector("tr");
      root.querySelector("#body").appendChild(row);
      await tick();
      expect(passes().slice(1)).toEqual([{ changes: ["add:row<body"], full: false, trigger: "mutation" }]);
      row.firstElementChild.firstElementChild.textContent = "9";
      row.lastElementChild.setAttribute("f", "=A1");
      await tick();
      expect(passes()[2].changes).toEqual(["characterData:b", "attribute:td@f"]);
    } finally {
      setInstalled("ledger", false);
    }
  });

  test("each app gets the changes inside it and no others", async () => {
    document.body.innerHTML = `<main sap id="one" state="n:num" n="1"><b text="state.n">1</b></main><main sap id="two" state="n:num" n="1"><b text="state.n">1</b></main>`;
    Sap._reset();
    Sap.mount();
    seen.length = 0;
    document.querySelector("#one").setAttribute("n", "2");
    document.querySelector("#two").setAttribute("n", "3");
    document.querySelector("#two").setAttribute("data-x", "1");
    await tick();
    expect(seen.map((p) => [p.app, p.changes])).toEqual([
      ["one", ["attribute:one@n"]],
      ["two", ["attribute:two@n", "attribute:two@data-x"]],
    ]);
  });

  test("the engine's own writes never come back as changes", async () => {
    const root = mount(`<main sap id="app" state="n:num" n="1"><b id="b" text="state.n" attr:title="'n ' + state.n" class:big="state.n > 1"></b></main>`);
    root.setAttribute("n", "2");
    await tick();
    await new Promise((r) => setTimeout(r, 0));
    await tick();
    expect(root.querySelector("#b").outerHTML).toBe(`<b id="b" text="state.n" attr:title="'n ' + state.n" class:big="state.n > 1" title="n 2" class="big">2</b>`);
    expect(passes().slice(1)).toEqual([{ changes: ["attribute:app@n"], full: false, trigger: "mutation" }]);
  });
});

describe("every change is in exactly one pass", () => {
  // The browser hands records over on a microtask it queues at the first change. Mounting
  // queues one, so the tests wait it out: the pass must then be queued before any record.
  const settled = async () => {
    await tick();
    await new Promise((r) => setTimeout(r, 0));
  };

  test("queued: a change made after a pass was queued, in the same task, is in that pass's list", async () => {
    const root = mount(PAGE);
    await settled();
    type(root.querySelector("#title"), "Plan");
    root.querySelector("#first").setAttribute("data-mark", "1");
    root.setAttribute("n", "4");
    await tick();
    await new Promise((r) => setTimeout(r, 0));
    await tick();
    expect(passes().slice(1)).toEqual([{ changes: ["attribute:first@data-mark", "attribute:app@n"], full: false, trigger: "input title" }]);
    expect(root.querySelector("#out").textContent).toBe("one 4 Plan");
  });

  test("queued: a change in another app, found while a pass starts, queues that app's own pass", async () => {
    document.body.innerHTML = `<main sap id="one"><input id="title" bind="title" value="a"><b text="state.title">a</b></main><main sap id="two" state="n:num" n="1"><b text="state.n">1</b></main>`;
    Sap._reset();
    Sap.mount();
    await settled();
    seen.length = 0;
    type(document.querySelector("#title"), "b");
    document.querySelector("#two").setAttribute("n", "2");
    await settled();
    expect(seen.map((p) => [p.app, p.changes, p.trigger])).toEqual([
      ["one", [], "input title"],
      ["two", ["attribute:two@n"], "mutation"],
    ]);
    expect(document.querySelector("#two b").textContent).toBe("2");
  });

  test("queued: an app that waits for its turn gets one pass when an earlier pass delivers a change for it", async () => {
    document.body.innerHTML = `<main sap id="one"><input id="a" bind="a" value="a"><b text="state.a" effect="window.__hits.push('one')">a</b></main><main sap id="two" state="n:num" n="1"><input id="b" bind="b" value="b"><b text="state.n + state.b" effect="window.__hits.push('two')">1b</b></main>`;
    window.__hits = [];
    Sap._reset();
    Sap.mount();
    await settled();
    seen.length = 0;
    window.__hits.length = 0;
    type(document.querySelector("#a"), "x");
    type(document.querySelector("#b"), "y");
    document.querySelector("#two").setAttribute("n", "2");
    await settled();
    expect(seen.map((p) => [p.app, p.changes, p.trigger])).toEqual([
      ["one", [], "input a"],
      ["two", ["attribute:two@n"], "input b"],
    ]);
    expect(window.__hits).toEqual(["one", "two"]);
    expect(document.querySelector("#two b").textContent).toBe("2y");
    delete window.__hits;
  });

  test("queued: changes delivered in two batches before one pass are listed once each, in order", async () => {
    const root = mount(PAGE);
    root.setAttribute("n", "2");
    Sap.flush();
    seen.length = 0;
    root.setAttribute("n", "3");
    await Promise.resolve();
    root.querySelector("#first").setAttribute("data-mark", "1");
    await tick();
    await new Promise((r) => setTimeout(r, 0));
    const listed = seen.flatMap((p) => p.changes);
    expect(listed).toEqual(["attribute:app@n", "attribute:first@data-mark"]);
  });

  test("queued: a root added and mounted in the same task is mounted once", async () => {
    mount(PAGE);
    await settled();
    seen.length = 0;
    const second = el(`<main sap id="second" state="n:num" n="1"><b text="state.n">1</b></main>`);
    document.body.appendChild(second);
    Sap.mount(second);
    await settled();
    expect(seen.filter((p) => p.app === "second").map((p) => p.trigger)).toEqual(["mount"]);
    expect(Sap.status().apps.map((a) => a.root)).toEqual(["main[sap]", "main[sap]"]);
    second.setAttribute("n", "2");
    await tick();
    expect(seen.filter((p) => p.app === "second").map((p) => p.changes)).toEqual([null, ["attribute:second@n"]]);
  });

  test("queued: a root added while another app's pass was queued is still mounted", async () => {
    const root = mount(PAGE);
    await settled();
    type(root.querySelector("#title"), "Plan");
    const second = el(`<main sap id="second"><b text="1 + 1">saved</b></main>`);
    document.body.appendChild(second);
    await settled();
    expect(second.querySelector("b").textContent).toBe("2");
    expect(Sap.status().apps).toHaveLength(2);
  });

  test("queued: Sap.refresh() reaches every app when a queued change prunes one that left the page", async () => {
    document.body.innerHTML = `<main sap id="gone"><b text="1">1</b></main><main sap id="kept" state="n:num" n="1"><b text="state.n">1</b></main><main sap id="last" state="n:num" n="1"><b text="state.n">1</b></main>`;
    Sap._reset();
    Sap.mount();
    await settled();
    document.querySelector("#gone").remove();
    document.querySelector("#last").setAttribute("n", "2");
    Sap.refresh();
    expect(document.querySelector("#last b").textContent).toBe("2");
    expect(Sap.status().apps).toHaveLength(2);
  });

  test("a full pass drops the list it would have had", async () => {
    const root = mount(PAGE);
    root.setAttribute("n", "2");
    await Promise.resolve();
    Sap.refresh();
    await tick();
    expect(passes().slice(1)).toEqual([
      { changes: null, full: true, trigger: "refresh" },
      { changes: [], full: false, trigger: "mutation" },
    ]);
  });

  test("lost: after the loop breaker dropped reports, the next pass is told to read everything", async () => {
    const root = mount(`<main sap id="app" state="n:num" n="1">
      <input id="loop" bind="x" value="x" effect="el.dispatchEvent(new Event('input',{bubbles:true}))">
      <input id="qty" bind="qty" value="2">
      <output text="state.qty * state.n">2</output>
    </main>`);
    root.querySelector("#loop").dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));
    expect(Sap.report().errors.map((e) => e.code)).toContain("E26");
    seen.length = 0;
    root.setAttribute("n", "5");
    await tick();
    expect(seen).toEqual([]);
    root.querySelector("#loop").removeAttribute("effect");
    await tick();
    type(root.querySelector("#qty"), 3);
    await tick();
    expect(passes()[0]).toEqual({ changes: null, full: true, trigger: "input qty" });
    expect(root.querySelector("output").textContent).toBe("15");
    root.setAttribute("n", "6");
    await tick();
    expect(passes()[passes().length - 1]).toEqual({ changes: ["attribute:app@n"], full: false, trigger: "mutation" });
  });
});

describe("Sap.flush()", () => {
  test("flush: a queued change is delivered, listed and painted in the same task", () => {
    const root = mount(PAGE);
    root.setAttribute("n", "8");
    root.querySelector("#first").textContent = "now";
    expect(root.querySelector("#out").textContent).toBe("one 1 Workbook");
    expect(Sap.flush()).toBe(null);
    expect(root.querySelector("#out").textContent).toBe("now 8 Workbook");
    expect(passes().slice(1)).toEqual([{ changes: ["attribute:app@n", "characterData:first"], full: false, trigger: "mutation" }]);
  });

  test("flush: the pass it ran does not run again on the next microtask", async () => {
    const root = mount(PAGE);
    type(root.querySelector("#title"), "Plan");
    Sap.flush();
    expect(root.querySelector("#out").textContent).toBe("one 1 Plan");
    await tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(passes()).toHaveLength(2);
  });

  test("flush: with nothing queued it runs no pass", () => {
    mount(PAGE);
    expect(Sap.flush()).toBe(null);
    expect(passes()).toHaveLength(1);
  });

  test("flush: a pass queued by the pass it ran is settled too", () => {
    const root = mount(`<main sap id="app" state="n:num, seen:num" n="1" seen="0">
      <b effect="if (state.seen !== state.n) Sap(el).seen = state.n"></b>
      <output id="out" text="state.seen">0</output>
    </main>`);
    Sap.flush();
    root.setAttribute("n", "2");
    Sap.flush();
    expect(root.querySelector("#out").textContent).toBe("2");
    expect(root.getAttribute("seen")).toBe("2");
  });
});

describe("a root found while a pass was starting", () => {
  const settled = async () => {
    await tick();
    await new Promise((r) => setTimeout(r, 0));
    await tick();
  };

  test("flush: a root inserted before Sap.refresh() is mounted and painted by the Sap.flush() that follows", async () => {
    mount(PAGE);
    await settled();
    seen.length = 0;
    document.body.insertAdjacentHTML("beforeend", `<aside sap id="late"><b text="3 + 4">old</b></aside>`);
    Sap.refresh();
    expect(Sap.flush()).toBe(null);
    expect(document.querySelector("#late b").textContent).toBe("7");
    expect(Sap.status().apps).toHaveLength(2);
    await settled();
    expect(seen.filter((p) => p.app === "late").map((p) => p.trigger)).toEqual(["mount"]);
    expect(Sap.status().apps).toHaveLength(2);
  });

  test("flush: a root the page mounts itself is not mounted again by the Sap.flush() that follows", async () => {
    mount(PAGE);
    await settled();
    seen.length = 0;
    const second = el(`<main sap id="second" state="n:num" n="1"><b text="state.n">1</b></main>`);
    document.body.appendChild(second);
    Sap.mount(second);
    expect(Sap.flush()).toBe(null);
    await settled();
    expect(seen.filter((p) => p.app === "second").map((p) => p.trigger)).toEqual(["mount"]);
    expect(Sap.status().apps).toHaveLength(2);
  });

  test("flush: Sap.flush() called from inside a root's own mount pass does not mount that root again", async () => {
    mount(PAGE);
    await settled();
    seen.length = 0;
    const second = el(`<main sap id="second"><b effect="Sap.flush()"></b></main>`);
    document.body.appendChild(second);
    Sap.mount(second);
    await settled();
    expect(seen.filter((p) => p.app === "second").map((p) => p.trigger)).toEqual(["mount"]);
    expect(Sap.status().apps).toHaveLength(2);
  });
});

describe("what a pass writes is never a change", () => {
  const settled = async () => {
    await tick();
    await new Promise((r) => setTimeout(r, 0));
    await tick();
  };
  const twice = async (root) => {
    await settled();
    seen.length = 0;
    root.setAttribute("n", "2");
    await settled();
    root.setAttribute("n", "3");
    await settled();
  };
  const ONE = { changes: ["attribute:app@n"], full: false, trigger: "mutation" };

  test("own: a pause that begins inside a pass, as kit.write does, delivers none of that pass's writes", async () => {
    const inner = { name: "inner-pause", afterPaint(pass) { withDomMutationPaused(() => pass.root.setAttribute("data-inner", pass.root.getAttribute("n"))); } };
    registerFeature(inner);
    try {
      const root = mount(`<main sap id="app" state="n:num" n="1"><output id="out" text="state.n">1</output></main>`);
      await twice(root);
      expect(passes()).toEqual([ONE, ONE]);
      expect(root.querySelector("#out").textContent).toBe("3");
      expect(root.getAttribute("data-inner")).toBe("3");
    } finally {
      unregisterFeature(inner);
    }
  });

  test("own: Sap.flush() called from an effect delivers none of the writes of the pass that runs it", async () => {
    const root = mount(`<main sap id="app" state="n:num" n="1"><output id="out" text="state.n" effect="Sap.flush()">1</output></main>`);
    await twice(root);
    expect(passes()).toEqual([ONE, ONE]);
    expect(root.querySelector("#out").textContent).toBe("3");
  });

  // The pass that Sap.refresh() runs inside the first ends before the first does. A pause
  // that begins after it, still inside the first pass, has nothing of the page's to deliver.
  test("own: Sap.refresh() called from an effect runs its pass inside the first, and neither it nor a pause after it lists a write", async () => {
    const after = {
      name: "pause-after-effects",
      afterPaint(pass) {
        pass.root.setAttribute("data-seen", pass.root.getAttribute("n"));
        withDomMutationPaused(() => {});
      },
    };
    registerFeature(after);
    try {
      const root = mount(`<main sap id="app" state="n:num" n="1"><output id="out" text="state.n" effect="if (state.n === 2 &amp;&amp; !window.__again) { window.__again = true; Sap.refresh(); }">1</output></main>`);
      await twice(root);
      expect(passes()).toEqual([ONE, { changes: null, full: true, trigger: "refresh" }, ONE]);
      expect(root.querySelector("#out").textContent).toBe("3");
      expect(root.getAttribute("data-seen")).toBe("3");
    } finally {
      unregisterFeature(after);
      delete window.__again;
    }
  });

  test("own: a change the page made before a pause that is not inside a pass is still delivered", async () => {
    const root = mount(`<main sap id="app" state="n:num" n="1"><output id="out" text="state.n">1</output></main>`);
    await settled();
    seen.length = 0;
    root.setAttribute("n", "5");
    withDomMutationPaused(() => root.setAttribute("data-own", "1"));
    await settled();
    expect(passes()).toEqual([ONE]);
    expect(root.querySelector("#out").textContent).toBe("5");
  });
});

describe("under the platform's mutation hub", () => {
  function installHub() {
    let depth = 0;
    let subscriber = null;
    const deliver = (records) => {
      const changes = [];
      for (const rec of records) {
        if (rec.type === "attributes") changes.push({ type: "attribute", element: rec.target, attribute: rec.attributeName });
      }
      if (changes.length && subscriber) subscriber(changes);
    };
    const observer = new MutationObserver((records) => { if (!depth) deliver(records); });
    observer.observe(document.body, { subtree: true, attributes: true });
    const hub = {
      onAnyChange(opts, cb) { subscriber = cb; return () => { subscriber = null; observer.disconnect(); }; },
      pause() { if (!depth) deliver(observer.takeRecords()); depth++; },
      resume() { depth--; if (!depth) observer.takeRecords(); },
    };
    window.hyperclay = { Mutation: hub };
    return hub;
  }

  test("hub: the hub's changes reach pass.changes, and flush asks the hub to deliver", () => {
    const hub = installHub();
    const pause = jest.spyOn(hub, "pause");
    const root = mount(PAGE);
    seen.length = 0;
    root.setAttribute("n", "3");
    expect(Sap.flush()).toBe(null);
    expect(pause).toHaveBeenCalled();
    expect(passes()).toEqual([{ changes: ["attribute:app@n"], full: false, trigger: "mutation" }]);
    expect(root.querySelector("#out").textContent).toBe("one 3 Workbook");
  });
});

describe("what stays the same", () => {
  test("status: Sap.status() reports the same fields and the same last pass as before", async () => {
    const root = mount(PAGE);
    const view = () => Sap.status().apps[0];
    expect(Object.keys(view())).toEqual(["root", "fields", "calcs", "paints", "actions", "lists", "rows", "warnings", "errors", "mountWrites", "ms", "passes", "lastPass", "ok"]);
    expect(view().lastPass).toEqual({ trigger: "mount", writes: 0 });
    type(root.querySelector("#title"), "Plan");
    await tick();
    expect(view().lastPass).toEqual({ trigger: "refresh", writes: 1 });
    root.setAttribute("n", "2");
    await tick();
    expect(view().lastPass).toEqual({ trigger: "refresh", writes: 1 });
    expect(view().passes).toBe(2);
  });
});
