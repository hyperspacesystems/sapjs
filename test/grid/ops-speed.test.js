// What an action that brings or takes rows costs, counted and never timed: a time limit only says a
// slow machine is slow. Every model backing the reducer makes, the one under test and each copy it
// tries an action on, is counted here: one copy for each backing made, and one step for
//   - each read of a row from a backing's list of rows,
//   - each item of any list that one of the WALKS below, a spread or a for...of loop goes through
//     (a walk that stops early counts the whole list),
//   - each item a splice takes out of any list or puts into it (the items it only moves are not counted),
//   - each read of the key of a record the action brings (every comparison with it reads the key).
// A loop that reads a plain list by index is not seen. The cost of N rows and of 2N rows must stay
// in proportion, and the sheet is copied a fixed number of times. The second half holds the cases
// the faster paths must still get right.

import { derive } from "../../src/grid/content.js";
import { apply, applyUnchecked, fits } from "../../src/grid/ops.js";
import { modelBacking } from "../../src/grid/backing-model.js";
import { keyBetween, keysBetween } from "../../src/grid/codec/order-keys.js";
import { tableHtml } from "../../src/grid/codec/write.js";
import { rng } from "../grid-codec/support/rng.js";
import { H, sheet } from "./support/sheets.js";

global.__SAP_KEEP_CONSOLE__ = true;

jest.mock("../../src/grid/backing-model.js", () => {
  const real = jest.requireActual("../../src/grid/backing-model.js");
  return { ...real, modelBacking: (model, options) => mockCounted(real.modelBacking(model, options)) };
});

const meter = { copies: 0, steps: 0 };
const INDEX = /^[0-9]+$/;
const WALKS = ["includes", "indexOf", "lastIndexOf", "find", "findIndex", "some", "every", "map", "filter", "forEach", "reduce", "flatMap", "slice", "concat", "join", "reverse", "sort", Symbol.iterator];

function mockCounted(backing) {
  meter.copies += 1;
  backing.sheet.rows = new Proxy(backing.sheet.rows, {
    get(list, key, receiver) {
      if (key === "splice") return (...args) => Array.prototype.splice.apply(list, args);
      if (typeof key === "string" && INDEX.test(key)) meter.steps += 1;
      return Reflect.get(list, key, receiver);
    },
  });
  return backing;
}

function counted(run) {
  const real = WALKS.map((name) => Array.prototype[name]);
  const realSplice = Array.prototype.splice;
  WALKS.forEach((name, i) => {
    Array.prototype[name] = function walk(...args) {
      meter.steps += this.length;
      return real[i].apply(this, args);
    };
  });
  Array.prototype.splice = function splice(...args) {
    const gone = realSplice.apply(this, args);
    meter.steps += gone.length + Math.max(0, args.length - 2);
    return gone;
  };
  meter.copies = 0;
  meter.steps = 0;
  try {
    run();
  } finally {
    WALKS.forEach((name, i) => {
      Array.prototype[name] = real[i];
    });
    Array.prototype.splice = realSplice;
  }
  return { copies: meter.copies, steps: meter.steps };
}

const keyed = (record) =>
  Object.defineProperty({ ...record }, "pos", {
    enumerable: true,
    get() {
      meter.steps += 1;
      return record.pos;
    },
  });

const S = "s";
const COLS = ["ca", "cb", "cc"];
const bytesOf = (backing) => tableHtml(backing.sheet);
const insert = (rows) => ({ v: 1, t: "insertRows", sheet: S, rows });
const remove = (rows) => ({ v: 1, t: "deleteRows", sheet: S, rows });
const pick = (random, list) => list[Math.floor(random() * list.length)];

// Six rows and three columns. `formula` adds what the golden sheets have: a frozen first row, a
// formula in a row that stays, and a merge of two rows.
function table({ formula = false } = {}) {
  const model = sheet({
    cols: COLS,
    rows: keysBetween(null, null, 6).map((pos, i) => [`r${i}`, pos, [`a${i}`, { text: String(i), n: true }]]),
  });
  if (formula) {
    model.rows[0].frozen = true;
    model.rows[1].cells[2] = { text: "1", n: true, f: "=B1+B2" };
    model.rows[2].cells[0] = { text: "a2", rowspan: 2 };
    model.rows[3].cells[0] = H;
  }
  return modelBacking(model, { sheetId: S });
}

const keysAfter = (backing, n) => keysBetween(backing.rows()[backing.rows().length - 1].pos, null, n);

