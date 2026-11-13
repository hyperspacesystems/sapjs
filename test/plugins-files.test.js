/** @jest-environment node */
// The built bundles and a built plugin file on pages opened from disk, the way a
// browser runs them: real script tags, a real document.currentScript, and plugin files
// fetched from the sap-plugins/ folder beside the engine. jsdom runs every script.

const { execFileSync } = require("node:child_process");
const { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");

const root = join(__dirname, "..");
let dir = null;
const open = [];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "sap-plugin-files-"));
  for (const name of ["sap.js", "sap.min.js", "sap-core.js"]) copyFileSync(join(root, "dist", name), join(dir, name));
  execFileSync("node", [join(root, "build", "plugin.mjs"), join(root, "test", "plugins", "tally.js"), join(dir, "sap-plugins", "tally.js")]);
});

afterAll(() => {
  for (const dom of open) dom.window.close();
  rmSync(dir, { recursive: true, force: true });
});

const LIST = `<ul tally="scores"><li>3</li><li>4</li><li>5</li><li total>7</li></ul>`;
const TALLY_FACTS = `{ name: "tally", boundaries: { tally: { opaque: true } }, helpers: ["tally"] }`;
// Runs right after the engine mounts: the engine's own DOMContentLoaded listener was added first.
const AT_MOUNT = `<script>
  document.addEventListener("DOMContentLoaded", () => {
    window.atMount = {
      total: document.querySelector("li[total]") && document.querySelector("li[total]").textContent,
      double: document.querySelector("output").textContent,
      status: Sap.plugins.status(),
    };
  });
</script>`;
// Every script tag added to the head after this point, as [src, clay].
const WATCH_TAGS = `<script>
  window.added = [];
  new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) if (node.localName === "script") window.added.push([node.src, node.getAttribute("clay")]);
  }).observe(document.head, { childList: true });
</script>`;

async function page(name, html) {
  const file = join(dir, name);
  writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8">${html}</html>`);
  const dom = await JSDOM.fromFile(file, { runScripts: "dangerously", resources: "usable", virtualConsole: new VirtualConsole() });
  open.push(dom);
  await until(() => dom.window.document.readyState === "complete");
  return dom.window;
}

