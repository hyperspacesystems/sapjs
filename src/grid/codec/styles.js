// The bounded style vocabulary for cells and rows (ARCHITECTURE section 1). The
// editor's format() and paste filter, the host write policy, and patch all use
// this one list.

export const STYLE_PROPERTIES = [
  "font-weight",
  "font-style",
  "text-decoration",
  "color",
  "background",
  "background-color",
  "text-align",
  "white-space",
  "border",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
];

const ALLOWED = new Set(STYLE_PROPERTIES);
const VALUE = /^(?:[a-zA-Z0-9#%.,+ -]|(?:rgb|rgba|hsl|hsla)\([0-9.,%+ -]*\))+$/;

// Keeps only allowed properties with plain values, in canonical form
// "prop:value;prop:value". Returns undefined when nothing is left.
export function filterStyle(css) {
  if (typeof css !== "string") return undefined;
  const kept = new Map();
  for (const declaration of css.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim().replace(/\s+/g, " ");
    if (!ALLOWED.has(property) || value === "" || !VALUE.test(value)) continue;
    kept.set(property, value);
  }
  if (kept.size === 0) return undefined;
  return Array.from(kept, ([property, value]) => `${property}:${value}`).join(";");
}

export const isCanonicalStyle = (css) => typeof css === "string" && filterStyle(css) === css;
