import { esc } from './md.js';
import {
  api, store, loadState, toast, $, $$, unitStatus, flagsOf, unitMeta, today, englishVoices, speak, confirmBox, levelDots,
} from './core.js';
import { tutor } from './tutor.js';
import { renderUnit } from './unit.js';
import { renderPractice } from './practice.js';
import { renderSpace, renderRef, renderChats } from './space.js';
import { renderAdmin } from './admin.js';
import { renderReview, recallNow, daysText } from './review.js';

const app = $('#app');
let cfg = null;

// ---------- theme ----------
function applyTheme() {
  const t = store.me?.settings?.theme || localStorage.getItem('theme') || 'system';
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  localStorage.setItem('theme', t);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
applyTheme();

async function toggleTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  store.me.settings.theme = dark ? 'light' : 'dark';
  applyTheme();
  const r = await api('/api/settings', { method: 'PUT', body: { theme: store.me.settings.theme } });
  store.me.settings = r.settings;
}

// ---------- auth ----------
function renderAuth(mode = 'login') {
  document.title = 'Fluento — Master English';
  app.innerHTML = `
    <div class="auth">
      <div class="auth-hero">
        <div class="logo big">Fluent<span>o</span></div>
        <div class="tagline">Master English</div>
        <h1>Speak, write and think in English —<br>one small step at a time.</h1>
        <ul class="ticks">
          <li>115 lessons from beginner to confident</li>
          <li>Easy, Medium and Hard practice in every unit</li>
          <li>AI tutor that clears your doubts</li>
          <li>Notes, bookmarks, streaks and review — all in your own space</li>
        </ul>
      </div>
      <form class="auth-card">
        <div class="seg full">
          <button type="button" data-m="login" class="${mode === 'login' ? 'on' : ''}">Log in</button>
          ${cfg.allowRegistration ? `<button type="button" data-m="register" class="${mode === 'register' ? 'on' : ''}">${cfg.setup ? 'Set up (first admin)' : 'Create account'}</button>` : ''}
        </div>
        ${cfg.setup ? '<p class="small warn-box">👋 New server: the first account you create becomes the <b>admin</b>.</p>' : ''}
        ${!cfg.allowRegistration && mode === 'login' ? '<p class="muted small">Accounts are created by your admin. Ask them for your username and password.</p>' : ''}
        ${mode === 'register' ? '<label>Your name<input name="displayName" autocomplete="name" placeholder="e.g. Priya"></label>' : ''}
        <label>Username<input name="username" required autocomplete="username" autocapitalize="off" spellcheck="false"></label>
        <label>Password<input name="password" type="password" required minlength="8" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"></label>
        <div class="form-err" hidden></div>
        <button class="btn primary full">${mode === 'login' ? 'Log in' : 'Create my account'}</button>
        <p class="muted small center">Your progress, notes and chats are private to your account.</p>
      </form>
    </div>`;
  $$('[data-m]').forEach((b) => { b.onclick = () => renderAuth(b.dataset.m); });
  const form = $('.auth-card');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const err = $('.form-err');
    err.hidden = true;
    try {
      await api(`/api/auth/${mode}`, { method: 'POST', body: data });
      await boot();
      if (mode === 'register') location.hash = store.me?.user.role === 'admin' && cfg.setup ? '#/admin/settings' : '#/welcome';
      cfg = null;
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  };
  form.querySelector('input').focus();
}

window.addEventListener('auth-lost', () => { store.me = null; tutor.hide(); renderAuth(); });

// ---------- shell ----------
const NAV = [
  ['home', '🏠', 'Dashboard', '#/'],
  ['course', '📚', 'Course', '#/course'],
  ['practice', '🎯', 'Practice', '#/practice'],
  ['space', '🗂️', 'My Space', '#/space'],
  ['ref', '📘', 'Reference', '#/ref'],
  ['review', '🧠', "Today's review", '#/review'],
  ['ai', '🤖', 'AI Tutor', '#/ai'],
  ['settings', '⚙️', 'Settings', '#/settings'],
];

