import { parseInput } from "../../src/grid/input.js";
import { CASES } from "./support/input-cases.js";
import { rng } from "../grid-codec/support/rng.js";

for (const [group, cases] of Object.entries(CASES)) {
  test(`input: ${group}`, () => {
    for (const [typed, options, expected] of cases) {
      expect([typed, options, parseInput(typed, options)]).toEqual([typed, options, expected]);
    }
  });
}

test("input: purity of the number value", () => {
  const random = rng(20261116);
  for (let i = 0; i < 2000; i++) {
    const count = 1 + Math.floor(random() * 6);
    const places = Math.floor(random() * 5);
    let whole = String(1 + Math.floor(random() * 9));
    for (let d = 1; d < count; d++) whole += String(Math.floor(random() * 10));
    let fraction = "";
    for (let d = 0; d < places; d++) fraction += String(Math.floor(random() * 10));
    const typed = (places ? whole + "." + fraction : whole) + "%";
    const shifted = whole.length > 2 ? `${whole.slice(0, -2)}.${whole.slice(-2)}${fraction}` : `0.${whole.padStart(2, "0")}${fraction}`;
    expect([typed, parseInput(typed).content]).toEqual([typed, Number(shifted)]);
  }
  expect(parseInput("8.2%").content).toBe(0.082);
});
