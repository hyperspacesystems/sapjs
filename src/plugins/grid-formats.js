// Number formats beyond the built-in list ('0.00 "kg"', '0.00;[Red]-0.00', '# ?/?') as a plugin,
// backed by numfmt (an optional dependency of sapjs). It needs the grid, and adds its formatter
// through Sap.grid.extend, so open sheets draw those cells once it is here. Not in the manifest: a
// host installs it with Sap.use when a sheet holds such a code.
import { numfmtFormatter } from "../grid/numfmt-formatter.js";

export default {
  name: "grid-formats",
  version: "0.1.0",
  api: 1,
  requires: ["grid"],
  // The grid's api comes from the kit: a page that loads this file before sap.js installs it
  // while window.Sap is not set yet.
  setup(kit) {
    return { dispose: kit.plugin("grid").grid.extend({ formatters: [numfmtFormatter] }) };
  },
};
