import { fraction, serial } from "../../src/grid/dates.js";
import { parseInput } from "../../src/grid/input.js";
import { shown, typed } from "../../src/grid/codec/value.js";

const saved = (x) => typed(shown(x));

const TODAY = 46095;

function check(cases, options = {}) {
  for (const [typed, content, fmt] of cases) {
    expect([typed, parseInput(typed, options)]).toEqual([typed, { content, fmt }]);
  }
}

describe("input-date", () => {
  test("date forms", () => {
    check([
      ["3/14/2026", 46095, "m/d/yyyy"],
      ["03/14/2026", 46095, "m/d/yyyy"],
      ["3/4/2026", serial(2026, 3, 4), "m/d/yyyy"],
      ["3-14-2026", 46095, "m/d/yyyy"],
      ["03-04-2026", serial(2026, 3, 4), "m/d/yyyy"],
      ["2026-03-14", 46095, "yyyy-mm-dd"],
      ["Mar 14, 2026", 46095, "mmm d, yyyy"],
      ["march 14 2026", 46095, "mmm d, yyyy"],
      ["MARCH 14 2026", 46095, "mmm d, yyyy"],
      ["14 Mar 2026", 46095, "mmm d, yyyy"],
      ["1/1/1900", 2, "m/d/yyyy"],
      ["12/31/9999", 2958465, "m/d/yyyy"],
    ]);
    check([
      ["3/14", 46095, "m/d/yyyy"],
      ["03/04", serial(2026, 3, 4), "m/d/yyyy"],
      ["Mar 14", 46095, "mmm d, yyyy"],
      ["March 4", serial(2026, 3, 4), "mmm d, yyyy"],
    ], { today: TODAY });
  });

  test("two-digit years", () => {
    check([
      ["1/1/29", serial(2029, 1, 1), "m/d/yyyy"],
      ["1/1/30", serial(1930, 1, 1), "m/d/yyyy"],
      ["1/1/00", serial(2000, 1, 1), "m/d/yyyy"],
      ["12/31/99", serial(1999, 12, 31), "m/d/yyyy"],
      ["1-1-29", serial(2029, 1, 1), "m/d/yyyy"],
      ["1-1-30", serial(1930, 1, 1), "m/d/yyyy"],
    ]);
  });

  test("not a date", () => {
    check([
      ["2/30/2026", "2/30/2026"],
      ["13/1/2026", "13/1/2026"],
      ["2/29/2025", "2/29/2025"],
      ["12/31/1899", "12/31/1899"],
      ["1/1/10000", "1/1/10000"],
      ["Sept 1, 2026", "Sept 1, 2026"],
      ["2026/03/14", "2026/03/14"],
      ["3/14/26/1", "3/14/26/1"],
      ["2/30", "2/30"],
    ], { today: TODAY });
    check([["3/14", "3/14"], ["Mar 14", "Mar 14"], ["2/30", "2/30"]]);
  });

  test("times", () => {
    check([
      ["12:30", saved(fraction(12, 30, 0)), "h:mm"],
      ["0:00", saved(fraction(0, 0, 0)), "h:mm"],
      ["23:59:59", saved(fraction(23, 59, 59)), "h:mm:ss"],
      ["6:05 PM", saved(fraction(18, 5, 0)), "h:mm AM/PM"],
      ["6:05 pm", saved(fraction(18, 5, 0)), "h:mm AM/PM"],
      ["12:00 AM", saved(fraction(0, 0, 0)), "h:mm AM/PM"],
      ["12:00 PM", saved(fraction(12, 0, 0)), "h:mm AM/PM"],
      ["6:05:09 am", saved(fraction(6, 5, 9)), "h:mm:ss AM/PM"],
    ]);
    check([
      ["24:00", "24:00"],
      ["12:60", "12:60"],
      ["13:00 PM", "13:00 PM"],
      ["0:00 AM", "0:00 AM"],
      ["1:5", "1:5"],
    ]);
  });

  test("date-times", () => {
    check([
      ["3/14/2026 18:05", saved(46095 + fraction(18, 5, 0)), "m/d/yyyy h:mm"],
      ["2026-03-14 6:05:09 PM", saved(46095 + fraction(18, 5, 9)), "m/d/yyyy h:mm:ss"],
      ["Mar 14, 2026 6:05 PM", saved(46095 + fraction(18, 5, 0)), "m/d/yyyy h:mm"],
    ]);
    check([["3/14/2026  18:05", "3/14/2026  18:05"]]);
  });

  test("typed times keep the saved value", () => {
    expect(parseInput("12:30").content).toBe(0.520833333333333);
    expect(parseInput("3/14/2026 18:05").content).toBe(46095.7534722222);
    for (const text of ["12:30", "6:05:09 PM", "23:59:59", "1:01", "3/14/2026 18:05", "2026-03-14 6:05:09 PM"]) {
      const { content } = parseInput(text);
      expect([text, typed(shown(content))]).toEqual([text, content]);
    }
  });
});
