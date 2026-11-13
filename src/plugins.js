// The plugin host. A plugin is one plain object: static facts the engine can read
// without running it, and a setup(kit) function that returns its hooks. The host
// installs definitions, loads the ones a page asks for, and wakes the apps that waited.
// A plugin never imports an engine module: each build keeps its caches in module
// variables, so everything a plugin needs from the engine arrives on the kit.

import { MANIFEST, PLUGIN_API } from "./plugin-manifest.js";
import { registerFeature, setPassHost } from "./pass.js";
import { declareFacts, claimable, setInstalled, walkVisible } from "./registry.js";
import { compile, run, runWith, setHelpers, isHelperName, isGlobal } from "./compile.js";
import { planOf, drainPlans, dropPlans } from "./plan.js";
import { forgetRow } from "./read-cache.js";
import { addLintCheck } from "./lint.js";
import { setBeacon, clearBeacon } from "./errors.js";
import { withDomMutationPaused, flushMutationBridge } from "./mutation-bridge.js";
import { capability, mayWriteRecord } from "./platform.js";
import { formats } from "./helpers.js";
import { VERSION } from "./version.js";

const CDN = /^(https:\/\/(?:cdn\.jsdelivr\.net\/npm|unpkg\.com)\/@panphora\/sapjs)(?=[@/]|$)/;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const listed = (root) => root.getAttribute("plugins")?.match(/\S+/g) || [];

