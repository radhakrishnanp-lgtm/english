'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');

// Load ROOT/.env if present (real environment variables win).
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2').replace(/\s+#.*$/, '');
  }
} catch { /* no .env file */ }
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true });

// Secret used to encrypt users' own AI keys at rest. Generated once and kept in DATA_DIR
// unless APP_SECRET is given.
function loadSecret() {
  if (process.env.APP_SECRET) return crypto.createHash('sha256').update(process.env.APP_SECRET).digest();
  const file = path.join(DATA_DIR, 'secret.key');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
}

const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));

module.exports = {
  ROOT,
  DATA_DIR,
  PORT: Number(process.env.PORT || 3000),
  HOST: process.env.HOST || '0.0.0.0',
  DB_FILE: path.join(DATA_DIR, 'app.db'),
  SECRET: loadSecret(),
  ALLOW_REGISTRATION: bool(process.env.ALLOW_REGISTRATION, false),
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || '',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',
  SECURE_COOKIES: bool(process.env.SECURE_COOKIES, false),
  // Trust X-Forwarded-For from a reverse proxy on this machine (nginx). Needed for per-IP limits.
  TRUST_PROXY: bool(process.env.TRUST_PROXY, true),
  // Max sign-up attempts per IP per hour (only matters when sign-up is open).
  REGISTER_LIMIT: Number(process.env.REGISTER_LIMIT || 10),
  // Max write requests (POST/PUT/DELETE) per user (or IP) per minute.
  WRITE_LIMIT: Number(process.env.WRITE_LIMIT || 300),
  SESSION_DAYS: Number(process.env.SESSION_DAYS || 30),
  // Default AI provider for everyone (any OpenAI-compatible endpoint).
  AI_BASE_URL: (process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, ''),
  AI_API_KEY: process.env.AI_API_KEY || '',
  AI_MODEL: process.env.AI_MODEL || 'openai/gpt-4o-mini',
  // Let each user enter their own base URL / key / model in Settings.
  ALLOW_USER_AI: bool(process.env.ALLOW_USER_AI, true),
  // Allow user-entered AI URLs that point at private/local addresses (e.g. a local Ollama).
  ALLOW_PRIVATE_AI_URL: bool(process.env.ALLOW_PRIVATE_AI_URL, false),
};
