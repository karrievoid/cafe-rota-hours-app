import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import { toast } from '../toast.js';
import { fmtDate, minToTime, minToHours } from '../util.js';

function describe(r) {
  if (r.type === 'work') return `Work ${minToTime(r.startMin)}-${minToTime(r.endMin)}`;
  if (r.type === 'leave') return `Paid leave ${minToHours(r.leaveMinutes).toFixed(2)}h`;
  return 'Day off';
}

// Manager view of change requests. For pending ones, the manager picks which
// actual person in the table it applies to (this disambiguates two people with
// the same name, e.g. the two Loises, using a shift-time hint).
export default function RequestsInbox() {
  const [tab, setTab] = useState('pending');
  const [items, setItems] = useState([]);
  const [people, setPeople] = useState([]);
  const [choice, setChoice] = useState({});
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState('');
  const [pinLoaded, setPinLoaded] = useState(false);

  const load = useCallback(async (t) => { try { setItems(await api.listRequests(t)); } catch (e) { /* optional */ } }, []);
  useEffect(() => { load(tab); }, [tab, load]);
  useEffect(() => {
    api.listPeople().then(setPeople).catch(() => {});
    api.getStaffPin().then(({ pin: p }) => { setPin(p || ''); setPinLoaded(true); }).catch(() => setPinLoaded(true));
  }, []);

  // Default each pending request's target to a name match, else the first person.
  useEffect(() => {
    if (!people.length) return;
    setChoice((prev) => {
      const next = { ...prev };
      for (const r of items) {
        if (next[r.id]) continue;
        const m = people.find((p) => p.name.toLowerCase() === String(r.forName || '').toLowerCase());
        next[r.id] = m ? m.personKey : people[0].personKey;
      }
      return next;
    });
  }, [items, people]);

  async function accept(r) {
    const pk = choice[r.id];
    if (!pk) { toast('Pick which person', 'error'); return; }
    setBusy(true);
    try { await api.acceptRequest(r.id, pk); toast('Applied to the shift'); await load('pending'); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }
  async function reject(r) {
    setBusy(true);
    try { await api.rejectRequest(r.id); toast('Rejected'); await load('pending'); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }
  async function del(r) {
    setBusy(true);
    try { await api.deleteRequest(r.id); toast('Deleted'); await load(tab); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }
  async function savePin() {
    setBusy(true);
    try { await api.setStaffPin(pin); toast('Staff PIN updated'); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }

  return (
    <div className="card requests accent-req">
      <div className="req-head">
        <h2>Change requests {tab === 'pending' && items.length > 0 && <span className="pill">{items.length}</span>}</h2>
        <div className="view-toggle">
          {['pending', 'accepted', 'rejected'].map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="pin-setting">
        <span className="muted small">Staff PIN for the request page:</span>
        <input value={pin} onChange={(e) => setPin(e.target.value)} disabled={!pinLoaded} />
        <button className="ghost" disabled={busy || !pinLoaded} onClick={savePin}>Save PIN</button>
      </div>

      {items.length === 0 && <p className="muted small">No {tab} requests.</p>}

      {items.map((r) => (
        <div className="req-item" key={r.id}>
          <div className="req-meta">
            <strong>{r.forName}</strong>
            <span className="muted"> - {fmtDate(r.workDate)} - {describe(r)}</span>
            <div className="small muted">from {r.requester}{r.reason ? ` - "${r.reason}"` : ''}</div>
          </div>
          {tab === 'pending' ? (
            <div className="req-actions">
              <select value={choice[r.id] || ''} onChange={(e) => setChoice((c) => ({ ...c, [r.id]: e.target.value }))}>
                {people.map((p) => (
                  <option key={p.personKey} value={p.personKey}>{p.name}{p.hint ? ` (${p.hint})` : ''}</option>
                ))}
              </select>
              <button className="primary" disabled={busy} onClick={() => accept(r)}>Accept</button>
              <button className="ghost" disabled={busy} onClick={() => reject(r)}>Reject</button>
            </div>
          ) : (
            <div className="req-actions">
              <span className={`req-badge ${tab}`}>{tab}</span>
              <button className="del" disabled={busy} title="Delete from list" onClick={() => del(r)}>x</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}