// Workbook backings: the tabs of a sheet file, each with its own grid backing, so tab actions
// are written once and run on the model (the room, the admitted copy, tests) and on the page
// (`workbook-dom.js`, the one that touches the DOM).
// A tab's `pos` is an order key (`codec/order-keys.js`); keys compare as plain strings.

import { modelBacking } from "./backing-model.js";
import { gridModel } from "./codec/read.js";
import { tableHtml } from "./codec/write.js";

// Tabs order by key, then by id, so two tabs given one key (two people adding a tab at the end at
// the same moment) keep one order on every replica.
export const byPos = (a, b) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// sheets: [{ id, name, pos, sheet }] with `sheet` a grid model.
export function modelWorkbook(sheets) {
  const tabs = sheets.map(({ id, name, pos, sheet }) => ({ id, name, pos, backing: modelBacking(sheet, { sheetId: id }) })).sort(byPos);
  const find = (id) => tabs.find((tab) => tab.id === id) ?? null;
  const place = (tab) => {
    const at = tabs.findIndex((one) => byPos(one, tab) > 0);
    tabs.splice(at === -1 ? tabs.length : at, 0, tab);
  };
  return {
    sheets: () => tabs.map(({ id, name, pos, backing }) => ({ id, name, pos, backing })),
    insertSheet({ id, name, pos, html }) {
      place({ id, name, pos, backing: modelBacking(gridModel(html, 0), { sheetId: id }) });
    },
    deleteSheet(id) {
      const tab = find(id);
      tabs.splice(tabs.indexOf(tab), 1);
      return { id: tab.id, name: tab.name, pos: tab.pos, html: tableHtml(tab.backing.sheet) };
    },
    renameSheet(id, name) {
      find(id).name = name;
    },
    moveSheet(id, pos) {
      const tab = find(id);
      tabs.splice(tabs.indexOf(tab), 1);
      tab.pos = pos;
      place(tab);
    },
  };
}
