// The extended functions: statistics and finance a sheet loads when it needs them. Each reads its
// arguments with the core's rules (args.js), so blanks, text and errors in a range count as they do
// in SUM and AVERAGE: in a range only numbers count and an error stops the walk, and a value written
// into the call is read as a number.

import { clean, eachNumber, fixed, numberArgs, numbers } from "./args.js";
import { asRange, error, finite, isError } from "./values.js";

const sum = (list) => list.reduce((a, b) => a + b, 0);

// The spread of a list around its mean, divided by n - 1 for a sample or n for a whole population.
function variance(args, sample) {
  const list = numbers(args);
  if (isError(list)) return list;
  if (list.length < (sample ? 2 : 1)) return error("#DIV/0!");
  // A constant list has no spread, though its float mean can drift (0.1 three times).
  if (list.every((x) => x === list[0])) return 0;
  const mean = sum(list) / list.length;
  return sum(list.map((x) => (x - mean) ** 2)) / (list.length - (sample ? 1 : 0));
}
const spread = (sample, root) => ({
  run(args) {
    if (args.length === 0) return error("#N/A");
    const v = variance(args, sample);
    return isError(v) ? v : clean(root ? Math.sqrt(v) : v);
  },
});

// One range argument as a sorted list of its numbers, and the number arguments after it.
function listAnd(args, count, defaults = []) {
  if (args.length < 1 + count - defaults.filter((d) => d !== undefined).length || args.length > 1 + count) return error("#N/A");
  const list = numbers([args[0]]);
  if (isError(list)) return list;
  const rest = numberArgs(args.slice(1), count, defaults);
  if (isError(rest)) return rest;
  return [list.sort((a, b) => a - b), ...rest];
}

function percentile(list, k) {
  if (list.length === 0 || k < 0 || k > 1) return error("#NUM!");
  const at = k * (list.length - 1);
  const low = Math.floor(at);
  return low + 1 < list.length ? clean(list[low] + (at - low) * (list[low + 1] - list[low])) : list[low];
}

// The k-th from one end: k below 1 or past the count is #NUM!; a fraction counts as the next whole.
const nth = (fromTop) => ({
  run(args) {
    const got = listAnd(args, 1);
    if (isError(got)) return got;
    const [list, k] = got;
    const n = Math.ceil(k);
    if (n < 1 || n > list.length) return error("#NUM!");
    return fromTop ? list[list.length - n] : list[n - 1];
  },
});

// MODE and RANK compare at 15 digits, as = does, so =0.1+0.2 and a typed 0.3 are one value.
const MODE = {
  run(args) {
    const got = numbers(args);
    if (isError(got)) return got;
    const list = got.map(clean);
    const counts = new Map();
    let best = null;
    let most = 1;
    for (const x of list) {
      const count = (counts.get(x) ?? 0) + 1;
      counts.set(x, count);
      if (count > most) {
        most = count;
        best = x;
      }
    }
    // A tie is won by the value that appears first, as in Sheets.
    if (best === null) return error("#N/A");
    return list.find((x) => counts.get(x) === most);
  },
};

const RANK = {
  run(args) {
    if (args.length < 2 || args.length > 3) return error("#N/A");
    const head = numberArgs([args[0]], 1);
    if (isError(head)) return head;
    const list = numbers([args[1]]);
    if (isError(list)) return list;
    const order = numberArgs(args.slice(2), 1, [0]);
    if (isError(order)) return order;
    const value = clean(head[0]);
    const nums = list.map(clean);
    if (!nums.includes(value)) return error("#N/A");
    return 1 + nums.filter((x) => (order[0] === 0 ? x > value : x < value)).length;
  },
};

// Each cell of a range by its place, so two ranges pair cell by cell.
function cellsOf(value) {
  const range = asRange(value);
  const out = new Array(range.height * range.width).fill(null);
  range.forEach((cell, i, j) => {
    out[i * range.width + j] = cell;
  });
  return out;
}

