import React, { useState, useEffect } from 'react';
import { api, setToken } from '../api.js';

// First run: no account exists -> "Create account". After that: "Sign in".
// The mode is detected from the server, but a manual toggle is always shown so
// setup is reachable even if that check hasn't run yet.
export default function Login({ onLoggedIn }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [checked, setChecked] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.authStatus()
      .then(({ hasAccount }) => setMode(hasAccount ? 'login' : 'register'))
      .catch(() => {})
      .finally(() => setChecked(true));
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (mode === 'register' && password !== confirm) { setError('Passwords do not match'); return; }
    setBusy(true);
    try {
      const { token } = mode === 'register'
        ? await api.register(email, password)
        : await api.login(email, password);
      setToken(token);
      onLoggedIn();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  const isReg = mode === 'register';

  return (
    <div className="center-card">
      <form className="card login" onSubmit={submit}>
        <h1>Rota Hours</h1>
        <p className="muted">{isReg ? 'Create your manager account.' : 'Sign in to your account.'}</p>

        <input type="email" placeholder="Email" value={email} autoComplete="username"
          onChange={(e) => setEmail(e.target.value)} autoFocus />
        <input type="password" placeholder="Password" value={password}
          autoComplete={isReg ? 'new-password' : 'current-password'}
          onChange={(e) => setPassword(e.target.value)} />
        {isReg && (
          <input type="password" placeholder="Confirm password" value={confirm}
            autoComplete="new-password" onChange={(e) => setConfirm(e.target.value)} />
        )}

        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy || !checked}>
          {busy ? 'Please wait...' : (isReg ? 'Create account' : 'Sign in')}
        </button>

        <button type="button" className="link switch-mode"
          onClick={() => { setError(''); setMode(isReg ? 'login' : 'register'); }}>
          {isReg ? 'Already have an account? Sign in' : 'First time here? Create your manager account'}
        </button>
      </form>
    </div>
  );
}