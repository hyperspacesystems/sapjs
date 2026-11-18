import { gridModel } from "../../src/grid/codec/read.js";
import { tableHtml } from "../../src/grid/codec/write.js";
import gridPlugin from "../../src/plugins/grid.js";
import Sap from "../../src/sap.js";

const TABLE = tableHtml(gridModel('<table grid><colgroup><col data-id="ca" data-pos="G"></colgroup><tbody><tr data-id="r1" data-pos="G"><td>a</td></tr></tbody></table>', 0));

afterEach(() => {
  Sap._reset();
  document.body.innerHTML = "";
});

test("Sap.grid gives a live Grid again after the page disposed the one it had", () => {
  Sap.use(gridPlugin);
  document.body.innerHTML = `<main sap><div items="sheets"><section item data-id="s"><h2 bind="name">S</h2>${TABLE}</section></div></main>`;
  Sap.mount(document.querySelector("[sap]"));
  const table = document.querySelector("table");
  const first = Sap.grid(table);
  first.dispose();
  const second = Sap.grid(table);
  const heard = [];
  second.on("change", (event) => heard.push(event.source));
  table.rows[0].cells[0].textContent = "b";
  Sap.flush();
  expect([second === first, second === Sap.grid(table), second.get("A1"), heard]).toEqual([false, true, "b", ["dom"]]);
});
