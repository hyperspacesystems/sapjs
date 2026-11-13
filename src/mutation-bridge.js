// Universal DOM-mutation reactivity: sapjs re-derives when the page changes by ANY
// means, not just its own delegated events. Two interchangeable backends sit behind
// one MutationSource seam:
//
//   - hubSource:    when the platform's Mutation hub is present, ride its central,
//                   pause-gated observer. The hub already coordinates the
//                   live-sync / undo pause windows, so we inherit them for free.
//   - nativeSource: standalone, a sapjs-owned MutationObserver on document.body.
//
// Self-paint suppression: every pass runs inside withDomMutationPaused(), so a pass's
// own DOM writes are vacuumed away from the bridge and never schedule another pass:
//   - hub:    Mutation.pause()/resume() — the hub drains the pass's records to its
//             NON-pausable consumers only, so our pausable subscription never sees them.
//   - native: observer.takeRecords() at the pause boundary discards the pass's records
//             before the browser delivers them.
// Records the browser queued BEFORE the pause describe changes made outside the pass.
// Both backends deliver those first, so the pass that is starting lists them. Only the
// outermost pause does: inside it, everything queued is the pass's own writing.
//
// Exactly one source is active at a time. A native source CEDES to a hub that arrives
// late (teardown + re-subscribe), so the two never observe at once. Degrades to a
// plain no-op when neither a hub nor a MutationObserver is present.

import { capability, MUTATION_READY, onPlatformEvent } from "./platform.js";
import { closedOwner, walkVisible } from "./registry.js";

const NONE = [];

let activeSource = null;
let pausing = 0; // above zero while a pass is under way, its start included
let remount = null; // the mount of a root found while a pass was starting, until it runs
let installed = false;
let lateHubListener = null;

function hubSource(M) {
  let unsub = null;
  return {
    kind: "hub",
    // The hub delivers what the browser has queued when a pause begins.
    flush() { M.pause(); M.resume(); },
    subscribe(onChanges) {
      // pausable (the default) is load-bearing: it is WHY the hub's resume()-drain
      // routes our own pass's writes to non-pausable consumers only, excluding us.
      const ret = M.onAnyChange({ debounce: 0, require: "observed" }, onChanges);
      if (typeof ret === "function") unsub = ret;
    },
    // The hub delivers on its own, and only when no pause is under way.
    suppress(fn) {
      M.pause(); // bridges undo.pause + gates the pausable lanes (autosave included)
      try { return fn(); } finally { M.resume(); }
    },
    teardown() { if (unsub) { try { unsub(); } catch { /* ignore */ } unsub = null; } },
  };
}

function nativeSource() {
  let observer = null;
  let deliver = null;
  function flush() {
    const queued = observer ? observer.takeRecords() : NONE;
    if (queued.length) deliver(changesFromRecords(queued));
  }
  return {
    kind: "native",
    flush,
    subscribe(onChanges) {
      deliver = onChanges;
      observer = new MutationObserver((records) => onChanges(changesFromRecords(records)));
      const target = document.body || document.documentElement;
      if (target) {
        observer.observe(target, { childList: true, subtree: true, attributes: true, characterData: true });
      }
    },
    suppress(fn, outer) {
      // No hub to gate us: drop our own pass's records before the browser delivers them.
      // Pause undo too if it somehow exists hub-less (presence-guarded; normally it does not).
      const u = capability("undo");
      if (outer) flush();
      if (u && u.pause) u.pause();
      try {
        return fn();
      } finally {
        if (observer) observer.takeRecords();
        if (u && u.resume) u.resume();
      }
    },
    teardown() { if (observer) { observer.disconnect(); observer = null; } },
  };
}

