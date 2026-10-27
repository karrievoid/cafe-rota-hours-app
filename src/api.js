// api.js - thin fetch wrapper that carries the auth token.
const TOKEN_KEY = 'rota_token';

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken() { localStorage.removeItem(TOKEN_KEY); }

async function request(path, { method = 'GET', body, isForm, pub } = {}) {
  const headers = {};
  const token = getToken();
  if (token && !pub) headers.Authorization = `Bearer ${token}`;
  if (!isForm && body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !pub) { clearToken(); throw new Error('Session expired - please log in again.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  // Auth (single manager account)
  authStatus: () => request('/auth/status', { pub: true }),
  register: (email, password) => request('/auth/register', { method: 'POST', body: { email, password }, pub: true }),
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password }, pub: true }),
  devLogin: () => request('/auth/dev-login', { method: 'POST', pub: true }),
  forgotPassword: (email) => request('/auth/forgot', { method: 'POST', body: { email }, pub: true }),
  resetPassword: (token, password) => request('/auth/reset', { method: 'POST', body: { token, password }, pub: true }),
  getSecurity: () => request('/settings/security'),
  setSecurity: (question, answer) => request('/settings/security', { method: 'PUT', body: { question, answer } }),
  changePassword: (currentPassword, newPassword) => request('/settings/password', { method: 'PUT', body: { currentPassword, newPassword } }),
  securityQuestion: (email) => request(`/auth/security-question?email=${encodeURIComponent(email)}`, { pub: true }),
  securityReset: (email, answer, password) => request('/auth/security-reset', { method: 'POST', body: { email, answer, password }, pub: true }),
  getStaffPin: () => request('/settings/staff-pin'),
  setStaffPin: (pin) => request('/settings/staff-pin', { method: 'PUT', body: { pin } }),
  listPeople: () => request('/people'),

  // Periods + shifts
  listMonths: () => request('/months'),
  getMonth: (id) => request(`/months/${id}`),
  deleteMonth: (id) => request(`/months/${id}`, { method: 'DELETE' }),
  parsePdfs: (formData) => request('/parse', { method: 'POST', body: formData, isForm: true }),
  // Canonical uploaded-rota store
  listRotas: () => request('/rotas'),
  ingestRotas: (weeks, replace = false) => request('/rotas/ingest', { method: 'POST', body: { weeks, replace } }),
  deleteRota: (id) => request(`/rotas/${id}`, { method: 'DELETE' }),
  deleteRotas: (ids) => request('/rotas/delete', { method: 'POST', body: { ids } }),
  deleteAllRotas: () => request('/rotas/delete', { method: 'POST', body: { all: true } }),
  // Create a period from the STORED rotas that fall in the bracket.
  saveMonth: (payload) => request('/months', { method: 'POST', body: payload }),
  updateMonth: (id, patch) => request(`/months/${id}`, { method: 'PATCH', body: patch }),
  pullStoredRotas: (id) => request(`/months/${id}/rotas`, { method: 'POST' }),
  revert: (id, apply) => request(`/months/${id}/revert`, { method: 'POST', body: { apply } }),
  setLeave: (id, personKey, hoursPerDay) =>
    request(`/months/${id}/leave`, { method: 'POST', body: { personKey, hoursPerDay } }),
  updateShift: (id, patch) => request(`/shifts/${id}`, { method: 'PATCH', body: patch }),
  addShift: (shift) => request('/shifts', { method: 'POST', body: shift }),
  deleteShift: (id) => request(`/shifts/${id}`, { method: 'DELETE' }),

  // Change requests
  submitRequests: (payload) => request('/requests', { method: 'POST', body: payload, pub: true }),
  listRequests: (status) => request(`/requests?status=${status}`),
  acceptRequest: (id, personKey) => request(`/requests/${id}/accept`, { method: 'POST', body: { personKey } }),
  rejectRequest: (id) => request(`/requests/${id}/reject`, { method: 'POST' }),
  deleteRequest: (id) => request(`/requests/${id}`, { method: 'DELETE' }),
};