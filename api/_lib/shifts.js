// shifts.js - parse a rota cell into hours, apply the unpaid-break rule.
// Ported from a logic prototype validated against real rota PDFs.
//
// Rules implemented:
//  - Times are written HH.MM (European style): 6.45 = 06:45, NOT 6.75 hours.
//  - A cell may be a single shift ("7.30-17.00 Barista") or a split/role-change
//    shift ("6.45-8B, -15.00 F&G") which is one continuous block 06:45 -> 15:00.
//  - Any shift STRICTLY longer than 6h loses a 20-minute unpaid break.
//    Exactly 6h keeps all 6h (the "6h not included" rule).
//  - "OFF" = day off (0h). "OFF (L)" = payable leave: 0h by default but the
//    manager can set leave hours, and NO break is deducted from leave.

export const BREAK_MINUTES = 20;
export const BREAK_THRESHOLD_HOURS = 6; // strictly greater than this loses a break

// Convert an HH.MM token to minutes-since-midnight. "6.45" -> 405, "12" -> 720.
export function tokenToMinutes(tok) {
  if (tok.includes('.')) {
    const [h, m] = tok.split('.');
    return parseInt(h, 10) * 60 + parseInt(m.padEnd(2, '0').slice(0, 2), 10);
  }
  return parseInt(tok, 10) * 60;
}

export function minutesToHHMM(mins) {
  if (mins == null) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

// Classify + parse a raw cell string.
// Returns one of:
//   { status: 'off' }
//   { status: 'leave', raw }
//   { status: 'work', startMin, endMin, spanMinutes, paidMinutes, raw }
//   { status: 'unparsed', raw }   -> needs manual attention
export function parseCell(raw) {
  const text = (raw || '').trim();
  if (text === '') return { status: 'off', raw: '' };

  const upper = text.toUpperCase();
  if (upper.startsWith('OFF')) {
    if (upper.includes('(L)')) return { status: 'leave', raw: text };
    return { status: 'off', raw: text };
  }

  // Mistyped time: a decimal time glued to a letter, e.g. "17.0l". Matches a
  // single minute-digit followed by a letter, which never happens in the real
  // notation - legitimate forms are two-digit minutes ("15.00F&G") or the whole-
  // hour break marker ("8B", "9.30B"), neither of which match here. We refuse to
  // guess and flag it for the manager instead of silently reading 17:00.
  if (/\d{1,2}\.\d(?=[A-Za-z])/.test(text)) {
    return { status: 'unparsed', raw: text, reason: 'looks like a mistyped time' };
  }

  // Pull every time-like token in order. Handles "6.45-8B, -15.00 F&G" -> [6.45,8,15.00]
  const tokens = text.match(/\d{1,2}(?:\.\d{1,2})?/g) || [];
  if (tokens.length < 2) return { status: 'unparsed', raw: text, reason: 'could not find a start and end time' };

  // Times are HH.MM, so the minutes part must be a real minute value.
  for (const tk of tokens) {
    if (tk.includes('.')) {
      const mm = parseInt(tk.split('.')[1].padEnd(2, '0').slice(0, 2), 10);
      if (mm > 59) return { status: 'unparsed', raw: text, reason: 'minutes over 59' };
    }
  }

  const mins = tokens.map(tokenToMinutes);
  const startMin = mins[0];
  const endMin = mins[mins.length - 1];
  const spanMinutes = endMin - startMin; // continuous block (role-change splits are contiguous)
  if (spanMinutes <= 0) return { status: 'unparsed', raw: text, reason: 'end time is not after the start time' };

  return {
    status: 'work',
    startMin,
    endMin,
    spanMinutes,
    paidMinutes: paidMinutesFromSpan(spanMinutes),
    raw: text,
  };
}

// Given a worked span in minutes, return paid minutes after the break rule.
export function paidMinutesFromSpan(spanMinutes, noBreak = false) {
  if (noBreak) return spanMinutes; // break waived (e.g. too busy to take it)
  const overThreshold = spanMinutes > BREAK_THRESHOLD_HOURS * 60;
  return overThreshold ? spanMinutes - BREAK_MINUTES : spanMinutes;
}

export function minutesToHours(mins) {
  return Math.round((mins / 60) * 100) / 100;
}