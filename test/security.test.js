'use strict';
// Security regression tests. Run with: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-sec-'));
process.env.DATA_DIR = tmp;
process.env.ALLOW_REGISTRATION = 'true';
process.env.ALLOW_PRIVATE_AI_URL = 'false'; // learners may NOT point the AI at internal addresses
process.env.REGISTER_LIMIT = '1000';
process.env.WRITE_LIMIT = '100000';
const { createApp } = require('../server/index.js');
const ai = require('../server/ai.js');

let app; let base; let mock; let mockUrl;
const seen = [];

before(async () => {
  await new Promise((r) => {
    mock = http.createServer((req, res) => {
      if (req.url.startsWith('/redirect')) { res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' }); res.end(); return; }
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => {
        seen.push(JSON.parse(b || '{}'));
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`);
        res.end('data: [DONE]\n\n');
      });
    }).listen(0, () => { mockUrl = `http://127.0.0.1:${mock.address().port}`; r(); });
  });
  app = createApp({ dbFile: path.join(tmp, 'sec.db') });
  await new Promise((r) => app.server.listen(0, r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  await account('boss_sec'); // first account = admin
});
after(() => { app.server.close(); mock.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function req(method, url, { body, cookie = '', headers = {} } = {}) {
  const r = await fetch(base + url, { method, redirect: 'manual', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), cookie, ...headers }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie');
  const text = await r.text();
  let data = text;
  try { data = JSON.parse(text); } catch { /* html */ }
  return { status: r.status, data, cookie: sc ? sc.split(';')[0] : '', headers: r.headers };
}
async function account(username, password = 'Str0ng-pass') {
  let r = await req('POST', '/api/auth/register', { body: { username, password } });
  if (r.status !== 200) r = await req('POST', '/api/auth/login', { body: { username, password } });
  return r.cookie;
}

test('SSRF: private addresses are blocked at connect time and redirects are never followed', async () => {
  await assert.rejects(ai.safeRequest('http://127.0.0.1:1/x', { blockPrivate: true }), /Private\/local/);
  await assert.rejects(ai.safeRequest('http://localhost:1/x', { blockPrivate: true }), /Private\/local/);
  await assert.rejects(ai.safeRequest('http://[::1]:1/x', { blockPrivate: true }), /Private\/local/);
  await assert.rejects(ai.safeRequest('file:///etc/passwd'), /http/);
  await assert.rejects(ai.safeRequest('http://user:pw@example.com/'), /user name/);
  const r = await ai.safeRequest(`${mockUrl}/redirect`);
  assert.equal(r.status, 302, 'redirect is returned, not followed');
  // A learner pointing their AI at an internal address gets an error, not a request.
  const c = await account('ssrf_user');
  await req('PUT', '/api/settings', { cookie: c, body: { aiBaseUrl: 'http://127.0.0.1:9/v1', aiApiKey: 'x' } });
  const chat = await req('POST', '/api/ai/chat', { cookie: c, body: { scope: 'general', message: 'hi' } });
  assert.equal(chat.status, 400);
  assert.match(chat.data.error, /Private\/local/);
});

test('cost abuse: learners cannot choose the model when using the shared key', async () => {
  const admin = await account('boss_sec');
  // first user of this DB is admin; configure the shared provider
  await req('PUT', '/api/admin/settings', { cookie: admin, body: { aiBaseUrl: mockUrl + '/v1', aiApiKey: 'sk-shared', aiModel: 'cheap/model' } });
  const c = await account('model_user');
  await req('PUT', '/api/settings', { cookie: c, body: { aiModel: 'very/expensive-model' } });
  const r = await req('POST', '/api/ai/chat', { cookie: c, body: { scope: 'general', message: 'hello' } });
  assert.equal(r.status, 200);
  assert.equal(seen.at(-1).model, 'cheap/model');
});

test('CSRF: cross-site and broken origins are rejected', async () => {
  const c = await account('csrf_user');
  assert.equal((await req('POST', '/api/notes', { cookie: c, body: { title: 't' }, headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await req('POST', '/api/notes', { cookie: c, body: { title: 't' }, headers: { Origin: 'null' } })).status, 403);
  assert.equal((await req('POST', '/api/notes', { cookie: c, body: { title: 't' }, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await req('POST', '/api/notes', { cookie: c, body: { title: 't' }, headers: { 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
  // a plain HTML form can't send JSON
  const form = await fetch(base + '/api/notes', { method: 'POST', headers: { cookie: c, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'title=x' });
  assert.equal(form.status, 415);
});

test('login: no user-name discovery by timing; only failures count; lockout is per user', async () => {
  await account('timing_user', 'Corr3ct-horse');
  const t = async (u) => { const s = process.hrtime.bigint(); await req('POST', '/api/auth/login', { body: { username: u, password: 'wrong-pass' } }); return Number(process.hrtime.bigint() - s) / 1e6; };
  const known = []; const unknown = [];
  for (let i = 0; i < 3; i++) { known.push(await t('timing_user')); unknown.push(await t(`nobody_${i}`)); }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(avg(unknown) > avg(known) * 0.5, `unknown users must also run the password hash (${avg(unknown).toFixed(1)} vs ${avg(known).toFixed(1)} ms)`);
  // many successful logins never lock you out
  for (let i = 0; i < 12; i++) assert.equal((await req('POST', '/api/auth/login', { body: { username: 'timing_user', password: 'Corr3ct-horse' } })).status, 200);
  // 10 failures lock only that user
  for (let i = 0; i < 7; i++) await req('POST', '/api/auth/login', { body: { username: 'timing_user', password: 'nope' } });
  assert.equal((await req('POST', '/api/auth/login', { body: { username: 'timing_user', password: 'Corr3ct-horse' } })).status, 429);
  await account('other_user', 'An0ther-pass');
  assert.equal((await req('POST', '/api/auth/login', { body: { username: 'other_user', password: 'An0ther-pass' } })).status, 200, 'other users still log in');
});

test('passwords: weak ones refused; changing it logs out other devices', async () => {
  assert.equal((await req('POST', '/api/auth/register', { body: { username: 'weakpw', password: 'short' } })).status, 400);
  assert.equal((await req('POST', '/api/auth/register', { body: { username: 'weakpw', password: 'password' } })).status, 400);
  assert.equal((await req('POST', '/api/auth/register', { body: { username: 'weakpw', password: 'weakpw-123' } })).status, 400, 'contains user name');
  const phone = await account('twodevices', 'First-pass-1');
  const laptop = (await req('POST', '/api/auth/login', { body: { username: 'twodevices', password: 'First-pass-1' } })).cookie;
  assert.equal((await req('POST', '/api/auth/password', { cookie: laptop, body: { current: 'First-pass-1', next: 'Second-pass-2' } })).status, 200);
  assert.equal((await req('GET', '/api/me', { cookie: phone })).status, 401, 'old device logged out');
  assert.equal((await req('GET', '/api/me', { cookie: laptop })).status, 200, 'current device stays in');
});

test('access control: users cannot read or change other users\' data', async () => {
  const a = await account('alice_sec');
  const b = await account('bob_sec');
  const note = (await req('POST', '/api/notes', { cookie: a, body: { title: 'secret' } })).data;
  const saved = (await req('POST', '/api/saved', { cookie: a, body: { text: 'my sentence' } })).data;
  const res = (await req('POST', '/api/results', { cookie: a, body: { unitId: 1, level: 'easy', kind: 'easy', results: [{ qid: '1-e0', correct: true }] } })).data;
  assert.equal((await req('PUT', `/api/notes/${note.id}`, { cookie: b, body: { title: 'x' } })).status, 404);
  await req('DELETE', `/api/notes/${note.id}`, { cookie: b });
  await req('DELETE', `/api/saved/${saved.id}`, { cookie: b });
  assert.equal((await req('GET', `/api/attempts/${res.attemptId}`, { cookie: b })).status, 404);
  assert.equal((await req('GET', '/api/notes', { cookie: a })).data.length, 1, 'note survived');
  assert.equal((await req('GET', '/api/saved', { cookie: a })).data.length, 1, 'saved item survived');
  for (const u of ['/api/admin/overview', '/api/admin/users', '/api/admin/ai-usage', '/api/admin/threads', '/api/admin/settings']) {
    assert.equal((await req('GET', u, { cookie: b })).status, 403, u);
  }
  assert.equal((await req('GET', '/api/me')).status, 401);
});

test('input handling: bad URLs, traversal, dotfiles and odd input never crash or leak files', async () => {
  const c = await account('fuzz_user');
  for (const u of ['/%E0%A4%A', '/api/units/%E0', '/..%2f..%2fserver/config.js', '/%2e%2e/%2e%2e/package.json', '/.env', '/js/../../server/index.js', '/%00']) {
    const r = await req('GET', u, { cookie: c });
    assert.ok(r.status < 500, `${u} → ${r.status}`);
    assert.ok(!String(r.data).includes("'use strict'") && !String(r.data).includes('"scripts"'), `${u} must not leak server files`);
  }
  const admin = await account('boss_sec');
  const lim = await req('GET', '/api/admin/ai-usage?limit=-5', { cookie: admin });
  assert.equal(lim.status, 200);
  const bad = await req('PUT', '/api/admin/settings', { cookie: admin, body: { prices: { __proto__: { in: 1, out: 1 }, constructor: { in: 1, out: 1 }, ok: { in: 1, out: 2 } } } });
  assert.deepEqual(Object.keys(bad.data.prices), ['ok']);
});

test('security headers are sent', async () => {
  const r = await req('GET', '/');
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('permissions-policy'), /microphone=\(self\)/);
  const login = await req('POST', '/api/auth/register', { body: { username: 'cookie_user', password: 'C00kie-pass' } });
  assert.ok(login.cookie.startsWith('sid='));
});
