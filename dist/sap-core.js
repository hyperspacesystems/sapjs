var SapCoreBundle = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/core.js
  var core_exports = {};
  __export(core_exports, {
    FULL_SAPJS: () => FULL_SAPJS,
    Sap: () => Sap,
    default: () => core_default,
    mount: () => mount,
    mountAll: () => mountAll,
    needsFullSapjs: () => needsFullSapjs,
    runtime: () => runtime
  });

  // src/scheduler.js
  var MAX_PASSES = 50;
  function createScheduler(runPass2) {
    let queued = false;
    const dirty = /* @__PURE__ */ new Set();
    const ring = [];
    function note(trigger) {
      if (!trigger) return;
      ring.push(trigger);
      if (ring.length > 8) ring.shift();
    }
    function schedule(app, trigger, changes) {
      note(trigger);
      if (changes) {
        if (app._broken || app.halted) app._changes = false;
        else if (app._changes !== false) {
          const list = app._changes || (app._changes = []);
          for (const c of changes) list.push(c);
        }
        if (app._inPass) return;
      }
      if (app._broken) {
        if (trigger === "mutation") return;
        rearm(app);
      }
      if (!dirty.has(app)) app._trigger = trigger;
      dirty.add(app);
      if (queued) return;
      queued = true;
      queueMicrotask(drain);
    }
    function drain() {
      queued = false;
      for (const app of [...dirty]) if (dirty.delete(app)) runWithBreaker(app, false, app._trigger);
    }
    function runWithBreaker(app, full, cause) {
      if (app._broken || app.halted) return;
      app._passes = (app._passes || 0) + 1;
      if (app._passes > MAX_PASSES) {
        app._broken = true;
        app._breakerRing = ring.slice();
        runPass2(app, { breaker: true });
        return;
      }
      if (!app._resetArmed) {
        app._resetArmed = true;
        setTimeout(() => {
          app._passes = 0;
          app._resetArmed = false;
        }, 0);
      }
      runPass2(app, full ? { full: true, cause } : { cause });
    }
    function runNow(app, trigger) {
      note(trigger);
      if (app._broken) rearm(app);
      runWithBreaker(app, true, trigger);
    }
    function rearm(app) {
      app._broken = false;
      app._passes = 0;
    }
    function flushNow() {
      const ran = queued;
      while (queued) drain();
      return ran;
    }
    return { schedule, runNow, flushNow };
  }

  // src/errors.js
  var REGISTRY = {
    E01: { slug: "foreign-dialect", behavior: "HALT" },
    E02: { slug: "moustaches-in-text", behavior: "HALT" },
    E04: { slug: "duplicate-declaration", behavior: "HALT" },
    E05: { slug: "reserved-name", behavior: "HALT" },
    E06: { slug: "global-html-name", behavior: "HALT" },
    E07: { slug: "calc-cycle", behavior: "ERR" },
    E08: { slug: "expression-syntax", behavior: "HALT" },
    E10: { slug: "orphan-item", behavior: "HALT" },
    E12: { slug: "unknown-state-key", behavior: "ERR" },
    E15: { slug: "write-to-undeclared-key", behavior: "ERR" },
    E16: { slug: "write-to-computed-field", behavior: "ERR" },
    E17: { slug: "unresolvable-action-target", behavior: "HALT" },
    E18: { slug: "paint-on-form-control", behavior: "HALT" },
    E20: { slug: "bind-on-non-control", behavior: "HALT" },
    E22: { slug: "format-type", behavior: "ERR" },
    E24: { slug: "runtime-expression-throw", behavior: "ERR" },
    E26: { slug: "circuit-breaker", behavior: "HALT" },
    E30: { slug: "attr-on-bound-control", behavior: "HALT" },
    E31: { slug: "password-without-transient", behavior: "HALT" },
    E32: { slug: "file-bind", behavior: "HALT" },
    E33: { slug: "dialog-state-open", behavior: "HALT" },
    E34: { slug: "transient-persist-collision", behavior: "HALT" },
    E35: { slug: "presence-state-misuse", behavior: "HALT" },
    E40: { slug: "each-not-array", behavior: "ERR" },
    E41: { slug: "each-bad-key", behavior: "ERR" },
    E42: { slug: "each-template", behavior: "ERR" },
    E43: { slug: "bind-in-each-row", behavior: "ERR" },
    E50: { slug: "needs-full-sapjs", behavior: "HALT" },
    E52: { slug: "plugin-not-loaded", behavior: "ERR" },
    W03: { slug: "unknown-colon-attribute", behavior: "WARN" },
    W04: { slug: "expression-in-when", behavior: "WARN" },
    W30: { slug: "nonzero-mount-writes", behavior: "WARN" },
    W31: { slug: "detail-dialog-saved-open", behavior: "WARN" }
  };
  var NATIVE_BOOLEANS = [
    "disabled",
    "readonly",
    "required",
    "checked",
    "selected",
    "multiple",
    "open",
    "inert",
    "autofocus",
    "novalidate",
    "hidden"
  ];
  var HTML_GLOBALS = /* @__PURE__ */ new Set([
    "title",
    "style",
    "hidden",
    "lang",
    "dir",
    "translate",
    "class",
    "id",
    "nonce",
    "autofocus",
    "tabindex",
    "contenteditable",
    "spellcheck",
    "draggable",
    "role",
    "slot",
    "part",
    "name",
    "value",
    "type",
    "itemscope",
    "itemtype",
    "itemid",
    "itemprop",
    "itemref"
  ]);
  var RESERVED = /* @__PURE__ */ new Set([
    "sap",
    "scope",
    "items",
    "item",
    "template",
    "bind",
    "calc",
    "text",
    "show",
    "attr",
    "set",
    "trigger",
    "move",
    "sort",
    "detail",
    "each",
    "effect",
    "invalid",
    "confirm",
    "transient",
    "default",
    "persist",
    "sortable",
    // editmode is a hyperclayjs platform prefix (editmode:onclick), reserved so a
    // co-loaded admin attribute never collides with a Sap state field name.
    "editmode"
  ]);
  function cssPath(el) {
    if (!el || el.nodeType !== 1) return "?";
    if (el.id) return `${el.tagName.toLowerCase()}#${el.id}`;
    const parts = [];
    let cur = el;
    let depth = 0;
    while (cur && cur.nodeType === 1 && depth < 4) {
      let seg = cur.tagName.toLowerCase();
      if (cur.hasAttribute("sap")) seg += "[sap]";
      else if (cur.parentElement) {
        let count2 = 0;
        let index = 0;
        for (let c = cur.parentElement.firstElementChild; c; c = c.nextElementSibling) {
          if (c.tagName !== cur.tagName) continue;
          count2++;
          if (c === cur) index = count2;
        }
        if (count2 > 1) seg += `:nth-of-type(${index})`;
      }
      parts.unshift(seg);
      if (cur.hasAttribute("sap")) break;
      cur = cur.parentElement;
      depth++;
    }
    return parts.join(" > ");
  }
  var Diagnostics = class {
    constructor(appName) {
      this.appName = appName;
      this.errors = [];
      this.warnings = [];
      this.halted = false;
      this.haltReason = null;
    }
    block(code, el, info = {}) {
      const slug = (REGISTRY[code] || {}).slug || "error";
      const rec = {
        code,
        slug,
        el: cssPath(el),
        attr: info.attr || null,
        expr: info.expr || null,
        key: info.key || null,
        problem: info.problem || "",
        didYouMean: info.didYouMean || null,
        fix: info.fix || null,
        phase: info.phase || "runtime"
      };
      const out = ["\n" + (code[0] === "W" ? "sap \u26A0 " : "sap \u2717 ") + code + " " + slug];
      out.push(`  at ${rec.el}${rec.attr ? ` \u2014 ${rec.attr}="${rec.expr ?? ""}"` : ""}`);
      if (rec.problem) out.push(`  problem: ${rec.problem}`);
      if (rec.didYouMean) out.push(`  did you mean: ${rec.didYouMean}`);
      if (rec.fix) out.push(`  fix: ${rec.fix}`);
      (code[0] === "W" ? console.warn : console.error)(out.join("\n"));
      return rec;
    }
    error(code, el, info = {}) {
      const rec = this.block(code, el, info);
      this.errors.push(rec);
      return rec;
    }
    warn(code, el, info = {}) {
      const rec = this.block(code, el, info);
      this.warnings.push(rec);
      return rec;
    }
  };
  function setBeacon(el, code) {
    if (el && el.getAttribute("sap-error") !== code) el.setAttribute("sap-error", code);
  }
  function clearBeacon(el) {
    if (el && el.hasAttribute("sap-error")) el.removeAttribute("sap-error");
  }
  function didYouMean(name, candidates) {
    let best = null;
    let bestD = 3;
    for (const c of candidates) {
      const d = lev(name, c);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }
  function lev(a, b) {
    const m = a.length;
    const n2 = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n2).fill(0)]);
    for (let j = 0; j <= n2; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n2; j++)
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
    return dp[m][n2];
  }

  // src/registry.js
  var OWN = ["sap", "item", "scope", "items", "detail", "each"];
  var boundaries = /* @__PURE__ */ new Map();
  var directives = /* @__PURE__ */ new Map();
  var selector = "";
  function declareFacts(facts) {
    for (const [name, b] of Object.entries(facts.boundaries || {})) {
      if (claimable(name)) boundaries.set(name, { name, plugin: facts.name, opaque: !!b.opaque, on: b.on || null, installed: false });
    }
    for (const [name, d] of Object.entries(facts.directives || {})) {
      if (claimable(name)) directives.set(name, { name, plugin: facts.name, key: d.key, impure: !!d.impure, parse: null });
    }
    selector = [...boundaries.values()].map((b) => `${b.on || ""}[${b.name}]`).join(",");
  }
  function claimable(name, plugin) {
    return !OWN.includes(name) && (ownerOf(name) || plugin) === plugin;
  }
  function setInstalled(plugin, parsers) {
    for (const b of boundaries.values()) if (b.plugin === plugin) b.installed = !!parsers;
    for (const d of directives.values()) if (d.plugin === plugin) d.parse = parsers && parsers[d.name] || null;
  }
  function ownerOf(name) {
    return (boundaries.get(name) || directives.get(name) || {}).plugin;
  }
  function directiveFor(name) {
    return directives.get(name);
  }
  function declaredAttr(name) {
    return !!ownerOf(name) || directives.has(name.slice(0, name.indexOf(":") + 1));
  }
  function boundaryOf(el) {
    if (!selector) return null;
    for (const b of boundaries.values()) {
      if (b.on && el.localName !== b.on || !el.hasAttribute(b.name)) continue;
      return OWN.some((own) => el.hasAttribute(own)) ? null : b;
    }
    return null;
  }
  function closedBoundary(el) {
    const b = boundaryOf(el);
    return !!b && (b.opaque || !b.installed);
  }
  function insideClosedBoundary(el) {
    if (!selector) return null;
    for (let cur = el.parentElement; cur; cur = cur.parentElement) {
      cur = cur.closest(selector);
      if (!cur || closedBoundary(cur)) return cur;
    }
    return null;
  }
  function closedOwner(el) {
    return closedBoundary(el) ? el : insideClosedBoundary(el);
  }
  function walkVisible(root, visit) {
    if (visit(root) === false || closedBoundary(root)) return;
    for (let c = root.firstElementChild; c; c = c.nextElementSibling) walkVisible(c, visit);
  }

  // src/dom.js
  var NATIVE_BOOLEAN_SET = new Set(NATIVE_BOOLEANS);
  var NATIVE_PROPS = { readonly: "readOnly", novalidate: "noValidate" };
  var idSeq = 0;
  var runtimeKeys = /* @__PURE__ */ new WeakMap();
  function keyOf(el, prefix = "sap") {
    const dataId = el.getAttribute("data-id");
    if (dataId) return dataId;
    if (el.id) return el.id;
    let key = runtimeKeys.get(el);
    if (!key) {
      key = `${prefix}-${(idSeq++).toString(36)}`;
      runtimeKeys.set(el, key);
    }
    return key;
  }
  function rowsOf(listEl) {
    const rows2 = [];
    for (let c = listEl.firstElementChild; c; c = c.nextElementSibling) {
      if (c.hasAttribute("item") && !c.hasAttribute("template") && !c.hasAttribute("cms-template")) rows2.push(c);
    }
    return rows2;
  }
  function sharedTemplate(appRoot, name) {
    if (!appRoot || !name) return null;
    const t = [...appRoot.querySelectorAll(`template[items="${name}"]`)].find((x) => x.closest("[sap]") === appRoot);
    const blueprint = t && t.content.firstElementChild;
    return blueprint && blueprint.hasAttribute("item") ? blueprint : null;
  }
  function templateOf(listEl) {
    for (let c = listEl.firstElementChild; c; c = c.nextElementSibling) {
      if (c.hasAttribute("item") && c.hasAttribute("template")) return c;
    }
    return sharedTemplate(listEl.closest("[sap]"), listEl.getAttribute("items"));
  }
  function parseStateDecl(str) {
    const out = [];
    if (!str) return out;
    for (const raw of str.trim().split(/\s+/)) {
      if (!raw) continue;
      let token = raw;
      let def;
      const eq = token.indexOf("=");
      if (eq >= 0) {
        def = token.slice(eq + 1);
        token = token.slice(0, eq);
      }
      const parts = token.split(":");
      const name = parts[0];
      let type = "string";
      let transient = false;
      for (const p of parts.slice(1)) {
        if (p === "num") type = "num";
        else if (p === "bool") type = "bool";
        else if (p === "presence") type = "presence";
        else if (p === "transient") transient = true;
      }
      const attr = name;
      const key = attr.startsWith("data-") && attr.length > 5 ? attr.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()) : attr;
      out.push({ name: key, attr, type, default: def, transient });
    }
    return out;
  }
  function parseTyped(value, type) {
    if (type === "num") {
      if (value == null || value === "") return 0;
      const n2 = Number(value);
      return Number.isNaN(n2) ? 0 : n2;
    }
    if (type === "bool") return value === "true" || value === "" || value === "1";
    return value == null ? "" : value;
  }
  function serializeTyped(value, type) {
    if (type === "bool") return value ? "true" : "false";
    return value == null ? "" : String(value);
  }
  function isNativeBoolean(el, attr) {
    return NATIVE_BOOLEAN_SET.has(attr) && typeof el[NATIVE_PROPS[attr] || attr] === "boolean";
  }
  function isPresenceDecl(el, d) {
    return d.type === "presence" || d.type !== "num" && isNativeBoolean(el, d.attr || d.name);
  }
  function defaultRaw(d) {
    return d.default != null ? d.default : d.type === "num" ? "0" : d.type === "bool" ? "false" : "";
  }
  function readTransient(el, decl) {
    const attr = decl.attr || decl.name;
    const store = el._sapTransient || (el._sapTransient = {});
    if (!(decl.name in store)) {
      let raw = el.getAttribute(attr);
      if (raw == null) raw = defaultRaw(decl);
      store[decl.name] = parseTyped(raw, decl.type);
    }
    if (el.hasAttribute(attr)) el.removeAttribute(attr);
    return store[decl.name];
  }

  // src/helpers.js
  function num(v) {
    if (typeof v === "number") return v;
    if (v == null || v === "") return 0;
    const n2 = Number(typeof v === "string" ? v.replace(/[$,%\s]/g, "") : v);
    return Number.isNaN(n2) ? 0 : n2;
  }
  function values(rows2, k) {
    if (!Array.isArray(rows2)) return [];
    if (k == null) return rows2;
    return rows2.map((r) => typeof k === "function" ? k(r) : r == null ? void 0 : r[k]);
  }
  function sum(rows2, k) {
    return values(rows2, k).reduce((a, v) => a + num(v), 0);
  }
  function count(rows2, pred) {
    if (!Array.isArray(rows2)) return 0;
    if (pred == null) return rows2.length;
    return rows2.reduce((a, r) => a + (pred(r) ? 1 : 0), 0);
  }
  function avg(rows2, k) {
    const v = values(rows2, k);
    if (!v.length) return 0;
    return sum(rows2, k) / v.length;
  }
  function min(rows2, k) {
    const v = values(rows2, k).filter((x) => x != null && x !== "");
    if (!v.length) return 0;
    if (v.every((x) => typeof x === "number" || !Number.isNaN(Number(x)))) {
      return Math.min(...v.map(Number));
    }
    return v.reduce((a, b) => String(a) <= String(b) ? a : b);
  }
  function max(rows2, k) {
    const v = values(rows2, k).filter((x) => x != null && x !== "");
    if (!v.length) return 0;
    if (v.every((x) => typeof x === "number" || !Number.isNaN(Number(x)))) {
      return Math.max(...v.map(Number));
    }
    return v.reduce((a, b) => String(a) >= String(b) ? a : b);
  }
  function plural(n2, singular, pluralForm) {
    const word = num(n2) === 1 ? singular : pluralForm != null ? pluralForm : singular + "s";
    return `${n2} ${word}`;
  }
  function days(a, b) {
    const da = new Date(a);
    const db = new Date(b);
    if (Number.isNaN(+da) || Number.isNaN(+db)) return 0;
    return Math.round((db - da) / 864e5);
  }
  function n(v) {
    return typeof v === "number" ? v : Number(v);
  }
  var formats = {
    usd: (v) => "$" + n(v).toLocaleString("en-US", { maximumFractionDigits: 0 }),
    usd2: (v) => "$" + n(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    pct: (v) => Math.round(n(v)) + "%",
    pct1: (v) => n(v).toFixed(1) + "%",
    int: (v) => Math.round(n(v)).toLocaleString("en-US"),
    num: (v) => n(v).toLocaleString("en-US"),
    num2: (v) => n(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    compact: (v) => n(v).toLocaleString("en-US", { notation: "compact" }),
    date: (v) => {
      const d = new Date(v);
      return Number.isNaN(+d) ? String(v) : d.toLocaleDateString("en-US");
    },
    clock: (v) => {
      const ms = n(v);
      const total = Math.floor(ms / 100);
      const tenths = total % 10;
      const secs = Math.floor(total / 10) % 60;
      const mins = Math.floor(total / 600);
      return `${mins}:${String(secs).padStart(2, "0")}.${tenths}`;
    }
  };
  var NUMERIC = /* @__PURE__ */ new Set(["usd", "usd2", "pct", "pct1", "int", "num", "num2", "compact", "clock"]);
  function applyFormat(name, v) {
    if (!name) return v == null ? "" : String(v);
    const f = formats[name];
    if (typeof f !== "function") {
      const e = new Error(`unknown format "${name}"`);
      e.sapCode = "E22";
      throw e;
    }
    if (NUMERIC.has(name)) {
      const x = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(x)) {
        const e = new Error(`format "${name}" received ${typeof v === "string" ? `"${v}"` : v}`);
        e.sapCode = "E22";
        throw e;
      }
    }
    return f(v);
  }

  // src/compile.js
  var ARGS = ["state", "item", "el", "root", "fmt", "num", "sum", "count", "avg", "min", "max", "plural", "days"];
  var cache = /* @__PURE__ */ new Map();
  var helperNames = [];
  var helperValues = [];
  var awaited = null;
  var owners = null;
  var TEXT = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|[`}](?:\\.|[^`\\])*?(?:`|\$\{)|[{}]/.source;
  function setHelpers(installed2, pending) {
    helperNames = Object.keys(installed2);
    helperValues = Object.values(installed2);
    const names = [...pending.keys()].filter((name) => unclaimed(name) && !(name in installed2));
    owners = pending;
    awaited = names.length ? new RegExp(`${TEXT}|\\.{3}|(${names.join("|")})\\s*\\(|[\\w$.]+`, "g") : null;
    cache.clear();
  }
  function isGlobal(name) {
    return name in globalThis && globalThis[name]?.nodeType !== 1;
  }
  function unclaimed(name) {
    return /^[a-z_]\w*$/i.test(name) && !ARGS.includes(name) && !isGlobal(name);
  }
  function isHelperName(name) {
    try {
      return unclaimed(name) && !!new Function(name, '"use strict"');
    } catch {
      return false;
    }
  }
  function waitsFor(src) {
    const open = [];
    let m;
    if (awaited) for (awaited.lastIndex = 0; m = awaited.exec(src); ) {
      const [token, name] = m;
      if (name && unclaimed(name)) return owners.get(name);
      if (token[0] === "}" && !open.pop()?.[1]) awaited.lastIndex = m.index + 1;
      else if (token.endsWith("{")) open.push(token);
    }
    return null;
  }
  var STATE_REF = /\bstate\.([a-z][a-z0-9_]*)/g;
  var ITEM_REF = /\bitem\.([a-z][a-z0-9_]*)/g;
  function extractDeps(src) {
    const named = (ref) => new Set([...(src || "").matchAll(ref)].map((m) => m[1]));
    return { state: named(STATE_REF), item: named(ITEM_REF) };
  }
  function compile(src, statement = false) {
    const key = (statement ? "!" : "") + src;
    let entry = cache.get(key);
    if (entry) return entry;
    if (cache.size > 512) cache.clear();
    try {
      const body = statement ? `"use strict";
${src}` : `"use strict"; return (${src});`;
      const fn = helperNames.length ? new Function(...helperNames, `return function(${ARGS}){${body}
}`)(...helperValues) : new Function(...ARGS, body);
      entry = { fn, src, statement, deps: extractDeps(src), error: null, waits: waitsFor(src) };
    } catch (err) {
      entry = { fn: null, src, statement, deps: { state: /* @__PURE__ */ new Set(), item: /* @__PURE__ */ new Set() }, error: err, waits: null };
    }
    if (!entry.waits) cache.set(key, entry);
    return entry;
  }
  function run(entry, ctx) {
    return runWith(entry, ctx.state, ctx.item, ctx.el ?? null, ctx.root);
  }
  function runWith(entry, state, item, el, root) {
    if (entry.error) throw entry.error;
    return entry.fn(state, item, el, root, formats, num, sum, count, avg, min, max, plural, days);
  }

  // src/plan.js
  var planGen = {};
  var watcher = null;
  var canWatch = true;
  var cacheable = false;
  function dropPlans() {
    planGen = {};
  }
  function beginPlans(root) {
    const prev = cacheable;
    if (watcher) clearFromRecords(watcher.takeRecords());
    else if (canWatch) watchPlans();
    cacheable = !!watcher && root.getRootNode() === document;
    return prev;
  }
  function endPlans(prev) {
    cacheable = prev;
  }
  function drainPlans() {
    if (watcher) clearFromRecords(watcher.takeRecords());
  }
  function watchPlans() {
    if (typeof document === "undefined" || typeof MutationObserver !== "function") {
      canWatch = false;
      return;
    }
    watcher = new MutationObserver(clearFromRecords);
    watcher.observe(document, { attributes: true, childList: true, subtree: true });
  }
  function clearFromRecords(records) {
    for (const rec of records) {
      if (rec.type === "attributes") {
        clearPlan(rec.target);
      } else if (rec.addedNodes.length && !(rec.target.nodeType === 1 && closedOwner(rec.target))) {
        for (const node of rec.addedNodes) if (node.nodeType === 1) walkVisible(node, clearPlan);
      }
    }
  }
  function clearPlan(el) {
    if (el._sapPlan) el._sapPlan = null;
  }
  function planOf(el) {
    if (!cacheable) return buildPlan(el);
    const p = el._sapPlan;
    if (p && p.gen === planGen) return p;
    return el._sapPlan = buildPlan(el);
  }
  function expr(plan, src, statement) {
    const entry = compile(src, statement);
    if (entry.waits) plan.waits = entry.waits;
    return entry;
  }
  function buildPlan(el) {
    const plan = {
      gen: planGen,
      inert: el.tagName === "TEMPLATE",
      template: false,
      cms: false,
      item: false,
      scope: false,
      items: false,
      detail: false,
      each: false,
      boundary: null,
      bind: null,
      transient: false,
      decls: null,
      calcs: null,
      paints: null,
      effects: null,
      invalids: null,
      waits: null,
      wants: null,
      ext: false,
      impure: false
    };
    for (const attr of el.attributes) {
      const name = attr.name;
      const val = attr.value;
      const colon = name.indexOf(":");
      if (colon < 0) {
        switch (name) {
          case "sap-ignore":
            plan.inert = true;
            break;
          case "cms-template":
            plan.inert = true;
            plan.cms = true;
            break;
          case "template":
            plan.inert = true;
            plan.template = true;
            break;
          case "item":
            plan.item = true;
            break;
          case "scope":
            plan.scope = true;
            break;
          case "items":
            plan.items = true;
            break;
          case "detail":
            plan.detail = true;
            plan.waits = waitsFor(val) || plan.waits;
            break;
          case "each":
            plan.each = true;
            plan.waits = waitsFor(val) || waitsFor(el.getAttribute("key")) || plan.waits;
            break;
          case "bind":
            plan.bind = val;
            break;
          case "transient":
            plan.transient = true;
            break;
          case "state":
            plan.decls = parseStateDecl(val);
            break;
          case "text":
            (plan.paints || (plan.paints = [])).push({ kind: "text", fmt: null, entry: expr(plan, val) });
            break;
          case "show":
            (plan.paints || (plan.paints = [])).push({ kind: "show", entry: expr(plan, val) });
            break;
          case "effect":
            (plan.effects || (plan.effects = [])).push({ entry: expr(plan, val, true) });
            break;
          case "invalid":
            (plan.invalids || (plan.invalids = [])).push({ entry: expr(plan, val) });
            break;
          default:
            pluginDirective(plan, name, "", val);
        }
        continue;
      }
      const head = name.slice(0, colon);
      const tail = name.slice(colon + 1);
      switch (head) {
        case "calc":
          (plan.calcs || (plan.calcs = [])).push({ name: tail, entry: expr(plan, val) });
          break;
        case "text":
          (plan.paints || (plan.paints = [])).push({ kind: "text", fmt: tail, entry: expr(plan, val) });
          break;
        case "attr":
          (plan.paints || (plan.paints = [])).push({ kind: "attr", arg: tail, entry: expr(plan, val) });
          break;
        case "class":
          (plan.paints || (plan.paints = [])).push({ kind: "class", arg: tail, entry: expr(plan, val) });
          break;
        case "css":
          (plan.paints || (plan.paints = [])).push({ kind: "css", arg: tail, entry: expr(plan, val) });
          break;
        case "show-when":
        case "option":
          (plan.paints || (plan.paints = [])).push({ kind: "when", match: "show", field: tail, values: val.split("|") });
          break;
        case "hide-when":
          (plan.paints || (plan.paints = [])).push({ kind: "when", match: "hide", field: tail, values: val.split("|") });
          break;
        case "option-not":
          (plan.paints || (plan.paints = [])).push({ kind: "when", match: "show-not", field: tail, values: val.split("|") });
          break;
        default:
          pluginDirective(plan, head + ":", tail, val);
      }
    }
    const pluginBoundary = boundaryOf(el);
    plan.boundary = plan.scope ? "scope" : plan.items ? "items" : plan.detail ? "detail" : plan.each ? "each" : pluginBoundary ? pluginBoundary.name : null;
    if (pluginBoundary && !pluginBoundary.installed) (plan.wants ||= []).push(pluginBoundary.plugin);
    return isEmpty(plan) ? emptyPlan() : plan;
  }
  function pluginDirective(plan, name, tail, val) {
    const d = directiveFor(name);
    if (!d) return;
    if (!d.parse) {
      (plan.wants ||= []).push(d.plugin);
      return;
    }
    const def = d.parse(tail, val);
    if (def === void 0) return;
    (plan[d.key] || (plan[d.key] = [])).push(def);
    plan.ext = true;
    if (d.impure) plan.impure = true;
    if (def && def.entry && def.entry.waits) plan.waits = def.entry.waits;
  }
  var empty = null;
  function emptyPlan() {
    if (!empty || empty.gen !== planGen) {
      empty = Object.freeze({
        gen: planGen,
        inert: false,
        template: false,
        cms: false,
        item: false,
        scope: false,
        items: false,
        detail: false,
        each: false,
        boundary: null,
        bind: null,
        transient: false,
        decls: null,
        calcs: null,
        paints: null,
        effects: null,
        invalids: null,
        waits: null,
        wants: null,
        ext: false,
        impure: false
      });
    }
    return empty;
  }
  function isEmpty(plan) {
    return !plan.inert && !plan.item && plan.boundary === null && plan.bind === null && !plan.transient && !plan.decls && !plan.calcs && !plan.paints && !plan.effects && !plan.invalids && !plan.wants && !plan.ext;
  }

  // src/read-cache.js
  var cells = /* @__PURE__ */ new WeakMap();
  var rows = /* @__PURE__ */ new WeakMap();
  var observer = null;
  var enabled = false;
  function dropReads() {
    cells = /* @__PURE__ */ new WeakMap();
    rows = /* @__PURE__ */ new WeakMap();
  }
  function invalidate(records) {
    for (const record of records) {
      const parent = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      for (let el = parent; el; el = el.parentElement) rows.delete(el);
      if (record.type === "attributes") {
        cells.delete(record.target);
        continue;
      }
      for (let el = parent; el; el = el.parentElement) cells.delete(el);
      const added = record.addedNodes;
      if (!added || !added.length || parent && closedOwner(parent)) continue;
      for (const node of added) if (node.nodeType === 1) walkVisible(node, forget);
    }
  }
  function forget(el) {
    cells.delete(el);
    rows.delete(el);
  }
  function keepsRows() {
    return enabled;
  }
  function keptRow(el) {
    return enabled ? rows.get(el) : void 0;
  }
  function keepRow(el, entry) {
    if (enabled) rows.set(el, entry);
  }
  function forgetRow(el) {
    rows.delete(el);
  }
  function beginReads(root) {
    const previous = enabled;
    if (!observer && typeof MutationObserver === "function") {
      observer = new MutationObserver(invalidate);
      observer.observe(document, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true
      });
    }
    if (observer) invalidate(observer.takeRecords());
    enabled = !!observer && root.getRootNode() === document;
    return previous;
  }
  function endReads(previous) {
    enabled = previous;
  }
  function cell(el) {
    let value = cells.get(el);
    if (!value) cells.set(el, value = { attrs: /* @__PURE__ */ new Map(), hasText: false, text: "" });
    return value;
  }
  function readAttr(el, name) {
    if (!enabled) return el.getAttribute(name);
    const hit = cell(el);
    if (!hit.attrs.has(name)) hit.attrs.set(name, el.getAttribute(name));
    return hit.attrs.get(name);
  }
  function readText(el) {
    if (!enabled) return el.textContent;
    const hit = cell(el);
    if (!hit.hasText) {
      hit.text = el.textContent;
      hit.hasText = true;
    }
    return hit.text;
  }

  // src/control-serialize.js
  function inputType(el) {
    return (el.getAttribute("type") || "text").toLowerCase();
  }
  function serializeControlToAttributes(el) {
    const tag = el.tagName;
    if (tag === "INPUT") {
      const type = inputType(el);
      if (type === "checkbox" || type === "radio") {
        if (el.checked) el.setAttribute("checked", "");
        else el.removeAttribute("checked");
      } else {
        el.setAttribute("value", el.value);
      }
      return;
    }
    if (tag === "TEXTAREA") {
      el.setAttribute("data-value", el.value);
      return;
    }
    if (tag === "SELECT") {
      const opts = el.options;
      for (let i = 0; i < opts.length; i++) {
        if (opts[i].selected) opts[i].setAttribute("selected", "");
        else opts[i].removeAttribute("selected");
      }
    }
  }
  function finalizeControlForSave(target, source = target) {
    const tag = target.tagName;
    if (tag === "INPUT") {
      const type = inputType(target);
      if (type === "checkbox" || type === "radio") {
        if (!source.checked) target.removeAttribute("checked");
        else if (!target.hasAttribute("checked")) target.setAttribute("checked", "");
      } else if (source.value !== (target.getAttribute("value") ?? "")) {
        target.setAttribute("value", source.value);
      }
      return;
    }
    if (tag === "TEXTAREA") {
      const text = source.value.startsWith("\n") ? "\n" + source.value : source.value;
      if (target.textContent !== text) target.textContent = text;
      target.removeAttribute("data-value");
      return;
    }
    if (tag === "SELECT") {
      const tOpts = target.options;
      const sOpts = source.options;
      for (let i = 0; i < tOpts.length; i++) {
        if (!(sOpts[i] && sOpts[i].selected)) tOpts[i].removeAttribute("selected");
        else if (!tOpts[i].hasAttribute("selected")) tOpts[i].setAttribute("selected", "");
      }
    }
  }
  function rehydrateControlFromAttributes(el) {
    if (el.tagName !== "TEXTAREA" || !el.hasAttribute("data-value")) return;
    if (el === el.ownerDocument.activeElement) return;
    el.textContent = el.getAttribute("data-value");
    el.removeAttribute("data-value");
  }

  // src/platform.js
  function capability(name) {
    if (typeof window === "undefined") return null;
    const clay = window.clay, hyperclay = window.hyperclay;
    if (name === "consent") return clay?.confirm || hyperclay?.consent || null;
    return clay?.[name] || hyperclay?.[name] || null;
  }
  function draftsRestored() {
    const drafts = capability("visitorDrafts");
    return Boolean(drafts && typeof drafts.restored === "function" && drafts.restored()?.restored);
  }
  var MUTATION_READY = ["clay:mutation-ready", "hyperclay:mutation-ready"];
  var LIVESYNC_APPLIED = ["clay:sync-applied", "hyperclay:livesync-applied"];
  var PLATFORM_READY = ["clay:ready", "hyperclay:ready"];
  var ROUTE_CHANGED = ["clay:route"];
  var MODE_CHANGED = ["clay:modechange"];
  function onPlatformEvent(target, names, handler) {
    let claimedBy = null;
    const wrapped = (event) => {
      if (claimedBy !== null && claimedBy !== event.type) return;
      claimedBy = event.type;
      queueMicrotask(() => {
        claimedBy = null;
      });
      handler(event);
    };
    for (const name of names) target.addEventListener(name, wrapped);
    return () => {
      for (const name of names) target.removeEventListener(name, wrapped);
    };
  }
  function whenPlatformReady(fn) {
    const ready = typeof window !== "undefined" && window.clay && window.clay.ready;
    if (ready && typeof ready.then === "function") ready.then(() => fn(), () => fn());
    else fn();
  }
  function regionSkipsSave(el) {
    const region = capability("region");
    if (!region || typeof region.resolveRegionPolicy !== "function" || typeof region.skipForPolicy !== "function") {
      return false;
    }
    return region.skipForPolicy(region.resolveRegionPolicy(el), void 0, ["no-save", "freeze"]);
  }
  function modeSession() {
    if (typeof window === "undefined") return null;
    return window.clay?.modeLifecycle || null;
  }
  function mayWriteRecord(node, { transient = false } = {}) {
    if (transient) return true;
    const lifecycle = modeSession();
    if (typeof lifecycle?.canWrite !== "function") return true;
    const policy = capability("region")?.resolveRegionPolicy?.(node);
    if (policy?.persist === "none") return true;
    return lifecycle.canWrite();
  }
  function batch(label, fn) {
    if (typeof fn !== "function") throw new Error("Sap.batch(label, fn): fn must be a function");
    const u = capability("undo");
    if (u && u.flush) u.flush();
    const r = fn();
    if (r && typeof r.then === "function") throw new Error("Sap.batch fn must be synchronous (it returned a promise)");
    if (u && u.commitCaptured) u.commitCaptured(label);
    return r;
  }
  function installBridges(runtime2) {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const refreshConnected = () => {
      let disconnected = false;
      for (const app of runtime2.apps()) {
        if (app.root.isConnected) runtime2.runNow(app, "platform");
        else disconnected = true;
      }
      if (disconnected) runtime2.pruneDisconnected();
      runtime2.remountIfPresent();
    };
    const derived = capability("derived");
    const offDerived = derived && typeof derived.register === "function" ? derived.register(refreshConnected) : null;
    const offApplied = typeof offDerived === "function" ? null : onPlatformEvent(document, LIVESYNC_APPLIED, refreshConnected);
    const offRoute = onPlatformEvent(document, ROUTE_CHANGED, refreshConnected);
    let undoHandles = null;
    let retired = false;
    const dropUndo = () => {
      const old = undoHandles;
      undoHandles = null;
      if (old) {
        old[2]();
        old[3]();
      }
    };
    const bindUndo = () => {
      if (retired) return false;
      const undo = capability("undo");
      const generation = modeSession()?.state?.generation;
      if (undoHandles && undoHandles[0] === undo && undoHandles[1] === generation) return true;
      dropUndo();
      if (!undo || typeof undo.on !== "function") return false;
      const offUndo = undo.on("undo", refreshConnected);
      if (typeof offUndo !== "function") return false;
      const offRedo = undo.on("redo", refreshConnected);
      if (typeof offRedo !== "function") {
        offUndo();
        return false;
      }
      undoHandles = [undo, generation, offUndo, offRedo];
      return true;
    };
    bindUndo();
    const offWake = [MUTATION_READY, PLATFORM_READY, MODE_CHANGED].map((names) => onPlatformEvent(document, names, bindUndo));
    const ready = capability("ready");
    if (ready && typeof ready.then === "function") ready.then(bindUndo, () => {
    });
    return () => {
      retired = true;
      if (typeof offDerived === "function") offDerived();
      if (offApplied) offApplied();
      offRoute();
      for (const off of offWake) off();
      dropUndo();
    };
  }

  // src/carrier.js
  function kindOf(el) {
    const tag = el.tagName;
    if (tag === "INPUT") {
      const t = (el.getAttribute("type") || "text").toLowerCase();
      if (t === "checkbox") return "checkbox";
      if (t === "radio") return "radio";
      if (t === "number" || t === "range") return "number";
      if (t === "hidden") return "hidden";
      return "text";
    }
    if (tag === "TEXTAREA") return "text";
    if (tag === "SELECT") return el.multiple ? "select-multiple" : "select-one";
    return "leaf";
  }
  function readNumber(el) {
    if (el.validity && el.validity.badInput) {
      if (el.hasAttribute("value")) return Number(el.getAttribute("value")) || 0;
      return el._sapLastGood ?? 0;
    }
    if (el.value === "") return 0;
    const n2 = Number(el.value);
    if (Number.isNaN(n2)) return el._sapLastGood ?? 0;
    el._sapLastGood = n2;
    return n2;
  }
  function readBy(el, kind) {
    switch (kind) {
      case "checkbox":
        return el.checked;
      case "radio":
        return el.checked ? el.value : void 0;
      case "number":
        return readNumber(el);
      case "select-one":
        return el.value;
      case "select-multiple":
        return [...el.selectedOptions].map((o) => o.value);
      case "hidden":
      case "text":
        return el.value;
      case "leaf":
        return el.textContent;
      default:
        return el.value;
    }
  }
  function writeBy(el, kind, v) {
    switch (kind) {
      case "checkbox":
        el.checked = !!v;
        break;
      case "radio":
        el.checked = String(el.value) === String(v);
        break;
      case "number":
      case "text":
      case "hidden":
        el.value = v == null ? "" : String(v);
        break;
      case "select-one":
        el.value = v == null ? "" : String(v);
        break;
      case "select-multiple": {
        const set = new Set((Array.isArray(v) ? v : [v]).map(String));
        for (const opt of el.options) opt.selected = set.has(opt.value);
        break;
      }
      case "leaf":
        el.textContent = v == null ? "" : String(v);
        break;
      default:
        el.value = v == null ? "" : String(v);
    }
  }
  function mirror(el) {
    if (el.hasAttribute("transient")) {
      el.removeAttribute("value");
      el.removeAttribute("checked");
      el.removeAttribute("data-value");
      return;
    }
    if (regionSkipsSave(el)) return;
    serializeControlToAttributes(el);
  }
  function fire(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function readControl(el, kind) {
    return readBy(el, kind);
  }
  function carrierFor(el) {
    const kind = kindOf(el);
    return {
      el,
      kind,
      read() {
        return readBy(el, kind);
      },
      write(v, opts = {}) {
        writeBy(el, kind, v);
        if (!opts.noMirror) mirror(el);
        if (!opts.silent) fire(el);
      },
      mirror() {
        mirror(el);
      }
    };
  }

  // src/mutation-bridge.js
  var NONE = [];
  var activeSource = null;
  var pausing = 0;
  var remount = null;
  var installed = false;
  var lateHubListener = null;
  function hubSource(M) {
    let unsub = null;
    return {
      kind: "hub",
      // The hub delivers what the browser has queued when a pause begins.
      flush() {
        M.pause();
        M.resume();
      },
      subscribe(onChanges) {
        const ret = M.onAnyChange({ debounce: 0, require: "observed" }, onChanges);
        if (typeof ret === "function") unsub = ret;
      },
      // The hub delivers on its own, and only when no pause is under way.
      suppress(fn) {
        M.pause();
        try {
          return fn();
        } finally {
          M.resume();
        }
      },
      teardown() {
        if (unsub) {
          try {
            unsub();
          } catch {
          }
          unsub = null;
        }
      }
    };
  }
  function nativeSource() {
    let observer2 = null;
    let deliver = null;
    function flush() {
      const queued = observer2 ? observer2.takeRecords() : NONE;
      if (queued.length) deliver(changesFromRecords(queued));
    }
    return {
      kind: "native",
      flush,
      subscribe(onChanges) {
        deliver = onChanges;
        observer2 = new MutationObserver((records) => onChanges(changesFromRecords(records)));
        const target = document.body || document.documentElement;
        if (target) {
          observer2.observe(target, { childList: true, subtree: true, attributes: true, characterData: true });
        }
      },
      suppress(fn, outer) {
        const u = capability("undo");
        if (outer) flush();
        if (u && u.pause) u.pause();
        try {
          return fn();
        } finally {
          if (observer2) observer2.takeRecords();
          if (u && u.resume) u.resume();
        }
      },
      teardown() {
        if (observer2) {
          observer2.disconnect();
          observer2 = null;
        }
      }
    };
  }
  function changesFromRecords(records) {
    const out = [];
    for (const rec of records) {
      if (rec.type === "attributes") {
        const el = rec.target;
        if (el && el.nodeType === 1 && !inertSubtree(el)) out.push({ type: "attribute", element: el, attribute: rec.attributeName });
      } else if (rec.type === "characterData") {
        const el = rec.target && rec.target.parentElement;
        if (el && !inertSubtree(el)) out.push({ type: "characterData", element: el });
      } else if (rec.type === "childList") {
        const parent = rec.target;
        if (parent.nodeType === 1 && [...rec.addedNodes, ...rec.removedNodes].some((node) => node.nodeType === 3) && !inertSubtree(parent)) {
          out.push({ type: "characterData", element: parent });
        }
        const closed = rec.addedNodes.length > 0 && parent.nodeType === 1 && closedOwner(parent);
        for (const node of rec.addedNodes) {
          if (node.nodeType !== 1 || inertSubtree(node)) continue;
          if (closed) out.push({ type: "add", element: node, parent });
          else walkVisible(node, (el) => {
            if (el === node || !inertSubtree(el)) out.push({ type: "add", element: el, parent });
          });
        }
        for (const node of rec.removedNodes) {
          if (node.nodeType !== 1) continue;
          out.push({ type: "remove", element: node, parent });
        }
      }
    }
    return out;
  }
  function inertSubtree(el) {
    return !!(el.closest && el.closest("[sap-ignore],[template],[cms-template]"));
  }
  function scheduleAffectedApps(runtime2, changes) {
    runtime2.pruneDisconnected();
    const affected = /* @__PURE__ */ new Map();
    let needRemount = false;
    for (const c of changes) {
      const target = c.type === "remove" ? c.parent : c.element;
      const app = target && runtime2.appFor(target);
      if (app) {
        const list = affected.get(app);
        if (list) list.push(c);
        else affected.set(app, [c]);
      }
      if (c.type === "add" && c.element && c.element.nodeType === 1 && c.element.hasAttribute && c.element.hasAttribute("sap") && !(runtime2.isRegistered && runtime2.isRegistered(c.element))) {
        needRemount = true;
      }
    }
    if (needRemount) {
      remount = runtime2.remountIfPresent;
      if (pausing) queueMicrotask(mountFound);
      else mountFound();
    }
    for (const [app, list] of affected) if (app.root.isConnected) runtime2.schedule(app, "mutation", list);
  }
  function mountFound() {
    const mount2 = remount;
    remount = null;
    mount2?.();
  }
  function withDomMutationPaused(fn) {
    if (activeSource) {
      const outer = !pausing++;
      try {
        return activeSource.suppress(fn, outer);
      } finally {
        pausing--;
      }
    }
    const u = capability("undo");
    if (u && u.pause && u.resume) {
      u.pause();
      try {
        return fn();
      } finally {
        u.resume();
      }
    }
    return fn();
  }
  function activate(source, runtime2) {
    installed = true;
    activeSource = source;
    source.subscribe((changes) => scheduleAffectedApps(runtime2, changes));
  }
  function installMutationBridge(runtime2) {
    if (installed) return;
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const M = capability("Mutation");
    if (M && typeof M.onAnyChange === "function") {
      activate(hubSource(M), runtime2);
      return;
    }
    if (typeof MutationObserver === "function") {
      activate(nativeSource(), runtime2);
      lateHubListener = onPlatformEvent(document, MUTATION_READY, function onLateHub() {
        const M2 = capability("Mutation");
        if (!M2) return;
        lateHubListener();
        lateHubListener = null;
        if (activeSource) activeSource.teardown();
        installed = false;
        activate(hubSource(M2), runtime2);
      });
    }
  }
  function resetMutationBridge() {
    if (activeSource) {
      try {
        activeSource.teardown();
      } catch {
      }
    }
    if (lateHubListener && typeof document !== "undefined") {
      lateHubListener();
    }
    activeSource = null;
    installed = false;
    lateHubListener = null;
  }
  function flushMutationBridge() {
    if (pausing) return;
    if (activeSource) activeSource.flush();
    mountFound();
  }

  // src/pass.js
  var NATIVE_BOOLEAN_SET2 = new Set(NATIVE_BOOLEANS);
  var NONE2 = Object.freeze([]);
  var features = [];
  var boundaries2 = {};
  var paintKinds = {};
  var host = null;
  function registerFeature(feature) {
    if (features.includes(feature)) return;
    features.push(feature);
    features.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
    if (feature.boundary) Object.assign(boundaries2, feature.boundary);
    if (feature.paintKinds) Object.assign(paintKinds, feature.paintKinds);
  }
  function setPassHost(fn) {
    host = fn;
  }
  function runPass(app, opts = {}) {
    if (opts.breaker) {
      app.diag.error("E26", app.root, {
        problem: "recompute loop halted after 50 passes; recent triggers: " + (app._breakerRing || []).join(", ")
      });
      setBeacon(app.root, "loop");
      return;
    }
    if (opts.full) {
      dropPlans();
      dropReads();
    }
    app._inPass = true;
    const plans = beginPlans(app.root);
    let pass = null;
    try {
      withDomMutationPaused(() => {
        pass = runPassBody(app, opts);
      });
    } finally {
      app._inPass = false;
      endPlans(plans);
    }
    if (host && pass) host(app, pass);
    if (app._viewsChanged) {
      app._viewsChanged = false;
      app.root.dispatchEvent(new CustomEvent("sap:views-updated", { bubbles: true }));
    }
  }
  function runPassBody(app, opts) {
    const root = app.root;
    const rootObj = {};
    const paints = [];
    const pending = [];
    const whenFields = /* @__PURE__ */ new Set();
    app.diag.errors = [];
    const changes = opts.full || app._changes === false ? null : app._changes || NONE2;
    app._changes = null;
    const waiting = /* @__PURE__ */ new Set();
    const wanted = /* @__PURE__ */ new Map();
    const want = (names, el) => names.map((name) => wanted.get(name)?.push(el) ?? wanted.set(name, [el]));
    const rootCtx = { root: rootObj, state: rootObj, item: null, ownerEl: root, projection: false };
    let recording = null;
    function resolveDefault(el, d, cacheRecord = false) {
      const attr = d.attr || d.name;
      let raw = cacheRecord ? readAttr(el, attr) : el.getAttribute(attr);
      if (raw == null) {
        raw = defaultRaw(d);
        pending.push({ el, name: d.name, attr, value: serializeTyped(parseTyped(raw, d.type), d.type) });
      }
      return parseTyped(raw, d.type);
    }
    function readState(el, plan, obj, ctx) {
      const decls = plan.decls;
      if (!decls) return;
      const cacheRecord = !!ctx.item && !ctx.projection && !ctx.view;
      for (const d of decls) {
        if (d.transient) {
          if (recording) recording.pure = false;
          obj[d.name] = readTransient(el, d);
          continue;
        }
        if (isPresenceDecl(el, d)) {
          obj[d.name] = el.hasAttribute(d.attr);
          continue;
        }
        obj[d.name] = resolveDefault(el, d, cacheRecord);
      }
    }
    function readBindInto(el, plan, ctx) {
      const field = plan.bind;
      const owner = ctx.item || ctx.state;
      const kind = kindOf(el);
      if (recording && (kind !== "leaf" || plan.transient)) recording.pure = false;
      if (kind === "radio") {
        if (!(field in owner)) owner[field] = "";
        if (el.checked) owner[field] = el.value;
      } else if (kind === "leaf" && ctx.item && !ctx.projection && !ctx.view) {
        owner[field] = readText(el);
      } else {
        owner[field] = readControl(el, kind);
      }
      if (plan.transient) {
        el.removeAttribute("value");
        el.removeAttribute("checked");
      }
    }
    function collectEl(el, plan, ctx) {
      let kept = false;
      if (plan.waits) waiting.add(plan.waits);
      if (plan.wants) {
        want(plan.wants, el);
        kept = true;
      }
      if (recording && plan.impure) recording.pure = false;
      if (plan.paints) {
        kept = true;
        for (const def of plan.paints) {
          if (def.kind === "when") whenFields.add(def.field);
          paints.push({ def, el, ctx });
        }
      }
      for (const f of features) if (f.collect && f.collect(pass, el, plan, ctx) !== false) kept = true;
      if (recording && kept) {
        if (plan.calcs) recording.pure = false;
        recording.collects.push(el, plan);
      }
    }
    function defineRowMeta(rowObj, rowEl, i) {
      Object.defineProperty(rowObj, "$key", { value: keyOf(rowEl, "row"), enumerable: false });
      Object.defineProperty(rowObj, "$index", { value: i, enumerable: false, configurable: true });
      Object.defineProperty(rowObj, "$el", { value: rowEl, enumerable: false });
    }
    function enterScope(el, obj, ctx) {
      const plan = planOf(el);
      readState(el, plan, obj, ctx);
      el._sapScope = obj;
      if (!ctx.projection && plan.bind != null) readBindInto(el, plan, ctx);
      collectEl(el, plan, ctx);
      if (plan.items) handleItems(el, obj, ctx);
      else walkScope(el, obj, ctx);
    }
    function walkScope(scopeEl, scopeObj, ctx) {
      for (let el = scopeEl.firstElementChild; el; el = el.nextElementSibling) visitOwned(el, scopeObj, ctx);
    }
    function visitOwned(el, scopeObj, ctx) {
      const plan = planOf(el);
      if (plan.inert) return;
      if (plan.boundary) {
        if (recording) recording.pure = false;
        if (plan.boundary === "scope") handleScope(el, scopeObj, ctx);
        else if (plan.boundary === "items") {
          collectEl(el, plan, ctx);
          handleItems(el, scopeObj, ctx);
        } else if (plan.waits) {
          waiting.add(plan.waits);
        } else {
          const enter = boundaries2[plan.boundary];
          if (enter) enter(pass, el, plan, scopeObj, ctx);
          else if (plan.wants) want(plan.wants, el);
        }
        return;
      }
      if (!ctx.projection && !ctx.view && plan.bind != null) readBindInto(el, plan, ctx);
      collectEl(el, plan, ctx);
      for (let c = el.firstElementChild; c; c = c.nextElementSibling) visitOwned(c, scopeObj, ctx);
    }
    function handleScope(el, parentObj, ctx) {
      const name = el.getAttribute("scope");
      const childObj = {};
      parentObj[name] = childObj;
      const cctx = { root: ctx.root, state: childObj, item: null, ownerEl: el, projection: ctx.projection };
      enterScope(el, childObj, cctx);
    }
    function handleItems(listEl, parentObj, ctx) {
      if (recording) recording.pure = false;
      const name = listEl.getAttribute("items");
      const arr = [];
      parentObj[name] = arr;
      listEl._sapList = arr;
      const keep = !ctx.projection && !ctx.view && keepsRows();
      let i = 0;
      for (let rowEl = listEl.firstElementChild; rowEl; rowEl = rowEl.nextElementSibling) {
        const rp = planOf(rowEl);
        if (!rp.item || rp.template || rp.cms) continue;
        const kept = keep ? keptRow(rowEl) : void 0;
        arr.push(kept && kept.plan === rp && Object.isExtensible(kept.obj) && reuseRow(kept, rowEl, i, ctx) || readRow(rowEl, rp, i, ctx, keep));
        i++;
      }
    }
    function readRow(rowEl, rp, i, ctx, keep) {
      const rowObj = {};
      defineRowMeta(rowObj, rowEl, i);
      const rctx = { root: ctx.root, state: ctx.state, item: rowObj, ownerEl: rowEl, projection: ctx.projection };
      if (!keep) {
        enterScope(rowEl, rowObj, rctx);
        return rowObj;
      }
      const outer = recording;
      const rec = { plan: rp, obj: rowObj, fields: null, presence: NONE2, pending: NONE2, collects: [], pure: true };
      const p0 = pending.length;
      const e0 = app.diag.errors.length;
      recording = rec;
      try {
        enterScope(rowEl, rowObj, rctx);
      } finally {
        recording = outer;
      }
      if (!rec.pure || app.halted || app.diag.errors.length !== e0) return rowObj;
      const fields = [];
      for (const k of Object.keys(rowObj)) {
        const v = rowObj[k];
        if (v !== null && typeof v === "object") return rowObj;
        fields.push(k, v);
      }
      if (rp.decls) {
        for (const d of rp.decls) if (isPresenceDecl(rowEl, d)) (rec.presence === NONE2 ? rec.presence = [] : rec.presence).push(d.name, d.attr);
      }
      if (pending.length > p0) rec.pending = pending.slice(p0);
      if (!rec.collects.length) rec.collects = NONE2;
      rec.fields = fields;
      keepRow(rowEl, rec);
      return rowObj;
    }
    function reuseRow(rec, rowEl, i, ctx) {
      const obj = rec.obj;
      try {
        if (obj.$index !== i) Object.defineProperty(obj, "$index", { value: i, enumerable: false, configurable: true });
        const live = rec.presence;
        for (let k = 0; k < live.length; k += 2) obj[live[k]] = rowEl.hasAttribute(live[k + 1]);
        const f = rec.fields;
        for (let k = 0; k < f.length; k += 2) obj[f[k]] = f[k + 1];
      } catch {
        forgetRow(rowEl);
        return null;
      }
      rowEl._sapScope = obj;
      const p = rec.pending;
      for (let k = 0; k < p.length; k++) pending.push(p[k]);
      const c = rec.collects;
      if (c.length) {
        const rctx = { root: ctx.root, state: ctx.state, item: obj, ownerEl: rowEl, projection: ctx.projection };
        for (let k = 0; k < c.length; k += 2) collectEl(c[k], c[k + 1], rctx);
      }
      return obj;
    }
    const pass = {
      app,
      root,
      rootObj,
      paints,
      stats: { calcs: 0, lists: 0 },
      resolveDefault,
      collectEl,
      walkScope,
      changes,
      full: changes === null,
      trigger: opts.cause || opts.trigger || "refresh",
      waiting,
      wanted
    };
    for (const f of features) if (f.begin) f.begin(pass);
    const reads = opts.cacheReads === false ? null : beginReads(root);
    try {
      enterScope(root, rootObj, rootCtx);
    } finally {
      if (opts.cacheReads !== false) endReads(reads);
    }
    if (app.halted) return pass;
    if (waiting.size) return pass;
    for (const f of features) if (f.afterIntake) f.afterIntake(pass);
    if (pending.length && whenFields.size) {
      for (const w of pending) {
        if (whenFields.has(w.attr) && w.el.getAttribute(w.attr) == null) {
          w.el.setAttribute(w.attr, w.value);
        }
      }
    }
    for (const f of features) if (f.compute) f.compute(pass);
    let viewChanges = 0;
    for (const f of features) if (f.reconcile) viewChanges += f.reconcile(pass);
    let writes = 0;
    let viewWrites = viewChanges;
    for (const p of paints) {
      const n2 = paintOne(p, app);
      if (p.ctx.view) viewWrites += n2;
      else writes += n2;
    }
    for (const f of features) if (f.afterPaint) f.afterPaint(pass);
    app._state = rootObj;
    app._stats = {
      fields: Object.keys(rootObj).filter((k) => typeof rootObj[k] !== "function").length,
      calcs: pass.stats.calcs,
      paints: paints.length,
      lists: pass.stats.lists,
      writes,
      viewWrites
    };
    app._viewsChanged = viewWrites > 0;
    app._lastPass = { trigger: opts.trigger || "refresh", writes };
    if (app._debug) {
      console.log(`sap pass \xB7 trigger: ${app._lastPass.trigger} \xB7 writes ${writes}/${paints.length}`);
    }
    return pass;
  }
  function paintAttrName(def) {
    const tail = def.kind === "text" ? def.fmt || null : def.arg;
    return tail == null ? def.kind : def.kind + ":" + tail;
  }
  function nearestMode(el, field, values2, notMode) {
    let cur = el;
    while (cur && cur.nodeType === 1) {
      if (cur.hasAttribute && cur.hasAttribute(field)) {
        const inList = values2.includes(cur.getAttribute(field));
        if (notMode ? !inList : inList) return true;
      }
      cur = cur.parentElement;
    }
    return false;
  }
  function paintOne(p, app) {
    const def = p.def;
    const el = p.el;
    const custom = paintKinds[def.kind];
    if (custom) return custom(p, app);
    if (def.kind === "when") {
      return applyPaint(def, el, null);
    }
    try {
      const value = runWith(def.entry, p.ctx.state, p.ctx.item, el, p.ctx.root);
      const n2 = applyPaint(def, el, value);
      clearBeacon(el);
      return n2;
    } catch (err) {
      app.diag.error(err.sapCode === "E22" ? "E22" : "E24", el, {
        attr: paintAttrName(def),
        expr: def.entry && def.entry.src,
        problem: String(err.message)
      });
      setBeacon(el, err.sapCode || "E24");
      return 0;
    }
  }
  function applyPaint(def, el, value) {
    switch (def.kind) {
      case "text": {
        const s = def.fmt != null ? applyFormat(def.fmt, value) : value == null ? "" : String(value);
        if (el.textContent !== s) {
          el.textContent = s;
          return 1;
        }
        return 0;
      }
      case "show": {
        const hide = !value;
        if (el.hidden !== hide) {
          el.hidden = hide;
          return 1;
        }
        return 0;
      }
      case "when": {
        const ov = capability("optionVisibility");
        if (ov && ov._started) {
          if (el._sapWhen && el.hidden) {
            el.hidden = false;
            el._sapWhen = false;
            return 1;
          }
          return 0;
        }
        el._sapWhen = true;
        const hide = nearestMode(el, def.field, def.values, def.match === "show-not") === (def.match === "hide");
        if (el.hidden !== hide) {
          el.hidden = hide;
          return 1;
        }
        return 0;
      }
      case "attr": {
        const a = def.arg;
        if ((a === "checked" || a === "selected") && typeof el[a] === "boolean" && !el.hasAttribute("bind") && !el.closest("select[bind]")) {
          let n2 = 0;
          if (el[a] !== !!value) {
            el[a] = !!value;
            n2 = 1;
          }
          if (!!value !== el.hasAttribute(a)) {
            if (value) el.setAttribute(a, "");
            else el.removeAttribute(a);
            n2 = 1;
          }
          return n2;
        }
        if (NATIVE_BOOLEAN_SET2.has(a)) {
          const has = el.hasAttribute(a);
          if (value && !has) {
            el.setAttribute(a, "");
            return 1;
          }
          if (!value && has) {
            el.removeAttribute(a);
            return 1;
          }
          return 0;
        }
        const s = typeof value === "boolean" ? String(value) : value == null ? "" : String(value);
        if (el.getAttribute(a) !== s) {
          el.setAttribute(a, s);
          return 1;
        }
        return 0;
      }
      case "class": {
        const on = !!value;
        if (el.classList.contains(def.arg) !== on) {
          el.classList.toggle(def.arg, on);
          return 1;
        }
        return 0;
      }
      case "css": {
        const s = value == null ? "" : String(value);
        if (el.style.getPropertyValue("--" + def.arg) !== s) {
          el.style.setProperty("--" + def.arg, s);
          return 1;
        }
        return 0;
      }
      default:
        return 0;
    }
  }

  // src/lint.js
  var NATIVE_BOOLEAN_SET3 = new Set(NATIVE_BOOLEANS);
  var COLON_PREFIXES = /* @__PURE__ */ new Set(["calc", "text", "attr", "class", "css", "set", "move", "sort", "option", "option-not", "show-when", "hide-when", "editmode", "viewmode"]);
  var WHEN_PREFIXES = /* @__PURE__ */ new Set(["show-when", "hide-when", "option", "option-not"]);
  var EXPR_SHAPED = /\b(?:state|item|root)\.|===|!==|&&|\|\||[()]|^\s*!/;
  var KNOWN_BARE = /* @__PURE__ */ new Set([
    "sap",
    "scope",
    "items",
    "item",
    "template",
    "bind",
    "show",
    "effect",
    "invalid",
    "detail",
    "state",
    "transient",
    "confirm",
    "default",
    "persist",
    "sortable",
    "trigger-add",
    "trigger-remove",
    "trigger-reset",
    "sap-ignore",
    "sap-error",
    "no-save",
    "no-watch",
    "no-undo",
    // hyperclayjs platform region markers (canonical + legacy aliases). sapjs tolerates
    // them so a co-loaded region attribute inside a [sap] root is never flagged a typo.
    "no-trigger-autosave",
    "freeze",
    "mutations-ignore",
    "save-remove",
    "save-ignore",
    "save-freeze"
  ]);
  var extraChecks = [];
  function addLintCheck(check) {
    if (!extraChecks.includes(check)) extraChecks.push(check);
  }
  function isControl(el) {
    return el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA";
  }
  function isBound(el) {
    return el.hasAttribute("bind");
  }
  function walkAll(root, visit) {
    visit(root);
    for (let child = root.firstElementChild; child; child = child.nextElementSibling) descend(child);
    function descend(el) {
      if (el.hasAttribute("sap-ignore")) return;
      if (el.tagName === "TEMPLATE") {
        if (el.hasAttribute("items")) for (let c = el.content.firstElementChild; c; c = c.nextElementSibling) descend(c);
        return;
      }
      visit(el);
      if (closedBoundary(el)) return;
      for (let c = el.firstElementChild; c; c = c.nextElementSibling) descend(c);
    }
  }
  function lintApp(root, diag) {
    let halted = false;
    const halt = (code, el, info) => {
      diag.error(code, el, info);
      halted = true;
    };
    const tw = root.ownerDocument.createTreeWalker(root, 5, {
      acceptNode: (n2) => n2.nodeType === 3 ? 1 : closedBoundary(n2) || n2.hasAttribute("bind") || n2.hasAttribute("sap-ignore") ? 2 : 3
    });
    let node;
    while (node = tw.nextNode()) {
      if (/\{\{.*\}\}/.test(node.nodeValue || "")) {
        halt("E02", node.parentElement || root, {
          problem: "moustaches in text content are not a Sap feature",
          fix: 'move the expression onto the element: text="state.x"'
        });
        break;
      }
    }
    walkAll(root, (el) => {
      const claimed = /* @__PURE__ */ new Set();
      for (const check of extraChecks) check(el, halt, (name) => claimed.add(name));
      const inDetail = el.closest && el.closest("[detail]");
      for (const a of [...el.attributes]) {
        const name = a.name;
        if (claimed.has(name)) continue;
        if (name.includes(":")) {
          const prefix = name.slice(0, name.indexOf(":"));
          if (!COLON_PREFIXES.has(prefix) && !declaredAttr(name)) {
            const dym = didYouMean(prefix, [...COLON_PREFIXES]);
            diag.warn("W03", el, {
              attr: name,
              problem: `unknown "${prefix}:" attribute`,
              didYouMean: dym ? `${dym}:` : null
            });
          } else if (WHEN_PREFIXES.has(prefix) && EXPR_SHAPED.test(a.value)) {
            const field = name.slice(name.indexOf(":") + 1);
            diag.warn("W04", el, {
              attr: name,
              expr: a.value,
              problem: `${prefix}: compares the "${field}" attribute against a literal value, not a JS expression`,
              fix: `use show="${a.value}" for an expression, or a literal like ${prefix}:${field}="overview"`
            });
          }
        } else if (!KNOWN_BARE.has(name) && !declaredAttr(name) && !HTML_GLOBALS.has(name) && !NATIVE_BOOLEAN_SET3.has(name) && !/^(data-|aria-|on)/.test(name) && !(name in el)) {
          const dym = didYouMean(name, [...KNOWN_BARE]);
          if (dym) {
            diag.warn("W03", el, { attr: name, problem: `unknown "${name}" attribute`, didYouMean: dym });
          }
        }
        if (name === "attr:hidden") {
          diag.warn("W03", el, { attr: name, problem: "attr:hidden paints the wrong attribute", fix: 'use show="expr"' });
        }
        const ownedByBind = isBound(el) || name === "attr:selected" && el.tagName === "OPTION" && !!el.closest("select[bind]");
        if ((name === "attr:value" || name === "attr:checked" || name === "attr:selected") && ownedByBind) {
          halt("E30", el, { attr: name, problem: "attr: on a bound control collides with persist ownership", fix: "remove it; bind owns this attribute" });
        }
        if (name === "effect" && isBound(el) && /\b(value|checked)\s*=[^=]/.test(a.value)) {
          halt("E30", el, { attr: name, expr: a.value, problem: "effect writes value/checked on a bound control (writes a stale value with no synthetic event)", fix: "write through onclick + Sap(this) instead" });
        }
        if ((name === "text" || name.startsWith("text:") || name === "show") && isControl(el)) {
          if (name === "show") {
          } else {
            halt("E18", el, { attr: name, problem: "paint belongs on output elements, not form controls", fix: "move the paint to an <output> or <span>" });
          }
        }
      }
      if (el.hasAttribute("state")) {
        const decls = parseStateDecl(el.getAttribute("state"));
        const seen = /* @__PURE__ */ new Set();
        for (const d of decls) {
          if (d.name.includes("-")) {
            halt("E08", el, { attr: "state", problem: `field "${d.name}" is not a valid identifier (the hyphen parses as subtraction)`, fix: `rename to ${d.name.replace(/-/g, "")}` });
          }
          if (seen.has(d.name)) halt("E04", el, { attr: "state", problem: `field "${d.name}" is declared twice in one scope` });
          seen.add(d.name);
          if (RESERVED.has(d.attr)) halt("E05", el, { attr: "state", problem: `"${d.name}" is a reserved Sap word` });
          if (HTML_GLOBALS.has(d.attr)) halt("E06", el, { attr: "state", problem: `"${d.name}" is a global HTML attribute name; pick another field name` });
          if (d.name === "open" && el.tagName === "DIALOG") {
            halt("E33", el, { attr: "state", problem: "dialog open is transient", fix: "use showModal() \u2014 declare state= only on <details> or popovers" });
          }
          const native = isNativeBoolean(el, d.attr);
          if (native && (d.attr === "checked" || d.attr === "selected")) {
            halt("E35", el, { attr: "state", problem: `"${d.attr}" on a form control is the control's own state, not a declared field`, fix: 'bind the control instead, e.g. <input type="checkbox" bind="done">' });
          }
          if (native && d.type === "num") {
            halt("E35", el, { attr: "state", problem: `"${d.attr}" is an HTML boolean attribute; it cannot hold a number`, fix: `declare it bare: state="${d.attr}"` });
          }
          if (d.transient && (native || d.type === "presence")) {
            halt("E35", el, { attr: "state", problem: `"${d.name}" is carried by attribute presence, which transient would strip`, fix: "declare a separate name:bool:transient field and paint the attribute from it" });
          }
        }
      }
      if (isBound(el)) {
        if (el.hasAttribute("-")) {
        }
        if (el.tagName === "INPUT") {
          const t = (el.getAttribute("type") || "text").toLowerCase();
          if (t === "file") halt("E32", el, { attr: "bind", problem: "files never serialize into an HTML file", fix: "use no-save + effect instead of bind" });
          if (t === "password" && !el.hasAttribute("transient")) {
            halt("E31", el, { attr: "bind", problem: "a password must never serialize into a world-readable file", fix: "add transient to the password input" });
          }
        } else if (el.tagName !== "SELECT" && el.tagName !== "TEXTAREA") {
          const ce = el.getAttribute("contenteditable");
          const editable = ce != null && ce !== "false";
          if (!editable && el.children.length > 0) {
            halt("E20", el, { attr: "bind", problem: "bind on a container element is not a control; a write would overwrite its children", fix: "bind a control (input/select/textarea), a contenteditable, or an empty text leaf" });
          }
        }
      }
      if (el.hasAttribute("transient") && el.hasAttribute("persist")) {
        halt("E34", el, {
          problem: "transient and persist are opposite: persist forces the live value into the saved bytes, leaking exactly what transient drops",
          fix: "remove one \u2014 transient to keep it out of the file, or persist to save it"
        });
      }
      if (el.tagName === "DIALOG" && el.hasAttribute("detail") && !(el.parentElement && el.parentElement.closest('[clay~="freeze"], [freeze], [save-freeze]'))) {
        diag.warn("W31", el, {
          attr: "detail",
          problem: "a detail dialog writes open when it opens, and that attribute would be saved into the file",
          fix: 'wrap the dialog in an element with clay="freeze" (not editor-ui, which removes it from the file), and make its key field transient'
        });
      }
      if (el.hasAttribute("item") && !el.hasAttribute("template") && el.parentNode && el.parentNode.nodeType === 1) {
        const list = el.parentElement;
        if (!list || !list.hasAttribute("items")) {
          halt("E10", el, { problem: "an [item] must be a direct child of an [items] list", fix: 'wrap it in a container with items="name"' });
        }
      }
      if (el.hasAttribute("items") && inDetail) {
        halt("E17", el, { attr: "items", problem: "nested items inside a detail panel is a v1 mount error (nested collections ship in v1.1)" });
      }
      if (el.hasAttribute("items")) {
        const targeted = root.querySelector(`[trigger-add="${el.getAttribute("items")}"]`);
        if (!templateOf(el) && !sharedTemplate(root, el.getAttribute("items")) && rowsOf(el).length === 0 && targeted) {
          halt("E17", el, { attr: "items", problem: `trigger-add targets items="${el.getAttribute("items")}" but it has no [item template] to clone` });
        }
      }
    });
    if (halted) {
      diag.halted = true;
      diag.haltReason = diag.errors[0] ? diag.errors[0].code : "halt";
      setBeacon(root, diag.haltReason);
    }
    return !halted;
  }

  // src/mount.js
  var STYLE_ID = "sap-styles";
  var STYLE_TEXT = "[item][template]{display:none!important}[hidden]{display:none!important}[sap-error]{outline:2px solid #e5484d;outline-offset:1px}";
  var styledDocs = /* @__PURE__ */ new WeakSet();
  function injectStyles(doc) {
    if (styledDocs.has(doc)) return;
    const view = doc.defaultView;
    const SheetCtor = view && view.CSSStyleSheet;
    if (SheetCtor && "adoptedStyleSheets" in doc) {
      try {
        const sheet = new SheetCtor();
        sheet.replaceSync(STYLE_TEXT);
        doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
        styledDocs.add(doc);
        return;
      } catch {
      }
    }
    if (!doc.getElementById(STYLE_ID)) {
      const style = doc.createElement("style");
      style.id = STYLE_ID;
      style.textContent = STYLE_TEXT;
      (doc.head || doc.documentElement).appendChild(style);
    }
    styledDocs.add(doc);
  }
  var appSeq = 0;
  function now() {
    return typeof performance !== "undefined" && performance.now ? performance.now() : 0;
  }
  function mountApp(root) {
    const name = root.id || root.getAttribute("sap") || `app-${appSeq++}`;
    const diag = new Diagnostics(name);
    const appRec = {
      root,
      name,
      diag,
      _state: null,
      _stats: null,
      _lastPass: null,
      _passes: 0,
      _broken: false,
      _mountMs: 0,
      _mountWrites: 0
    };
    const ok = lintApp(root, diag);
    if (!ok) {
      appRec.halted = true;
      return appRec;
    }
    injectStyles(root.ownerDocument);
    for (const ta of root.querySelectorAll("textarea[data-value]")) {
      if (!insideClosedBoundary(ta)) rehydrateControlFromAttributes(ta);
    }
    const t0 = now();
    runPass(appRec, { trigger: "mount", full: true });
    appRec._mountMs = now() - t0;
    appRec._mountWrites = appRec._stats ? appRec._stats.writes : 0;
    if (appRec._mountWrites > 0 && !draftsRestored() && !capability("derived")) {
      diag.warn("W30", root, {
        problem: `${appRec._mountWrites} paint(s) ran at mount; the saved file was out of sync with its declared state`,
        fix: "re-save once so the file mounts clean (a settled file writes nothing)"
      });
    }
    return appRec;
  }

  // src/debug.js
  var ACTION_RE = /^(set:|move:|sort:|trigger-add$|trigger-remove$|trigger-reset$)/;
  function rootLabel(root) {
    return `${root.tagName.toLowerCase()}[sap]`;
  }
  function countMarkup(root) {
    const n2 = { actions: 0, lists: 0, rows: 0 };
    walkVisible(root, (el) => {
      if (el.hasAttribute("items")) n2.lists++;
      if (el !== root && el.hasAttribute("item") && !el.hasAttribute("template")) n2.rows++;
      if ([...el.attributes].some((a) => ACTION_RE.test(a.name))) n2.actions++;
    });
    return n2;
  }
  function createDebug(runtime2) {
    function appView(app) {
      const s = app._stats || {};
      const root = app.root;
      return {
        root: rootLabel(root),
        fields: s.fields || 0,
        calcs: s.calcs || 0,
        paints: s.paints || 0,
        ...countMarkup(root),
        warnings: app.diag.warnings.length,
        errors: app.diag.errors.length,
        mountWrites: app._mountWrites || 0,
        ms: Math.round((app._mountMs || 0) * 10) / 10,
        passes: app._passes || 0,
        lastPass: app._lastPass || null,
        ok: app.diag.errors.length === 0 && !app.halted
      };
    }
    function status() {
      const apps = runtime2.apps().map(appView);
      return { ok: apps.every((a) => a.ok), apps };
    }
    function greenLine(app) {
      const v = appView(app);
      if (!v.ok) {
        return `sap \u2717 ${v.root} \xB7 errors ${v.errors} \xB7 warnings ${v.warnings} \xB7 ${v.ms}ms`;
      }
      return `sap \u2713 ${v.root} \xB7 fields ${v.fields} \xB7 calcs ${v.calcs} \xB7 paints ${v.paints} \xB7 actions ${v.actions} \xB7 lists ${v.lists} \xB7 rows ${v.rows} \xB7 warnings ${v.warnings} \xB7 mount writes ${v.mountWrites} \xB7 ${v.ms}ms`;
    }
    function report() {
      const errors = [];
      const warnings = [];
      for (const app of runtime2.apps()) {
        errors.push(...app.diag.errors);
        warnings.push(...app.diag.warnings);
      }
      return { ok: errors.length === 0, errors, warnings, counts: { errors: errors.length, warnings: warnings.length } };
    }
    function debug(flag) {
      const on = flag === void 0 ? true : !!flag;
      for (const app of runtime2.apps()) app._debug = on;
      console.log(`sap debug ${on ? "on" : "off"} \u2014 per-pass headers will ${on ? "" : "no longer "}log`);
      return on;
    }
    return { status, report, debug, greenLine };
  }

  // src/version.js
  var VERSION = "0.9.0";

  // src/plugin-manifest.js
  var PLUGIN_API = 1;
  var MANIFEST = {};

  // src/plugins.js
  var CDN = /^(https:\/\/(?:cdn\.jsdelivr\.net\/npm|unpkg\.com)\/@panphora\/sapjs)(?=[@/]|$)/;
  var wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  var listed = (root) => root.getAttribute("plugins")?.match(/\S+/g) || [];
  function createPlugins(runtime2, Sap2, scheduler) {
    const known = /* @__PURE__ */ new Map();
    const installed2 = /* @__PURE__ */ new Map();
    const loading = /* @__PURE__ */ new Map();
    const failed = /* @__PURE__ */ new Map();
    const blocked = [];
    const marked = /* @__PURE__ */ new Set();
    const helpers = {};
    let off = false;
    const w = globalThis;
    const shared = Array.isArray(w.sapPlugins) ? w.sapPlugins : w.sapPlugins == null ? w.sapPlugins = [] : [];
    const src = w.document?.currentScript?.src || "";
    const cdn = CDN.exec(src);
    const apiOf = (name) => installed2.get(name)?.api || null;
    const settle = (names) => Promise.allSettled(names.map(load));
    function refresh() {
      const pending = /* @__PURE__ */ new Map();
      for (const facts of known.values()) {
        if (!installed2.has(facts.name)) for (const h of facts.helpers || []) pending.set(h, facts.name);
      }
      setHelpers(helpers, pending);
      dropPlans();
    }
    function learn(facts) {
      known.set(facts.name, { ...known.get(facts.name), ...facts });
      declareFacts(facts);
      refresh();
    }
    function declare(facts) {
      if (!known.has(facts.name)) learn(facts);
    }
    function publish(def) {
      if (!shared.includes(def)) shared.push(def);
      learn(def);
    }
    function wake(trigger) {
      for (const app of runtime2.apps()) if (app.root.isConnected) runtime2.schedule(app, trigger);
    }
    const kit = Object.freeze({
      api: PLUGIN_API,
      version: VERSION,
      compile,
      run,
      runWith,
      planOf,
      drainPlans,
      forgetRow,
      setBeacon,
      clearBeacon,
      write: withDomMutationPaused,
      schedule(target, trigger = "plugin") {
        const app = target?.root ? target : runtime2.appFor(target);
        if (app) runtime2.schedule(app, trigger);
      },
      appFor: runtime2.appFor,
      apps: runtime2.apps,
      capability,
      mayWrite: mayWriteRecord,
      load,
      plugin: apiOf
    });
    function use(def) {
      if (typeof def === "string") return load(def);
      const { name, api: speaks } = def;
      const refuse = (why) => {
        throw new Error(`Sap.use: plugin "${name}" ${why}`);
      };
      if (typeof name !== "string" || speaks !== PLUGIN_API) refuse(`needs a name and plugin API ${PLUGIN_API}; it gives API ${speaks}`);
      if (off) return null;
      if (installed2.has(name)) return apiOf(name);
      if ((def.requires || []).some((r) => !installed2.has(r))) {
        publish(def);
        if (!blocked.includes(def)) blocked.push(def);
        return null;
      }
      const made = def.setup?.(kit) || {};
      const check = (part, taken) => {
        for (const n2 of Array.isArray(def[part]) ? def[part] : Object.keys(def[part] || {})) {
          if (typeof (made[part] || {})[n2] !== "function" || taken(n2)) refuse(`cannot add "${n2}" to ${part}: the name is taken or not valid, or setup does not supply it`);
        }
      };
      const claimed = (n2) => !claimable(n2, name);
      check("helpers", (n2) => {
        if (isGlobal(n2)) refuse(`cannot add "${n2}": window.${n2} exists; rename the helper`);
        return !isHelperName(n2) || n2 in helpers;
      });
      check("boundaries", claimed);
      check("directives", claimed);
      for (const k in made.api) if (k in Sap2) refuse(`cannot add Sap.${k}: the name is taken`);
      publish(def);
      const feature = { ...made, name, order: def.order, boundary: {} };
      for (const n2 in def.boundaries) feature.boundary[n2] = made.boundaries[n2];
      for (const h of def.helpers || []) helpers[h] = made.helpers[h];
      for (const k in made.formats) if (!(k in formats)) formats[k] = made.formats[k];
      registerFeature(feature);
      if (made.lint) addLintCheck(made.lint);
      Object.assign(Sap2, made.api);
      installed2.set(name, feature);
      failed.delete(name);
      setInstalled(name, made.directives || true);
      refresh();
      withDomMutationPaused(() => marked.forEach(clearBeacon));
      marked.clear();
      blocked.splice(0).forEach(tryUse);
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
    function fetchOnce(name) {
      if (off || installed2.has(name)) return null;
      const facts = known.get(name) || {};
      const custom = api.loader?.(name, facts);
      const url = facts.url || api.base && api.base + (facts.file || name) + ".js";
      const got = custom !== void 0 ? Promise.resolve(custom) : new Promise((resolve, reject) => {
        if (!url) throw new Error(`no address for plugin "${name}": call Sap.use(definition)`);
        const s = document.createElement("script");
        s.src = url;
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
        if (!installed2.has(name)) throw new Error(`plugin "${name}" loaded and did not register`);
      });
    }
    function load(name) {
      if (installed2.has(name)) return Promise.resolve(apiOf(name));
      if (loading.has(name)) return loading.get(name);
      failed.delete(name);
      let attempt = Promise.all((known.get(name)?.requires || []).map(load)).then(() => fetchOnce(name));
      for (const ms of api.retryDelays) attempt = attempt.catch(() => wait(ms).then(() => fetchOnce(name)));
      const p = attempt.finally(() => loading.delete(name)).then(
        () => apiOf(name),
        (error) => {
          failed.set(name, error);
          wake("plugin-failed:" + name);
          document.dispatchEvent(new CustomEvent("sap:plugin-failed", { detail: { plugin: name, error } }));
          throw error;
        }
      );
      loading.set(name, p);
      return p;
    }
    function needed(docRoot) {
      const found = /* @__PURE__ */ new Set();
      for (const el of docRoot.closest?.("[sap]") ? [docRoot] : docRoot.querySelectorAll("[sap]")) {
        for (const n2 of listed(el.closest("[sap]"))) found.add(n2);
        if (known.size > installed2.size) {
          walkVisible(el, (at) => {
            const plan = planOf(at);
            if (plan.inert) return false;
            plan.wants?.map((n2) => found.add(n2));
            return !!found.add(plan.waits);
          });
        }
      }
      return [...found].filter((n2) => n2 && !installed2.has(n2));
    }
    setPassHost((app, pass) => {
      for (const name of /* @__PURE__ */ new Set([...pass.wanted.keys(), ...pass.waiting, ...listed(app.root)])) {
        if (installed2.has(name)) continue;
        const error = failed.get(name);
        if (!error) load(name).catch(() => {
        });
        else {
          const at = pass.wanted.get(name)?.[0] || app.root;
          app.diag.error("E52", at, {
            problem: `the "${name}" plugin did not load: ${error.message}`,
            fix: "Sap.plugins.retry() tries again"
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
      retryDelays: [1e3, 4e3],
      declare,
      load,
      // Null when the document asks for nothing that is missing. Otherwise a promise that
      // resolves once each of those plugins has installed or failed, and each plugin that
      // shows only then, or after timeoutMs. A plugin is asked for once in a call.
      ready(docRoot = document, timeoutMs = 3e3) {
        const tried = /* @__PURE__ */ new Set();
        const more = () => {
          const asked = needed(docRoot).filter((n2) => !tried.has(n2) && tried.add(n2));
          return asked.length && settle(asked).then(more);
        };
        const all = more();
        return all ? Promise.race([all, wait(timeoutMs)]) : null;
      },
      has: (name) => installed2.has(name),
      status: () => ({ installed: [...installed2.keys()], loading: [...loading.keys()], failed: [...failed.keys()] }),
      retry: (name) => settle(name ? [name] : [...failed.keys()])
    };
    function flush() {
      const pending = [];
      const passes = () => {
        flushMutationBridge();
        return scheduler.flushNow();
      };
      const hooks = [...installed2.values()].filter((plugin) => plugin.flush);
      passes();
      for (let round = 0; hooks.length && round < 8; round++) {
        for (const plugin of hooks) {
          const r = plugin.flush();
          if (r?.then) pending.push(r);
        }
        if (!passes()) break;
      }
      return pending.length ? Promise.all(pending).then(flush) : null;
    }
    Sap2.use = use;
    Sap2.plugins = api;
    Sap2.flush = flush;
    for (const facts of Object.values(MANIFEST)) declare(facts);
    shared.slice().forEach(tryUse);
    w.addEventListener?.("online", () => api.retry());
    return function dispose() {
      off = true;
      for (const plugin of installed2.values()) plugin.dispose?.();
      installed2.clear();
      failed.clear();
    };
  }

  // src/runtime.js
  function createSap({ createAccessor: createAccessor2, installInput, debugExtras }) {
    const registry = /* @__PURE__ */ new Map();
    const order = [];
    const scheduler = createScheduler(runPass);
    function appFor(el) {
      let cur = el;
      while (cur) {
        if (cur.nodeType === 1 && cur.hasAttribute && cur.hasAttribute("sap")) {
          return registry.get(cur) || null;
        }
        cur = cur.parentNode && cur.parentNode.host ? cur.parentNode.host : cur.parentElement;
      }
      return null;
    }
    function pruneDisconnected() {
      for (let i = order.length - 1; i >= 0; i--) {
        const app = order[i];
        if (!app.root.isConnected) {
          registry.delete(app.root);
          order.splice(i, 1);
        }
      }
    }
    function moveInto(parent, el) {
      if (parent.moveBefore) {
        try {
          parent.moveBefore(el, null);
          return;
        } catch {
        }
      }
      parent.appendChild(el);
    }
    function placeBefore(el, ref) {
      const parent = ref.parentElement;
      if (!parent) return;
      if (parent.moveBefore) {
        try {
          parent.moveBefore(el, ref);
          return;
        } catch {
        }
      }
      parent.insertBefore(el, ref);
    }
    const runtime2 = {
      apps: () => order.slice(),
      appFor,
      isRegistered: (el) => registry.has(el),
      pruneDisconnected,
      schedule: scheduler.schedule,
      runNow: (app, trigger) => scheduler.runNow(app, trigger),
      moveInto,
      placeBefore,
      remountIfPresent: () => mountAll2()
    };
    const accessor = createAccessor2(runtime2);
    const debugApi = createDebug(runtime2);
    const extras = debugExtras ? debugExtras(runtime2, debugApi) : {};
    let installed2 = false;
    let disabled = false;
    let teardownBridges = null;
    function installOnce() {
      if (installed2) return;
      installed2 = true;
      installInput(runtime2, accessor, document);
      teardownBridges = installBridges(runtime2);
    }
    function announceMounted() {
      const derived = capability("derived");
      if (derived && typeof derived.mounted === "function") derived.mounted();
    }
    function mountAll2(docRoot = document) {
      if (disabled) return [];
      installOnce();
      installMutationBridge(runtime2);
      const roots = docRoot.querySelectorAll("[sap]");
      const fresh = [];
      for (const root of roots) {
        if (registry.has(root) || insideClosedBoundary(root)) continue;
        const appRec = mountApp(root);
        registry.set(root, appRec);
        order.push(appRec);
        fresh.push(appRec);
      }
      for (const app of fresh) {
        const line = debugApi.greenLine(app);
        if (app.diag.errors.length || app.halted) console.error(line);
        else console.log(line);
      }
      announceMounted();
      return fresh;
    }
    function mount2(rootOrSel) {
      if (disabled) return null;
      installOnce();
      installMutationBridge(runtime2);
      if (!rootOrSel) return mountAll2();
      const root = typeof rootOrSel === "string" ? document.querySelector(rootOrSel) : rootOrSel;
      if (!root) return null;
      if (registry.has(root)) return registry.get(root);
      const appRec = mountApp(root);
      registry.set(root, appRec);
      order.push(appRec);
      const line = debugApi.greenLine(appRec);
      if (appRec.diag.errors.length || appRec.halted) console.error(line);
      else console.log(line);
      return appRec;
    }
    const Sap2 = accessor.Sap;
    Sap2.version = VERSION;
    Sap2.refresh = function refresh() {
      for (const app of order.slice()) if (app.root.isConnected) scheduler.runNow(app, "refresh");
    };
    Sap2.batch = batch;
    Sap2.status = debugApi.status;
    Sap2.report = debugApi.report;
    Sap2.why = extras.why;
    Sap2.debug = debugApi.debug;
    Sap2.doctor = extras.doctor;
    Sap2.greenLine = debugApi.greenLine;
    Sap2.formats = formats;
    Sap2.serializeControlToAttributes = serializeControlToAttributes;
    Sap2.finalizeControlForSave = finalizeControlForSave;
    Sap2.rehydrateControlFromAttributes = rehydrateControlFromAttributes;
    Sap2.mount = mount2;
    Sap2.config = function config(options = {}) {
      if (options.formats) Object.assign(formats, options.formats);
      return Sap2;
    };
    Sap2._registry = registry;
    Sap2._reset = function reset() {
      registry.clear();
      order.length = 0;
      resetMutationBridge();
    };
    Sap2.unmount = function unmount() {
      disabled = true;
      registry.clear();
      order.length = 0;
      resetMutationBridge();
      if (typeof teardownBridges === "function") teardownBridges();
      disposePlugins();
    };
    const disposePlugins = createPlugins(runtime2, Sap2, scheduler);
    return { Sap: Sap2, mountAll: mountAll2, mount: mount2, runtime: runtime2 };
  }
  function autoMount(mountAll2) {
    if (typeof document === "undefined") return;
    const go = () => whenPlatformReady(() => mountAll2());
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", go);
    } else {
      go();
    }
  }

  // src/input.js
  function createInput(runtime2) {
    const routers = [];
    function onInput(e) {
      const t = e.target;
      if (!t || t.nodeType !== 1) return;
      const appRec = runtime2.appFor(t);
      if (!appRec) return;
      if (t.hasAttribute("persist") && !regionSkipsSave(t) && mayWriteRecord(t)) serializeControlToAttributes(t);
      for (const route of routers) if (route(t, appRec)) return;
      runtime2.schedule(appRec, e.type + " " + (t.id || t.tagName.toLowerCase()));
    }
    function onReset(e) {
      const form = e.target;
      const appRec = runtime2.appFor(form);
      if (!appRec) return;
      if (![...form.querySelectorAll("[bind]")].every((c) => mayWriteRecord(c))) return;
      setTimeout(() => {
        form.querySelectorAll("[bind]").forEach((c) => {
          c.dispatchEvent(new Event("input", { bubbles: true }));
          c.dispatchEvent(new Event("change", { bubbles: true }));
        });
        runtime2.schedule(appRec, "reset");
      }, 0);
    }
    function onToggle(e) {
      const appRec = runtime2.appFor(e.target);
      if (appRec) runtime2.schedule(appRec, "toggle");
    }
    function onSorted(e) {
      const d = e.detail || {};
      for (const el of [d.from, d.to, e.target]) {
        if (!el || el.nodeType !== 1) continue;
        const appRec = runtime2.appFor(el);
        if (appRec) runtime2.schedule(appRec, "sorted");
      }
    }
    function onKeydown(e) {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      const t = e.target;
      if (!t || t.nodeType !== 1 || t.tagName !== "INPUT") return;
      if (!t.hasAttribute("bind") || !t.hasAttribute("step")) return;
      const type = (t.getAttribute("type") || "text").toLowerCase();
      if (type !== "text" && type !== "tel" && type !== "search") return;
      const appRec = runtime2.appFor(t);
      if (!appRec) return;
      if (!mayWriteRecord(t)) return;
      e.preventDefault();
      const step = num(t.getAttribute("step")) || 1;
      const dir = e.key === "ArrowUp" ? 1 : -1;
      let next = num(t.value) + step * (e.shiftKey ? 10 : 1) * dir;
      const min2 = t.getAttribute("min"), max2 = t.getAttribute("max");
      if (min2 !== null && min2 !== "" && next < num(min2)) next = num(min2);
      if (max2 !== null && max2 !== "" && next > num(max2)) next = num(max2);
      carrierFor(t).write(String(Number(next.toFixed(2))));
    }
    function install(doc = document) {
      doc.addEventListener("reset", onReset);
      doc.addEventListener("toggle", onToggle, true);
      doc.addEventListener("input", onInput);
      doc.addEventListener("change", onInput);
      doc.addEventListener("clay:sorted", onSorted);
      doc.addEventListener("keydown", onKeydown);
    }
    return { install, addRouter: (fn) => routers.push(fn) };
  }

  // src/core.js
  var FULL_SAPJS = "https://clayjs.com/v1/sap.js";
  var NEEDS_FULL_PREFIX = /^(calc|set|move|sort):/;
  var NEEDS_FULL_BARE = /* @__PURE__ */ new Set([
    "each",
    "detail",
    "effect",
    "invalid",
    "confirm",
    "trigger-add",
    "trigger-remove",
    "trigger-reset"
  ]);
  function needsFullSapjs(name) {
    return NEEDS_FULL_PREFIX.test(name) || NEEDS_FULL_BARE.has(name);
  }
  addLintCheck((el, halt) => {
    for (const a of el.attributes) {
      if (!needsFullSapjs(a.name)) continue;
      halt("E50", el, {
        attr: a.name,
        expr: a.value,
        problem: `${a.name} is full sapjs; the sapjs core only paints declared state`,
        fix: `load ${FULL_SAPJS}; the markup stays as it is`
      });
    }
  });
  function unsupported(pass, el, what) {
    pass.app.diag.error("E50", el, {
      attr: what,
      problem: `${what} is full sapjs; the sapjs core only paints declared state`,
      fix: `load ${FULL_SAPJS}; the markup stays as it is`
    });
    setBeacon(el, "E50");
    pass.app.halted = true;
  }
  registerFeature({
    name: "core-only",
    collect(pass, el, plan) {
      if (plan.calcs) unsupported(pass, el, "calc:" + plan.calcs[0].name);
      if (plan.effects) unsupported(pass, el, "effect");
      if (plan.invalids) unsupported(pass, el, "invalid");
      for (const a of el.attributes) {
        if (!needsFullSapjs(a.name)) continue;
        if (a.name.startsWith("calc:") && plan.calcs) continue;
        if (a.name === "effect" && plan.effects) continue;
        if (a.name === "invalid" && plan.invalids) continue;
        unsupported(pass, el, a.name);
      }
      return false;
    },
    boundary: {
      each(pass, el) {
        unsupported(pass, el, "each");
      },
      detail(pass, el) {
        unsupported(pass, el, "detail");
      }
    }
  });
  function createAccessor() {
    const Sap2 = function Sap3() {
      throw new Error(`Sap(el) is full sapjs; load ${FULL_SAPJS}`);
    };
    return { Sap: Sap2 };
  }
  var fullOnly = (name) => () => {
    console.warn(`Sap.${name} is full sapjs; load ${FULL_SAPJS}`);
    return null;
  };
  var { Sap, mountAll, mount, runtime } = createSap({
    createAccessor,
    debugExtras: () => ({ why: fullOnly("why"), doctor: fullOnly("doctor") }),
    installInput(runtime2, accessor, doc) {
      createInput(runtime2).install(doc);
    }
  });
  Sap.core = true;
  var fullSapjs = typeof window !== "undefined" && window.Sap && !window.Sap.core;
  if (fullSapjs) Sap.unmount();
  else autoMount(mountAll);
  if (typeof window !== "undefined" && !window.Sap) window.Sap = Sap;
  var core_default = Sap;
  return __toCommonJS(core_exports);
})();
