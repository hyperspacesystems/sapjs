// Format codes beyond the built-in list, through numfmt once the formatter is added.
import { addFormatter, fmtKind, formatValue } from "../../src/grid/format.js";
import { numfmtFormatter } from "../../src/grid/numfmt-formatter.js";

let remove;
beforeAll(() => {
  remove = addFormatter(numfmtFormatter);
});
afterAll(() => remove());

// Bugs these guard: numfmt called with its arguments the wrong way round; its 1900 leap day
// moving early dates by one; a date code showing "1899-12-25" for -5 instead of the plain value.
test("custom codes show their text, dates use the core's serials, and out-of-range dates show nothing", () => {
  expect(formatValue(7, '0.00 "kg"')).toBe("7.00 kg");
  expect(formatValue(-5, "0.00;[Red]-0.00")).toBe("-5.00");
  expect(formatValue(12345, '#,##0,"K"')).toBe("12K");
  expect(formatValue(1.25, "# ?/?")).toBe("1 1/4");
  expect(formatValue(2, "dddd, mmmm d, yyyy")).toBe("Monday, January 1, 1900");
  expect(formatValue(-5, "dddd, mmmm d, yyyy")).toBe(null);
  expect(formatValue(Infinity, '0.00 "kg"')).toBe(null);
  expect(formatValue(true, '0.00 "kg"')).toBe("TRUE");
});

// Bug this guards: every custom code had one fixed kind, so a custom date code was edited as a
// plain number.
test("a custom code has the kind of what it shows", () => {
  expect([fmtKind('0.00 "kg"'), fmtKind("dddd, mmmm d, yyyy"), fmtKind('0.0% "up"'), fmtKind('@" ID"'), fmtKind("not a [code")]).toEqual(["number", "date", "percent", "text", "unknown"]);
});

// Bug this guards: a grid or core module importing numfmt puts its 80 KB in every page that has a
// sheet, or every page at all. Only the grid-formats file may carry it.
test("only the grid-formats build carries numfmt", () => {
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const carries = (file) => readFileSync(join(__dirname, "..", "..", "dist", file), "utf8").includes("leap1900");
  expect(["sap.js", "sap-core.js", "sap-plugins/grid.js", "sap-plugins/grid-functions.js", "sap-plugins/grid-formats.js"].map(carries)).toEqual([false, false, false, false, true]);
});
