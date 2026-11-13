// The effect= feature again, built on the public plugin contract: one directive and
// two hooks. after="statement" runs after every paint.

export default {
  name: "after",
  version: "1.0.0",
  api: 1,
  directives: { after: { key: "afters", impure: true } },
  setup(kit) {
    return {
      directives: { after: (tail, value) => ({ entry: kit.compile(value, true) }) },
      begin(pass) {
        pass.afters = [];
      },
      collect(pass, el, plan, ctx) {
        if (!plan.afters) return false;
        for (const def of plan.afters) pass.afters.push({ def, el, ctx });
      },
      afterPaint(pass) {
        for (const { def, el, ctx } of pass.afters) {
          try {
            kit.runWith(def.entry, ctx.state, ctx.item, el, ctx.root);
            kit.clearBeacon(el);
          } catch (err) {
            pass.app.diag.error("E24", el, { attr: "after", expr: def.entry.src, problem: String(err.message) });
            kit.setBeacon(el, "E24");
          }
        }
      },
    };
  },
};