async function until(done, ms = 4000) {
  const t0 = Date.now();
  while (!done()) {
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for: " + done);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const text = (window, selector) => window.document.querySelector(selector).textContent;

test("lazy: a declared plugin loads from the folder beside the engine after the first pass", async () => {
  const window = await page("lazy.html", `<script src="sap.min.js"></script>
    <script>Sap.plugins.declare(${TALLY_FACTS});</script>${AT_MOUNT}${WATCH_TAGS}</head>
    <body><main sap>${LIST}<output text="tally('scores') * 2">14</output></main></body>`);
  expect(window.Sap.plugins.base).toBe("file://" + dir + "/sap-plugins/");
  expect(window.atMount).toEqual({ total: "7", double: "14", status: { installed: [], loading: ["tally"], failed: [] } });
  await until(() => window.Sap.plugins.has("tally"));
  await until(() => text(window, "output") === "24");
  expect(text(window, "li[total]")).toBe("12");
  expect(window.added).toEqual([["file://" + dir + "/sap-plugins/tally.js", "editor-ui"]]);
  expect(window.document.querySelectorAll("script[clay]")).toHaveLength(0);
  expect(window.sapPlugins).toHaveLength(1);
  expect(window.Sap.tally.engine).toBe(window.Sap.version);
  expect(window.Sap.report().errors).toHaveLength(0);
});

test("eager: a plugin tag before the engine tag installs before the first pass, and nothing is fetched", async () => {
  const window = await page("eager.html", `<script src="sap-plugins/tally.js"></script>
    <script>window.before = { list: window.sapPlugins.length, engine: typeof window.Sap };</script>
    <script src="sap.js"></script>${AT_MOUNT}${WATCH_TAGS}</head>
    <body><main sap>${LIST}<output text="tally('scores') * 2">14</output></main></body>`);
  expect(window.before).toEqual({ list: 1, engine: "undefined" });
  expect(window.atMount).toEqual({ total: "12", double: "24", status: { installed: ["tally"], loading: [], failed: [] } });
  expect(window.sapPlugins).toHaveLength(1);
  expect(window.added).toEqual([]);
  expect(window.Sap.report().errors).toHaveLength(0);
});

test("after: a plugin tag after the engine tag installs through window.Sap.use", async () => {
  const window = await page("after.html", `<script src="sap.js"></script>
    <script src="sap-plugins/tally.js"></script>${AT_MOUNT}</head>
    <body><main sap>${LIST}<output text="tally('scores') * 2">14</output></main></body>`);
  expect(window.atMount).toEqual({ total: "12", double: "24", status: { installed: ["tally"], loading: [], failed: [] } });
  expect(window.sapPlugins).toHaveLength(1);
});

test("twice: a plugin file that runs again adds no second definition, before the engine or after it", async () => {
  const window = await page("twice.html", `<script src="sap-plugins/tally.js"></script>
    <script src="sap-plugins/tally.js"></script>
    <script>window.before = window.sapPlugins.slice();</script>
    <script src="sap.js"></script>
    <script src="sap-plugins/tally.js"></script>${AT_MOUNT}</head>
    <body><main sap>${LIST}<output text="tally('scores') * 2">14</output></main></body>`);
  expect(window.before).toHaveLength(1);
  expect(window.sapPlugins).toHaveLength(1);
  expect(window.sapPlugins[0]).toBe(window.before[0]);
  expect(window.atMount).toEqual({ total: "12", double: "24", status: { installed: ["tally"], loading: [], failed: [] } });
  expect(window.Sap.report().errors).toHaveLength(0);
});

test("data: an engine whose script has a data: address starts and paints, with no folder for plugin files", async () => {
  const engine = Buffer.from(readFileSync(join(root, "dist", "sap.min.js"), "utf8")).toString("base64");
  const window = await page("data.html", `<script src="data:text/javascript;base64,${engine}"></script></head>
    <body><main sap state="n:num" n="2"><b text="state.n * 2">0</b></main></body>`);
  expect(typeof window.Sap).toBe("function");
  expect(window.Sap.plugins.base).toBe(null);
  expect(text(window, "b")).toBe("4");
  expect(window.Sap.report().errors).toHaveLength(0);
});

test("foreign: a plugin file leaves another script's window.sapPlugins alone and still installs", async () => {
  const window = await page("foreign.html", `<script>window.sapPlugins = "taken by another script";</script>
    <script src="sap.js"></script>
    <script src="sap-plugins/tally.js"></script>${AT_MOUNT}</head>
    <body><main sap>${LIST}<output text="tally('scores') * 2">14</output></main></body>`);
  expect(window.atMount).toEqual({ total: "12", double: "24", status: { installed: ["tally"], loading: [], failed: [] } });
  expect(window.sapPlugins).toBe("taken by another script");
});

test("missing: a plugin file that is not there leaves the boundary as saved, reports E52, and the rest paints", async () => {
  const window = await page("missing.html", `<script src="sap.js"></script>
    <script>
      Sap.plugins.retryDelays.length = 0;
      Sap.plugins.declare({ name: "ghost", boundaries: { ghost: { opaque: true } } });
      window.heard = [];
      document.addEventListener("sap:plugin-failed", (e) => window.heard.push([e.detail.plugin, e.detail.error.message]));
    </script></head>
    <body><main sap state="n:num" n="4"><div ghost>saved <b text="state.n">old</b></div><output text="state.n + 1">stale</output></main></body>`);
  await until(() => window.Sap.plugins.status().failed.length === 1);
  await until(() => window.Sap.report().errors.length === 1);
  const address = "file://" + dir + "/sap-plugins/ghost.js";
  expect(window.heard).toEqual([["ghost", "could not load " + address]]);
  expect(window.Sap.report().errors.map((e) => [e.code, e.el, e.problem])).toEqual([["E52", "main[sap] > div", `the "ghost" plugin did not load: could not load ${address}`]]);
  expect(window.document.querySelector("[ghost]").outerHTML).toBe(`<div ghost="" sap-error="E52">saved <b text="state.n">old</b></div>`);
  expect(text(window, "output")).toBe("5");
  expect(window.document.querySelectorAll("script[clay]")).toHaveLength(0);
});

test("takeover: the core installs a plugin, and full sapjs installs it again when it takes the page over", async () => {
  const window = await page("takeover.html", `<script src="sap-plugins/tally.js"></script>
    <script src="sap-core.js"></script>
    <script>window.coreSap = window.Sap;</script>${AT_MOUNT}</head>
    <body><main sap>${LIST}<output text="tally('scores') * 2">14</output></main></body>`);
  const core = window.coreSap;
  expect(core.core).toBe(true);
  expect(window.atMount).toEqual({ total: "12", double: "24", status: { installed: ["tally"], loading: [], failed: [] } });
  expect(core._registry.size).toBe(1);

  const full = window.document.createElement("script");
  full.src = "sap.js";
  window.document.head.appendChild(full);
  await until(() => window.Sap !== core);
  expect(window.Sap.core).toBeUndefined();
  expect(core._registry.size).toBe(0);
  expect(core.plugins.status().installed).toEqual([]);
  expect(window.Sap._registry.size).toBe(1);
  expect(window.Sap.plugins.status().installed).toEqual(["tally"]);
  expect(window.Sap.tally).not.toBe(core.tally);
  expect(window.sapPlugins).toHaveLength(1);

  const coreReads = core.tally.reads();
  const fullReads = window.Sap.tally.reads();
  window.document.querySelector("li").textContent = "30";
  await until(() => text(window, "li[total]") === "39");
  expect(text(window, "output")).toBe("78");
  expect(core.tally.reads()).toBe(coreReads);
  expect(window.Sap.tally.reads()).toBe(fullReads + 3);
});
