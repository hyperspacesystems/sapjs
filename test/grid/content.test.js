import { readFileSync } from "node:fs";
import { join } from "node:path";

import { adoptFmt, contentOf, derive, effectiveFmt } from "../../src/grid/content.js";
import { cellHtml } from "../../src/grid/codec/write.js";
import { patchGrid } from "../../src/grid/codec/patch.js";
import { gridModel } from "../../src/grid/codec/read.js";
import { shown, typed } from "../../src/grid/codec/value.js";
import { rng } from "../grid-codec/support/rng.js";

global.__SAP_KEEP_CONSOLE__ = true;

const GOLDEN = join(__dirname, "..", "grid-codec", "golden");

const CODES = [
  "m/d/yyyy",
  "yyyy-mm-dd",
  "mmm d, yyyy",
  "mmmm d, yyyy",
  "mmm d",
  "h:mm",
  "h:mm:ss",
  "h:mm AM/PM",
  "h:mm:ss AM/PM",
  "m/d/yyyy h:mm",
  "m/d/yyyy h:mm:ss",
];

const FORMATS = [
  null,
  "0",
  "0.00",
  "0.000",
  "#,##0",
  "#,##0.00",
  "#,##0.00000",
  "$#,##0",
  "$#,##0.00",
  "0%",
  "0.00%",
  "@",
  '0.0 "kg"',
  ...CODES,
];

const WORDS = ["abc", "hello world", "  a  ", "a<b", 'quote "x"', "line\nbreak", "Rent"];

function numberSample(random) {
  const pick = (n) => Math.floor(random() * n);
  const sign = random() < 0.5 ? -1 : 1;
  switch (pick(4)) {
    case 0:
      return sign * pick(1000000);
    case 1: {
      const count = 1 + pick(15);
      let digits = String(1 + pick(9));
      for (let i = 1; i < count; i++) digits += String(pick(10));
      return sign * Number(`${digits[0]}.${digits.slice(1)}e${pick(32) - 10}`);
    }
    case 2:
      return sign * Number(`${pick(100000)}.${String(pick(10000)).padStart(4, "0")}`);
    default:
      return sign * Number(`${pick(1000)}.${String(pick(1000)).padStart(3, "0")}5`);
  }
}

function stringSample(random) {
  const pick = (n) => Math.floor(random() * n);
  switch (pick(5)) {
    case 0:
      return WORDS[pick(WORDS.length)];
    case 1:
      return String(pick(100000));
    case 2:
      return String(pick(10000)).padStart(3 + pick(6), "0");
    case 3:
      return ["TRUE", "FALSE", "-5", " 5", "007", "1200", "1,200", "1e5", "+5"][pick(9)];
    default: {
      const length = 1 + pick(12);
      let text = "";
      const alphabet = "ab XY019_<>&\"\n-$%.";
      for (let i = 0; i < length; i++) text += alphabet[pick(alphabet.length)];
      return text;
    }
  }
}

function contentSample(random) {
  const pick = (n) => Math.floor(random() * n);
  switch (pick(4)) {
    case 0:
      return typed(shown(numberSample(random)));
    case 1:
      return random() < 0.5;
    case 2:
      return stringSample(random);
    default:
      return { f: "=A1+" + pick(1000) };
  }
}

test("pinned cells", () => {
  expect(derive(1200, null)).toEqual({ text: "1200", n: true });
  expect(derive(1200, "#,##0")).toEqual({ text: "1,200", n: true, v: "1200" });
  expect(derive(0.5, "0%")).toEqual({ text: "50%", n: true, v: "0.5" });
  expect(derive(46095, "m/d/yyyy")).toEqual({ text: "3/14/2026", n: true, v: "46095" });
  expect(derive(5, '0.0 "kg"')).toEqual({ text: "5", n: true });
  expect(derive(true, "0.00")).toEqual({ text: "TRUE" });
  expect(derive(false, "#,##0")).toEqual({ text: "FALSE" });
  expect(derive("abc", null)).toEqual({ text: "abc" });
  expect(derive("1200", null)).toEqual({ text: "1200", t: true });
  expect(derive("TRUE", null)).toEqual({ text: "TRUE", t: true });
  expect(derive("", null)).toBeNull();
  expect(derive(null, "0.00")).toBeNull();
  expect(derive({ f: "=A1" }, null)).toEqual({ text: "", f: "=A1" });
  expect(derive({ f: "=A1*2" }, "#,##0", 2400)).toEqual({ f: "=A1*2", text: "2,400", n: true, v: "2400" });
  expect(derive({ f: "=B1" }, null, "x")).toEqual({ f: "=B1", text: "x" });
  expect(derive({ f: "=B1" }, "#,##0", null)).toEqual({ f: "=B1", text: "" });
});

