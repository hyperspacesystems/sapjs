import { derive } from "../../src/grid/content.js";
import { apply, fits, needs, creates, targets, validate, GridRefused } from "../../src/grid/ops.js";
import { backing, bytesOf, keptEmpty, S, unstale } from "./support/ops-fixture.js";

const plain = (options = {}) => backing({ formula: false, merge: false, ...options });
const frozen = (options = {}) => plain({ frozen: 2, ...options });
const styled = (options = {}) => plain({ rowStyles: { r3: "height:30px;background:#eee" }, ...options });
const merged = () => plain({ rowspan: true });
const guarded = () => backing();

const rowsOf = (store) => store.rows().map((row) => row.id);

const PINS = [
  [
    "insert at the top",
    {"v":1,"t":"insertRows","sheet":"items","rows":[{"id":"r0","pos":"5"}]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>\n<tbody>\n<tr data-id="r0" data-pos="5"></tr>\n<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td n>7</td></tr>\n<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>\n<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>\n<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1,205</td></tr>\n</tbody></table>`,
  ],
  [
    "insert in the middle",
    {"v":1,"t":"insertRows","sheet":"items","rows":[{"id":"r2b","pos":"H"}]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td n>7</td></tr>\n<tr data-id="r2b" data-pos="H"></tr>\n<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>\n<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>\n<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1,205</td></tr>\n</tbody></table>`,
  ],
  [
    "insert at the end",
    {"v":1,"t":"insertRows","sheet":"items","rows":[{"id":"r9","pos":"z"}]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td n>7</td></tr>\n<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>\n<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>\n<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1,205</td></tr>\n<tr data-id="r9" data-pos="z"></tr>\n</tbody></table>`,
  ],
  [
    "insert with cells",
    {"v":1,"t":"insertRows","sheet":"items","rows":[{"id":"r2b","pos":"H","cells":[["ca","new"],["cb",1234]]}]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td n>7</td></tr>\n<tr data-id="r2b" data-pos="H"><td>new</td><td n v="1234">1,234</td></tr>\n<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>\n<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>\n<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1,205</td></tr>\n</tbody></table>`,
  ],
  [
    "insert with a height",
    {"v":1,"t":"insertRows","sheet":"items","rows":[{"id":"r2b","pos":"H","height":32}]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td n>7</td></tr>\n<tr data-id="r2b" data-pos="H" style="height:32px"></tr>\n<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>\n<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>\n<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1,205</td></tr>\n</tbody></table>`,
  ],
  [
    "insert with a style and a height",
    {"v":1,"t":"insertRows","sheet":"items","rows":[{"id":"r2b","pos":"H","style":"background:#eee","height":32}]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td n>7</td></tr>\n<tr data-id="r2b" data-pos="H" style="height:32px;background:#eee"></tr>\n<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>\n<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>\n<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1,205</td></tr>\n</tbody></table>`,
  ],
  [
    "delete the first row",
    {"v":1,"t":"deleteRows","sheet":"items","rows":["r1"]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>\n<tbody>\n<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td n>7</td></tr>\n<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>\n<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>\n<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1,205</td></tr>\n</tbody></table>`,
  ],
  [
    "delete the middle row",
    {"v":1,"t":"deleteRows","sheet":"items","rows":["r3"]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td n>7</td></tr>\n<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>\n<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1,205</td></tr>\n</tbody></table>`,
  ],
  [
    "delete the last row",
    {"v":1,"t":"deleteRows","sheet":"items","rows":["r5"]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td n>7</td></tr>\n<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>\n<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>\n</tbody></table>`,
  ],
  [
    "delete two rows",
    {"v":1,"t":"deleteRows","sheet":"items","rows":["r2","r4"]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>\n<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1,205</td></tr>\n</tbody></table>`,
  ],
  [
    "a move to the end",
    {"v":1,"t":"changeRows","sheet":"items","rows":[{"id":"r1","pos":"m"}]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>\n<tbody>\n<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td n>7</td></tr>\n<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>\n<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>\n<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1,205</td></tr>\n<tr data-id="r1" data-pos="m"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n</tbody></table>`,
  ],
  [
    "a move up",
    {"v":1,"t":"changeRows","sheet":"items","rows":[{"id":"r5","pos":"9"}]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id="r5" data-pos="9"><td>Form</td><td n v="1205">1,205</td></tr>\n<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td n>7</td></tr>\n<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>\n<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>\n</tbody></table>`,
  ],
  [
    "a move and a height in one record",
    {"v":1,"t":"changeRows","sheet":"items","rows":[{"id":"r2","pos":"9","height":20}]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id="r2" data-pos="9" style="height:20px"><td>Total</td><td></td><td n>7</td></tr>\n<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>\n<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>\n<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1,205</td></tr>\n</tbody></table>`,
  ],
  [
    "a height set",
    {"v":1,"t":"changeRows","sheet":"items","rows":[{"id":"r3","height":24}]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td n>7</td></tr>\n<tr data-id="r3" data-pos="O" style="height:24px"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>\n<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>\n<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1,205</td></tr>\n</tbody></table>`,
  ],
  [
    "a height changed",
    {"v":1,"t":"changeRows","sheet":"items","rows":[{"id":"r3","height":40}]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td n>7</td></tr>\n<tr data-id="r3" data-pos="O" style="height:40px;background:#eee"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>\n<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>\n<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1,205</td></tr>\n</tbody></table>`,
    styled,
  ],
  [
    "a height removed",
    {"v":1,"t":"changeRows","sheet":"items","rows":[{"id":"r3","height":null}]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td n>7</td></tr>\n<tr data-id="r3" data-pos="O" style="background:#eee"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>\n<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>\n<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1,205</td></tr>\n</tbody></table>`,
    styled,
  ],
  [
    "a height set on a row with a style",
    {"v":1,"t":"changeRows","sheet":"items","rows":[{"id":"r3","height":52}]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td n>7</td></tr>\n<tr data-id="r3" data-pos="O" style="height:52px;background:#eee"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>\n<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>\n<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1,205</td></tr>\n</tbody></table>`,
    styled,
  ],
  [
    "a set that brings one row at the end",
    {"v":1,"t":"set","sheet":"items","rows":[{"id":"r9","pos":"z"}],"cells":[["r9","ca","new"]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td n>7</td></tr>\n<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>\n<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>\n<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1,205</td></tr>\n<tr data-id="r9" data-pos="z"><td>new</td></tr>\n</tbody></table>`,
  ],
  [
    "a set that brings two rows at the end",
    {"v":1,"t":"set","sheet":"items","rows":[{"id":"r8","pos":"z"},{"id":"r9","pos":"zz"}],"cells":[["r8","cb",1],["r9","ca","x"]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td n>7</td></tr>\n<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>\n<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>\n<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1,205</td></tr>\n<tr data-id="r8" data-pos="z"><td></td><td n>1</td></tr>\n<tr data-id="r9" data-pos="zz"><td>x</td></tr>\n</tbody></table>`,
  ],
  [
    "a set that brings a row in the middle of the cells",
    {"v":1,"t":"set","sheet":"items","rows":[{"id":"r9","pos":"z"}],"cells":[["r1","cc","wide"],["r9","ca","new"]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>wide</td><td>Flag</td></tr>\n<tr data-id="r2" data-pos="G"><td>Total</td><td></td><td n>7</td></tr>\n<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>\n<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>\n<tr data-id="r5" data-pos="l"><td>Form</td><td n v="1205">1,205</td></tr>\n<tr data-id="r9" data-pos="z"><td>new</td></tr>\n</tbody></table>`,
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

  const gate = {
    v: 1,
    t: "batch",
    actions: [
      { v: 1, t: "insertCols", sheet: S, cols: [{ id: "cy", pos: "z", cells: [["r1", { f: "=A1+1" }]] }] },
      { v: 1, t: "insertCols", sheet: S, cols: [{ id: "cx", pos: "H" }] },
    ],
  };
  const store = plain();
  const before = bytesOf(store);
  const fit = fits(store, gate);
  expect(fit.code).toBe("needs_formula_engine");
  const out = apply(store, gate, { derive });
  expect([out.out, out.code]).toEqual(["refused", "needs_formula_engine"]);
  expect(bytesOf(store)).toBe(before);
});

const insert = (rows) => ({ v: 1, t: "insertRows", sheet: S, rows });
const remove = (rows) => ({ v: 1, t: "deleteRows", sheet: S, rows });
const change = (rows) => ({ v: 1, t: "changeRows", sheet: S, rows });

test("ties land in id order", () => {
  const store = plain();
  const out = apply(store, insert([{ id: "b", pos: "H" }, { id: "a", pos: "H" }]), { derive });
  expect(out.out).toBe("applied");
  expect(rowsOf(store)).toEqual(["r1", "r2", "a", "b", "r3", "r4", "r5"]);
  const tie = apply(store, insert([{ id: "b2", pos: "H" }]), { derive });
  expect(tie.out).toBe("applied");
  expect(rowsOf(store)).toEqual(["r1", "r2", "a", "b", "b2", "r3", "r4", "r5"]);
});

test("exists", () => {
  for (const id of ["r3", "ca"]) {
    const store = plain();
    const before = bytesOf(store);
    const out = apply(store, insert([{ id, pos: "z" }]), { derive });
    expect([id, out.out, out.code]).toEqual([id, "refused", "exists"]);
    expect([id, bytesOf(store)]).toEqual([id, before]);
  }
});

const DELETED = [
  ["a row with its own cell format", ["r3"], plain],
  ["a row with a number in the #,##0 column", ["r4"], plain],
  ["a row with a hand-written style", ["r3"], styled],
  ["a frozen row", ["r1"], frozen],
  ["another frozen row", ["r2"], frozen],
  ["the first and a middle row", ["r1", "r4"], plain],
  ["a row holding a formula with a stored result", ["r5"], guarded],
];

test("delete comes back whole", () => {
  for (const [name, ids, make] of DELETED) {
    const store = make();
    const before = bytesOf(store);
    const order = rowsOf(store);
    const out = apply(store, remove(ids), { derive });
    expect([name, out.out]).toEqual([name, "applied"]);
    expect([name, out.inverse.t]).toEqual([name, "insertRows"]);
    expect([name, out.changes.rows.map((one) => one.kind)]).toEqual([name, ids.map(() => "delete")]);
    for (const id of ids) {
      const record = out.inverse.rows.find((one) => one.id === id);
      expect([name, Object.keys(record).includes("cells")]).toEqual([name, true]);
      expect([name, record.cells.some((cell) => cell[1] === null)]).toEqual([name, false]);
    }
    const back = apply(store, out.inverse, { derive });
    expect([name, back.out]).toEqual([name, "applied"]);
    expect([name, unstale(bytesOf(store))]).toEqual([name, before]);
    expect([name, rowsOf(store)]).toEqual([name, order]);
    expect([name, store.frozen().rows]).toEqual([name, make().frozen().rows]);
  }
});

test("delete records the whole row", () => {
  const store = styled();
  const out = apply(store, remove(["r3"]), { derive });
  expect(out.inverse.rows).toEqual([
    {
      id: "r3",
      pos: "O",
      style: "height:30px;background:#eee",
      cells: [
        ["ca", "a", { fmt: null }],
        ["cb", 5, { fmt: null }],
        ["cc", "plain", { fmt: "0%" }],
      ],
    },
  ]);
  const frozenStore = frozen();
  const gone = apply(frozenStore, remove(["r2"]), { derive });
  expect(gone.inverse.rows[0].frozen).toBe(true);
});

test("frozen", () => {
  const down = frozen();
  expect(down.frozen().rows).toBe(2);
  expect(apply(down, insert([{ id: "r1b", pos: "9" }]), { derive }).out).toBe("applied");
  expect(rowsOf(down)).toEqual(["r1", "r1b", "r2", "r3", "r4", "r5"]);
  expect(down.frozen().rows).toBe(3);
  expect(bytesOf(down).slice(0, bytesOf(down).indexOf("</thead>")).includes('data-id="r1b"')).toBe(true);

  const after = frozen();
  expect(apply(after, insert([{ id: "r2b", pos: "H" }]), { derive }).out).toBe("applied");
  expect(after.frozen().rows).toBe(2);
  expect(bytesOf(after).slice(0, bytesOf(after).indexOf("</thead>")).includes('data-id="r2b"')).toBe(false);

  const gone = frozen();
  const before = bytesOf(gone);
  const out = apply(gone, remove(["r1"]), { derive });
  expect(out.out).toBe("applied");
  expect(gone.frozen().rows).toBe(1);
  expect(apply(gone, out.inverse, { derive }).out).toBe("applied");
  expect(gone.frozen().rows).toBe(2);
  expect(unstale(bytesOf(gone))).toBe(before);

  const moved = frozen();
  const move = apply(moved, change([{ id: "r3", pos: "8a" }]), { derive });
  expect(move.out).toBe("applied");
  expect(rowsOf(moved)).toEqual(["r1", "r3", "r2", "r4", "r5"]);
  expect(moved.frozen().rows).toBe(2);
  expect(apply(moved, move.inverse, { derive }).out).toBe("applied");
  expect(rowsOf(moved)).toEqual(["r1", "r2", "r3", "r4", "r5"]);
  expect(moved.frozen().rows).toBe(2);

  const past = frozen();
  expect(apply(past, insert([{ id: "r9", pos: "z", frozen: true }]), { derive }).code).toBe("bad_action");
  expect(apply(past, insert([{ id: "r2b", pos: "H", frozen: true }]), { derive }).out).toBe("applied");
  expect(past.frozen().rows).toBe(3);
});

test("formula guard", () => {
  const middling = [
    ["an insert in the middle", insert([{ id: "rm", pos: "H" }])],
    ["a delete in the middle", remove(["r3"])],
    ["a move", change([{ id: "r4", pos: "9" }])],
    ["a set that brings a row in the middle", { v: 1, t: "set", sheet: S, rows: [{ id: "rm", pos: "H" }], cells: [["rm", "ca", 1]] }],
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
  for (const [name, action] of [["an insert at the end", insert([{ id: "rz", pos: "z" }])], ["a delete of the last row", remove(["r5"])]]) {
    const store = guarded();
    expect([name, fits(store, action)]).toEqual([name, true]);
    expect([name, apply(store, action, { derive }).out]).toEqual([name, "applied"]);
  }
  const tail = guarded();
  const beforeTail = bytesOf(tail);
  const block = remove(["r4", "r5"]);
  expect(fits(tail, block)).toBe(true);
  const cut = apply(tail, block, { derive });
  expect(cut.out).toBe("applied");
  const returned = apply(tail, cut.inverse, { derive });
  expect(returned.out).toBe("applied");
  expect(unstale(bytesOf(tail))).toBe(beforeTail);
  const first = plain();
  const beforeFirst = bytesOf(first);
  const bring = insert([{ id: "rm", pos: "H", cells: [["cb", { f: "=SUM(B3:B4)" }]] }]);
  expect(fits(first, bring)).toBe(true);
  const brought = apply(first, bring, { derive });
  expect(brought.out).toBe("applied");
  expect(bytesOf(first)).toContain('<tr data-id="rm" data-pos="H"><td></td><td f="=SUM(B3:B4)"></td>');
  const undone = apply(first, brought.inverse, { derive });
  expect(undone.out).toBe("applied");
  expect(unstale(bytesOf(first))).toBe(beforeFirst);
  const open = guarded();
  expect(fits(open, insert([{ id: "rm", pos: "H" }]), { formulas: {} })).toBe(true);
});

const FOLLOWED = [
  [
    "rows insert",
    { v: 1, t: "insertRows", sheet: S, rows: [{ id: "rm", pos: "U" }] },
    `<table grid><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td>Total</td><td></td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td rowspan=\"3\">a</td><td n>5</td><td fmt=\"0%\">plain</td></tr>\n<tr data-id=\"rm\" data-pos=\"U\"><td hidden></td></tr>\n<tr data-id=\"r4\" data-pos=\"V\"><td hidden></td><td n v=\"1200\">1,200</td><td></td><td>TRUE</td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td n v=\"1205\">1,205</td></tr>\n</tbody></table>`,
  ],
  [
    "rows delete",
    { v: 1, t: "deleteRows", sheet: S, rows: ["r3"] },
    `<table grid><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td>Total</td><td></td><td n>7</td></tr>\n<tr data-id=\"r4\" data-pos=\"V\"><td>a</td><td n v=\"1200\">1,200</td><td></td><td>TRUE</td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td n v=\"1205\">1,205</td></tr>\n</tbody></table>`,
  ],
  [
    "rows move",
    { v: 1, t: "changeRows", sheet: S, rows: [{ id: "r4", pos: "W" }] },
    `<table grid><colgroup><col data-id=\"ca\" data-pos=\"8\"><col data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"><col data-id=\"cc\" data-pos=\"O\"><col data-id=\"cd\" data-pos=\"V\"></colgroup>\n<tbody>\n<tr data-id=\"r1\" data-pos=\"8\"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id=\"r2\" data-pos=\"G\"><td>Total</td><td></td><td n>7</td></tr>\n<tr data-id=\"r3\" data-pos=\"O\"><td rowspan=\"2\">a</td><td n>5</td><td fmt=\"0%\">plain</td></tr>\n<tr data-id=\"r4\" data-pos=\"W\"><td hidden></td><td n v=\"1200\">1,200</td><td></td><td>TRUE</td></tr>\n<tr data-id=\"r5\" data-pos=\"l\"><td>Form</td><td n v=\"1205\">1,205</td></tr>\n</tbody></table>`,
  ],
];

test("merges follow rows", () => {
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
});

const REFUSED = [
  ["a key that is not a key", insert([{ id: "r0", pos: "0" }]), "bad_key"],
  ["a moved key that is not a key", change([{ id: "r3", pos: "0" }]), "bad_key"],
  ["a hidden row", insert([{ id: "r0", pos: "5", hidden: true }]), "bad_action"],
  ["a hidden change", change([{ id: "r3", hidden: true }]), "bad_action"],
  ["a height of zero", insert([{ id: "r0", pos: "5", height: 0 }]), "bad_action"],
  ["a height that is not a whole number", change([{ id: "r3", height: 1.5 }]), "bad_action"],
  ["a change that changes nothing", change([{ id: "r3" }]), "bad_action"],
  ["a missing column in an inserted row", insert([{ id: "r0", pos: "5", cells: [["cz", "x"]] }]), "missing_col"],
  ["a span on an inserted cell", insert([{ id: "r0", pos: "5", cells: [["ca", "x", null, 2]] }]), "merge_cut"],
  ["a colspan in an inserted cell", insert([{ id: "r0", pos: "5", cells: [["ca", "x", { colspan: 2 }]] }]), "merge_cut"],
  ["a delete of a row that is not there", remove(["r9"]), "missing_row"],
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

test("invalid actions", () => {
  const invalid = [
    ["the same row deleted twice", remove(["r3", "r3"])],
    ["the same record brought twice", insert([{ id: "r0", pos: "5" }, { id: "r0", pos: "6" }])],
    ["a frozen that is not a boolean", insert([{ id: "r0", pos: "5", frozen: "yes" }])],
    ["a row style with a NUL", insert([{ id: "r0", pos: "5", style: "height:2px\0" }])],
    ["a row style with a carriage return", insert([{ id: "r0", pos: "5", style: "color:red;\r\nheight:2px" }])],
    ["a row style that is not text", insert([{ id: "r0", pos: "5", style: { height: "2px" } }])],
    ["an unknown field on a record", insert([{ id: "r0", pos: "5", width: 4 }])],
    ["a delete with no rows", remove([])],
    ["a change with no rows", change([])],
    ["a cell with no content", insert([{ id: "r0", pos: "5", cells: [["ca"]] }])],
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
  const brought = insert([{ id: "r0", pos: "5", cells: [["ca", "x", { fmt: "0.0", style: { color: "red" } }], ["cb", 1]] }]);
  expect(needs(brought)).toEqual({ rows: [], cols: ["ca", "cb"] });
  expect(creates(brought)).toEqual({ rows: ["r0"], cols: [] });
  expect(targets(brought)).toEqual([
    [S, "row", "r0", "exists"],
    [S, "r0", "ca", "content"],
    [S, "r0", "ca", "fmt"],
    [S, "r0", "ca", "style:color"],
    [S, "r0", "cb", "content"],
  ]);

  expect(needs(remove(["r3"]))).toEqual({ rows: ["r3"], cols: [] });
  expect(creates(remove(["r3"]))).toEqual({ rows: [], cols: [] });
  expect(targets(remove(["r3"]))).toEqual([[S, "row", "r3", "exists"]]);

  const moved = change([{ id: "r3", pos: "9" }, { id: "r4", height: 20 }]);
  expect(needs(moved)).toEqual({ rows: ["r3", "r4"], cols: [] });
  expect(creates(moved)).toEqual({ rows: [], cols: [] });
  expect(targets(moved)).toEqual([
    [S, "row", "r3", "pos"],
    [S, "row", "r4", "height"],
    [S, "row", "r4", "rowstyle"],
  ]);

  const grow = {
    v: 1,
    t: "batch",
    actions: [
      { v: 1, t: "insertRows", sheet: S, rows: [{ id: "g1", pos: "z" }] },
      { v: 1, t: "set", sheet: S, cells: [["g1", "ca", "new"]] },
    ],
  };
  expect(needs(grow)).toEqual({ rows: [], cols: ["ca"] });
  expect(creates(grow)).toEqual({ rows: ["g1"], cols: [] });

  const again = {
    v: 1,
    t: "batch",
    actions: [
      { v: 1, t: "deleteRows", sheet: S, rows: ["r3"] },
      { v: 1, t: "insertRows", sheet: S, rows: [{ id: "r3", pos: "O" }] },
    ],
  };
  expect(needs(again)).toEqual({ rows: ["r3"], cols: [] });
  expect(creates(again)).toEqual({ rows: [], cols: [] });
});

test("undo of a height change puts the row style back", () => {
  const store = plain({ rowStyles: { r3: "color:#333333;height:2em" } });
  const before = bytesOf(store);
  const out = apply(store, change([{ id: "r3", height: 40 }]), { derive });
  expect(out.out).toBe("applied");
  expect(bytesOf(store)).toContain('data-pos="O" style="height:40px;color:#333333"');
  const back = apply(store, out.inverse, { derive });
  expect(back.out).toBe("applied");
  expect(unstale(bytesOf(store))).toBe(before);

  const bare = plain();
  const bareBefore = bytesOf(bare);
  const set = apply(bare, change([{ id: "r3", height: 40 }]), { derive });
  expect(set.out).toBe("applied");
  expect(apply(bare, set.inverse, { derive }).out).toBe("applied");
  expect(unstale(bytesOf(bare))).toBe(bareBefore);
});

test("a change record's style is written", () => {
  const store = styled();
  const before = bytesOf(store);
  const restyle = change([{ id: "r3", style: "height:30px;background:#ff0000" }]);
  expect(targets(restyle)).toEqual([[S, "row", "r3", "rowstyle"]]);
  const out = apply(store, restyle, { derive });
  expect(out.out).toBe("applied");
  expect(bytesOf(store)).toContain('data-pos="O" style="height:30px;background:#ff0000"');
  const back = apply(store, out.inverse, { derive });
  expect(back.out).toBe("applied");
  expect(unstale(bytesOf(store))).toBe(before);
});

test("a change record names only what it changes", () => {
  const cases = [
    ["frozen on changeRows", change([{ id: "r3", frozen: true }])],
    ["cells on changeRows", change([{ id: "r3", height: 20, cells: [["ca", "x"]] }])],
    ["frozen on changeCols", { v: 1, t: "changeCols", sheet: S, cols: [{ id: "ca", frozen: true }] }],
    ["cells on changeCols", { v: 1, t: "changeCols", sheet: S, cols: [{ id: "ca", width: 40, cells: [["r3", "x"]] }] }],
    ["a column twice in one inserted row", insert([{ id: "r9", pos: "z", cells: [["ca", "a"], ["ca", "b"]] }])],
    ["a row twice in one inserted column", { v: 1, t: "insertCols", sheet: S, cols: [{ id: "cx", pos: "z", cells: [["r1", "a"], ["r1", "b"]] }] }],
  ];
  const store = plain();
  const before = bytesOf(store);
  for (const [name, action] of cases) {
    expect([name, () => validate(action)]).toEqual([name, expect.any(Function)]);
    let caught = null;
    try {
      validate(action);
    } catch (err) {
      caught = err;
    }
    expect([name, caught && caught.code]).toEqual([name, "bad_action"]);
    const out = apply(store, action, { derive });
    expect([name, out.out, out.code]).toEqual([name, "refused", "bad_action"]);
    expect([name, bytesOf(store)]).toEqual([name, before]);
  }
});

test("undo of a row delete puts back a hand-written style", () => {
  const store = plain({ rowStyles: { r3: "background:#eee;height:24px" } });
  const before = bytesOf(store);
  const gone = apply(store, remove(["r3"]), { derive });
  expect(gone.out).toBe("applied");
  const back = apply(store, gone.inverse, { derive });
  expect([back.out, unstale(bytesOf(store))]).toEqual(["applied", before]);

  const dragged = plain({ rowStyles: { r3: "color:red;height:30px" } });
  const start = bytesOf(dragged);
  const tall = apply(dragged, change([{ id: "r3", height: 40 }]), { derive });
  expect(tall.out).toBe("applied");
  const undo = apply(dragged, tall.inverse, { derive });
  expect([undo.out, unstale(bytesOf(dragged))]).toEqual(["applied", start]);
});
