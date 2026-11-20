// Date/time helpers. Clinic times are "floating" local times (no UTC offset):
//   date     = "YYYY-MM-DD"
//   datetime = "YYYY-MM-DDTHH:MM"   (clinic local time)
// Comparisons use minutes since 1970-01-01 of that floating time, so DST never affects overlap maths.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?$/;
const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const pad = (n) => String(n).padStart(2, '0');

/** Returns true if "YYYY-MM-DD" is a real calendar date. */
export function isValidDate(date) {
  const m = DATE_RE.exec(String(date ?? '').trim());
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** "HH:MM" -> minutes since midnight. */
export function hmToMinutes(hm) {
  const [h, m] = String(hm).split(':').map(Number);
  return h * 60 + m;
}

/** minutes since midnight -> "HH:MM". */
export function minutesToHm(total) {
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** Parses "YYYY-MM-DDTHH:MM" (a space instead of T and trailing seconds are tolerated). */
export function parseDateTime(value) {
  const m = DATETIME_RE.exec(String(value ?? '').trim());
  if (!m || !isValidDate(m[1])) return null;
  const hour = Number(m[2]);
  const minute = Number(m[3]);
  if (hour > 23 || minute > 59) return null;
  return { date: m[1], time: `${pad(hour)}:${pad(minute)}` };
}

/** (date, "HH:MM") -> absolute floating minutes. */
export function toAbsMinutes(date, hm) {
  const [y, mo, d] = date.split('-').map(Number);
  return Date.UTC(y, mo - 1, d) / 60000 + hmToMinutes(hm);
}

/** absolute floating minutes -> "YYYY-MM-DDTHH:MM". */
export function fromAbsMinutes(abs) {
  const dt = new Date(abs * 60000);
  return (
    `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}` +
    `T${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}`
  );
}

/** "monday", "tuesday", ... for a "YYYY-MM-DD" date. */
export function dayKey(date) {
  const [y, mo, d] = date.split('-').map(Number);
  return DAY_KEYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
}

export function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Current clinic-local time: { date, time, weekday }. */
export function localNow(timezone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'long',
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
    weekday: get('weekday'),
  };
}
