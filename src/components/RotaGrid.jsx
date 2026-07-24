import React, { useState, useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from 'react';
import { api } from '../api.js';
import { toast } from '../toast.js';
import { minToTime, timeToMin, minToHours, fmtDate, localPaidMinutes, isOver6h } from '../util.js';
import Summary from './Summary.jsx';

// Editable rota with MANUAL save and TWO layouts that share the same staged
// edits: a weekly grid (like the paper rota) and a per-person summary view.
// Edits stage locally; nothing hits the server until "Save changes". The parent
// (App) reads isDirty()/save()/discard() via a ref to guard navigation.
const RotaGrid = forwardRef(function RotaGrid({ shifts, month, onDirtyChange, onSaved }, ref) {
  const [rows, setRows] = useState([]);
  const [deleted, setDeleted] = useState([]);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState(() => localStorage.getItem('rota_shiftview') || 'weekly');
  const original = useRef(new Map());
  const newCounter = useRef(0);

  function chooseView(v) { setView(v); localStorage.setItem('rota_shiftview', v); }

  useEffect(() => {
    setRows(shifts.map((s) => ({ ...s })));
    setDeleted([]);
    original.current = new Map(shifts.map((s) => [s.id, {
      status: s.status, startMin: s.startMin, endMin: s.endMin,
      paidMinutes: s.paidMinutes, personLabel: s.personLabel || '', noBreak: !!s.noBreak,
    }]));
  }, [shifts]);

  const dirty = useMemo(() => {
    if (deleted.length) return true;
    for (const r of rows) {
      if (String(r.id).startsWith('new-')) return true;
      const o = original.current.get(r.id);
      if (!o) return true;
      if (r.status !== o.status || r.startMin !== o.startMin || r.endMin !== o.endMin
        || r.paidMinutes !== o.paidMinutes || (r.personLabel || '') !== o.personLabel
        || (!!r.noBreak) !== (!!o.noBreak)) return true;
    }
    return false;
  }, [rows, deleted]);

  useEffect(() => { if (onDirtyChange) onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  useEffect(() => {
    function h(e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } }
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  function discard() { setRows(shifts.map((s) => ({ ...s }))); setDeleted([]); }

  async function save() {
    setSaving(true);
    try {
      for (const id of deleted) await api.deleteShift(id);
      const renamed = new Map();
      for (const r of rows) {
        if (String(r.id).startsWith('new-')) {
          await api.addShift({
            monthId: month.id, personKey: r.personKey, personName: r.personName,
            personLabel: r.personLabel, workDate: r.workDate, status: r.status,
            startMin: r.startMin, endMin: r.endMin, noBreak: !!r.noBreak,
          });
          continue;
        }
        const o = original.current.get(r.id);
        const timeChanged = !o || r.status !== o.status || r.startMin !== o.startMin
          || r.endMin !== o.endMin || r.paidMinutes !== o.paidMinutes || (!!r.noBreak) !== (!!o.noBreak);
        if (timeChanged) {
          let payload;
          if (r.status === 'work') payload = { status: 'work', startMin: r.startMin, endMin: r.endMin, noBreak: !!r.noBreak };
          else if (r.status === 'leave') payload = { status: 'leave', paidMinutes: r.paidMinutes };
          else payload = { status: 'off', paidMinutes: 0 };
          await api.updateShift(r.id, payload);
        }
        if (o && (r.personLabel || '') !== o.personLabel && !renamed.has(r.personKey)) {
          renamed.set(r.personKey, { label: r.personLabel, id: r.id });
        }
      }
      for (const { label, id } of renamed.values()) await api.updateShift(id, { personLabel: label || null });
      toast('Changes saved');
      if (onSaved) await onSaved();
    } catch (e) { toast(e.message, 'error'); throw e; }
    finally { setSaving(false); }
  }

  useImperativeHandle(ref, () => ({ isDirty: () => dirty, save, discard }), [dirty, rows, deleted]);

  // ---- shared local edit helpers ----
  const recompute = (r) => ({ ...r, paidMinutes: localPaidMinutes(r.status, r.startMin, r.endMin, r.paidMinutes, r.noBreak) });
  function patchRow(id, patch) { setRows((rs) => rs.map((r) => (r.id === id ? recompute({ ...r, ...patch }) : r))); }
  function renamePerson(personKey, label) { setRows((rs) => rs.map((r) => (r.personKey === personKey ? { ...r, personLabel: label } : r))); }
  function setLeaveBulk(personKey, hours) {
    const mins = Math.max(0, Math.round((parseFloat(hours) || 0) * 60));
    setRows((rs) => rs.map((r) => (r.personKey === personKey && r.status === 'leave' ? { ...r, paidMinutes: mins } : r)));
  }
  function makeRow(person, date) {
    return recompute({
      id: `new-${newCounter.current++}`, personKey: person.personKey, personName: person.personName,
      personLabel: person.personLabel || null, workDate: date, rawText: 'manual', status: 'work',
      startMin: 9 * 60, endMin: 15 * 60, paidMinutes: 0, noBreak: false,
    });
  }
  function addAtEnd(group) {
    const last = group.rows[group.rows.length - 1];
    setRows((rs) => [...rs, makeRow(group, last ? last.workDate : month.startDate)]);
  }
  function addShiftAt(person, date) { setRows((rs) => [...rs, makeRow(person, date)]); }
  function deleteRow(id) {
    setRows((rs) => rs.filter((r) => r.id !== id));
    if (!String(id).startsWith('new-')) setDeleted((d) => [...d, id]);
  }

  // ---- derived ----
  const grid = useMemo(() => {
    const dates = [...new Set(rows.map((r) => r.workDate))].sort();
    const wmap = new Map();
    for (const d of dates) { const k = mondayOf(d); if (!wmap.has(k)) wmap.set(k, []); wmap.get(k).push(d); }
    const weekList = [...wmap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([key, ds]) => ({ key, dates: ds }));
    const people = []; const pset = new Map();
    for (const r of rows) {
      if (!pset.has(r.personKey)) {
        const p = { personKey: r.personKey, personName: r.personName, personLabel: r.personLabel, name: r.personLabel || r.personName };
        pset.set(r.personKey, p); people.push(p);
      } else if (r.personLabel) { pset.get(r.personKey).name = r.personLabel; pset.get(r.personKey).personLabel = r.personLabel; }
    }
    const cell = new Map();
    for (const r of rows) cell.set(`${r.personKey}|${r.workDate}`, r);
    return { weekList, people, cell };
  }, [rows]);

  const groups = useMemo(() => {
    const g = []; const idx = new Map();
    for (const r of rows) {
      if (!idx.has(r.personKey)) { idx.set(r.personKey, g.length); g.push({ personKey: r.personKey, personName: r.personName, personLabel: r.personLabel, rows: [] }); }
      g[idx.get(r.personKey)].rows.push(r);
    }
    return g;
  }, [rows]);

  const summary = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r.personKey)) m.set(r.personKey, { personKey: r.personKey, personName: r.personName, personLabel: r.personLabel, paidMinutes: 0, workDays: 0, leaveDays: 0, unparsed: 0 });
      const a = m.get(r.personKey);
      if (r.personLabel && !a.personLabel) a.personLabel = r.personLabel;
      a.paidMinutes += r.paidMinutes || 0;
      if (r.status === 'work') a.workDays += 1;
      else if (r.status === 'leave') a.leaveDays += 1;
      else if (r.status === 'unparsed') a.unparsed += 1;
    }
    return [...m.values()].map((a) => ({ ...a, hours: Math.round((a.paidMinutes / 60) * 100) / 100 }))
      .sort((x, y) => (x.personLabel || x.personName).localeCompare(y.personLabel || y.personName));
  }, [rows]);

  return (
    <>
      <div className={`savebar ${dirty ? 'dirty' : ''}`}>
        <span className="savebar-status">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
        <div className="savebar-actions">
          <button className="ghost" onClick={discard} disabled={!dirty || saving}>Discard</button>
          <button className="primary" onClick={save} disabled={!dirty || saving}>{saving ? 'Saving...' : 'Save changes'}</button>
        </div>
      </div>

      <Summary month={month} summary={summary} />

      <div className="viewbar">
        <p className="muted small viewbar-note">
          Edit shifts, then <strong>Save changes</strong>. Over 6h loses a 20-min break; leave is paid with no break.
        </p>
        <div className="view-toggle">
          <button className={view === 'weekly' ? 'active' : ''} onClick={() => chooseView('weekly')}>Weekly</button>
          <button className={view === 'person' ? 'active' : ''} onClick={() => chooseView('person')}>By person</button>
        </div>
      </div>

      {view === 'weekly' ? (
        grid.weekList.map((wk) => (
          <WeekTable key={wk.key} week={wk} people={grid.people} cell={grid.cell}
            onPatch={patchRow} onRename={renamePerson} onAddAt={addShiftAt} />
        ))
      ) : (
        <div className="people-grid">
          {groups.map((g) => (
            <PersonCard key={g.personKey} group={g}
              onRename={renamePerson} onLeaveBulk={setLeaveBulk} onAdd={addAtEnd}
              onPatch={patchRow} onDelete={deleteRow} />
          ))}
        </div>
      )}
    </>
  );
});

