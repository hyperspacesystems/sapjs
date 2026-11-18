// The canonical writer: the only bytes the strict reader (scan.js) accepts.
// GRAMMAR.md is the contract; change the two together or not at all.

const FORBIDDEN = /[\r\0]/;
const MAX_COUNT = 9999999;
const EMPTY_CELL = "<td></td>";

function clean(value, what) {
  const text = String(value);
  if (FORBIDDEN.test(text)) throw new TypeError(`grid codec: ${what} holds a carriage return or NUL`);
  return text;
}

export const textEscape = (value) =>
  clean(value, "cell text").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const attrEscape = (value) =>
  clean(value, "attribute value").replace(/&/g, "&amp;").replace(/"/g, "&quot;");

const attr = (name, value) => ` ${name}="${attrEscape(value)}"`;

function count(value, min, what) {
  if (!Number.isInteger(value) || value < min || value > MAX_COUNT) {
    throw new RangeError(`grid codec: ${what} must be a whole number from ${min} to ${MAX_COUNT}`);
  }
  return value;
}

export function cellHtml(cell) {
  if (!cell) return EMPTY_CELL;
  if (typeof cell.text !== "string") throw new TypeError("grid codec: cell text must be a string");
  if (cell.hidden && cell.text !== "") throw new TypeError("grid codec: a hidden cell holds no text");
  let attrs = "";
  if (cell.n) attrs += " n";
  if (cell.t) attrs += " t";
  if (cell.f !== undefined) attrs += attr("f", cell.f);
  if (cell.v !== undefined) attrs += attr("v", cell.v);
  if (cell.fmt !== undefined) attrs += attr("fmt", cell.fmt);
  if (cell.colspan !== undefined) attrs += ` colspan="${count(cell.colspan, 2, "colspan")}"`;
  if (cell.rowspan !== undefined) attrs += ` rowspan="${count(cell.rowspan, 2, "rowspan")}"`;
  if (cell.hidden) attrs += " hidden";
  if (cell.style !== undefined) attrs += attr("style", cell.style);
  return `<td${attrs}>${textEscape(cell.text)}</td>`;
}

export function rowHtml(row) {
  const cells = row.cells.map(cellHtml);
  while (cells.length > 0 && cells[cells.length - 1] === EMPTY_CELL) cells.pop();
  const hidden = row.hidden ? " hidden" : "";
  const style = row.style !== undefined ? attr("style", row.style) : "";
  return `<tr${attr("data-id", row.id)}${attr("data-pos", row.pos)}${hidden}${style}>${cells.join("")}</tr>`;
}

export function colHtml(col) {
  let attrs = attr("data-id", col.id) + attr("data-pos", col.pos);
  if (col.fmt !== undefined) attrs += attr("fmt", col.fmt);
  if (col.hidden) attrs += " hidden";
  if (col.width !== undefined) attrs += ` style="width:${count(col.width, 0, "width")}px"`;
  return `<col${attrs}>`;
}

// The index at which each tbody starts among these data rows: every `groupSize` rows, except that
// a group never ends inside a merge down a column. A group runs on until every merge open at its
// cut has ended, since a browser draws no cell across two row groups.
export function groupStarts(rows, groupSize = 50) {
  const starts = [0];
  let start = 0;
  let open = 0;
  for (let r = 0; r < rows.length; r++) {
    if (r - start >= groupSize && open <= r) {
      starts.push(r);
      start = r;
    }
    for (const cell of rows[r].cells ?? []) if (cell && cell.rowspan > 1 && r + cell.rowspan > open) open = r + cell.rowspan;
  }
  return starts;
}

export function tableHtml(sheet, { groupSize = 50 } = {}) {
  count(groupSize, 1, "groupSize");
  const rows = sheet.rows ?? [];
  const firstData = rows.findIndex((row) => !row.frozen);
  const frozen = firstData === -1 ? rows : rows.slice(0, firstData);
  const data = firstData === -1 ? [] : rows.slice(firstData);
  if (data.some((row) => row.frozen)) throw new TypeError("grid codec: frozen rows come before every other row");

  let html = "<table grid";
  if (sheet.freezeCols) html += ` freeze-cols="${count(sheet.freezeCols, 1, "freezeCols")}"`;
  if (sheet.stale) html += " stale";
  html += `><colgroup>${(sheet.cols ?? []).map(colHtml).join("")}</colgroup>\n`;

  if (frozen.length > 0) html += `<thead>\n${frozen.map(rowHtml).join("\n")}\n</thead>`;

  const starts = groupStarts(data, groupSize);
  for (let g = 0; g < starts.length; g++) {
    const group = data.slice(starts[g], starts[g + 1] ?? data.length);
    html += "<tbody>\n";
    if (group.length > 0) html += `${group.map(rowHtml).join("\n")}\n`;
    html += "</tbody>";
  }

  return `${html}</table>`;
}
