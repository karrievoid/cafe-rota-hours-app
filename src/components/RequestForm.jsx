import React, { useState } from 'react';
import { api } from '../api.js';
import { timeToMin } from '../util.js';

const blankRow = () => ({ forName: '', workDate: '', type: 'work', start: '09:00', end: '17:00', leaveHours: '8', reason: '' });

// Public page (open the app URL with #request). Anyone with the staff PIN can
// submit one or more change requests. The requester and the person a change is
// for are both free-text - it's fine for someone to request on another's behalf.
export default function RequestForm() {
  const [pin, setPin] = useState('');
  const [requesterName, setRequesterName] = useState('');
  const [rows, setRows] = useState([blankRow()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  function updateRow(i, patch) { setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r))); }
  function addRow() { setRows((rs) => [...rs, blankRow()]); }
  function removeRow(i) { setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs)); }

  async function submit(e) {
    e.preventDefault();
    if (!pin) { setError('Enter the staff PIN.'); return; }
    if (!requesterName.trim()) { setError('Enter your name.'); return; }
    const changes = rows
      .filter((r) => r.forName.trim() && r.workDate)
      .map((r) => ({
        forName: r.forName, workDate: r.workDate, type: r.type, reason: r.reason,
        startMin: r.type === 'work' ? timeToMin(r.start) : null,
        endMin: r.type === 'work' ? timeToMin(r.end) : null,
        leaveHours: r.type === 'leave' ? r.leaveHours : null,
      }));
    if (!changes.length) { setError('Fill in at least one change (name + date).'); return; }
    setBusy(true); setError('');
    try {
      await api.submitRequests({ pin, requesterName, changes });
      setDone(true);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  if (done) {
    return (
      <div className="center-card">
        <div className="card login">
          <h1>Thanks!</h1>
          <p className="muted">Your change request has been sent to the manager.</p>
          <button className="primary" onClick={() => { setRows([blankRow()]); setDone(false); }}>Send another</button>
        </div>
      </div>
    );
  }

  return (
    <div className="center-card">
      <form className="card login wide" onSubmit={submit}>
        <h1>Request a change</h1>
        <div className="row">
          <label className="field"><span>Staff PIN</span>
            <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus /></label>
          <label className="field"><span>Your name</span>
            <input value={requesterName} onChange={(e) => setRequesterName(e.target.value)} placeholder="who is asking" /></label>
        </div>

        {rows.map((r, i) => (
          <div className="req-row" key={i}>
            <div className="req-row-head">
              <strong>Change {i + 1}</strong>
              {rows.length > 1 && <button type="button" className="del" onClick={() => removeRow(i)} title="Remove">x</button>}
            </div>
            <div className="row">
              <label className="field"><span>Person it's for</span>
                <input value={r.forName} onChange={(e) => updateRow(i, { forName: e.target.value })} placeholder="e.g. Lois" /></label>
              <label className="field"><span>Which day</span>
                <input type="date" value={r.workDate} onChange={(e) => updateRow(i, { workDate: e.target.value })} /></label>
            </div>
            <label className="field"><span>Change to</span>
              <select value={r.type} onChange={(e) => updateRow(i, { type: e.target.value })}>
                <option value="work">Working these hours</option>
                <option value="off">Day off</option>
                <option value="leave">Paid leave</option>
              </select></label>
            {r.type === 'work' && (
              <div className="row">
                <label className="field"><span>Start</span>
                  <input type="time" value={r.start} onChange={(e) => updateRow(i, { start: e.target.value })} /></label>
                <label className="field"><span>End</span>
                  <input type="time" value={r.end} onChange={(e) => updateRow(i, { end: e.target.value })} /></label>
              </div>
            )}
            {r.type === 'leave' && (
              <label className="field"><span>Leave hours</span>
                <input type="number" step="0.25" min="0" value={r.leaveHours} onChange={(e) => updateRow(i, { leaveHours: e.target.value })} /></label>
            )}
            <label className="field"><span>Reason (optional)</span>
              <input value={r.reason} onChange={(e) => updateRow(i, { reason: e.target.value })} placeholder="e.g. swapped with Sam" /></label>
          </div>
        ))}

        <button type="button" className="add-shift" onClick={addRow}>+ Add another change</button>

        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy}>{busy ? 'Sending...' : 'Send request'}</button>
      </form>
    </div>
  );
}