function mondayOf(iso) {
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(y, m - 1, d);
  const dow = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - dow);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/* ---------- Weekly grid ---------- */
function WeekTable({ week, people, cell, onPatch, onRename, onAddAt }) {
  return (
    <div className="card week">
      <div className="grid-scroll">
        <table className="wgrid">
          <thead>
            <tr>
              <th className="wname sticky">Staff</th>
              {week.dates.map((d) => <th key={d} className="wday">{fmtDate(d)}</th>)}
              <th className="wtot">Week</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              let wkMin = 0;
              const cells = week.dates.map((d) => {
                const s = cell.get(`${p.personKey}|${d}`);
                if (s) wkMin += s.paidMinutes || 0;
                return { d, s };
              });
              return (
                <tr key={p.personKey}>
                  <td className="wname sticky"><NameCell person={p} onRename={onRename} /></td>
                  {cells.map(({ d, s }) => (
                    <WeekCell key={d} shift={s} date={d} person={p} onPatch={onPatch} onAddAt={onAddAt} />
                  ))}
                  <td className="wtot num">{minToHours(wkMin).toFixed(2)}<small>h</small></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="wname sticky daytot-label">Daily hours</td>
              {week.dates.map((d) => {
                let m = 0;
                for (const p of people) { const s = cell.get(`${p.personKey}|${d}`); if (s) m += s.paidMinutes || 0; }
                return <td key={d} className="num daytot">{minToHours(m).toFixed(2)}</td>;
              })}
              <td className="num" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function NameCell({ person, onRename }) {
  const [name, setName] = useState(person.name);
  useEffect(() => { setName(person.name); }, [person.name]);
  return (
    <input className="wname-input" value={name}
      onChange={(e) => setName(e.target.value)}
      onBlur={() => onRename(person.personKey, name)}
      title="Rename (e.g. Lois (Bake)) - applies to all their shifts" />
  );
}

function WeekCell({ shift, date, person, onPatch, onAddAt }) {
  if (!shift) {
    return (
      <td className="wcell empty">
        <button className="cell-add" title="Add a shift" onClick={() => onAddAt(person, date)}>+</button>
      </td>
    );
  }
  const status = shift.status === 'unparsed' ? 'work' : shift.status;
  const flagged = shift.status === 'unparsed';
  const showRaw = shift.rawText && shift.rawText !== 'manual';

  return (
    <td className={`wcell s-${flagged ? 'flagged' : status}`} title={showRaw ? `From rota: ${shift.rawText}` : ''}>
      <select className="wc-type" value={status} onChange={(e) => onPatch(shift.id, { status: e.target.value })}>
        <option value="work">Work</option>
        <option value="leave">Leave</option>
        <option value="off">Off</option>
      </select>

      {status === 'work' && (
        <div className="wc-body">
          <div className="wc-times">
            <input type="time" value={minToTime(shift.startMin)}
              onChange={(e) => onPatch(shift.id, { status: 'work', startMin: timeToMin(e.target.value) })} />
            <span className="dash">-</span>
            <input type="time" value={minToTime(shift.endMin)}
              onChange={(e) => onPatch(shift.id, { status: 'work', endMin: timeToMin(e.target.value) })} />
          </div>
          <div className="wc-foot">
            <span className="wc-h">{minToHours(shift.paidMinutes).toFixed(2)}h</span>
            {isOver6h(shift.startMin, shift.endMin) && (
              <button type="button" className={`nobreak ${shift.noBreak ? 'on' : ''}`}
                title="Tick if the 20-min break was not taken - pays the full time"
                onClick={() => onPatch(shift.id, { status: 'work', noBreak: !shift.noBreak })}>no break</button>
            )}
          </div>
        </div>
      )}
      {status === 'leave' && (
        <div className="wc-body">
          <div className="wc-times leave">
            <input className="paid" type="number" step="0.25" min="0" value={minToHours(shift.paidMinutes)}
              onChange={(e) => onPatch(shift.id, { status: 'leave', paidMinutes: Math.round((parseFloat(e.target.value) || 0) * 60) })} />
            <span>h</span>
          </div>
        </div>
      )}
    </td>
  );
}

/* ---------- Per-person view ---------- */
function personMinutes(rows) { return rows.reduce((s, r) => s + (r.paidMinutes || 0), 0); }

function PersonCard({ group, onRename, onLeaveBulk, onAdd, onPatch, onDelete }) {
  const [name, setName] = useState(group.personLabel || group.personName);
  useEffect(() => { setName(group.personLabel || group.personName); }, [group.personLabel, group.personName]);
  const leaveRows = group.rows.filter((r) => r.status === 'leave');
  const [leaveHrs, setLeaveHrs] = useState(leaveRows.length ? minToHours(leaveRows[0].paidMinutes).toFixed(2) : '');
  const total = minToHours(personMinutes(group.rows)).toFixed(2);

  return (
    <div className="card person">
      <div className="person-head">
        <input className="person-name" value={name}
          onChange={(e) => setName(e.target.value)} onBlur={() => onRename(group.personKey, name)}
          title="Rename (e.g. Lois (Bake)) - applies to all their shifts" />
        <span className="person-total">{total}<small>h</small></span>
      </div>

      {leaveRows.length > 0 && (
        <div className="leave-bar">
          <span>{leaveRows.length} leave day{leaveRows.length === 1 ? '' : 's'}</span>
          <span className="leave-set">
            <input type="number" step="0.25" min="0" value={leaveHrs}
              onChange={(e) => setLeaveHrs(e.target.value)} onBlur={() => onLeaveBulk(group.personKey, leaveHrs)}
              title="Hours to pay for each leave day" /><em>h/day</em>
          </span>
        </div>
      )}

      <div className="shift-rows">
        {group.rows.map((r) => <ShiftRow key={r.id} row={r} onPatch={onPatch} onDelete={onDelete} />)}
      </div>

      <button className="add-shift" onClick={() => onAdd(group)}>+ Add shift</button>
    </div>
  );
}

function ShiftRow({ row, onPatch, onDelete }) {
  const status = row.status === 'unparsed' ? 'work' : row.status;
  const flagged = row.status === 'unparsed';
  const showRaw = row.rawText && row.rawText !== 'manual';

  return (
    <div className={`srow s-${flagged ? 'flagged' : status}`}>
      <div className="s-date">
        <span>{fmtDate(row.workDate)}</span>
        {showRaw && <em className="s-raw" title={`From rota: ${row.rawText}`}>{row.rawText}</em>}
      </div>
      <select className="s-type" value={status} onChange={(e) => onPatch(row.id, { status: e.target.value })}>
        <option value="work">Work</option>
        <option value="leave">Leave</option>
        <option value="off">Off</option>
      </select>
      {status === 'work' && (
        <span className="s-times">
          <input type="time" value={minToTime(row.startMin)} onChange={(e) => onPatch(row.id, { status: 'work', startMin: timeToMin(e.target.value) })} />
          <span className="dash">-</span>
          <input type="time" value={minToTime(row.endMin)} onChange={(e) => onPatch(row.id, { status: 'work', endMin: timeToMin(e.target.value) })} />
          {isOver6h(row.startMin, row.endMin) && (
            <button type="button" className={`nobreak ${row.noBreak ? 'on' : ''}`}
              title="Tick if the 20-min break was not taken - pays the full time"
              onClick={() => onPatch(row.id, { status: 'work', noBreak: !row.noBreak })}>no break</button>
          )}
        </span>
      )}
      {status === 'leave' && (
        <span className="s-times">
          <input className="paid" type="number" step="0.25" min="0" value={minToHours(row.paidMinutes)}
            onChange={(e) => onPatch(row.id, { status: 'leave', paidMinutes: Math.round((parseFloat(e.target.value) || 0) * 60) })} /><em>h</em>
        </span>
      )}
      {status === 'off' && <span className="s-times muted">-</span>}
      <span className="s-paid">{minToHours(row.paidMinutes).toFixed(2)}h</span>
      <button className="s-del" onClick={() => onDelete(row.id)} title="Delete shift">x</button>
    </div>
  );
}

export default RotaGrid;