import { backing, bytesOf, rowLine, S } from "./support/ops-fixture.js";
import { derive } from "../../src/grid/content.js";
import { apply, GridRefused, targets, validate } from "../../src/grid/ops.js";
import { canonRowStyle, canonStyle, cleanDeclaration, cleanStyle, pasteStyle, splitDeclarations } from "../../src/grid/styles.js";

const shuffle = (items, seed) => {
  let state = seed;
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const at = state % (i + 1);
    const held = out[i];
    out[i] = out[at];
    out[at] = held;
  }
  return out;
};

test("one order for every input order", () => {
  const declarations = [
    "font-weight:700",
    "color:#ABC",
    "text-align:center",
    "background:#fff",
    "border-top:1px solid #000",
    "font-style:italic",
  ];
  const expected = "font-weight:bold;font-style:italic;color:#aabbcc;background-color:#ffffff;text-align:center;border-top:1px solid #000";
  for (let seed = 1; seed <= 20; seed++) {
    const order = shuffle(declarations, seed);
    expect([order.join(";"), cleanStyle(order.join(";"))]).toEqual([order.join(";"), expected]);
  }
});

test("spelling", () => {
  const rows = [
    ["font-weight:bold", "font-weight:bold"],
    ["font-weight:bolder", "font-weight:bold"],
    ["font-weight:700", "font-weight:bold"],
    ["font-weight:900", "font-weight:bold"],
    ["font-weight:normal", undefined],
    ["font-weight:400", undefined],
    ["font-weight:300", "font-weight:300"],
    ["color:#ABC", "color:#aabbcc"],
    ["color:#AbCdEf", "color:#abcdef"],
    ["color:rgb(255, 0, 0)", "color:#ff0000"],
    ["color:red", "color:#ff0000"],
    ["color:Red", "color:#ff0000"],
    ["color:rgba(0,0,0,0.5)", "color:rgba(0,0,0,0.5)"],
    ["background:#fff", "background-color:#ffffff"],
    ["background:white", "background-color:#ffffff"],
    ["background:url(x)", undefined],
  ];
  for (const [input, wanted] of rows) expect([input, cleanStyle(input)]).toEqual([input, wanted]);
});

test("a value outside the tables is kept", () => {
  expect(cleanStyle("font-weight:300")).toBe("font-weight:300");
  expect(cleanStyle("color:hsl(0,100%,50%)")).toBe("color:hsl(0,100%,50%)");
  expect(cleanStyle("text-align:justify")).toBe("text-align:justify");
  expect(cleanStyle("background:none")).toBe("background:none");
  expect(cleanDeclaration("color", "#000000")).toEqual(["color", "#000000"]);
  expect(cleanDeclaration("outline", "1px")).toEqual(["outline", "1px"]);
});

test("borders", () => {
  const solid = "1px solid #000";
  const equal = `border-top:${solid};border-right:${solid};border-bottom:${solid};border-left:${solid}`;
  expect(cleanStyle(equal)).toBe(`border:${solid}`);
  expect(cleanStyle(`border:${solid}`)).toBe(`border:${solid}`);
  expect(cleanStyle(`border:${solid};border-left:2px solid #f00`))
    .toBe(`border-top:${solid};border-right:${solid};border-bottom:${solid};border-left:2px solid #f00`);
  expect(cleanStyle(`border:${solid};border-left:none`))
    .toBe(`border-top:${solid};border-right:${solid};border-bottom:${solid};border-left:none`);
  expect(cleanStyle(`border:${solid};border-left:none;border-top:none`))
    .toBe(`border-top:none;border-right:${solid};border-bottom:${solid};border-left:none`);
  expect(cleanStyle(`border-top:${solid};border-right:${solid};border-bottom:${solid}`))
    .toBe(`border-top:${solid};border-right:${solid};border-bottom:${solid}`);
});

test("hostile input", () => {
  expect(cleanStyle("background:url(javascript:x)")).toBe(undefined);
  expect(cleanStyle("width:expression(alert(1))")).toBe(undefined);
  expect(cleanStyle("position:fixed")).toBe(undefined);
  expect(cleanStyle("color:red !important")).toBe(undefined);
  expect(cleanStyle("color:/*x*/red")).toBe(undefined);
  expect(cleanStyle("color:\\72 ed")).toBe(undefined);
  expect(cleanStyle("behavior:url(x)")).toBe(undefined);

  const long = `color:${"a".repeat(99999)}!`;
  const started = Date.now();
  const out = cleanStyle(long);
  const spent = Date.now() - started;
  expect(out).toBe(undefined);
  expect(spent).toBeLessThan(500);

  expect(cleanStyle({ color: "red", width: "expression(alert(1))" })).toBe("color:#ff0000");
  expect(pasteStyle("background:url(javascript:x);color:red")).toBe("color:#ff0000");
});

