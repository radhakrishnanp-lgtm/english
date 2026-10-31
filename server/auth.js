'use strict';
const crypto = require('node:crypto');
const config = require('./config');

const SCRYPT = { N: 16384, r: 8, p: 1 };

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 32, SCRYPT);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

function verifyPassword(pw, stored) {
  const [alg, salt, key] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const want = Buffer.from(key, 'hex');
  const got = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), want.length, SCRYPT);
  return crypto.timingSafeEqual(want, got);
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + config.SESSION_DAYS * 86400e3;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha(token), userId, expires);
  return { token, expires };
}

function sessionUser(db, token) {
  if (!token) return null;
  const row = db.prepare(
    `SELECT u.id, u.username, u.display_name, u.created_at, s.expires_at FROM sessions s
     JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(sha(token));
  if (!row || row.expires_at < Date.now()) return null;
  return row;
}

function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
}

function cookieHeader(token, expires) {
  const parts = [`sid=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (expires) parts.push(`Expires=${new Date(expires).toUTCString()}`);
  else parts.push('Max-Age=0');
  if (config.SECURE_COOKIES) parts.push('Secure');
  return parts.join('; ');
}

// AES-256-GCM for users' own API keys.
function encrypt(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', config.SECRET, iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}
function decrypt(blob) {
  if (!blob) return '';
  try {
    const [v, iv, tag, enc] = blob.split(':');
    if (v !== 'v1') return '';
    const d = crypto.createDecipheriv('aes-256-gcm', config.SECRET, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
  } catch { return ''; }
}

// Very small in-memory limiter for login/register attempts.
const attempts = new Map();
function rateLimit(key, max = 10, windowMs = 10 * 60e3) {
  const now = Date.now();
  const a = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  a.push(now);
  attempts.set(key, a);
  if (attempts.size > 5000) for (const [k, v] of attempts) if (now - v[v.length - 1] > windowMs) attempts.delete(k);
  return a.length <= max;
}

module.exports = {
  hashPassword, verifyPassword, createSession, sessionUser, destroySession, cookieHeader, encrypt, decrypt, rateLimit,
};
