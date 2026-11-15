import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DelimitedError, detectDelimiter, parseDelimited, protectField, writeDelimited } from "../../src/grid/csv.js";

const VECTORS = JSON.parse(readFileSync(join(__dirname, "golden", "csv-vectors.json"), "utf8"));

const mulberry32 = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const ALPHABET = ["a", "Z", "1", " ", ",", ";", "\t", '"', "\r", "\n", "\r\n", "é", "🙂", "="];

describe("delimited text", () => {
  test("vectors", () => {
    expect(VECTORS.cases.length).toBeGreaterThanOrEqual(40);
    for (const c of VECTORS.cases) {
      expect([c.name, detectDelimiter(c.text)]).toEqual([c.name, c.detected]);
      if (c.error) {
        let thrown = null;
        try {
          parseDelimited(c.text, c.delimiter ? { delimiter: c.delimiter } : {});
        } catch (err) {
          thrown = err;
        }
        expect([c.name, thrown instanceof DelimitedError, thrown && thrown.code, thrown && thrown.line])
          .toEqual([c.name, true, c.error.code, c.error.line]);
      } else {
        expect([c.name, parseDelimited(c.text, c.delimiter ? { delimiter: c.delimiter } : {})])
          .toEqual([c.name, c.records]);
      }
    }
  });

  test("bad delimiters", () => {
    expect(() => parseDelimited("a", { delimiter: "ab" })).toThrow(TypeError);
    expect(() => parseDelimited("a", { delimiter: '"' })).toThrow(TypeError);
    expect(() => parseDelimited("a", { delimiter: "\n" })).toThrow(TypeError);
    expect(() => writeDelimited([["a"]], { delimiter: "" })).toThrow(TypeError);
  });

  test("writing", () => {
    expect(writeDelimited([["a", "b"], ["c", "d"]])).toBe("a,b\r\nc,d");
    expect(writeDelimited([["a,b", 'q"t', "x\ny", "z\rw"]])).toBe('"a,b","q""t","x\ny","z\rw"');
    expect(writeDelimited([[""]])).toBe('""');
    expect(writeDelimited([["", ""]])).toBe(",");
    expect(writeDelimited([["a\tb", "c"]], { delimiter: "\t" })).toBe('"a\tb"\tc');
    expect(writeDelimited([["a;b", "c"]], { delimiter: ";", eol: "\n" })).toBe('"a;b";c');
    expect(writeDelimited([])).toBe("");
    expect(writeDelimited([["Ann"], [""], ["Bob"]])).toBe("Ann\r\n\r\nBob");
    expect(writeDelimited([["Ann"], [""]])).toBe('Ann\r\n""');
    expect(writeDelimited([["a"], ["b"]], { eol: "\n" })).toBe("a\nb");
    expect(writeDelimited([["\uFEFFx", "y"]])).toBe('"\uFEFFx",y');
    expect(parseDelimited(writeDelimited([["\uFEFFx", "y"]]))).toEqual([["\uFEFFx", "y"]]);
    expect(() => writeDelimited([[]])).toThrow(TypeError);
  });

  test("round trip", () => {
    const random = mulberry32(1);
    const draw = (n) => Math.floor(random() * n);
    let checked = 0;
    for (let table = 0; table < 5000; table++) {
      const width = 1 + draw(6);
      const height = draw(7);
      const rows = [];
      for (let r = 0; r < height; r++) {
        const row = [];
        for (let c = 0; c < width; c++) {
          let field = "";
          const length = draw(7);
          for (let i = 0; i < length; i++) field += ALPHABET[draw(ALPHABET.length)];
          row.push(field);
        }
        rows.push(row);
      }
      for (const delimiter of [",", ";", "\t"]) {
        expect(parseDelimited(writeDelimited(rows, { delimiter }), { delimiter })).toEqual(rows);
        checked++;
      }
    }
    expect(checked).toBe(15000);
  });

  test("large files", () => {
    const text = Array.from({ length: 200000 }, (_, i) => `${i},x`).join("\r\n");
    let records;
    expect(() => { records = parseDelimited(text); }).not.toThrow();
    expect(records.length).toBe(200000);
    expect(records[199999]).toEqual(["199999", "x"]);
  });

  test("protect", () => {
    for (const text of ["=SUM(A1)", "+1", "-1", "@x", "\tx", "\rx", "'already"]) {
      expect(protectField(text)).toBe("'" + text);
    }
    for (const text of ["x=1", "plain", ""]) {
      expect(protectField(text)).toBe(text);
    }
  });
});
