'use strict';
// Run with: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-test-'));
process.env.DATA_DIR = tmp;
process.env.ALLOW_PRIVATE_AI_URL = 'true';
process.env.ALLOW_REGISTRATION = 'true';
process.env.REGISTER_LIMIT = '1000';
process.env.WRITE_LIMIT = '100000';
const { createApp } = require('../server/index.js');
const content = require('../server/content.js');

let app;
let base;
let mock;
let mockUrl;
const mockLog = [];

// Minimal OpenAI-compatible streaming server.
function startMock() {
  return new Promise((resolve) => {
    mock = http.createServer((req, res) => {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => {
        if (req.url.endsWith('/models')) { res.end(JSON.stringify({ data: [{ id: 'm1' }] })); return; }
        const j = JSON.parse(b);
        mockLog.push(j);
        const sys = j.messages[0].content;
        let text = 'Use **is** with he/she/it.';
        if (sys.includes('practice questions')) text = JSON.stringify({ questions: [{ t: 'mc', q: 'She ___ here.', o: ['is', 'are'], a: 0, e: '' }, { t: 'bad' }] });
        if (sys.includes('tutoring notes')) text = '- Learner likes cricket';
        if (sys.includes('HINT')) text = 'The answer is "is", obviously.';
        if (sys.includes('flowchart')) text = '```json\n{"title":"T","nodes":[{"id":"a","type":"start","text":"Start"},{"id":"b","type":"answer","text":"Use is"}],"edges":[{"from":"a","to":"b"}]}\n```';
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        if (j.reasoning) res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'thinking…' } }] })}\n\n`);
        for (const part of text.match(/.{1,8}/gs)) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`);
        res.end('data: [DONE]\n\n');
      });
    }).listen(0, () => { mockUrl = `http://127.0.0.1:${mock.address().port}/v1`; resolve(); });
  });
}

