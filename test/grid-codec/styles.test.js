import { STYLE_PROPERTIES, filterStyle, isCanonicalStyle } from "../../src/grid/codec/styles.js";

test("the style vocabulary is the bounded list", () => {
  expect(STYLE_PROPERTIES).toEqual([
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
  ]);
});

const FILTERED = [
  ["font-weight: bold; COLOR: #c00", "font-weight:bold;color:#c00"],
  ["color:red;color:blue", "color:blue"],
  ["position:absolute;color:red", "color:red"],
  ["background:url(x.png)", undefined],
  ["background:rgb(1, 2, 3)", "background:rgb(1, 2, 3)"],
  ["color:expression(alert(1))", undefined],
  ["border:1px  solid   #999", "border:1px solid #999"],
  ["color:var(--x)", undefined],
  ["color:red !important", undefined],
  ["", undefined],
  [";;", undefined],
  [null, undefined],
  [42, undefined],
];

for (const [css, expected] of FILTERED) {
  test(`filterStyle(${JSON.stringify(css)}) is ${JSON.stringify(expected)}`, () => {
    expect(filterStyle(css)).toBe(expected);
  });
}

test("isCanonicalStyle accepts only the canonical form", () => {
  expect(isCanonicalStyle("font-weight:bold")).toBe(true);
  expect(isCanonicalStyle("font-weight: bold")).toBe(false);
});
