import { run } from "./support/rewrite-run.js";

global.__SAP_KEEP_CONSOLE__ = true;

const SEEDS = 150;
const STEPS = 40;

// Undo in order (one person, or a tab with no room): every rewrite law holds, and with every restore
// list emptied the same seeds fail, so the restore lists are what make them hold. Undo out of order
// happens only in a room; its guarded revert is S5's, and the command line fuzz reports it.
test("the rewrite laws hold on every seed when each undo runs in order, and fail without the restore lists", () => {
  const failures = [];
  let caught = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const bad = run(seed, { strict: true, steps: STEPS });
    if (bad) failures.push(JSON.stringify(bad));
    if (run(seed, { naive: true, strict: true, steps: STEPS }) !== null) caught += 1;
  }
  expect(failures).toEqual([]);
  expect(caught).toBeGreaterThan(SEEDS / 10);
});
