// The DOM backing: the reducer's store over a live <table grid>. The table is the store. The
// backing keeps a model of it, the mirror, read once with the codec's tree reader. Reads come
// from the mirror, and every primitive writes the mirror and the table together.
//
// The backing makes two kinds of DOM write. A write that changes a cell's content or one of its
// format fields (fmt, style, span), a row or column record, or which rows are frozen is an
// ordinary DOM write, so the page's change bridge, its autosave and its undo see the edit. So are
// the moves that keep the tbody groups the writer's, so an undo puts rows back in their groups. A
// write of derived parts only (the shown text, n, t, v and the table's stale mark) runs inside the
// `write` function handed in, which is the plugin kit's `write`, so it never looks like an edit.
//
// After every row primitive the table's parts are the ones the writer writes: the frozen rows in
// one thead that is there only while a row is frozen, and every other row in tbody groups cut
// where the writer cuts them. A row that comes or goes moves one row across each later group.
// A table that comes with other parts keeps them, because reading a table writes nothing, until
// its first row primitive or a call of `tidy()`.
//
// The mirror is as fresh as the last read. `read(rows)` reads rows from the table again and takes
// what differs into the mirror as a foreign write, and `rescan()` reads the whole table. The
// caller reads the rows an action touches, `read(touched(action))`, before the reducer runs, so
// the "before" values in an inverse are what the page held.

import { modelBacking } from "./backing-model.js";
import { canonicalGrid, domAdapter, treeModel } from "./codec/canonical.js";
import { groupStarts } from "./codec/write.js";
import { contentOf, effectiveFmt } from "./content.js";
import { fmtKind } from "./format.js";

// A cell's fields as attributes, in the writer's order. A flag is an attribute with no value.
const ATTRIBUTES = ["n", "t", "f", "v", "fmt", "colspan", "rowspan", "hidden", "style"];
const FLAGS = new Set(["n", "t", "hidden"]);
const CELL_FIELDS = ["text", ...ATTRIBUTES];
const FORMAT_FIELDS = ["fmt", "colspan", "rowspan", "hidden", "style"];
const SPAN_FIELDS = ["colspan", "rowspan", "hidden"];
const ROW_FIELDS = ["id", "pos", "frozen", "hidden", "style"];
const COL_FIELDS = ["id", "pos", "fmt", "hidden", "width"];
const BLANK = { text: "" };
const GROUP = 50;

const isCell = (node) => node.localName === "td" || node.localName === "th";

const fieldOf = (cell, key) => (cell ? cell[key] : undefined) ?? (key === "text" ? "" : undefined);

const sameCell = (a, b) => CELL_FIELDS.every((key) => fieldOf(a, key) === fieldOf(b, key));

function sameContent(a, b) {
  const left = contentOf(a);
  const right = contentOf(b);
  if (left !== null && typeof left === "object") return right !== null && typeof right === "object" && left.f === right.f;
  return left === right;
}

const isEdit = (old, next) => !sameContent(old, next) || FORMAT_FIELDS.some((key) => fieldOf(old, key) !== fieldOf(next, key));

const recordOf = (row) => Object.fromEntries(ROW_FIELDS.filter((key) => row[key] !== undefined).map((key) => [key, row[key]]));

// The value the writer gives the attribute for this cell, or null when it writes none.
function attributeOf(cell, name) {
  const value = cell[name];
  if (FLAGS.has(name)) return value ? "" : null;
  return value === undefined ? null : String(value);
}

const textOf = (value) => (value === undefined ? null : String(value));

// An attribute that already holds the value is left alone, so it makes no mutation record.
function setAttribute(node, name, value) {
  if (node.getAttribute(name) === value) return;
  if (value === null) node.removeAttribute(name);
  else node.setAttribute(name, value);
}

// The element is made what a parser builds from the cell's canonical bytes: these attributes with
// these values, and the text as one text node. Markup inside the cell is reduced to its text. A
// cell that holds one text node keeps it and takes new text as its data, so an undo record that
// names the node, kept from an edit before, still finds it there.
function paint(td, cell) {
  for (const name of ATTRIBUTES) setAttribute(td, name, attributeOf(cell, name));
  const only = td.firstChild;
  if (only !== null && only === td.lastChild && only.nodeType === only.TEXT_NODE && cell.text !== "") {
    if (only.data !== cell.text) only.data = cell.text;
  } else if (td.textContent !== cell.text || td.firstElementChild !== null) td.textContent = cell.text;
}

