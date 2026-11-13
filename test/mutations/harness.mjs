// Proves that a test can fail. For each named mutation it copies the project into a
// scratch folder, runs one test file there to show the named tests pass, puts one bug
// back into the copy, and runs the file again. The working tree is never edited.
//
// Exit 0: every asked mutation made its named test fail with the expected message.
// Exit 1: a mutation survived (the tests still pass, or fail for another reason).
// Exit 2: the harness could not run (the control run failed, the text to replace was
//         not found exactly once, or jest could not load the suite).
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const COPIED = ["src", "test", "build", "scripts", "dist", "docs", "demos.html", "guide.md", "package.json", "jest.config.cjs", "babel.config.cjs"];

class HarnessError extends Error {}

function scratchCopy() {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "sap-mutation-"));
  for (const name of COPIED) if (existsSync(join(ROOT, name))) cpSync(join(ROOT, name), join(dir, name), { recursive: true });
  symlinkSync(realpathSync(join(ROOT, "node_modules")), join(dir, "node_modules"));
  return dir;
}

function runJest(dir, file, name) {
  const out = join(dir, "jest-result.json");
  rmSync(out, { force: true });
  const run = spawnSync(process.execPath, [join(dir, "node_modules", "jest", "bin", "jest.js"), file, "-t", name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "--json", "--outputFile", out], { cwd: dir, encoding: "utf8" });
  if (!existsSync(out)) throw new HarnessError(`jest wrote no result for ${file}:\n${run.stderr}`);
  const result = JSON.parse(readFileSync(out, "utf8"));
  if (result.numRuntimeErrorTestSuites > 0) throw new HarnessError(`jest could not load ${file}:\n${result.testResults.map((t) => t.message).join("\n")}`);
  const tests = result.testResults.flatMap((t) => t.assertionResults).filter((t) => t.status !== "pending");
  if (!tests.length) throw new HarnessError(`no test in ${file} matches "${name}"`);
  return tests;
}

function mutateOne(label, m) {
  const dir = scratchCopy();
  try {
    const control = runJest(dir, m.test, m.name);
    const red = control.filter((t) => t.status !== "passed");
    if (red.length) throw new HarnessError(`control run is not green: ${red.map((t) => t.fullName).join("; ")}`);

    const path = join(dir, m.file);
    const source = readFileSync(path, "utf8");
    const hits = source.split(m.find).length - 1;
    if (hits !== 1) throw new HarnessError(`expected the text to replace exactly once in ${m.file}, found it ${hits} times`);
    writeFileSync(path, source.replace(m.find, () => m.replace));
    if (m.build) {
      const built = spawnSync(process.execPath, [join(dir, "build", "bundle.mjs")], { cwd: dir, encoding: "utf8" });
      if (built.status !== 0) throw new HarnessError(`the mutated copy did not build:\n${built.stderr}`);
    }

    const mutant = runJest(dir, m.test, m.name);
    const failed = mutant.filter((t) => t.status === "failed");
    const expected = failed.filter((t) => m.expects.test(t.failureMessages.join("\n")));
    console.log(`${label}: ${m.what}`);
    console.log(`  control: ${control.length} test(s) green in ${m.test} -t "${m.name}"`);
    if (!expected.length) {
      console.log(failed.length
        ? `  SURVIVED: ${failed.length} test(s) failed, none with ${m.expects}:\n${failed.map((t) => "    " + t.fullName + "\n" + t.failureMessages.join("\n")).join("\n")}`
        : `  SURVIVED: all ${mutant.length} test(s) still pass with the bug restored`);
      return false;
    }
    for (const t of expected) {
      const line = t.failureMessages.join("\n").split("\n").find((l) => m.expects.test(l)) || "";
      console.log(`  mutant: FAILED "${t.fullName}"\n          ${line.trim()}`);
    }
    return true;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function mutate(mutations, asked = process.argv.slice(2)) {
  const names = asked.length ? asked : Object.keys(mutations);
  let survived = 0;
  try {
    for (const name of names) {
      if (!mutations[name]) throw new HarnessError(`unknown mutation "${name}"; known: ${Object.keys(mutations).join(", ")}`);
      if (!mutateOne(name, mutations[name])) survived++;
    }
  } catch (err) {
    if (!(err instanceof HarnessError)) throw err;
    console.error(`harness error: ${err.message}`);
    process.exit(2);
  }
  if (survived) {
    console.log(`${survived} mutation(s) survived`);
    process.exit(1);
  }
  console.log(`${names.length} mutation(s) killed`);
}
