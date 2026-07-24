import React, { useState } from 'react';
import { api } from '../api.js';
import { toast } from '../toast.js';
import { defaultBracket, fmtDateFull } from '../util.js';

// Create a new pay period: upload the rota PDFs and set the bracket (start/end
// dates). The bracket can be any range - handy when payday falls on a weekend
// and the last day or two roll into the next period.
export default function Upload({ onCreated }) {
  const def = defaultBracket();
  const [files, setFiles] = useState([]);
  const [startDate, setStartDate] = useState(def.start);
  const [endDate, setEndDate] = useState(def.end);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState('');

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

      setStep('Saving period...');
      const created = await api.saveMonth({ weeks, startDate, endDate, label: label || undefined });
      toast('Period created');
      onCreated(created.id);
    } catch (err) {
      setError(err.message);
      toast(err.message, 'error');
    } finally {
      setBusy(false); setStep('');
    }
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