// The cell element at index c, or null when the row ends before it. With `pad`, a row that ends
// before it gets empty cells up to it.
function cellAt(tr, c, pad) {
  let at = 0;
  for (let node = tr.firstElementChild; node !== null; node = node.nextElementSibling) {
    if (!isCell(node)) continue;
    if (at === c) return node;
    at += 1;
  }
  let td = null;
  if (pad) for (; at <= c; at++) td = tr.appendChild(tr.ownerDocument.createElement("td"));
  return td;
}

function lastCell(tr) {
  let node = tr.lastElementChild;
  while (node !== null && !isCell(node)) node = node.previousElementSibling;
  return node;
}

const isBare = (td) => td.textContent === "" && ATTRIBUTES.every((name) => !td.hasAttribute(name));

// The writer drops a row's trailing empty cells, so the live row does not keep them either.
function trimRow(tr) {
  for (let td = lastCell(tr); td !== null && isBare(td); td = lastCell(tr)) td.remove();
}

function drawCell(tr, c, cell) {
  const td = cellAt(tr, c, cell !== null);
  if (td !== null) paint(td, cell ?? BLANK);
  trimRow(tr);
}

function rowElement(doc, row) {
  const tr = doc.createElement("tr");
  tr.setAttribute("data-id", row.id);
  tr.setAttribute("data-pos", row.pos);
  if (row.hidden) tr.setAttribute("hidden", "");
  if (row.style !== undefined) tr.setAttribute("style", row.style);
  for (const cell of row.cells) paint(tr.appendChild(doc.createElement("td")), cell ?? BLANK);
  return tr;
}

const widthOf = (width) => (width === undefined ? null : `width:${width}px`);

function colElement(doc, col) {
  const el = doc.createElement("col");
  el.setAttribute("data-id", col.id);
  el.setAttribute("data-pos", col.pos);
  if (col.fmt !== undefined) el.setAttribute("fmt", col.fmt);
  if (col.hidden) el.setAttribute("hidden", "");
  if (col.width !== undefined) el.setAttribute("style", widthOf(col.width));
  return el;
}

// The table's parts as the tree reader walks them. The rows are in its order: the rows of every
// thead, then every other row. `plain` says the parts are the ones the writer writes: a colgroup
// first, with every column in it, then at most one thead, then one tbody or more, and no row
// anywhere else.
function layout(table) {
  const frozen = [];
  const data = [];
  const cols = [];
  const bodies = [];
  let thead = null;
  let plain = table.firstElementChild?.localName === "colgroup";
  for (let part = table.firstElementChild; part !== null; part = part.nextElementSibling) {
    const name = part.localName;
    if (name === "col") cols.push(part);
    if (name === "colgroup") for (let col = part.firstElementChild; col !== null; col = col.nextElementSibling) if (col.localName === "col") cols.push(col);
    if (name === "tr") data.push(part);
    if (name === "col" || name === "tr" || (name === "colgroup" && part.previousElementSibling !== null)) plain = false;
    if (name !== "thead" && name !== "tbody" && name !== "tfoot") continue;
    if (name === "tbody") bodies.push(part);
    else if (name === "tfoot" || thead !== null || bodies.length > 0) plain = false;
    if (name === "thead" && thead === null) thead = part;
    const into = name === "thead" ? frozen : data;
    for (let tr = part.firstElementChild; tr !== null; tr = tr.nextElementSibling) if (tr.localName === "tr") into.push(tr);
  }
  return { rows: [...frozen, ...data], head: frozen.length, thead, bodies, cols, plain: plain && bodies.length > 0 };
}

// The element children of a part are made to start with these rows, in this order. A row is
// taken from wherever it is. What the part held besides them is left after them.
function fill(part, rows) {
  let at = part.firstElementChild;
  for (const tr of rows) {
    if (at === tr) at = at.nextElementSibling;
    else part.insertBefore(tr, at);
  }
}

// The codec's tree reader over a list of rows in place of a table, so that a row read again is
// read by the rules the mirror was read by.
const rowsAdapter = {
  name: (node) => (Array.isArray(node) ? "table" : domAdapter.name(node)),
  attr: (node, name) => (Array.isArray(node) ? null : domAdapter.attr(node, name)),
  children: (node) => (Array.isArray(node) ? node : domAdapter.children(node)),
  text: domAdapter.text,
};

const readRows = (trs) => treeModel(rowsAdapter, trs).rows;