const brought = (backing, n) => insert(keysAfter(backing, n).map((pos, i) => keyed({ id: `n${i}`, pos, cells: [["ca", `t${i}`], ["cb", i]] })));

const pasted = (backing, n) => ({
  v: 1,
  t: "set",
  sheet: S,
  rows: keysAfter(backing, n).map((pos, i) => keyed({ id: `n${i}`, pos })),
  cells: [["r5", "ca", "over"], ["r5", "cb", 7]].concat(
    Array.from({ length: n }, (_, i) => [[`n${i}`, "ca", `t${i}`], [`n${i}`, "cb", i], [`n${i}`, "cc", i % 2 === 0]]).flat(),
  ),
});

// The rows come in two actions and a third writes into all of them.
const batched = (backing, n) => {
  const records = keysAfter(backing, n).map((pos, i) => keyed({ id: `n${i}`, pos, cells: [["ca", `t${i}`]] }));
  return {
    v: 1,
    t: "batch",
    actions: [
      insert(records.slice(0, n / 2)),
      insert(records.slice(n / 2)),
      { v: 1, t: "set", sheet: S, cells: [["r5", "cb", 7]].concat(records.map((record, i) => [record.id, "cb", i])) },
    ],
  };
};

function costOf(make, n, options) {
  const backing = table(options);
  const action = make(backing, n);
  const before = bytesOf(backing);
  let done;
  const forward = counted(() => {
    done = apply(backing, action, { derive });
  });
  let back;
  const undo = counted(() => {
    back = apply(backing, done.inverse, { derive });
  });
  return { out: [done.out, back.out], restored: bytesOf(backing) === before, apply: forward, undo };
}

const N = 400;
const PER_ROW = 300;

// [name, the action, the sheet, copies of the sheet for apply, copies for undo]. A sheet with a
// formula is copied once more in each of the two writes, by the formula guard.
const CASES = [
  ["rows brought at the end", brought, {}, 1, 1],
  ["a paste that grows the sheet", pasted, {}, 1, 1],
  ["rows brought at the end of a sheet with a formula", brought, { formula: true }, 3, 3],
  ["a paste that grows a sheet with a formula", pasted, { formula: true }, 3, 3],
  ["a batch that brings the rows", batched, {}, 1, 1],
  ["a batch that brings the rows to a sheet with a formula", batched, { formula: true }, 5, 5],
];

for (const [name, make, options, copiesApply, copiesUndo] of CASES) {
  for (const way of ["apply", "undo"]) {
    test(`the cost follows the number of rows: ${name}, ${way}`, () => {
      const small = costOf(make, N, options);
      const large = costOf(make, 2 * N, options);
      console.log(`${name}, ${way}: ${N} rows ${small[way].steps} steps, ${2 * N} rows ${large[way].steps} steps`);
      expect([small.out, large.out]).toEqual([["applied", "applied"], ["applied", "applied"]]);
      expect([small.restored, large.restored]).toEqual([true, true]);
      expect(large[way].steps).toBeLessThanOrEqual(2.2 * small[way].steps);
      expect(small[way].steps).toBeLessThanOrEqual(PER_ROW * N);
    });
  }

  test(`the sheet is copied a fixed number of times: ${name}`, () => {
    const small = costOf(make, 20, options);
    const large = costOf(make, 40, options);
    expect([small.apply.copies, large.apply.copies]).toEqual([copiesApply, copiesApply]);
    expect([small.undo.copies, large.undo.copies]).toEqual([copiesUndo, copiesUndo]);
  });
}

// A sheet of `count` rows with a merge of its last two: the rows that go are far above the merge.
function mergedLast(count) {
  const model = sheet({
    cols: COLS,
    rows: keysBetween(null, null, count).map((pos, i) => [`r${i}`, pos, [`a${i}`, { text: String(i), n: true }]]),
  });
  model.rows[count - 2].cells[0] = { text: `a${count - 2}`, rowspan: 2 };
  model.rows[count - 1].cells[0] = H;
  return modelBacking(model, { sheetId: S });
}

