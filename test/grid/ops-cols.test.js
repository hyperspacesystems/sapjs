import { contentOf, derive } from "../../src/grid/content.js";
import { apply, fits, needs, creates, targets, validate, GridRefused } from "../../src/grid/ops.js";
import { backing, bytesOf, keptEmpty, S, unstale } from "./support/ops-fixture.js";
import { modelBacking } from "../../src/grid/backing-model.js";
import { sheet } from "./support/sheets.js";

const plain = (options = {}) => backing({ formula: false, merge: false, ...options });
const sized = () => {
  const store = plain();
  store.putCol(store.colIndex("cc"), { width: 100 });
  return store;
};
const frozen = (options = {}) => {
  const store = plain(options);
  store.setFrozen({ cols: 2 });
  return store;
};
const merged = () => plain({ merge: true });
const guarded = () => backing();

const colsOf = (store) => store.cols().map((col) => col.id);

const insert = (cols) => ({ v: 1, t: "insertCols", sheet: S, cols });
const remove = (cols) => ({ v: 1, t: "deleteCols", sheet: S, cols });
const change = (cols) => ({ v: 1, t: "changeCols", sheet: S, cols });

const PINS = [
  [
    "insert at the start",
    {"v":1,"t":"insertCols","sheet":"items","cols":[{"id":"c0","pos":"5"}]},
    `<table grid><colgroup><col data-id="c0" data-pos="5"><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td></td><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td></td><td>Total</td><td></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td></td><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td></td><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td></td><td>Form</td><td n v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "insert in the middle",
    {"v":1,"t":"insertCols","sheet":"items","cols":[{"id":"c2b","pos":"H"}]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="c2b" data-pos="H"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td></td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td></td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "insert at the end",
    {"v":1,"t":"insertCols","sheet":"items","cols":[{"id":"c9","pos":"z"}]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"><col data-id="c9" data-pos="z"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "insert with cells and a width",
    {"v":1,"t":"insertCols","sheet":"items","cols":[{"id":"c2b","pos":"H","width":120,"cells":[["r1","new"],["r3",5]]}]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="c2b" data-pos="H" style="width:120px"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>new</td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "insert with a format",
    {"v":1,"t":"insertCols","sheet":"items","cols":[{"id":"c2b","pos":"H","fmt":"0.00","cells":[["r3",1.5]]}]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="c2b" data-pos="H" fmt="0.00"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td></td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td n v="1.5">1.50</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "delete the first column",
    {"v":1,"t":"deleteCols","sheet":"items","cols":["ca"]},
    `<table grid><colgroup><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Qty</td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td n v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "delete a middle column",
    {"v":1,"t":"deleteCols","sheet":"items","cols":["cc"]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td>Total</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "delete the last column",
    {"v":1,"t":"deleteCols","sheet":"items","cols":["cd"]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td></tr>
<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "delete two columns",
    {"v":1,"t":"deleteCols","sheet":"items","cols":["ca","cc"]},
    `<table grid><colgroup><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Qty</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"></tr>
<tr data-id="r3" data-pos="O"><td n>5</td></tr>
<tr data-id="r4" data-pos="V"><td n v="1200">1,200</td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td n v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "a move",
    {"v":1,"t":"changeCols","sheet":"items","cols":[{"id":"cc","pos":"8a"}]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cc" data-pos="8a"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Note</td><td>Qty</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td>Total</td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td fmt="0%">plain</td><td n>5</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td></td><td n v="1200">1,200</td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td></td><td n v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "a move to the end",
    {"v":1,"t":"changeCols","sheet":"items","cols":[{"id":"ca","pos":"z"}]},
    `<table grid><colgroup><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"><col data-id="ca" data-pos="z"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Qty</td><td>Note</td><td>Flag</td><td>Name</td></tr>
<tr data-id="r2" data-pos="G"><td></td><td n>7</td><td></td><td>Total</td></tr>
<tr data-id="r3" data-pos="O"><td n>5</td><td fmt="0%">plain</td><td></td><td>a</td></tr>
<tr data-id="r4" data-pos="V"><td n v="1200">1,200</td><td></td><td>TRUE</td><td style="font-weight:bold;color:#333333">Bold</td></tr>
<tr data-id="r5" data-pos="l"><td n v="1205">1,205</td><td></td><td></td><td>Form</td></tr>
</tbody></table>`,
  ],
  [
    "width set",
    {"v":1,"t":"changeCols","sheet":"items","cols":[{"id":"cc","width":120}]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O" style="width:120px"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "width changed",
    {"v":1,"t":"changeCols","sheet":"items","cols":[{"id":"cc","width":150}]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O" style="width:150px"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1,205</td></tr>
</tbody></table>`, sized,
  ],
  [
    "width removed",
    {"v":1,"t":"changeCols","sheet":"items","cols":[{"id":"cc","width":null}]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1,205</td></tr>
</tbody></table>`, sized,
  ],
  [
    "fmt set on a column of numbers",
    {"v":1,"t":"changeCols","sheet":"items","cols":[{"id":"cb","fmt":"0.00"}]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="0.00"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n v="5">5.00</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1200.00</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1205.00</td></tr>
</tbody></table>`,
  ],
  [
    "fmt removed from a column of numbers",
    {"v":1,"t":"changeCols","sheet":"items","cols":[{"id":"cb","fmt":null}]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n>1200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n>1205</td></tr>
</tbody></table>`,
  ],
  [
    "a set that brings one column",
    {"v":1,"t":"set","sheet":"items","cols":[{"id":"cz","pos":"z"}],"cells":[["r1","cz",5]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"><col data-id="cz" data-pos="z"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td><td n>5</td></tr>
<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "a set that brings a column in the middle",
    {"v":1,"t":"set","sheet":"items","cols":[{"id":"cz","pos":"H"}],"cells":[["r1","cz","new"]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cz" data-pos="H"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>new</td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td></td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "a set that brings a row and a column at once",
    {"v":1,"t":"set","sheet":"items","cols":[{"id":"cz","pos":"z"}],"rows":[{"id":"r9","pos":"z"}],"cells":[["r9","cz","new"]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"><col data-id="cz" data-pos="z"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1,205</td></tr>
<tr data-id="r9" data-pos="z"><td></td><td></td><td></td><td></td><td>new</td></tr>
</tbody></table>`,
  ],
];

const storeOf = (make) => (make ?? plain)();

for (const [name, action, bytes] of PINS) {
  test(`pinned: ${name}`, () => {
    const make = PINS.find(([one]) => one === name)[3];
    const store = storeOf(make);
    const out = apply(store, action, { derive });
    expect([name, out.out]).toEqual([name, "applied"]);
    expect([name, bytesOf(store)]).toEqual([name, bytes]);
    expect([name, keptEmpty(store.sheet)]).toEqual([name, []]);
  });
}

test("inverse restores the bytes", () => {
  for (const [name, action, bytes, make] of PINS) {
    const store = storeOf(make);
    const before = bytesOf(store);
    const out = apply(store, action, { derive });
    expect([name, out.out]).toEqual([name, "applied"]);
    const back = apply(store, out.inverse, { derive });
    expect([name, back.out]).toEqual([name, "applied"]);
    expect([name, unstale(bytesOf(store))]).toEqual([name, before]);
    const again = apply(store, back.inverse, { derive });
    expect([name, again.out]).toEqual([name, "applied"]);
    expect([name, bytesOf(store)]).toEqual([name, bytes]);
  }
});

test("fits agrees with apply", () => {
  for (const [name, action, , make] of PINS) {
    const read = storeOf(make);
    const before = bytesOf(read);
    const fit = fits(read, action);
    expect([name, bytesOf(read)]).toEqual([name, before]);
    const out = apply(storeOf(make), action, { derive });
    expect([name, fit === true]).toEqual([name, out.out === "applied"]);
  }
});

const cellsOf = (store) => {
  const map = new Map();
  store.rows().forEach((row) => {
    row.cells.forEach((cell, c) => {
      const col = store.cols()[c];
      const content = contentOf(cell);
      if (!col || content === null) return;
      map.set(`${row.id}/${col.id}`, content);
    });
  });
  return map;
};

test("cells follow their column", () => {
  const cases = [
    ["an insert", insert([{ id: "c2b", pos: "H", cells: [["r1", "new"], ["r4", 9]] }]), []],
    ["a delete", remove(["cb"]), ["r1/cb", "r3/cb", "r4/cb", "r5/cb"]],
    ["a move", change([{ id: "cc", pos: "8a" }]), []],
  ];
  for (const [name, action, gone] of cases) {
    const store = plain();
    const was = cellsOf(store);
    const out = apply(store, action, { derive });
    expect([name, out.out]).toEqual([name, "applied"]);
    const now = cellsOf(store);
    expect([name, [...was.keys()].filter((at) => !now.has(at))]).toEqual([name, gone]);
    for (const [at, content] of was) {
      if (!now.has(at)) continue;
      expect([name, at, now.get(at)]).toEqual([name, at, content]);
    }
  }
});

test("ties land in id order", () => {
  const store = plain();
  const out = apply(store, insert([{ id: "b", pos: "H" }, { id: "a", pos: "H" }]), { derive });
  expect(out.out).toBe("applied");
  expect(colsOf(store)).toEqual(["ca", "cb", "a", "b", "cc", "cd"]);
});

const formatted = () => {
  const store = plain();
  const c = store.colIndex("cb");
  store.putCell(store.rowIndex("r1"), c, derive(5, "#,##0"));
  store.putCell(store.rowIndex("r2"), c, { ...derive(0.5, "0%"), fmt: "0%" });
  store.putCell(store.rowIndex("r3"), c, derive("plain", null));
  store.putCell(store.rowIndex("r4"), c, derive({ f: "=SUM(B3:B4)" }, "#,##0", 1205));
  return store;
};

test("column format derives again", () => {
  const store = formatted();
  const before = bytesOf(store);
  const own = { ...store.cell(store.rowIndex("r2"), store.colIndex("cb")) };
  const out = apply(store, change([{ id: "cb", fmt: "0.00" }]), { derive });
  expect(out.out).toBe("applied");
  const at = (id) => store.cell(store.rowIndex(id), store.colIndex("cb"));
  expect(at("r1")).toEqual({ text: "5.00", n: true, v: "5" });
  expect(at("r2")).toEqual(own);
  expect(at("r3")).toEqual({ text: "plain" });
  expect(at("r4")).toEqual({ f: "=SUM(B3:B4)", text: "1205.00", n: true, v: "1205" });
  expect(out.changes.cols).toEqual([{ sheet: S, col: "cb", kind: "fmt" }]);
  expect(out.changes.cells.map((one) => one.row)).toEqual(["r1", "r3", "r4", "r5"]);
  for (const one of out.changes.cells) expect([one.row, one.before]).toEqual([one.row, one.after]);
  expect(out.inverse).toEqual({ v: 1, t: "changeCols", sheet: S, cols: [{ id: "cb", fmt: "#,##0" }] });
  const back = apply(store, out.inverse, { derive });
  expect(back.out).toBe("applied");
  expect(unstale(bytesOf(store))).toBe(before);
});

const DELETED = [
  ["a column with a number format", ["cb"], plain],
  ["a column with styled cells", ["ca"], plain],
  ["a column with a width", ["cc"], sized],
  ["a frozen column", ["ca"], frozen],
  ["the last and the first column", ["cd", "ca"], plain],
];

test("delete comes back whole", () => {
  for (const [name, ids, make] of DELETED) {
    const store = make();
    const before = bytesOf(store);
    const order = colsOf(store);
    const out = apply(store, remove(ids), { derive });
    expect([name, out.out]).toEqual([name, "applied"]);
    expect([name, out.inverse.t]).toEqual([name, "insertCols"]);
    expect([name, out.changes.cols.map((one) => one.kind)]).toEqual([name, ids.map(() => "delete")]);
    for (const id of ids) {
      const record = out.inverse.cols.find((one) => one.id === id);
      expect([name, Object.keys(record).includes("cells")]).toEqual([name, true]);
      expect([name, record.cells.some((cell) => cell[1] === null)]).toEqual([name, false]);
    }
    const back = apply(store, out.inverse, { derive });
    expect([name, back.out]).toEqual([name, "applied"]);
    expect([name, unstale(bytesOf(store))]).toEqual([name, before]);
    expect([name, colsOf(store)]).toEqual([name, order]);
    expect([name, store.frozen().cols]).toEqual([name, make().frozen().cols]);
  }
});

test("delete records the whole column", () => {
  const store = plain();
  const out = apply(store, remove(["cb"]), { derive });
  expect(out.inverse.cols).toEqual([
    {
      id: "cb",
      pos: "G",
      fmt: "#,##0",
      cells: [
        ["r1", "Qty", { fmt: null }],
        ["r3", 5, { fmt: null }],
        ["r4", 1200, { fmt: null }],
        ["r5", 1205, { fmt: null }],
      ],
    },
  ]);
  const styled = apply(plain(), remove(["ca"]), { derive });
  expect(styled.inverse.cols[0].cells.find((cell) => cell[0] === "r4")).toEqual(["r4", "Bold", { fmt: null, css: "font-weight:bold;color:#333333" }]);
  const wide = apply(sized(), remove(["cc"]), { derive });
  expect(wide.inverse.cols[0].width).toBe(100);
  const frozenGone = apply(frozen(), remove(["cb"]), { derive });
  expect(frozenGone.inverse.cols[0].frozen).toBe(true);
});

test("frozen", () => {
  const down = frozen();
  expect(down.frozen().cols).toBe(2);
  expect(apply(down, insert([{ id: "c1b", pos: "9" }]), { derive }).out).toBe("applied");
  expect(colsOf(down)).toEqual(["ca", "c1b", "cb", "cc", "cd"]);
  expect(down.frozen().cols).toBe(3);
  expect(bytesOf(down).slice(0, bytesOf(down).indexOf("</colgroup>")).includes('data-id="c1b"')).toBe(true);
  expect(bytesOf(down).startsWith('<table grid freeze-cols="3">')).toBe(true);

  const after = frozen();
  expect(apply(after, insert([{ id: "c2b", pos: "H" }]), { derive }).out).toBe("applied");
  expect(after.frozen().cols).toBe(2);
  expect(bytesOf(after).startsWith('<table grid freeze-cols="2">')).toBe(true);

  const gone = frozen();
  const before = bytesOf(gone);
  const out = apply(gone, remove(["ca"]), { derive });
  expect(out.out).toBe("applied");
  expect(gone.frozen().cols).toBe(1);
  expect(apply(gone, out.inverse, { derive }).out).toBe("applied");
  expect(gone.frozen().cols).toBe(2);
  expect(unstale(bytesOf(gone))).toBe(before);

  const moved = frozen();
  const move = apply(moved, change([{ id: "cc", pos: "8a" }]), { derive });
  expect(move.out).toBe("applied");
  expect(colsOf(moved)).toEqual(["ca", "cc", "cb", "cd"]);
  expect(moved.frozen().cols).toBe(2);
  expect(apply(moved, move.inverse, { derive }).out).toBe("applied");
  expect(colsOf(moved)).toEqual(["ca", "cb", "cc", "cd"]);
  expect(moved.frozen().cols).toBe(2);

  const past = frozen();
  expect(apply(past, insert([{ id: "cz", pos: "z", frozen: true }]), { derive }).code).toBe("bad_action");
  expect(apply(past, insert([{ id: "c2b", pos: "H", frozen: true }]), { derive }).out).toBe("applied");
  expect(past.frozen().cols).toBe(3);
});

test("formula guard", () => {
  const middling = [
    ["an insert in the middle", insert([{ id: "cm", pos: "H" }])],
    ["a delete in the middle", remove(["cc"])],
    ["a move", change([{ id: "cc", pos: "z" }])],
    ["a set that brings a column in the middle", { v: 1, t: "set", sheet: S, cols: [{ id: "cm", pos: "H" }], cells: [["r1", "cm", 1]] }],
  ];
  for (const [name, action] of middling) {
    const store = guarded();
    const before = bytesOf(store);
    expect([name, fits(store, action).code]).toEqual([name, "needs_formula_engine"]);
    const out = apply(store, action, { derive });
    expect([name, out.out, out.code]).toEqual([name, "refused", "needs_formula_engine"]);
    expect([name, bytesOf(store)]).toEqual([name, before]);
    expect([name, apply(guarded(), action, { derive, formulas: {} }).out]).toEqual([name, "applied"]);
  }
  for (const [name, action] of [["an insert at the end", insert([{ id: "cz", pos: "z" }])], ["a delete of the last column", remove(["cd"])]]) {
    const store = guarded();
    expect([name, fits(store, action)]).toEqual([name, true]);
    expect([name, apply(store, action, { derive }).out]).toEqual([name, "applied"]);
  }
  const open = guarded();
  expect(fits(open, insert([{ id: "cm", pos: "H" }]), { formulas: {} })).toBe(true);
});

const FOLLOWED = [
  [
    "cols insert",
    { v: 1, t: "insertCols", sheet: S, cols: [{ id: "cm", pos: "8a" }] },
    `<table grid><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cm\" data-pos=\"8a\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td></td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td colspan=\"3\">Total</td><td hidden></td><td hidden></td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td>a</td><td></td><td n>5</td><td fmt=\"0%\">plain</td></tr>\n<tr data-id=\"r4\" data-pos=\"V\"><td style=\"font-weight:bold;color:#333333\">Bold</td><td></td><td n v=\"1200\">1,200</td><td></td><td>TRUE</td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td></td><td n v=\"1205\">1,205</td></tr>\n</tbody></table>`,
  ],
  [
    "cols delete anchor",
    { v: 1, t: "deleteCols", sheet: S, cols: ["ca"] },
    `<table grid><colgroup><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td>Total</td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td n>5</td><td fmt=\"0%\">plain</td></tr>\n<tr data-id=\"r4\" data-pos=\"V\"><td n v=\"1200\">1,200</td><td></td><td>TRUE</td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td n v=\"1205\">1,205</td></tr>\n</tbody></table>`,
  ],
  [
    "cols delete covered",
    { v: 1, t: "deleteCols", sheet: S, cols: ["cb"] },
    `<table grid><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td>Total</td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td>a</td><td fmt=\"0%\">plain</td></tr>\n<tr data-id=\"r4\" data-pos=\"V\"><td style=\"font-weight:bold;color:#333333\">Bold</td><td></td><td>TRUE</td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td></tr>\n</tbody></table>`,
  ],
];

const CUTTING = [
  ["a move of its column", change([{ id: "cb", pos: "z" }])],
  ["a move that would split it", change([{ id: "cd", pos: "8a" }])],
];

test("merges follow columns", () => {
  for (const [name, action, bytes] of FOLLOWED) {
    const store = merged();
    const before = bytesOf(store);
    expect([name, fits(store, action)]).toEqual([name, true]);
    const out = apply(store, action, { derive });
    expect([name, out.out]).toEqual([name, "applied"]);
    expect([name, bytesOf(store)]).toEqual([name, bytes]);
    expect([name, keptEmpty(store.sheet)]).toEqual([name, []]);
    const back = apply(store, out.inverse, { derive });
    expect([name, back.out]).toEqual([name, "applied"]);
    expect([name, unstale(bytesOf(store))]).toEqual([name, before]);
  }
  for (const [name, action] of CUTTING) {
    const store = merged();
    const before = bytesOf(store);
    const fit = fits(store, action);
    expect([name, fit === true ? true : fit.code]).toEqual([name, "merge_cut"]);
    const out = apply(store, action, { derive });
    expect([name, out.out, out.code]).toEqual([name, "refused", "merge_cut"]);
    expect([name, bytesOf(store)]).toEqual([name, before]);
  }
  const clear = merged();
  expect(apply(clear, insert([{ id: "cm", pos: "H" }]), { derive }).out).toBe("applied");
  expect(colsOf(clear)).toEqual(["ca", "cb", "cm", "cc", "cd"]);
});

const REFUSED = [
  ["a key that is not a key", insert([{ id: "c0", pos: "0" }]), "bad_key"],
  ["a moved key that is not a key", change([{ id: "cc", pos: "0" }]), "bad_key"],
  ["a hidden column", insert([{ id: "c0", pos: "5", hidden: true }]), "bad_action"],
  ["a hidden change", change([{ id: "cc", hidden: true }]), "bad_action"],
  ["a width of minus one", insert([{ id: "c0", pos: "5", width: -1 }]), "bad_action"],
  ["a width that is not a whole number", change([{ id: "cc", width: 1.5 }]), "bad_action"],
  ["a fmt longer than 255 characters", change([{ id: "cc", fmt: "0".repeat(256) }]), "bad_action"],
  ["a change that changes nothing", change([{ id: "cc" }]), "bad_action"],
  ["a missing row in an inserted column", insert([{ id: "c0", pos: "5", cells: [["r9", "x"]] }]), "missing_row"],
  ["a span on an inserted cell", insert([{ id: "c0", pos: "5", cells: [["r1", "x", { colspan: 2 }]] }]), "merge_cut"],
  ["a delete of a column that is not there", remove(["cz"]), "missing_col"],
];

test("refusals", () => {
  for (const [name, action, code] of REFUSED) {
    const store = plain();
    const before = bytesOf(store);
    const out = apply(store, action, { derive });
    expect([name, out.out, out.code]).toEqual([name, "refused", code]);
    expect([name, bytesOf(store)]).toEqual([name, before]);
  }
});

test("exists", () => {
  for (const id of ["cc", "r3"]) {
    const store = plain();
    const before = bytesOf(store);
    const out = apply(store, insert([{ id, pos: "z" }]), { derive });
    expect([id, out.out, out.code]).toEqual([id, "refused", "exists"]);
    expect([id, bytesOf(store)]).toEqual([id, before]);
  }
});

test("invalid actions", () => {
  const invalid = [
    ["the same column deleted twice", remove(["cc", "cc"])],
    ["the same record brought twice", insert([{ id: "c0", pos: "5" }, { id: "c0", pos: "6" }])],
    ["a frozen that is not a boolean", insert([{ id: "c0", pos: "5", frozen: "yes" }])],
    ["an unknown field on a record", insert([{ id: "c0", pos: "5", height: 4 }])],
    ["a fmt that is not text", insert([{ id: "c0", pos: "5", fmt: 5 }])],
    ["a delete with no cols", remove([])],
    ["a change with no cols", change([])],
    ["a cell with no content", insert([{ id: "c0", pos: "5", cells: [["r1"]] }])],
  ];
  for (const [name, action] of invalid) {
    let caught = null;
    try {
      validate(action);
    } catch (err) {
      caught = err;
    }
    expect([name, caught instanceof GridRefused]).toEqual([name, true]);
    expect([name, caught.code]).toEqual([name, "bad_action"]);
  }
});

test("needs, creates, targets", () => {
  const brought = insert([{ id: "c0", pos: "5", width: 100, cells: [["r1", "x", { fmt: "0.0", style: { color: "red" } }], ["r3", 1]] }]);
  expect(needs(brought)).toEqual({ rows: ["r1", "r3"], cols: [] });
  expect(creates(brought)).toEqual({ rows: [], cols: ["c0"] });
  expect(targets(brought)).toEqual([
    [S, "col", "c0", "exists"],
    [S, "r1", "c0", "content"],
    [S, "r1", "c0", "fmt"],
    [S, "r1", "c0", "style:color"],
    [S, "r3", "c0", "content"],
  ]);

  expect(needs(remove(["cc"]))).toEqual({ rows: [], cols: ["cc"] });
  expect(creates(remove(["cc"]))).toEqual({ rows: [], cols: [] });
  expect(targets(remove(["cc"]))).toEqual([[S, "col", "cc", "exists"]]);

  const moved = change([{ id: "cc", pos: "9" }, { id: "cd", width: 20 }, { id: "ca", fmt: "0.0" }]);
  expect(needs(moved)).toEqual({ rows: [], cols: ["cc", "cd", "ca"] });
  expect(creates(moved)).toEqual({ rows: [], cols: [] });
  expect(targets(moved)).toEqual([
    [S, "col", "cc", "pos"],
    [S, "col", "cd", "width"],
    [S, "col", "ca", "fmt"],
  ]);
});

test("a changeCols to the current custom format changes no text", () => {
  const model = sheet({
    cols: [["c1", "8"], ["c2", "G"]],
    rows: [["r1", "8", [{ text: "12.3k", n: true, v: "12345" }]], ["r2", "G", ["a"]]],
  });
  model.cols[0].fmt = '0.0,"k"';
  const store = modelBacking(model, { sheetId: S });
  const before = bytesOf(store);
  const out = apply(store, { v: 1, t: "changeCols", sheet: S, cols: [{ id: "c1", fmt: '0.0,"k"' }] }, { derive });
  expect(out.out).toBe("applied");
  expect(bytesOf(store)).toBe(before);
});
