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
// A week is identified by its month hint + the day numbers it covers. Two files
// covering the same week share this signature (a "version clash").
function weekSignature(w) {
  return `${w.monthHint || '?'}|${(w.days || []).map((d) => d && d.day).filter(Boolean).join('-')}`;
}
function weekLabel(w) {
  const ds = (w.days || []).filter((d) => d && d.day);
  if (!ds.length) return 'week';
  const mo = monShort(w.monthHint);
  return `${mo} ${ds[0].day} - ${ds[ds.length - 1].day}`.trim();
}

function findClashes(weeks) {
  const groups = new Map();
  weeks.forEach((w, i) => {
    const sig = weekSignature(w);
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig).push(i);
  });
  return [...groups.entries()]
    .filter(([, idxs]) => idxs.length > 1)
    .map(([sig, idxs]) => ({ sig, label: weekLabel(weeks[idxs[0]]), indexes: idxs }));
}

export default function Upload({ onCreated }) {
  const def = defaultBracket();
  const [mode, setMode] = useState('upload');    // 'upload' | 'stored'
  const [files, setFiles] = useState([]);
  const [startDate, setStartDate] = useState(def.start);
  const [endDate, setEndDate] = useState(def.end);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [parsed, setParsed] = useState(null);
  const [clashes, setClashes] = useState([]);
  const [choice, setChoice] = useState({});

  const [stored, setStored] = useState([]);
  const [chosen, setChosen] = useState(() => new Set());

  async function loadStored() { try { setStored(await api.listUploads()); } catch { /* ignore */ } }
  useEffect(() => { loadStored(); }, []);

  async function finalize(weeks) {
    setStep('Saving period...');
    const created = await api.saveMonth({ weeks, startDate, endDate, label: label || undefined });
    toast('Period created');
    loadStored();
    onCreated(created.id);
  }

  async function submit(e) {
    e.preventDefault();
    if (!files.length) { setError('Choose at least one rota PDF.'); return; }
    if (startDate > endDate) { setError('Start date must be on or before the end date.'); return; }
    setBusy(true); setError(''); setWarnings([]);
    try {
      setStep('Reading PDFs...');
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const { weeks, warnings: w } = await api.parsePdfs(fd);
      if (w && w.length) setWarnings(w);

      const cl = findClashes(weeks);
      if (cl.length) {
        const initial = {};
        for (const c of cl) initial[c.sig] = c.indexes[0];
        setParsed(weeks); setClashes(cl); setChoice(initial);
        setBusy(false); setStep('');
        return;
      }
      await finalize(weeks);
    } catch (err) {
      setError(err.message); toast(err.message, 'error');
    } finally {
      if (!clashes.length) { setBusy(false); setStep(''); }
    }
  }

  async function confirmChoices() {
    setBusy(true); setError('');
    try {
      const drop = new Set();
      for (const c of clashes) {
        const keep = choice[c.sig];
        for (const idx of c.indexes) if (idx !== keep) drop.add(idx);
      }
      const finalWeeks = parsed.filter((_, i) => !drop.has(i));
      await finalize(finalWeeks);
    } catch (err) {
      setError(err.message); toast(err.message, 'error');
    } finally { setBusy(false); setStep(''); }
  }

  async function buildFromStored(e) {
    e.preventDefault();
    if (startDate > endDate) { setError('Start date must be on or before the end date.'); return; }
    setBusy(true); setError('');
    try {
      const uploadIds = chosen.size ? [...chosen] : undefined;
      const created = await api.saveMonthFromStored({ startDate, endDate, label: label || undefined, uploadIds });
      toast('Period created from stored rotas');
      onCreated(created.id);
    } catch (err) {
      setError(err.message); toast(err.message, 'error');
    } finally { setBusy(false); }
  }

  function toggleStored(id) {
    setChosen((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // ---- version chooser ----
  if (parsed && clashes.length) {
    return (
      <div className="card upload accent-new">
        <h2>Choose which rota version to use</h2>
        <p className="muted">More than one uploaded file covers the same week. Pick the correct version for each.</p>
        {clashes.map((c) => (
          <div className="clash" key={c.sig}>
            <div className="clash-week">{c.label}</div>
            {c.indexes.map((idx) => (
              <label className="clash-opt" key={idx}>
                <input type="radio" name={c.sig} checked={choice[c.sig] === idx}
                  onChange={() => setChoice((ch) => ({ ...ch, [c.sig]: idx }))} />
                <span>{parsed[idx].source || `version ${idx + 1}`}</span>
              </label>
            ))}
          </div>
        ))}
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button className="ghost" onClick={() => { setParsed(null); setClashes([]); }}>Cancel</button>
          <button className="primary" disabled={busy} onClick={confirmChoices}>{busy ? 'Saving...' : 'Use selected & create'}</button>
        </div>
      </div>
    );
  }

  return (
    <form className="card upload accent-new" onSubmit={mode === 'upload' ? submit : buildFromStored}>
      <h2>New pay period</h2>

      <div className="view-toggle" style={{ marginBottom: '0.6rem' }}>
        <button type="button" className={mode === 'upload' ? 'active' : ''} onClick={() => setMode('upload')}>Upload PDFs</button>
        <button type="button" className={mode === 'stored' ? 'active' : ''} onClick={() => setMode('stored')}>
          From stored rotas{stored.length ? ` (${stored.length})` : ''}
        </button>
      </div>

      {mode === 'upload' ? (
        <>
          <p className="muted">
            Upload the weekly rota PDFs, then set which days count. The right dates are worked out
            from the calendar, so a misspelled or missing month heading no longer matters. Days
            outside the bracket are kept but not totalled - widen it or add rotas later.
          </p>
          <label className="field">
            <span>Rota PDFs</span>
            <input type="file" accept="application/pdf" multiple onChange={(e) => setFiles([...e.target.files])} />
          </label>
          {files.length > 0 && <ul className="filelist">{files.map((f) => <li key={f.name}>{f.name}</li>)}</ul>}
        </>
      ) : (
        <>
          <p className="muted">
            Build this period from rotas already uploaded - no need to upload them again. Leave all
            unticked to use every stored rota, or tick the ones you want.
          </p>
          {stored.length === 0 && <p className="muted">No stored rotas yet - upload some first.</p>}
          {stored.length > 0 && (
            <ul className="stored-list">
              {stored.map((u) => (
                <li key={u.id}>
                  <label>
                    <input type="checkbox" checked={chosen.has(u.id)} onChange={() => toggleStored(u.id)} />
                    <span className="stored-name">{u.filename || 'rota'}</span>
                    <span className="muted small">
                      {u.monthHints && u.monthHints.length ? u.monthHints.join(', ') : 'month ?'}
                      {u.dayRange ? ` - days ${u.dayRange[0]}-${u.dayRange[1]}` : ''}
                    </span>
                  </label>
                  <button type="button" className="del" title="Remove from library"
                    onClick={async () => { await api.deleteUpload(u.id); loadStored(); }}>x</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="row">
        <label className="field"><span>Bracket start</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label className="field"><span>Bracket end</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
      </div>
      <p className="muted small">Counts {fmtDateFull(startDate)} to {fmtDateFull(endDate)}.</p>

      <label className="field"><span>Label (optional)</span>
        <input placeholder="e.g. June payroll" value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>

      {warnings.length > 0 && (
        <div className="warn">
          Some pages couldn&apos;t be read fully:
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>{w.source ? `${w.source}: ` : ''}{w.page ? `page ${w.page} - ` : ''}{w.reason}</li>
            ))}
          </ul>
          Everything else was still imported - add anything missing by hand on the next screen.
        </div>
      )}
      {error && <div className="error">{error}</div>}
      <button className="primary" disabled={busy}>
        {busy ? (step || 'Working...') : (mode === 'upload' ? 'Create period' : 'Build from stored rotas')}
      </button>
    </form>
  );
}
