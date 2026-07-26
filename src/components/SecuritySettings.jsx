import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import { toast } from '../toast.js';

// Manager sets a recovery question + answer so they can reset their password
// without email (see the "Forgot password?" link on the sign-in page).
export default function SecuritySettings() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [hasAnswer, setHasAnswer] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getSecurity().then(({ question: q, hasAnswer: h }) => { setQuestion(q || ''); setHasAnswer(!!h); }).catch(() => {});
  }, []);

  async function save() {
    setBusy(true);
    try { await api.setSecurity(question, answer); setAnswer(''); setHasAnswer(true); toast('Recovery question saved'); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }

  return (
    <div className="card recovery">
      <h2>Password recovery</h2>
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
      <button className="primary" disabled={busy} onClick={save}>{busy ? 'Saving...' : 'Save recovery question'}</button>
    </div>
  );
}