// The undo brings the rows back above rows that stay, and each of them is still walked down to from
// the first row. So the undo is counted and printed, and only what it leaves is held.
test("the cost follows the number of rows: the top half of a sheet deleted, with a merge in its last rows, apply", () => {
  const costs = [N, 2 * N].map((n) => {
    const backing = mergedLast(2 * n);
    const before = bytesOf(backing);
    const action = remove(backing.rows().slice(0, n).map((row) => row.id));
    let done;
    const there = counted(() => {
      done = apply(backing, action, { derive });
    });
    expect([done.out, backing.rows().length]).toEqual(["applied", n]);
    let undone;
    const back = counted(() => {
      undone = apply(backing, done.inverse, { derive });
    });
    expect([undone.out, bytesOf(backing) === before]).toEqual(["applied", true]);
    return { apply: there.steps, undo: back.steps };
  });
  for (const way of ["apply", "undo"]) {
    console.log(`the top half of a sheet deleted, ${way}: ${N} rows ${costs[0][way]} steps, ${2 * N} rows ${costs[1][way]} steps`);
  }
  expect(costs[1].apply).toBeLessThanOrEqual(2.2 * costs[0].apply);
  expect(costs[0].apply).toBeLessThanOrEqual(PER_ROW * N);
});

test("a batch is tried on one copy of the sheet, however many actions it holds", () => {
  const copies = [10, 80].map((count) => {
    const backing = table();
    const actions = Array.from({ length: count }, (_, i) => ({ v: 1, t: "set", sheet: S, cells: [[`r${i % 6}`, "cc", i]] }));
    let done;
    const cost = counted(() => {
      done = apply(backing, { v: 1, t: "batch", actions }, { derive });
    });
    expect(done.out).toBe("applied");
    return cost.copies;
  });
  expect(copies).toEqual([1, 1]);
});

test("the row id map answers as a walk through the rows does", () => {
  const random = rng(20261115);
  const backing = modelBacking(sheet({ cols: COLS, rows: keysBetween(null, null, 8).map((pos, i) => [`r${i}`, pos]) }));
  const gone = ["never"];
  let made = 0;
  for (let step = 0; step < 3000; step++) {
    const size = backing.rows().length;
    const kind = size < 4 ? 0 : Math.floor(random() * 5);
    if (kind === 0) backing.insertRow(Math.floor(random() * (size + 1)), { id: `n${made++}`, pos: "V" });
    if (kind === 1) backing.insertRow(size, { id: `n${made++}`, pos: "V" });
    if (kind === 2) gone.push(backing.removeRow(Math.floor(random() * size)).id);
    if (kind === 3) backing.moveRow(Math.floor(random() * size), Math.floor(random() * size));
    if (kind === 4) backing.putRow(Math.floor(random() * size), { pos: "W" });
    const at = Math.floor(random() * backing.rows().length);
    expect([step, backing.rowIndex(backing.rows()[at].id)]).toEqual([step, at]);
    expect([step, backing.rowIndex(pick(random, gone))]).toEqual([step, -1]);
    if (step % 97 === 0) backing.rows().forEach((row, i) => expect([step, row.id, backing.rowIndex(row.id)]).toEqual([step, row.id, i]));
  }
});

test("a table with a repeated row id answers as it did before the map was lazy", () => {
  const backing = modelBacking(sheet({ cols: COLS, rows: [["x", "8"], ["a", "G"], ["x", "V"], ["b", "l"]] }));
  const places = () => ["x", "a", "b", "n"].map((id) => backing.rowIndex(id));
  expect(places()).toEqual([2, 1, 3, -1]);
  backing.removeRow(0);
  expect(places()).toEqual([1, 0, 2, -1]);
  backing.removeRow(1);
  expect(places()).toEqual([-1, 0, 1, -1]);
  backing.insertRow(0, { id: "n", pos: "5" });
  expect(places()).toEqual([-1, 1, 2, 0]);
  backing.removeRow(0);
  expect(places()).toEqual([-1, 0, 1, -1]);
});

// A sheet of 6 to 9 rows with, by chance, frozen rows at the top and a merge of two or three rows
// below them.
function mixed(random) {
  const size = 6 + Math.floor(random() * 4);
  const model = sheet({
    cols: COLS,
    rows: keysBetween(null, null, size).map((pos, i) => [`r${i}`, pos, [`a${i}`, { text: String(i), n: true }, `c${i}`]]),
  });
  const frozen = Math.floor(random() * 3);
  for (let i = 0; i < frozen; i++) model.rows[i].frozen = true;
  if (random() < 0.7) {
    const tall = 2 + Math.floor(random() * 2);
    const top = frozen + Math.floor(random() * (size - frozen - tall + 1));
    model.rows[top].cells[0] = { text: `a${top}`, rowspan: tall };
    for (let i = 1; i < tall; i++) model.rows[top + i].cells[0] = H;
  }
  return model;
}