class Client {
  constructor() { this.cookie = ''; }
  async req(method, url, body) {
    const r = await fetch(base + url, {
      method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), cookie: this.cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = r.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const type = r.headers.get('content-type') || '';
    const data = type.includes('json') ? await r.json() : await r.text();
    return { status: r.status, data };
  }
  get(u) { return this.req('GET', u); }
  post(u, b = {}) { return this.req('POST', u, b); }
  put(u, b = {}) { return this.req('PUT', u, b); }
  del(u, b) { return this.req('DELETE', u, b); }
}

before(async () => {
  await startMock();
  app = createApp({ dbFile: path.join(tmp, 'test.db') });
  await new Promise((r) => app.server.listen(0, r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(() => { app.server.close(); mock.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('content: all 115 units load with 3 levels each', () => {
  const c = content.load();
  assert.equal(c.units.length, 115);
  for (const u of c.units) for (const l of content.LEVELS) assert.ok(u.practice[l].length >= 4, `unit ${u.id} ${l}`);
});

test('content parser handles every question type', () => {
  const { units } = content.parseFile(`# 1 | T | S | A1
summary: s
[learn]
## H
= Ex.
[examples]
One. :: note
[mistakes]
A. => B. :: why
[easy]
mc: Q ___ x. | a | *b :: e
fill: Where ___ you ___ (go)? = are, going :: e
order: This is my bag. :: e
fix: He are. => He is. | He's. :: e`, 'x');
  const q = units[0].practice.easy;
  assert.deepEqual(q.map((x) => x.t), ['mc', 'fill', 'order', 'fix']);
  assert.equal(q[0].a, 1);
  assert.deepEqual(q[1].a, ['are, going']);
  assert.throws(() => content.parseFile('# 1 | T | S | A1\nsummary: s\n[easy]\nmc: Q ___ | a | b', 'x'), /answer/);
});

test('auth: register, login, logout and private data', async () => {
  const a = new Client();
  assert.equal((await a.get('/api/me')).status, 401);
  assert.equal((await a.post('/api/auth/register', { username: 'ab', password: 'secret123' })).status, 400);
  assert.equal((await a.post('/api/auth/register', { username: 'anu', password: 'secret123', displayName: 'Anu' })).status, 200);
  assert.equal((await a.post('/api/auth/register', { username: 'ANU', password: 'secret123' })).status, 409);
  const me = await a.get('/api/me');
  assert.equal(me.data.user.displayName, 'Anu');
  await a.post('/api/auth/logout');
  assert.equal((await a.get('/api/me')).status, 401);
  assert.equal((await a.post('/api/auth/login', { username: 'anu', password: 'wrong' })).status, 401);
  assert.equal((await a.post('/api/auth/login', { username: 'anu', password: 'secret123' })).status, 200);

  const n = await a.post('/api/notes', { unitId: 3, title: 'mine', body: 'secret note' });
  const b = new Client();
  await b.post('/api/auth/register', { username: 'bala', password: 'secret234' });
  assert.equal((await b.get('/api/notes')).data.length, 0, 'other users cannot see my notes');
  assert.equal((await b.put(`/api/notes/${n.data.id}`, { body: 'hacked' })).status, 404);
});

test('progress, mistakes review and results history', async () => {
  const c = new Client();
  await c.post('/api/auth/register', { username: 'chitra', password: 'secret123' });
  const r = await c.post('/api/results', {
    unitId: 1, level: 'easy', kind: 'easy', title: 'Unit 1 · Easy', day: '2026-10-31',
    results: [{ qid: '1-e0', correct: true }, { qid: '1-e1', correct: false }, { qid: '1-e2', correct: true }, { qid: '1-e3', correct: true }, { qid: '1-e4', correct: true }],
    detail: [{ q: 'I ___ a student.', given: 'am', answer: 'am', correct: true }],
  });
  assert.equal(r.data.pct, 80);
  assert.equal(r.data.xp, 4 * 2 + 10);
  assert.ok(r.data.attemptId);
  const st = await c.get('/api/state?today=2026-10-31');
  assert.equal(st.data.progress[0].best, 80);
  assert.equal(st.data.mistakes.length, 1);
  assert.equal(st.data.totals.streak, 1);
  const qs = await c.get('/api/questions?ids=1-e1,999-e0');
  assert.equal(qs.data.length, 1);
  const hist = await c.get('/api/attempts?unit=1');
  assert.equal(hist.data[0].score, 4);
  const one = await c.get(`/api/attempts/${r.data.attemptId}`);
  assert.equal(one.data.detail[0].answer, 'am');
});

test('AI: threads, reasoning, memory, quiz, hint and flowchart', async () => {
  const c = new Client();
  await c.post('/api/auth/register', { username: 'devi', password: 'secret123' });
  assert.equal((await c.post('/api/ai/chat', { scope: 'general', message: 'hi' })).status, 400, 'AI not configured yet');
  await c.put('/api/settings', { aiBaseUrl: mockUrl, aiApiKey: 'sk-abc', aiModel: 'qwen/qwen3.8-omni-flash', aiReasoning: true });
  const me = await c.get('/api/me');
  assert.equal(me.data.settings.aiKeyHint, '••••-abc');
  assert.equal(me.data.settings.aiKeyEnc, undefined, 'encrypted key never sent to the browser');

  let threadId;
  for (let i = 0; i < 3; i++) {
    const r = await c.post('/api/ai/chat', { scope: 'unit:1', threadId, message: `question ${i}` });
    assert.equal(r.status, 200);
    assert.match(r.data, /"r":"thinking…"/);
    assert.match(r.data, /"done":true/);
    threadId = JSON.parse(/data: (\{"threadId".*?\})/.exec(r.data)[1]).threadId;
  }
  const chatReq = mockLog.find((x) => x.messages.at(-1).content === 'question 0');
  assert.deepEqual(chatReq.reasoning, { enabled: true });
  assert.equal(chatReq.model, 'qwen/qwen3.8-omni-flash');
  assert.match(chatReq.messages[0].content, /FOCUS RULES/);

  const t = await c.get(`/api/threads/${threadId}`);
  assert.equal(t.data.messages.length, 6);
  assert.equal(t.data.messages[1].reasoning, 'thinking…');
  assert.equal(t.data.thread.title, 'question 0');

  // memory is written in the background after 6 messages
  await new Promise((r) => setTimeout(r, 300));
  const mem = await c.get('/api/memory');
  assert.equal(mem.data[0].scope, 'unit:1');
  assert.match(mem.data[0].text, /cricket/);
  await c.post('/api/ai/chat', { scope: 'unit:1', message: 'new chat' });
  assert.match(mockLog.at(-1).messages[0].content, /cricket/, 'memory is used in new chats');

  const quiz = await c.post('/api/ai/quiz', { unitId: 1, level: 'easy', count: 3 });
  assert.equal(quiz.data.questions.length, 1, 'invalid AI questions are dropped');

  const hint = await c.post('/api/ai/hint', { question: { t: 'mc', q: 'She ___ here.', o: ['is', 'are'], answer: 'is', unit: 1 } });
  assert.doesNotMatch(hint.data.hint, /"is"/, 'hint never leaks the answer');

  const flow = await c.post('/api/ai/flow', { unitId: 1 });
  assert.equal(flow.data.nodes.length, 2);

  const other = new Client();
  await other.post('/api/auth/register', { username: 'esha', password: 'secret123' });
  assert.equal((await other.get(`/api/threads/${threadId}`)).status, 404, 'chats are private');
});

test('private AI URLs are blocked unless allowed', async () => {
  const ai = require('../server/ai.js');
  assert.ok(ai.isPrivateIp('127.0.0.1'));
  assert.ok(ai.isPrivateIp('10.1.2.3'));
  assert.ok(ai.isPrivateIp('::1'));
  assert.ok(!ai.isPrivateIp('8.8.8.8'));
});

test('admin: first user is admin, admin-only accounts, AI switch, usage and cost', async () => {
  // A fresh app whose registration is closed (default): only the first user can sign up.
  delete process.env.ALLOW_REGISTRATION;
  delete require.cache[require.resolve('../server/config.js')];
  delete require.cache[require.resolve('../server/index.js')];
  delete require.cache[require.resolve('../server/ai.js')];
  delete require.cache[require.resolve('../server/auth.js')];
  const { createApp: create2 } = require('../server/index.js');
  const app2 = create2({ dbFile: path.join(tmp, 'admin.db') });
  await new Promise((r) => app2.server.listen(0, r));
  const saveBase = base;
  base = `http://127.0.0.1:${app2.server.address().port}`;
  try {
    const admin = new Client();
    assert.equal((await admin.get('/api/config')).data.setup, true);
    const reg = await admin.post('/api/auth/register', { username: 'boss', password: 'secret123' });
    assert.equal(reg.data.admin, true);
    assert.equal((await admin.get('/api/me')).data.user.role, 'admin');
    const stranger = new Client();
    assert.equal((await stranger.post('/api/auth/register', { username: 'guest', password: 'secret123' })).status, 403, 'registration closed');

    // admin creates a learner and sets the shared AI provider + prices
    const created = await admin.post('/api/admin/users', { username: 'kavi', displayName: 'Kavi', password: 'secret123' });
    assert.ok(created.data.id);
    await admin.put('/api/admin/settings', { aiBaseUrl: mockUrl, aiApiKey: 'sk-shared', aiModel: 'm1', prices: { m1: { in: 1, out: 2 } } });
    const learner = new Client();
    assert.equal((await learner.post('/api/auth/login', { username: 'kavi', password: 'secret123' })).status, 200);
    assert.equal((await learner.get('/api/admin/overview')).status, 403, 'learners cannot open admin');

    const chat = await learner.post('/api/ai/chat', { scope: 'general', message: 'hello' });
    assert.equal(chat.status, 200);
    const log = await admin.get('/api/admin/ai-usage');
    assert.equal(log.data[0].username, 'kavi');
    assert.equal(log.data[0].model, 'm1');
    assert.ok(log.data[0].cost > 0, 'cost from the price table');
    const ov = await admin.get('/api/admin/overview');
    assert.equal(ov.data.ai.all.calls, 1);
    const users = await admin.get('/api/admin/users');
    assert.equal(users.data.find((u) => u.username === 'kavi').aiCalls, 1);
    const threads = await admin.get('/api/admin/threads');
    assert.equal((await admin.get(`/api/admin/threads/${threads.data[0].id}`)).data.messages.length, 2, 'admin sees AI history');

    // turn AI off for the learner, then a daily limit
    await admin.put(`/api/admin/users/${created.data.id}`, { aiEnabled: false });
    assert.equal((await learner.post('/api/ai/chat', { scope: 'general', message: 'again' })).status, 403);
    await admin.put(`/api/admin/users/${created.data.id}`, { aiEnabled: true, aiDailyTokens: 1 });
    assert.equal((await learner.post('/api/ai/chat', { scope: 'general', message: 'again' })).status, 429);

    // disable account logs the learner out; last admin is protected
    await admin.put(`/api/admin/users/${created.data.id}`, { disabled: true });
    assert.equal((await learner.get('/api/me')).status, 401);
    assert.equal((await learner.post('/api/auth/login', { username: 'kavi', password: 'secret123' })).status, 403);
    const me = await admin.get('/api/me');
    assert.equal((await admin.put(`/api/admin/users/${me.data.user.id}`, { role: 'user' })).status, 400);
  } finally {
    app2.server.close();
    base = saveBase;
  }
});

test('memory review: passing a level schedules the unit; reviews change stability', async () => {
  const c = new Client();
  await c.post('/api/auth/register', { username: 'gita', password: 'secret123' });
  await c.post('/api/results', { unitId: 5, level: 'easy', kind: 'easy', results: Array.from({ length: 5 }, (_, i) => ({ qid: `5-e${i}`, correct: true })) });
  const st = await c.get('/api/state');
  assert.equal(st.data.memory[0].unit_id, 5);
  assert.equal(st.data.memory[0].stability, 2, 'perfect score → 2 days');
  const ok = await c.post('/api/review', { items: [{ key: 'unit:5', success: true }] });
  assert.ok(ok.data.updated[0].stability > 2, 'remembering grows stability');
  const bad = await c.post('/api/review', { items: [{ key: 'unit:5', success: false }] });
  assert.ok(bad.data.updated[0].stability < ok.data.updated[0].stability, 'forgetting shrinks it');
  const today = await c.get('/api/review/today');
  assert.ok(Array.isArray(today.data.units));
  // auto-save
  await c.post('/api/resume', { route: '#/unit/5/practice/easy', title: 'Unit 5 · Easy', scroll: 300 });
  assert.equal((await c.get('/api/me')).data.resume.title, 'Unit 5 · Easy');
  await c.put('/api/quiz-state/u5-easy', { state: { i: 2 } });
  assert.equal((await c.get('/api/quiz-state/u5-easy')).data.state.i, 2);
});