// The tree reader over the table without its rows: the columns, the count of frozen columns and
// the stale mark, as the mirror was read.
const headAdapter = {
  ...domAdapter,
  children: (node) => {
    const parts = domAdapter.children(node);
    return node.localName === "table" ? parts.filter((part) => part.localName === "colgroup" || part.localName === "col") : parts;
  },
};

function sameHead(now, kept) {
  if (now.freezeCols !== kept.freezeCols || Boolean(now.stale) !== Boolean(kept.stale) || now.cols.length !== kept.cols.length) return false;
  return now.cols.every((col, c) => COL_FIELDS.every((key) => col[key] === kept.cols[c][key]));
}

function sameRow(now, kept) {
  if (ROW_FIELDS.some((key) => now[key] !== kept[key])) return false;
  const width = Math.max(now.cells.length, kept.cells.length);
  for (let c = 0; c < width; c++) if (!sameCell(now.cells[c] ?? null, kept.cells[c] ?? null)) return false;
  return true;
}

const sameSheet = (now, kept) => sameHead(now, kept) && now.rows.length === kept.rows.length && now.rows.every((row, r) => sameRow(row, kept.rows[r]));

export function domBacking(table, { write = (fn) => fn(), sheetId = null } = {}) {
  const doc = table.ownerDocument;
  let mirror;
  // The row elements in the mirror's order, and how many of them, from the first, are in the thead.
  let trs;
  let head;
  let thead;
  let bodies;
  let colEls;
  // Whether the table's parts are the writer's: the plain parts of `layout`, no thead without a
  // frozen row, and the groups cut where the writer cuts them.
  let canonical;

  // Where the writer cuts the data rows into tbodies, and whether every tbody starts with the row
  // the writer starts it with.
  const cuts = () => groupStarts(mirror.rows().slice(head), GROUP);
  const grouped = (starts) => bodies.length === starts.length && starts.every((start, g) => bodies[g].firstElementChild === (trs[head + start] ?? null));

  function take(found) {
    trs = found.rows;
    head = found.head;
    thead = found.thead;
    bodies = found.bodies;
    colEls = found.cols;
    canonical = found.plain && (head > 0 || thead === null) && grouped(cuts());
  }

  // Reads the whole table again, and the table wins. Returns whether it differed from the mirror.
  const rescan = () => {
    const fresh = treeModel(domAdapter, table);
    const differed = mirror === undefined || !sameSheet(fresh, mirror.sheet);
    mirror = modelBacking(fresh, { sheetId });
    take(layout(table));
    return differed;
  };
  rescan();

  const reread = () => {
    rescan();
    return { rows: [], cells: [], rescanned: true };
  };

  const inTable = (tr) => tr.parentNode !== null && (tr.parentNode === table || tr.parentNode.parentNode === table);

  // Inside `loudly(fn)` every cell write is drawn as an edit, so an undo puts it back.
  let loud = 0;
  function loudly(fn) {
    loud += 1;
    try {
      return fn();
    } finally {
      loud -= 1;
    }
  }

  function putCell(r, c, cell) {
    const next = cell ?? null;
    const old = mirror.cell(r, c);
    if (sameCell(old, next)) return;
    mirror.putCell(r, c, next);
    const draw = () => drawCell(trs[r], c, next);
    if (loud > 0 || isEdit(old, next) || (ownText.has(old) && old.text !== (next?.text ?? ""))) draw();
    else write(draw);
    if ((old?.rowspan ?? 1) !== (next?.rowspan ?? 1)) settle();
  }

  // The cells under a column whose format no formatter knows, taken when the column's format
  // changes: their text came from no formatter the sheet has, so writing over it is an edit, which
  // an undo puts back. A cell leaves the set when it is written again.
  const ownText = new WeakSet();
  function takeOwnText(c) {
    const column = mirror.cols()[c];
    mirror.rows().forEach((row, r) => {
      const held = mirror.cell(r, c);
      if (held !== null && held.hidden !== true && fmtKind(effectiveFmt(held, column)) === "unknown") ownText.add(held);
    });
  }

  function setStale(flag) {
    const next = flag ? "" : null;
    mirror.setStale(Boolean(flag));
    if (table.getAttribute("stale") !== next) write(() => setAttribute(table, "stale", next));
  }

  function needHead() {
    if (thead !== null) return;
    thead = doc.createElement("thead");
    table.insertBefore(thead, bodies[0]);
  }

  // The writer writes no thead for a table with no frozen row.
  function dropHead() {
    if (head > 0 || thead === null) return;
    thead.remove();
    thead = null;
  }

  // The colgroup the columns go in: the table's first one, or a new one.
  function colHome() {
    for (let part = table.firstElementChild; part !== null; part = part.nextElementSibling) if (part.localName === "colgroup") return part;
    return table.insertBefore(doc.createElement("colgroup"), table.firstElementChild);
  }

  // Gives a table the writer did not write the writer's parts: every column in one colgroup at
  // the table's start, the frozen rows in one thead before the first tbody, every other row in
  // its group, and no part left that these emptied. A row or a column moves once at most.
  function reshape() {
    const data = trs.slice(head);
    const starts = cuts();
    const home = colHome();
    if (home.previousElementSibling !== null) table.insertBefore(home, table.firstElementChild);
    fill(home, colEls);
    if (bodies.length === 0) bodies.push(table.appendChild(doc.createElement("tbody")));
    while (bodies.length < starts.length) {
      const body = doc.createElement("tbody");
      bodies[bodies.length - 1].after(body);
      bodies.push(body);
    }
    if (head > 0) {
      if (thead.nextElementSibling !== bodies[0]) table.insertBefore(thead, bodies[0]);
      fill(thead, trs.slice(0, head));
    }
    starts.forEach((start, g) => fill(bodies[g], data.slice(start, starts[g + 1] ?? data.length)));
    const wanted = new Set([home, ...bodies.slice(0, starts.length)]);
    if (head > 0) wanted.add(thead);
    for (const part of Array.from(table.children)) {
      const name = part.localName;
      const ours = name === "colgroup" || name === "thead" || name === "tbody" || name === "tfoot";
      if (ours && !wanted.has(part) && part.firstElementChild === null) part.remove();
    }
    take(layout(table));
  }

  // Gives the table the writer's parts now, as a derived write. A row primitive starts with it.
  // Returns whether there was anything to put right.
  function tidy() {
    if (canonical) return false;
    write(reshape);
    return true;
  }

  // Puts the tbody groups right after one row primitive: a tbody with no row left goes, and at
  // each cut the rows on the wrong side cross it. One row came or went, so one row crosses each
  // later cut. A cut whose first row is in neither tbody beside it is not one a row primitive
  // leaves, and then every part is put right.
  function regroup(starts) {
    for (let g = bodies.length - 1; g >= 0 && bodies.length > 1; g--) {
      if (bodies[g].firstElementChild !== null) continue;
      bodies[g].remove();
      bodies.splice(g, 1);
    }
    for (let g = 1; g < starts.length; g++) {
      if (g === bodies.length) {
        bodies.push(doc.createElement("tbody"));
        bodies[g - 1].after(bodies[g]);
      }
      const first = trs[head + starts[g]];
      const body = bodies[g];
      const before = bodies[g - 1];
      if (first.parentNode === body) {
        while (body.firstElementChild !== first) before.appendChild(body.firstElementChild);
      } else if (first.parentNode === before) {
        while (body.firstElementChild !== first) body.insertBefore(before.lastElementChild, body.firstElementChild);
      } else {
        reshape();
        return;
      }
    }
    const last = bodies[starts.length - 1];
    for (const extra of bodies.splice(starts.length)) {
      while (extra.firstElementChild !== null) last.appendChild(extra.firstElementChild);
      extra.remove();
    }
  }

  // A row primitive ends with the groups put right. The group moves are written beside the row
  // edit, not as a derived write, so an undo of the edit's DOM records reverses them in the exact
  // inverse order of the row's removal and placement.
  const settle = () => {
    const starts = cuts();
    if (!grouped(starts)) regroup(starts);
  };

  // Puts a row element that is not in the list where the row at index r goes: before the row
  // that is there now, in that row's part, or at the end of the last tbody. A row before the
  // frozen line, or a frozen row at it, goes in the thead.
  function place(tr, r, frozen) {
    const next = trs[r] ?? null;
    if (r < head || (r === head && frozen)) {
      needHead();
      thead.insertBefore(tr, r < head ? next : null);
      head += 1;
    } else if (next !== null) next.parentNode.insertBefore(tr, next);
    else bodies[bodies.length - 1].appendChild(tr);
    trs.splice(r, 0, tr);
  }

  function lift(r) {
    const [tr] = trs.splice(r, 1);
    tr.remove();
    if (r < head) head -= 1;
    return tr;
  }

  // Rows cross the line between the thead and the first tbody until the thead holds this many.
  function setHead(count) {
    const want = Math.min(count, trs.length);
    while (head < want) {
      needHead();
      thead.appendChild(trs[head]);
      head += 1;
    }
    while (head > want) {
      head -= 1;
      bodies[0].insertBefore(trs[head], bodies[0].firstElementChild);
    }
    dropHead();
  }

  function insertRow(r, record) {
    tidy();
    const row = mirror.insertRow(r, record);
    place(rowElement(doc, row), r, row.frozen === true);
    settle();
    return row;
  }

  function removeRow(r) {
    tidy();
    const record = mirror.removeRow(r);
    lift(r);
    dropHead();
    settle();
    return record;
  }

  function putRow(r, fields) {
    mirror.putRow(r, fields);
    const tr = trs[r];
    if ("id" in fields) setAttribute(tr, "data-id", textOf(fields.id));
    if ("pos" in fields) setAttribute(tr, "data-pos", textOf(fields.pos));
    if ("hidden" in fields) setAttribute(tr, "hidden", fields.hidden ? "" : null);
    if ("style" in fields) setAttribute(tr, "style", textOf(fields.style));
    if (!("frozen" in fields)) return;
    const data = mirror.rows().findIndex((row) => row.frozen !== true);
    tidy();
    setHead(data < 0 ? trs.length : data);
    settle();
  }

  function moveRow(from, to) {
    if (from === to) return;
    tidy();
    mirror.moveRow(from, to);
    place(lift(from), to, mirror.rows()[to].frozen === true);
    settle();
  }

  function setFrozen({ rows, cols } = {}) {
    mirror.setFrozen({ rows, cols });
    if (rows !== undefined) {
      tidy();
      setHead(rows);
      settle();
    }
    if (cols !== undefined) setAttribute(table, "freeze-cols", cols ? String(cols) : null);
  }

  function placeCol(el, c) {
    const next = colEls[c] ?? null;
    if (next !== null) next.before(el);
    else if (colEls.length > 0) colEls[colEls.length - 1].after(el);
    else colHome().appendChild(el);
    colEls.splice(c, 0, el);
  }

  // A row that reaches the new column gets an empty cell there. A shorter row has none to move. A
  // column added after the last one moves no cell: a row that already reaches it, which only a
  // table that needs repair has, keeps its next cell there as the new column's.
  function insertCol(c, record) {
    const col = mirror.insertCol(c, record);
    placeCol(colElement(doc, col), c);
    if (c === colEls.length - 1) return col;
    for (const row of trs) {
      const td = cellAt(row, c, false);
      if (td !== null) row.insertBefore(doc.createElement("td"), td);
    }
    return col;
  }

  // A removed cell that spanned rows can end the merge that kept a group longer than 50 rows.
  function removeCol(c) {
    const record = mirror.removeCol(c);
    colEls[c].remove();
    colEls.splice(c, 1);
    let spanned = false;
    for (const row of trs) {
      const td = cellAt(row, c, false);
      if (td === null) continue;
      if (Number(td.getAttribute("rowspan") ?? 1) > 1) spanned = true;
      td.remove();
      trimRow(row);
    }
    if (spanned) settle();
    return record;
  }

  function putCol(c, fields) {
    if ("fmt" in fields) takeOwnText(c);
    mirror.putCol(c, fields);
    const el = colEls[c];
    if ("id" in fields) setAttribute(el, "data-id", textOf(fields.id));
    if ("pos" in fields) setAttribute(el, "data-pos", textOf(fields.pos));
    if ("fmt" in fields) setAttribute(el, "fmt", textOf(fields.fmt));
    if ("hidden" in fields) setAttribute(el, "hidden", fields.hidden ? "" : null);
    if ("width" in fields) setAttribute(el, "style", widthOf(fields.width));
  }

  // A row that reaches neither column has only empty cells there, so nothing in it moves.
  function moveCol(from, to) {
    mirror.moveCol(from, to);
    if (from === to) return;
    const [el] = colEls.splice(from, 1);
    el.remove();
    placeCol(el, to);
    for (const row of trs) {
      if (cellAt(row, Math.min(from, to), false) === null) continue;
      cellAt(row, Math.max(from, to), true);
      const td = cellAt(row, from, false);
      td.remove();
      row.insertBefore(td, cellAt(row, to, false));
      trimRow(row);
    }
  }

  // The indexes of the rows an action reads or writes. A set or a format names its rows. Every
  // other kind is taken to touch every row, because the reducer reads the merges of the whole
  // sheet for it. An action of any shape gets an answer, because this runs before the reducer has
  // checked it.
  function touched(action) {
    const found = new Set();
    let every = false;
    const visit = (one) => {
      if (one === null || typeof one !== "object") return;
      if (one.t === "batch") {
        if (Array.isArray(one.actions)) one.actions.forEach(visit);
        return;
      }
      if ((one.t !== "set" && one.t !== "format") || !Array.isArray(one.cells)) {
        every = true;
        return;
      }
      for (const entry of one.cells) {
        const r = Array.isArray(entry) ? mirror.rowIndex(entry[0]) : -1;
        if (r >= 0) found.add(r);
      }
    };
    visit(action);
    return every ? trs.map((tr, r) => r) : [...found];
  }

  // Whether the table holds the rows the mirror holds: the same elements in the same order, with
  // the same number of them in a thead. A row that came, left or moved makes it false.
  const sameRows = (found) => found.head === head && found.rows.length === trs.length && found.rows.every((tr, r) => tr === trs[r]);

  // Reads the rows at these indexes from the table. What differs from the mirror is a foreign
  // write: the mirror takes it as the codec reads it, and the answer lists it by row and column
  // id. Returns null when the table and the mirror agree.
  //
  // The table's columns and its list of rows are read every time. A column record, the frozen
  // column count or the stale mark that differs, a row that came, left or moved, a row whose id
  // or position key changed, or a cell whose span or hidden mark changed means that more than
  // these rows changed: a merge reaches rows that were not read. Then no index of the mirror can
  // be trusted, so the whole table is read again and the answer says only `rescanned`. The
  // mirror takes nothing from these rows until that is decided. The parts the rows and columns
  // sit in are taken as the table has them now.
  function read(indexes) {
    const found = layout(table);
    if (!sameHead(treeModel(headAdapter, table), mirror.sheet) || !sameRows(found)) return reread();
    take(found);
    const seen = readRows(indexes.map((r) => trs[r]));
    const cols = mirror.cols();
    const rows = [];
    const cells = [];
    const puts = [];
    for (let i = 0; i < indexes.length; i++) {
      const r = indexes[i];
      const kept = mirror.rows()[r];
      const now = seen[i];
      if (r < head) now.frozen = true;
      const changed = ROW_FIELDS.filter((key) => kept[key] !== now[key]);
      if (changed.some((key) => key !== "style")) return reread();
      if (changed.length > 0) {
        rows.push({ row: kept.id, before: recordOf(kept), after: recordOf(now) });
        puts.push(() => mirror.putRow(r, { style: now.style }));
      }
      const width = Math.max(kept.cells.length, now.cells.length);
      for (let c = 0; c < width; c++) {
        const was = kept.cells[c] ?? null;
        const is = now.cells[c] ?? null;
        if (sameCell(was, is)) continue;
        if (SPAN_FIELDS.some((key) => fieldOf(was, key) !== fieldOf(is, key))) return reread();
        cells.push({ row: kept.id, col: cols[c]?.id ?? null, before: was, after: is });
        puts.push(() => mirror.putCell(r, c, is === null ? null : { ...is }));
      }
    }
    for (const put of puts) put();
    return rows.length > 0 || cells.length > 0 ? { rows, cells } : null;
  }

  // The index of the row that holds this node, or -1 when no row of this table holds it.
  function rowIndexOf(node) {
    let tr = node;
    while (tr !== null && !(tr.localName === "tr" && inTable(tr))) tr = tr.parentNode;
    if (tr === null) return -1;
    const r = mirror.rowIndex(tr.getAttribute("data-id") ?? "");
    return trs[r] === tr ? r : trs.indexOf(tr);
  }

  return {
    sheetId,
    table,
    get sheet() {
      return mirror.sheet;
    },
    rows: () => mirror.rows(),
    cols: () => mirror.cols(),
    rowIndex: (id) => mirror.rowIndex(id),
    colIndex: (id) => mirror.colIndex(id),
    frozen: () => mirror.frozen(),
    hasFormula: () => mirror.hasFormula(),
    cell: (r, c) => mirror.cell(r, c),
    putCell,
    loudly,
    insertRow,
    removeRow,
    putRow,
    moveRow,
    insertCol,
    removeCol,
    putCol,
    moveCol,
    setFrozen,
    setStale,
    bytes: () => canonicalGrid(domAdapter, table),
    touched,
    read,
    rescan,
    tidy,
    rowIndexOf,
    rowAt: (r) => trs[r] ?? null,
  };
}