test("rows brought in one action land as they do one at a time", () => {
  const random = rng(20261116);
  let applied = 0;
  let refused = 0;
  for (let round = 0; round < 400; round++) {
    const model = mixed(random);
    const keys = model.rows.map((row) => row.pos);
    const records = Array.from({ length: 2 + Math.floor(random() * 5) }, (_, i) => {
      const gap = Math.floor(random() * (keys.length + 1));
      const tied = random() < 0.15 || keys[gap - 1] === keys[gap];
      const pos = tied ? pick(random, keys) : keyBetween(keys[gap - 1] ?? null, keys[gap] ?? null);
      keys.push(pos);
      keys.sort();
      const record = { id: `n${i}`, pos };
      if (random() < 0.5) record.cells = [[pick(random, COLS), `new${i}`]];
      if (random() < 0.1) record.frozen = true;
      return record;
    });
    const whole = modelBacking(model, { sheetId: S });
    const single = modelBacking(model, { sheetId: S });
    const before = bytesOf(whole);
    const out = apply(whole, insert(records), { derive, formulas: {} });
    const outs = records.map((record) => apply(single, insert([record]), { derive, formulas: {} }).out);
    if (out.out !== "applied") {
      refused++;
      expect([round, outs.includes("refused"), bytesOf(whole)]).toEqual([round, true, before]);
      continue;
    }
    applied++;
    expect([round, outs.includes("refused"), whole.frozen().rows]).toEqual([round, false, single.frozen().rows]);
    expect([round, bytesOf(whole)]).toEqual([round, bytesOf(single)]);
    expect([round, apply(whole, out.inverse, { derive, formulas: {} }).out, bytesOf(whole)]).toEqual([round, "applied", before]);
  }
  expect(applied).toBeGreaterThan(200);
  expect(refused).toBeGreaterThan(20);
});

