// auth.js — single shared password -> JWT. Enough to keep a private tool private.
import jwt from 'jsonwebtoken';

function secret() {
  return process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
}

export function signToken() {
  return jwt.sign({ role: 'manager' }, secret(), { expiresIn: '30d' });
}

export function checkPassword(pw) {
  const expected = process.env.APP_PASSWORD || 'cafe';
  return typeof pw === 'string' && pw.length > 0 && pw === expected;
}

// Express middleware: require a valid bearer token.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    jwt.verify(token, secret());
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}