const CORREL = {
  run(args) {
    if (args.length !== 2) return error("#N/A");
    if (isError(args[0])) return args[0];
    if (isError(args[1])) return args[1];
    const [xs, ys] = args.map(cellsOf);
    if (xs.length !== ys.length) return error("#N/A");
    const pairs = [];
    for (let i = 0; i < xs.length; i++) {
      if (isError(xs[i])) return xs[i];
      if (isError(ys[i])) return ys[i];
      if (typeof xs[i] === "number" && typeof ys[i] === "number") pairs.push([xs[i], ys[i]]);
    }
    if (pairs.length < 2 || pairs.every(([x]) => x === pairs[0][0]) || pairs.every(([, y]) => y === pairs[0][1])) return error("#DIV/0!");
    const mx = sum(pairs.map(([x]) => x)) / pairs.length;
    const my = sum(pairs.map(([, y]) => y)) / pairs.length;
    const sxy = sum(pairs.map(([x, y]) => (x - mx) * (y - my)));
    const sxx = sum(pairs.map(([x]) => (x - mx) ** 2));
    const syy = sum(pairs.map(([, y]) => (y - my) ** 2));
    if (sxx === 0 || syy === 0) return error("#DIV/0!");
    return clean(sxy / Math.sqrt(sxx * syy));
  },
};

// Money over time. `type` 0 pays at the end of each period and anything else at the start.
const money = (value) => (isError(value) ? value : finite(clean(value)));
const growth = (r, n) => (1 + r) ** n;

function pmt(r, n, pv, fv, type) {
  if (n === 0) return error("#NUM!");
  if (r === 0) return -(pv + fv) / n;
  if (r === -1) return error("#DIV/0!");
  const f = growth(r, n);
  return -(r * (fv + pv * f)) / ((1 + r * (type ? 1 : 0)) * (f - 1));
}

function fv(r, n, payment, pv, type) {
  if (r === 0) return -(pv + payment * n);
  const f = growth(r, n);
  return -(pv * f + (payment * (1 + r * (type ? 1 : 0)) * (f - 1)) / r);
}

function pv(r, n, payment, future, type) {
  if (r === 0) return -(future + payment * n);
  if (r === -1) return error("#DIV/0!");
  const f = growth(r, n);
  return -(future + (payment * (1 + r * (type ? 1 : 0)) * (f - 1)) / r) / f;
}

function nper(r, payment, present, future, type) {
  if (r === 0) return payment === 0 ? error("#NUM!") : -(present + future) / payment;
  const due = payment * (1 + r * (type ? 1 : 0));
  const ratio = (due - future * r) / (due + present * r);
  if (!(ratio > 0) || r <= -1) return error("#NUM!");
  return Math.log(ratio) / Math.log(1 + r);
}

// The first sign change of f along rates from -99% up, halved until it settles: the fallback for
// long series where Newton's first step overshoots. #NUM! when f never changes sign.
const BRACKETS = [-0.99, -0.9, -0.5, -0.2, -0.05, 0, 0.001, 0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 100, 1000];
function bisect(f) {
  const points = BRACKETS.map((r) => [r, f(r)]).filter(([, y]) => Number.isFinite(y));
  for (let i = 1; i < points.length; i++) {
    let [lo, flo] = points[i - 1];
    let [hi, fhi] = points[i];
    if (flo === 0) return lo;
    if (Math.sign(flo) === Math.sign(fhi)) continue;
    for (let step = 0; step < 200 && hi - lo > 1e-15; step++) {
      const mid = (lo + hi) / 2;
      const y = f(mid);
      if (y === 0) return mid;
      if (Math.sign(y) === Math.sign(flo)) [lo, flo] = [mid, y];
      else hi = mid;
    }
    return (lo + hi) / 2;
  }
  return error("#NUM!");
}

// Newton's method from `guess`, falling back to bisect when it does not settle to 1e-10 in 100 steps.
// A root within a hair of 0 where f(0) is 0 is 0% (a 0% loan).
function solve(f, guess) {
  const found = newton(f, guess);
  const root = isError(found) ? bisect(f) : found;
  return !isError(root) && Math.abs(root) < 1e-12 && Math.abs(f(0)) < 1e-9 ? 0 : root;
}

