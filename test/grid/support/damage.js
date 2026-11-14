// Seeded damage for the repair's property test: every problem checkSheet reports, put back on
// purpose. A damage never adds, removes or moves a value; it only breaks the structure around one.

const hiddenCell = () => ({ text: "", hidden: true });

const pick = (list, random) => list[Math.floor(random() * list.length)];

const recordsOf = (model) => [...model.cols, ...model.rows];

function clearId(model, random) {
  const target = pick(recordsOf(model), random);
  if (!target || target.id === "") return false;
  target.id = "";
  return true;
}

function copyId(model, random) {
  const records = recordsOf(model);
  if (records.length < 2) return false;
  const from = pick(records, random);
  const to = pick(records, random);
  if (!from || !to || from === to) return false;
  to.id = from.id;
  return true;
}

function invalidKey(model, random) {
  const target = pick(recordsOf(model), random);
  if (!target) return false;
  target.pos = pick(["0", "", "a0"], random);
  return true;
}

function swapKeys(model, random) {
  const records = recordsOf(model);
  if (records.length < 2) return false;
  const a = pick(records, random);
  const b = pick(records, random);
  if (!a || !b || a === b) return false;
  const pos = a.pos;
  a.pos = b.pos;
  b.pos = pos;
  return true;
}

function longRow(model, random) {
  if (model.rows.length === 0 || model.cols.length === 0) return false;
  const row = pick(model.rows, random);
  while (row.cells.length < model.cols.length) row.cells.push(null);
  row.cells.push(null);
  return true;
}

function dropPlaceholder(model, random) {
  const found = [];
  model.rows.forEach((row) => row.cells.forEach((cell, c) => { if (cell && cell.hidden) found.push({ row, c }); }));
  if (found.length === 0) return false;
  const target = pick(found, random);
  target.row.cells.splice(target.c, 1);
  return true;
}

function spanPastEdge(model, random) {
  let width = model.cols.length;
  for (const row of model.rows) width = Math.max(width, row.cells.length);
  if (width === 0 || model.rows.length === 0) return false;
  const r = Math.floor(random() * model.rows.length);
  const row = model.rows[r];
  if (row.cells.length === 0) return false;
  const c = Math.floor(random() * row.cells.length);
  const cell = row.cells[c];
  if (!cell) return false;
  if (random() < 0.5) cell.colspan = width - c + 1 + Math.floor(random() * 3);
  else cell.rowspan = model.rows.length - r + 1 + Math.floor(random() * 3);
  return true;
}

function orphanHidden(model, random) {
  if (model.rows.length === 0) return false;
  pick(model.rows, random).cells.push(hiddenCell());
  return true;
}

function laterFrozen(model, random) {
  const rows = model.rows;
  let first = -1;
  for (let i = 0; i < rows.length; i++) if (!rows[i].frozen) { first = i; break; }
  if (first === -1 || first === rows.length - 1) return false;
  const index = first + 1 + Math.floor(random() * (rows.length - first - 1));
  if (rows[index].frozen) return false;
  rows[index].frozen = true;
  return true;
}

export const DAMAGES = [clearId, copyId, invalidKey, swapKeys, longRow, dropPlaceholder, spanPastEdge, orphanHidden, laterFrozen];

// Applies one to four damages to the model in place and returns their names, in the order applied.
export function damage(model, random) {
  const many = 1 + Math.floor(random() * 4);
  const done = [];
  for (let i = 0; i < many; i++) {
    for (let attempt = 0; attempt < 24; attempt++) {
      const one = DAMAGES[Math.floor(random() * DAMAGES.length)];
      if (one(model, random)) {
        done.push(one.name);
        break;
      }
    }
  }
  return done;
}
