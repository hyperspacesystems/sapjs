// node test/mutations/paint.mjs [report-tail|...]
// Each entry breaks one part of how a paint is reported or of how the visibility verbs
// decide, and names the test that must then fail. With no argument every entry runs.
import { mutate } from "./harness.mjs";

mutate({
  "report-tail": {
    what: "a failed attr:, class: or css: paint is reported without its name",
    file: "src/pass.js",
    find: 'return tail == null ? def.kind : def.kind + ":" + tail;',
    replace: "return def.kind;",
    test: "test/reactivity.test.js",
    name: "preserve-on-error: the report names the attribute",
    expects: /toEqual/,
  },
  "report-format": {
    what: "a failed text paint with a format is reported as plain text",
    file: "src/pass.js",
    find: 'const tail = def.kind === "text" ? def.fmt || null : def.arg;',
    replace: "const tail = def.arg;",
    test: "test/reactivity.test.js",
    name: "preserve-on-error: the report names the attribute",
    expects: /toEqual/,
  },
  "when-hide": {
    what: "hide-when shows and hides like show-when",
    file: "src/pass.js",
    find: '=== (def.match === "hide");',
    replace: "=== false;",
    test: "test/visibility-interop.test.js",
    name: "each verb with the field matching, not matching, and absent",
    expects: /toBe/,
  },
  "when-not": {
    what: "option-not matches like show-when",
    file: "src/pass.js",
    find: 'def.values, def.match === "show-not")',
    replace: "def.values, false)",
    test: "test/visibility-interop.test.js",
    name: "each verb with the field matching, not matching, and absent",
    expects: /toBe/,
  },
});
