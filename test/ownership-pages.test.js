// Pages that use no plugin: every demo and worked app this project ships is mounted by
// the real engine, then walked and stripped by today's ownership file and by the 0.7.1
// one. The two must agree exactly, with no rule on the page and with a plugin's rules
// that match nothing.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as now from "../src/ownership.js";
import * as before from "./fixtures/ownership-0.7.1.js";
import { extractDemos as docDemos } from "./helpers/doc.js";
import { extractDemos as pageDemos } from "./helpers/index-doc.js";
import { Sap } from "./helpers/mount.js";

const GRID = [
  { within: "table[grid]", select: "td[f]", text: true },
  { within: "table[grid]", select: "td", attrs: ["n"] },
];
const guide = readFileSync(join(__dirname, "..", "guide.md"), "utf8");
const apps = [...guide.matchAll(/```html app=(\w+)\n([\s\S]*?)```/g)].map((m) => ({ id: m[1], markup: m[2] }));
const demos = [...docDemos(), ...pageDemos(), ...apps];

afterEach(() => {
  delete window.sapPlugins;
  document.body.innerHTML = "";
});

function mountAll(html) {
  document.body.innerHTML = `<div id="host">${html}</div>`;
  Sap._reset();
  for (const root of document.querySelectorAll("#host [sap]")) if (!root.parentElement.closest("[sap]")) Sap.mount(root);
  return document.querySelector("#host");
}

function painted(host, own) {
  const visits = [];
  own.eachPainted(host, (el, p) => visits.push([el, JSON.stringify(p)]));
  const perElement = [...host.querySelectorAll("*")].map((el) => JSON.stringify(own.paintsOf(el)));
  const attrs = [...host.querySelectorAll("*")].map((el) => [...el.attributes].filter((a) => own.ownsAttr(el, a.name)).map((a) => a.name).join(" "));
  const clone = host.cloneNode(true);
  own.stripPaints(clone);
  return { visits, perElement, attrs, stripped: clone.innerHTML };
}

test("unchanged: every demo is walked, asked and stripped exactly as 0.7.1 did, with and without an unrelated rule", () => {
  expect(apps.map((app) => app.id)).toEqual(["tracker", "kanban", "notes"]);
  expect(demos.length).toBeGreaterThan(30);
  let visits = 0;
  let asked = 0;
  let stripped = 0;
  for (const demo of demos) {
    const host = mountAll(demo.markup);
    const old = painted(host, before);
    expect(painted(host, now)).toEqual(old);
    window.sapPlugins = [{ name: "grid", ownership: GRID }];
    expect(painted(host, now)).toEqual(old);
    delete window.sapPlugins;
    visits += old.visits.length;
    asked += old.perElement.length;
    if (old.stripped !== host.innerHTML) stripped++;
  }
  expect(visits).toBeGreaterThan(70);
  expect(asked).toBeGreaterThan(500);
  expect(stripped).toBeGreaterThan(25);
});

test("unchanged: a page with a table[grid] and no rule on it is walked as 0.7.1 walked it", () => {
  const host = mountAll(`<main sap state="t" t="Budget"><h1 text="state.t">x</h1><table grid><tbody><tr><td n f="=A1" text="state.t">1</td><td n show="state.t">2</td></tr></tbody></table></main>`);
  const old = painted(host, before);
  expect(old.visits).toHaveLength(3);
  expect(painted(host, now)).toEqual(old);
  window.sapPlugins = [{ name: "grid", ownership: GRID }];
  expect(painted(host, now).visits.map(([el, p]) => [el.localName, p])).toEqual([
    ["h1", `{"attrs":[],"classes":[],"vars":[],"text":true}`],
    ["td", `{"attrs":["n"],"classes":[],"vars":[],"text":true}`],
    ["td", `{"attrs":["n"],"classes":[],"vars":[],"text":false}`],
  ]);
});
