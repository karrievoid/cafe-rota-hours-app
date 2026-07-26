import React, { useState } from 'react';
import { api } from '../api.js';
import { toast } from '../toast.js';
import { fmtDateFull, fmtDate } from '../util.js';

// Sits at the top of a period: edit the bracket (which days count) and add more
// rota PDFs to a period you already created.
export default function PeriodTools({ month, outsideBracket, onChanged }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(month.startDate);
  const [end, setEnd] = useState(month.endDate);
  const [label, setLabel] = useState(month.label);
  const [busy, setBusy] = useState(false);
  const [addFiles, setAddFiles] = useState([]);
  const [revertFiles, setRevertFiles] = useState([]);
  const [revertWeeks, setRevertWeeks] = useState(null);
  const [revertPreview, setRevertPreview] = useState(null); // { willChange, totalInPdf }

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

  async function checkRevert(e) {
    e.preventDefault();
    if (!revertFiles.length) return;
    setBusy(true);
    try {
      const fd = new FormData();
      for (const f of revertFiles) fd.append('files', f);
      const { weeks } = await api.parsePdfs(fd);
      const preview = await api.revert(month.id, weeks, false);
      setRevertWeeks(weeks);
      setRevertPreview(preview);
    } catch (err) { toast(err.message, 'error'); }
    finally { setBusy(false); }
  }
  async function applyRevert() {
    setBusy(true);
    try {
      const { changed } = await api.revert(month.id, revertWeeks, true);
      setRevertFiles([]); setRevertWeeks(null); setRevertPreview(null);
      await onChanged();
      toast(`Reverted ${changed} shift${changed === 1 ? '' : 's'} to the PDF`);
    } catch (err) { toast(err.message, 'error'); }
    finally { setBusy(false); }
  }
  function cancelRevert() { setRevertWeeks(null); setRevertPreview(null); }

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

          <form className="pe-block" onSubmit={checkRevert}>
            <h4>Revert to the PDF</h4>
            <p className="muted small">Re-upload the original rota to undo manual edits. You will see how many shifts change before anything is applied.</p>
            <input type="file" accept="application/pdf" multiple
              onChange={(e) => { setRevertFiles([...e.target.files]); setRevertPreview(null); }} disabled={busy} />
            {!revertPreview ? (
              <button className="primary" disabled={busy || !revertFiles.length}>{busy ? 'Checking...' : 'Check what would change'}</button>
            ) : (
              <div className="revert-confirm">
                <p className="warn">
                  This will change <strong>{revertPreview.willChange}</strong> of {revertPreview.totalInPdf} shifts
                  back to the PDF{revertPreview.willChange === 0 ? ' (nothing differs).' : ' - review below:'}
                </p>
                {revertPreview.changes && revertPreview.changes.length > 0 && (
                  <div className="revert-list" style={{ maxHeight: '260px', overflowY: 'auto', margin: '0.4rem 0', border: '1px solid var(--line)', borderRadius: '8px', padding: '0.3rem 0.6rem' }}>
                    {revertPreview.changes.map((c, i) => (
                      <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', padding: '0.18rem 0', fontSize: '0.85rem', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
                        <span className="muted" style={{ minWidth: '84px' }}>{fmtDate(c.date)}</span>
                        <strong style={{ minWidth: '92px' }}>{c.name}</strong>
                        <span className="muted" style={{ textDecoration: 'line-through' }}>{c.from}</span>
                        <span>&rarr; {c.to}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="modal-actions">
                  <button type="button" className="ghost" onClick={cancelRevert} disabled={busy}>Cancel</button>
                  <button type="button" className="primary" onClick={applyRevert} disabled={busy || revertPreview.willChange === 0}>
                    {busy ? 'Reverting...' : 'Apply revert'}
                  </button>
                </div>
              </div>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
