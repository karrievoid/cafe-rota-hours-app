// auth.js - single self-service manager account. The manager registers once
// (email + password, stored hashed); after that they log in. Sessions are JWTs.
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { query } from './db.js';

function secret() { return process.env.JWT_SECRET || 'dev-insecure-secret-change-me'; }

export function signToken(payload = { role: 'manager' }) {
  return jwt.sign(payload, secret(), { expiresIn: '30d' });
}

// Has the manager account been created yet?
export async function hasManager() {
  const r = await query('SELECT COUNT(*)::int AS c FROM users');
  return r.rows[0].c > 0;
}

// Create the one manager account (only allowed when none exists).
export async function registerManager(email, password) {
  if (await hasManager()) throw new Error('An account already exists - please sign in');
  const em = String(email || '').toLowerCase().trim();
  if (!em || !em.includes('@')) throw new Error('Enter a valid email');
  if (!password || password.length < 6) throw new Error('Password must be at least 6 characters');
  const hash = await bcrypt.hash(password, 10);
  const r = await query('INSERT INTO users (email, password_hash) VALUES ($1,$2) RETURNING id, email', [em, hash]);
  return r.rows[0];
}

export async function loginManager(email, password) {
  const em = String(email || '').toLowerCase().trim();
  const r = await query('SELECT * FROM users WHERE email=$1', [em]);
  const u = r.rows[0];
  if (!u || !(await bcrypt.compare(password || '', u.password_hash))) {
    throw new Error('Wrong email or password');
  }
  return u;
}

// Express middleware: require a valid bearer token.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try { jwt.verify(token, secret()); return next(); }
  catch { return res.status(401).json({ error: 'Invalid or expired session' }); }
}

// Shared staff PIN for the public change-request page. Stored in the DB so the
// manager can change it in-app; falls back to the STAFF_PIN env var.
export async function getStaffPin() {
  try {
    const r = await query("SELECT value FROM settings WHERE key='staff_pin'");
    if (r.rows.length && r.rows[0].value) return r.rows[0].value;
  } catch { /* settings table may not exist yet */ }
  return process.env.STAFF_PIN || '';
}
export async function setStaffPin(pin) {
  await query(
    `INSERT INTO settings (key, value) VALUES ('staff_pin', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [String(pin)]);
}
export async function checkStaffPin(pin) {
  const expected = await getStaffPin();
  if (!expected) return false;
  return typeof pin === 'string' && pin.length > 0 && pin === expected;
}