function newton(f, guess) {
  let r = guess;
  for (let step = 0; step < 100; step++) {
    const y = f(r);
    const h = 1e-7 * Math.max(1, Math.abs(r));
    const slope = (f(r + h) - f(r - h)) / (2 * h);
    if (!Number.isFinite(y) || !Number.isFinite(slope) || slope === 0) return error("#NUM!");
    const next = r - y / slope;
    if (next <= -1) return error("#NUM!");
    if (Math.abs(next - r) < 1e-10) return next;
    r = next;
  }
  return error("#NUM!");
}

const NPV = {
  run(args) {
    if (args.length < 2) return error("#N/A");
    const head = numberArgs([args[0]], 1);
    if (isError(head)) return head;
    const [r] = head;
    if (r === -1) return error("#DIV/0!");
    let total = 0;
    let period = 0;
    const failure = eachNumber(args.slice(1), (x) => {
      period += 1;
      total += x / growth(r, period);
    });
    return failure ?? money(total);
  },
};

const IRR = {
  run(args) {
    if (args.length < 1 || args.length > 2) return error("#N/A");
    const flows = numbers([args[0]]);
    if (isError(flows)) return flows;
    const guess = numberArgs(args.slice(1), 1, [0.1]);
    if (isError(guess)) return guess;
    if (!flows.some((x) => x > 0) || !flows.some((x) => x < 0)) return error("#NUM!");
    const value = (r) => sum(flows.map((x, i) => x / growth(r, i)));
    return money(solve(value, guess[0]));
  },
};

const RATE = {
  run(args) {
    if (args.length < 3 || args.length > 6) return error("#N/A");
    const list = numberArgs(args, 6, [undefined, undefined, undefined, 0, 0, 0.1]);
    if (isError(list)) return list;
    const [n, payment, present, future, type, guess] = list;
    // expm1 keeps (1 + r)^n - 1 exact near 0%, where the plain form loses every digit.
    const balance = (r) => (r === 0 ? present + payment * n + future : present * growth(r, n) + (payment * (1 + r * (type ? 1 : 0)) * Math.expm1(n * Math.log1p(r))) / r + future);
    return money(solve(balance, guess));
  },
};

const finance = (count, body, defaults) => {
  const spec = fixed(count, body, defaults);
  return { run: (args) => money(spec.run(args)) };
};

export const PACK = [
  ["STDEV", spread(true, true)],
  ["STDEV.S", spread(true, true)],
  ["STDEVP", spread(false, true)],
  ["STDEV.P", spread(false, true)],
  ["VAR", spread(true, false)],
  ["VAR.S", spread(true, false)],
  ["VARP", spread(false, false)],
  ["VAR.P", spread(false, false)],
  ["MODE", MODE],
  ["MODE.SNGL", MODE],
  ["LARGE", nth(true)],
  ["SMALL", nth(false)],
  ["PERCENTILE", { run: (args) => { const got = listAnd(args, 1); return isError(got) ? got : percentile(got[0], got[1]); } }],
  ["PERCENTILE.INC", { run: (args) => { const got = listAnd(args, 1); return isError(got) ? got : percentile(got[0], got[1]); } }],
  ["QUARTILE", { run: (args) => { const got = listAnd(args, 1); if (isError(got)) return got; const q = Math.trunc(got[1]); return q < 0 || q > 4 ? error("#NUM!") : percentile(got[0], q / 4); } }],
  ["QUARTILE.INC", { run: (args) => { const got = listAnd(args, 1); if (isError(got)) return got; const q = Math.trunc(got[1]); return q < 0 || q > 4 ? error("#NUM!") : percentile(got[0], q / 4); } }],
  ["RANK", RANK],
  ["RANK.EQ", RANK],
  ["CORREL", CORREL],
  ["PMT", finance(5, pmt, [undefined, undefined, undefined, 0, 0])],
  ["FV", finance(5, fv, [undefined, undefined, undefined, 0, 0])],
  ["PV", finance(5, pv, [undefined, undefined, undefined, 0, 0])],
  ["NPER", finance(5, nper, [undefined, undefined, undefined, 0, 0])],
  ["NPV", NPV],
  ["IRR", IRR],
  ["RATE", RATE],
];
