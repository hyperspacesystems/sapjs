// How a cell's content plus its format become the saved fields (text, n, t, v, f), and how a
// saved cell reads back into content. The tab, the server and a host patch all come through
// here, so two copies of a sheet cannot drift apart. Pure: no clock, no locale, no page.

import { cellValue, shown, typed } from "./codec/value.js";
import { fmtKind, formatValue } from "./format.js";

// The saved fields of a cell: { text, n?, t?, v?, f? }. No fmt: the format field is the
// caller's. Returns null for empty content.
export function derive(content, fmt, result) {
  if (content === null || content === undefined) return null;
  if (typeof content === "number") {
    const raw = shown(content);
    const text = formatValue(content, fmt);
    const cell = { text: typeof text === "string" ? text : raw, n: true };
    if (cell.text !== raw) cell.v = raw;
    return cell;
  }
  if (typeof content === "boolean") return { text: content ? "TRUE" : "FALSE" };
  if (typeof content === "string") {
    if (content === "") return null;
    return typed(content) === content ? { text: content } : { text: content, t: true };
  }
  if (typeof content === "object" && typeof content.f === "string") {
    if (result === undefined) result = content.r;
    if (result === undefined) return { text: "", f: content.f };
    return { f: content.f, ...(derive(result, fmt) ?? { text: "" }) };
  }
  throw new TypeError(`grid content: ${String(content)} is not a number, true, false, text or a formula`);
}

// Content read back from a saved cell (a codec cell object): null for a missing or hidden cell.
export function contentOf(cell) {
  if (!cell || cell.hidden) return null;
  if (cell.f !== undefined) return { f: cell.f };
  return cellValue(cell);
}

// The cell's own fmt, else the column's fmt, else null ("automatic").
export function effectiveFmt(cell, col) {
  if (cell && cell.fmt !== undefined) return cell.fmt;
  if (col && col.fmt !== undefined) return col.fmt;
  return null;
}

// Whether a format brought by typed input is taken. Returns undefined (keep the cell's own fmt
// as it is), null (remove the cell's own fmt) or a format string (write it as the cell's own fmt).
export function adoptFmt(effective, columnFmt, brought) {
  if (brought === null || brought === undefined) return undefined;
  if (effective === null || effective === undefined || fmtKind(effective) !== fmtKind(brought)) {
    return brought === columnFmt ? null : brought;
  }
  return undefined;
}
