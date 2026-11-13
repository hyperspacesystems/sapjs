// Which attributes belong to plugins. It holds the static facts of every plugin the
// engine knows by name, installed or not, so every walker (lint, the pass, the plan
// cache, the read cache, the mutation bridge, the accessor, the green line) stays out of
// a plugin boundary before that plugin's code has arrived. The plugin host declares the
// facts, the shipped manifest's first. dom.js and plan.js import this file, so it
// imports nothing.

// The attributes that make an element a scope of the engine's own. Such an element is
// never a plugin boundary, and no plugin can claim one of these names.
const OWN = ["sap", "item", "scope", "items", "detail", "each"];

const boundaries = new Map(); // attribute -> { name, plugin, opaque, on, installed }
// A directive is an attribute a plugin parses: an exact name, or a prefix that ends in
// a colon. `parse` is null until the plugin installs.
const directives = new Map(); // name -> { name, plugin, key, impure, parse }
let selector = "";

// The first plugin to declare an attribute keeps it.
export function declareFacts(facts) {
  for (const [name, b] of Object.entries(facts.boundaries || {})) {
    if (claimable(name)) boundaries.set(name, { name, plugin: facts.name, opaque: !!b.opaque, on: b.on || null, installed: false });
  }
  for (const [name, d] of Object.entries(facts.directives || {})) {
    if (claimable(name)) directives.set(name, { name, plugin: facts.name, key: d.key, impure: !!d.impure, parse: null });
  }
  selector = [...boundaries.values()].map((b) => `${b.on || ""}[${b.name}]`).join(",");
}

// True when `plugin` holds this attribute name or may take it: it is not one of the
// engine's own, and no other plugin declared it. With no `plugin`, true when nobody
// holds it.
export function claimable(name, plugin) {
  return !OWN.includes(name) && (ownerOf(name) || plugin) === plugin;
}

// `parsers` holds the plugin's directive parsers by name; a false value uninstalls.
export function setInstalled(plugin, parsers) {
  for (const b of boundaries.values()) if (b.plugin === plugin) b.installed = !!parsers;
  for (const d of directives.values()) if (d.plugin === plugin) d.parse = (parsers && parsers[d.name]) || null;
}

// The plugin that declared this boundary attribute or directive name, or undefined.
export function ownerOf(name) {
  return (boundaries.get(name) || directives.get(name) || {}).plugin;
}

export function directiveFor(name) {
  return directives.get(name);
}

export function declaredAttr(name) {
  return !!ownerOf(name) || directives.has(name.slice(0, name.indexOf(":") + 1));
}

// Matches every element that may start a plugin boundary; empty when none is declared.
export function boundarySelector() {
  return selector;
}

// The plugin boundary that starts at el, or null.
export function boundaryOf(el) {
  if (!selector) return null;
  for (const b of boundaries.values()) {
    if ((b.on && el.localName !== b.on) || !el.hasAttribute(b.name)) continue;
    return OWN.some((own) => el.hasAttribute(own)) ? null : b;
  }
  return null;
}

// True when no walker may descend into el: it is an opaque boundary, or a boundary
// whose plugin has not installed.
export function closedBoundary(el) {
  const b = boundaryOf(el);
  return !!b && (b.opaque || !b.installed);
}

// The nearest closed boundary above el, or null.
export function insideClosedBoundary(el) {
  if (!selector) return null;
  for (let cur = el.parentElement; cur; cur = cur.parentElement) {
    cur = cur.closest(selector);
    if (!cur || closedBoundary(cur)) return cur;
  }
  return null;
}

// The closed boundary el is, or sits in, or null.
export function closedOwner(el) {
  return closedBoundary(el) ? el : insideClosedBoundary(el);
}

// Calls visit for root and every element under it, in document order. It visits a
// closed boundary and none of that boundary's descendants, and it stays out of an
// element whose visit returns false.
export function walkVisible(root, visit) {
  if (visit(root) === false || closedBoundary(root)) return;
  for (let c = root.firstElementChild; c; c = c.nextElementSibling) walkVisible(c, visit);
}
