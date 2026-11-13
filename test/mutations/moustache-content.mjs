// node test/mutations/moustache-content.mjs [bound|ignored|all]
// Each entry puts back one part of the old E02 rule, or breaks the rule that is kept,
// and names the test that must then fail.
import { mutate } from "./harness.mjs";

const TEST = "test/moustache-content.test.js";
const file = "src/lint.js";

mutate({
  bound: {
    what: "a moustache typed into a bound element halts the app again",
    file,
    find: ' || n.hasAttribute("bind")',
    replace: "",
    test: TEST,
    name: "bound: text typed into a record does not halt",
    expects: /toEqual/,
  },
  "bound-nested": {
    what: "only a bound element's own text is skipped, not the markup under it",
    file,
    find: 'closedBoundary(n) || n.hasAttribute("bind") || n.hasAttribute("sap-ignore") ? 2 : 3',
    replace: 'closedBoundary(n) || n.hasAttribute("sap-ignore") ? 2 : n.hasAttribute("bind") && !n.firstElementChild ? 2 : 3',
    test: TEST,
    name: "bound: the same inside a row",
    expects: /toEqual/,
  },
  ignored: {
    what: "a moustache inside a sap-ignore subtree halts the app again",
    file,
    find: ' || n.hasAttribute("sap-ignore")',
    replace: "",
    test: TEST,
    name: "ignored: another library's template inside sap-ignore",
    expects: /toEqual/,
  },
  all: {
    what: "no moustache halts any more",
    file,
    find: 'closedBoundary(n) || n.hasAttribute("bind") || n.hasAttribute("sap-ignore") ? 2 : 3',
    replace: "2",
    test: TEST,
    name: "unbound: a moustache in any other text still halts",
    expects: /toEqual/,
  },
});
