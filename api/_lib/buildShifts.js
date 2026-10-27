// buildShifts.js - turn parsed weeks (from the Python /api/parse endpoint) into
// dated shift records. We DO NOT trim here: every parsed day is resolved to its
// true calendar date and stored. The "bracket" (start_date / end_date on the
// period) is applied as a filter when reading/totalling, so the boss can change
// the bracket or upload more PDFs later without losing anything.
//
// How dates are worked out (the important bit): the month heading printed on a
// rota is only a hint - it can be misspelled ("Sepetmber") or label a week by
// the month it mostly belongs to even though it starts in the previous month.
// So we anchor each week to the real calendar using the day-number sequence.
// Because day numbers reset at month ends (... 30, 1 ...), a run of 7 consecutive
// dates is pinned down uniquely, and the hint only vetoes an otherwise-ambiguous
// placement. This fixes days around a month boundary being dropped or misdated.
import { parseCell } from './shifts.js';

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function monthNumFromName(name) {
  return MONTHS.findIndex((m) => m.toLowerCase() === String(name).toLowerCase()) + 1; // 1-12, 0 if not found
}

function pad(n) { return String(n).padStart(2, '0'); }
function iso(y, mIndex, d) { return `${y}-${pad(mIndex + 1)}-${pad(d)}`; }
function daysBetween(a, b) { return Math.round((Date.parse(a) - Date.parse(b)) / 86400000); }

// Kept for backwards compatibility (older callers). Maps a (monthName, day) to a
// full ISO date, choosing the year so the date sits closest to the bracket.
export function resolveDate(monthName, day, startISO, endISO) {
  const mIndex = MONTHS.findIndex((m) => m.toLowerCase() === String(monthName).toLowerCase());
  if (mIndex === -1 || !day) return null;
  const startY = parseInt(startISO.slice(0, 4), 10);
  const endY = parseInt(endISO.slice(0, 4), 10);
  const years = new Set([startY - 1, startY, endY, endY + 1]);
  let best = null;
  let bestDist = Infinity;
  for (const y of years) {
    const cand = iso(y, mIndex, day);
    let dist = 0;
    if (cand < startISO) dist = -daysBetween(cand, startISO);
    else if (cand > endISO) dist = daysBetween(cand, endISO);
    if (dist < bestDist) { bestDist = dist; best = cand; }
  }
  return best;
}

// Resolve a whole week's 7 columns to real ISO dates.
//  seq         - day numbers (null for a column with no readable number)
//  hintName    - the month heading read off the rota (may be null)
//  startISO/endISO - the period bracket, used to pick the year and, when the
//                    week is ambiguous, the closest placement.
// Returns an array of 7 ISO strings (null for numberless columns), or null if
// the week cannot be placed sensibly.
export function resolveWeekDates(seq, hintName, startISO, endISO) {
  const hintIdx = MONTHS.findIndex((m) => m.toLowerCase() === String(hintName || '').toLowerCase());
  const startY = parseInt(startISO.slice(0, 4), 10);
  const endY = parseInt(endISO.slice(0, 4), 10);
  const years = [...new Set([startY - 1, startY, endY, endY + 1])];
  const dayMs = 86400000;
  const mid = (Date.parse(startISO) + Date.parse(endISO)) / 2;
  let best = null; // { dist, dates }

  for (const Y of years) {
    // Scan a window: if we have a hint month, scan a month either side of it;
    // otherwise scan the whole year. We look for a start date whose following 7
    // day-numbers match the sequence.
    const from = Date.UTC(Y, (hintIdx >= 0 ? hintIdx : 0) - 1, 1);
    const to = Date.UTC(Y, (hintIdx >= 0 ? hintIdx : 11) + 2, 0);
    for (let t = from; t <= to; t += dayMs) {
      const dates = [];
      let ok = true;
      let hasHint = false;
      let anchorMs = null;
      for (let i = 0; i < 7; i++) {
        const dt = new Date(t + i * dayMs);
        const y = dt.getUTCFullYear();
        const m = dt.getUTCMonth();
        const d = dt.getUTCDate();
        if (seq[i] != null && seq[i] !== d) { ok = false; break; }
        dates.push(seq[i] == null ? null : iso(y, m, d));
        if (hintIdx >= 0 && m === hintIdx) hasHint = true;
        if (anchorMs == null && seq[i] != null) anchorMs = t + i * dayMs;
      }
      if (!ok || anchorMs == null) continue;
      if (hintIdx >= 0 && !hasHint) continue; // hint must appear in the placement
      const dist = Math.abs(anchorMs - mid);
      if (!best || dist < best.dist) best = { dist, dates };
    }
  }
  return best ? best.dates : null;
}

// Place a single week on the real calendar nearest to a reference date (today),
// used when STORING a week so it gets a correct date range / label independent of
// any pay period. Returns { start, end } ISO strings, or null.
export function resolveWeekAbsolute(seq, hintName, refISO) {
  const ref = refISO || new Date().toISOString().slice(0, 10);
  const refMs = Date.parse(ref);
  const startISO = new Date(refMs - 200 * 86400000).toISOString().slice(0, 10);
  const endISO = new Date(refMs + 200 * 86400000).toISOString().slice(0, 10);
  const dates = resolveWeekDates(seq, hintName, startISO, endISO);
  if (!dates) return null;
  const nn = dates.filter(Boolean);
  if (!nn.length) return null;
  return { start: nn[0], end: nn[nn.length - 1] };
}

// Build shift records for every parsed day (no trimming). Deduped by person+date.
// Each record carries personSeq (the order the person appears on the rota) so
// the UI can show people in rota order as well as alphabetically.
export function buildAllRecords(weeks, startISO, endISO) {
  const records = [];
  const seen = new Set();
  const seqByPerson = new Map();
  for (const week of weeks) {
    const seq = (week.days || []).map((x) => (x && x.day != null ? x.day : null));
    // Support both the new parser (monthHint) and any older cached week (per-day month).
    const hintName = week.monthHint
      || (week.days || []).map((d) => d && d.month).find(Boolean)
      || null;
    const dates = resolveWeekDates(seq, hintName, startISO, endISO);
    if (!dates) continue;
    for (const person of week.people) {
      if (!seqByPerson.has(person.personKey)) seqByPerson.set(person.personKey, seqByPerson.size);
      const personSeq = (typeof person.seq === 'number') ? person.seq : seqByPerson.get(person.personKey);
      for (let i = 0; i < 7; i++) {
        const dateStr = dates[i];
        if (!dateStr) continue;
        const dedupeKey = `${person.personKey}|${dateStr}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        const raw = person.days[i] || '';
        const parsed = parseCell(raw);
        records.push({
          personKey: person.personKey,
          personName: person.name,
          personSeq,
          workDate: dateStr,
          rawText: raw,
          status: parsed.status,
          startMin: parsed.startMin ?? null,
          endMin: parsed.endMin ?? null,
          paidMinutes: parsed.status === 'work' ? parsed.paidMinutes : 0,
        });
      }
    }
  }
  records.sort((a, b) =>
    (a.personSeq - b.personSeq) || a.personKey.localeCompare(b.personKey) || a.workDate.localeCompare(b.workDate));
  return records;
}

// Default bracket for a calendar month: 1st to last day.
export function monthBracket(year, monthNum) {
  const start = `${year}-${pad(monthNum)}-01`;
  const lastDay = new Date(year, monthNum, 0).getDate(); // day 0 of next month = last of this
  const end = `${year}-${pad(monthNum)}-${pad(lastDay)}`;
  return { start, end };
}