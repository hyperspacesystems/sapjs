// node test/mutations/plugin-build.mjs [emit|rows|...]
// Each entry removes one part of the release layout for plugin files and names the test
// that must then fail.
import { mutate } from "./harness.mjs";

const entry = (what, file, find, replace, name, expects) => ({ what, file, find, replace, test: "test/plugin-build.test.js", name, expects });
const BUNDLE = "build/bundle.mjs";
const PROPAGATE = "scripts/propagate.js";

mutate({
  emit: entry("the build writes no plugin file", BUNDLE, "for (const file of plugins) emit(`dist/sap-plugins/${file}.js`, await pluginBundle(`${root}src/plugins/${file}.js`, { minify: true }));\n", "", "build: a plugin the manifest names", /ENOENT/),
  minify: entry("plugin files are not minified", BUNDLE, "{ minify: true }));", "{}));", "build: a plugin the manifest names", /toBeLessThan/),
  check: entry("the freshness check skips plugin files", BUNDLE, "for (const file of plugins) emit(", "for (const file of plugins) if (!check) emit(", "check: the freshness check covers a plugin file", /toEqual/),
  exports: entry("the package does not export plugin sources", "package.json", ',\n    "./plugins/*": "./src/plugins/*.js"', "", "exports: a bundler user imports the definition", /toEqual/),
  rows: entry("propagate has no plugin rows", PROPAGATE, ",\n  ...PLUGIN_DESTINATIONS", "", "propagate: ClayJS gets an ES module copy and a classic copy", /toContain/),
  "module-row": entry("propagate writes no ES module copy", PROPAGATE, "  { client: 'clayjs', path: `clayjs/src/vendor/sap-${file}.vendor.js`, build: () => buildPluginEsm(file), needsDist: false },\n", "", "propagate: ClayJS gets an ES module copy and a classic copy", /toContain/),
  "classic-row": entry("propagate writes no classic copy", PROPAGATE, ",\n  { client: 'clayjs', path: `clayjs/entries/sap-plugins/${file}.js`, build: () => buildPluginClassic(file), ownFolder: true }", "", "propagate: ClayJS gets an ES module copy and a classic copy", /toContain/),
  "module-format": entry("the ES module copy has no default export", PROPAGATE, "bundle: true, format: 'esm', minify: true", "bundle: true, format: 'iife', minify: true", "propagate: ClayJS gets an ES module copy and a classic copy", /toEqual/),
  "own-folder": entry("propagate does not create the sap-plugins folder", PROPAGATE, "  if (destination.ownFolder) fs.mkdirSync(path.dirname(path.join(workspace, destination.path)), { recursive: true })\n", "", "propagate: ClayJS gets an ES module copy and a classic copy", /toEqual/),
  "required-folder": entry("propagate refuses to run until the sap-plugins folder exists", PROPAGATE, "return destination.ownFolder ? path.dirname(folder) : folder", "return folder", "propagate: ClayJS gets an ES module copy and a classic copy", /toEqual/),
});
