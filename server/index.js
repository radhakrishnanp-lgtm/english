'use strict';
const http = require('node:http');
const path = require('node:path');
const config = require('./config');
const dbm = require('./db');
const content = require('./content');
const auth = require('./auth');
const ai = require('./ai');
const { HttpError, json, readJson, cookies, serveStatic, send } = require('./http');

const PUBLIC = path.join(config.ROOT, 'public');

function createApp({ dbFile = config.DB_FILE } = {}) {
  const db = dbm.open(dbFile);
  const course = content.load();
  const unitList = course.units.map((u) => `${u.id}. ${u.title}`).join('; ');
  const now = () => Date.now();

  // ---------- helpers ----------
  const getSettings = (uid) => JSON.parse(db.prepare('SELECT json FROM settings WHERE user_id = ?').get(uid)?.json || '{}');
  const putSettings = (uid, s) => db.prepare(
    'INSERT INTO settings (user_id, json) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json').run(uid, JSON.stringify(s));

  function publicSettings(s) {
    const { aiKeyEnc, ...rest } = s;
    return {
      ...rest,
      aiKeySet: Boolean(aiKeyEnc),
      aiKeyHint: aiKeyEnc ? '••••' + auth.decrypt(aiKeyEnc).slice(-4) : '',
    };
  }
  const serverAi = () => ({
    baseUrl: config.AI_BASE_URL, model: config.AI_MODEL, configured: Boolean(config.AI_API_KEY),
    allowUserAi: config.ALLOW_USER_AI,
  });

  const validDay = (d) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : new Date().toISOString().slice(0, 10));
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const unitOr404 = (id) => {
    const u = course.byId.get(Number(id));
    if (!u) throw new HttpError(404, 'Unit not found');
    return u;
  };

  function streak(uid, today) {
    const days = new Set(db.prepare('SELECT day FROM activity WHERE user_id = ? AND xp > 0').all(uid).map((r) => r.day));
    const d = new Date(today + 'T00:00:00Z');
    if (!days.has(today)) d.setUTCDate(d.getUTCDate() - 1);
    let n = 0;
    while (days.has(d.toISOString().slice(0, 10))) { n++; d.setUTCDate(d.getUTCDate() - 1); }
    return n;
  }

  function addActivity(uid, day, xp, answered, correct) {
    db.prepare(`INSERT INTO activity (user_id, day, xp, answered, correct) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, day) DO UPDATE SET xp = xp + excluded.xp, answered = answered + excluded.answered,
      correct = correct + excluded.correct`).run(uid, day, xp, answered, correct);
  }

  function recordResults(uid, results) {
    const t = now();
    const upWrong = db.prepare(`INSERT INTO mistakes (user_id, qid, unit_id, wrong, streak, due_at) VALUES (?, ?, ?, 1, 0, ?)
      ON CONFLICT(user_id, qid) DO UPDATE SET wrong = wrong + 1, streak = 0, due_at = excluded.due_at`);
    const getM = db.prepare('SELECT streak FROM mistakes WHERE user_id = ? AND qid = ?');
    const upRight = db.prepare('UPDATE mistakes SET streak = ?, due_at = ? WHERE user_id = ? AND qid = ?');
    const del = db.prepare('DELETE FROM mistakes WHERE user_id = ? AND qid = ?');
    const gaps = [1, 3, 7];
    for (const r of results) {
      const qid = str(r.qid, 40);
      const m = /^(\d+)-[emh]\d+$/.exec(qid);
      if (!m) continue; // only course questions are tracked (AI questions are temporary)
      if (!r.correct) { upWrong.run(uid, qid, Number(m[1]), t); continue; }
      const row = getM.get(uid, qid);
      if (!row) continue;
      const s = row.streak + 1;
      if (s >= 3) del.run(uid, qid);
      else upRight.run(s, t + gaps[s - 1] * 86400e3, uid, qid);
    }
  }

  function weakUnits(uid) {
    return db.prepare('SELECT unit_id, SUM(wrong) w FROM mistakes WHERE user_id = ? GROUP BY unit_id ORDER BY w DESC LIMIT 5')
      .all(uid).map((r) => course.byId.get(r.unit_id)).filter(Boolean).map((u) => `Unit ${u.id} ${u.title}`);
  }

  // ---------- routes ----------
  const routes = [];
  const route = (method, pattern, handler, { open = false } = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler, open });
  };

  // auth
  route('GET', '/api/config', () => ({ allowRegistration: config.ALLOW_REGISTRATION, ai: serverAi() }), { open: true });

  route('POST', '/api/auth/register', async (ctx) => {
    if (!config.ALLOW_REGISTRATION) throw new HttpError(403, 'Registration is closed on this server.');
    if (!auth.rateLimit('reg:' + ctx.ip, 10)) throw new HttpError(429, 'Too many attempts. Try again later.');
    const b = await ctx.body();
    const username = str(b.username, 40).trim();
    const password = str(b.password, 200);
    const displayName = str(b.displayName, 60).trim() || username;
    if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) throw new HttpError(400, 'Username: 3-40 letters, numbers, _ . -');
    if (password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters.');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'That username is taken.');
    const r = db.prepare('INSERT INTO users (username, display_name, pass_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(username, displayName, auth.hashPassword(password), now());
    putSettings(r.lastInsertRowid, { theme: 'system', explainStyle: 'simple', dailyGoal: 50, speechRate: 0.95 });
    const s = auth.createSession(db, r.lastInsertRowid);
    ctx.setCookie(auth.cookieHeader(s.token, s.expires));
    return { ok: true };
  }, { open: true });

  route('POST', '/api/auth/login', async (ctx) => {
    const b = await ctx.body();
    const username = str(b.username, 40).trim();
    if (!auth.rateLimit('login:' + ctx.ip, 20) || !auth.rateLimit('login-u:' + username.toLowerCase(), 10)) {
      throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
    }
    const u = db.prepare('SELECT id, pass_hash FROM users WHERE username = ?').get(username);
    if (!u || !auth.verifyPassword(str(b.password, 200), u.pass_hash)) throw new HttpError(401, 'Wrong username or password.');
    const s = auth.createSession(db, u.id);
    ctx.setCookie(auth.cookieHeader(s.token, s.expires));
    return { ok: true };
  }, { open: true });

  route('POST', '/api/auth/logout', (ctx) => {
    auth.destroySession(db, ctx.token);
    ctx.setCookie(auth.cookieHeader('', 0));
    return { ok: true };
  }, { open: true });

  route('POST', '/api/auth/password', async (ctx) => {
    const b = await ctx.body();
    const row = db.prepare('SELECT pass_hash FROM users WHERE id = ?').get(ctx.user.id);
    if (!auth.verifyPassword(str(b.current, 200), row.pass_hash)) throw new HttpError(400, 'Current password is wrong.');
    if (str(b.next, 200).length < 6) throw new HttpError(400, 'New password must be at least 6 characters.');
    db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(auth.hashPassword(str(b.next, 200)), ctx.user.id);
    return { ok: true };
  });

  route('DELETE', '/api/account', async (ctx) => {
    const b = await ctx.body();
    const row = db.prepare('SELECT pass_hash FROM users WHERE id = ?').get(ctx.user.id);
    if (!auth.verifyPassword(str(b.password, 200), row.pass_hash)) throw new HttpError(400, 'Password is wrong.');
    db.prepare('DELETE FROM users WHERE id = ?').run(ctx.user.id);
    ctx.setCookie(auth.cookieHeader('', 0));
    return { ok: true };
  });

  route('GET', '/api/me', (ctx) => {
    const u = ctx.user;
    return {
      user: { id: u.id, username: u.username, displayName: u.display_name, createdAt: u.created_at },
      settings: publicSettings(getSettings(u.id)),
      ai: serverAi(),
    };
  });

  route('PUT', '/api/settings', async (ctx) => {
    const b = await ctx.body();
    const s = getSettings(ctx.user.id);
    const pick = {
      theme: ['light', 'dark', 'system'], explainStyle: ['simple', 'normal', 'detailed'],
    };
    for (const [k, allowed] of Object.entries(pick)) if (allowed.includes(b[k])) s[k] = b[k];
    if (b.nativeLanguage !== undefined) s.nativeLanguage = str(b.nativeLanguage, 40);
    if (b.dailyGoal !== undefined) s.dailyGoal = Math.min(500, Math.max(10, Number(b.dailyGoal) || 50));
    if (b.speechRate !== undefined) s.speechRate = Math.min(1.5, Math.max(0.5, Number(b.speechRate) || 1));
    if (b.voice !== undefined) s.voice = str(b.voice, 120);
    if (b.aiModel !== undefined) s.aiModel = str(b.aiModel, 120).trim();
    if (b.aiReasoning !== undefined) s.aiReasoning = Boolean(b.aiReasoning);
    if (b.aiMemory !== undefined) s.aiMemory = Boolean(b.aiMemory);
    if (b.bookView !== undefined) s.bookView = Boolean(b.bookView);
    if (config.ALLOW_USER_AI) {
      if (b.aiBaseUrl !== undefined) s.aiBaseUrl = str(b.aiBaseUrl, 300).trim().replace(/\/+$/, '');
      if (b.aiApiKey !== undefined) s.aiKeyEnc = b.aiApiKey ? auth.encrypt(str(b.aiApiKey, 500).trim()) : '';
    }
    if (b.displayName !== undefined && str(b.displayName, 60).trim()) {
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(str(b.displayName, 60).trim(), ctx.user.id);
    }
    putSettings(ctx.user.id, s);
    return { settings: publicSettings(s) };
  });

  // content (needs login so each user has their own space; content itself is cacheable)
  route('GET', '/api/course', () => ({ index: course.index, sections: course.sections, refs: course.refs.map((r) => ({ slug: r.slug, title: r.title })) }));
  route('GET', '/api/units/:id', (ctx) => unitOr404(ctx.params.id));
  route('GET', '/api/refs/:slug', (ctx) => {
    const r = course.refBySlug.get(ctx.params.slug);
    if (!r) throw new HttpError(404, 'Page not found');
    return r;
  });
  route('GET', '/api/search-index', () => course.search);
  route('GET', '/api/questions', (ctx) => {
    // Resolve question ids (used by Review and Placement test).
    const ids = (ctx.query.get('ids') || '').split(',').slice(0, 200);
    const out = [];
    for (const id of ids) {
      const m = /^(\d+)-([emh])(\d+)$/.exec(id);
      const u = m && course.byId.get(Number(m[1]));
      const lv = m && { e: 'easy', m: 'medium', h: 'hard' }[m[2]];
      const q = u && u.practice[lv][Number(m[3])];
      if (q) out.push({ ...q, unit: u.id, unitTitle: u.title });
    }
    return out;
  });

  // progress & personal space
  route('GET', '/api/state', (ctx) => {
    const uid = ctx.user.id;
    const today = validDay(ctx.query.get('today'));
    const act = db.prepare('SELECT day, xp, answered, correct FROM activity WHERE user_id = ? ORDER BY day DESC LIMIT 90').all(uid);
    const total = db.prepare('SELECT COALESCE(SUM(xp),0) xp, COALESCE(SUM(answered),0) answered, COALESCE(SUM(correct),0) correct FROM activity WHERE user_id = ?').get(uid);
    return {
      progress: db.prepare('SELECT unit_id, level, best, last, attempts, updated_at FROM progress WHERE user_id = ?').all(uid),
      flags: db.prepare('SELECT unit_id, bookmarked, important, visited_at FROM unit_flags WHERE user_id = ?').all(uid),
      mistakes: db.prepare('SELECT qid, unit_id, wrong, streak, due_at FROM mistakes WHERE user_id = ? ORDER BY due_at').all(uid),
      noteCounts: db.prepare('SELECT unit_id, COUNT(*) n FROM notes WHERE user_id = ? AND unit_id IS NOT NULL GROUP BY unit_id').all(uid),
      activity: act,
      totals: { ...total, streak: streak(uid, today), today: act.find((a) => a.day === today) || { xp: 0, answered: 0, correct: 0 } },
    };
  });

  route('POST', '/api/results', async (ctx) => {
    const b = await ctx.body();
    const uid = ctx.user.id;
    const day = validDay(b.day);
    const results = Array.isArray(b.results) ? b.results.slice(0, 200) : [];
    const correct = results.filter((r) => r.correct).length;
    let xp = correct * 2;
    let pct = null;
    if (b.unitId && content.LEVELS.includes(b.level) && results.length) {
      unitOr404(b.unitId);
      pct = Math.round((correct / results.length) * 100);
      const prev = db.prepare('SELECT best FROM progress WHERE user_id = ? AND unit_id = ? AND level = ?').get(uid, b.unitId, b.level);
      if (pct >= 80 && (!prev || prev.best < 80)) xp += 10; // first pass bonus
      if (pct === 100) xp += 5;
      db.prepare(`INSERT INTO progress (user_id, unit_id, level, best, last, attempts, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(user_id, unit_id, level) DO UPDATE SET best = MAX(best, excluded.best), last = excluded.last,
        attempts = attempts + 1, updated_at = excluded.updated_at`).run(uid, b.unitId, b.level, pct, pct, now());
    }
    if (b.kind === 'exam' && results.length && correct / results.length >= 0.8) xp += 20;
    xp += Math.min(50, Math.max(0, Number(b.bonusXp) || 0));
    recordResults(uid, results);
    addActivity(uid, day, xp, results.length, correct);
    let attemptId = null;
    const KINDS = ['easy', 'medium', 'hard', 'exam', 'ai', 'review', 'mix', 'placement', 'speed', 'verbs', 'dictation', 'speaking'];
    if (KINDS.includes(b.kind) && results.length) {
      const unitId = b.unitId && course.byId.has(Number(b.unitId)) ? Number(b.unitId) : null;
      const detail = (Array.isArray(b.detail) ? b.detail : []).slice(0, 100).map((x) => ({
        q: str(x.q, 300), given: str(x.given, 200), answer: str(x.answer, 200), correct: Boolean(x.correct), e: str(x.e, 300),
      }));
      attemptId = Number(db.prepare(`INSERT INTO attempts (user_id, unit_id, kind, title, score, total, detail, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(uid, unitId, b.kind, str(b.title, 100), correct, results.length, JSON.stringify(detail), now()).lastInsertRowid);
    }
    return { xp, pct, attemptId };
  });

  route('PUT', '/api/flags/:id', async (ctx) => {
    const u = unitOr404(ctx.params.id);
    const b = await ctx.body();
    db.prepare('INSERT INTO unit_flags (user_id, unit_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(ctx.user.id, u.id);
    if (b.bookmarked !== undefined) db.prepare('UPDATE unit_flags SET bookmarked = ? WHERE user_id = ? AND unit_id = ?').run(b.bookmarked ? 1 : 0, ctx.user.id, u.id);
    if (b.important !== undefined) db.prepare('UPDATE unit_flags SET important = ? WHERE user_id = ? AND unit_id = ?').run(b.important ? 1 : 0, ctx.user.id, u.id);
    if (b.visited) db.prepare('UPDATE unit_flags SET visited_at = ? WHERE user_id = ? AND unit_id = ?').run(now(), ctx.user.id, u.id);
    return db.prepare('SELECT unit_id, bookmarked, important, visited_at FROM unit_flags WHERE user_id = ? AND unit_id = ?').get(ctx.user.id, u.id);
  });

  // notes
  route('GET', '/api/notes', (ctx) => {
    const unit = ctx.query.get('unit');
    return unit
      ? db.prepare('SELECT * FROM notes WHERE user_id = ? AND unit_id = ? ORDER BY updated_at DESC').all(ctx.user.id, Number(unit))
      : db.prepare('SELECT * FROM notes WHERE user_id = ? ORDER BY updated_at DESC').all(ctx.user.id);
  });
  const COLORS = ['yellow', 'green', 'blue', 'pink', 'purple'];
  route('POST', '/api/notes', async (ctx) => {
    const b = await ctx.body();
    const unitId = b.unitId ? unitOr404(b.unitId).id : null;
    const t = now();
    const r = db.prepare('INSERT INTO notes (user_id, unit_id, title, body, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(ctx.user.id, unitId, str(b.title, 200), str(b.body, 20000), COLORS.includes(b.color) ? b.color : 'yellow', t, t);
    return db.prepare('SELECT * FROM notes WHERE id = ?').get(r.lastInsertRowid);
  });
  route('PUT', '/api/notes/:id', async (ctx) => {
    const b = await ctx.body();
    const n = db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?').get(Number(ctx.params.id), ctx.user.id);
    if (!n) throw new HttpError(404, 'Note not found');
    db.prepare('UPDATE notes SET title = ?, body = ?, color = ?, updated_at = ? WHERE id = ?').run(
      b.title !== undefined ? str(b.title, 200) : n.title, b.body !== undefined ? str(b.body, 20000) : n.body,
      COLORS.includes(b.color) ? b.color : n.color, now(), n.id);
    return db.prepare('SELECT * FROM notes WHERE id = ?').get(n.id);
  });
  route('DELETE', '/api/notes/:id', (ctx) => {
    db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(Number(ctx.params.id), ctx.user.id);
    return { ok: true };
  });

  // saved items (sentences, AI answers, questions)
  route('GET', '/api/saved', (ctx) => db.prepare('SELECT * FROM saved WHERE user_id = ? ORDER BY created_at DESC').all(ctx.user.id));
  route('POST', '/api/saved', async (ctx) => {
    const b = await ctx.body();
    const kind = ['example', 'ai', 'question', 'word'].includes(b.kind) ? b.kind : 'example';
    const text = str(b.text, 8000).trim();
    if (!text) throw new HttpError(400, 'Nothing to save');
    const unitId = b.unitId ? unitOr404(b.unitId).id : null;
    const dup = db.prepare('SELECT * FROM saved WHERE user_id = ? AND kind = ? AND text = ?').get(ctx.user.id, kind, text);
    if (dup) return dup;
    const r = db.prepare('INSERT INTO saved (user_id, unit_id, kind, text, extra, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(ctx.user.id, unitId, kind, text, str(b.extra, 2000), now());
    return db.prepare('SELECT * FROM saved WHERE id = ?').get(r.lastInsertRowid);
  });
  route('DELETE', '/api/saved/:id', (ctx) => {
    db.prepare('DELETE FROM saved WHERE id = ? AND user_id = ?').run(Number(ctx.params.id), ctx.user.id);
    return { ok: true };
  });

  route('GET', '/api/export', (ctx) => {
    const uid = ctx.user.id;
    const q = (sql) => db.prepare(sql).all(uid);
    return {
      exportedAt: new Date().toISOString(),
      user: { username: ctx.user.username, displayName: ctx.user.display_name },
      progress: q('SELECT unit_id, level, best, last, attempts FROM progress WHERE user_id = ?'),
      flags: q('SELECT unit_id, bookmarked, important FROM unit_flags WHERE user_id = ?'),
      notes: q('SELECT unit_id, title, body, color, created_at, updated_at FROM notes WHERE user_id = ?'),
      saved: q('SELECT unit_id, kind, text, extra, created_at FROM saved WHERE user_id = ?'),
      activity: q('SELECT day, xp, answered, correct FROM activity WHERE user_id = ?'),
      chats: q(`SELECT t.scope, t.title, m.role, m.content, m.created_at FROM messages m JOIN threads t ON t.id = m.thread_id
        WHERE t.user_id = ? ORDER BY m.id`),
      memory: q('SELECT scope, text FROM memory WHERE user_id = ?'),
      results: q('SELECT unit_id, kind, title, score, total, created_at FROM attempts WHERE user_id = ?'),
    };
  });

  // ---------- AI ----------
  /** True if a hint gives away the answer (long answers anywhere; short ones when quoted/bold or "the answer is …"). */
  function leaksAnswer(hint, answer) {
    const h = hint.toLowerCase();
    for (const raw of answer.split(/\s*[\/|]\s*/)) {
      for (const a of raw.split(/\s*,\s*/).map((x) => x.trim().toLowerCase()).filter(Boolean)) {
        const e = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (a.length > 3 && new RegExp(`(^|\\W)${e}(\\W|$)`).test(h)) return true;
        if (new RegExp(`["'“‘*]\\s*${e}\\s*["'”’*]|answer (is|would be)\\s*:?\\s*${e}(\\W|$)`).test(h)) return true;
      }
    }
    return false;
  }

  const scopeOf = (s) => (/^(general|unit:\d+)$/.test(s) ? s : null);
  const scopeName = (scope) => (scope === 'general' ? 'General English chat' : `Unit ${scope.slice(5)}: ${course.byId.get(Number(scope.slice(5)))?.title || ''}`);
  const ownThread = (uid, id) => {
    const t = db.prepare('SELECT * FROM threads WHERE id = ? AND user_id = ?').get(Number(id), uid);
    if (!t) throw new HttpError(404, 'Chat not found');
    return t;
  };

  // threads (separate conversations, like "New chat")
  route('GET', '/api/threads', (ctx) => {
    const scope = ctx.query.get('scope');
    const sql = `SELECT t.id, t.scope, t.title, t.created_at, t.updated_at, (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id) n
      FROM threads t WHERE t.user_id = ? ${scope ? 'AND t.scope = ?' : ''} ORDER BY t.updated_at DESC LIMIT 200`;
    return scope ? db.prepare(sql).all(ctx.user.id, scope) : db.prepare(sql).all(ctx.user.id);
  });
  route('POST', '/api/threads', async (ctx) => {
    const b = await ctx.body();
    const scope = scopeOf(b.scope);
    if (!scope) throw new HttpError(400, 'Bad scope');
    const t = now();
    const r = db.prepare('INSERT INTO threads (user_id, scope, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(ctx.user.id, scope, 'New chat', t, t);
    return db.prepare('SELECT id, scope, title, created_at, updated_at, 0 n FROM threads WHERE id = ?').get(r.lastInsertRowid);
  });
  route('GET', '/api/threads/:id', (ctx) => {
    const t = ownThread(ctx.user.id, ctx.params.id);
    return { thread: t, messages: db.prepare('SELECT id, role, content, reasoning, created_at FROM messages WHERE thread_id = ? ORDER BY id').all(t.id) };
  });
  route('PUT', '/api/threads/:id', async (ctx) => {
    const t = ownThread(ctx.user.id, ctx.params.id);
    const b = await ctx.body();
    db.prepare('UPDATE threads SET title = ? WHERE id = ?').run(str(b.title, 80).trim() || t.title, t.id);
    return { ok: true };
  });
  route('DELETE', '/api/threads/:id', (ctx) => {
    const t = ownThread(ctx.user.id, ctx.params.id);
    db.prepare('DELETE FROM threads WHERE id = ?').run(t.id);
    return { ok: true };
  });

  // memory (what the tutor remembers, per unit and general)
  const memoriesFor = (uid, scope) => db.prepare(
    `SELECT scope, text FROM memory WHERE user_id = ? AND (scope = 'general' ${scope !== 'general' ? 'OR scope = ?' : ''})`)
    .all(...(scope !== 'general' ? [uid, scope] : [uid]));
  route('GET', '/api/memory', (ctx) => db.prepare('SELECT scope, text, updated_at FROM memory WHERE user_id = ? ORDER BY updated_at DESC').all(ctx.user.id));
  route('PUT', '/api/memory', async (ctx) => {
    const b = await ctx.body();
    const scope = scopeOf(b.scope);
    if (!scope) throw new HttpError(400, 'Bad scope');
    const text = str(b.text, 2000).trim();
    if (!text) db.prepare('DELETE FROM memory WHERE user_id = ? AND scope = ?').run(ctx.user.id, scope);
    else db.prepare(`INSERT INTO memory (user_id, scope, text, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, scope) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`).run(ctx.user.id, scope, text, now());
    return { ok: true };
  });

  async function updateMemory(user, p, thread) {
    const msgs = db.prepare('SELECT role, content FROM messages WHERE thread_id = ? ORDER BY id').all(thread.id);
    const fresh = msgs.slice(thread.remembered);
    if (fresh.length < 6) return;
    const old = db.prepare('SELECT text FROM memory WHERE user_id = ? AND scope = ?').get(user.id, thread.scope)?.text || '';
    const transcript = fresh.map((m) => `${m.role === 'user' ? 'Learner' : 'Tutor'}: ${m.content.slice(0, 600)}`).join('\n').slice(-6000);
    const text = (await ai.complete(p, ai.memoryPrompt(old, transcript, scopeName(thread.scope)), { maxTokens: 300, temperature: 0.2 })).trim();
    if (text) {
      db.prepare(`INSERT INTO memory (user_id, scope, text, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, scope) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`).run(user.id, thread.scope, text.slice(0, 2000), now());
    }
    db.prepare('UPDATE threads SET remembered = ? WHERE id = ?').run(msgs.length, thread.id);
  }

  function aiContext(ctx, scope, { voice = false } = {}) {
    const settings = getSettings(ctx.user.id);
    const p = ai.providerFor(settings, auth.decrypt);
    if (!p.apiKey && !p.userUrl) throw new HttpError(400, 'AI is not set up yet. Add an API key in Settings → AI Tutor.');
    const memories = settings.aiMemory === false ? [] : memoriesFor(ctx.user.id, scope);
    const profile = ai.learnerProfile(ctx.user, settings, weakUnits(ctx.user.id), memories);
    let system;
    let unit = null;
    if (scope.startsWith('unit:')) {
      unit = unitOr404(scope.slice(5));
      system = ai.unitSystemPrompt(content.unitContext(unit), profile, unitList);
    } else {
      system = ai.generalSystemPrompt(profile, unitList);
    }
    if (voice) system += '\n' + ai.VOICE_RULES;
    return { p, system, unit, settings };
  }

  route('POST', '/api/ai/chat', async (ctx) => {
    const b = await ctx.body();
    const message = str(b.message, 6000).trim();
    if (!message) throw new HttpError(400, 'Empty message');
    if (!auth.rateLimit('ai:' + ctx.user.id, 60, 60e3)) throw new HttpError(429, 'Slow down a little — too many AI requests.');
    let thread;
    if (b.threadId) thread = ownThread(ctx.user.id, b.threadId);
    else {
      const scope = scopeOf(b.scope);
      if (!scope) throw new HttpError(400, 'Bad scope');
      const t = now();
      const r = db.prepare('INSERT INTO threads (user_id, scope, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(ctx.user.id, scope, 'New chat', t, t);
      thread = db.prepare('SELECT * FROM threads WHERE id = ?').get(r.lastInsertRowid);
    }
    const { p, system, settings } = aiContext(ctx, thread.scope, { voice: Boolean(b.voice) });
    const history = db.prepare('SELECT role, content FROM messages WHERE thread_id = ? ORDER BY id DESC LIMIT 20').all(thread.id).reverse();
    const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content: message }];

    const { res } = ctx;
    const ac = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ac.abort(); });
    let started = false;
    const ev = (obj) => {
      if (!started) {
        started = true;
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
        res.write(`data: ${JSON.stringify({ threadId: thread.id })}\n\n`);
      }
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    };
    let reasoning = '';
    try {
      const full = await ai.streamChat(p, messages, {
        onDelta: (t) => ev({ t }),
        onReasoning: (r) => { reasoning += r; ev({ r }); },
        signal: ac.signal,
        maxTokens: b.voice ? 300 : 1400,
        reasoning: b.voice ? false : undefined,
      });
      const t = now();
      const ins = db.prepare('INSERT INTO messages (thread_id, role, content, reasoning, created_at) VALUES (?, ?, ?, ?, ?)');
      ins.run(thread.id, 'user', message, '', t);
      if (full) ins.run(thread.id, 'assistant', full, reasoning.slice(0, 20000), t);
      const title = thread.title === 'New chat' ? message.replace(/\s+/g, ' ').slice(0, 60) : thread.title;
      db.prepare('UPDATE threads SET updated_at = ?, title = ? WHERE id = ?').run(t, title, thread.id);
      ev({ done: true, threadId: thread.id, title });
      if (settings.aiMemory !== false) updateMemory(ctx.user, p, { ...thread }).catch((e) => console.error('memory update failed:', e.message));
    } catch (e) {
      if (ac.signal.aborted) { res.end(); return ctx.HANDLED; }
      if (!started) throw e.status ? e : new HttpError(502, `Could not reach the AI provider: ${e.message}`);
      ev({ error: e.message });
    }
    res.end();
    return ctx.HANDLED;
  });

  route('POST', '/api/ai/quiz', async (ctx) => {
    const b = await ctx.body();
    const unit = unitOr404(b.unitId);
    if (!auth.rateLimit('ai:' + ctx.user.id, 60, 60e3)) throw new HttpError(429, 'Too many AI requests.');
    const level = content.LEVELS.includes(b.level) ? b.level : 'medium';
    const count = Math.min(15, Math.max(3, Number(b.count) || 8));
    const { p } = aiContext(ctx, `unit:${unit.id}`);
    const text = await ai.complete(p, ai.quizPrompt(content.unitContext(unit), level, count, str(b.focus, 300)));
    return { questions: ai.parseQuiz(text) };
  });

  route('POST', '/api/ai/hint', async (ctx) => {
    const b = await ctx.body();
    if (!auth.rateLimit('ai:' + ctx.user.id, 60, 60e3)) throw new HttpError(429, 'Too many AI requests.');
    const q = b.question || {};
    const unit = q.unit ? course.byId.get(Number(q.unit)) : null;
    const { p } = aiContext(ctx, unit ? `unit:${unit.id}` : 'general');
    const clean = {
      t: str(q.t, 10), q: str(q.q, 500), o: Array.isArray(q.o) ? q.o.slice(0, 6).map((x) => str(x, 100)) : null,
      words: str(q.words, 300), attempt: str(q.attempt, 300), answer: str(q.answer, 300),
    };
    let hint = (await ai.complete(p, ai.hintPrompt(clean, unit ? content.unitContext(unit) : ''), { maxTokens: 150, temperature: 0.4 })).trim();
    // Safety net: never leak the exact answer.
    if (leaksAnswer(hint, clean.answer)) hint = 'Think about the rule in this unit: look carefully at the subject and the time of the sentence, then try again.';
    return { hint };
  });

  route('POST', '/api/ai/feedback', async (ctx) => {
    const b = await ctx.body();
    if (!auth.rateLimit('ai:' + ctx.user.id, 60, 60e3)) throw new HttpError(429, 'Too many AI requests.');
    const unit = b.unitId ? course.byId.get(Number(b.unitId)) : null;
    const { p } = aiContext(ctx, unit ? `unit:${unit.id}` : 'general');
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 40).map((x) => ({
      q: str(x.q, 300), given: str(x.given, 200), answer: str(x.answer, 200), correct: Boolean(x.correct),
    }));
    const score = items.filter((x) => x.correct).length;
    const text = await ai.complete(p, ai.feedbackPrompt(str(b.title, 100), unit ? content.unitContext(unit) : '', items, score, items.length), { maxTokens: 700, temperature: 0.4 });
    if (b.attemptId) db.prepare('UPDATE attempts SET feedback = ? WHERE id = ? AND user_id = ?').run(text.slice(0, 8000), Number(b.attemptId), ctx.user.id);
    return { text };
  });

  route('POST', '/api/ai/flow', async (ctx) => {
    const b = await ctx.body();
    const unit = unitOr404(b.unitId);
    const key = `flow:${unit.id}`;
    const cached = db.prepare('SELECT json FROM ai_cache WHERE key = ?').get(key);
    if (cached && !b.refresh) return JSON.parse(cached.json);
    if (!auth.rateLimit('ai:' + ctx.user.id, 60, 60e3)) throw new HttpError(429, 'Too many AI requests.');
    const { p } = aiContext(ctx, `unit:${unit.id}`);
    const flow = ai.parseFlow(await ai.complete(p, ai.flowPrompt(content.unitContext(unit)), { maxTokens: 1500, temperature: 0.3 }));
    db.prepare('INSERT INTO ai_cache (key, json, created_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, created_at = excluded.created_at')
      .run(key, JSON.stringify(flow), now());
    return flow;
  });

  route('POST', '/api/ai/models', async (ctx) => {
    const b = await ctx.body();
    const s = getSettings(ctx.user.id);
    const trial = { ...s };
    if (config.ALLOW_USER_AI && b.aiBaseUrl !== undefined) trial.aiBaseUrl = str(b.aiBaseUrl, 300).trim();
    if (config.ALLOW_USER_AI && b.aiApiKey) trial.aiKeyEnc = auth.encrypt(str(b.aiApiKey, 500));
    return { models: await ai.listModels(ai.providerFor(trial, auth.decrypt)) };
  });

  route('POST', '/api/ai/test', async (ctx) => {
    const s = getSettings(ctx.user.id);
    const p = ai.providerFor(s, auth.decrypt);
    const t0 = now();
    const text = await ai.complete(p, [{ role: 'user', content: 'Reply with exactly: Hello, learner!' }], { maxTokens: 30 });
    return { ok: true, reply: text.trim(), ms: now() - t0, model: p.model };
  });

  // results history and drawing canvas
  route('GET', '/api/attempts', (ctx) => {
    const unit = ctx.query.get('unit');
    const cols = 'id, unit_id, kind, title, score, total, created_at, feedback != \'\' has_feedback';
    return unit
      ? db.prepare(`SELECT ${cols} FROM attempts WHERE user_id = ? AND unit_id = ? ORDER BY created_at DESC LIMIT 100`).all(ctx.user.id, Number(unit))
      : db.prepare(`SELECT ${cols} FROM attempts WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`).all(ctx.user.id);
  });
  route('GET', '/api/attempts/:id', (ctx) => {
    const a = db.prepare('SELECT * FROM attempts WHERE id = ? AND user_id = ?').get(Number(ctx.params.id), ctx.user.id);
    if (!a) throw new HttpError(404, 'Result not found');
    return { ...a, detail: JSON.parse(a.detail) };
  });
  route('GET', '/api/canvas/:id', (ctx) => db.prepare('SELECT data, updated_at FROM canvases WHERE user_id = ? AND unit_id = ?').get(ctx.user.id, unitOr404(ctx.params.id).id) || { data: '' });
  route('PUT', '/api/canvas/:id', async (ctx) => {
    const u = unitOr404(ctx.params.id);
    const b = await ctx.body(4 * 1024 * 1024);
    const data = str(b.data, 4 * 1024 * 1024);
    if (data && !data.startsWith('data:image/png;base64,')) throw new HttpError(400, 'Canvas must be a PNG');
    if (!data) db.prepare('DELETE FROM canvases WHERE user_id = ? AND unit_id = ?').run(ctx.user.id, u.id);
    else db.prepare(`INSERT INTO canvases (user_id, unit_id, data, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, unit_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`).run(ctx.user.id, u.id, data, now());
    return { ok: true };
  });

  // ---------- server ----------
  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    try {
      if (p.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          // CSRF guard: browsers cannot send JSON cross-site without CORS preflight, and we never allow CORS.
          const origin = req.headers.origin;
          if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Cross-origin request blocked');
        }
        for (const r of routes) {
          if (r.method !== req.method && !(r.method === 'GET' && req.method === 'HEAD')) continue;
          const m = r.re.exec(p);
          if (!m) continue;
          const token = cookies(req).sid;
          const user = auth.sessionUser(db, token);
          if (!r.open && !user) throw new HttpError(401, 'Please log in.');
          const setCookies = [];
          const HANDLED = Symbol('handled');
          const ctx = {
            req, res, user, token, HANDLED, query: url.searchParams,
            ip: req.socket.remoteAddress,
            params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])),
            body: (limit) => readJson(req, limit),
            setCookie: (c) => setCookies.push(c),
          };
          const out = await r.handler(ctx);
          if (out === HANDLED) return;
          if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
          return json(req, res, out);
        }
        throw new HttpError(404, 'Not found');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
      if (serveStatic(req, res, PUBLIC, p === '/' ? '/index.html' : p)) return;
      // SPA fallback
      serveStatic(req, res, PUBLIC, '/index.html');
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      if (res.headersSent) { res.end(); return; }
      json(req, res, { error: status === 500 ? 'Server error' : e.message }, status);
    }
  }

  const server = http.createServer((req, res) => {
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; media-src 'self' blob:");
    handle(req, res);
  });
  // periodic cleanup of expired sessions
  const timer = setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now()), 3600e3);
  timer.unref();
  server.on('close', () => { clearInterval(timer); db.close(); });
  return { server, db, course, send };
}

module.exports = { createApp };

if (require.main === module) {
  const { server, course } = createApp();
  server.listen(config.PORT, config.HOST, () => {
    console.log(`English Path running on http://${config.HOST === '0.0.0.0' ? 'localhost' : config.HOST}:${config.PORT}`);
    console.log(`Loaded ${course.units.length} units, ${course.refs.length} reference pages. Data: ${config.DATA_DIR}`);
    if (!config.AI_API_KEY) console.log('Note: AI_API_KEY is not set — users must add their own AI key in Settings.');
  });
}