test("pasted defaults are dropped", () => {
  const excel = "color:black;background:white;font-weight:400;font-style:normal;text-decoration:none;white-space:normal;text-align:right";
  expect(pasteStyle(excel)).toBe("text-align:right");
  expect(pasteStyle(`${excel};color:red`)).toBe("color:#ff0000;text-align:right");
  expect(pasteStyle(`${excel};background:#fff2cc`)).toBe("background-color:#fff2cc;text-align:right");
  expect(pasteStyle("color:black;background:white")).toBe(undefined);
});

test("styles through actions", () => {
  const store = backing();
  const before = bytesOf(store);

  const bold = { v: 1, t: "format", sheet: S, cells: [["r1", "ca", { style: { "font-weight": "bold" } }]] };
  const bolded = apply(store, bold, { derive });
  expect(bolded.out).toBe("applied");
  expect(rowLine(bytesOf(store), "r1")).toContain('<td style="font-weight:bold">Name</td>');

  const color = { v: 1, t: "format", sheet: S, cells: [["r1", "ca", { style: { color: "Red" } }]] };
  const colored = apply(store, color, { derive });
  expect(colored.out).toBe("applied");
  expect(rowLine(bytesOf(store), "r1")).toContain('<td style="font-weight:bold;color:#ff0000">Name</td>');

  const backColor = apply(store, colored.inverse, { derive });
  expect(backColor.out).toBe("applied");
  expect(rowLine(bytesOf(store), "r1")).toContain('<td style="font-weight:bold">Name</td>');

  const backBold = apply(store, bolded.inverse, { derive });
  expect(backBold.out).toBe("applied");
  expect(bytesOf(store)).toBe(before);

  const fill = { v: 1, t: "format", sheet: S, cells: [["r3", "cd", { style: { background: "white" } }]] };
  expect(targets(fill)).toEqual([[S, "r3", "cd", "style:background-color"]]);
  const filled = apply(store, fill, { derive });
  expect(filled.out).toBe("applied");
  expect(rowLine(bytesOf(store), "r3")).toContain('<td style="background-color:#ffffff"></td>');
  expect(apply(store, filled.inverse, { derive }).out).toBe("applied");
  expect(bytesOf(store)).toBe(before);

  const solid = "1px solid #000";
  const all = { "border-top": solid, "border-right": solid, "border-bottom": solid, "border-left": solid };
  const boxed = { v: 1, t: "format", sheet: S, cells: [["r1", "cb", { style: all }]] };
  expect(targets(boxed)).toEqual([
    [S, "r1", "cb", "style:border-top"],
    [S, "r1", "cb", "style:border-right"],
    [S, "r1", "cb", "style:border-bottom"],
    [S, "r1", "cb", "style:border-left"],
  ]);
  const drawn = apply(store, boxed, { derive });
  expect(drawn.out).toBe("applied");
  expect(rowLine(bytesOf(store), "r1")).toContain(`<td style="border:${solid}">Qty</td>`);

  const cut = { v: 1, t: "format", sheet: S, cells: [["r1", "cb", { style: { "border-left": null } }]] };
  const cutOut = apply(store, cut, { derive });
  expect(cutOut.out).toBe("applied");
  expect(rowLine(bytesOf(store), "r1"))
    .toContain(`<td style="border-top:${solid};border-right:${solid};border-bottom:${solid}">Qty</td>`);
  const back = apply(store, cutOut.inverse, { derive });
  expect(back.out).toBe("applied");
  expect(rowLine(bytesOf(store), "r1")).toContain(`<td style="border:${solid}">Qty</td>`);
  expect(apply(store, drawn.inverse, { derive }).out).toBe("applied");
  expect(bytesOf(store)).toBe(before);

  const shorthand = { v: 1, t: "format", sheet: S, cells: [["r1", "ca", { style: { border: solid } }]] };
  expect(() => validate(shorthand)).toThrow(GridRefused);
  const refused = apply(store, shorthand, { derive });
  expect(refused.out).toBe("refused");
  expect(refused.code).toBe("bad_action");
  expect(bytesOf(store)).toBe(before);
});

test("a style the engine did not write keeps its look", () => {
  const store = backing();
  store.sheet.rows[0].cells[0].style = "color:#333333;font-size:20px";
  const before = bytesOf(store);

  const bold = { v: 1, t: "format", sheet: S, cells: [["r1", "ca", { style: { "font-weight": "bold" } }]] };
  const out = apply(store, bold, { derive });
  expect(out.out).toBe("applied");
  expect(rowLine(bytesOf(store), "r1"))
    .toEqual(expect.stringContaining('<td style="font-weight:bold;color:#333333;font-size:20px">Name</td>'));

  const back = apply(store, out.inverse, { derive });
  expect(back.out).toBe("applied");
  expect(bytesOf(store)).toBe(before);
});

