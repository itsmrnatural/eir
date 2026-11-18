// All timestamps arrive as UTC ISO strings. Display and grouping use Asia/Kolkata.
export const TZ = 'Asia/Kolkata';

const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
});
const dateFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true });
const ymdFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

const toDate = (v) => (v instanceof Date ? v : new Date(v));
const valid = (v) => v != null && v !== '' && !Number.isNaN(toDate(v).getTime());

export const formatDateTime = (v) => (valid(v) ? dateTimeFmt.format(toDate(v)) : '—');
export const formatDate = (v) => (valid(v) ? dateFmt.format(toDate(v)) : '—');
export const formatTime = (v) => (valid(v) ? timeFmt.format(toDate(v)) : '—');

/** YYYY-MM-DD of an instant, as seen in Asia/Kolkata. */
export function ymdIST(v = new Date()) {
  const parts = Object.fromEntries(ymdFmt.formatToParts(toDate(v)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export const todayIST = () => ymdIST(new Date());

/** Pure calendar arithmetic on YYYY-MM-DD strings. */
export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export const startOfMonth = (ymd) => `${ymd.slice(0, 8)}01`;

export const isValidYMD = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** Returns a message if the (optional) range is unusable, else null. */
export function rangeError(from, to) {
  if (from && !isValidYMD(from)) return 'The start date is not valid.';
  if (to && !isValidYMD(to)) return 'The end date is not valid.';
  if (from && to && from > to) return 'The start date must be on or before the end date.';
  return null;
}
