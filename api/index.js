// api/index.js - Express app, exported as a Vercel serverless function.
// All routes are mounted under /api (see vercel.json rewrite).
import express from 'express';
import cors from 'cors';

import { query, ensureSchema } from './_lib/db.js';
import { signToken, requireAuth, hasManager, registerManager, loginManager, checkStaffPin, getStaffPin, setStaffPin, setSecurity, getSecurity, getSecurityQuestion, resetWithSecurity } from './_lib/auth.js';
import { buildAllRecords, monthNumFromName, monthBracket, MONTHS } from './_lib/buildShifts.js';
import { paidMinutesFromSpan } from './_lib/shifts.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use(async (req, res, next) => {
  try { await ensureSchema(); next(); }
  catch (e) { next(e); }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---- Auth ----
app.get('/api/auth/status', async (req, res, next) => {
  try { res.json({ hasAccount: await hasManager() }); } catch (e) { next(e); }
});
app.post('/api/auth/register', async (req, res, next) => {
  try { await registerManager(req.body?.email, req.body?.password); res.status(201).json({ token: signToken() }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/auth/login', async (req, res, next) => {
  try { await loginManager(req.body?.email, req.body?.password); res.json({ token: signToken() }); }
  catch (e) { res.status(401).json({ error: e.message }); }
});

// Dev-only quick login (set ALLOW_DEV_LOGIN=true locally). Never enable in prod.
app.post('/api/auth/dev-login', (req, res) => {
  if (process.env.ALLOW_DEV_LOGIN !== 'true') return res.status(403).json({ error: 'Disabled' });
  res.json({ token: signToken() });
});

// Recovery question (email-free reset).
app.get('/api/settings/security', requireAuth, async (req, res, next) => {
  try { res.json(await getSecurity()); } catch (e) { next(e); }
});
app.put('/api/settings/security', requireAuth, async (req, res, next) => {
  try { await setSecurity(req.body?.question, req.body?.answer); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/auth/security-question', async (req, res, next) => {
  try { res.json({ question: await getSecurityQuestion(req.query.email) }); } catch (e) { next(e); }
});
app.post('/api/auth/security-reset', async (req, res, next) => {
  try { await resetWithSecurity(req.body?.email, req.body?.answer, req.body?.password); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// Manager: view / change the staff PIN used by the request page.
app.get('/api/settings/staff-pin', requireAuth, async (req, res, next) => {
  try { res.json({ pin: await getStaffPin() }); } catch (e) { next(e); }
});
app.put('/api/settings/staff-pin', requireAuth, async (req, res, next) => {
  try {
    const pin = String(req.body?.pin || '').trim();
    if (pin.length < 3) return res.status(400).json({ error: 'PIN must be at least 3 characters' });
    await setStaffPin(pin);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Manager: people in the table (for the accept picker; disambiguates two Loises).
app.get('/api/people', requireAuth, async (req, res, next) => {
  try {
    const r = await query(`
      SELECT person_key,
             COALESCE(person_label, person_name) AS name,
             mode() WITHIN GROUP (ORDER BY (start_min || '-' || end_min))
               FILTER (WHERE status='work' AND start_min IS NOT NULL) AS common
        FROM shifts GROUP BY person_key, COALESCE(person_label, person_name)
        ORDER BY name`);
    res.json(r.rows.map((x) => ({ personKey: x.person_key, name: x.name, hint: hintFromCommon(x.common) })));
  } catch (e) { next(e); }
});
function hintFromCommon(c) {
  if (!c) return '';
  const [a, b] = String(c).split('-');
  const f = (m) => { const n = parseInt(m, 10); return Number.isNaN(n) ? '' : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };
  const s2 = f(a); const e2 = f(b);
  return (s2 && e2) ? `${s2}-${e2}` : '';
}

// ---- Helpers ----
function dstr(v) { return v instanceof Date ? v.toISOString().slice(0, 10) : v; }

function hhmm(m) { if (m == null) return ''; return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; }
function describeShift(status, startMin, endMin, paidMinutes) {
  const h = Math.round((paidMinutes || 0) / 60 * 100) / 100;
  if (status === 'work') return `${hhmm(startMin)}-${hhmm(endMin)} (${h}h)`;
  if (status === 'leave') return `Leave ${h}h`;
  if (status === 'unparsed') return 'needs check';
  return 'Off';
}

function monthObj(r) {
  return {
    id: r.id, label: r.label, month: r.month_num, year: r.year_num,
    startDate: dstr(r.start_date), endDate: dstr(r.end_date),
  };
}

function rowToShift(r) {
  return {
    id: r.id, monthId: r.month_id, personKey: r.person_key, personName: r.person_name,
    personLabel: r.person_label, workDate: dstr(r.work_date), rawText: r.raw_text,
    status: r.status, startMin: r.start_min, endMin: r.end_min,
    paidMinutes: r.paid_minutes, overridden: r.overridden, noBreak: r.no_break,
  };
}

function buildSummary(shifts) {
  const map = new Map();
  for (const s of shifts) {
    if (!map.has(s.personKey)) {
      map.set(s.personKey, {
        personKey: s.personKey, personName: s.personName, personLabel: s.personLabel,
        paidMinutes: 0, workDays: 0, leaveDays: 0, unparsed: 0,
      });
    }
    const agg = map.get(s.personKey);
    if (s.personLabel && !agg.personLabel) agg.personLabel = s.personLabel;
    agg.paidMinutes += s.paidMinutes || 0;
    if (s.status === 'work') agg.workDays += 1;
    if (s.status === 'leave') agg.leaveDays += 1;
    if (s.status === 'unparsed') agg.unparsed += 1;
  }
  return [...map.values()]
    .map((a) => ({ ...a, hours: Math.round((a.paidMinutes / 60) * 100) / 100 }))
    .sort((a, b) => (a.personLabel || a.personName).localeCompare(b.personLabel || b.personName));
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

// Insert records, skipping (person, date) pairs already present. Copies an
// existing display label onto new rows for the same person so names stay consistent.
async function insertRecords(monthId, records) {
  const existing = await query(
    `SELECT person_key, work_date, person_label FROM shifts WHERE month_id=$1`, [monthId]);
  const seen = new Set();
  const labelByPerson = {};
  for (const r of existing.rows) {
    seen.add(`${r.person_key}|${dstr(r.work_date)}`);
    if (r.person_label && !labelByPerson[r.person_key]) labelByPerson[r.person_key] = r.person_label;
  }
  let added = 0;
  for (const r of records) {
    const k = `${r.personKey}|${r.workDate}`;
    if (seen.has(k)) continue;
    seen.add(k);
    await query(
      `INSERT INTO shifts
         (month_id, person_key, person_name, person_label, work_date, raw_text, status, start_min, end_min, paid_minutes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [monthId, r.personKey, r.personName, labelByPerson[r.personKey] || null, r.workDate,
       r.rawText, r.status, r.startMin, r.endMin, r.paidMinutes]);
    added += 1;
  }
  return added;
}

// ---- Periods (a.k.a. months) ----

app.get('/api/months', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT m.*, COALESCE(s.cnt,0) AS shift_count
         FROM rota_months m
         LEFT JOIN (SELECT month_id, COUNT(*) cnt FROM shifts GROUP BY month_id) s ON s.month_id = m.id
        ORDER BY m.start_date DESC NULLS LAST, m.id DESC`);
    res.json(rows.map((r) => ({ ...monthObj(r), shiftCount: Number(r.shift_count), createdAt: r.created_at })));
  } catch (e) { next(e); }
});

// Create a period from parsed weeks + a bracket (start/end dates). If only a
// month name + year are given, the bracket defaults to that whole calendar month.
app.post('/api/months', requireAuth, async (req, res, next) => {
  try {
    let { weeks, startDate, endDate, label, month, year } = req.body;
    if (!Array.isArray(weeks) || weeks.length === 0) {
      return res.status(400).json({ error: 'No parsed rota data received' });
    }
    if (!startDate || !endDate) {
      const mn = monthNumFromName(month);
      const yr = parseInt(year, 10);
      if (!mn || !yr) return res.status(400).json({ error: 'Provide start/end dates, or a month and year' });
      const b = monthBracket(yr, mn);
      startDate = b.start; endDate = b.end;
    }
    if (!ISO_RE.test(startDate) || !ISO_RE.test(endDate) || startDate > endDate) {
      return res.status(400).json({ error: 'Invalid bracket dates' });
    }
    const sY = parseInt(startDate.slice(0, 4), 10);
    const sM = parseInt(startDate.slice(5, 7), 10);
    const lbl = (label && label.trim()) || `${MONTHS[sM - 1]} ${sY}`;

    const monthRes = await query(
      `INSERT INTO rota_months (label, month_num, year_num, start_date, end_date)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`, [lbl, sM, sY, startDate, endDate]);
    const month0 = monthRes.rows[0];

    const records = buildAllRecords(weeks, startDate, endDate);
    const added = await insertRecords(month0.id, records);
    res.status(201).json({ ...monthObj(month0), added });
  } catch (e) { next(e); }
});

// One period: bracket-filtered shifts + summary (+ how many stored days fall
// outside the current bracket, as a hint).
app.get('/api/months/:id', requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const m = await query(`SELECT * FROM rota_months WHERE id=$1`, [id]);
    if (!m.rows.length) return res.status(404).json({ error: 'Period not found' });
    const row = m.rows[0];
    const inBracket = await query(
      `SELECT * FROM shifts WHERE month_id=$1 AND work_date BETWEEN $2 AND $3
        ORDER BY person_key, work_date`, [id, dstr(row.start_date), dstr(row.end_date)]);
    const total = await query(`SELECT COUNT(*)::int AS c FROM shifts WHERE month_id=$1`, [id]);
    const shifts = inBracket.rows.map(rowToShift);
    res.json({
      month: monthObj(row),
      shifts,
      summary: buildSummary(shifts),
      outsideBracket: total.rows[0].c - shifts.length,
    });
  } catch (e) { next(e); }
});

// Edit the bracket and/or label.
app.patch('/api/months/:id', requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const cur = await query(`SELECT * FROM rota_months WHERE id=$1`, [id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Period not found' });
    const row = cur.rows[0];
    const startDate = req.body.startDate ?? dstr(row.start_date);
    const endDate = req.body.endDate ?? dstr(row.end_date);
    const label = req.body.label ?? row.label;
    if (!ISO_RE.test(startDate) || !ISO_RE.test(endDate) || startDate > endDate) {
      return res.status(400).json({ error: 'Invalid bracket dates' });
    }
    const upd = await query(
      `UPDATE rota_months SET start_date=$1, end_date=$2, label=$3 WHERE id=$4 RETURNING *`,
      [startDate, endDate, label, id]);
    res.json(monthObj(upd.rows[0]));
  } catch (e) { next(e); }
});

// Append more parsed rotas to an existing period (dedup by person+date).
app.post('/api/months/:id/rotas', requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const weeks = req.body.weeks;
    if (!Array.isArray(weeks) || weeks.length === 0) {
      return res.status(400).json({ error: 'No parsed rota data received' });
    }
    const m = await query(`SELECT * FROM rota_months WHERE id=$1`, [id]);
    if (!m.rows.length) return res.status(404).json({ error: 'Period not found' });
    const row = m.rows[0];
    const records = buildAllRecords(weeks, dstr(row.start_date), dstr(row.end_date));
    const added = await insertRecords(id, records);
    res.json({ added });
  } catch (e) { next(e); }
});

// Revert to an uploaded PDF: diff the freshly parsed rota against the current
// shifts. apply=false returns how many would change (preview); apply=true does it.
// Manual edits are overwritten back to the PDF values; person display names are kept.
app.post('/api/months/:id/revert', requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const weeks = req.body.weeks;
    const apply = !!req.body.apply;
    if (!Array.isArray(weeks) || weeks.length === 0) return res.status(400).json({ error: 'No parsed rota data received' });
    const m = (await query('SELECT * FROM rota_months WHERE id=$1', [id])).rows[0];
    if (!m) return res.status(404).json({ error: 'Period not found' });
    const start = dstr(m.start_date); const end = dstr(m.end_date);

    const records = buildAllRecords(weeks, start, end).filter((r) => r.workDate >= start && r.workDate <= end);
    const current = (await query('SELECT * FROM shifts WHERE month_id=$1 AND work_date BETWEEN $2 AND $3', [id, start, end])).rows;
    const curMap = new Map(current.map((c) => [`${c.person_key}|${dstr(c.work_date)}`, c]));
    const parsedKeys = new Set(records.map((r) => `${r.personKey}|${r.workDate}`));
    const pdfDates = new Set(records.map((r) => r.workDate));

    const changes = [];
    const toRemove = [];
    const nameByKey = {};
    for (const c of current) { if (!nameByKey[c.person_key]) nameByKey[c.person_key] = c.person_label || c.person_name; }
    for (const r of records) {
      const c = curMap.get(`${r.personKey}|${r.workDate}`);
      const to = describeShift(r.status, r.startMin, r.endMin, r.paidMinutes);
      if (!c) { changes.push({ name: r.personLabel || r.personName, date: r.workDate, from: '(no shift)', to }); continue; }
      const differs = c.status !== r.status || (c.start_min ?? null) !== (r.startMin ?? null)
        || (c.end_min ?? null) !== (r.endMin ?? null) || (c.paid_minutes || 0) !== (r.paidMinutes || 0);
      if (differs) changes.push({ name: nameByKey[c.person_key] || r.personName, date: r.workDate, from: describeShift(c.status, c.start_min, c.end_min, c.paid_minutes), to });
    }
    for (const c of current) {
      const key = `${c.person_key}|${dstr(c.work_date)}`;
      if (pdfDates.has(dstr(c.work_date)) && !parsedKeys.has(key)) {
        toRemove.push(c.id);
        changes.push({ name: c.person_label || c.person_name, date: dstr(c.work_date), from: describeShift(c.status, c.start_min, c.end_min, c.paid_minutes), to: 'removed (not in PDF)' });
      }
    }
    changes.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
    const willChange = changes.length;

    if (!apply) return res.json({ willChange, totalInPdf: records.length, start, end, changes });

    const labelByPerson = {};
    for (const c of current) { if (c.person_label && !labelByPerson[c.person_key]) labelByPerson[c.person_key] = c.person_label; }
    for (const rid of toRemove) await query('DELETE FROM shifts WHERE id=$1', [rid]);
    for (const r of records) {
      const c = curMap.get(`${r.personKey}|${r.workDate}`);
      if (c) {
        await query('UPDATE shifts SET status=$1, start_min=$2, end_min=$3, paid_minutes=$4, no_break=false, overridden=false, raw_text=$5 WHERE id=$6',
          [r.status, r.startMin, r.endMin, r.paidMinutes, r.rawText, c.id]);
      } else {
        await query(`INSERT INTO shifts (month_id, person_key, person_name, person_label, work_date, raw_text, status, start_min, end_min, paid_minutes)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [id, r.personKey, r.personName, labelByPerson[r.personKey] || null, r.workDate, r.rawText, r.status, r.startMin, r.endMin, r.paidMinutes]);
      }
    }
    res.json({ changed: willChange, applied: true });
  } catch (e) { next(e); }
});

// Set leave hours for every leave day of one person in this period at once.
app.post('/api/months/:id/leave', requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { personKey, hoursPerDay } = req.body;
    if (!personKey || hoursPerDay == null) {
      return res.status(400).json({ error: 'personKey and hoursPerDay are required' });
    }
    const mins = Math.max(0, Math.round(parseFloat(hoursPerDay) * 60));
    const upd = await query(
      `UPDATE shifts SET paid_minutes=$1, overridden=true
         WHERE month_id=$2 AND person_key=$3 AND status='leave'`, [mins, id, personKey]);
    res.json({ updated: upd.rowCount });
  } catch (e) { next(e); }
});

app.delete('/api/months/:id', requireAuth, async (req, res, next) => {
  try {
    await query(`DELETE FROM rota_months WHERE id=$1`, [parseInt(req.params.id, 10)]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- Shift editing ----
app.patch('/api/shifts/:id', requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const cur = await query(`SELECT * FROM shifts WHERE id=$1`, [id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Shift not found' });
    const s = cur.rows[0];

    let { startMin, endMin, status, paidMinutes, personLabel, noBreak } = req.body;
    status = status ?? s.status;
    startMin = startMin === undefined ? s.start_min : startMin;
    endMin = endMin === undefined ? s.end_min : endMin;
    const effNoBreak = noBreak === undefined ? s.no_break : !!noBreak;

    let paid = s.paid_minutes;
    if (paidMinutes !== undefined && paidMinutes !== null) paid = Math.max(0, Math.round(paidMinutes));
    else if (status === 'work' && startMin != null && endMin != null) {
      const span = endMin - startMin;
      paid = span > 0 ? paidMinutesFromSpan(span, effNoBreak) : 0;
    } else if (status === 'off') paid = 0;

    if (personLabel !== undefined) {
      await query(`UPDATE shifts SET person_label=$1 WHERE month_id=$2 AND person_key=$3`,
        [personLabel || null, s.month_id, s.person_key]);
    }

    const upd = await query(
      `UPDATE shifts SET start_min=$1, end_min=$2, status=$3, paid_minutes=$4, no_break=$5, overridden=true
         WHERE id=$6 RETURNING *`, [startMin, endMin, status, paid, effNoBreak, id]);
    res.json(rowToShift(upd.rows[0]));
  } catch (e) { next(e); }
});

app.post('/api/shifts', requireAuth, async (req, res, next) => {
  try {
    const { monthId, personKey, personName, personLabel, workDate, startMin, endMin, status, noBreak } = req.body;
    if (!monthId || !personKey || !workDate) {
      return res.status(400).json({ error: 'monthId, personKey and workDate are required' });
    }
    const st = status || 'work';
    const nb = !!noBreak;
    let paid = 0;
    if (st === 'work' && startMin != null && endMin != null && endMin > startMin) {
      paid = paidMinutesFromSpan(endMin - startMin, nb);
    }
    const ins = await query(
      `INSERT INTO shifts (month_id, person_key, person_name, person_label, work_date, raw_text, status, start_min, end_min, paid_minutes, no_break, overridden)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true) RETURNING *`,
      [monthId, personKey, personName || personKey, personLabel || null, workDate, 'manual', st,
       startMin ?? null, endMin ?? null, paid, nb]);
    res.status(201).json(rowToShift(ins.rows[0]));
  } catch (e) { next(e); }
});

app.delete('/api/shifts/:id', requireAuth, async (req, res, next) => {
  try {
    await query(`DELETE FROM shifts WHERE id=$1`, [parseInt(req.params.id, 10)]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- Change requests (public PIN-gated submit; manager review) ----
function shapeRequest(r) {
  return {
    id: r.id, createdAt: r.created_at, requester: r.requester_name, forName: r.employee_name,
    workDate: dstr(r.work_date), type: r.req_status, startMin: r.start_min, endMin: r.end_min,
    leaveMinutes: r.leave_minutes, reason: r.reason, status: r.status,
    decidedAt: r.decided_at, appliedShiftId: r.applied_shift_id,
  };
}

// Public: list staff names for the request page (PIN-gated).
app.get('/api/public/roster', async (req, res, next) => {
  try {
    if (!(await checkStaffPin(req.query.pin))) return res.status(401).json({ error: 'Wrong PIN' });
    const r = await query('SELECT DISTINCT COALESCE(person_label, person_name) AS name FROM shifts ORDER BY name');
    res.json({ names: r.rows.map((x) => x.name) });
  } catch (e) { next(e); }
});

// Public: submit one or more change requests (PIN-gated).
app.post('/api/requests', async (req, res, next) => {
  try {
    const { pin, requesterName, changes } = req.body || {};
    if (!(await checkStaffPin(pin))) return res.status(401).json({ error: 'Wrong PIN' });
    if (!requesterName || !String(requesterName).trim()) return res.status(400).json({ error: 'Enter your name' });
    if (!Array.isArray(changes) || changes.length === 0) return res.status(400).json({ error: 'Add at least one change' });
    let saved = 0;
    for (const c of changes) {
      const forName = String(c.forName || '').trim();
      if (!forName || !c.workDate || !c.type || !ISO_RE.test(c.workDate)) continue;
      const leaveMinutes = c.type === 'leave' ? Math.max(0, Math.round((parseFloat(c.leaveHours) || 0) * 60)) : null;
      await query(
        `INSERT INTO change_requests (requester_name, employee_name, work_date, req_status, start_min, end_min, leave_minutes, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [String(requesterName).trim(), forName, c.workDate, c.type,
         c.type === 'work' ? (c.startMin ?? null) : null, c.type === 'work' ? (c.endMin ?? null) : null,
         leaveMinutes, (c.reason || '').trim() || null]);
      saved += 1;
    }
    if (!saved) return res.status(400).json({ error: 'No valid changes to submit' });
    res.status(201).json({ ok: true, saved });
  } catch (e) { next(e); }
});

// Manager: list requests by status.
app.get('/api/requests', requireAuth, async (req, res, next) => {
  try {
    const status = req.query.status || 'pending';
    const r = await query('SELECT * FROM change_requests WHERE status=$1 ORDER BY created_at DESC', [status]);
    res.json(r.rows.map(shapeRequest));
  } catch (e) { next(e); }
});

// Manager: accept a request -> apply it to the matching shift.
app.post('/api/requests/:id/accept', requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const rr = (await query('SELECT * FROM change_requests WHERE id=$1', [id])).rows[0];
    if (!rr) return res.status(404).json({ error: 'Request not found' });
    if (rr.status !== 'pending') return res.status(400).json({ error: 'Already decided' });
    const personKey = req.body?.personKey;
    if (!personKey) return res.status(400).json({ error: 'Choose which person to apply this to' });
    const sh = (await query(
      'SELECT * FROM shifts WHERE work_date=$1 AND person_key=$2 LIMIT 1',
      [dstr(rr.work_date), personKey])).rows[0];
    if (!sh) return res.status(409).json({ error: 'That person has no shift on that date. Adjust it by hand, or reject.' });

    let startMin = sh.start_min; let endMin = sh.end_min; let paid = sh.paid_minutes;
    if (rr.req_status === 'work') {
      startMin = rr.start_min; endMin = rr.end_min;
      paid = (startMin != null && endMin != null && endMin > startMin) ? paidMinutesFromSpan(endMin - startMin) : 0;
    } else if (rr.req_status === 'off') { startMin = null; endMin = null; paid = 0; }
    else if (rr.req_status === 'leave') { startMin = null; endMin = null; paid = Math.max(0, rr.leave_minutes || 0); }

    await query('UPDATE shifts SET status=$1, start_min=$2, end_min=$3, paid_minutes=$4, no_break=false, overridden=true WHERE id=$5',
      [rr.req_status, startMin, endMin, paid, sh.id]);
    await query("UPDATE change_requests SET status='accepted', decided_at=now(), applied_shift_id=$1 WHERE id=$2", [sh.id, id]);
    res.json({ ok: true, shiftId: sh.id });
  } catch (e) { next(e); }
});

// Manager: reject a request (kept in the rejected list).
app.post('/api/requests/:id/reject', requireAuth, async (req, res, next) => {
  try {
    await query("UPDATE change_requests SET status='rejected', decided_at=now() WHERE id=$1 AND status='pending'",
      [parseInt(req.params.id, 10)]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Manager: permanently delete a decided request from its list.
app.delete('/api/requests/:id', requireAuth, async (req, res, next) => {
  try {
    await query('DELETE FROM change_requests WHERE id=$1', [parseInt(req.params.id, 10)]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

export default app;
