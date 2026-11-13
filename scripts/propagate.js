#!/usr/bin/env node

// Every copy of sapjs in the workspace, in one table. Two scripts used to own
// this: copy-to-clayjs.js wrote clayjs/sap.js, copy-to-hyperclayjs.js wrote both
// hyperclayjs vendor files, and nothing at all wrote clayjs's control-serialize
// copy — it stayed correct by hand while clayjs/src/core/persist.js imported it
// on the save path. Editing the source and running both scripts printed success
// twice and left clayjs on the old serializer. One table makes a forgotten
// destination structurally impossible: a missing path is a failure, not a
// destination to skip quietly.
//
// `--only <client>` narrows the table to one client's destinations; `--check`
// writes nothing and exits 1 naming every destination that is missing or stale;
// `--root <dir>` replaces the workspace folder the destinations resolve against.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { buildSync } from 'esbuild'
import { MANIFEST } from '../src/plugin-manifest.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')
// `--root <dir>` resolves every destination against <dir> instead of the folder
// holding sapjs, so a run from a worktree can write into another worktree.
const rootIndex = process.argv.indexOf('--root')
if (rootIndex !== -1 && !process.argv[rootIndex + 1]) {
  console.error('Error: --root needs a directory.')
  process.exit(1)
}
const workspace = rootIndex === -1 ? path.join(rootDir, '..') : path.resolve(process.argv[rootIndex + 1])

const distFile = path.join(rootDir, 'dist', 'sap.min.js')
const serializeSrc = path.join(rootDir, 'src', 'control-serialize.js')
const coreDistFile = path.join(rootDir, 'dist', 'sap-core.min.js')
const ownershipSrc = path.join(rootDir, 'src', 'ownership.js')

// clayjs loads sap.js as a plain <script>, so this wrapper is CLASSIC-SAFE: it
// must NOT contain export syntax, and the whole dist is wrapped in an outer IIFE
// so esbuild's `var Sap` namespace binding never leaks to window. The dist
// assigns window.Sap = Sap.default itself (the native carve-out); we mirror that
// onto clay.Sap and register a resolved clay.loaded.sap for uniformity with the
// async satellites.
const SAP_CLASSIC_HEADER = `// GENERATED — do not edit. Vendored from sapjs/dist/sap.min.js via sapjs
// \`npm run copy-to-clayjs\`. Edit the sapjs source and re-run.
`

const SAP_CLASSIC_PREFIX = `(function () {
`

const SAP_CLASSIC_SUFFIX = `
var sapDefault = Sap.default;
window.clay = window.clay || {};
window.clay.Sap = sapDefault;
if (typeof window.Sap === 'undefined') window.Sap = sapDefault;
window.clay.loaded = window.clay.loaded || {};
window.clay.loaded.sap = Promise.resolve();
})();
`

// hyperclayjs imports its copy as ESM, so the public API attaches to
// window.hyperclay during evaluation and is re-exported. The dist exposes the ES
// namespace as the in-scope global `Sap` (esbuild --global-name). `Sap.default`
// is the sap object; alias it so it can be re-exported under the name `Sap`
// without colliding with that namespace binding.
const SAP_ESM_WRAPPER = `
// Auto-export to window unless suppressed by loader.
var sapDefault = Sap.default;
if (!window.__hyperclayNoAutoExport) {
  window.hyperclay = window.hyperclay || {};
  window.hyperclay.Sap = sapDefault;
  window.Sap = sapDefault;
  window.h = window.hyperclay;
}

export { sapDefault as Sap };
export default sapDefault;
`

// The form-state serializer is shared verbatim with both clients' persist module
// so the three never drift. It is a pure ESM module (no window, no side effects),
// so every copy is the source plus a "generated" header.
const SERIALIZE_HEADER = `// GENERATED — do not edit. Vendored from sapjs/src/control-serialize.js
// via sapjs \`npm run propagate\`, which writes every client's copy from one
// table. Edit the sapjs source and re-run.
`

const SAP_CORE_HEADER = `// GENERATED — do not edit. Vendored from sapjs/dist/sap-core.min.js via sapjs
// \`npm run copy-to-clayjs\`. Edit the sapjs source and re-run.
`

const OWNERSHIP_HEADER = `// GENERATED — do not edit. Vendored from sapjs/src/ownership.js
// via sapjs \`npm run propagate\`, which writes every client's copy from one
// table. Edit the sapjs source and re-run.
`

// The sheet's grid codec, bundled into one ES module for hyper-html-api, which
// reads and writes sheets on every host. Not minified, so a host's stack trace
// points at readable code.
const codecEntry = path.join(rootDir, 'src', 'grid', 'codec', 'index.js')

const CODEC_HEADER = `// GENERATED — do not edit. Bundled from sapjs/src/grid/codec/ via sapjs
// \`node scripts/propagate.js --only hyper-html-api\`. Edit the sapjs source and re-run.
`

function buildCodecVendor() {
  const result = buildSync({ entryPoints: [codecEntry], bundle: true, format: 'esm', write: false, legalComments: 'none' })
  return CODEC_HEADER + '\n' + result.outputFiles[0].text
}

function readDist() {
  return fs.readFileSync(distFile, 'utf8').trim()
}

function buildSapClassic() {
  return SAP_CLASSIC_HEADER + SAP_CLASSIC_PREFIX + readDist() + SAP_CLASSIC_SUFFIX
}

function buildSapEsm() {
  return readDist() + '\n' + SAP_ESM_WRAPPER
}

function buildSerializeVendor() {
  return SERIALIZE_HEADER + '\n' + fs.readFileSync(serializeSrc, 'utf8').trim() + '\n'
}

