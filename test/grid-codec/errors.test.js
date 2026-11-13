import { CodecMiss, scanGrid } from "../../src/grid/codec/scan.js";
import { QueryRefused, parseRange } from "../../src/grid/codec/read.js";

const thrown = (fn) => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
};

test("a miss is named CodecMiss, so hosts and the Go port can map it by name", () => {
  const error = thrown(() => scanGrid("<table grid class=\"x\"></table>", 0));
  expect(error).toBeInstanceOf(CodecMiss);
  expect(error.name).toBe("CodecMiss");
  expect(String(error)).toMatch(/^CodecMiss: grid codec:/);
});

test("a refused query is named QueryRefused and keeps its code", () => {
  const error = thrown(() => parseRange("a1"));
  expect(error).toBeInstanceOf(QueryRefused);
  expect(error.name).toBe("QueryRefused");
  expect(error.code).toBe("bad_range");
});
