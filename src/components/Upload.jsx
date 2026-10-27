import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import { toast } from '../toast.js';
import { defaultBracket, fmtDateFull, MONTHS } from '../util.js';

const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monShort(name) {
  const i = MONTHS.findIndex((m) => m.toLowerCase() === String(name).toLowerCase());
  return i === -1 ? (name || '') : MO[i];
}
function rangeLabel(a, b) {
  if (!a) return '';
  const p = (iso) => { const [y, m, d] = iso.split('-').map(Number); return { y, s: `${d} ${MO[m - 1]}` }; };
  const A = p(a);
  if (!b || a === b) return `${A.s} ${A.y}`;
  const B = p(b);
  return A.y === B.y ? `${A.s} - ${B.s} ${B.y}` : `${A.s} ${A.y} - ${B.s} ${B.y}`;
}
function dupLabel(d) {
  return rangeLabel(d.coversStart, d.coversEnd) || `${monShort(d.monthHint)}`.trim() || d.signature;
}

export default function Upload({ onCreated }) {
  return (
    <>
      <RotaLibrary />
      <CreatePeriod onCreated={onCreated} />
    </>
  );
}

/* ---------------- Step 1: the uploaded-rota library ---------------- */
function RotaLibrary() {
  const thisYear = new Date().getFullYear();
  const [stored, setStored] = useState([]);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [weeks, setWeeks] = useState(null);      // parsed weeks kept for follow-up steps
  const [duplicates, setDuplicates] = useState(null);
  const [needsInput, setNeedsInput] = useState(null); // weeks the parser couldn't place
  const [answers, setAnswers] = useState({});    // index -> { month, year }
  const [selected, setSelected] = useState(() => new Set()); // stored rota ids ticked for deletion

  async function loadStored() { try { setStored(await api.listRotas()); setSelected(new Set()); } catch { /* ignore */ } }
  useEffect(() => { loadStored(); }, []);

  function reset() { setWeeks(null); setDuplicates(null); setNeedsInput(null); setAnswers({}); }

  async function handleResult(res, wks) {
    if (res.needsInput && res.needsInput.length) {
      const init = {};
      for (const n of res.needsInput) init[n.index] = { month: MONTHS[0], year: thisYear };
      setAnswers(init); setNeedsInput(res.needsInput); setDuplicates(null);
      return;
    }
    if (res.applied === false && res.duplicates && res.duplicates.length) {
      setDuplicates(res.duplicates); setNeedsInput(null);
      return;
    }
    // success
    setFiles([]); reset();
    const bits = [];
    if (res.added) bits.push(`${res.added} added`);
    if (res.replaced) bits.push(`${res.replaced} replaced`);
    toast(bits.length ? `Rotas saved (${bits.join(', ')})` : 'Rotas saved');
    loadStored();
  }

  async function upload(e) {
    e.preventDefault();
    if (!files.length) { setError('Choose at least one rota PDF.'); return; }
    setBusy(true); setError(''); setWarnings([]); reset();
    try {
      setStep('Reading PDFs...');
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const { weeks: wks, warnings: w } = await api.parsePdfs(fd);
      if (w && w.length) setWarnings(w);
      setWeeks(wks);
      setStep('Saving to the rota library...');
      const res = await api.ingestRotas(wks, false);
      await handleResult(res, wks);
    } catch (err) { setError(err.message); toast(err.message, 'error'); }
    finally { setBusy(false); setStep(''); }
  }

  // Re-send after the manager has told us the month/year for unplaced weeks.
  async function submitAnswers(e) {
    e.preventDefault();
    const wks = weeks.map((w, i) => (answers[i] ? { ...w, forceMonth: answers[i].month, forceYear: answers[i].year } : w));
    setBusy(true); setStep('Saving to the rota library...'); setError('');
    try {
      setWeeks(wks);
      const res = await api.ingestRotas(wks, false);
      await handleResult(res, wks);
    } catch (err) { setError(err.message); toast(err.message, 'error'); }
    finally { setBusy(false); setStep(''); }
  }

  async function confirmReplace() {
    setBusy(true); setStep('Replacing...');
    try {
      const res = await api.ingestRotas(weeks, true);
      await handleResult(res, weeks);
    } catch (err) { setError(err.message); toast(err.message, 'error'); }
    finally { setBusy(false); setStep(''); }
  }

  return (
    <div className="card upload accent-new">
      <h2>1. Upload rotas</h2>
      <p className="muted">
        Add the weekly rota PDFs. They're stored here as the single source of truth -
        day by day, per person. Re-uploading a week you already have just updates that
        one (you'll be asked to confirm). Create a pay period below once they're in.
      </p>

      {!needsInput && !duplicates && (
        <form onSubmit={upload}>
          <label className="field">
            <span>Rota PDFs</span>
            <input type="file" accept="application/pdf" multiple disabled={busy}
              onChange={(e) => setFiles([...e.target.files])} />
          </label>
          {files.length > 0 && <ul className="filelist">{files.map((f) => <li key={f.name}>{f.name}</li>)}</ul>}
          {busy && <div className="processing"><span className="spinner" /> {step || 'Working...'}</div>}
          {warnings.length > 0 && (
            <div className="warn">
              Some pages couldn&apos;t be read fully:
              <ul>{warnings.map((w, i) => <li key={i}>{w.source ? `${w.source}: ` : ''}{w.page ? `page ${w.page} - ` : ''}{w.reason}</li>)}</ul>
            </div>
          )}
          {error && <div className="error">{error}</div>}
          <button className="primary" disabled={busy || !files.length}>{busy ? (step || 'Working...') : 'Upload to library'}</button>
        </form>
      )}

      {needsInput && (
        <form className="needs-month" onSubmit={submitAnswers}>
          <div className="warn">
            Couldn&apos;t read the month on {needsInput.length} rota{needsInput.length === 1 ? '' : 's'}.
            Tell me which month and year each one is for:
          </div>
          {needsInput.map((n) => (
            <div className="month-ask" key={n.index}>
              <div className="muted small">
                {n.source ? `${n.source} - ` : ''}week: {n.days.map((d) => `${d.weekday} ${d.day}`).join(', ')}
              </div>
              <div className="row">
                <label className="field"><span>Month</span>
                  <select value={answers[n.index]?.month || MONTHS[0]}
                    onChange={(e) => setAnswers((a) => ({ ...a, [n.index]: { ...a[n.index], month: e.target.value } }))}>
                    {MONTHS.map((m) => <option key={m}>{m}</option>)}
                  </select>
                </label>
                <label className="field"><span>Year</span>
                  <input type="number" value={answers[n.index]?.year || thisYear}
                    onChange={(e) => setAnswers((a) => ({ ...a, [n.index]: { ...a[n.index], year: parseInt(e.target.value, 10) } }))} />
                </label>
              </div>
            </div>
          ))}
          {busy && <div className="processing"><span className="spinner" /> {step || 'Working...'}</div>}
          {error && <div className="error">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="ghost" onClick={() => { setFiles([]); reset(); }} disabled={busy}>Cancel</button>
            <button type="submit" className="primary" disabled={busy}>Save with these months</button>
          </div>
        </form>
      )}

      {duplicates && (
        <div className="warn">
          Already in the library: {duplicates.map(dupLabel).join(', ')}.
          <div className="modal-actions" style={{ marginTop: '0.5rem' }}>
            <button type="button" className="ghost" onClick={() => { setFiles([]); reset(); }} disabled={busy}>Keep existing</button>
            <button type="button" className="primary" onClick={confirmReplace} disabled={busy}>Replace with new upload</button>
          </div>
        </div>
      )}

      <div className="stored-head">
        <h4>Stored rotas {stored.length ? `(${stored.length})` : ''}</h4>
        {stored.length > 0 && (
          <div className="stored-actions">
            <label className="muted small">
              <input type="checkbox"
                checked={selected.size === stored.length}
                ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < stored.length; }}
                onChange={(e) => setSelected(e.target.checked ? new Set(stored.map((u) => u.id)) : new Set())} />
              {' '}Select all
            </label>
            <button type="button" className="del-text" disabled={!selected.size}
              onClick={async () => {
                if (confirm(`Delete ${selected.size} selected rota${selected.size === 1 ? '' : 's'}?`)) {
                  await api.deleteRotas([...selected]); loadStored();
                }
              }}>Delete selected{selected.size ? ` (${selected.size})` : ''}</button>
            <button type="button" className="del-text"
              onClick={async () => { if (confirm('Delete ALL stored rotas? This cannot be undone.')) { await api.deleteAllRotas(); loadStored(); } }}>Delete all</button>
          </div>
        )}
      </div>
      {stored.length === 0 ? (
        <p className="muted small">No rotas uploaded yet.</p>
      ) : (
        <ul className="stored-list">
          {stored.map((u) => (
            <li key={u.id}>
              <label className="stored-pick">
                <input type="checkbox" checked={selected.has(u.id)}
                  onChange={(e) => setSelected((prev) => { const n = new Set(prev); e.target.checked ? n.add(u.id) : n.delete(u.id); return n; })} />
                <span className="stored-name">{rangeLabel(u.coversStart, u.coversEnd) || monShort(u.monthHint)}</span>
              </label>
              <span className="muted small">{u.source || ''}</span>
              <button className="del" title="Remove from library"
                onClick={async () => { if (confirm('Remove this rota from the library?')) { await api.deleteRota(u.id); loadStored(); } }}>x</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------- Step 2: create a period from stored rotas ---------------- */
function CreatePeriod({ onCreated }) {
  const def = defaultBracket();
  const [startDate, setStartDate] = useState(def.start);
  const [endDate, setEndDate] = useState(def.end);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create(e) {
    e.preventDefault();
    if (startDate > endDate) { setError('Start date must be on or before the end date.'); return; }
    setBusy(true); setError('');
    try {
      const created = await api.saveMonth({ startDate, endDate, label: label || undefined });
      toast(`Period created${created.added != null ? ` (${created.added} shifts)` : ''}`);
      onCreated(created.id);
    } catch (err) { setError(err.message); toast(err.message, 'error'); }
    finally { setBusy(false); }
  }

  return (
    <form className="card upload" onSubmit={create}>
      <h2>2. Create a pay period</h2>
      <p className="muted">
        Pick the dates this period should count. The view is built from the stored rotas
        above - the right days are worked out from the calendar. Editing the period later
        only changes the view, never your uploaded rotas.
      </p>
      <div className="row">
        <label className="field"><span>Bracket start</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={busy} />
        </label>
        <label className="field"><span>Bracket end</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={busy} />
        </label>
      </div>
      <p className="muted small">Counts {fmtDateFull(startDate)} to {fmtDateFull(endDate)}.</p>
      <label className="field"><span>Label (optional)</span>
        <input placeholder="e.g. June payroll" value={label} onChange={(e) => setLabel(e.target.value)} disabled={busy} />
      </label>
      {busy && <div className="processing"><span className="spinner" /> Building period from stored rotas...</div>}
      {error && <div className="error">{error}</div>}
      <button className="primary" disabled={busy}>{busy ? 'Building...' : 'Create period'}</button>
    </form>
  );
}