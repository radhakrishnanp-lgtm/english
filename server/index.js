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
  const serverAi = () => {
    const d = aiDefaults();
    return { baseUrl: d.baseUrl, model: d.model, configured: Boolean(d.apiKey), allowUserAi: d.allowUserAi };
  };

  const validDay = (d) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : new Date().toISOString().slice(0, 10));
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const unitOr404 = (id) => {
    const u = course.byId.get(Number(id));
    if (!u) throw new HttpError(404, 'Unit not found');
    return u;
  };

  // ---------- app-wide settings (editable by admin; .env values are defaults) ----------
  const getApp = (k, d) => { const r = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(k); return r ? JSON.parse(r.value) : d; };
  const setApp = (k, v) => db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, JSON.stringify(v));
  const aiDefaults = () => ({
    baseUrl: getApp('aiBaseUrl', '') || config.AI_BASE_URL,
    apiKey: auth.decrypt(getApp('aiKeyEnc', '')) || config.AI_API_KEY,
    model: getApp('aiModel', '') || config.AI_MODEL,
    allowUserAi: getApp('allowUserAi', config.ALLOW_USER_AI),
  });
  const userCount = () => db.prepare('SELECT COUNT(*) n FROM users').get().n;
  const registrationOpen = () => userCount() === 0 || getApp('registration', config.ALLOW_REGISTRATION ? 'open' : 'closed') === 'open';
  const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

  const MIN_PW = 8;
  function checkNewPassword(pw, username = '') {
    pw = str(pw, 200);
    if (pw.length < MIN_PW) throw new HttpError(400, `Password must be at least ${MIN_PW} characters.`);
    if (username && pw.toLowerCase().includes(String(username).toLowerCase())) throw new HttpError(400, 'Password must not contain the user name.');
    if (/^(.)\1+$/.test(pw) || ['password', '12345678', '123456789', 'qwertyui', 'abcdefgh'].includes(pw.toLowerCase())) throw new HttpError(400, 'That password is too easy to guess.');
  }

  function createUser({ username, displayName, password, role = 'user', aiEnabled = true, aiDailyTokens = 0 }) {
    username = str(username, 40).trim();
    if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) throw new HttpError(400, 'Username: 3-40 letters, numbers, _ . -');
    checkNewPassword(password, username);
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'That username is taken.');
    const r = db.prepare('INSERT INTO users (username, display_name, pass_hash, created_at, role, ai_enabled, ai_daily_tokens) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(username, str(displayName, 60).trim() || username, auth.hashPassword(str(password, 200)), now(), role === 'admin' ? 'admin' : 'user', aiEnabled ? 1 : 0, Math.max(0, Number(aiDailyTokens) || 0));
    putSettings(r.lastInsertRowid, { theme: 'system', explainStyle: 'simple', dailyGoal: 50, speechRate: 0.95 });
    return Number(r.lastInsertRowid);
  }

  // Bootstrap an admin from ADMIN_USERNAME / ADMIN_PASSWORD.
  if (config.ADMIN_USERNAME && config.ADMIN_PASSWORD) {
    const ex = db.prepare('SELECT id FROM users WHERE username = ?').get(config.ADMIN_USERNAME);
    if (ex) db.prepare("UPDATE users SET role = 'admin', disabled = 0 WHERE id = ?").run(ex.id);
    else createUser({ username: config.ADMIN_USERNAME, password: config.ADMIN_PASSWORD, displayName: 'Admin', role: 'admin' });
  }

  // ---------- AI usage tracking ----------
  const insUsage = db.prepare(`INSERT INTO ai_usage (user_id, kind, model, provider, prompt_tokens, completion_tokens, reasoning_tokens, cost, cost_source, estimated, ms, ok, error, thread_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  function priceFor(model) { const pr = getApp('prices', {}); return Object.hasOwn(pr, model) ? pr[model] : null; }
  /** Run an AI call, stream it if wanted, and log tokens / cost / time for the admin. */
  async function aiRun(user, kind, p, messages, opts = {}, threadId = null) {
    const t0 = now();
    let usage = null;
    let out = '';
    const onDelta = opts.onDelta;
    try {
      out = await ai.streamChat(p, messages, { ...opts, onDelta: (d) => { out += d; onDelta?.(d); }, onUsage: (u) => { usage = u; } });
      logUsage(user, kind, p, messages, out, usage, now() - t0, true, '', threadId);
      return out;
    } catch (e) {
      if (!opts.signal?.aborted) logUsage(user, kind, p, messages, out, usage, now() - t0, false, String(e.message || e).slice(0, 300), threadId);
      throw e;
    }
  }
  function logUsage(user, kind, p, messages, out, usage, ms, ok, error, threadId) {
    const estimated = !usage || (!usage.prompt && !usage.completion);
    const pt = estimated ? Math.ceil(messages.reduce((n, m) => n + String(m.content).length, 0) / 4) : usage.prompt;
    const ct = estimated ? Math.ceil(out.length / 4) : usage.completion;
    let cost = 0;
    let src = 'unknown';
    if (usage && typeof usage.cost === 'number') { cost = usage.cost; src = 'provider'; }
    else { const pr = priceFor(p.model); if (pr) { cost = (pt * pr.in + ct * pr.out) / 1e6; src = 'price-table'; } }
    if (!Number.isFinite(cost) || cost < 0) { cost = 0; src = 'unknown'; }
    let host = '';
    try { host = new URL(p.baseUrl).host; } catch { /* ignore */ }
    insUsage.run(user?.id ?? null, kind, p.model || '', host, pt, ct, usage?.reasoning || 0, cost, src, estimated ? 1 : 0, ms, ok ? 1 : 0, error, threadId, now());
  }
  const tokensToday = (uid) => db.prepare('SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) n FROM ai_usage WHERE user_id = ? AND created_at >= ?').get(uid, dayStart()).n;

  // ---------- memory model (FSRS-style forgetting curve) ----------
  // R(t) = (1 + 19/81 · t/S)^-0.5, where S (stability, days) is when recall chance falls to 90%.
  const DAY = 86400e3;
  const retrievability = (S, ms) => Math.pow(1 + (19 / 81) * (ms / DAY) / Math.max(0.1, S), -0.5);
  const srsGet = db.prepare('SELECT * FROM srs WHERE user_id = ? AND key = ?');
  const srsPut = db.prepare(`INSERT INTO srs (user_id, key, kind, unit_id, stability, reps, lapses, last_review, due_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET stability = excluded.stability, reps = excluded.reps, lapses = excluded.lapses,
    last_review = excluded.last_review, due_at = excluded.due_at`);
  /** Record one review. success = remembered. Returns the new stability (days). */
  function srsReview(uid, key, kind, unitId, success, { firstStability = 1 } = {}) {
    const t = now();
    const row = srsGet.get(uid, key);
    let S; let reps = 0; let lapses = 0;
    if (!row) S = success ? firstStability : 0.4;
    else {
      reps = row.reps; lapses = row.lapses;
      const R = retrievability(row.stability, t - row.last_review);
      // Harder successful recalls (lower R) grow memory more — the "desirable difficulty" effect.
      if (success) S = Math.min(365, row.stability * (1.6 + 3 * (1 - R)) + 0.2);
      else { S = Math.max(0.4, row.stability * 0.35); lapses++; }
    }
    reps++;
    srsPut.run(uid, key, kind, unitId, S, reps, lapses, t, t + S * DAY);
    return S;
  }
  const srsEnsure = (uid, key, kind, unitId, S = 1) => {
    if (!srsGet.get(uid, key)) srsPut.run(uid, key, kind, unitId, S, 0, 0, now(), now() + S * DAY);
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
  const route = (method, pattern, handler, { open = false, admin = false } = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler, open, admin });
  };

  // auth
  route('GET', '/api/config', () => ({ allowRegistration: registrationOpen(), setup: userCount() === 0 }), { open: true });

  route('POST', '/api/auth/register', async (ctx) => {
    if (!registrationOpen()) throw new HttpError(403, 'Only the admin can create accounts on this server. Please ask your admin.');
    if (!auth.rateLimit('reg:' + ctx.ip, config.REGISTER_LIMIT, 60 * 60e3)) throw new HttpError(429, 'Too many attempts. Try again later.');
    const b = await ctx.body();
    if (!registrationOpen()) throw new HttpError(403, 'Only the admin can create accounts on this server. Please ask your admin.');
    const first = userCount() === 0;
    const id = createUser({ username: b.username, displayName: b.displayName, password: b.password, role: first ? 'admin' : 'user' });
    const sess = auth.createSession(db, id);
    ctx.setCookie(auth.cookieHeader(sess.token, sess.expires));
    return { ok: true, admin: first };
  }, { open: true });

  route('POST', '/api/auth/login', async (ctx) => {
    const b = await ctx.body();
    const username = str(b.username, 40).trim();
    const password = str(b.password, 200);
    const ipKey = 'login-ip:' + ctx.ip;
    const userKey = 'login-u:' + username.toLowerCase();
    // Only failed attempts count, so real users are not locked out by their own logins.
    if (auth.recentHits(ipKey) >= 30 || auth.recentHits(userKey) >= 10) throw new HttpError(429, 'Too many failed attempts. Try again in a few minutes.');
    const u = username ? db.prepare('SELECT id, pass_hash, disabled FROM users WHERE username = ?').get(username) : null;
    const ok = u ? auth.verifyPassword(password, u.pass_hash) : auth.verifyDummy(password);
    if (!ok) { auth.hit(ipKey); auth.hit(userKey); throw new HttpError(401, 'Wrong username or password.'); }
    if (u.disabled) throw new HttpError(403, 'This account is turned off. Please contact your admin.');
    const sess = auth.createSession(db, u.id);
    ctx.setCookie(auth.cookieHeader(sess.token, sess.expires));
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
    if (auth.recentHits('pw:' + ctx.user.id) >= 10) throw new HttpError(429, 'Too many attempts. Try again later.');
    if (!auth.verifyPassword(str(b.current, 200), row.pass_hash)) { auth.hit('pw:' + ctx.user.id); throw new HttpError(400, 'Current password is wrong.'); }
    checkNewPassword(b.next, ctx.user.username);
    db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(auth.hashPassword(str(b.next, 200)), ctx.user.id);
    auth.destroyOtherSessions(db, ctx.user.id, ctx.token);
    return { ok: true };
  });

  route('DELETE', '/api/account', async (ctx) => {
    const b = await ctx.body();
    const row = db.prepare('SELECT pass_hash FROM users WHERE id = ?').get(ctx.user.id);
    if (auth.recentHits('pw:' + ctx.user.id) >= 10) throw new HttpError(429, 'Too many attempts. Try again later.');
    if (!auth.verifyPassword(str(b.password, 200), row.pass_hash)) { auth.hit('pw:' + ctx.user.id); throw new HttpError(400, 'Password is wrong.'); }
    if (ctx.user.role === 'admin' && db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND disabled = 0").get().n <= 1) {
      throw new HttpError(400, 'You are the only admin. Make another admin first.');
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(ctx.user.id);
    ctx.setCookie(auth.cookieHeader('', 0));
    return { ok: true };
  });

  route('GET', '/api/me', (ctx) => {
    const u = ctx.user;
    return {
      user: { id: u.id, username: u.username, displayName: u.display_name, createdAt: u.created_at, role: u.role, aiEnabled: Boolean(u.ai_enabled), aiDailyTokens: u.ai_daily_tokens },
      settings: publicSettings(getSettings(u.id)),
      ai: serverAi(),
      resume: JSON.parse(db.prepare('SELECT resume FROM users WHERE id = ?').get(u.id).resume || 'null'),
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
    if (aiDefaults().allowUserAi) {
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
      memory: db.prepare("SELECT key, kind, unit_id, stability, reps, lapses, last_review, due_at FROM srs WHERE user_id = ? AND kind = 'unit'").all(uid),
      reviewDue: db.prepare('SELECT COUNT(*) n FROM srs WHERE user_id = ? AND due_at <= ?').get(uid, now()).n
        + db.prepare('SELECT COUNT(*) n FROM mistakes WHERE user_id = ? AND due_at <= ?').get(uid, now()).n,
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
    // Memory schedule: a passed level puts the unit on the review timeline.
    if (pct !== null && pct >= 80) srsEnsure(uid, `unit:${Number(b.unitId)}`, 'unit', Number(b.unitId), pct === 100 ? 2 : 1);
    for (const r of results) {
      const m = /^verb-([a-z]+)$/.exec(str(r.qid, 40));
      if (m) srsReview(uid, `verb:${m[1]}`, 'verb', null, Boolean(r.correct));
    }
    let attemptId = null;
    const KINDS = ['easy', 'medium', 'hard', 'exam', 'ai', 'review', 'mix', 'placement', 'speed', 'verbs', 'dictation', 'speaking', 'game', 'today'];
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
    if (db.prepare('SELECT COUNT(*) n FROM notes WHERE user_id = ?').get(ctx.user.id).n >= 2000) throw new HttpError(400, 'You have too many notes (2000). Delete some first.');
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
    const kind = ['example', 'ai', 'question', 'word', 'writing', 'recall'].includes(b.kind) ? b.kind : 'example';
    const text = str(b.text, 8000).trim();
    if (!text) throw new HttpError(400, 'Nothing to save');
    const unitId = b.unitId ? unitOr404(b.unitId).id : null;
    const dup = db.prepare('SELECT * FROM saved WHERE user_id = ? AND kind = ? AND text = ?').get(ctx.user.id, kind, text);
    if (dup) return dup;
    if (db.prepare('SELECT COUNT(*) n FROM saved WHERE user_id = ?').get(ctx.user.id).n >= 5000) throw new HttpError(400, 'You have too many saved items (5000). Delete some first.');
    const r = db.prepare('INSERT INTO saved (user_id, unit_id, kind, text, extra, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(ctx.user.id, unitId, kind, text, str(b.extra, 2000), now());
    if (kind !== 'ai') srsEnsure(ctx.user.id, `card:${r.lastInsertRowid}`, 'card', unitId, 1);
    return db.prepare('SELECT * FROM saved WHERE id = ?').get(r.lastInsertRowid);
  });
  route('DELETE', '/api/saved/:id', (ctx) => {
    db.prepare('DELETE FROM saved WHERE id = ? AND user_id = ?').run(Number(ctx.params.id), ctx.user.id);
    db.prepare('DELETE FROM srs WHERE user_id = ? AND key = ?').run(ctx.user.id, `card:${Number(ctx.params.id)}`);
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
    const text = (await aiRun(user, 'memory', p, ai.memoryPrompt(old, transcript, scopeName(thread.scope)), { maxTokens: 300, temperature: 0.2, reasoning: false }, thread.id)).trim();
    if (text) {
      db.prepare(`INSERT INTO memory (user_id, scope, text, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, scope) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`).run(user.id, thread.scope, text.slice(0, 2000), now());
    }
    db.prepare('UPDATE threads SET remembered = ? WHERE id = ?').run(msgs.length, thread.id);
  }

  function aiContext(ctx, scope, { voice = false } = {}) {
    const settings = getSettings(ctx.user.id);
    if (!ctx.user.ai_enabled) throw new HttpError(403, 'The AI tutor is turned off for your account. Please ask your admin.');
    const p = ai.providerFor(settings, auth.decrypt, aiDefaults());
    if (!p.apiKey && !p.userUrl) throw new HttpError(400, 'AI is not set up yet. Ask your admin, or add an API key in Settings → AI Tutor.');
    const limit = ctx.user.ai_daily_tokens || getApp('defaultDailyTokens', 0);
    if (limit > 0 && !p.ownKey && tokensToday(ctx.user.id) >= limit) throw new HttpError(429, `You have used today's AI limit (${limit.toLocaleString()} tokens). It resets at midnight.`);
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
      const full = await aiRun(ctx.user, b.voice ? 'voice' : 'chat', p, messages, {
        onDelta: (t) => ev({ t }),
        onReasoning: (r) => { reasoning += r; ev({ r }); },
        signal: ac.signal,
        maxTokens: b.voice ? 300 : 1400,
        reasoning: b.voice ? false : undefined,
      }, thread.id);
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
    const text = await aiRun(ctx.user, 'quiz', p, ai.quizPrompt(content.unitContext(unit), level, count, str(b.focus, 300)), { maxTokens: 2500, temperature: 0.7, reasoning: false });
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
    let hint = (await aiRun(ctx.user, 'hint', p, ai.hintPrompt(clean, unit ? content.unitContext(unit) : ''), { maxTokens: 150, temperature: 0.4, reasoning: false })).trim();
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
    const text = await aiRun(ctx.user, 'feedback', p, ai.feedbackPrompt(str(b.title, 100), unit ? content.unitContext(unit) : '', items, score, items.length), { maxTokens: 700, temperature: 0.4, reasoning: false });
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
    const flow = ai.parseFlow(await aiRun(ctx.user, 'flow', p, ai.flowPrompt(content.unitContext(unit)), { maxTokens: 1500, temperature: 0.3, reasoning: false }));
    db.prepare('INSERT INTO ai_cache (key, json, created_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, created_at = excluded.created_at')
      .run(key, JSON.stringify(flow), now());
    return flow;
  });

  route('POST', '/api/ai/models', async (ctx) => {
    const b = await ctx.body();
    const s = getSettings(ctx.user.id);
    const trial = { ...s };
    const d = aiDefaults();
    if (d.allowUserAi && b.aiBaseUrl !== undefined) trial.aiBaseUrl = str(b.aiBaseUrl, 300).trim();
    if (d.allowUserAi && b.aiApiKey) trial.aiKeyEnc = auth.encrypt(str(b.aiApiKey, 500));
    return { models: await ai.listModels(ai.providerFor(trial, auth.decrypt, d)) };
  });

  route('POST', '/api/ai/test', async (ctx) => {
    const s = getSettings(ctx.user.id);
    if (!ctx.user.ai_enabled) throw new HttpError(403, 'The AI tutor is turned off for your account.');
    const p = ai.providerFor(s, auth.decrypt, aiDefaults());
    const t0 = now();
    const text = await aiRun(ctx.user, 'test', p, [{ role: 'user', content: 'Reply with exactly: Hello, learner!' }], { maxTokens: 30, reasoning: false });
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
    const b = await ctx.body(3 * 1024 * 1024);
    const data = str(b.data, 3 * 1024 * 1024);
    if (data && !data.startsWith('data:image/png;base64,')) throw new HttpError(400, 'Canvas must be a PNG');
    if (!data) db.prepare('DELETE FROM canvases WHERE user_id = ? AND unit_id = ?').run(ctx.user.id, u.id);
    else db.prepare(`INSERT INTO canvases (user_id, unit_id, data, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, unit_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`).run(ctx.user.id, u.id, data, now());
    return { ok: true };
  });

  // ---------- memory review ("never forget") ----------
  route('GET', '/api/review/today', (ctx) => {
    const uid = ctx.user.id;
    const t = now();
    const due = db.prepare('SELECT * FROM srs WHERE user_id = ? AND due_at <= ? ORDER BY due_at LIMIT 200').all(uid, t);
    const units = due.filter((x) => x.kind === 'unit').map((x) => ({ unitId: x.unit_id, stability: x.stability, recall: retrievability(x.stability, t - x.last_review), reps: x.reps }));
    const cardIds = due.filter((x) => x.kind === 'card').map((x) => Number(x.key.slice(5)));
    const cards = cardIds.length ? db.prepare(`SELECT id, unit_id, kind, text, extra FROM saved WHERE user_id = ? AND id IN (${cardIds.map(() => '?').join(',')})`).all(uid, ...cardIds) : [];
    const next = db.prepare('SELECT MIN(due_at) t FROM srs WHERE user_id = ? AND due_at > ?').get(uid, t).t;
    return {
      units: units.slice(0, 6),
      mistakes: db.prepare('SELECT qid FROM mistakes WHERE user_id = ? AND due_at <= ? ORDER BY due_at LIMIT 10').all(uid, t).map((r) => r.qid),
      verbs: due.filter((x) => x.kind === 'verb').slice(0, 8).map((x) => x.key.slice(5)),
      cards: cards.slice(0, 8),
      next,
    };
  });
  route('POST', '/api/review', async (ctx) => {
    const b = await ctx.body();
    const out = [];
    for (const it of (Array.isArray(b.items) ? b.items : []).slice(0, 100)) {
      const key = str(it.key, 60);
      const m = /^(unit|verb|card):([\w-]+)$/.exec(key);
      if (!m) continue;
      const unitId = m[1] === 'unit' ? Number(m[2]) : (Number(it.unitId) || null);
      if (m[1] === 'unit' && !course.byId.has(unitId)) continue;
      out.push({ key, stability: srsReview(ctx.user.id, key, m[1], unitId, Boolean(it.success)) });
    }
    return { updated: out };
  });

  // ---------- auto-save: where the learner was, and unfinished quizzes ----------
  route('POST', '/api/resume', async (ctx) => {
    const b = await ctx.body();
    const r = { route: str(b.route, 200), title: str(b.title, 120), scroll: Math.max(0, Number(b.scroll) || 0), at: now() };
    if (!/^#\/[\w/%.:-]*$/.test(r.route) || r.route.startsWith('#/admin')) return { ok: false };
    db.prepare('UPDATE users SET resume = ?, last_seen = ? WHERE id = ?').run(JSON.stringify(r), now(), ctx.user.id);
    return { ok: true };
  });
  const quizKey = (k) => { if (!/^[\w:.-]{1,80}$/.test(k)) throw new HttpError(400, 'Bad key'); return k; };
  route('GET', '/api/quiz-state/:key', (ctx) => {
    const r = db.prepare('SELECT state, updated_at FROM quiz_state WHERE user_id = ? AND key = ?').get(ctx.user.id, quizKey(ctx.params.key));
    return r ? { state: JSON.parse(r.state), updatedAt: r.updated_at } : { state: null };
  });
  route('PUT', '/api/quiz-state/:key', async (ctx) => {
    const b = await ctx.body(512 * 1024);
    // keep at most 50 unfinished quizzes per learner
    db.prepare(`DELETE FROM quiz_state WHERE user_id = ? AND key NOT IN (SELECT key FROM quiz_state WHERE user_id = ? ORDER BY updated_at DESC LIMIT 49)`).run(ctx.user.id, ctx.user.id);
    db.prepare(`INSERT INTO quiz_state (user_id, key, state, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, key) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`).run(ctx.user.id, quizKey(ctx.params.key), JSON.stringify(b.state ?? null), now());
    return { ok: true };
  });
  route('DELETE', '/api/quiz-state/:key', (ctx) => {
    db.prepare('DELETE FROM quiz_state WHERE user_id = ? AND key = ?').run(ctx.user.id, quizKey(ctx.params.key));
    return { ok: true };
  });

  // learner's own writing: check a sentence, or a "brain dump" recall of a unit
  route('POST', '/api/ai/check', async (ctx) => {
    const b = await ctx.body();
    const text = str(b.text, 3000).trim();
    if (!text) throw new HttpError(400, 'Write something first');
    if (!auth.rateLimit('ai:' + ctx.user.id, 60, 60e3)) throw new HttpError(429, 'Too many AI requests.');
    const unit = b.unitId ? course.byId.get(Number(b.unitId)) : null;
    const { p } = aiContext(ctx, unit ? `unit:${unit.id}` : 'general');
    const recall = b.mode === 'recall' && unit;
    const msgs = recall ? ai.recallPrompt(text, content.unitContext(unit)) : ai.checkPrompt(text, unit ? content.unitContext(unit) : '');
    return { text: await aiRun(ctx.user, recall ? 'recall' : 'check', p, msgs, { maxTokens: recall ? 500 : 250, temperature: 0.3, reasoning: false }) };
  });

  // ---------- admin ----------
  const userRow = (id) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
    if (!u) throw new HttpError(404, 'User not found');
    return u;
  };
  const activeAdmins = () => db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND disabled = 0").get().n;
  const usageSum = (where, ...args) => db.prepare(`SELECT COUNT(*) calls, COALESCE(SUM(prompt_tokens),0) prompt, COALESCE(SUM(completion_tokens),0) completion,
    COALESCE(SUM(reasoning_tokens),0) reasoning, COALESCE(SUM(cost),0) cost, COALESCE(SUM(1 - ok),0) errors FROM ai_usage ${where}`).get(...args);

  route('GET', '/api/admin/overview', () => {
    const t = now();
    const d30 = t - 30 * DAY;
    return {
      users: {
        total: userCount(),
        admins: db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin'").get().n,
        disabled: db.prepare('SELECT COUNT(*) n FROM users WHERE disabled = 1').get().n,
        online: db.prepare('SELECT COUNT(*) n FROM users WHERE last_seen > ?').get(t - 3 * 60e3).n,
        today: db.prepare('SELECT COUNT(*) n FROM users WHERE last_seen > ?').get(dayStart()).n,
        week: db.prepare('SELECT COUNT(*) n FROM users WHERE last_seen > ?').get(t - 7 * DAY).n,
      },
      ai: {
        today: usageSum('WHERE created_at >= ?', dayStart()),
        week: usageSum('WHERE created_at >= ?', t - 7 * DAY),
        month: usageSum('WHERE created_at >= ?', d30),
        all: usageSum(''),
        daily: db.prepare(`SELECT date(created_at / 1000, 'unixepoch', 'localtime') day, COUNT(*) calls, SUM(prompt_tokens + completion_tokens) tokens, SUM(cost) cost
          FROM ai_usage WHERE created_at >= ? GROUP BY day ORDER BY day`).all(d30),
        byModel: db.prepare(`SELECT model, provider, COUNT(*) calls, SUM(prompt_tokens) prompt, SUM(completion_tokens) completion, SUM(cost) cost, AVG(ms) ms
          FROM ai_usage GROUP BY model, provider ORDER BY cost DESC, calls DESC`).all(),
        byKind: db.prepare('SELECT kind, COUNT(*) calls, SUM(prompt_tokens + completion_tokens) tokens, SUM(cost) cost FROM ai_usage WHERE created_at >= ? GROUP BY kind ORDER BY calls DESC').all(d30),
        topUsers: db.prepare(`SELECT u.id, u.username, u.display_name, COUNT(a.id) calls, SUM(a.prompt_tokens + a.completion_tokens) tokens, SUM(a.cost) cost
          FROM ai_usage a JOIN users u ON u.id = a.user_id WHERE a.created_at >= ? GROUP BY u.id ORDER BY tokens DESC LIMIT 10`).all(d30),
      },
      learning: {
        ...db.prepare('SELECT COALESCE(SUM(answered),0) answered, COALESCE(SUM(correct),0) correct, COALESCE(SUM(xp),0) xp FROM activity').get(),
        tests: db.prepare('SELECT COUNT(*) n FROM attempts').get().n,
        daily: db.prepare('SELECT day, SUM(answered) answered, COUNT(DISTINCT user_id) learners FROM activity WHERE day >= ? GROUP BY day ORDER BY day').all(new Date(d30).toISOString().slice(0, 10)),
      },
    };
  }, { admin: true });

  route('GET', '/api/admin/users', () => {
    const t = now();
    const passed = db.prepare('SELECT user_id, COUNT(*) levels FROM progress WHERE best >= 80 GROUP BY user_id').all();
    const mastered = db.prepare('SELECT user_id, COUNT(*) n FROM (SELECT user_id, unit_id FROM progress WHERE best >= 80 GROUP BY user_id, unit_id HAVING COUNT(*) = 3) GROUP BY user_id').all();
    const act = db.prepare('SELECT user_id, SUM(xp) xp, SUM(answered) answered, SUM(correct) correct FROM activity GROUP BY user_id').all();
    const use = db.prepare('SELECT user_id, COUNT(*) calls, SUM(prompt_tokens + completion_tokens) tokens, SUM(cost) cost FROM ai_usage GROUP BY user_id').all();
    const today = db.prepare('SELECT user_id, SUM(prompt_tokens + completion_tokens) tokens FROM ai_usage WHERE created_at >= ? GROUP BY user_id').all(dayStart());
    const by = (list, id) => list.find((x) => x.user_id === id) || {};
    return db.prepare('SELECT id, username, display_name, role, ai_enabled, disabled, ai_daily_tokens, created_at, last_seen, resume FROM users ORDER BY last_seen DESC NULLS LAST, id').all().map((u) => ({
      ...u, resume: JSON.parse(u.resume || 'null'), online: Boolean(u.last_seen && t - u.last_seen < 3 * 60e3),
      levelsPassed: by(passed, u.id).levels || 0, mastered: by(mastered, u.id).n || 0,
      xp: by(act, u.id).xp || 0, answered: by(act, u.id).answered || 0, correct: by(act, u.id).correct || 0,
      aiCalls: by(use, u.id).calls || 0, aiTokens: by(use, u.id).tokens || 0, aiCost: by(use, u.id).cost || 0, aiTokensToday: by(today, u.id).tokens || 0,
      streak: streak(u.id, new Date().toISOString().slice(0, 10)),
    }));
  }, { admin: true });

  route('POST', '/api/admin/users', async (ctx) => {
    const b = await ctx.body();
    const id = createUser({ username: b.username, displayName: b.displayName, password: b.password, role: b.role, aiEnabled: b.aiEnabled !== false, aiDailyTokens: b.aiDailyTokens });
    return { id };
  }, { admin: true });

  route('PUT', '/api/admin/users/:id', async (ctx) => {
    const u = userRow(ctx.params.id);
    const b = await ctx.body();
    const self = u.id === ctx.user.id;
    if (b.displayName !== undefined && str(b.displayName, 60).trim()) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(str(b.displayName, 60).trim(), u.id);
    if (b.role !== undefined) {
      const role = b.role === 'admin' ? 'admin' : 'user';
      if (u.role === 'admin' && role === 'user' && activeAdmins() <= 1) throw new HttpError(400, 'There must be at least one admin.');
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, u.id);
    }
    if (b.disabled !== undefined) {
      if (self && b.disabled) throw new HttpError(400, 'You cannot turn off your own account.');
      db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(b.disabled ? 1 : 0, u.id);
      if (b.disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    }
    if (b.aiEnabled !== undefined) db.prepare('UPDATE users SET ai_enabled = ? WHERE id = ?').run(b.aiEnabled ? 1 : 0, u.id);
    if (b.aiDailyTokens !== undefined) db.prepare('UPDATE users SET ai_daily_tokens = ? WHERE id = ?').run(Math.max(0, Number(b.aiDailyTokens) || 0), u.id);
    if (b.password) {
      checkNewPassword(b.password, u.username);
      db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(auth.hashPassword(str(b.password, 200)), u.id);
      if (!self) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    }
    return { ok: true };
  }, { admin: true });

  route('DELETE', '/api/admin/users/:id', (ctx) => {
    const u = userRow(ctx.params.id);
    if (u.id === ctx.user.id) throw new HttpError(400, 'You cannot delete your own account here.');
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    return { ok: true };
  }, { admin: true });

  route('GET', '/api/admin/users/:id', (ctx) => {
    const u = userRow(ctx.params.id);
    const { pass_hash: _ph, ...safe } = u;
    void _ph;
    return {
      user: { ...safe, resume: JSON.parse(u.resume || 'null') },
      progress: db.prepare('SELECT unit_id, level, best, attempts, updated_at FROM progress WHERE user_id = ? ORDER BY unit_id').all(u.id),
      activity: db.prepare('SELECT day, xp, answered, correct FROM activity WHERE user_id = ? ORDER BY day DESC LIMIT 60').all(u.id),
      attempts: db.prepare('SELECT id, unit_id, kind, title, score, total, created_at FROM attempts WHERE user_id = ? ORDER BY created_at DESC LIMIT 30').all(u.id),
      memory: db.prepare('SELECT kind, COUNT(*) n, SUM(due_at <= ?) due FROM srs WHERE user_id = ? GROUP BY kind').all(now(), u.id),
      mistakes: db.prepare('SELECT COUNT(*) n FROM mistakes WHERE user_id = ?').get(u.id).n,
      notes: db.prepare('SELECT COUNT(*) n FROM notes WHERE user_id = ?').get(u.id).n,
      threads: db.prepare('SELECT t.id, t.scope, t.title, t.updated_at, (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id) n FROM threads t WHERE t.user_id = ? ORDER BY t.updated_at DESC LIMIT 50').all(u.id),
      usage: usageSum('WHERE user_id = ?', u.id),
      usageToday: usageSum('WHERE user_id = ? AND created_at >= ?', u.id, dayStart()),
    };
  }, { admin: true });

  route('GET', '/api/admin/ai-usage', (ctx) => {
    const q = ctx.query;
    const where = [];
    const args = [];
    if (q.get('user')) { where.push('a.user_id = ?'); args.push(Number(q.get('user'))); }
    if (q.get('kind')) { where.push('a.kind = ?'); args.push(str(q.get('kind'), 20)); }
    if (q.get('errors') === '1') where.push('a.ok = 0');
    const limit = Math.max(1, Math.min(500, Math.floor(Number(q.get('limit'))) || 200));
    return db.prepare(`SELECT a.*, u.username FROM ai_usage a LEFT JOIN users u ON u.id = a.user_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY a.id DESC LIMIT ${limit}`).all(...args);
  }, { admin: true });

  route('GET', '/api/admin/threads', (ctx) => {
    const user = ctx.query.get('user');
    const sql = `SELECT t.id, t.scope, t.title, t.created_at, t.updated_at, u.username, u.display_name, u.id user_id,
      (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id) n,
      (SELECT COALESCE(SUM(prompt_tokens + completion_tokens),0) FROM ai_usage a WHERE a.thread_id = t.id) tokens,
      (SELECT COALESCE(SUM(cost),0) FROM ai_usage a WHERE a.thread_id = t.id) cost
      FROM threads t JOIN users u ON u.id = t.user_id ${user ? 'WHERE t.user_id = ?' : ''} ORDER BY t.updated_at DESC LIMIT 300`;
    return user ? db.prepare(sql).all(Number(user)) : db.prepare(sql).all();
  }, { admin: true });
  route('GET', '/api/admin/threads/:id', (ctx) => {
    const t = db.prepare('SELECT t.*, u.username FROM threads t JOIN users u ON u.id = t.user_id WHERE t.id = ?').get(Number(ctx.params.id));
    if (!t) throw new HttpError(404, 'Chat not found');
    return { thread: t, messages: db.prepare('SELECT role, content, reasoning, created_at FROM messages WHERE thread_id = ? ORDER BY id').all(t.id) };
  }, { admin: true });

  const adminSettings = () => {
    const d = aiDefaults();
    const enc = getApp('aiKeyEnc', '');
    return {
      registration: getApp('registration', config.ALLOW_REGISTRATION ? 'open' : 'closed'),
      aiBaseUrl: getApp('aiBaseUrl', ''), aiModel: getApp('aiModel', ''), allowUserAi: d.allowUserAi,
      aiKeySet: Boolean(enc), aiKeyHint: enc ? '••••' + auth.decrypt(enc).slice(-4) : '',
      envDefaults: { baseUrl: config.AI_BASE_URL, model: config.AI_MODEL, keySet: Boolean(config.AI_API_KEY) },
      effective: { baseUrl: d.baseUrl, model: d.model, keySet: Boolean(d.apiKey) },
      defaultDailyTokens: getApp('defaultDailyTokens', 0),
      prices: getApp('prices', {}),
    };
  };
  route('GET', '/api/admin/settings', () => adminSettings(), { admin: true });
  route('PUT', '/api/admin/settings', async (ctx) => {
    const b = await ctx.body(1024 * 1024);
    if (b.registration !== undefined) setApp('registration', b.registration === 'open' ? 'open' : 'closed');
    if (b.aiBaseUrl !== undefined) setApp('aiBaseUrl', str(b.aiBaseUrl, 300).trim().replace(/\/+$/, ''));
    if (b.aiModel !== undefined) setApp('aiModel', str(b.aiModel, 120).trim());
    if (b.aiApiKey !== undefined) setApp('aiKeyEnc', b.aiApiKey ? auth.encrypt(str(b.aiApiKey, 500).trim()) : '');
    if (b.allowUserAi !== undefined) setApp('allowUserAi', Boolean(b.allowUserAi));
    if (b.defaultDailyTokens !== undefined) setApp('defaultDailyTokens', Math.max(0, Number(b.defaultDailyTokens) || 0));
    if (b.prices && typeof b.prices === 'object') {
      const rows = [];
      for (const [m, v] of Object.entries(b.prices).slice(0, 2000)) {
        const pin = Number(v?.in); const pout = Number(v?.out);
        if (m && !['__proto__', 'constructor', 'prototype'].includes(m) && Number.isFinite(pin) && Number.isFinite(pout) && pin >= 0 && pout >= 0 && pin < 1e6 && pout < 1e6) rows.push([str(m, 120), { in: pin, out: pout }]);
      }
      setApp('prices', Object.fromEntries(rows));
    }
    return adminSettings();
  }, { admin: true });
  route('POST', '/api/admin/prices/fetch', async () => {
    const all = await ai.fetchOpenRouterPrices();
    const used = new Set(db.prepare('SELECT DISTINCT model FROM ai_usage').all().map((r) => r.model));
    used.add(aiDefaults().model);
    const prices = { ...getApp('prices', {}) };
    let n = 0;
    for (const m of used) if (all[m]) { prices[m] = all[m]; n++; }
    setApp('prices', prices);
    // Fill in cost for older rows that had no price yet.
    for (const [m, pr] of Object.entries(prices)) {
      db.prepare("UPDATE ai_usage SET cost = (prompt_tokens * ? + completion_tokens * ?) / 1e6, cost_source = 'price-table' WHERE model = ? AND cost_source = 'unknown'").run(pr.in, pr.out, m);
    }
    return { updated: n, prices, catalogue: Object.keys(all).length };
  }, { admin: true });
  route('POST', '/api/admin/test-ai', async (ctx) => {
    const d = aiDefaults();
    const p = { baseUrl: d.baseUrl, apiKey: d.apiKey, model: d.model, reasoning: false, userUrl: false };
    const t0 = now();
    const text = await aiRun(ctx.user, 'test', p, [{ role: 'user', content: 'Reply with exactly: Hello, admin!' }], { maxTokens: 30, reasoning: false });
    return { reply: text.trim(), ms: now() - t0, model: d.model };
  }, { admin: true });

  // ---------- server ----------
  /** Real client IP. Behind a local reverse proxy (nginx) use the address it appended to X-Forwarded-For. */
  function clientIp(req) {
    const remote = req.socket.remoteAddress || '';
    const local = /^(127\.|::1$|::ffff:127\.)/.test(remote);
    const xff = req.headers['x-forwarded-for'];
    if (config.TRUST_PROXY && local && xff) return String(xff).split(',').pop().trim().slice(0, 64) || remote;
    return remote;
  }

  const ctx_ip = (req) => clientIp(req);

  async function handle(req, res) {
    let url;
    try { url = new URL(req.url, 'http://x'); } catch { json(req, res, { error: 'Bad URL' }, 400); return; }
    const p = url.pathname;
    try {
      if (p.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          // CSRF guard (plus SameSite=Lax cookies and JSON-only bodies): reject requests a browser marks as cross-site.
          const origin = req.headers.origin;
          let sameOrigin = true;
          if (origin) { try { sameOrigin = new URL(origin).host === req.headers.host; } catch { sameOrigin = false; } }
          const site = req.headers['sec-fetch-site'];
          if (!sameOrigin || (site && site !== 'same-origin' && site !== 'none')) throw new HttpError(403, 'Cross-origin request blocked');
        }
        for (const r of routes) {
          if (r.method !== req.method && !(r.method === 'GET' && req.method === 'HEAD')) continue;
          const m = r.re.exec(p);
          if (!m) continue;
          const token = cookies(req).sid;
          const user = auth.sessionUser(db, token);
          if (!r.open && !user) throw new HttpError(401, 'Please log in.');
          if (r.admin && user?.role !== 'admin') throw new HttpError(403, 'Admins only.');
          if (req.method !== 'GET' && req.method !== 'HEAD' && !auth.rateLimit('w:' + (user ? 'u' + user.id : ctx_ip(req)), config.WRITE_LIMIT, 60e3)) {
            throw new HttpError(429, 'Too many requests. Please slow down.');
          }
          if (user && (!user.last_seen || now() - user.last_seen > 60e3)) db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now(), user.id);
          const setCookies = [];
          const HANDLED = Symbol('handled');
          const ctx = {
            req, res, user, token, HANDLED, query: url.searchParams,
            ip: clientIp(req),
            params: Object.fromEntries(r.keys.map((k, i) => {
              try { return [k, decodeURIComponent(m[i + 1])]; } catch { throw new HttpError(400, 'Bad URL'); }
            })),
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
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; media-src 'self' blob:; " +
      "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), geolocation=(), payment=(), usb=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (config.SECURE_COOKIES) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    handle(req, res);
  });
  // Protect against slow-request (slowloris) attacks. AI answers stream in the response, which these do not limit.
  server.headersTimeout = 20e3;
  server.requestTimeout = 60e3;
  server.maxHeadersCount = 100;
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