export function createPlugins(runtime, Sap, scheduler) {
  const known = new Map(); // name -> static facts
  const installed = new Map(); // name -> the plugin's hooks, as the feature the pass runs
  const loading = new Map(); // name -> promise
  const failed = new Map(); // name -> Error
  const blocked = []; // definitions held until a plugin they require installs
  const marked = new Set(); // elements that carry the E52 beacon
  const helpers = {};
  let off = false; // true once this engine has handed the page to another

  const w = globalThis;
  // Every definition this page has seen, shared by every engine on it. A value another
  // script put under that name is left alone.
  const shared = Array.isArray(w.sapPlugins) ? w.sapPlugins : w.sapPlugins == null ? (w.sapPlugins = []) : [];
  // The engine's own address, readable only while its script runs.
  const src = w.document?.currentScript?.src || "";
  const cdn = CDN.exec(src);

  const apiOf = (name) => installed.get(name)?.api || null;
  const settle = (names) => Promise.allSettled(names.map(load));

  // Which helper names expressions wait for, and every cached plan, depend on which
  // plugins are known and which are installed. A kept row is read again when its plan
  // is a new one, so dropping the plans is enough.
  function refresh() {
    const pending = new Map();
    for (const facts of known.values()) {
      if (!installed.has(facts.name)) for (const h of facts.helpers || []) pending.set(h, facts.name);
    }
    setHelpers(helpers, pending);
    dropPlans();
  }

  function learn(facts) {
    known.set(facts.name, { ...known.get(facts.name), ...facts });
    declareFacts(facts);
    refresh();
  }

  // Tells the engine a plugin exists before its code is here. A second declaration adds
  // nothing.
  function declare(facts) {
    if (!known.has(facts.name)) learn(facts);
  }

  // A definition joins the list every engine on the page shares, and adds what a
  // declaration left out.
  function publish(def) {
    if (!shared.includes(def)) shared.push(def);
    learn(def);
  }

  function wake(trigger) {
    for (const app of runtime.apps()) if (app.root.isConnected) runtime.schedule(app, trigger);
  }

  const kit = Object.freeze({
    api: PLUGIN_API,
    version: VERSION,
    compile, run, runWith,
    planOf, drainPlans, forgetRow,
    setBeacon, clearBeacon,
    write: withDomMutationPaused,
    schedule(target, trigger = "plugin") {
      const app = target?.root ? target : runtime.appFor(target);
      if (app) runtime.schedule(app, trigger);
    },
    appFor: runtime.appFor,
    apps: runtime.apps,
    capability,
    mayWrite: mayWriteRecord,
    load,
    plugin: apiOf,
  });

  // Installs a definition now and returns its api object, or null. Throws when it
  // refuses the definition. Safe to call at any time and twice. A name instead of a
  // definition loads it.
  function use(def) {
    if (typeof def === "string") return load(def);
    const { name, api: speaks } = def;
    const refuse = (why) => { throw new Error(`Sap.use: plugin "${name}" ${why}`); };
    if (typeof name !== "string" || speaks !== PLUGIN_API) refuse(`needs a name and plugin API ${PLUGIN_API}; it gives API ${speaks}`);
    if (off) return null;
    if (installed.has(name)) return apiOf(name);
    // A definition that waits for a plugin it requires is published now, so the engine
    // stays out of its boundaries in the meantime.
    if ((def.requires || []).some((r) => !installed.has(r))) {
      publish(def);
      if (!blocked.includes(def)) blocked.push(def);
      return null;
    }
    // Nothing of a definition is published before it has passed every check, so one
    // that is refused, by its own setup or by a check, leaves nothing behind.
    const made = def.setup?.(kit) || {};
    const check = (part, taken) => {
      for (const n of Array.isArray(def[part]) ? def[part] : Object.keys(def[part] || {})) {
        if (typeof (made[part] || {})[n] !== "function" || taken(n)) refuse(`cannot add "${n}" to ${part}: the name is taken or not valid, or setup does not supply it`);
      }
    };
    const claimed = (n) => !claimable(n, name);
    check("helpers", (n) => {
      if (isGlobal(n)) refuse(`cannot add "${n}": window.${n} exists; rename the helper`);
      return !isHelperName(n) || n in helpers;
    });
    check("boundaries", claimed);
    check("directives", claimed);
    for (const k in made.api) if (k in Sap) refuse(`cannot add Sap.${k}: the name is taken`);
    publish(def);

    // The pass runs a plugin's hooks as one more feature.
    const feature = { ...made, name, order: def.order, boundary: {} };
    for (const n in def.boundaries) feature.boundary[n] = made.boundaries[n];
    for (const h of def.helpers || []) helpers[h] = made.helpers[h];
    for (const k in made.formats) if (!(k in formats)) formats[k] = made.formats[k];
    registerFeature(feature);
    if (made.lint) addLintCheck(made.lint);
    Object.assign(Sap, made.api);
    installed.set(name, feature);
    failed.delete(name);
    setInstalled(name, made.directives || true);
    refresh();
    withDomMutationPaused(() => marked.forEach(clearBeacon));
    marked.clear();
    blocked.splice(0).forEach(tryUse);
    // Not a full pass: a plugin treats a boundary it has not seen before as changed.
    wake("plugin:" + name);
    return apiOf(name);
  }

  function tryUse(def) {
    try {
      use(def);
    } catch (err) {
      console.error(err);
    }
  }

  // One attempt: the host's loader when it takes the name, else a script tag. A plugin
  // file registers itself; a loader hands back a module or a definition.
  function fetchOnce(name) {
    if (off || installed.has(name)) return null;
    const facts = known.get(name) || {};
    const custom = api.loader?.(name, facts);
    const url = facts.url || (api.base && api.base + (facts.file || name) + ".js");
    const got = custom !== undefined ? Promise.resolve(custom) : new Promise((resolve, reject) => {
      if (!url) throw new Error(`no address for plugin "${name}": call Sap.use(definition)`);
      const s = document.createElement("script");
      s.src = url;
      // A save during the download must not write this tag into the page's file.
      s.setAttribute("clay", "editor-ui");
      s.onload = s.onerror = (e) => {
        s.remove();
        if (e.type === "load") resolve();
        else reject(new Error("could not load " + url));
      };
      document.head.append(s);
    });
    return got.then((mod) => {
      if (off) return;
      const def = mod?.default || mod || shared.find((d) => d.name === name);
      if (def?.name) use(def);
      if (!installed.has(name)) throw new Error(`plugin "${name}" loaded and did not register`);
    });
  }

  // A promise of the plugin's api. It loads what the plugin requires first, and tries
  // again after each of retryDelays.
  function load(name) {
    if (installed.has(name)) return Promise.resolve(apiOf(name));
    if (loading.has(name)) return loading.get(name);
    failed.delete(name);
    let attempt = Promise.all((known.get(name)?.requires || []).map(load)).then(() => fetchOnce(name));
    for (const ms of api.retryDelays) attempt = attempt.catch(() => wait(ms).then(() => fetchOnce(name)));
    const p = attempt.finally(() => loading.delete(name)).then(
      () => apiOf(name),
      (error) => {
        failed.set(name, error);
        // The pass this starts reports E52 in every app that still asks for the plugin.
        wake("plugin-failed:" + name);
        document.dispatchEvent(new CustomEvent("sap:plugin-failed", { detail: { plugin: name, error } }));
        throw error;
      },
    );
    loading.set(name, p);
    return p;
  }

  // The plugins that docRoot and what is under it ask for and do not have: by the
  // plugins= list on the root of each app, and by what a pass would meet in an app, which
  // is a boundary attribute, a directive, or a call to a helper in an expression. docRoot
  // is a document, an app root, or an element inside an app. An element names one plugin
  // at a time, so the answer can grow once a plugin installs. Nothing can ask for a
  // plugin by its markup while every known plugin is installed, so then no element is read.
  function needed(docRoot) {
    const found = new Set();
    for (const el of docRoot.closest?.("[sap]") ? [docRoot] : docRoot.querySelectorAll("[sap]")) {
      for (const n of listed(el.closest("[sap]"))) found.add(n);
      if (known.size > installed.size) {
        walkVisible(el, (at) => {
          const plan = planOf(at);
          if (plan.inert) return false;
          plan.wants?.map((n) => found.add(n));
          return !!found.add(plan.waits);
        });
      }
    }
    return [...found].filter((n) => n && !installed.has(n));
  }

  // After every pass: start loading what the app asked for, and report what failed.
  setPassHost((app, pass) => {
    for (const name of new Set([...pass.wanted.keys(), ...pass.waiting, ...listed(app.root)])) {
      if (installed.has(name)) continue;
      const error = failed.get(name);
      if (!error) load(name).catch(() => {});
      else {
        const at = pass.wanted.get(name)?.[0] || app.root;
        app.diag.error("E52", at, {
          problem: `the "${name}" plugin did not load: ${error.message}`,
          fix: "Sap.plugins.retry() tries again",
        });
        marked.add(at);
        withDomMutationPaused(() => setBeacon(at, "E52"));
      }
    }
  });

  const api = {
    api: PLUGIN_API,
    // The folder that holds plugin files. An address on a CDN is pinned to this engine's
    // own version, so the engine and a plugin never come from two releases.
    // An address has a folder when a slash follows its scheme. A data:, blob: or about:
    // address has none.
    base: cdn ? `${cdn[1]}@${VERSION}/dist/sap-plugins/` : /^[^:]+:\//.test(src) ? new URL("sap-plugins/", src).href : null,
    // Optional (name, facts) => a promise of a module or a definition. When it returns
    // undefined the plugin loads from a script tag.
    loader: null,
    retryDelays: [1000, 4000],
    declare,
    load,
    // Null when the document asks for nothing that is missing. Otherwise a promise that
    // resolves once each of those plugins has installed or failed, and each plugin that
    // shows only then, or after timeoutMs. A plugin is asked for once in a call.
    ready(docRoot = document, timeoutMs = 3000) {
      const tried = new Set();
      const more = () => {
        const asked = needed(docRoot).filter((n) => !tried.has(n) && tried.add(n));
        return asked.length && settle(asked).then(more);
      };
      const all = more();
      return all ? Promise.race([all, wait(timeoutMs)]) : null;
    },
    has: (name) => installed.has(name),
    status: () => ({ installed: [...installed.keys()], loading: [...loading.keys()], failed: [...failed.keys()] }),
    retry: (name) => settle(name ? [name] : [...failed.keys()]),
  };

  // Settles what is already queued, in this task: the changes the browser has not
  // delivered yet, every queued pass, each plugin's own pending work, and the passes
  // that work queues. Null when nothing is left; a promise when a plugin could not
  // finish in this task.
  function flush() {
    const pending = [];
    const passes = () => {
      flushMutationBridge();
      return scheduler.flushNow();
    };
    const hooks = [...installed.values()].filter((plugin) => plugin.flush);
    passes();
    // A plugin's work can queue a pass, and that pass can leave a plugin more work.
    for (let round = 0; hooks.length && round < 8; round++) {
      for (const plugin of hooks) {
        const r = plugin.flush();
        if (r?.then) pending.push(r);
      }
      if (!passes()) break;
    }
    return pending.length ? Promise.all(pending).then(flush) : null;
  }

  Sap.use = use;
  Sap.plugins = api;
  Sap.flush = flush;

  for (const facts of Object.values(MANIFEST)) declare(facts);
  shared.slice().forEach(tryUse);
  w.addEventListener?.("online", () => api.retry());

  // For Sap.unmount: this engine has handed the page over and runs no more passes. Its
  // plugins let go, and a download still on its way installs nothing here.
  return function dispose() {
    off = true;
    for (const plugin of installed.values()) plugin.dispose?.();
    installed.clear();
    failed.clear();
  };
}