function shell() {
  app.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" data-nav-toggle aria-label="Menu" title="Show / hide menu">☰</button>
      <a class="logo" href="#/" title="Fluento — Master English">Fluent<span>o</span><small class="logo-tag">Master English</small></a>
      <form class="search" role="search">
        <input type="search" placeholder="Search lessons, examples, notes…  ( / )" aria-label="Search">
      </form>
      <div class="top-stats" title="Daily streak and XP today"></div>
      <button class="icon-btn theme-btn" data-theme-toggle title="Light / dark mode" aria-label="Toggle dark mode">🌓</button>
      <button class="btn ai-btn" data-ai>🤖 <span class="hide-sm">Ask AI</span></button>
      <div class="user-menu">
        <button class="avatar" data-user aria-label="Account"></button>
      </div>
    </header>
    <nav class="sidebar">
      <form class="search side-search only-mobile" role="search"><input type="search" placeholder="Search…" aria-label="Search"></form>
      ${NAV.map(([k, i, l, h]) => `<a href="${h}" data-k="${k}" title="${l}"><span>${i}</span><em>${l}</em>${k === 'review' ? '<b class="badge nav-due" hidden></b>' : ''}</a>`).join('')}
      ${store.me.user.role === 'admin' ? '<a href="#/admin" data-k="admin" title="Admin"><span>🛡️</span><em>Admin</em></a>' : ''}
      <div class="side-foot muted small">Keys: <kbd>/</kbd> search · <kbd>A</kbd> AI tutor</div>
    </nav>
    <main id="view" tabindex="-1"></main>
    <button class="to-top" data-top aria-label="Back to top" title="Back to top">↑</button>`;
  const top = $('[data-top]');
  top.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  window.addEventListener('scroll', () => top.classList.toggle('show', window.scrollY > 500), { passive: true });
  $('[data-theme-toggle]').onclick = toggleTheme;
  if (localStorage.getItem('navCollapsed') === '1') document.body.classList.add('nav-collapsed');
  $('[data-ai]').onclick = () => tutor.toggle();
  $('[data-nav-toggle]').onclick = () => {
    if (window.innerWidth <= 760) { document.body.classList.toggle('nav-open'); return; }
    const c = document.body.classList.toggle('nav-collapsed');
    localStorage.setItem('navCollapsed', c ? '1' : '0');
  };
  $('.sidebar').addEventListener('click', (e) => { if (e.target.closest('a')) document.body.classList.remove('nav-open'); });
  $$('.search').forEach((f) => { f.onsubmit = (e) => { e.preventDefault(); const q = f.querySelector('input').value.trim(); if (q) location.hash = `#/search/${encodeURIComponent(q)}`; }; });
  $('[data-user]').onclick = () => userMenu();
  updateTop();
}

function updateTop() {
  const t = store.state?.totals;
  const el = $('.top-stats');
  if (!el || !t) return;
  el.innerHTML = `<span class="pill fire" title="Day streak">🔥 ${t.streak}</span><span class="pill" title="XP today">⚡ ${t.today.xp}/${store.me.settings.dailyGoal || 50}</span>`;
  const due = $('.nav-due');
  if (due) { due.hidden = !store.state.reviewDue; due.textContent = store.state.reviewDue; }
  const a = $('[data-user]');
  if (a) a.textContent = (store.me.user.displayName || '?').slice(0, 1).toUpperCase();
}
store.listeners.add(updateTop);

function userMenu() {
  const existing = $('.dropdown');
  if (existing) { existing.remove(); return; }
  const d = document.createElement('div');
  d.className = 'dropdown';
  d.innerHTML = `<div class="dd-head"><strong>${esc(store.me.user.displayName)}</strong><div class="muted small">@${esc(store.me.user.username)}</div></div>
    <a href="#/space">🗂️ My Space</a><a href="#/settings">⚙️ Settings</a>
    <button data-theme>🌓 Toggle dark mode</button><button data-logout>↪ Log out</button>`;
  $('.user-menu').append(d);
  const close = (e) => { if (!d.contains(e.target) && !e.target.closest('[data-user]')) { d.remove(); document.removeEventListener('click', close); } };
  setTimeout(() => document.addEventListener('click', close));
  d.querySelector('[data-logout]').onclick = async () => { await api('/api/auth/logout', { method: 'POST', body: {} }); location.hash = '#/'; location.reload(); };
  d.querySelector('[data-theme]').onclick = toggleTheme;
  d.querySelectorAll('a').forEach((a) => { a.onclick = () => d.remove(); });
}

// ---------- auto-save: remember where the learner is ----------
let resumeTimer = null;
function saveResume(keepalive = false) {
  const h = location.hash || '#/';
  if (!store.me || h === '#/' || h === '#/welcome' || h.startsWith('#/admin') || h.startsWith('#/settings')) return;
  const body = JSON.stringify({ route: h, title: document.title.replace(/ — Fluento$/, ''), scroll: Math.round(window.scrollY) });
  fetch('/api/resume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive, credentials: 'same-origin' }).catch(() => {});
  store.me.resume = { ...JSON.parse(body), at: Date.now() };
}
function saveResumeSoon() { clearTimeout(resumeTimer); resumeTimer = setTimeout(() => saveResume(), 1500); }
let lastScrollSave = 0;
window.addEventListener('scroll', () => { if (Date.now() - lastScrollSave > 5000) { lastScrollSave = Date.now(); saveResumeSoon(); } }, { passive: true });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveResume(true); });
window.addEventListener('pagehide', () => saveResume(true));

export function continueResume() {
  const r = store.me.resume;
  if (!r?.route) return;
  store.restoreScroll = r.scroll || 0;
  if (location.hash === r.route) route(); else location.hash = r.route;
}

