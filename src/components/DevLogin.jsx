import React, { useState } from 'react';
import { api, setToken } from '../api.js';

// TEMPORARY quick-login for development. It only renders while running the Vite
// dev server (import.meta.env.DEV), so it disappears from the production build
// automatically. The server side also requires ALLOW_DEV_LOGIN=true.
// To remove entirely: delete this file and its <DevLogin /> line in App.jsx.
export default function DevLogin({ onLoggedIn }) {
  const [busy, setBusy] = useState(false);
  if (!import.meta.env.DEV && import.meta.env.VITE_ALLOW_DEV_LOGIN !== 'true') return null;

  async function go() {
    setBusy(true);
    try { const { token } = await api.devLogin(); setToken(token); onLoggedIn(); }
    catch (e) { alert(e.message + '\n\nSet ALLOW_DEV_LOGIN=true in your .env and restart the API.'); }
    finally { setBusy(false); }
  }

  return (
    <button className="dev-login" onClick={go} disabled={busy} title="Dev only - quick login">
      {busy ? '...' : 'Dev login'}
    </button>
  );
}