test("a declaration splits the way css does", () => {
  const url = "url(data:image/png;base64,AAAA)";
  expect(splitDeclarations(`background-image:${url};color:red`)).toEqual([`background-image:${url}`, "color:red"]);
  expect(splitDeclarations('content:"a;b";color:red')).toEqual(['content:"a;b"', "color:red"]);

  const store = backing();
  store.sheet.rows[0].cells[0].style = `background-image:${url}`;
  const before = bytesOf(store);
  const out = apply(store, { v: 1, t: "format", sheet: S, cells: [["r1", "ca", { style: { "font-weight": "bold" } }]] }, { derive });
  expect(out.out).toBe("applied");
  expect(rowLine(bytesOf(store), "r1")).toEqual(expect.stringContaining(`<td style="background-image:${url};font-weight:bold">Name</td>`));
  const back = apply(store, out.inverse, { derive });
  expect(back.out).toBe("applied");
  expect(bytesOf(store)).toBe(before);
});

test("a kept declaration in the way of a listed property", () => {
  const brand = backing();
  brand.sheet.rows[0].cells[0].style = "color:var(--brand)";
  const brandBefore = bytesOf(brand);
  const red = { v: 1, t: "format", sheet: S, cells: [["r1", "ca", { style: { color: "red" } }]] };
  expect(targets(red)).toEqual([[S, "r1", "ca", "style:color"]]);
  const colored = apply(brand, red, { derive });
  expect(colored.out).toBe("applied");
  expect(rowLine(bytesOf(brand), "r1")).toEqual(expect.stringContaining('<td style="color:#ff0000">Name</td>'));
  const recolor = apply(brand, colored.inverse, { derive });
  expect(recolor.out).toBe("applied");
  expect(bytesOf(brand)).toBe(brandBefore);

  const gradient = backing();
  gradient.sheet.rows[0].cells[0].style = "background:linear-gradient(#ffffff,#000000)";
  const gradientBefore = bytesOf(gradient);
  const fill = { v: 1, t: "format", sheet: S, cells: [["r1", "ca", { style: { background: "red" } }]] };
  expect(targets(fill)).toEqual([[S, "r1", "ca", "style:background-color"]]);
  const filled = apply(gradient, fill, { derive });
  expect(filled.out).toBe("applied");
  expect(rowLine(bytesOf(gradient), "r1")).toEqual(expect.stringContaining('<td style="background-color:#ff0000">Name</td>'));
  const unfill = apply(gradient, filled.inverse, { derive });
  expect(unfill.out).toBe("applied");
  expect(bytesOf(gradient)).toBe(gradientBefore);

  const thick = "border:1px solid var(--line);border-bottom:2px solid #333333";
  const bordered = backing();
  bordered.sheet.rows[0].cells[0].style = thick;
  const borderedBefore = bytesOf(bordered);
  expect(canonStyle(thick)).toBe(thick);
  const drawn = apply(bordered, { v: 1, t: "format", sheet: S, cells: [["r1", "ca", { style: { "border-bottom": "3px solid #ff0000" } }]] }, { derive });
  expect(drawn.out).toBe("applied");
  expect(rowLine(bytesOf(bordered), "r1")).toEqual(expect.stringContaining(
    '<td style="border:1px solid var(--line);border-bottom:3px solid #ff0000">Name</td>',
  ));
  const undraw = apply(bordered, drawn.inverse, { derive });
  expect(undraw.out).toBe("applied");
  expect(bytesOf(bordered)).toBe(borderedBefore);
});

test("a style value holds one declaration, not two", () => {
  const store = backing();
  const before = bytesOf(store);
  for (const value of ["#ff0000;font-weight:bold", "red<", "red{", "red}", "red\n"]) {
    const action = { v: 1, t: "format", sheet: S, cells: [["r1", "ca", { style: { color: value } }]] };
    const out = apply(store, action, { derive });
    expect([value, out.out, out.code]).toEqual([value, "refused", "bad_action"]);
    expect([value, bytesOf(store)]).toEqual([value, before]);
  }
});

