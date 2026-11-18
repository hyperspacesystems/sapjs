// The workbook backing of a page: the same tab actions as `modelWorkbook`, over live sections.

import { domBacking } from "./backing-dom.js";
import { tableHtml } from "./codec/write.js";
import { byPos } from "./workbook-backing.js";

// The tabs of a page: the `<section item>` children of `root`, each holding an `<h2 bind="name">`
// and a `<table grid>`. `mount(table, sheetId)` gives a tab's grid backing (a Grid's own, on a
// page); with none, the workbook makes a DOM backing per table, with `write` for its writes that
// are not edits. A tab insert, delete, rename or move is an edit the page records and saves, so
// it is never wrapped in `write`.
export function domWorkbook(root, { write = (fn) => fn(), mount = null } = {}) {
  const doc = root.ownerDocument;
  const made = new WeakMap();
  const backingOf = (table, id) => {
    if (mount) return mount(table, id);
    if (!made.has(table)) made.set(table, domBacking(table, { write, sheetId: id }));
    return made.get(table);
  };
  const sections = () => [...root.children].filter((el) => el.localName === "section" && el.hasAttribute("item"));
  const sectionOf = (id) => sections().find((el) => el.getAttribute("data-id") === id) ?? null;
  const nameOf = (section) => section.querySelector(":scope > [bind='name']");
  const tabOf = (section) => {
    const id = section.getAttribute("data-id");
    return { id, name: nameOf(section)?.textContent ?? "", pos: section.getAttribute("data-pos") ?? "", backing: backingOf(section.querySelector(":scope > table[grid]"), id) };
  };
  const keyOf = (el) => ({ id: el.getAttribute("data-id"), pos: el.getAttribute("data-pos") ?? "" });
  const place = (section) => {
    const others = sections().filter((el) => el !== section);
    const next = others.find((el) => byPos(keyOf(el), keyOf(section)) > 0) ?? null;
    root.insertBefore(section, next ?? others.at(-1)?.nextSibling ?? null);
  };
  return {
    sheets: () => sections().map(tabOf).sort(byPos),
    insertSheet({ id, name, pos, html }) {
      const section = doc.createElement("section");
      section.setAttribute("item", "");
      section.setAttribute("data-id", id);
      section.setAttribute("data-pos", pos);
      const title = doc.createElement("h2");
      title.setAttribute("bind", "name");
      title.textContent = name;
      const holder = doc.createElement("template");
      holder.innerHTML = html;
      section.append(title, holder.content.querySelector("table"));
      place(section);
    },
    deleteSheet(id) {
      const section = sectionOf(id);
      const tab = tabOf(section);
      const html = tableHtml(tab.backing.sheet);
      section.remove();
      return { id, name: tab.name, pos: tab.pos, html };
    },
    renameSheet(id, name) {
      nameOf(sectionOf(id)).textContent = name;
    },
    moveSheet(id, pos) {
      const section = sectionOf(id);
      section.setAttribute("data-pos", pos);
      place(section);
    },
  };
}
