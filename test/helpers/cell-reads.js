// Counts how often code reads a table row or cell through the DOM: its attributes and
// its child links. jsdom runs selectors in JavaScript through these same getters, where
// a browser runs them natively, so a read made inside a selector call is not counted.

const READS = ["hasAttribute", "getAttribute"];
const LINKS = ["attributes", "firstElementChild", "nextElementSibling", "children"];
const SELECTORS = ["querySelector", "querySelectorAll", "closest", "matches"];

export function watchCells(win = window, tags = ["td", "tr"]) {
  const undo = [];
  let count = 0;
  let selecting = 0;
  const counts = (node) => !selecting && tags.includes(node.localName);
  const element = win.Element.prototype;
  for (const name of READS) {
    const real = element[name];
    element[name] = function (...args) { if (counts(this)) count++; return real.apply(this, args); };
    undo.push(() => { element[name] = real; });
  }
  for (const name of LINKS) {
    const real = Object.getOwnPropertyDescriptor(element, name);
    Object.defineProperty(element, name, { configurable: true, get() { if (counts(this)) count++; return real.get.call(this); } });
    undo.push(() => Object.defineProperty(element, name, real));
  }
  for (const proto of [element, win.Document.prototype, win.DocumentFragment.prototype]) {
    for (const name of SELECTORS) {
      if (!Object.prototype.hasOwnProperty.call(proto, name)) continue;
      const real = proto[name];
      proto[name] = function (...args) {
        selecting++;
        try { return real.apply(this, args); } finally { selecting--; }
      };
      undo.push(() => { proto[name] = real; });
    }
  }
  return {
    // The reads fn makes: a number, or a promise of one when fn is async.
    during(fn) {
      count = 0;
      const done = fn();
      if (done && typeof done.then === "function") return done.then(() => count);
      return count;
    },
    stop() { while (undo.length) undo.pop()(); },
  };
}
