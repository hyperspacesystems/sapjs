// dist/ is committed, and tests, the docs and every vendored copy read it. A bundle left
// behind by a source edit would make those tests pass on old code.
import { execFileSync } from "node:child_process";
import { join } from "node:path";

test("dist/ is current with src/", () => {
  const script = join(__dirname, "..", "build", "bundle.mjs");
  expect(() => execFileSync(process.execPath, [script, "--check"], { stdio: "pipe" })).not.toThrow();
});
