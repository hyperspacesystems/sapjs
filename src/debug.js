// The lazily-evaluated console surface. Zero run-cost until invoked. The green
// line is the machine-readable mount contract; status/report are its JSON twins.
// why/doctor live in debug-full.js: they are developer tools, not core surface.

import { walkVisible } from "./registry.js";

const ACTION_RE = /^(set:|move:|sort:|trigger-add$|trigger-remove$|trigger-reset$)/;

export function rootLabel(root) {
  return `${root.tagName.toLowerCase()}[sap]`;
}

// What the green line counts, in one walk that stays out of closed plugin boundaries.
function countMarkup(root) {
  const n = { actions: 0, lists: 0, rows: 0 };
  walkVisible(root, (el) => {
    if (el.hasAttribute("items")) n.lists++;
    if (el !== root && el.hasAttribute("item") && !el.hasAttribute("template")) n.rows++;
    if ([...el.attributes].some((a) => ACTION_RE.test(a.name))) n.actions++;
  });
  return n;
}

export function createDebug(runtime) {
  // runtime: { apps() -> appRec[] }

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
      ok: app.diag.errors.length === 0 && !app.halted,
    };
  }

  function status() {
    const apps = runtime.apps().map(appView);
    return { ok: apps.every((a) => a.ok), apps };
  }

  function greenLine(app) {
    const v = appView(app);
    if (!v.ok) {
      return `sap ✗ ${v.root} · errors ${v.errors} · warnings ${v.warnings} · ${v.ms}ms`;
    }
    return (
      `sap ✓ ${v.root} · fields ${v.fields} · calcs ${v.calcs} · paints ${v.paints}` +
      ` · actions ${v.actions} · lists ${v.lists} · rows ${v.rows}` +
      ` · warnings ${v.warnings} · mount writes ${v.mountWrites} · ${v.ms}ms`
    );
  }

  function report() {
    const errors = [];
    const warnings = [];
    for (const app of runtime.apps()) {
      errors.push(...app.diag.errors);
      warnings.push(...app.diag.warnings);
    }
    return { ok: errors.length === 0, errors, warnings, counts: { errors: errors.length, warnings: warnings.length } };
  }

  function debug(flag) {
    const on = flag === undefined ? true : !!flag;
    for (const app of runtime.apps()) app._debug = on;
    console.log(`sap debug ${on ? "on" : "off"} — per-pass headers will ${on ? "" : "no longer "}log`);
    return on;
  }

  return { status, report, debug, greenLine };
}