test("a css and a row style are whole styles", () => {
  const store = backing();
  store.sheet.rows[0].cells[0].style = "color:#333333";
  const before = bytesOf(store);
  const url = "background-image:url(https://example.test/p.png)";

  const write = { v: 1, t: "format", sheet: S, cells: [["r1", "ca", { css: url }]] };
  expect(targets(write)).toEqual([[S, "r1", "ca", "style:*"]]);
  const written = apply(store, write, { derive });
  expect(written.out).toBe("applied");
  expect(rowLine(bytesOf(store), "r1")).toEqual(expect.stringContaining(`<td style="${url}">Name</td>`));
  const back = apply(store, written.inverse, { derive });
  expect(back.out).toBe("applied");
  expect(bytesOf(store)).toBe(before);

  const clear = { v: 1, t: "format", sheet: S, cells: [["r1", "ca", { css: "" }]] };
  const emptied = apply(store, clear, { derive });
  expect(emptied.out).toBe("applied");
  expect(rowLine(bytesOf(store), "r1")).toEqual(expect.stringContaining("<td>Name</td>"));
  const filled = apply(store, emptied.inverse, { derive });
  expect(filled.out).toBe("applied");
  expect(bytesOf(store)).toBe(before);

  for (const css of ["color:red<", "color:red\n", "font-size:20px;color:#333333"]) {
    const here = bytesOf(store);
    const out = apply(store, { v: 1, t: "format", sheet: S, cells: [["r1", "ca", { css }]] }, { derive });
    expect([css, out.out, out.code]).toEqual([css, "applied", undefined]);
    const back = apply(store, out.inverse, { derive });
    expect([css, back.out, bytesOf(store)]).toEqual([css, "applied", here]);
  }

  const row = { v: 1, t: "insertRows", sheet: S, rows: [{ id: "r9", pos: "z", style: "color:#333333" }] };
  expect(targets(row)).toEqual([
    [S, "row", "r9", "exists"],
    [S, "row", "r9", "rowstyle"],
  ]);
  const grown = apply(store, row, { derive });
  expect(grown.out).toBe("applied");
  expect(rowLine(bytesOf(store), "r9")).toBe('<tr data-id="r9" data-pos="z" style="color:#333333"></tr>');
  const ungrown = apply(store, grown.inverse, { derive });
  expect(ungrown.out).toBe("applied");
  expect(rowLine(bytesOf(store), "r9")).toBe(undefined);

  for (const style of ["color:red<", "color:red\n", "color:#333333;height:20px", "background:#eee;height:24px"]) {
    const row = { v: 1, t: "insertRows", sheet: S, rows: [{ id: "r0", pos: "5", style }] };
    expect([style, () => validate(row)]).toEqual([style, expect.any(Function)]);
    expect(() => validate(row)).not.toThrow();
  }
  for (const style of ["color:red\0", "color:red\uD800"]) {
    const row = { v: 1, t: "insertRows", sheet: S, rows: [{ id: "r0", pos: "5", style }] };
    let caught = null;
    try {
      validate(row);
    } catch (err) {
      caught = err;
    }
    expect([style, caught && caught.code]).toEqual([style, "bad_action"]);
  }
  expect(canonRowStyle("height: 30px;color:#333333")).toBe("height: 30px;color:#333333");
});

test("a background key names the background colour", () => {
  const store = backing();
  store.sheet.rows[0].cells[0].style = "background-color:#eeeeee";
  const before = bytesOf(store);
  const clear = { v: 1, t: "format", sheet: S, cells: [["r1", "ca", { style: { background: null } }]] };
  expect(targets(clear)).toEqual([[S, "r1", "ca", "style:background-color"]]);
  const cleared = apply(store, clear, { derive });
  expect(cleared.out).toBe("applied");
  expect(rowLine(bytesOf(store), "r1")).toEqual(expect.stringContaining("<td>Name</td>"));
  const back = apply(store, cleared.inverse, { derive });
  expect(back.out).toBe("applied");
  expect(bytesOf(store)).toBe(before);

  store.sheet.rows[0].cells[0].style = "background:url(https://example.test/p.png)";
  const kept = bytesOf(store);
  const gone = apply(store, clear, { derive });
  expect(gone.out).toBe("applied");
  expect(rowLine(bytesOf(store), "r1")).toEqual(expect.stringContaining("<td>Name</td>"));
  const keptBack = apply(store, gone.inverse, { derive });
  expect(keptBack.out).toBe("applied");
  expect(bytesOf(store)).toBe(kept);
});

test("redo after undo of a mixed style edit brings the edit back", () => {
  const store = backing();
  store.sheet.rows[0].cells[0].style = "text-align:center;color:var(--brand)";
  const before = bytesOf(store);
  const red = { v: 1, t: "format", sheet: S, cells: [["r1", "ca", { style: { color: "red" } }]] };
  const colored = apply(store, red, { derive });
  expect(colored.out).toBe("applied");
  expect(rowLine(bytesOf(store), "r1")).toEqual(expect.stringContaining('style="color:#ff0000;text-align:center"'));
  const after = bytesOf(store);
  const back = apply(store, colored.inverse, { derive });
  expect([back.out, bytesOf(store)]).toEqual(["applied", before]);
  const again = apply(store, back.inverse, { derive });
  expect([again.out, bytesOf(store)]).toEqual(["applied", after]);
});
