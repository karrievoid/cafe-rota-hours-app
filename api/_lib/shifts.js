// shifts.js — parse a rota cell into hours, apply the unpaid-break rule.
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

  // Pull every time-like token in order. Handles "6.45-8B, -15.00 F&G" -> [6.45,8,15.00]
  const tokens = text.match(/\d{1,2}(?:\.\d{1,2})?/g) || [];
  if (tokens.length < 2) return { status: 'unparsed', raw: text };

  const mins = tokens.map(tokenToMinutes);
  const startMin = mins[0];
  const endMin = mins[mins.length - 1];
  const spanMinutes = endMin - startMin; // continuous block (role-change splits are contiguous)
  if (spanMinutes <= 0) return { status: 'unparsed', raw: text };

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
export function paidMinutesFromSpan(spanMinutes) {
  const overThreshold = spanMinutes > BREAK_THRESHOLD_HOURS * 60;
  return overThreshold ? spanMinutes - BREAK_MINUTES : spanMinutes;
}

export function minutesToHours(mins) {
  return Math.round((mins / 60) * 100) / 100;
}
