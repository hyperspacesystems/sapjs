// `{{x}}` in text halts the app with E02, because sapjs has no moustache templates and
// the author meant an expression. Text the engine never treats as a template is left
// alone: what a person typed into a record, and a sap-ignore subtree.

import { mount, Sap } from "./helpers/mount.js";

const report = (root) => ({
  errors: Sap.report().errors.map((e) => [e.code, e.el]),
  halted: !!Sap._registry.get(root).halted,
  out: root.querySelector("output").textContent,
});

describe("moustaches in bound text are content", () => {
  test("bound: text typed into a record does not halt, and the record holds it", () => {
    const root = mount(`<main sap><p bind="note">{{todo}} and {{ more }}</p><output text="state.note">saved</output></main>`);
    expect(report(root)).toEqual({ errors: [], halted: false, out: "{{todo}} and {{ more }}" });
    expect(root.querySelector("p").textContent).toBe("{{todo}} and {{ more }}");
  });

  test("bound: the same inside a row, inside markup a person typed into an editable element, and in a textarea", () => {
    const root = mount(`<main sap>
      <ul items="rows"><li item data-id="a"><span bind="t">{{a}}</span></li></ul>
      <div bind="body" contenteditable>see <b>{{ nested }}</b></div>
      <textarea bind="draft">{{typed}}</textarea>
      <output text="state.rows[0].t + '|' + state.body + '|' + state.draft">saved</output>
    </main>`);
    expect(report(root)).toEqual({ errors: [], halted: false, out: "{{a}}|see {{ nested }}|{{typed}}" });
  });

  test("unbound: a moustache in any other text still halts, and names the element", () => {
    for (const [html, at] of [
      [`<main sap><p>{{ x }}</p><output text="1 + 1">saved</output></main>`, "main[sap] > p"],
      [`<main sap><p text="state.a">{{x}}</p><output text="1 + 1">saved</output></main>`, "main[sap] > p"],
      [`<main sap><p bind="a">{{fine}}</p><h2>{{x}}</h2><output text="1 + 1">saved</output></main>`, "main[sap] > h2"],
      [`<main sap>{{x}}<output text="1 + 1">saved</output></main>`, "main[sap]"],
    ]) {
      expect(report(mount(html))).toEqual({ errors: [["E02", at]], halted: true, out: "saved" });
    }
  });
});

describe("moustaches in a sap-ignore subtree are not the engine's", () => {
  test("ignored: another library's template inside sap-ignore does not halt the app", () => {
    const root = mount(`<main sap><div sap-ignore><p>{{ msg }}</p><ul><li>{{ item.name }}</li></ul></div><output text="1 + 1">saved</output></main>`);
    expect(report(root)).toEqual({ errors: [], halted: false, out: "2" });
    expect(root.querySelector("p").textContent).toBe("{{ msg }}");
  });

  test("ignored: text beside the subtree still halts", () => {
    const root = mount(`<main sap><div sap-ignore><p>{{ msg }}</p></div><p>{{ x }}</p><output text="1 + 1">saved</output></main>`);
    expect(report(root)).toEqual({ errors: [["E02", "main[sap] > p"]], halted: true, out: "saved" });
  });
});
