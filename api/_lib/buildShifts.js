// buildShifts.js - turn parsed weeks (from the Python /api/parse endpoint) into
// dated shift records. Unlike before, we DO NOT trim here: every parsed day is
// resolved to its true calendar date and stored. The "bracket" (a start_date /
// end_date on the period) is applied as a filter when reading/totalling, so the
// boss can change the bracket or upload more PDFs later without losing anything.
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

// Map a parsed (monthName, day) to a full ISO date, choosing the year so the
// date sits closest to the bracket. Handles periods that cross a year boundary
// (e.g. a Dec->Jan pay period).
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
    // distance to the [start,end] interval (0 if inside)
    let dist = 0;
    if (cand < startISO) dist = -daysBetween(cand, startISO);
    else if (cand > endISO) dist = daysBetween(cand, endISO);
    if (dist < bestDist) { bestDist = dist; best = cand; }
  }
  return best;
}

// Build shift records for every parsed day (no trimming). Deduped by person+date.
export function buildAllRecords(weeks, startISO, endISO) {
  const records = [];
  const seen = new Set();
  for (const week of weeks) {
    for (const person of week.people) {
      for (let i = 0; i < 7; i++) {
        const dayInfo = week.days[i];
        if (!dayInfo || dayInfo.day == null || !dayInfo.month) continue;
        const dateStr = resolveDate(dayInfo.month, dayInfo.day, startISO, endISO);
        if (!dateStr) continue;
        const dedupeKey = `${person.personKey}|${dateStr}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        const raw = person.days[i] || '';
        const parsed = parseCell(raw);
        records.push({
          personKey: person.personKey,
          personName: person.name,
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
  records.sort((a, b) => a.personKey.localeCompare(b.personKey) || a.workDate.localeCompare(b.workDate));
  return records;
}

// Default bracket for a calendar month: 1st to last day.
export function monthBracket(year, monthNum) {
  const start = `${year}-${pad(monthNum)}-01`;
  const lastDay = new Date(year, monthNum, 0).getDate(); // day 0 of next month = last of this
  const end = `${year}-${pad(monthNum)}-${pad(lastDay)}`;
  return { start, end };
}