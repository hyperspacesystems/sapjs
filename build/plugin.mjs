// Builds one plugin source file (an ES module whose default export is the definition)
// into a classic script that registers itself. A classic script, not a module, because
// it also loads from a file address. build/bundle.mjs builds every first party plugin
// through pluginBundle(); the command is for a plugin kept anywhere else.
//
// node build/plugin.mjs <entry> <outfile>   writes the file, not minified

import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Every definition lands in window.sapPlugins, the list all engines on the page share,
// and an engine that is already there installs it now. A file that runs a second time
// finds its plugin's name in the list, adds nothing, and hands the engine the definition
// that is there. A value another script put under that name is left alone.
const REGISTER =
  "(function(d){var w=window,l=w.sapPlugins=w.sapPlugins||[];" +
  "if(Array.isArray(l)){var s=l.filter(function(x){return x&&x.name===d.name})[0];s?d=s:l.push(d)}" +
  "w.Sap&&w.Sap.use&&w.Sap.use(d)})(SapPlugin.default);";

export async function pluginBundle(entry, { minify = false } = {}) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    globalName: "SapPlugin",
    minify,
    banner: { js: "(function(){" },
    footer: { js: REGISTER + "})();" },
    write: false,
    logLevel: "warning",
  });
  return result.outputFiles[0].text;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [entry, outfile] = process.argv.slice(2);
  if (!entry || !outfile) {
    console.error("usage: node build/plugin.mjs <entry> <outfile>");
    process.exit(2);
  }
  const text = await pluginBundle(resolve(entry));
  mkdirSync(dirname(resolve(outfile)), { recursive: true });
  writeFileSync(resolve(outfile), text);
}
