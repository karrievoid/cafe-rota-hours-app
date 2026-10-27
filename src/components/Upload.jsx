import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import { toast } from '../toast.js';
import { defaultBracket, fmtDateFull } from '../util.js';

const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monShort(name) {
  const i = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    .findIndex((m) => m.toLowerCase() === String(name).toLowerCase());
  return i === -1 ? (name || '') : MO[i];
}
function dupLabel(d) {
  const mo = monShort(d.monthHint);
  const r = d.dayRange && d.dayRange[0] != null ? `${d.dayRange[0]}-${d.dayRange[1]}` : '';
  return `${mo} ${r}`.trim() || d.signature;
}

// Two steps, as separate cards:
//  Step 1 - Upload rotas: stored in the canonical rota table; re-upload replaces.
//  Step 2 - Create period: builds a view from the stored rotas inside a bracket.
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
  const [stored, setStored] = useState([]);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [pending, setPending] = useState(null); // { weeks, duplicates } awaiting replace confirm

  async function loadStored() { try { setStored(await api.listRotas()); } catch { /* ignore */ } }
  useEffect(() => { loadStored(); }, []);

  async function upload(e) {
    e.preventDefault();
    if (!files.length) { setError('Choose at least one rota PDF.'); return; }
    setBusy(true); setError(''); setWarnings([]); setPending(null);
    try {
      setStep('Reading PDFs...');
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const { weeks, warnings: w } = await api.parsePdfs(fd);
      if (w && w.length) setWarnings(w);

      setStep('Saving to the rota library...');
      const res = await api.ingestRotas(weeks, false);
      if (res.applied === false && res.duplicates && res.duplicates.length) {
        // Some of these weeks are already stored - ask before replacing.
        setPending({ weeks, duplicates: res.duplicates });
        return;
      }
      finishUpload(res);
    } catch (err) { setError(err.message); toast(err.message, 'error'); }
    finally { setBusy(false); setStep(''); }
  }

  async function confirmReplace() {
    setBusy(true); setStep('Replacing...');
    try {
      const res = await api.ingestRotas(pending.weeks, true);
      setPending(null);
      finishUpload(res);
    } catch (err) { setError(err.message); toast(err.message, 'error'); }
    finally { setBusy(false); setStep(''); }
  }

  function finishUpload(res) {
    setFiles([]);
    const bits = [];
    if (res.added) bits.push(`${res.added} added`);
    if (res.replaced) bits.push(`${res.replaced} replaced`);
    toast(bits.length ? `Rotas saved (${bits.join(', ')})` : 'Rotas saved');
    loadStored();
  }

  return (
    <div className="card upload accent-new">
      <h2>1. Upload rotas</h2>
      <p className="muted">
        Add the weekly rota PDFs. They're stored here as the single source of truth -
        day by day, per person. Re-uploading a week you already have just updates that
        one (you'll be asked to confirm first). Create a pay period below once they're in.
      </p>

      <form onSubmit={upload}>
        <label className="field">
          <span>Rota PDFs</span>
          <input type="file" accept="application/pdf" multiple disabled={busy}
            onChange={(e) => setFiles([...e.target.files])} />
        </label>
        {files.length > 0 && <ul className="filelist">{files.map((f) => <li key={f.name}>{f.name}</li>)}</ul>}

        {busy && <div className="processing"><span className="spinner" /> {step || 'Working...'}</div>}

        {pending && (
          <div className="warn">
            Already in the library: {pending.duplicates.map(dupLabel).join(', ')}.
            <div className="modal-actions" style={{ marginTop: '0.5rem' }}>
              <button type="button" className="ghost" onClick={() => setPending(null)} disabled={busy}>Keep existing</button>
              <button type="button" className="primary" onClick={confirmReplace} disabled={busy}>Replace with new upload</button>
            </div>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="warn">
            Some pages couldn&apos;t be read fully:
            <ul>{warnings.map((w, i) => <li key={i}>{w.source ? `${w.source}: ` : ''}{w.page ? `page ${w.page} - ` : ''}{w.reason}</li>)}</ul>
          </div>
        )}
        {error && <div className="error">{error}</div>}
        {!pending && <button className="primary" disabled={busy || !files.length}>{busy ? (step || 'Working...') : 'Upload to library'}</button>}
      </form>

      <div className="stored-head">
        <h4>Stored rotas {stored.length ? `(${stored.length})` : ''}</h4>
      </div>
      {stored.length === 0 ? (
        <p className="muted small">No rotas uploaded yet.</p>
      ) : (
        <ul className="stored-list">
          {stored.map((u) => (
            <li key={u.id}>
              <span className="stored-name">{monShort(u.monthHint)} {u.dayFrom != null ? `${u.dayFrom}-${u.dayTo}` : ''}</span>
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
