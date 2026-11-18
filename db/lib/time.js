// All stored timestamps are UTC. Anything the user sees or groups by is Asia/Kolkata.
// IST is a fixed UTC+05:30 with no daylight saving, so plain arithmetic is exact.
import { validationError } from './errors.js';

export const IST_TZ = 'Asia/Kolkata';
export const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Calendar parts of an instant as seen in IST. weekday: 0=Sunday. */
export function istParts(date) {
  const d = new Date(new Date(date).getTime() + IST_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(),
  };
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
export const ymd = (y, m, d) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

/** 'YYYY-MM-DD' of an instant, in IST. */
export function istDateString(date) {
  const p = istParts(date);
  return ymd(p.year, p.month, p.day);
}

/** Parse 'YYYY-MM-DD' (must be a real calendar date). Returns {y,m,d} or null. */
export function parseYmd(str) {
  if (typeof str !== 'string') return null;
  const m = YMD_RE.exec(str);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

export function assertYmd(str, field = 'date') {
  const p = parseYmd(str);
  if (!p) throw validationError(`${field} must be a real date in YYYY-MM-DD format`, { field, value: str });
  return p;
}

/** The UTC instant at which the given IST calendar day starts. */
export function istMidnightUtc(ymdStr) {
  const { y, m, d } = assertYmd(ymdStr);
  return new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MS);
}

export function addDaysYmd(ymdStr, n) {
  const { y, m, d } = assertYmd(ymdStr);
  return istDateString(new Date(Date.UTC(y, m - 1, d) + n * DAY_MS - IST_OFFSET_MS));
}

/**
 * from/to are inclusive IST calendar days. Returns a half-open UTC range:
 * { start: Date|null, endExclusive: Date|null }.
 */
export function dateRangeUtc({ from, to } = {}) {
  const start = from ? istMidnightUtc(from) : null;
  const endExclusive = to ? istMidnightUtc(addDaysYmd(to, 1)) : null;
  if (start && endExclusive && start >= endExclusive) {
    throw validationError('from must not be after to', { from, to });
  }
  return { start, endExclusive };
}

/** First day of the report bucket (IST) that contains `date`. Weeks start on Monday. */
export function bucketStartYmd(date, bucket) {
  const p = istParts(date);
  if (bucket === 'day') return ymd(p.year, p.month, p.day);
  if (bucket === 'month') return ymd(p.year, p.month, 1);
  if (bucket === 'week') {
    const sinceMonday = (p.weekday + 6) % 7;
    return addDaysYmd(ymd(p.year, p.month, p.day), -sinceMonday);
  }
  throw validationError("bucket must be one of 'day', 'week', 'month'", { field: 'bucket', value: bucket });
}

/** Next bucket start after a bucket start (both 'YYYY-MM-DD'). */
export function nextBucketYmd(bucketYmd, bucket) {
  const { y, m } = assertYmd(bucketYmd);
  if (bucket === 'day') return addDaysYmd(bucketYmd, 1);
  if (bucket === 'week') return addDaysYmd(bucketYmd, 7);
  if (bucket === 'month') return m === 12 ? ymd(y + 1, 1, 1) : ymd(y, m + 1, 1);
  throw validationError("bucket must be one of 'day', 'week', 'month'", { field: 'bucket', value: bucket });
}
