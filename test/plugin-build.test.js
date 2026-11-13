/** @jest-environment node */
// The release layout for a first party plugin, proved on a copy of this project that has
// one: the `tally` fixture, named in the copy's manifest and kept in src/plugins/. The
// build writes dist/sap-plugins/tally.js, the built engine loads it on demand with no
// declaration in the page, the package exports its source, and propagate writes both
// ClayJS copies. This project itself ships no plugin yet.

const { execFileSync, spawnSync } = require("node:child_process");
const { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { JSDOM, VirtualConsole } = require("jsdom");
const tally = require("./plugins/tally.js").default;

jest.setTimeout(60000);

const root = join(__dirname, "..");
const node = (cwd, ...args) => spawnSync(process.execPath, args, { cwd, encoding: "utf8" });
let copy = null;
let workspace = null;
let built = null;
const open = [];

beforeAll(() => {
  copy = mkdtempSync(join(realpathSync(tmpdir()), "sap-plugin-build-"));
  for (const name of ["src", "build", "scripts", "package.json"]) cpSync(join(root, name), join(copy, name), { recursive: true });
  symlinkSync(realpathSync(join(root, "node_modules")), join(copy, "node_modules"));
  const facts = { name: tally.name, file: "tally", order: tally.order, boundaries: tally.boundaries, helpers: tally.helpers };
  writeFileSync(join(copy, "src", "plugin-manifest.js"), `export const PLUGIN_API = 1;\nexport const MANIFEST = { tally: ${JSON.stringify(facts)} };\n`);
  mkdirSync(join(copy, "src", "plugins"));
  copyFileSync(join(root, "test", "plugins", "tally.js"), join(copy, "src", "plugins", "tally.js"));

  workspace = join(copy, "workspace");
  for (const folder of ["clayjs/entries", "clayjs/src/vendor", "hyperclayjs/src/vendor", "hyper-html-api/src/codecs"]) mkdirSync(join(workspace, folder), { recursive: true });

  built = node(copy, "build/bundle.mjs");
});

afterAll(() => {
  for (const dom of open) dom.window.close();
  rmSync(copy, { recursive: true, force: true });
});

async function until(done, ms = 4000) {
  const t0 = Date.now();
  while (!done()) {
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for: " + done);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("build: a plugin the manifest names is written to dist/sap-plugins/ as a script that registers itself", () => {
  expect(built.status).toBe(0);
  expect(built.stdout).toContain("and dist/sap-plugins/ (tally)");
  const text = readFileSync(join(copy, "dist", "sap-plugins", "tally.js"), "utf8");
  expect(text.startsWith("(function(){")).toBe(true);
  expect(text.trimEnd().endsWith("w.Sap&&w.Sap.use&&w.Sap.use(d)})(SapPlugin.default);})();")).toBe(true);
  expect(text.trimEnd().split("\n").length).toBeLessThan(4);
  expect(text).not.toMatch(/\bexport\b|\bimport\b/);
});

test("check: the freshness check covers a plugin file that is stale or missing", () => {
  const file = join(copy, "dist", "sap-plugins", "tally.js");
  expect(node(copy, "build/bundle.mjs", "--check").status).toBe(0);
  appendFileSync(file, "\n// edited by hand\n");
  const stale = node(copy, "build/bundle.mjs", "--check");
  expect([stale.status, stale.stderr]).toEqual([1, expect.stringContaining("stale or missing: dist/sap-plugins/tally.js")]);
  rmSync(file);
  const missing = node(copy, "build/bundle.mjs", "--check");
  expect([missing.status, missing.stderr]).toEqual([1, expect.stringContaining("stale or missing: dist/sap-plugins/tally.js")]);
  expect(node(copy, "build/bundle.mjs").status).toBe(0);
  expect(node(copy, "build/bundle.mjs", "--check").status).toBe(0);
});

test("load: the built engine knows the plugin from its manifest and fetches dist/sap-plugins/tally.js on demand", async () => {
  const page = join(copy, "page.html");
  writeFileSync(page, `<!doctype html><html><head><meta charset="utf-8"><script src="dist/sap.min.js"></script>
    <script>document.addEventListener("DOMContentLoaded", () => { window.atMount = [document.querySelector("li[total]").textContent, document.querySelector("output").textContent, Sap.plugins.status()]; });</script></head>
    <body><main sap><ul tally="scores"><li>3</li><li>4</li><li>5</li><li total>7</li></ul><output text="tally('scores') * 2">14</output></main></body></html>`);
  const dom = await JSDOM.fromFile(page, { runScripts: "dangerously", resources: "usable", virtualConsole: new VirtualConsole() });
  open.push(dom);
  const { window } = dom;
  await until(() => window.document.readyState === "complete");
  expect(window.Sap.plugins.base).toBe(pathToFileURL(join(copy, "dist", "sap-plugins")).href + "/");
  expect(window.atMount).toEqual(["7", "14", { installed: [], loading: ["tally"], failed: [] }]);
  await until(() => window.document.querySelector("output").textContent === "24");
  expect(window.document.querySelector("li[total]").textContent).toBe("12");
  expect(window.Sap.plugins.status()).toEqual({ installed: ["tally"], loading: [], failed: [] });
  expect(window.Sap.report().errors).toHaveLength(0);
});

test("exports: a bundler user imports the definition by the package's own name", () => {
  const got = node(copy, "--input-type=module", "-e", `import def from "@panphora/sapjs/plugins/tally"; console.log(JSON.stringify([def.name, def.api, typeof def.setup]));`);
  expect([got.status, got.stdout.trim()]).toEqual([0, `["tally",1,"function"]`]);
});

test("propagate: ClayJS gets an ES module copy and a classic copy, and the check names a stale one", async () => {
  const wrote = node(copy, "scripts/propagate.js", "--root", workspace, "--only", "clayjs");
  expect([wrote.status, wrote.stderr]).toEqual([0, ""]);
  expect(wrote.stdout).toContain("clayjs/src/vendor/sap-tally.vendor.js");
  expect(wrote.stdout).toContain("clayjs/entries/sap-plugins/tally.js");

  const classic = readFileSync(join(workspace, "clayjs", "entries", "sap-plugins", "tally.js"), "utf8");
  expect(classic.startsWith("// GENERATED")).toBe(true);
  expect(classic.endsWith(readFileSync(join(copy, "dist", "sap-plugins", "tally.js"), "utf8").trim() + "\n")).toBe(true);

  const moduleCopy = join(copy, "sap-tally.vendor.mjs");
  copyFileSync(join(workspace, "clayjs", "src", "vendor", "sap-tally.vendor.js"), moduleCopy);
  const read = node(copy, "--input-type=module", "-e", `import def from ${JSON.stringify(pathToFileURL(moduleCopy).href)}; console.log(JSON.stringify([def.name, def.api, typeof def.setup, Object.keys(def.boundaries)]));`);
  expect([read.status, read.stdout.trim()]).toEqual([0, `["tally",1,"function",["tally"]]`]);

  expect(node(copy, "scripts/propagate.js", "--root", workspace, "--only", "clayjs", "--check").status).toBe(0);
  appendFileSync(join(workspace, "clayjs", "entries", "sap-plugins", "tally.js"), "// edited by hand\n");
  const stale = node(copy, "scripts/propagate.js", "--root", workspace, "--only", "clayjs", "--check");
  expect([stale.status, stale.stderr.trim()]).toEqual([1, "✗ stale: clayjs/entries/sap-plugins/tally.js"]);
  rmSync(join(workspace, "clayjs", "src", "vendor", "sap-tally.vendor.js"));
  const missing = node(copy, "scripts/propagate.js", "--root", workspace, "--only", "clayjs", "--check");
  expect(missing.stderr).toContain("✗ missing: clayjs/src/vendor/sap-tally.vendor.js");
});

test("today: this project names no plugin, builds no plugin file, and propagates the same seven files", () => {
  expect(existsSync(join(root, "dist", "sap-plugins"))).toBe(false);
  expect(existsSync(join(root, "src", "plugins"))).toBe(false);
  const empty = join(copy, "workspace-today");
  for (const folder of ["clayjs/entries", "clayjs/src/vendor", "hyperclayjs/src/vendor", "hyper-html-api/src/codecs"]) mkdirSync(join(empty, folder), { recursive: true });
  const wrote = execFileSync(process.execPath, [join(root, "scripts", "propagate.js"), "--root", empty], { encoding: "utf8" });
  expect(wrote.trim().split("\n")).toHaveLength(7);
  const checked = execFileSync(process.execPath, [join(root, "scripts", "propagate.js"), "--root", empty, "--check"], { encoding: "utf8" });
  expect(checked.trim().split("\n").map((line) => line.replace("✓ in sync ", ""))).toEqual([
    "clayjs/entries/sap.js",
    "hyperclayjs/src/vendor/sapjs.vendor.js",
    "clayjs/src/vendor/control-serialize.vendor.js",
    "hyperclayjs/src/vendor/control-serialize.vendor.js",
    "clayjs/src/vendor/sap-core.vendor.js",
    "clayjs/src/vendor/sap-ownership.vendor.js",
    "hyper-html-api/src/codecs/sheet.vendor.js",
  ]);
  expect(existsSync(join(empty, "clayjs", "entries", "sap-plugins"))).toBe(false);
});