function buildSapCoreEsm() {
  return SAP_CORE_HEADER + fs.readFileSync(coreDistFile, 'utf8').trim() + '\nexport default SapCoreBundle.default;\n'
}

function buildOwnershipVendor() {
  return OWNERSHIP_HEADER + '\n' + fs.readFileSync(ownershipSrc, 'utf8').trim() + '\n'
}

// A first party plugin goes to clayjs twice. ClayJS's own loader imports the ES module
// copy. A page that loads clayjs.com/v1/sap.js with no clay.js fetches the classic copy
// from the sap-plugins/ folder beside that file, which clayjs publishes from
// entries/sap-plugins/. The manifest names the plugins, so a plugin cannot ship in
// sapjs and be missing from clayjs.
const pluginHeader = source => `// GENERATED — do not edit. Vendored from sapjs/${source} via sapjs
// \`npm run copy-to-clayjs\`. Edit the sapjs source and re-run.
`

function buildPluginEsm(file) {
  const entry = path.join(rootDir, 'src', 'plugins', `${file}.js`)
  const result = buildSync({ entryPoints: [entry], bundle: true, format: 'esm', minify: true, write: false, legalComments: 'none' })
  return pluginHeader(`src/plugins/${file}.js`) + result.outputFiles[0].text
}

function buildPluginClassic(file) {
  const built = path.join(rootDir, 'dist', 'sap-plugins', `${file}.js`)
  if (!fs.existsSync(built)) {
    console.error(`Error: dist/sap-plugins/${file}.js not found. Run "npm run build" first.`)
    process.exit(1)
  }
  return pluginHeader(`dist/sap-plugins/${file}.js`) + fs.readFileSync(built, 'utf8').trim() + '\n'
}

const PLUGIN_DESTINATIONS = Object.values(MANIFEST).map(facts => facts.file || facts.name).flatMap(file => [
  { client: 'clayjs', path: `clayjs/src/vendor/sap-${file}.vendor.js`, build: () => buildPluginEsm(file), needsDist: false },
  { client: 'clayjs', path: `clayjs/entries/sap-plugins/${file}.js`, build: () => buildPluginClassic(file), ownFolder: true }
])

const DESTINATIONS = [
  { client: 'clayjs', path: 'clayjs/entries/sap.js', build: buildSapClassic },
  { client: 'hyperclayjs', path: 'hyperclayjs/src/vendor/sapjs.vendor.js', build: buildSapEsm },
  { client: 'clayjs', path: 'clayjs/src/vendor/control-serialize.vendor.js', build: buildSerializeVendor },
  { client: 'hyperclayjs', path: 'hyperclayjs/src/vendor/control-serialize.vendor.js', build: buildSerializeVendor },
  { client: 'clayjs', path: 'clayjs/src/vendor/sap-core.vendor.js', build: buildSapCoreEsm },
  { client: 'clayjs', path: 'clayjs/src/vendor/sap-ownership.vendor.js', build: buildOwnershipVendor },
  { client: 'hyper-html-api', path: 'hyper-html-api/src/codecs/sheet.vendor.js', build: buildCodecVendor, needsDist: false },
  ...PLUGIN_DESTINATIONS
]

const args = process.argv.slice(2)
const isCheck = args.includes('--check')
const onlyIndex = args.indexOf('--only')
const only = onlyIndex === -1 ? null : args[onlyIndex + 1]

const clients = [...new Set(DESTINATIONS.map(destination => destination.client))]

if (onlyIndex !== -1 && !only) {
  console.error(`Error: --only needs a client name. Known clients: ${clients.join(', ')}.`)
  process.exit(1)
}

const targets = only ? DESTINATIONS.filter(destination => destination.client === only) : DESTINATIONS

if (!targets.length) {
  console.error(`Error: no destination for client "${only}". Known clients: ${clients.join(', ')}.`)
  process.exit(1)
}

if (targets.some(destination => destination.needsDist !== false) && !fs.existsSync(distFile)) {
  console.error('Error: dist/sap.min.js not found. Run "npm run build" first.')
  process.exit(1)
}

if (isCheck) {
  const stale = targets.filter(destination => {
    const file = path.join(workspace, destination.path)
    if (!fs.existsSync(file)) return true
    return fs.readFileSync(file, 'utf8') !== destination.build()
  })
  stale.forEach(destination => {
    const file = path.join(workspace, destination.path)
    console.error(`✗ ${fs.existsSync(file) ? 'stale' : 'missing'}: ${destination.path}`)
  })
  if (stale.length) process.exit(1)
  targets.forEach(destination => console.log(`✓ in sync ${destination.path}`))
  process.exit(0)
}

// A destination with a folder of its own (`ownFolder`) creates that folder; the folder
// above it must exist like any other destination's.
const requiredFolder = destination => {
  const folder = path.dirname(path.join(workspace, destination.path))
  return destination.ownFolder ? path.dirname(folder) : folder
}
const missing = targets.filter(destination => !fs.existsSync(requiredFolder(destination)))
if (missing.length) {
  missing.forEach(destination => {
    console.error(`Error: destination folder not found at ${requiredFolder(destination)}`)
  })
  console.error(`Every destination is resolved against ${workspace}.`)
  process.exit(1)
}

targets.forEach(destination => {
  if (destination.ownFolder) fs.mkdirSync(path.dirname(path.join(workspace, destination.path)), { recursive: true })
  fs.writeFileSync(path.join(workspace, destination.path), destination.build(), 'utf8')
  console.log(`✓ Updated ${destination.path}`)
})
