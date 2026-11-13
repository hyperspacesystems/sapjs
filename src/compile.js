import { formats, num, sum, count, avg, min, max, plural, days } from "./helpers.js";

// The frozen compile signature. These argument names are fixed forever.
// App-registered formats extend the `fmt` namespace object, never this list,
// so the source-keyed cache never invalidates.
const ARGS = ["state", "item", "el", "root", "fmt", "num", "sum", "count", "avg", "min", "max", "plural", "days"];

const cache = new Map();

// Helpers plugins add. They are not arguments: the frozen 13 argument function is made
// inside an outer function whose parameters are the helper names, so its signature
// never changes. `awaited` reads an expression token by token: a string literal, a piece
// of template literal text (from a backtick, or from the } that ends a hole, to the next
// backtick or ${), a brace, a spread, a call to a helper of a plugin that is known and
// has not installed (the one captured group), or any other run of name characters. An
// expression that makes such a call outside every string and every piece of template
// text waits for that plugin.
let helperNames = [];
let helperValues = [];
let awaited = null;
let owners = null;

const TEXT = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|[`}](?:\\.|[^`\\])*?(?:`|\$\{)|[{}]/.source;

// installed: { name: function }. pending: Map of helper name -> plugin name.
export function setHelpers(installed, pending) {
  helperNames = Object.keys(installed);
  helperValues = Object.values(installed);
  const names = [...pending.keys()].filter((name) => unclaimed(name) && !(name in installed));
  owners = pending;
  awaited = names.length ? new RegExp(`${TEXT}|\\.{3}|(${names.join("|")})\\s*\\(|[\\w$.]+`, "g") : null;
  cache.clear();
}

// True when the browser or the page has a global of this name at this moment. An
// element the browser lists under its id is not a global of that kind.
export function isGlobal(name) {
  return name in globalThis && globalThis[name]?.nodeType !== 1;
}

// A plain name that means nothing yet: it is not one of the frozen arguments, and not
// a global.
function unclaimed(name) {
  return /^[a-z_]\w*$/i.test(name) && !ARGS.includes(name) && !isGlobal(name);
}

// A plugin may add a helper under a name that is unclaimed and that the language lets a
// function take as a parameter. A reserved word is refused here: as a parameter it would
// stop every expression on the page from compiling.
export function isHelperName(name) {
  try {
    return unclaimed(name) && !!new Function(name, '"use strict"');
  } catch {
    return false;
  }
}

// The plugin an expression waits for, or null. The global is looked up now, not when
// the helper was declared: a name the page has defined since then is the page's.
// `open` holds what the scan is inside, innermost last: a { or the piece of template
// text that opened a hole. The } that ends a hole is followed by template text. Any
// other } is followed by code, so the scan goes back to just after it.
export function waitsFor(src) {
  const open = [];
  let m;
  if (awaited) for (awaited.lastIndex = 0; (m = awaited.exec(src)); ) {
    const [token, name] = m;
    if (name && unclaimed(name)) return owners.get(name);
    if (token[0] === "}" && !open.pop()?.[1]) awaited.lastIndex = m.index + 1;
    else if (token.endsWith("{")) open.push(token);
  }
  return null;
}

const STATE_REF = /\bstate\.([a-z][a-z0-9_]*)/g;
const ITEM_REF = /\bitem\.([a-z][a-z0-9_]*)/g;

function extractDeps(src) {
  const named = (ref) => new Set([...(src || "").matchAll(ref)].map((m) => m[1]));
  return { state: named(STATE_REF), item: named(ITEM_REF) };
}

// Compile an expression to a function with the frozen signature.
// `statement` mode (for effect=) runs a statement body with no return.
export function compile(src, statement = false) {
  const key = (statement ? "!" : "") + src;
  let entry = cache.get(key);
  if (entry) return entry;
  if (cache.size > 512) cache.clear();

  try {
    const body = statement ? `"use strict";\n${src}` : `"use strict"; return (${src});`;
    const fn = helperNames.length
      ? new Function(...helperNames, `return function(${ARGS}){${body}\n}`)(...helperValues)
      : new Function(...ARGS, body);
    entry = { fn, src, statement, deps: extractDeps(src), error: null, waits: waitsFor(src) };
  } catch (err) {
    entry = { fn: null, src, statement, deps: { state: new Set(), item: new Set() }, error: err, waits: null };
  }
  // An entry that waits is not kept: the page may define the name before it is asked
  // for again.
  if (!entry.waits) cache.set(key, entry);
  return entry;
}

// Evaluate a compiled entry against an { state, item, el, root } context.
// Throws if the expression throws (callers do preserve-on-error).
export function run(entry, ctx) {
  return runWith(entry, ctx.state, ctx.item, ctx.el ?? null, ctx.root);
}

// The same call without a context object: the pass runs every paint through this.
export function runWith(entry, state, item, el, root) {
  if (entry.error) throw entry.error;
  return entry.fn(state, item, el, root, formats, num, sum, count, avg, min, max, plural, days);
}

export function clearCompileCache() {
  cache.clear();
}

// Topologically sort calc bindings within a single scope object so a calc that
// reads another calc evaluates after it. Cycles throw, naming the chain.
export function topoSort(calcs) {
  // calcs: array of { name, entry, ... } that share one owner object.
  const byName = new Map();
  for (const c of calcs) byName.set(c.name, c);
  const out = [];
  const state = new Map(); // name -> 0 visiting, 1 done
  const stack = [];

  function visit(c) {
    const s = state.get(c.name);
    if (s === 1) return;
    if (s === 0) {
      const cycle = [...stack.slice(stack.indexOf(c.name)), c.name].join(" -> ");
      const err = new Error(`calc: cycle: ${cycle}`);
      err.sapCode = "E07";
      err.cycle = cycle;
      throw err;
    }
    state.set(c.name, 0);
    stack.push(c.name);
    for (const dep of c.entry.deps.state) {
      const d = byName.get(dep);
      if (d && d !== c) visit(d);
    }
    for (const dep of c.entry.deps.item) {
      const d = byName.get(dep);
      if (d && d !== c) visit(d);
    }
    stack.pop();
    state.set(c.name, 1);
    out.push(c);
  }

  for (const c of calcs) visit(c);
  return out;
}
