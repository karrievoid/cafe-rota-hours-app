// api/index.js - Express app, exported as a Vercel serverless function.
// All routes are mounted under /api (see vercel.json rewrite).
import express from 'express';
import cors from 'cors';

import { query, ensureSchema } from './_lib/db.js';
import { signToken, checkPassword, requireAuth } from './_lib/auth.js';
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
app.post('/api/login', (req, res) => {
  if (!checkPassword(req.body?.password)) return res.status(401).json({ error: 'Wrong password' });
  res.json({ token: signToken() });
});

// ---- Helpers ----
function dstr(v) { return v instanceof Date ? v.toISOString().slice(0, 10) : v; }

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
    paidMinutes: r.paid_minutes, overridden: r.overridden,
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

    let { startMin, endMin, status, paidMinutes, personLabel } = req.body;
    status = status ?? s.status;
    startMin = startMin === undefined ? s.start_min : startMin;
    endMin = endMin === undefined ? s.end_min : endMin;

    let paid = s.paid_minutes;
    if (paidMinutes !== undefined && paidMinutes !== null) paid = Math.max(0, Math.round(paidMinutes));
    else if (status === 'work' && startMin != null && endMin != null) {
      const span = endMin - startMin;
      paid = span > 0 ? paidMinutesFromSpan(span) : 0;
    } else if (status === 'off') paid = 0;

    if (personLabel !== undefined) {
      await query(`UPDATE shifts SET person_label=$1 WHERE month_id=$2 AND person_key=$3`,
        [personLabel || null, s.month_id, s.person_key]);
    }

    const upd = await query(
      `UPDATE shifts SET start_min=$1, end_min=$2, status=$3, paid_minutes=$4, overridden=true
         WHERE id=$5 RETURNING *`, [startMin, endMin, status, paid, id]);
    res.json(rowToShift(upd.rows[0]));
  } catch (e) { next(e); }
});

app.post('/api/shifts', requireAuth, async (req, res, next) => {
  try {
    const { monthId, personKey, personName, personLabel, workDate, startMin, endMin, status } = req.body;
    if (!monthId || !personKey || !workDate) {
      return res.status(400).json({ error: 'monthId, personKey and workDate are required' });
    }
    const st = status || 'work';
    let paid = 0;
    if (st === 'work' && startMin != null && endMin != null && endMin > startMin) {
      paid = paidMinutesFromSpan(endMin - startMin);
    }
    const ins = await query(
      `INSERT INTO shifts (month_id, person_key, person_name, person_label, work_date, raw_text, status, start_min, end_min, paid_minutes, overridden)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true) RETURNING *`,
      [monthId, personKey, personName || personKey, personLabel || null, workDate, 'manual', st,
       startMin ?? null, endMin ?? null, paid]);
    res.status(201).json(rowToShift(ins.rows[0]));
  } catch (e) { next(e); }
});

app.delete('/api/shifts/:id', requireAuth, async (req, res, next) => {
  try {
    await query(`DELETE FROM shifts WHERE id=$1`, [parseInt(req.params.id, 10)]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

export default app;