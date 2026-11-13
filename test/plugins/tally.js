// The smallest plugin that uses what the grid needs: an opaque boundary, a helper,
// pass.changes and a public API. A <ul tally="scores"> sums its <li> numbers into
// <li total>, and tally('scores') reads the sum from any expression. The engine never
// walks inside the list, and the plugin reads a list again only when a change landed in
// it. `seen` and `reads` are probes for the tests.

export default {
  name: "tally",
  version: "1.0.0",
  api: 1,
  order: 5,
  boundaries: { tally: { opaque: true } },
  helpers: ["tally"],
  setup(kit) {
    const lists = new Map();
    const seen = [];
    let reads = 0;

    function read(el) {
      let sum = 0;
      for (const li of el.children) {
        if (li.hasAttribute("total")) continue;
        sum += Number(li.textContent) || 0;
        reads++;
      }
      return sum;
    }

    return {
      begin(pass) {
        seen.push(pass.changes && pass.changes.map((c) => `${c.type}:${c.element.localName}`));
        for (const [el, rec] of lists) {
          if (!el.isConnected) lists.delete(el);
          else if (pass.changes === null) rec.stale = true;
        }
        for (const c of pass.changes || []) {
          const at = c.type === "remove" ? c.parent : c.element;
          const rec = lists.get(at.closest("[tally]"));
          if (rec) rec.stale = true;
        }
      },
      boundaries: {
        tally(pass, el) {
          let rec = lists.get(el);
          if (!rec) lists.set(el, (rec = { name: el.getAttribute("tally"), sum: 0, stale: true }));
          if (rec.stale) {
            rec.sum = read(el);
            rec.stale = false;
          }
          const total = el.querySelector("li[total]");
          if (total && total.textContent !== String(rec.sum)) total.textContent = String(rec.sum);
        },
      },
      helpers: {
        tally(name) {
          for (const rec of lists.values()) if (rec.name === name) return rec.sum;
          return 0;
        },
      },
      api: { tally: { reads: () => reads, seen, engine: kit.version } },
      dispose() {
        lists.clear();
      },
    };
  },
};
