// util.js - small client-side helpers for time display/parsing.
export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// minutes-from-midnight -> "HH:MM" for <input type=time>
export function minToTime(min) {
  if (min == null) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// "HH:MM" -> minutes-from-midnight
export function timeToMin(str) {
  if (!str) return null;
  const [h, m] = str.split(':').map((n) => parseInt(n, 10));
  if (Number.isNaN(h)) return null;
  return h * 60 + (m || 0);
}

export function minToHours(min) {
  return Math.round(((min || 0) / 60) * 100) / 100;
}

// "2026-06-14" -> "Sat 14 Jun"
// Build the Date from explicit Y/M/D numbers (local time) so the weekday/label
// never drifts by a day due to UTC parsing of the ISO string.
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map((n) => parseInt(n, 10));
  const date = new Date(y, m - 1, d); // local time, no timezone shift
  return `${SHORT_DAYS[date.getDay()]} ${d} ${SHORT_MONTHS[m - 1]}`;
}

export function hoursLabel(hours) {
  return `${hours.toFixed(2)} h`;
}

// ISO 'YYYY-MM-DD' for a Date, in local time.
export function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Default bracket = the current calendar month (1st .. last day).
export function defaultBracket() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start: isoDate(start), end: isoDate(end) };
}

// "2026-06-01" -> "1 Jun 2026"
export function fmtDateFull(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map((n) => parseInt(n, 10));
  const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d} ${MO[m - 1]} ${y}`;
}

// Local mirror of the server break rule, so totals update live before saving.
export const BREAK_MIN = 20;
export const BREAK_THRESHOLD_MIN = 6 * 60; // strictly over 6h loses the break
export function localPaidMinutes(status, startMin, endMin, leaveMinutes, noBreak) {
  if (status === 'leave') return Math.max(0, leaveMinutes || 0);
  if (status !== 'work') return 0;
  if (startMin == null || endMin == null) return 0;
  const span = endMin - startMin;
  if (span <= 0) return 0;
  if (noBreak) return span; // break waived
  return span > BREAK_THRESHOLD_MIN ? span - BREAK_MIN : span;
}

// Does this shift qualify for a break (strictly over 6h)?
export function isOver6h(startMin, endMin) {
  return startMin != null && endMin != null && (endMin - startMin) > BREAK_THRESHOLD_MIN;
}