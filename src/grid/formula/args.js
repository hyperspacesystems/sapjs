// How a function reads its arguments, shared by the core functions and the extended pack. No
// state: a plugin bundle that carries its own copy reads arguments the same way.

import { error, isBlank, isError, isRange, single, toNumber } from "./values.js";

// Each number the arguments give: in a range only its numbers count, and an error stops the walk;
// a value written directly is coerced, so SUM(TRUE, "3") is 4. Returns the first error, or null.
export function eachNumber(args, add) {
  for (const arg of args) {
    if (isRange(arg)) {
      let failure = null;
      arg.forEach((value) => {
        if (failure !== null) return;
        if (isError(value)) failure = value;
        else if (typeof value === "number") add(value);
      });
      if (failure !== null) return failure;
      continue;
    }
    if (isError(arg)) return arg;
    if (isBlank(arg)) continue;
    // A text written into the call is read as a number; the empty text is #VALUE!, as in Sheets.
    if (arg === "") return error("#VALUE!");
    const number = toNumber(arg);
    if (isError(number)) return number;
    add(number);
  }
  return null;
}

export const numbers = (args) => {
  const list = [];
  const failure = eachNumber(args, (value) => list.push(value));
  return failure ?? list;
};

// A number to 15 significant digits, so 0.1 + 0.2 rounds as people expect.
export const clean = (value) => (Number.isFinite(value) ? Number(value.toPrecision(15)) : value);

// Each argument as a number, or the first error: for functions with fixed numeric arguments.
export function numberArgs(args, count, defaults = []) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const arg = i < args.length ? single(args[i]) : defaults[i];
    if (arg === undefined) return error("#N/A");
    const number = toNumber(arg);
    if (isError(number)) return number;
    out.push(number);
  }
  return out;
}

export const fixed = (count, body, defaults) => ({
  run(args) {
    if (args.length > count || args.length < count - defaults.filter((d) => d !== undefined).length) return error("#N/A");
    const list = numberArgs(args, count, defaults);
    return isError(list) ? list : body(...list);
  },
});
