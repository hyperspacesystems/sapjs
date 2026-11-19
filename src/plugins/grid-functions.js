// The extended functions as a plugin: statistics and finance (STDEV, PERCENTILE, PMT, IRR and
// more, src/grid/formula/pack.js). It needs the grid, and adds its functions through Sap.grid.extend
// so they reach the grid's own engines: formulas waiting on them compute without marking the file
// unsaved. Not in the manifest: a host installs it with Sap.use, usually in idle time after a
// sheet opens.
import { PACK } from "../grid/formula/pack.js";

export default {
  name: "grid-functions",
  version: "0.1.0",
  api: 1,
  requires: ["grid"],
  // The grid's api comes from the kit: a page that loads this file before sap.js installs it
  // while window.Sap is not set yet.
  setup(kit) {
    return { dispose: kit.plugin("grid").grid.extend({ functions: PACK }) };
  },
};
