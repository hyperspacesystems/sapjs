import { formatValue, fmtKind, isBuiltin, addFormatter } from "../../src/grid/format.js";
import { oracleFormat } from "./support/decimal-oracle.js";
import { rng } from "../grid-codec/support/rng.js";

const CODES = [];
for (const currency of ["", "$"]) {
  for (const group of ["#,##0", "0"]) {
    for (let places = 0; places <= 15; places++) {
      for (const percent of ["", "%"]) {
        if (currency && percent) continue;
        CODES.push(currency + group + (places ? "." + "0".repeat(places) : "") + percent);
      }
    }
  }
}

function sample(random) {
  const pick = (n) => Math.floor(random() * n);
  const sign = random() < 0.5 ? -1 : 1;
  switch (pick(6)) {
    case 0:
      return 0;
    case 1:
      return sign * pick(1000000);
    case 2: {
      const count = 1 + pick(15);
      let digits = String(1 + pick(9));
      for (let i = 1; i < count; i++) digits += String(pick(10));
      return sign * Number(`${digits[0]}.${digits.slice(1)}e${pick(32) - 10}`);
    }
    case 3:
      return sign * Number(`${pick(1000000)}.${String(pick(1000000)).padStart(6, "0")}5`);
    case 4:
      return sign * Number(`${pick(100000)}.${String(pick(100)).padStart(2, "0")}5`);
    default:
      return sign * Number(`0.${String(pick(100000)).padStart(5, "0")}`);
  }
}

function compare(count, seed) {
  const random = rng(seed);
  const bad = [];
  let checked = 0;
  let mismatches = 0;
  for (let i = 0; i < count; i++) {
    const value = sample(random);
    const fmt = CODES[Math.floor(random() * CODES.length)];
    checked++;
    const got = formatValue(value, fmt);
    const want = oracleFormat(value, fmt);
    if (got !== want) {
      mismatches++;
      if (bad.length < 5) bad.push([value, fmt, got, want]);
    }
  }
  return { checked, mismatches, bad };
}

