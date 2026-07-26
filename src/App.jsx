import React, { useEffect, useState, useCallback, useRef } from 'react';
import { api, getToken, clearToken } from './api.js';
import { toast } from './toast.js';
import Login from './components/Login.jsx';
import Upload from './components/Upload.jsx';
import RotaGrid from './components/RotaGrid.jsx';
import PeriodTools from './components/PeriodTools.jsx';
import Toaster from './components/Toaster.jsx';
import RequestsInbox from './components/RequestsInbox.jsx';
import SecuritySettings from './components/SecuritySettings.jsx';
import RequestForm from './components/RequestForm.jsx';
import DevLogin from './components/DevLogin.jsx';

function ManagerApp() {
  const [authed, setAuthed] = useState(!!getToken());
  const [months, setMonths] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pendingNav, setPendingNav] = useState(null); // { run } when a guarded nav is queued
  const [showSettings, setShowSettings] = useState(false);
  const rotaRef = useRef(null);

  const loadMonths = useCallback(async () => {
    try { setMonths(await api.listMonths()); }
    catch (e) { setError(e.message); if (/log in/.test(e.message)) setAuthed(false); }
  }, []);
  const loadDetail = useCallback(async (id) => {
    setLoading(true);
    try { setDetail(await api.getMonth(id)); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (authed) loadMonths(); }, [authed, loadMonths]);
  useEffect(() => { if (selectedId) loadDetail(selectedId); else setDetail(null); }, [selectedId, loadDetail]);

  // Make the browser Back button return to the period list instead of leaving
  // the app. Opening a period pushes a history entry; Back pops it and we just
  // deselect (respecting unsaved-changes via guard).
  useEffect(() => { if (selectedId != null) window.history.pushState(null, ''); }, [selectedId]);
  useEffect(() => {
    function onPop() {
      if (selectedId != null) { window.history.pushState(null, ''); guard(() => setSelectedId(null)); }
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [selectedId, dirty]);

  // Run a navigation, but if there are unsaved edits, ask first.
  function guard(fn) {
    if (dirty && rotaRef.current) setPendingNav({ run: fn });
    else fn();
  }
  async function modalSave() {
    try { await rotaRef.current.save(); const f = pendingNav; setPendingNav(null); f.run(); }
    catch { /* stay on page; error already toasted */ }
  }
  function modalDiscard() { rotaRef.current.discard(); const f = pendingNav; setPendingNav(null); f.run(); }

  function logout() { clearToken(); setAuthed(false); setSelectedId(null); setDetail(null); }

  if (!authed) return (<><Login onLoggedIn={() => setAuthed(true)} /><DevLogin onLoggedIn={() => setAuthed(true)} /><Toaster /></>);

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => guard(() => setSelectedId(null))}>Rota Hours</button>
        <div className="topbar-actions" style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="ghost" onClick={() => setShowSettings(true)}>Settings</button>
          <button className="ghost" onClick={() => guard(logout)}>Sign out</button>
        </div>
      </header>

      {error && <div className="error banner" onClick={() => setError('')}>{error} (dismiss)</div>}

      {!selectedId ? (
        <main className="dashboard">
          <Upload onCreated={(id) => { loadMonths(); setSelectedId(id); }} />
          <RequestsInbox />
          <div className="card months">
            <h2>Saved periods</h2>
            {months.length === 0 && <p className="muted">Nothing yet - upload your first rota above.</p>}
            <ul className="month-list">
              {months.map((m) => (
                <li key={m.id}>
                  <button className="link big" onClick={() => setSelectedId(m.id)}>{m.label}</button>
                  <span className="muted">{m.shiftCount} shifts</span>
                  <button className="del" title="Delete period"
                    onClick={async () => {
                      if (confirm(`Delete "${m.label}"?`)) {
                        try { await api.deleteMonth(m.id); loadMonths(); toast('Period deleted'); }
                        catch (e) { toast(e.message, 'error'); }
                      }
                    }}>x</button>
                </li>
              ))}
            </ul>
          </div>
        </main>
      ) : (
        <main className="detail">
          <button className="link" onClick={() => guard(() => setSelectedId(null))}>Back to all periods</button>
          {loading && !detail && <p className="muted">Loading...</p>}
          {detail && (
            <>
              <h1>{detail.month.label}</h1>
              <PeriodTools month={detail.month} outsideBracket={detail.outsideBracket} onChanged={() => loadDetail(selectedId)} />
              <RotaGrid ref={rotaRef} shifts={detail.shifts} month={detail.month}
                onDirtyChange={setDirty} onSaved={() => loadDetail(selectedId)} />
            </>
          )}
        </main>
      )}

      {pendingNav && (
        <div className="modal-backdrop" onClick={() => setPendingNav(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Unsaved changes</h3>
            <p className="muted">You have edits that haven&apos;t been saved. What would you like to do?</p>
            <div className="modal-actions">
              <button className="del-text" onClick={modalDiscard}>Discard &amp; leave</button>
              <div>
                <button onClick={() => setPendingNav(null)}>Cancel</button>
                <button className="primary" onClick={modalSave}>Save &amp; leave</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="modal-backdrop" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: '460px', maxWidth: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <h2 style={{ margin: 0 }}>Settings</h2>
              <button className="ghost" onClick={() => setShowSettings(false)}>Close</button>
            </div>
            <SecuritySettings />
          </div>
        </div>
      )}

      <Toaster />
    </div>
  );
}

// Public change-request page lives at the same URL with #request in the address bar.
export default function App() {
  const hash = typeof window !== 'undefined' ? window.location.hash.replace('#', '') : '';
  const route = hash.split('?')[0].toLowerCase();
  if (route === 'request') return (<><RequestForm /><Toaster /></>);
  return <ManagerApp />;
}