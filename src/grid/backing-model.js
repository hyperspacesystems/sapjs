// The model backing: a store over a codec sheet model (GRAMMAR.md) that works by
// position and holds no rules. The reducer puts the rules on top.

const trim = (cells) => {
  while (cells.length > 0 && cells[cells.length - 1] === null) cells.pop();
};

const copyCell = (cell) => (cell ? { ...cell } : null);

function copySheet(sheet) {
  const copy = { ...sheet };
  copy.cols = (sheet.cols ?? []).map((col) => ({ ...col }));
  copy.rows = (sheet.rows ?? []).map((row) => ({ ...row, cells: (row.cells ?? []).map(copyCell) }));
  return copy;
}

const formulasIn = (cells) => cells.filter((cell) => cell && cell.f !== undefined).length;

export function modelBacking(sheet, { sheetId = null } = {}) {
  const store = copySheet(sheet);
  const rowIds = new Map();
  const colIds = new Map();
  let formulas = 0;

  const indexRows = () => {
    rowIds.clear();
    store.rows.forEach((row, i) => rowIds.set(row.id, i));
  };
  const indexCols = () => {
    colIds.clear();
    store.cols.forEach((col, i) => colIds.set(col.id, i));
  };
  indexRows();
  indexCols();
  formulas = store.rows.reduce((sum, row) => sum + formulasIn(row.cells), 0);

  const putFields = (record, fields, keys) => {
    for (const key of keys) {
      if (!(key in fields)) continue;
      if (fields[key] === undefined) delete record[key];
      else record[key] = fields[key];
    }
  };

  return {
    sheetId,
    sheet: store,
    rows: () => store.rows,
    cols: () => store.cols,
    rowIndex: (id) => rowIds.get(id) ?? -1,
    colIndex: (id) => colIds.get(id) ?? -1,
    frozen: () => ({
      rows: store.rows.filter((row) => row.frozen).length,
      cols: store.freezeCols ?? 0,
    }),
    hasFormula: () => formulas > 0,
    cell: (r, c) => store.rows[r].cells[c] ?? null,

    putCell(r, c, cell) {
      const cells = store.rows[r].cells;
      const before = cells[c] ?? null;
      while (cells.length <= c) cells.push(null);
      cells[c] = cell ?? null;
      trim(cells);
      const had = before && before.f !== undefined;
      const has = cell != null && cell.f !== undefined;
      if (had && !has) formulas -= 1;
      if (!had && has) formulas += 1;
    },

    insertRow(r, record) {
      const row = { id: record.id, pos: record.pos, cells: (record.cells ?? []).map(copyCell) };
      if (record.frozen !== undefined) row.frozen = record.frozen;
      if (record.style !== undefined) row.style = record.style;
      trim(row.cells);
      store.rows.splice(r, 0, row);
      indexRows();
      formulas += formulasIn(row.cells);
      return row;
    },

    removeRow(r) {
      const [record] = store.rows.splice(r, 1);
      formulas -= formulasIn(record.cells);
      rowIds.delete(record.id);
      for (let i = r; i < store.rows.length; i++) rowIds.set(store.rows[i].id, i);
      return record;
    },

    putRow(r, fields) {
      putFields(store.rows[r], fields, ["id", "pos", "frozen", "style"]);
      indexRows();
    },

    moveRow(from, to) {
      const [row] = store.rows.splice(from, 1);
      store.rows.splice(to, 0, row);
      indexRows();
    },

    insertCol(c, record) {
      const col = { id: record.id, pos: record.pos };
      if (record.fmt !== undefined) col.fmt = record.fmt;
      if (record.width !== undefined) col.width = record.width;
      store.cols.splice(c, 0, col);
      indexCols();
      for (const row of store.rows) if (row.cells.length > c) row.cells.splice(c, 0, null);
      return col;
    },

    removeCol(c) {
      const [record] = store.cols.splice(c, 1);
      indexCols();
      for (const row of store.rows) {
        if (c >= row.cells.length) continue;
        const [cell] = row.cells.splice(c, 1);
        if (cell && cell.f !== undefined) formulas -= 1;
        trim(row.cells);
      }
      return record;
    },

    putCol(c, fields) {
      putFields(store.cols[c], fields, ["id", "pos", "fmt", "width"]);
      indexCols();
    },

    moveCol(from, to) {
      const [col] = store.cols.splice(from, 1);
      store.cols.splice(to, 0, col);
      indexCols();
      for (const row of store.rows) {
        const cells = row.cells;
        while (cells.length <= Math.max(from, to)) cells.push(null);
        const [cell] = cells.splice(from, 1);
        cells.splice(to, 0, cell);
        trim(cells);
      }
    },

    setFrozen({ rows, cols } = {}) {
      if (rows !== undefined) {
        store.rows.forEach((row, i) => {
          if (i < rows) row.frozen = true;
          else delete row.frozen;
        });
      }
      if (cols !== undefined) {
        if (cols) store.freezeCols = cols;
        else delete store.freezeCols;
      }
    },

    setStale(flag) {
      if (flag) store.stale = true;
      else delete store.stale;
    },
  };
}
