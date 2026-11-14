// Serial day numbers for the grid engine: day 0 is 1899-12-30 and day 2 is 1900-01-01 on the
// proleptic Gregorian calendar, in integer civil arithmetic only. Pure: no clock, no locale,
// no page.

export const MAX_SERIAL = 2958465;

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const leap = (y) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);

const monthDays = (y, m) => (m === 2 && leap(y) ? 29 : MONTH_DAYS[m - 1]);

function daysFromCivil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe;
}

const EPOCH = daysFromCivil(1899, 12, 30);

function civilFromDays(z) {
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

// true when y, m, d name a real day between 1899-12-30 and 9999-12-31; all three must be integers
export function isDate(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12 || d < 1 || d > monthDays(y, m)) return false;
  const n = daysFromCivil(y, m, d) - EPOCH;
  return n >= 0 && n <= MAX_SERIAL;
}

// the serial day of a real date, or null when isDate(y, m, d) is false
export function serial(y, m, d) {
  return isDate(y, m, d) ? daysFromCivil(y, m, d) - EPOCH : null;
}

// { y, m, d } for an integer serial from 0 to MAX_SERIAL, otherwise null
export function civil(n) {
  if (!Number.isInteger(n) || n < 0 || n > MAX_SERIAL) return null;
  return civilFromDays(n + EPOCH);
}

// the fraction of a day for h, m, s (integers, 0 <= h < 24, 0 <= m < 60, 0 <= s < 60), otherwise null
export function fraction(h, m, s) {
  if (!Number.isInteger(h) || !Number.isInteger(m) || !Number.isInteger(s)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s > 59) return null;
  return (h * 3600 + m * 60 + s) / 86400;
}

// split a finite number into { day, h, m, s }: day = Math.floor(value); the remaining fraction is
// rounded to the nearest whole second, and 86400 seconds carries into the next day as 0:00:00.
// Not finite gives null.
export function clock(value) {
  if (!Number.isFinite(value)) return null;
  const day = Math.floor(value);
  const secs = Math.round((value - day) * 86400);
  const carry = Math.floor(secs / 86400);
  const rest = secs - carry * 86400;
  return { day: day + carry, h: Math.floor(rest / 3600), m: Math.floor((rest % 3600) / 60), s: rest % 60 };
}
