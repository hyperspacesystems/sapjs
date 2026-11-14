import { formatValue, fmtKind, isBuiltin, adjustDecimals } from "../../src/grid/format.js";
import { MAX_SERIAL } from "../../src/grid/dates.js";

const KINDS = {
  "m/d/yyyy": "date",
  "yyyy-mm-dd": "date",
  "mmm d, yyyy": "date",
  "mmmm d, yyyy": "date",
  "mmm d": "date",
  "h:mm": "time",
  "h:mm:ss": "time",
  "h:mm AM/PM": "time",
  "h:mm:ss AM/PM": "time",
  "m/d/yyyy h:mm": "datetime",
  "m/d/yyyy h:mm:ss": "datetime",
};

function check(rows) {
  for (const [value, want] of rows) {
    for (const fmt of Object.keys(want)) {
      expect([value, fmt, formatValue(value, fmt)]).toEqual([value, fmt, want[fmt]]);
    }
  }
}

describe("format-date", () => {
  test("every date code on pinned serials", () => {
    check([
      [46095, {
        "m/d/yyyy": "3/14/2026",
        "yyyy-mm-dd": "2026-03-14",
        "mmm d, yyyy": "Mar 14, 2026",
        "mmmm d, yyyy": "March 14, 2026",
        "mmm d": "Mar 14",
        "m/d/yyyy h:mm": "3/14/2026 0:00",
        "m/d/yyyy h:mm:ss": "3/14/2026 0:00:00",
      }],
      [46095.7534375, {
        "m/d/yyyy": "3/14/2026",
        "yyyy-mm-dd": "2026-03-14",
        "mmm d, yyyy": "Mar 14, 2026",
        "mmmm d, yyyy": "March 14, 2026",
        "mmm d": "Mar 14",
        "m/d/yyyy h:mm": "3/14/2026 18:04",
        "m/d/yyyy h:mm:ss": "3/14/2026 18:04:57",
      }],
      [1, {
        "m/d/yyyy": "12/31/1899",
        "yyyy-mm-dd": "1899-12-31",
        "mmm d, yyyy": "Dec 31, 1899",
        "mmmm d, yyyy": "December 31, 1899",
        "mmm d": "Dec 31",
        "m/d/yyyy h:mm": "12/31/1899 0:00",
        "m/d/yyyy h:mm:ss": "12/31/1899 0:00:00",
      }],
      [2, {
        "m/d/yyyy": "1/1/1900",
        "yyyy-mm-dd": "1900-01-01",
        "mmm d, yyyy": "Jan 1, 1900",
        "mmmm d, yyyy": "January 1, 1900",
        "mmm d": "Jan 1",
        "m/d/yyyy h:mm": "1/1/1900 0:00",
        "m/d/yyyy h:mm:ss": "1/1/1900 0:00:00",
      }],
      [61, {
        "m/d/yyyy": "3/1/1900",
        "yyyy-mm-dd": "1900-03-01",
        "mmm d, yyyy": "Mar 1, 1900",
        "mmmm d, yyyy": "March 1, 1900",
        "mmm d": "Mar 1",
        "m/d/yyyy h:mm": "3/1/1900 0:00",
        "m/d/yyyy h:mm:ss": "3/1/1900 0:00:00",
      }],
      [36526, {
        "m/d/yyyy": "1/1/2000",
        "yyyy-mm-dd": "2000-01-01",
        "mmm d, yyyy": "Jan 1, 2000",
        "mmmm d, yyyy": "January 1, 2000",
        "mmm d": "Jan 1",
        "m/d/yyyy h:mm": "1/1/2000 0:00",
        "m/d/yyyy h:mm:ss": "1/1/2000 0:00:00",
      }],
      [MAX_SERIAL, {
        "m/d/yyyy": "12/31/9999",
        "yyyy-mm-dd": "9999-12-31",
        "mmm d, yyyy": "Dec 31, 9999",
        "mmmm d, yyyy": "December 31, 9999",
        "mmm d": "Dec 31",
        "m/d/yyyy h:mm": "12/31/9999 0:00",
        "m/d/yyyy h:mm:ss": "12/31/9999 0:00:00",
      }],
    ]);
  });

  test("every time code", () => {
    check([
      [0, { "h:mm": "0:00", "h:mm:ss": "0:00:00", "h:mm AM/PM": "12:00 AM", "h:mm:ss AM/PM": "12:00:00 AM" }],
      [0.5, { "h:mm": "12:00", "h:mm:ss": "12:00:00", "h:mm AM/PM": "12:00 PM", "h:mm:ss AM/PM": "12:00:00 PM" }],
      [46095.7534375, { "h:mm": "18:04", "h:mm:ss": "18:04:57", "h:mm AM/PM": "6:04 PM", "h:mm:ss AM/PM": "6:04:57 PM" }],
      [0.25 + 1 / 86400, { "h:mm": "6:00", "h:mm:ss": "6:00:01", "h:mm AM/PM": "6:00 AM", "h:mm:ss AM/PM": "6:00:01 AM" }],
      [0.999988, { "h:mm": "23:59", "h:mm:ss": "23:59:59", "h:mm AM/PM": "11:59 PM", "h:mm:ss AM/PM": "11:59:59 PM" }],
    ]);
  });

  test("midnight and noon in AM/PM", () => {
    expect(formatValue(0, "h:mm AM/PM")).toBe("12:00 AM");
    expect(formatValue(0.5, "h:mm AM/PM")).toBe("12:00 PM");
    expect(formatValue(13 / 24, "h:mm AM/PM")).toBe("1:00 PM");
    expect(formatValue(1 / 24, "h:mm AM/PM")).toBe("1:00 AM");
  });

  test("seconds carry into the next day", () => {
    expect(formatValue(46095 + 86399.6 / 86400, "m/d/yyyy h:mm:ss")).toBe("3/15/2026 0:00:00");
    expect(formatValue(46095 + 86399.6 / 86400, "m/d/yyyy")).toBe("3/15/2026");
  });

  test("out of range is null", () => {
    for (const value of [0, -1, MAX_SERIAL + 1, NaN, Infinity]) {
      for (const fmt of ["m/d/yyyy", "yyyy-mm-dd", "mmm d, yyyy", "mmmm d, yyyy", "mmm d", "m/d/yyyy h:mm", "m/d/yyyy h:mm:ss"]) {
        expect([value, fmt, formatValue(value, fmt)]).toEqual([value, fmt, null]);
      }
    }
    for (const value of [-0.5, NaN]) {
      for (const fmt of ["h:mm", "h:mm:ss", "h:mm AM/PM", "h:mm:ss AM/PM"]) {
        expect([value, fmt, formatValue(value, fmt)]).toEqual([value, fmt, null]);
      }
    }
    expect(formatValue(0, "h:mm")).toBe("0:00");
  });

  test("text under a date code", () => {
    expect(formatValue("soon", "m/d/yyyy")).toBe("soon");
    expect(formatValue(null, "h:mm")).toBe("");
  });

  test("unknown codes", () => {
    for (const fmt of ["dd/mm/yyyy", "yyyy", "h:mm a"]) {
      expect(formatValue(46095, fmt)).toBe(null);
      expect(fmtKind(fmt)).toBe("unknown");
      expect(isBuiltin(fmt)).toBe(false);
    }
    for (const [fmt, kind] of Object.entries(KINDS)) {
      expect([fmt, fmtKind(fmt)]).toEqual([fmt, kind]);
      expect([fmt, isBuiltin(fmt)]).toEqual([fmt, true]);
    }
  });

  test("decimals on each kind", () => {
    expect(adjustDecimals("#,##0.00", 1)).toBe("#,##0.000");
    expect(adjustDecimals("#,##0.0", -1)).toBe("#,##0");
    expect(adjustDecimals("0%", 1)).toBe("0.0%");
    expect(adjustDecimals("$#,##0", -1)).toBe("$#,##0");
    expect(adjustDecimals("0.000000000000000", 1)).toBe("0.000000000000000");
    expect(adjustDecimals(null, 1, 1.5)).toBe("0.00");
    expect(adjustDecimals(null, -1, 1.5)).toBe("0");
    expect(adjustDecimals(null, 1, 3)).toBe("0.0");
    expect(adjustDecimals(undefined, 2, 0.25)).toBe("0.0000");
    expect(adjustDecimals("", -1, 1.5)).toBe("0");
    expect(adjustDecimals(null, 1, "1.5")).toBe(null);
    for (const fmt of ["m/d/yyyy", "@", "x", "h:mm"]) {
      expect([fmt, adjustDecimals(fmt, 1, 1.5)]).toEqual([fmt, fmt]);
    }
  });
});
