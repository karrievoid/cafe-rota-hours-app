import React, { useState } from 'react';
import { api } from '../api.js';
import { toast } from '../toast.js';
import { fmtDateFull, fmtDate } from '../util.js';

// Sits at the top of a period: edit the bracket (which days count), pull in any
// newly-uploaded rotas, or reset the view back to the original stored rotas.
// None of these touch the uploaded-rota library - they only rebuild this view.
export default function PeriodTools({ month, outsideBracket, onChanged }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(month.startDate);
  const [end, setEnd] = useState(month.endDate);
  const [label, setLabel] = useState(month.label);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [revertPreview, setRevertPreview] = useState(null); // { willChange, totalInPdf, changes }

  async function saveBracket() {
    if (start > end) { toast('Start must be on or before end', 'error'); return; }
    setBusy(true); setStep('Updating period...');
    try {
      await api.updateMonth(month.id, { startDate: start, endDate: end, label });
      await onChanged();
      toast('Period updated');
      setOpen(false);
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); setStep(''); }
  }

  async function pullRotas() {
    setBusy(true); setStep('Pulling in stored rotas...');
    try {
      const { added } = await api.pullStoredRotas(month.id);
      await onChanged();
      toast(added > 0 ? `Added ${added} shift day${added === 1 ? '' : 's'}` : 'Nothing new to add');
    } catch (err) { toast(err.message, 'error'); }
    finally { setBusy(false); setStep(''); }
  }

  async function checkRevert() {
    setBusy(true); setStep('Checking against stored rotas...');
    try {
      const preview = await api.revert(month.id, false);
      setRevertPreview(preview);
    } catch (err) { toast(err.message, 'error'); }
    finally { setBusy(false); setStep(''); }
  }
  async function applyRevert() {
    setBusy(true); setStep('Resetting...');
    try {
      const { changed } = await api.revert(month.id, true);
      setRevertPreview(null);
      await onChanged();
      toast(`Reset ${changed} shift${changed === 1 ? '' : 's'} to the original rota`);
    } catch (err) { toast(err.message, 'error'); }
    finally { setBusy(false); setStep(''); }
  }
  function cancelRevert() { setRevertPreview(null); }

  return (
    <div className="card period-tools">
      <div className="period-summary">
        <div>
          <span className="period-range">{fmtDateFull(month.startDate)} &rarr; {fmtDateFull(month.endDate)}</span>
          {outsideBracket > 0 && (
            <span className="muted small"> &middot; {outsideBracket} stored day{outsideBracket === 1 ? '' : 's'} outside the bracket</span>
          )}
        </div>
        <button className="ghost" onClick={() => setOpen((v) => !v)}>{open ? 'Close' : 'Edit period'}</button>
      </div>

      {busy && <div className="processing"><span className="spinner" /> {step || 'Working...'}</div>}

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

          <div className="pe-block">
            <h4>Pull in newly uploaded rotas</h4>
            <p className="muted small">If you've uploaded more rotas since, add any of their days that fall in this bracket. Existing edits are kept.</p>
            <button className="primary" onClick={pullRotas} disabled={busy}>{busy ? 'Working...' : 'Pull in stored rotas'}</button>
          </div>

          <div className="pe-block">
            <h4>Reset to the original rota</h4>
            <p className="muted small">Undo manual edits by resetting this period back to the stored rotas. You'll see what changes before anything is applied.</p>
            {!revertPreview ? (
              <button className="primary" onClick={checkRevert} disabled={busy}>{busy ? 'Checking...' : 'Check what would change'}</button>
            ) : (
              <div className="revert-confirm">
                <p className="warn">
                  This will change <strong>{revertPreview.willChange}</strong> of {revertPreview.totalInPdf} shifts
                  back to the stored rota{revertPreview.willChange === 0 ? ' (nothing differs).' : ' - review below:'}
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
                    {busy ? 'Resetting...' : 'Apply reset'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}