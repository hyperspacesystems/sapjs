// A formatter for the format codes the built-in list does not know ('0.00 "kg"', '0.00;[Red]-0.00',
// '# ?/?'), backed by numfmt. Built-in codes never reach it: format.js asks them first. Dates use
// the core's serials (no 1900 leap day), and a value a date or time code cannot show is null, as
// for the built-in codes, so the cell shows the plain value.
import { format, getFormatInfo, isValidFormat } from "numfmt";

const KINDS = { date: "date", time: "time", datetime: "datetime", percent: "percent", currency: "currency", text: "text" };
const MAX_SERIAL = 2958465;

const valid = (fmt) => {
  try {
    return isValidFormat(fmt);
  } catch {
    return false;
  }
};

const kindOf = (fmt) => KINDS[getFormatInfo(fmt).type] ?? "number";

export const numfmtFormatter = {
  test: valid,
  kind: kindOf,
  format(value, fmt) {
    if (value === null || value === undefined) return "";
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return null;
      const kind = kindOf(fmt);
      const day = Math.floor(value);
      if (kind === "time" && (value < 0 || day > MAX_SERIAL)) return null;
      if ((kind === "date" || kind === "datetime") && (day < 1 || day > MAX_SERIAL)) return null;
    }
    return format(fmt, value, { leap1900: false });
  },
};
