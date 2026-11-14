import { MAX_SERIAL, civil, serial, isDate, fraction, clock } from "../../src/grid/dates.js";

const leap = (y) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);

describe("dates", () => {
  test("pinned serials", () => {
    const pinned = [
      [0, 1899, 12, 30],
      [2, 1900, 1, 1],
      [60, 1900, 2, 28],
      [61, 1900, 3, 1],
      [36526, 2000, 1, 1],
      [46095, 2026, 3, 14],
      [2958465, 9999, 12, 31],
    ];
    for (const [n, y, m, d] of pinned) {
      expect(civil(n)).toEqual({ y, m, d });
      expect(serial(y, m, d)).toBe(n);
    }
    expect(MAX_SERIAL).toBe(2958465);
  });

  test("every serial round trips", () => {
    let bad = 0;
    for (let n = 0; n <= MAX_SERIAL; n++) {
      const back = serial(...Object.values(civil(n)));
      if (back !== n) bad++;
    }
    expect(bad).toBe(0);
  });

  test("month lengths", () => {
    const length = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for (let y = 1900; y <= 2100; y++) {
      for (let m = 1; m <= 12; m++) {
        const last = m === 2 && leap(y) ? 29 : length[m - 1];
        expect(isDate(y, m, last)).toBe(true);
        expect(isDate(y, m, last + 1)).toBe(false);
      }
    }
    expect(isDate(1900, 2, 29)).toBe(false);
    expect(isDate(2100, 2, 29)).toBe(false);
    expect(isDate(2000, 2, 29)).toBe(true);
  });

  test("agrees with Date.UTC", () => {
    const origin = Date.UTC(1899, 11, 30);
    let bad = 0;
    for (let t = Date.UTC(1900, 2, 1); t <= Date.UTC(2100, 11, 31); t += 86400000) {
      const at = new Date(t);
      const y = at.getUTCFullYear();
      const m = at.getUTCMonth() + 1;
      const d = at.getUTCDate();
      if (serial(y, m, d) !== (Date.UTC(y, m - 1, d) - origin) / 86400000) bad++;
    }
    expect(bad).toBe(0);
  });

  test("out of range", () => {
    expect(civil(-1)).toBeNull();
    expect(civil(MAX_SERIAL + 1)).toBeNull();
    expect(civil(1.5)).toBeNull();
    expect(serial(1899, 12, 29)).toBeNull();
    expect(serial(10000, 1, 1)).toBeNull();
    expect(serial(2026, 2, 30)).toBeNull();
    expect(serial(2026, 13, 1)).toBeNull();
    expect(isDate(2026, 1, 1.5)).toBe(false);
  });

  test("fraction", () => {
    expect(fraction(12, 0, 0)).toBe(0.5);
    expect(fraction(0, 0, 0)).toBe(0);
    expect(fraction(24, 0, 0)).toBeNull();
    expect(fraction(0, 60, 0)).toBeNull();
  });

  test("clock carry", () => {
    expect(clock(0.999999)).toEqual({ day: 1, h: 0, m: 0, s: 0 });
    expect(clock(46095.75)).toEqual({ day: 46095, h: 18, m: 0, s: 0 });
    expect(clock(0.5 + 30 / 86400)).toEqual({ day: 0, h: 12, m: 0, s: 30 });
    expect(clock(NaN)).toBeNull();
    expect(clock(Infinity)).toBeNull();
  });
});
