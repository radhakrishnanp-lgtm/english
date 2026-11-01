'use strict';
// Robustness fuzzing: every API route is called with hostile input as a visitor, a learner and an admin.
// No request may produce a 500 error or crash the server.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-fuzz-'));
process.env.DATA_DIR = tmp;
process.env.ALLOW_REGISTRATION = 'true';
process.env.REGISTER_LIMIT = '1000';
process.env.WRITE_LIMIT = '100000';
const { createApp } = require('../server/index.js');

let app; let base;
const errors = [];
before(async () => {
  const orig = console.error;
  console.error = (...a) => { errors.push(a.map(String).join(' ')); };
  after(() => { console.error = orig; });
  app = createApp({ dbFile: path.join(tmp, 'fuzz.db') });
  await new Promise((r) => app.server.listen(0, r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(() => { app.server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
const ROUTES = [...src.matchAll(/route\('(GET|POST|PUT|DELETE)', '([^']+)'/g)].map((m) => ({ method: m[1], pattern: m[2] }));

const PARAMS = ['1', '0', '-1', '999999999', '1.5', 'abc', '%00', "1'%20OR%201=1", 'x'.repeat(300), 'unit%3A1', '..%2F..'];
const VALUES = [null, true, -1, 0, 1e309, 'NaN', '', 'x'.repeat(30000), '<img src=x onerror=alert(1)>', "'; DROP TABLE users; --",
  [], [1, 2], {}, { a: { b: { c: [] } } }, { __proto__: { admin: true } }, '1', 1.5];
const FIELDS = ['username', 'password', 'displayName', 'unitId', 'level', 'kind', 'results', 'detail', 'day', 'title', 'body', 'color', 'text', 'extra',
  'scope', 'threadId', 'message', 'voice', 'count', 'focus', 'question', 'items', 'attemptId', 'route', 'scroll', 'state', 'data', 'mode', 'role',
  'aiEnabled', 'disabled', 'aiDailyTokens', 'registration', 'aiBaseUrl', 'aiApiKey', 'aiModel', 'prices', 'current', 'next', 'theme', 'dailyGoal',
  'speechRate', 'bookmarked', 'important', 'visited', 'bonusXp', 'refresh', 'allowUserAi', 'defaultDailyTokens', 'aiReasoning', 'aiMemory'];

function bodies() {
  const out = [{}, [], 'not json', '{"broken":', null];
  for (const f of FIELDS) for (const v of VALUES) out.push({ [f]: v });
  // a few combined junk bodies
  for (let i = 0; i < 20; i++) {
    const b = {};
    for (const f of FIELDS) if (Math.random() < 0.3) b[f] = VALUES[Math.floor(Math.random() * VALUES.length)];
    out.push(b);
  }
  return out;
}

async function call(method, url, body, cookie) {
  const init = { method, headers: { cookie } };
  if (method !== 'GET' && body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const r = await fetch(base + url, init);
  await r.arrayBuffer();
  return r.status;
}

async function login(username) {
  const password = 'Fuzz-pass-123';
  let r = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  if (!r.ok) r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  return (r.headers.get('set-cookie') || '').split(';')[0];
}

test(`fuzz ${ROUTES.length} API routes — no 500s, no crash`, { timeout: 600000 }, async () => {
  const admin = await login('fuzzadmin'); // first account → admin
  const learner = await login('fuzzlearner');
  const failures = [];
  const bs = bodies();
  for (const who of [['visitor', ''], ['learner', learner], ['admin', admin]]) {
    for (const r of ROUTES) {
      if (r.pattern === '/api/auth/logout' || (r.pattern === '/api/account' && r.method === 'DELETE')) continue; // would end the session
      if (r.pattern.startsWith('/api/ai/') || r.pattern === '/api/admin/prices/fetch' || r.pattern === '/api/admin/test-ai') continue; // network calls; covered elsewhere
      const urls = r.pattern.includes(':') ? PARAMS.map((p) => r.pattern.replace(/:\w+/g, p)) : [r.pattern + '?limit=-9&unit=abc&scope=%27&ids=1-e0,abc,9-h99&user=x&kind=%00&today=bad'];
      for (const u of urls) {
        const list = r.method === 'GET' ? [undefined] : bs;
        for (const b of list) {
          // keep the admin and the learner usable during the run
          if (r.pattern === '/api/admin/users/:id' && (r.method === 'DELETE' || r.method === 'PUT') && /^(1|2)$/.test(u.split('/').pop())) continue;
          if (r.pattern === '/api/admin/settings' && r.method === 'PUT' && b && typeof b === 'object' && 'registration' in b) continue;
          const status = await call(r.method, u, b, who[1]);
          if (status >= 500) failures.push(`${who[0]} ${r.method} ${u} ${JSON.stringify(b)?.slice(0, 120)} → ${status}`);
        }
      }
    }
  }
  // server is still alive and the accounts still work
  assert.equal(await call('GET', '/api/me', undefined, admin), 200);
  assert.deepEqual(failures.slice(0, 15), [], `${failures.length} requests failed`);
  assert.deepEqual(errors.slice(0, 5), [], 'no unexpected server errors were logged');
});