test("contentOf reads cells back", () => {
  expect(contentOf(null)).toBeNull();
  expect(contentOf({ text: "", hidden: true })).toBeNull();
  expect(contentOf({ text: "1,200", n: true, v: "1200" })).toBe(1200);
  expect(contentOf({ text: "1200", t: true })).toBe("1200");
  expect(contentOf({ text: "", f: "=A1" })).toEqual({ f: "=A1" });
  expect(contentOf({ text: "TRUE" })).toBe(true);
});

const same = (a, b) =>
  typeof a === "object" && a !== null ? JSON.stringify(a) === JSON.stringify(b) : Object.is(a, b);

test("law N1: content survives derive and read back", () => {
  const random = rng(20261115);
  const pick = (n) => Math.floor(random() * n);
  const failures = [];
  let checked = 0;
  for (let i = 0; i < 20000; i++) {
    const content = contentSample(random);
    const fmt = FORMATS[pick(FORMATS.length)];
    const saved = derive(content, fmt);
    const back = contentOf(saved);
    checked++;
    if (!same(back, content) && failures.length < 5) failures.push({ content, fmt, saved, back });
  }
  expect(failures).toEqual([]);
  expect(checked).toBe(20000);
});

test("law N2: derive with no format writes what a host patch writes", () => {
  const src = readFileSync(join(GOLDEN, "tiny.html"), "utf8");
  const values = JSON.parse(readFileSync(join(GOLDEN, "host-vectors.json"), "utf8")).values.cells;
  const a1 = gridModel(src, 0).rows[0].cells[0];
  const kept = {};
  for (const key of ["fmt", "colspan", "rowspan", "style"]) if (a1[key] !== undefined) kept[key] = a1[key];
  const extras = [0, -162.4, 1e21, "007", "TRUE", "a<b", "=SUM(A1:A2)"];
  let compared = 0;
  for (const [, , value] of values) {
    if (value === null) continue;
    compared++;
    compare(value);
  }
  for (const value of extras) {
    compared++;
    compare(value);
  }
  console.log(`law N2 compared ${compared} values`);
  expect(compared).toBeGreaterThan(0);

  function compare(value) {
    const { bytes } = patchGrid(src, [{ range: "A1", values: [[value]] }]);
    const line = bytes.split("\n").find((text) => text.startsWith('<tr data-id="r1"'));
    const start = line.indexOf("<td");
    const end = line.indexOf("</td>", start) + "</td>".length;
    const content = typeof value === "string" && value.startsWith("=") ? { f: value } : value;
    expect(line.slice(start, end)).toBe(cellHtml({ ...derive(content, null), ...kept }));
  }
});

test("effective format", () => {
  expect(effectiveFmt({ text: "1", fmt: "0.00" }, { fmt: "#,##0" })).toBe("0.00");
  expect(effectiveFmt({ text: "1" }, { fmt: "#,##0" })).toBe("#,##0");
  expect(effectiveFmt({ text: "1" }, { id: "c" })).toBeNull();
  expect(effectiveFmt(null, null)).toBeNull();
});

test("adopting a typed format", () => {
  expect(adoptFmt(null, null, "#,##0")).toBe("#,##0");
  expect(adoptFmt("0.00", null, "#,##0")).toBeUndefined();
  expect(adoptFmt("0.00", null, "$#,##0")).toBe("$#,##0");
  expect(adoptFmt("m/d/yyyy", "#,##0", "#,##0")).toBeNull();
  expect(adoptFmt("0.00", "0.00", "#,##0")).toBeUndefined();
  expect(adoptFmt(null, null, null)).toBeUndefined();
});
