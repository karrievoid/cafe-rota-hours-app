import React, { useState } from 'react';
import { api } from '../api.js';
import { toast } from '../toast.js';
import { fmtDateFull } from '../util.js';

// Sits at the top of a period: edit the bracket (which days count) and add more
// rota PDFs to a period you already created.
export default function PeriodTools({ month, outsideBracket, onChanged }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(month.startDate);
  const [end, setEnd] = useState(month.endDate);
  const [label, setLabel] = useState(month.label);
  const [busy, setBusy] = useState(false);
  const [addFiles, setAddFiles] = useState([]);

  async function saveBracket() {
    if (start > end) { toast('Start must be on or before end', 'error'); return; }
    setBusy(true);
    try {
      await api.updateMonth(month.id, { startDate: start, endDate: end, label });
      await onChanged();
      toast('Period updated');
      setOpen(false);
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function addRotas(e) {
    e.preventDefault();
    if (!addFiles.length) return;
    setBusy(true);
    try {
      const fd = new FormData();
      for (const f of addFiles) fd.append('files', f);
      const { weeks } = await api.parsePdfs(fd);
      const { added } = await api.addRotas(month.id, weeks);
      setAddFiles([]);
      await onChanged();
      toast(added > 0 ? `Added ${added} shift day${added === 1 ? '' : 's'}` : 'Nothing new to add');
    } catch (err) { toast(err.message, 'error'); }
    finally { setBusy(false); }
  }

  return (
    <div className="card period-tools">
      <div className="period-summary">
        <div>
          <span className="period-range">{fmtDateFull(month.startDate)} &rarr; {fmtDateFull(month.endDate)}</span>
          {outsideBracket > 0 && (
            <span className="muted small"> &middot; {outsideBracket} stored day{outsideBracket === 1 ? '' : 's'} outside the bracket</span>
          )}
        </div>
        <button className="ghost" onClick={() => setOpen((v) => !v)}>{open ? 'Close' : 'Edit period / add rotas'}</button>
      </div>

      {open && (
        <div className="period-editor">
          <div className="pe-block">
            <h4>Bracket &amp; label</h4>
            <div className="row">
              <label className="field"><span>Start</span>
                <input type="date" value={start} onChange={(e) => setStart(e.target.value)} disabled={busy} />
              </label>
              <label className="field"><span>End</span>
                <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} disabled={busy} />
              </label>
            </div>
            <label className="field"><span>Label</span>
              <input value={label} onChange={(e) => setLabel(e.target.value)} disabled={busy} />
            </label>
            <button className="primary" onClick={saveBracket} disabled={busy}>Save period</button>
          </div>

          <form className="pe-block" onSubmit={addRotas}>
            <h4>Add more rotas</h4>
            <p className="muted small">Upload additional weekly PDFs for this same period.</p>
            <input type="file" accept="application/pdf" multiple onChange={(e) => setAddFiles([...e.target.files])} disabled={busy} />
            <button className="primary" disabled={busy || !addFiles.length}>{busy ? 'Working...' : 'Add rotas'}</button>
          </form>
        </div>
      )}
    </div>
  );
}
