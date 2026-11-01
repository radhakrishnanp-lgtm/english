'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function send(req, res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const headers = { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...extra };
  if (buf.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    buf = zlib.gzipSync(buf);
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
  }
  headers['Content-Length'] = buf.length;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : buf);
}

const json = (req, res, data, status = 200) => send(req, res, status, data, undefined, { 'Cache-Control': 'no-store' });

function readJson(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    if (!/application\/json/.test(req.headers['content-type'] || '')) {
      reject(new HttpError(415, 'Expected application/json'));
      return;
    }
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      let data;
      try { data = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }
      catch { reject(new HttpError(400, 'Invalid JSON')); return; }
      // Every API takes a JSON object; anything else (null, numbers, arrays, strings) is rejected.
      if (!data || typeof data !== 'object' || Array.isArray(data)) { reject(new HttpError(400, 'Expected a JSON object')); return; }
      resolve(data);
    });
    req.on('error', reject);
  });
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const staticCache = new Map();
function serveStatic(req, res, root, urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch { return false; }
  if (decoded.includes('\0')) return false;
  const rel = path.normalize(decoded).replace(/^([/\\])+/, '');
  const file = path.join(root, rel);
  if (file !== root && !file.startsWith(root + path.sep)) return false;
  if (rel.split(/[/\\]/).some((part) => part.startsWith('.'))) return false; // no dotfiles
  let stat;
  try { stat = fs.statSync(file); } catch { return false; }
  if (!stat.isFile()) return false;
  const key = file + ':' + stat.mtimeMs;
  let buf = staticCache.get(key);
  if (!buf) { buf = fs.readFileSync(file); staticCache.set(key, buf); }
  const etag = `"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304); res.end(); return true; }
  const ext = path.extname(file);
  send(req, res, 200, buf, TYPES[ext] || 'application/octet-stream', {
    ETag: etag,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
  });
  return true;
}

module.exports = { HttpError, send, json, readJson, cookies, serveStatic };
