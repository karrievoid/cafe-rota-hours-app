// auth.js - single self-service manager account. The manager registers once
// (email + password, stored hashed); after that they log in. Sessions are JWTs.
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
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

// ---- Password reset ----
export async function createResetToken(email) {
  const em = String(email || '').toLowerCase().trim();
  const u = (await query('SELECT * FROM users WHERE email=$1', [em])).rows[0];
  if (!u) return null; // caller must not reveal whether the email exists
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await query('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1,$2,$3)', [u.id, hash, expires]);
  return { token, user: u };
}

export async function resetPassword(token, newPassword) {
  if (!token) throw new Error('Invalid reset link');
  if (!newPassword || newPassword.length < 6) throw new Error('Password must be at least 6 characters');
  const hash = crypto.createHash('sha256').update(String(token)).digest('hex');
  const r = (await query(
    'SELECT * FROM password_resets WHERE token_hash=$1 AND used=false AND expires_at>now() ORDER BY id DESC LIMIT 1',
    [hash])).rows[0];
  if (!r) throw new Error('This reset link is invalid or has expired');
  const ph = await bcrypt.hash(newPassword, 10);
  await query('UPDATE users SET password_hash=$1 WHERE id=$2', [ph, r.user_id]);
  await query('UPDATE password_resets SET used=true WHERE id=$1', [r.id]);
  return true;
}

// ---- Recovery question (simple, email-free password reset) ----
function normAnswer(a) { return String(a || '').trim().toLowerCase().replace(/\s+/g, ' '); }

export async function setSecurity(question, answer) {
  const q = String(question || '').trim();
  if (!q) throw new Error('Enter a recovery question');
  if (normAnswer(answer).length < 2) throw new Error('Enter a recovery answer');
  const hash = await bcrypt.hash(normAnswer(answer), 10);
  await query('UPDATE users SET security_question=$1, security_answer_hash=$2 WHERE id=(SELECT id FROM users ORDER BY id ASC LIMIT 1)', [q, hash]);
}

export async function getSecurity() {
  const u = (await query('SELECT security_question, security_answer_hash FROM users ORDER BY id ASC LIMIT 1')).rows[0];
  return { question: (u && u.security_question) || '', hasAnswer: !!(u && u.security_answer_hash) };
}

export async function getSecurityQuestion(email) {
  const u = (await query('SELECT security_question, security_answer_hash FROM users WHERE email=$1', [String(email || '').toLowerCase().trim()])).rows[0];
  if (!u || !u.security_answer_hash) return null;
  return u.security_question || 'Security question';
}

export async function resetWithSecurity(email, answer, newPassword) {
  if (!newPassword || newPassword.length < 6) throw new Error('Password must be at least 6 characters');
  const u = (await query('SELECT * FROM users WHERE email=$1', [String(email || '').toLowerCase().trim()])).rows[0];
  if (!u || !u.security_answer_hash) throw new Error('No recovery question is set for this account');
  const ok = await bcrypt.compare(normAnswer(answer), u.security_answer_hash);
  if (!ok) throw new Error('That answer does not match');
  const ph = await bcrypt.hash(newPassword, 10);
  await query('UPDATE users SET password_hash=$1 WHERE id=$2', [ph, u.id]);
  return true;
}

// Change password while logged in (single manager account).
export async function changePassword(currentPassword, newPassword) {
  if (!newPassword || newPassword.length < 6) throw new Error('New password must be at least 6 characters');
  const u = (await query('SELECT * FROM users ORDER BY id ASC LIMIT 1')).rows[0];
  if (!u) throw new Error('No account found');
  const ok = await bcrypt.compare(currentPassword || '', u.password_hash);
  if (!ok) throw new Error('Current password is wrong');
  const ph = await bcrypt.hash(newPassword, 10);
  await query('UPDATE users SET password_hash=$1 WHERE id=$2', [ph, u.id]);
  return true;
}