// ---------- router ----------
async function route() {
  if (!store.me) return;
  const hash = location.hash.replace(/^#\/?/, '');
  const [name, ...rest] = hash.split('/');
  // Each navigation renders into a fresh container, so a slow page that finishes late
  // can never draw over the page the learner has moved to.
  const view = document.createElement('div');
  view.className = 'view-inner';
  $('#view').replaceChildren(view);
  $$('.sidebar a').forEach((a) => a.classList.toggle('on', a.dataset.k === (name || 'home') || (name === 'unit' && a.dataset.k === 'course') || (name === 'search' && false)));
  tutor.setUnit(name === 'unit' ? rest[0] : null);
  if (tutor.open && window.innerWidth <= 1200 && !location.hash.startsWith('#/unit/' + (rest[0] || '-'))) tutor.hide();
  document.body.classList.remove('nav-open');
  window.scrollTo(0, 0);
  try {
    switch (name) {
      case '': await renderHome(view); break;
      case 'welcome': renderWelcome(view); break;
      case 'course': renderCourse(view, rest[0]); break;
      case 'unit': await renderUnit(view, Number(rest[0]), rest[1], rest[2]); break;
      case 'practice': await renderPractice(view, rest[0], rest[1]); break;
      case 'space': await renderSpace(view, rest[0]); break;
      case 'ref': await renderRef(view, rest[0]); break;
      case 'ai': await renderChats(view); break;
      case 'review': await renderReview(view); break;
      case 'admin': await renderAdmin(view, rest[0], rest[1]); break;
      case 'search': await renderSearch(view, decodeURIComponent(rest.join('/'))); break;
      case 'settings': await renderSettings(view); break;
      default: view.innerHTML = '<div class="page"><h1>Page not found</h1><a href="#/">Go home</a></div>';
    }
    if (store.restoreScroll) { const y = store.restoreScroll; store.restoreScroll = 0; setTimeout(() => window.scrollTo(0, y), 150); }
    saveResumeSoon();
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="page"><h1>Something went wrong</h1><p>${esc(e.message)}</p><a class="btn" href="#/">Go home</a></div>`;
  }
}
window.addEventListener('hashchange', route);

// ---------- dashboard ----------
const BADGES = [
  ['first', '🌱', 'First step', 'Pass your first level', (s) => s.passedLevels >= 1],
  ['ten', '📗', 'Bookworm', 'Pass 10 levels', (s) => s.passedLevels >= 10],
  ['fifty', '🏅', 'Grammar fan', 'Pass 50 levels', (s) => s.passedLevels >= 50],
  ['master5', '🧠', 'Master', 'Master 5 units (all 3 levels)', (s) => s.mastered >= 5],
  ['master115', '👑', 'Grammar champion', 'Master every unit', (s) => s.mastered >= s.unitCount],
  ['streak3', '🔥', 'On fire', '3-day streak', (s) => s.streak >= 3],
  ['streak7', '🚀', 'Unstoppable', '7-day streak', (s) => s.streak >= 7],
  ['q100', '💯', 'Hundred club', 'Answer 100 questions', (s) => s.answered >= 100],
  ['q1000', '🏆', 'Thousand club', 'Answer 1000 questions', (s) => s.answered >= 1000],
  ['notes', '🗒️', 'Note taker', 'Write 5 notes', (s) => s.notes >= 5],
];

function stats() {
  const st = store.state;
  const passedLevels = st.progress.filter((p) => p.best >= 80).length;
  const mastered = store.course.index.filter((u) => unitStatus(u.id).mastered).length;
  return {
    passedLevels, mastered, unitCount: store.course.index.length, streak: st.totals.streak,
    answered: st.totals.answered, notes: st.noteCounts.reduce((n, x) => n + x.n, 0),
    xp: st.totals.xp, accuracy: st.totals.answered ? Math.round((st.totals.correct / st.totals.answered) * 100) : 0,
  };
}

function nextUnit() {
  const lastVisited = [...store.state.flags].filter((f) => f.visited_at).sort((a, b) => b.visited_at - a.visited_at)[0];
  if (lastVisited && !unitStatus(lastVisited.unit_id).mastered) return lastVisited.unit_id;
  return (store.course.index.find((u) => !unitStatus(u.id).mastered) || store.course.index[0]).id;
}

async function renderHome(view) {
  await loadState();
  document.title = 'Dashboard — Fluento';
  const s = stats();
  const st = store.state;
  const goal = store.me.settings.dailyGoal || 50;
  const todayXp = st.totals.today.xp;
  const nu = unitMeta(nextUnit());
  const due = st.mistakes.filter((m) => m.due_at <= Date.now()).length;
  const pctCourse = Math.round((st.progress.filter((p) => p.best >= 80).length / (store.course.index.length * 3)) * 100);
  const days = [];
  for (let n = 27; n >= 0; n--) {
    const d = new Date(); d.setDate(d.getDate() - n);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const a = st.activity.find((x) => x.day === key);
    days.push({ key, xp: a?.xp || 0 });
  }
  const weak = Object.entries(st.mistakes.reduce((m, x) => { m[x.unit_id] = (m[x.unit_id] || 0) + x.wrong; return m; }, {}))
    .sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => unitMeta(id)).filter(Boolean);
  const hour = new Date().getHours();

  view.innerHTML = `
    <div class="page">
      <h1>${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}, ${esc(store.me.user.displayName)} 👋</h1>
      <div class="grid cards-3">
        <div class="card stat-card">
          <div class="ring" style="--p:${Math.min(100, Math.round((todayXp / goal) * 100))}"><span>${todayXp}<small>/${goal} XP</small></span></div>
          <div><h3>Today's goal</h3><p class="muted">${todayXp >= goal ? 'Goal reached — amazing! 🎉' : `${goal - todayXp} XP to go`}</p></div>
        </div>
        <div class="card stat-card"><div class="stat-big">🔥 ${s.streak}</div><div><h3>Day streak</h3><p class="muted">Practise every day to keep it.</p></div></div>
        <div class="card stat-card"><div class="stat-big">${pctCourse}%</div><div><h3>Course progress</h3><p class="muted">${s.mastered} of ${s.unitCount} units mastered</p></div></div>
      </div>

      <div class="grid cards-2">
        <div class="col gap">
        ${store.me.resume?.route ? `<button class="card continue resume-btn" data-resume>
          <div class="muted small">📍 CONTINUE WHERE YOU LEFT OFF · ${daysText(Date.now() - (store.me.resume.at || Date.now()))} ago</div>
          <h2>${esc(store.me.resume.title || 'Your last page')}</h2>
          <span class="btn primary">Continue →</span>
        </button>` : ''}
        <a class="card continue ${store.me.resume?.route ? 'small-card' : ''}" href="#/unit/${nu.id}">
          <div class="muted small">NEXT UNIT</div>
          <h2>Unit ${nu.id}: ${esc(nu.title)}</h2>
          ${store.me.resume?.route ? '' : `<p class="muted">${esc(nu.summary)}</p>`}
          ${levelDots(nu.id)}
          ${store.me.resume?.route ? '' : '<span class="btn primary">Start →</span>'}
        </a>
        <a class="card review-card ${st.reviewDue ? 'due' : ''}" href="#/review">
          <span class="big-emoji">🧠</span>
          <div><b>Today's review</b><p class="muted small">${st.reviewDue ? `${st.reviewDue} thing${st.reviewDue > 1 ? 's' : ''} to review — keep them in memory!` : 'All caught up. Nothing is fading yet.'}</p></div>
          ${st.reviewDue ? `<span class="badge big">${st.reviewDue}</span>` : '<span>✅</span>'}
        </a>
        </div>
        <div class="card">
          <h3>Quick practice</h3>
          <div class="quick-grid">
            <a class="quick" href="#/practice/review"><span>🔁</span>Review mistakes${due ? `<b class="badge">${due}</b>` : ''}</a>
            <a class="quick" href="#/practice/mix"><span>🎲</span>Daily mix</a>
            <a class="quick" href="#/practice/verbs"><span>⚡</span>Irregular verbs</a>
            <a class="quick" href="#/practice/dictation"><span>🎧</span>Listening</a>
            <a class="quick" href="#/practice/speaking"><span>🎤</span>Speaking</a>
            <a class="quick" href="#/practice/placement"><span>🧭</span>Level test</a>
          </div>
        </div>
      </div>

      <div class="grid cards-2">
        <div class="card">
          <h3>Last 4 weeks</h3>
          <div class="heat">${days.map((d) => `<i title="${d.key}: ${d.xp} XP" class="h${d.xp === 0 ? 0 : d.xp < 20 ? 1 : d.xp < 50 ? 2 : 3}"></i>`).join('')}</div>
          <div class="row gap muted small"><span>⚡ ${s.xp} XP total</span><span>✔ ${s.answered} answered</span><span>🎯 ${s.accuracy}% accuracy</span></div>
        </div>
        <div class="card">
          <h3>Focus areas</h3>
          ${weak.length ? `<ul class="link-list">${weak.map((u) => `<li><a href="#/unit/${u.id}">Unit ${u.id}: ${esc(u.title)}</a></li>`).join('')}</ul>
            <button class="btn small" data-ask-plan>🤖 Make me a study plan</button>` : '<p class="muted">No weak areas yet. Do some practice and I will show the units that need more work.</p>'}
        </div>
      </div>

      <div class="card">
        <h3>Badges</h3>
        <div class="badges">${BADGES.map(([k, ic, name, desc, test]) => `<div class="badge-item ${test(s) ? 'got' : ''}" title="${esc(desc)}"><span>${ic}</span><b>${esc(name)}</b><small>${esc(desc)}</small></div>`).join('')}</div>
      </div>

      <h2>Sections</h2>
      <div class="grid sections">${store.course.sections.map((sec) => {
        const done = sec.units.filter((id) => unitStatus(id).mastered).length;
        return `<a class="card section-card" href="#/course/${encodeURIComponent(sec.name)}">
          <b>${esc(sec.name)}</b><span class="muted small">Units ${sec.units[0]}–${sec.units[sec.units.length - 1]}</span>
          <div class="bar"><span style="width:${Math.round((done / sec.units.length) * 100)}%"></span></div>
          <span class="muted small">${done}/${sec.units.length} mastered</span></a>`;
      }).join('')}</div>
    </div>`;
  const rb = $('[data-resume]', view);
  if (rb) rb.onclick = continueResume;
  const plan = $('[data-ask-plan]', view);
  if (plan) plan.onclick = () => tutor.show('general', 'Based on my weak units, what should I study next and why? Make me a short plan for this week.');
}

function renderWelcome(view) {
  view.innerHTML = `<div class="page narrow center">
    <div class="big-emoji">🎉</div>
    <h1>Welcome to Fluento!</h1>
    <p class="muted">Master English — one small step at a time.</p>
    <p>Here is how it works:</p>
    <div class="steps">
      <div class="card"><b>1. Learn</b><p class="muted">Read a short lesson with examples you can listen to.</p></div>
      <div class="card"><b>2. Practise</b><p class="muted">Pass Easy, Medium and Hard (80%+) to master a unit.</p></div>
      <div class="card"><b>3. Ask AI</b><p class="muted">Stuck? The AI tutor explains the unit in simple words.</p></div>
      <div class="card"><b>4. Review</b><p class="muted">Your mistakes come back later so you don't forget.</p></div>
    </div>
    <div class="row center gap wrap">
      <a class="btn primary" href="#/practice/placement">🧭 Take the level test</a>
      <a class="btn" href="#/unit/1">Start from Unit 1</a>
    </div>
  </div>`;
}

// ---------- memory strength ----------
export function memBar(id) {
  const m = (store.state.memory || []).find((x) => x.unit_id === Number(id));
  if (!m) return '';
  const r = recallNow(m);
  const due = m.due_at <= Date.now();
  const cls = r >= 0.9 ? 'ok' : r >= 0.75 ? 'mid' : 'low';
  return `<span class="mem-bar ${cls}" title="Memory ${Math.round(r * 100)}% — ${due ? 'review due now' : 'next review in ' + daysText(m.due_at - Date.now())}"><i style="width:${Math.round(r * 100)}%"></i></span>`;
}

// ---------- course ----------
function renderCourse(view, section) {
  document.title = 'Course — Fluento';
  section = section ? decodeURIComponent(section) : '';
  const filters = [['all', 'All'], ['todo', 'Not mastered'], ['bookmarked', '🔖 Bookmarked'], ['important', '⭐ Important'], ['done', '✅ Mastered']];
  let filter = sessionStorage.getItem('courseFilter') || 'all';
  const draw = () => {
    const pass = (id) => {
      const f = flagsOf(id);
      const s = unitStatus(id);
      return filter === 'all' || (filter === 'todo' && !s.mastered) || (filter === 'done' && s.mastered) ||
        (filter === 'bookmarked' && f.bookmarked) || (filter === 'important' && f.important);
    };
    view.innerHTML = `<div class="page">
      <div class="row wrap between"><h1>Course</h1>
        <div class="seg">${filters.map(([k, l]) => `<button data-f="${k}" class="${filter === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <p class="muted">115 units in ${store.course.sections.length} sections. Not sure where to start? <a href="#/practice/placement">Take the level test</a>.</p>
      <div class="jump">${store.course.sections.map((s) => `<a href="#/course/${encodeURIComponent(s.name)}" class="chip small ${s.name === section ? 'on' : ''}">${esc(s.name)}</a>`).join('')}</div>
      ${store.course.sections.map((sec) => {
        const ids = sec.units.filter(pass);
        if (!ids.length) return '';
        return `<section class="course-sec" id="sec-${esc(sec.name.replace(/\W+/g, '-'))}"><h2>${esc(sec.name)}</h2>
          <div class="unit-grid">${ids.map((id) => {
            const u = unitMeta(id);
            const f = flagsOf(id);
            const s = unitStatus(id);
            return `<a class="unit-card ${s.mastered ? 'mastered' : ''}" href="#/unit/${id}">
              <div class="unit-num">${id}</div>
              <div class="unit-info"><b>${esc(u.title)}</b><span class="muted small">${esc(u.summary)}</span></div>
              <div class="unit-side">${f.bookmarked ? '🔖' : ''}${f.important ? '⭐' : ''}<span class="cefr">${u.cefr}</span>${levelDots(id)}${memBar(id)}</div>
            </a>`;
          }).join('')}</div></section>`;
      }).join('') || '<p class="empty">No units match this filter.</p>'}
    </div>`;
    $$('[data-f]', view).forEach((b) => { b.onclick = () => { filter = b.dataset.f; sessionStorage.setItem('courseFilter', filter); draw(); }; });
    if (section) document.getElementById('sec-' + section.replace(/\W+/g, '-'))?.scrollIntoView({ block: 'start' });
  };
  draw();
}

// ---------- search ----------
async function renderSearch(view, q) {
  document.title = `Search: ${q} — Fluento`;
  $('.search input').value = q;
  if (!store.searchIndex) store.searchIndex = await api('/api/search-index');
  const [notes, saved] = await Promise.all([api('/api/notes'), api('/api/saved')]);
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const score = (title, text) => {
    const T = title.toLowerCase();
    const X = text.toLowerCase();
    let s = 0;
    for (const t of terms) {
      if (!X.includes(t) && !T.includes(t)) return 0;
      s += (T.includes(t) ? 10 : 0) + Math.min(5, X.split(t).length - 1);
    }
    if (T.includes(q.toLowerCase())) s += 20;
    return s;
  };
  const snippet = (text) => {
    const X = text.toLowerCase();
    const k = Math.max(0, X.indexOf(terms[0]) - 60);
    let s = esc((k ? '…' : '') + text.slice(k, k + 200) + (text.length > k + 200 ? '…' : ''));
    for (const t of terms) s = s.replace(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>');
    return s;
  };
  const results = [
    ...store.searchIndex.map((d) => ({ ...d, s: score(d.title, d.text) })),
    ...notes.map((n) => ({ kind: 'note', id: n.unit_id, title: n.title || 'Note', text: n.body, s: score(n.title, n.body) })),
    ...saved.map((n) => ({ kind: 'saved', id: n.unit_id, title: n.kind === 'ai' ? 'Saved AI answer' : 'Saved sentence', text: n.text, s: score('', n.text) })),
  ].filter((r) => r.s > 0).sort((a, b) => b.s - a.s).slice(0, 60);
  const href = (r) => (r.kind === 'unit' ? `#/unit/${r.id}` : r.kind === 'ref' ? `#/ref/${r.id}` : r.kind === 'note' ? (r.id ? `#/unit/${r.id}/notes` : '#/space/notes') : '#/space/saved');
  const label = { unit: '📖 Lesson', ref: '📘 Reference', note: '🗒️ My note', saved: '☆ Saved' };
  view.innerHTML = `<div class="page">
    <h1>Search: “${esc(q)}”</h1>
    <p class="muted">${results.length} result${results.length === 1 ? '' : 's'} in lessons, reference pages, your notes and saved items.</p>
    <div class="results">${results.map((r) => `<a class="card result" href="${href(r)}">
      <div class="muted small">${label[r.kind]}${r.kind === 'unit' ? ` · Unit ${r.id} · ${esc(r.section)}` : ''}</div>
      <b>${esc(r.title)}</b><div class="small">${snippet(r.text)}</div></a>`).join('')}</div>
    <div class="card"><p>Can't find it? Ask the AI tutor.</p><button class="btn" data-ask>🤖 Ask AI about “${esc(q)}”</button></div>
  </div>`;
  $('[data-ask]', view).onclick = () => tutor.show('general', `Explain this English topic simply with examples: ${q}`);
}

// ---------- settings ----------
async function renderSettings(view) {
  document.title = 'Settings — Fluento';
  const s = store.me.settings;
  const ai = store.me.ai;
  const voices = englishVoices();
  view.innerHTML = `<div class="page narrow">
    <h1>Settings</h1>
    <form class="card form" data-profile>
      <h2>Profile & learning</h2>
      <label>Display name<input name="displayName" value="${esc(store.me.user.displayName)}"></label>
      <label>My first language <span class="muted small">(the AI can explain in it)</span>
        <input name="nativeLanguage" list="langs" value="${esc(s.nativeLanguage || '')}" placeholder="e.g. Tamil, Hindi, Malayalam, Arabic">
        <datalist id="langs">${['Tamil', 'Hindi', 'Malayalam', 'Telugu', 'Kannada', 'Bengali', 'Marathi', 'Gujarati', 'Urdu', 'Arabic', 'Spanish', 'French', 'Portuguese', 'Chinese', 'Japanese', 'Korean', 'Indonesian', 'Vietnamese', 'Thai', 'Turkish', 'Russian'].map((l) => `<option>${l}</option>`).join('')}</datalist></label>
      <label>AI explanation style<select name="explainStyle">${['simple', 'normal', 'detailed'].map((x) => `<option ${s.explainStyle === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label>Daily XP goal<select name="dailyGoal">${[20, 30, 50, 80, 120, 200].map((x) => `<option ${Number(s.dailyGoal) === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" name="bookView" ${s.bookView ? 'checked' : ''}> 📖 Open lessons in Book view (lesson on the left page, exercises on the right)</label>
      <label>Theme<select name="theme">${['system', 'light', 'dark'].map((x) => `<option ${s.theme === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label>Voice<select name="voice"><option value="">Automatic</option>${voices.map((v) => `<option ${s.voice === v.name ? 'selected' : ''} value="${esc(v.name)}">${esc(v.name)} (${v.lang})</option>`).join('')}</select></label>
      <label>Speaking speed <input name="speechRate" type="range" min="0.6" max="1.3" step="0.05" value="${s.speechRate || 0.95}"></label>
      <div class="row gap"><button class="btn primary">Save</button><button type="button" class="btn ghost" data-test-voice>🔊 Test voice</button></div>
    </form>

    <form class="card form" data-ai>
      <h2>🤖 AI Tutor</h2>
      ${store.me.user.aiEnabled ? '' : '<p class="warn-box">The AI tutor is turned off for your account by the admin.</p>'}
      ${store.me.user.aiDailyTokens ? `<p class="muted small">Your daily AI limit: ${store.me.user.aiDailyTokens.toLocaleString()} tokens.</p>` : ''}
      <p class="muted small">Works with any <b>OpenAI-compatible</b> API: OpenRouter, OpenAI, Groq, Together, DeepSeek, Mistral, local Ollama/LM Studio, and more.
      ${ai.configured ? `This server already has a default provider (${esc(ai.baseUrl)}, model <code>${esc(ai.model)}</code>). You can use it, or set your own below.` : 'This server has no default AI key, so add your own below.'}</p>
      ${ai.allowUserAi ? `
      <label>API base URL<input name="aiBaseUrl" value="${esc(s.aiBaseUrl || '')}" placeholder="${esc(ai.baseUrl)}"></label>
      <div class="presets">${[['OpenRouter', 'https://openrouter.ai/api/v1'], ['OpenAI', 'https://api.openai.com/v1'], ['Groq', 'https://api.groq.com/openai/v1'], ['DeepSeek', 'https://api.deepseek.com/v1'], ['Ollama (local)', 'http://localhost:11434/v1']]
        .map(([n, u]) => `<button type="button" class="chip small" data-preset="${u}">${n}</button>`).join('')}</div>
      <label>API key ${s.aiKeySet ? `<span class="muted small">(saved: ${esc(s.aiKeyHint)} — leave empty to keep)</span>` : ''}<input name="aiApiKey" type="password" autocomplete="off" placeholder="${s.aiKeySet ? 'Leave empty to keep the saved key' : 'sk-…'}"></label>` : '<p class="muted">The server admin manages the AI provider.</p>'}
      <label>Model<div class="row gap"><input name="aiModel" list="models" value="${esc(s.aiModel || '')}" placeholder="${esc(ai.model)}"><button type="button" class="btn small" data-models>Load models</button></div>
        <datalist id="models">${['qwen/qwen3.8-omni-flash', 'openai/gpt-4o-mini', 'google/gemini-2.5-flash', 'deepseek/deepseek-chat', 'meta-llama/llama-3.3-70b-instruct'].map((m) => `<option value="${m}">`).join('')}</datalist>
        <span class="muted small">OpenRouter example: <code>qwen/qwen3.8-omni-flash</code> — tap to use: <button type="button" class="link" data-qwen>use it</button></span></label>
      <label class="check"><input type="checkbox" name="aiReasoning" ${s.aiReasoning ? 'checked' : ''}> 💭 Reasoning ("thinking") — the model thinks before answering. Better answers, a bit slower. Sends <code>reasoning: {enabled: true}</code> (OpenRouter). Turn off if your provider gives an error.</label>
      <label class="check"><input type="checkbox" name="aiMemory" ${s.aiMemory === false ? '' : 'checked'}> 🧠 Memory — the tutor keeps short notes about you per unit and in general.</label>
      <div class="row gap wrap">
        <button class="btn primary">Save AI settings</button>
        <button type="button" class="btn" data-test>Test connection</button>
        ${s.aiKeySet ? '<button type="button" class="btn ghost" data-clear-key>Remove my key</button>' : ''}
      </div>
      <div class="ai-test muted small"></div>
    </form>

    <form class="card form" data-pw>
      <h2>Password</h2>
      <label>Current password<input name="current" type="password" autocomplete="current-password" required></label>
      <label>New password<input name="next" type="password" minlength="8" autocomplete="new-password" required></label>
      <button class="btn">Change password</button>
    </form>

    <div class="card form">
      <h2>My data</h2>
      <div class="row gap wrap">
        <button class="btn" data-export>⬇️ Export my data (JSON)</button>
        <button class="btn danger" data-delete>Delete my account</button>
      </div>
    </div>
  </div>`;

  const save = async (body, msg = 'Saved') => {
    const r = await api('/api/settings', { method: 'PUT', body });
    store.me.settings = r.settings;
    if (body.displayName) store.me.user.displayName = body.displayName;
    applyTheme();
    updateTop();
    toast(msg, 'ok');
  };
  $('[data-profile]', view).onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    f.bookView = e.target.bookView.checked;
    try { await save(f); } catch (ex) { toast(ex.message, 'error'); }
  };
  $('[data-test-voice]', view).onclick = () => {
    const f = new FormData($('[data-profile]', view));
    store.me.settings.voice = f.get('voice');
    speak('Hello! This is how I will read English sentences to you.', { rate: Number(f.get('speechRate')) });
  };
  const aiForm = $('[data-ai]', view);
  $$('[data-preset]', view).forEach((b) => { b.onclick = () => { aiForm.aiBaseUrl.value = b.dataset.preset; }; });
  $('[data-qwen]', view).onclick = () => { aiForm.aiModel.value = 'qwen/qwen3.8-omni-flash'; if (aiForm.aiBaseUrl && !aiForm.aiBaseUrl.value) aiForm.aiBaseUrl.value = 'https://openrouter.ai/api/v1'; };
  aiForm.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(aiForm));
    if (!f.aiApiKey) delete f.aiApiKey;
    f.aiReasoning = aiForm.aiReasoning.checked;
    f.aiMemory = aiForm.aiMemory.checked;
    try { await save(f, 'AI settings saved'); renderSettings(view); } catch (ex) { toast(ex.message, 'error'); }
  };
  $('[data-models]', view).onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      const body = {};
      if (aiForm.aiBaseUrl) body.aiBaseUrl = aiForm.aiBaseUrl.value;
      if (aiForm.aiApiKey?.value) body.aiApiKey = aiForm.aiApiKey.value;
      const { models } = await api('/api/ai/models', { method: 'POST', body });
      $('#models').innerHTML = models.map((m) => `<option value="${esc(m)}">`).join('');
      toast(`${models.length} models loaded — start typing in the Model box`, 'ok');
      aiForm.aiModel.focus();
    } catch (ex) { toast(ex.message, 'error', 5000); }
    b.disabled = false;
  };
  $('[data-test]', view).onclick = async () => {
    const out = $('.ai-test', view);
    out.textContent = 'Testing… (save first if you changed something)';
    try {
      const r = await api('/api/ai/test', { method: 'POST', body: {} });
      out.innerHTML = `✅ Works! Model <code>${esc(r.model)}</code> replied “${esc(r.reply)}” in ${r.ms} ms.`;
    } catch (ex) { out.innerHTML = `❌ ${esc(ex.message)}`; }
  };
  const ck = $('[data-clear-key]', view);
  if (ck) ck.onclick = async () => { await save({ aiApiKey: '', aiBaseUrl: '' }, 'Your key was removed'); renderSettings(view); };
  $('[data-pw]', view).onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/auth/password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); toast('Password changed', 'ok'); }
    catch (ex) { toast(ex.message, 'error'); }
  };
  $('[data-export]', view).onclick = async () => {
    const data = await api('/api/export');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `fluento-${store.me.user.username}-${today()}.json`;
    a.click();
  };
  $('[data-delete]', view).onclick = async () => {
    if (!await confirmBox('Delete your account and ALL your progress, notes and chats? This cannot be undone.', 'Delete forever')) return;
    const password = prompt('Type your password to confirm:');
    if (!password) return;
    try { await api('/api/account', { method: 'DELETE', body: { password } }); location.reload(); }
    catch (ex) { toast(ex.message, 'error'); }
  };
}

// ---------- keyboard ----------
document.addEventListener('keydown', (e) => {
  if (!store.me || e.target.closest('input, textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '/') { e.preventDefault(); $('.search input')?.focus(); }
  if (e.key === 'a' || e.key === 'A') { if (!$('.quiz')) { e.preventDefault(); tutor.toggle(); } }
});

// ---------- boot ----------
async function boot() {
  cfg = cfg || await api('/api/config');
  try { store.me = await api('/api/me'); } catch { store.me = null; }
  applyTheme();
  if (!store.me) { renderAuth(); return; }
  store.course = await api('/api/course');
  await loadState();
  shell();
  route();
  const r = store.me.resume;
  if (r?.route && (!location.hash || location.hash === '#/') && Date.now() - (r.at || 0) < 30 * 86400e3) {
    const bar = document.createElement('div');
    bar.className = 'resume-bar';
    bar.innerHTML = `📍 Continue where you left off: <b>${esc(r.title || r.route)}</b> <button class="btn small primary">Continue</button><button class="icon-btn small" aria-label="Close">✕</button>`;
    document.body.append(bar);
    bar.querySelector('.btn').onclick = () => { bar.remove(); continueResume(); };
    bar.querySelector('.icon-btn').onclick = () => bar.remove();
    setTimeout(() => bar.remove(), 15000);
    window.addEventListener('hashchange', () => bar.remove(), { once: true });
  }
}
boot().catch((e) => { app.innerHTML = `<div class="page"><h1>Cannot load</h1><p>${esc(e.message)}</p></div>`; });