// Normalize MutationRecords into the hub's change shape { type, element, parent },
// mirroring the hub's added-subtree expansion and removed-node parent resolution, and
// skipping sap-inert subtrees (sap-ignore / template / cms-template) — the standalone analogue of the
// hub's intake isInert drop. The expansion stops at a closed plugin boundary: a row added
// inside one is one change, and the plugin that owns the boundary reads what it needs.
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
      // el.textContent = "5" swaps el's text node and touches no element: a text change on el.
      if (parent.nodeType === 1 && [...rec.addedNodes, ...rec.removedNodes].some((node) => node.nodeType === 3) && !inertSubtree(parent)) {
        out.push({ type: "characterData", element: parent });
      }
      const closed = rec.addedNodes.length > 0 && parent.nodeType === 1 && closedOwner(parent);
      for (const node of rec.addedNodes) {
        if (node.nodeType !== 1 || inertSubtree(node)) continue;
        if (closed) out.push({ type: "add", element: node, parent });
        else walkVisible(node, (el) => { if (el === node || !inertSubtree(el)) out.push({ type: "add", element: el, parent }); });
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

// Shared by both backends: resolve each change to its owning [sap] app and schedule it
// once, with the changes that fell inside it. Prune apps whose roots have left the DOM
// (keeps the per-batch cost O(apps), not a full-document re-scan), and re-mount when a
// fresh [sap] root is injected.
function scheduleAffectedApps(runtime, changes) {
  runtime.pruneDisconnected();
  const affected = new Map();
  let needRemount = false;
  for (const c of changes) {
    const target = c.type === "remove" ? c.parent : c.element; // a removed node is detached
    const app = target && runtime.appFor(target);
    if (app) {
      const list = affected.get(app);
      if (list) list.push(c);
      else affected.set(app, [c]);
    }
    if (c.type === "add" && c.element && c.element.nodeType === 1 &&
        c.element.hasAttribute && c.element.hasAttribute("sap") &&
        !(runtime.isRegistered && runtime.isRegistered(c.element))) {
      needRemount = true; // an injected [sap] root
    }
  }
  // Mounting runs a pass of its own. A root found while another pass is starting waits
  // for that pass: it may be the very root that pass is mounting. It is mounted on the
  // next microtask, or by Sap.flush() when that comes first.
  if (needRemount) {
    remount = runtime.remountIfPresent;
    if (pausing) queueMicrotask(mountFound);
    else mountFound();
  }
  for (const [app, list] of affected) if (app.root.isConnected) runtime.schedule(app, "mutation", list);
}

function mountFound() {
  const mount = remount;
  remount = null;
  mount?.();
}

// The single suppression entry point. pass.js wraps the whole pass in this; it delegates
// to the active source. With no source yet (pre-install / no DOM), it preserves the
// historical undo-pause-if-present behavior so derived writes still stay off the undo stack.
export function withDomMutationPaused(fn) {
  if (activeSource) {
    const outer = !pausing++;
    try { return activeSource.suppress(fn, outer); } finally { pausing--; }
  }
  const u = capability("undo");
  if (u && u.pause && u.resume) {
    u.pause();
    try { return fn(); } finally { u.resume(); }
  }
  return fn();
}

function activate(source, runtime) {
  installed = true;
  activeSource = source;
  source.subscribe((changes) => scheduleAffectedApps(runtime, changes));
}

// Idempotent. Called from mountAll/mount; re-arms after resetMutationBridge().
export function installMutationBridge(runtime) {
  if (installed) return;
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const M = capability("Mutation");

  if (M && typeof M.onAnyChange === "function") { activate(hubSource(M), runtime); return; }

  // No usable Mutation hub yet. We do NOT treat a bare window.hyperclay as a promise that
  // a hub is coming: another library may merely own that namespace (e.g. a consent shim)
  // and never publish a Mutation hub, which would strand us in a permanent wait with dead
  // reactivity. So observe natively now and CEDE to a real hub if one arrives later
  // (teardown + re-subscribe on the document-dispatched mutation-ready — a
  // window-dispatched event is ignored, matching the hub's own target). The handoff is
  // safe: passes are idempotent, so the brief pre-hub native window costs at most a little
  // redundant work, never correctness, and the two never observe simultaneously.
  if (typeof MutationObserver === "function") {
    activate(nativeSource(), runtime);
    // lateHubListener holds the disposer, which unregisters BOTH spellings: dropping
    // only the one that fired would leak the other under whichever client is loaded.
    lateHubListener = onPlatformEvent(document, MUTATION_READY, function onLateHub() {
      const M2 = capability("Mutation");
      if (!M2) return;
      lateHubListener();
      lateHubListener = null;
      if (activeSource) activeSource.teardown();
      installed = false;
      activate(hubSource(M2), runtime);
    });
  }
  // else: no DOM observer (SSR / ancient) -> event-only, exactly as before.
}

// Tear down and re-arm. Sap._reset() calls this so each test gets a fresh bridge that
// reflects the current window.hyperclay; production never calls it.
export function resetMutationBridge() {
  if (activeSource) { try { activeSource.teardown(); } catch { /* ignore */ } }
  if (lateHubListener && typeof document !== "undefined") {
    lateHubListener();
  }
  activeSource = null;
  installed = false;
  lateHubListener = null;
}

// Deliver what the browser has queued and not yet handed over, now, and mount a root
// that waited for a pass to end. Inside a pass there is nothing to deliver: what is
// queued then is that pass's own writing.
export function flushMutationBridge() {
  if (pausing) return;
  if (activeSource) activeSource.flush();
  mountFound();
}

// Test hook: which backend is active ("hub" | "native" | null).
export function _activeSourceKind() {
  return activeSource ? activeSource.kind : null;
}