test("rows deleted in one action leave what one at a time leaves", () => {
  const random = rng(20261117);
  for (let round = 0; round < 400; round++) {
    const model = mixed(random);
    const ids = model.rows.map((row) => row.id).filter(() => random() < 0.4);
    if (ids.length === 0) ids.push(model.rows[0].id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const whole = modelBacking(model, { sheetId: S });
    const single = modelBacking(model, { sheetId: S });
    const before = bytesOf(whole);
    const out = apply(whole, remove(ids), { derive, formulas: {} });
    const outs = ids.map((id) => apply(single, remove([id]), { derive, formulas: {} }).out);
    expect([round, out.out, outs.includes("refused"), whole.frozen().rows]).toEqual([round, "applied", false, single.frozen().rows]);
    expect([round, bytesOf(whole)]).toEqual([round, bytesOf(single)]);
    expect([round, apply(whole, out.inverse, { derive, formulas: {} }).out, bytesOf(whole)]).toEqual([round, "applied", before]);
  }
});

// Four merges in one column: two of two rows, one that is a single row wide, and one of four rows
// right under it. The rows go in an order that cuts a merge, takes an anchor row, and takes the row
// an anchor moved to.
test("rows deleted in one action leave what one at a time leaves: merges one under the other", () => {
  const model = sheet({ cols: COLS, rows: keysBetween(null, null, 11).map((pos, i) => [`r${i}`, pos, [`a${i}`, `b${i}`]]) });
  for (const [top, rows] of [[1, 2], [3, 2], [6, 4]]) {
    model.rows[top].cells[0] = { text: `a${top}`, rowspan: rows };
    for (let i = 1; i < rows; i++) model.rows[top + i].cells[0] = H;
  }
  model.rows[5].cells = [{ text: "a5", colspan: 2 }, H];
  const ids = ["r2", "r1", "r4", "r5", "r7", "r6", "r8"];
  const whole = modelBacking(model, { sheetId: S });
  const single = modelBacking(model, { sheetId: S });
  const before = bytesOf(whole);
  const out = apply(whole, remove(ids), { derive });
  for (const id of ids) expect([id, apply(single, remove([id]), { derive }).out]).toEqual([id, "applied"]);
  expect([out.out, whole.rows().map((row) => row.cells)]).toEqual(["applied", single.rows().map((row) => row.cells)]);
  expect(bytesOf(whole)).toBe(bytesOf(single));
  expect([apply(whole, out.inverse, { derive }).out, bytesOf(whole)]).toEqual(["applied", before]);
});

// A sheet with a repeated row id: the id leads to the later of its rows, and to no row once that
// one is deleted. The three tests below hold what the engine answered there before it took the
// shorter ways through a batch and a delete.
const twice = (first = "keep") =>
  modelBacking(sheet({ cols: ["ca", "cb"], rows: [["x", "8", [first]], ["a", "G", [{ text: "41", n: true }]], ["x", "V", ["twin"]], ["b", "l"]] }), { sheetId: S });

test("a batch that names a row the sheet no longer finds is refused whole, as it was", () => {
  const backing = twice();
  expect(apply(backing, remove(["x"]), { derive }).out).toBe("applied");
  expect([backing.rows().map((row) => row.id), backing.rowIndex("x")]).toEqual([["x", "a", "b"], -1]);
  const before = bytesOf(backing);
  const pasted = [
    { v: 1, t: "set", sheet: S, rows: [{ id: "n1", pos: "z" }], cells: [["n1", "ca", "new"], ["x", "ca", "edited"]] },
    { v: 1, t: "set", sheet: S, cells: [["b", "cb", "y"]] },
  ];
  const written = [{ v: 1, t: "set", sheet: S, cells: [["a", "ca", "over"]] }, remove(["x"])];
  for (const actions of [pasted, written]) {
    const action = { v: 1, t: "batch", actions };
    expect(fits(backing, action)).toBe(true);
    const out = apply(backing, action, { derive });
    expect([out.out, out.code, out.detail]).toEqual(["refused", "missing_row", "row x is not in the sheet"]);
    expect(bytesOf(backing)).toBe(before);
  }
});

test("a batch that deletes one row of a repeated id and brings the id back is refused, as it was", () => {
  const backing = twice();
  const before = bytesOf(backing);
  const action = { v: 1, t: "batch", actions: [remove(["x"]), insert([{ id: "x", pos: "z", cells: [["ca", "third"]] }])] };
  expect(fits(backing, action)).toEqual({ code: "exists", detail: "the id x is already in the sheet" });
  const out = apply(backing, action, { derive });
  expect([out.out, out.code]).toEqual(["refused", "exists"]);
  expect(bytesOf(backing)).toBe(before);
});

test("a delete under a merge whose anchor row has a repeated id leaves the merge, as it did", () => {
  const backing = twice({ text: "top", rowspan: 2 });
  backing.putCell(1, 0, H);
  const out = apply(backing, remove(["a"]), { derive });
  expect([out.out, out.inverse]).toEqual(["applied", insert([{ id: "a", pos: "G" }])]);
  expect(backing.cell(0, 0)).toEqual({ text: "top", rowspan: 2 });
});

test("a sheet with no row takes rows", () => {
  const backing = modelBacking(sheet({ cols: COLS }), { sheetId: S });
  const out = apply(backing, insert([{ id: "b", pos: "V" }, { id: "a", pos: "G" }, { id: "c", pos: "l" }]), { derive });
  expect(out.out).toBe("applied");
  expect(backing.rows().map((row) => row.id)).toEqual(["a", "b", "c"]);
});

test("fits answers with the code of the action that stops a batch", () => {
  const first = { v: 1, t: "set", sheet: S, cells: [["r0", "ca", "first"]] };
  const stopped = [
    [{ v: 1, t: "set", sheet: S, cells: [["r3", "ca", "covered"]] }, { code: "covered_cell", detail: "r3/ca is a merge's covered position" }],
    [
      { v: 1, t: "set", sheet: S, cells: [["r1", "ca", { f: "=B1" }, { fmt: '0.0 "kg"', text: "shown" }]] },
      { code: "bad_action", detail: "extra.text needs a formula that has a result" },
    ],
  ];
  for (const [second, refusal] of stopped) {
    const backing = table({ formula: true });
    const before = bytesOf(backing);
    const action = { v: 1, t: "batch", actions: [first, second] };
    expect(fits(backing, action)).toEqual(refusal);
    const out = apply(backing, action, { derive });
    expect([out.out, out.code]).toEqual(["refused", refusal.code]);
    expect(bytesOf(backing)).toBe(before);
  }
});

test("a batch nobody tried still refuses an action whole", () => {
  const backing = table({ formula: true });
  const before = bytesOf(backing);
  const action = {
    v: 1,
    t: "batch",
    actions: [
      { v: 1, t: "set", sheet: S, cells: [["r0", "ca", "first"]] },
      { v: 1, t: "set", sheet: S, cells: [["r5", "ca", "second"], ["r3", "ca", "covered"]] },
    ],
  };
  const out = applyUnchecked(backing, action, { derive });
  expect([out.out, out.code]).toEqual(["refused", "covered_cell"]);
  expect(bytesOf(backing)).toBe(before);
});
