import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import { toast } from '../toast.js';

// Manager account settings: password recovery question (for email-free reset)
// and changing the current password while logged in.
export default function SecuritySettings() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [hasAnswer, setHasAnswer] = useState(false);
  const [busy, setBusy] = useState(false);
  // change-password fields
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');

  useEffect(() => {
    api.getSecurity().then(({ question: q, hasAnswer: h }) => { setQuestion(q || ''); setHasAnswer(!!h); }).catch(() => {});
  }, []);

  async function saveRecovery() {
    setBusy(true);
    try { await api.setSecurity(question, answer); setAnswer(''); setHasAnswer(true); toast('Recovery question saved'); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }

  async function savePassword() {
    if (newPw !== confirmPw) { toast('New passwords do not match', 'error'); return; }
    setBusy(true);
    try {
      await api.changePassword(curPw, newPw);
      setCurPw(''); setNewPw(''); setConfirmPw('');
      toast('Password changed');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }

  return (
    <div className="card recovery">
      <h2>Account &amp; recovery</h2>

      <h4>Password recovery</h4>
      <p className="muted small">
        Set a question and answer so you can reset your password if you forget it - no email needed.
        {hasAnswer ? ' An answer is currently set.' : ' No answer set yet.'}
      </p>
      <label className="field"><span>Recovery question</span>
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Your date of birth (DDMMYYYY)" />
      </label>
      <label className="field"><span>Answer{hasAnswer ? ' (type a new one to change it)' : ''}</span>
        <input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="kept secret, stored hashed" />
      </label>
      <button className="primary" disabled={busy} onClick={saveRecovery}>{busy ? 'Saving...' : 'Save recovery question'}</button>

      <hr className="settings-sep" />

      <h4>Change password</h4>
      <label className="field"><span>Current password</span>
        <input type="password" autoComplete="current-password" value={curPw} onChange={(e) => setCurPw(e.target.value)} />
      </label>
      <div className="row">
        <label className="field"><span>New password</span>
          <input type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
        </label>
        <label className="field"><span>Confirm new</span>
          <input type="password" autoComplete="new-password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
        </label>
      </div>
      <button className="primary" disabled={busy || !curPw || !newPw} onClick={savePassword}>{busy ? 'Saving...' : 'Change password'}</button>
    </div>
  );
}