// The only door to a pass. A burst of N synthetic events coalesces into ONE
// microtask pass (the `queued` flag is the transaction). The circuit breaker
// stops runaway recompute loops and names the culprit from a trigger ring.
//
// It also keeps, per app, what the mutation bridge reported since that app's last
// pass: app._changes is a list, null for none, or false once a report had to be
// dropped, which makes the next pass read everything.

const MAX_PASSES = 50; // per macrotask, per app; a true loop trips this. A tripped app stays
// halted against its own mutations and rearms on the next refresh or interaction.

export function createScheduler(runPass) {
  let queued = false;
  const dirty = new Set();
  const ring = []; // recent trigger descriptions, for the breaker message

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
      // Reported while this app's pass is starting: that pass lists them.
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

  // An app stays in `dirty` until its own pass starts. So when an earlier pass in the
  // same drain delivers a change for an app that is still waiting, the change joins the
  // pass that app is about to get and queues no second one.
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
      runPass(app, { breaker: true });
      return;
    }
    if (!app._resetArmed) {
      app._resetArmed = true;
      setTimeout(() => {
        app._passes = 0;
        app._resetArmed = false;
      }, 0);
    }
    runPass(app, full ? { full: true, cause } : { cause });
  }

  // Synchronous pass (Sap.refresh / livesync resync). Still breaker-guarded. The
  // caller cannot say which elements changed, so every directive is re-read.
  function runNow(app, trigger) {
    note(trigger);
    if (app._broken) rearm(app);
    runWithBreaker(app, true, trigger);
  }

  function rearm(app) {
    app._broken = false;
    app._passes = 0;
  }

  // Run every queued pass now, in this task, and the passes those passes queue. True
  // when a pass was queued.
  function flushNow() {
    const ran = queued;
    while (queued) drain();
    return ran;
  }

  return { schedule, runNow, flushNow };
}
