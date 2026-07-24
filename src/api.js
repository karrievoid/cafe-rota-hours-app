// api.js - thin fetch wrapper that carries the auth token.
const TOKEN_KEY = 'rota_token';

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken() { localStorage.removeItem(TOKEN_KEY); }

async function request(path, { method = 'GET', body, isForm } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!isForm && body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { clearToken(); throw new Error('Session expired - please log in again.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  login: (password) => request('/login', { method: 'POST', body: { password } }),
  listMonths: () => request('/months'),
  getMonth: (id) => request(`/months/${id}`),
  deleteMonth: (id) => request(`/months/${id}`, { method: 'DELETE' }),
  // Step 1: Python endpoint reads the PDFs and returns the raw weekly grid.
  parsePdfs: (formData) => request('/parse', { method: 'POST', body: formData, isForm: true }),
  // Step 2: create a period from parsed weeks + a bracket (start/end dates).
  saveMonth: (payload) => request('/months', { method: 'POST', body: payload }),
  // Change a period's bracket dates and/or label.
  updateMonth: (id, patch) => request(`/months/${id}`, { method: 'PATCH', body: patch }),
  // Append more parsed rotas to an existing period.
  addRotas: (id, weeks) => request(`/months/${id}/rotas`, { method: 'POST', body: { weeks } }),
  // Set leave hours for all of one person's leave days at once.
  setLeave: (id, personKey, hoursPerDay) =>
    request(`/months/${id}/leave`, { method: 'POST', body: { personKey, hoursPerDay } }),
  updateShift: (id, patch) => request(`/shifts/${id}`, { method: 'PATCH', body: patch }),
  addShift: (shift) => request('/shifts', { method: 'POST', body: shift }),
  deleteShift: (id) => request(`/shifts/${id}`, { method: 'DELETE' }),
};