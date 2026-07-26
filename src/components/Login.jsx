import React, { useState, useEffect } from 'react';
import { api, setToken } from '../api.js';

// Sign in, first-run account creation, and email-free password recovery via a
// security question the manager set up in advance.
export default function Login({ onLoggedIn }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register' | 'forgot'
  const [checked, setChecked] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // forgot-flow state
  const [fStep, setFStep] = useState('email'); // 'email' | 'answer' | 'done'
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');

  useEffect(() => {
    api.authStatus().then(({ hasAccount }) => setMode(hasAccount ? 'login' : 'register'))
      .catch(() => {}).finally(() => setChecked(true));
  }, []);

  function goForgot() { setError(''); setMode('forgot'); setFStep('email'); setQuestion(''); setAnswer(''); setPassword(''); setConfirm(''); }
  function goLogin() { setError(''); setMode('login'); }

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'register') {
        if (password !== confirm) throw new Error('Passwords do not match');
        const { token } = await api.register(email, password); setToken(token); onLoggedIn(); return;
      }
      if (mode === 'login') {
        const { token } = await api.login(email, password); setToken(token); onLoggedIn(); return;
      }
      // forgot
      if (fStep === 'email') {
        const { question: q } = await api.securityQuestion(email);
        if (!q) throw new Error('No recovery question is set for that account.');
        setQuestion(q); setFStep('answer'); return;
      }
      if (fStep === 'answer') {
        if (password !== confirm) throw new Error('Passwords do not match');
        await api.securityReset(email, answer, password);
        setFStep('done'); return;
      }
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  if (mode === 'forgot' && fStep === 'done') {
    return (
      <div className="center-card"><div className="card login">
        <h1>Password updated</h1>
        <p className="muted">You can now sign in with your new password.</p>
        <button className="primary" onClick={goLogin}>Back to sign in</button>
      </div></div>
    );
  }

  const isReg = mode === 'register';
  const isForgot = mode === 'forgot';

  return (
    <div className="center-card">
      <form className="card login" onSubmit={submit}>
        <h1>Rota Hours</h1>
        <p className="muted">
          {isForgot ? 'Reset your password.' : isReg ? 'Create your manager account.' : 'Sign in to your account.'}
        </p>

        <input type="email" placeholder="Email" value={email} autoComplete="username"
          onChange={(e) => setEmail(e.target.value)} autoFocus
          disabled={isForgot && fStep === 'answer'} />

        {!isForgot && (
          <input type="password" placeholder="Password" value={password}
            autoComplete={isReg ? 'new-password' : 'current-password'}
            onChange={(e) => setPassword(e.target.value)} />
        )}
        {isReg && (
          <input type="password" placeholder="Confirm password" value={confirm}
            autoComplete="new-password" onChange={(e) => setConfirm(e.target.value)} />
        )}

        {isForgot && fStep === 'answer' && (
          <>
            <p className="muted small qtext">{question}</p>
            <input placeholder="Your answer" value={answer} onChange={(e) => setAnswer(e.target.value)} />
            <input type="password" placeholder="New password" value={password}
              autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
            <input type="password" placeholder="Confirm new password" value={confirm}
              autoComplete="new-password" onChange={(e) => setConfirm(e.target.value)} />
          </>
        )}

        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy || !checked}>
          {busy ? 'Please wait...'
            : isForgot ? (fStep === 'email' ? 'Next' : 'Reset password')
              : isReg ? 'Create account' : 'Sign in'}
        </button>

        {mode === 'login' && (
          <button type="button" className="link" onClick={goForgot}>Forgot password?</button>
        )}
        <button type="button" className="link switch-mode"
          onClick={() => { setError(''); if (isForgot) goLogin(); else setMode(isReg ? 'login' : 'register'); }}>
          {isReg ? 'Already have an account? Sign in'
            : isForgot ? 'Back to sign in'
              : 'First time here? Create your manager account'}
        </button>
      </form>
    </div>
  );
}