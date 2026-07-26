import React, { useState } from 'react';
import { api } from '../api.js';
import { toast } from '../toast.js';
import { defaultBracket, fmtDateFull } from '../util.js';

const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monShort(name) {
  const i = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    .findIndex((m) => m.toLowerCase() === String(name).toLowerCase());
  return i === -1 ? name : MO[i];
}
function weekSignature(w) {
  return (w.days || []).filter((d) => d && d.day).map((d) => `${d.month}-${d.day}`).join('|');
}
function weekLabel(w) {
  const ds = (w.days || []).filter((d) => d && d.day);
  if (!ds.length) return 'week';
  const a = ds[0]; const b = ds[ds.length - 1];
  return `${monShort(a.month)} ${a.day} - ${monShort(b.month)} ${b.day}`;
}

// Group weeks by the days they cover; any group with >1 week is a "version clash".
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
  const [files, setFiles] = useState([]);
  const [startDate, setStartDate] = useState(def.start);
  const [endDate, setEndDate] = useState(def.end);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState('');
  const [parsed, setParsed] = useState(null);   // weeks awaiting a version choice
  const [clashes, setClashes] = useState([]);
  const [choice, setChoice] = useState({});      // signature -> chosen week index

  async function finalize(weeks) {
    setStep('Saving period...');
    const created = await api.saveMonth({ weeks, startDate, endDate, label: label || undefined });
    toast('Period created');
    onCreated(created.id);
  }

  async function submit(e) {
    e.preventDefault();
    if (!files.length) { setError('Choose at least one rota PDF.'); return; }
    if (startDate > endDate) { setError('Start date must be on or before the end date.'); return; }
    setBusy(true); setError('');
    try {
      setStep('Reading PDFs...');
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const { weeks } = await api.parsePdfs(fd);

      const cl = findClashes(weeks);
      if (cl.length) {
        // Ask which version to keep for each clashing week.
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
    <form className="card upload accent-new" onSubmit={submit}>
      <h2>New pay period</h2>
      <p className="muted">
        Upload the weekly rota PDFs, then set which days count. Days outside the bracket are
        kept but not totalled - you can widen the bracket or add more rotas later.
      </p>

      <label className="field">
        <span>Rota PDFs</span>
        <input type="file" accept="application/pdf" multiple onChange={(e) => setFiles([...e.target.files])} />
      </label>
      {files.length > 0 && <ul className="filelist">{files.map((f) => <li key={f.name}>{f.name}</li>)}</ul>}

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

      {error && <div className="error">{error}</div>}
      <button className="primary" disabled={busy}>{busy ? (step || 'Working...') : 'Create period'}</button>
    </form>
  );
}