import { spawnSync } from "node:child_process";
import { join } from "node:path";

global.__SAP_KEEP_CONSOLE__ = true;

const fuzz = (file) =>
  spawnSync(process.execPath, [join(__dirname, "fuzz", file), "--count", "300", "--seed", "7"], { encoding: "utf8" });

test("input fuzz, small", () => {
  const run = fuzz("input-fuzz.mjs");
  expect(run.stdout).toMatch(/failures 0/);
  expect(run.status).toBe(0);
});

test("format fuzz, small", () => {
  const run = fuzz("format-fuzz.mjs");
  expect(run.stdout).toMatch(/mismatches 0/);
  expect(run.status).toBe(0);
});