describe("format", () => {
  test("pinned number cases", () => {
    const pinned = [
      [1.005, "0.00", "1.01"],
      [2.675, "0.00", "2.68"],
      [999.995, "#,##0.00", "1,000.00"],
      [-0.004, "0.00", "0.00"],
      [0.082, "0.0%", "8.2%"],
      [0.125, "0%", "13%"],
      [-162.4, "$#,##0.00", "-$162.40"],
      [1e21, "#,##0", "1,000,000,000,000,000,000,000"],
      [1200, "#,##0", "1,200"],
      [1200, "0", "1200"],
      [-0.5, "0%", "-50%"],
      [0.5, "0", "1"],
      [-0.5, "0", "-1"],
      [-0.4, "0", "0"],
      [1e-7, "0.00", "0.00"],
      [0, "$#,##0.00", "$0.00"],
      [1234567.891, "#,##0.0", "1,234,567.9"],
      [0.1 + 0.2, "0.000000000000000", "0.300000000000000"],
      [999999.5, "#,##0", "1,000,000"],
      [-999.995, "$#,##0.00", "-$1,000.00"],
      [0.0005, "0.0%", "0.1%"],
      [-0.00004, "0.00%", "0.00%"],
      [0, "#,##0", "0"],
      [0, "0.000", "0.000"],
      [0, "0%", "0%"],
      [1, "0", "1"],
      [1, "#,##0.00", "1.00"],
      [1.5, "0", "2"],
      [2.5, "0", "3"],
      [-1.5, "0", "-2"],
      [2.5, "0.0", "2.5"],
      [8.5, "0", "9"],
      [-8.5, "0", "-9"],
      [12.34, "0.0", "12.3"],
      [12.35, "0.0", "12.4"],
      [1.05, "0.0", "1.1"],
      [99.99, "0.0", "100.0"],
      [99.995, "0.00", "100.00"],
      [-99.995, "0.00", "-100.00"],
      [999.999, "#,##0.00", "1,000.00"],
      [999.5, "#,##0", "1,000"],
      [0.999, "0", "1"],
      [4.999, "0.00", "5.00"],
      [0.005, "0.00", "0.01"],
      [-0.005, "0.00", "-0.01"],
      [0.05, "0", "0"],
      [0.05, "0.0", "0.1"],
      [-0.05, "0.0", "-0.1"],
      [-0.04, "0.0", "0.0"],
      [100, "#,##0", "100"],
      [999, "#,##0", "999"],
      [1000, "#,##0", "1,000"],
      [1234567, "#,##0", "1,234,567"],
      [-1234567, "#,##0", "-1,234,567"],
      [-1200, "#,##0", "-1,200"],
      [12345678, "#,##0", "12,345,678"],
      [1234567890123, "#,##0.00", "1,234,567,890,123.00"],
      [999999999999999, "#,##0", "999,999,999,999,999"],
      [1e15, "#,##0", "1,000,000,000,000,000"],
      [1e15, "0", "1000000000000000"],
      [1e21, "0", "1000000000000000000000"],
      [1e21, "$#,##0", "$1,000,000,000,000,000,000,000"],
      [1234.5678, "#,##0.000", "1,234.568"],
      [1234.5, "#,##0", "1,235"],
      [1 / 3, "0.00", "0.33"],
      [1e-15, "0.00", "0.00"],
      [0.000000000000001, "0.000000000000000", "0.000000000000001"],
      [0.0000005, "0.000000", "0.000001"],
      [0.5, "#,##0", "1"],
      [0.4, "#,##0", "0"],
      [-0.5, "$#,##0.00", "-$0.50"],
      [162.4, "$#,##0.00", "$162.40"],
      [162.4, "$#,##0", "$162"],
      [0.125, "0.00%", "12.50%"],
      [0.1, "0%", "10%"],
      [1, "0%", "100%"],
      [-1, "0%", "-100%"],
      [0.075, "0.0%", "7.5%"],
      [0.0749, "0.0%", "7.5%"],
      [0.0741, "0.0%", "7.4%"],
      [0.0685, "0.0%", "6.9%"],
      [1.0005, "0.0%", "100.1%"],
      [1.005, "0.0%", "100.5%"],
      [0.082, "0.000000000000000%", "8.200000000000000%"],
      [0.074999, "0.00%", "7.50%"],
      [0.0005, "0.000%", "0.050%"],
      [0.0005, "0.00%", "0.05%"],
      [-2.675, "0.00", "-2.68"],
      [1.005, "#,##0.00", "1.01"],
    ];
    for (const [value, fmt, want] of pinned) {
      expect([value, fmt, formatValue(value, fmt)]).toEqual([value, fmt, want]);
    }
  });

  test("not built in", () => {
    const codes = ["$0%", "0.0000000000000000", '#,##0.00 "kg"'];
    for (const fmt of codes) {
      expect(formatValue(1, fmt)).toBe(null);
      expect(isBuiltin(fmt)).toBe(false);
    }
    expect(formatValue(1, "m/d/yyyy")).toBe("12/31/1899");
    expect(isBuiltin("$#,##0.00")).toBe(true);
    expect(isBuiltin("@")).toBe(true);
  });

  test("text and other values", () => {
    expect(formatValue("abc", "#,##0")).toBe("abc");
    expect(formatValue(true, "0.00")).toBe("TRUE");
    expect(formatValue(null, "0.00")).toBe("");
    expect(formatValue(1200.5, "@")).toBe("1200.5");
  });

  test("kinds", () => {
    expect(fmtKind(null)).toBe("auto");
    expect(fmtKind("")).toBe("auto");
    expect(fmtKind("#,##0.00")).toBe("number");
    expect(fmtKind("$#,##0")).toBe("currency");
    expect(fmtKind("0.0%")).toBe("percent");
    expect(fmtKind("@")).toBe("text");
    expect(fmtKind("m/d/yyyy")).toBe("date");
  });

  test("registry", () => {
    const remove = addFormatter({ test: (f) => f === "x", format: () => "X", kind: "custom" });
    expect(formatValue(1, "x")).toBe("X");
    expect(fmtKind("x")).toBe("custom");
    const other = addFormatter({ test: (f) => f === "0.00", format: () => "nope", kind: "custom" });
    expect(formatValue(1, "0.00")).toBe("1.00");
    other();
    remove();
    expect(formatValue(1, "x")).toBe(null);
    expect(fmtKind("x")).toBe("unknown");
  });

  test("agrees with the BigInt oracle", () => {
    const { checked, mismatches, bad } = compare(20000, 20261114);
    expect(bad).toEqual([]);
    expect(mismatches).toBe(0);
    expect(checked).toBe(20000);
  });
});
