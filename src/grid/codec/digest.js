// The data loss guard's row digest (shape from plan-hosts sub plan 04, D1.4, plus the occupied columns):
//   row = [rowId, filled, mass, inputsHash, columnsHash, mask]
// mask is the occupancy mask: bit i set when the cell at column index i has an
// input, as lowercase hex with no leading zeros (column 0 is the lowest bit).
// A tab's digest lists its column ids once (tabDigest), so rowChange can name
// the column behind every mask bit. A column with no id is "#<index>".
// rowChange() is the one rule a guard applies to two digests of the same row.
// An input is what a person typed: f, else v, else the text. A covered cell's
// input is empty. Hashes are FNV-1a 32 bit over UTF-8 bytes, as 8 hex digits, so
// the Go port gives the same strings. mass counts UTF-16 code units after
// String.prototype.trim, the same measure as data-loss-core's mass().

const OFFSET = 0x811c9dc5;
const PRIME = 0x01000193;

// Hashes the UTF-8 bytes of text without TextEncoder, which some test
// environments (jsdom) lack. A lone surrogate counts as U+FFFD, as in TextEncoder.
export function fnv1a(text, hash = OFFSET) {
  const step = (byte) => {
    hash = Math.imul(hash ^ byte, PRIME) >>> 0;
  };
  for (const char of text) {
    let code = char.codePointAt(0);
    if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) {
      step(code);
    } else if (code < 0x800) {
      step(0xc0 | (code >> 6));
      step(0x80 | (code & 63));
    } else if (code < 0x10000) {
      step(0xe0 | (code >> 12));
      step(0x80 | ((code >> 6) & 63));
      step(0x80 | (code & 63));
    } else {
      step(0xf0 | (code >> 18));
      step(0x80 | ((code >> 12) & 63));
      step(0x80 | ((code >> 6) & 63));
      step(0x80 | (code & 63));
    }
  }
  return hash >>> 0;
}

export const hex = (hash) => hash.toString(16).padStart(8, "0");

export function cellInput(cell) {
  if (!cell || cell.hidden) return "";
  return cell.f ?? cell.v ?? cell.text;
}

// A column with no id (missing or empty) is named by its position.
const columnId = (cols, index) => cols[index]?.id || `#${index}`;

// The id of every column of a sheet, by index: what a mask bit names.
export function columnIds(sheet) {
  return sheet.cols.map((col, index) => col?.id || `#${index}`);
}

// null for a row with no filled cell: the digest leaves those out.
export function rowDigest(row, cols) {
  let filled = 0;
  let mass = 0;
  let inputs = OFFSET;
  let columns = 0;
  const occupied = [];
  row.cells.forEach((cell, index) => {
    const input = cellInput(cell);
    inputs = fnv1a(`${input}\0`, inputs);
    if (input === "") return;
    filled++;
    mass += input.trim().length;
    columns = (columns ^ fnv1a(columnId(cols, index))) >>> 0;
    occupied.push(index);
  });
  return filled === 0 ? null : [row.id, filled, mass, hex(inputs), hex(columns), maskHex(occupied)];
}

// Column indexes as a hex bitmask, built nibble by nibble so it has no width limit.
export function maskHex(indexes) {
  const nibbles = [];
  for (const index of indexes) {
    const at = index >> 2;
    while (nibbles.length <= at) nibbles.push(0);
    nibbles[at] |= 1 << (index & 3);
  }
  while (nibbles.length > 1 && nibbles[nibbles.length - 1] === 0) nibbles.pop();
  return nibbles.length ? nibbles.reverse().map((n) => n.toString(16)).join("") : "0";
}

// The column indexes a mask sets, lowest first.
export function maskIndexes(mask) {
  const indexes = [];
  for (let i = 0; i < mask.length; i++) {
    const nibble = parseInt(mask[mask.length - 1 - i], 16);
    for (let bit = 0; bit < 4; bit++) if (nibble & (1 << bit)) indexes.push(i * 4 + bit);
  }
  return indexes;
}

const occupiedIds = (mask, cols) => maskIndexes(mask).map((index) => cols[index] || `#${index}`);

// A column the before tab knew only by position ("#<index>", or no list at all).
const positional = (cols, index) => !cols[index] || cols[index] === `#${index}`;

// How a row changed between two digests of it: "same", "modification" (a value
// overwritten, no alarm) or "destruction" (a value cleared, alarm). after is null
// when the row is gone. beforeCols and afterCols are the two tabs' column ids
// (columnIds). A column id that held an input before and holds none after is a
// cleared value: a cleared cell, a removed column, or a column replaced by
// another one at the same position, also when other columns were inserted at
// the same time. A before column with no id is the column now at its index, so
// an app that gives columns ids on first open clears nothing; for the same
// reason the column hash is not compared when no before column had an id.
// Fewer filled cells is always destruction. An empty column removed or
// inserted clears nothing.
export function rowChange(before, after, beforeCols = [], afterCols = []) {
  if (!after) return "destruction";
  if (after[1] < before[1]) return "destruction";
  const nowIds = new Set(occupiedIds(after[5], afterCols));
  const nowIndexes = new Set(maskIndexes(after[5]));
  const cleared = maskIndexes(before[5]).some((index) =>
    positional(beforeCols, index) ? !nowIndexes.has(index) : !nowIds.has(beforeCols[index]));
  if (cleared) return "destruction";
  const columnsSame = before[4] === after[4] || beforeCols.every((_, index) => positional(beforeCols, index));
  if (before[3] === after[3] && columnsSame && before[5] === after[5]) return "same";
  return "modification";
}

export function gridDigest(sheet) {
  return sheet.rows.map((row) => rowDigest(row, sheet.cols)).filter(Boolean);
}

// One tab's digest: its column ids once, and a digest per row with a filled cell.
export function tabDigest(sheet) {
  return { cols: columnIds(sheet), rows: gridDigest(sheet) };
}
