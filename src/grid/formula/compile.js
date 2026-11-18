// A parsed formula to one closure. The closure holds no record ids: a reference compiles to a read
// of the formula's own bound reference at that place in parse order, so one text gives one closure
// for every cell that holds it. Never `new Function` or `eval`: formulas come from pastes, imports
// and peers.

import { lookupFunction } from "./functions.js";
import { applyBinary, error, negate, percent } from "./values.js";

function expression(node, places) {
  switch (node.type) {
    case "num":
    case "str":
    case "bool": {
      const value = node.value;
      return () => value;
    }
    case "err": {
      const value = error(node.code.toUpperCase());
      return () => value;
    }
    case "ref":
    case "range": {
      const at = places.get(node);
      return (ctx) => ctx.read(at);
    }
    case "unary": {
      const arg = expression(node.arg, places);
      return node.op === "-" ? (ctx) => negate(arg(ctx)) : arg;
    }
    case "postfix": {
      const arg = expression(node.arg, places);
      return (ctx) => percent(arg(ctx));
    }
    case "binary": {
      const { op } = node;
      const left = expression(node.left, places);
      const right = expression(node.right, places);
      return (ctx) => applyBinary(op, left(ctx), right(ctx));
    }
    case "call": {
      const fn = lookupFunction(node.name);
      if (fn === null) {
        const missing = error("#NAME?");
        return () => missing;
      }
      // A function that reads where its argument is (ROW, COLUMN, ROWS, COLUMNS) gets the area of a
      // reference argument, not its value.
      const args = node.args.map((arg) => {
        if (fn.areas === true && (arg.type === "ref" || arg.type === "range")) {
          const at = places.get(arg);
          return (ctx) => ctx.area(at);
        }
        // A reference written straight into a call is a range of one cell.
        if (arg.type === "ref") {
          const at = places.get(arg);
          return (ctx) => ctx.read(at, true);
        }
        return expression(arg, places);
      });
      return (ctx) => fn.run(args.map((arg) => arg(ctx)), ctx);
    }
    default: {
      const broken = error("#ERROR!");
      return () => broken;
    }
  }
}

// The closure for a parse: `run(ctx)`, where `ctx.read(i, whole)` gives the value of reference i (a
// range for a range, and for a cell when `whole`), `ctx.area(i)` its place, and `ctx.home` the formula's own row and column indexes.
export function compile(parsed) {
  const places = new Map(parsed.refs.map((node, at) => [node, at]));
  return expression(parsed.ast, places);
}

// One closure per formula text.
export function compiler(limit = 10000) {
  const cache = new Map();
  return (f, parsed) => {
    let run = cache.get(f);
    if (run === undefined) {
      if (cache.size >= limit) cache.clear();
      run = compile(parsed);
      cache.set(f, run);
    }
    return run;
  };
}
