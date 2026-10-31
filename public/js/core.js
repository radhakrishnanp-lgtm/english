// Shared state, API client and UI helpers.
import { esc } from './md.js';

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await r.json(); } catch { /* empty */ }
  if (!r.ok) {
    const err = new Error(data?.error || `Request failed (${r.status})`);
    err.status = r.status;
    if (r.status === 401 && !path.startsWith('/api/auth')) window.dispatchEvent(new Event('auth-lost'));
    throw err;
  }
  return data;
}

// ---------- global store ----------
export const store = {
  me: null, course: null, state: null, units: new Map(), searchIndex: null,
  listeners: new Set(),
  emit() { for (const f of this.listeners) f(); },
};

export async function loadState() {
  store.state = await api(`/api/state?today=${today()}`);
  store.emit();
  return store.state;
}

export async function getUnit(id) {
  id = Number(id);
  if (!store.units.has(id)) store.units.set(id, await api(`/api/units/${id}`));
  return store.units.get(id);
}

export const unitMeta = (id) => store.course.index.find((u) => u.id === Number(id));

export function levelInfo(unitId) {
  const out = { easy: null, medium: null, hard: null };
  for (const p of store.state?.progress || []) if (p.unit_id === Number(unitId)) out[p.level] = p;
  return out;
}
export const passed = (p) => Boolean(p && p.best >= 80);
export function unitStatus(unitId) {
  const l = levelInfo(unitId);
  const n = ['easy', 'medium', 'hard'].filter((k) => passed(l[k])).length;
  return { levels: l, passedCount: n, mastered: n === 3, started: Object.values(l).some(Boolean) };
}
export const flagsOf = (unitId) => store.state?.flags.find((f) => f.unit_id === Number(unitId)) || { bookmarked: 0, important: 0 };

export async function setFlag(unitId, patch) {
  const f = await api(`/api/flags/${unitId}`, { method: 'PUT', body: patch });
  const list = store.state.flags;
  const i = list.findIndex((x) => x.unit_id === f.unit_id);
  if (i === -1) list.push(f); else list[i] = f;
  store.emit();
  return f;
}

// ---------- DOM helpers ----------
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export { esc };

export function toast(msg, type = 'info', ms = 2600) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}

export function modal(html, { wide = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><button class="icon-btn modal-x" aria-label="Close">✕</button>${html}</div>`;
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('.modal-x')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(wrap);
  return { el: wrap.querySelector('.modal'), close };
}

export function confirmBox(text, okLabel = 'OK') {
  return new Promise((resolve) => {
    const m = modal(`<p>${esc(text)}</p><div class="row end"><button class="btn ghost" data-no>Cancel</button><button class="btn danger" data-yes>${esc(okLabel)}</button></div>`);
    m.el.querySelector('[data-no]').onclick = () => { m.close(); resolve(false); };
    m.el.querySelector('[data-yes]').onclick = () => { m.close(); resolve(true); };
  });
}

export const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
export const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

// ---------- speech ----------
let voices = [];
if ('speechSynthesis' in window) {
  const load = () => { voices = speechSynthesis.getVoices(); };
  load();
  speechSynthesis.onvoiceschanged = load;
}
export const englishVoices = () => voices.filter((v) => /^en[-_]/i.test(v.lang));

export function speak(text, { rate } = {}) {
  if (!('speechSynthesis' in window)) { toast('Speech is not supported in this browser', 'warn'); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/___/g, 'blank'));
  const s = store.me?.settings || {};
  u.rate = rate || s.speechRate || 0.95;
  const v = voices.find((x) => x.name === s.voice) || englishVoices().find((x) => /en-(US|GB)/i.test(x.lang)) || englishVoices()[0];
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
  speechSynthesis.speak(u);
}

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = Boolean(SR);
export function listen() {
  return new Promise((resolve, reject) => {
    if (!SR) { reject(new Error('Speech recognition is not supported in this browser (try Chrome or Edge).')); return; }
    const r = new SR();
    r.lang = 'en-US';
    r.interimResults = false;
    r.maxAlternatives = 3;
    r.onresult = (e) => resolve([...e.results[0]].map((a) => a.transcript));
    r.onerror = (e) => reject(new Error(e.error === 'not-allowed' ? 'Microphone permission denied.' : `Mic error: ${e.error}`));
    r.onend = () => resolve([]);
    r.start();
  });
}

// ---------- answer checking ----------
export function norm(s) {
  return String(s).toLowerCase().replace(/[’‘`]/g, "'").replace(/[“”]/g, '"')
    .replace(/[.!?,;:"]+/g, ' ').replace(/\s+/g, ' ').trim();
}
/** Similarity 0..1 between two sentences by word overlap (for speaking practice). */
export function similarity(a, b) {
  const x = norm(a).split(' ');
  const y = norm(b).split(' ');
  const dp = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
  for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) {
    dp[i][j] = x[i - 1] === y[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  }
  return (2 * dp[x.length][y.length]) / (x.length + y.length || 1);
}

// Global click handler for any [data-say] button.
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-say]');
  if (b) { e.preventDefault(); speak(b.dataset.say); }
});

export function levelDots(id) {
  const st = unitStatus(id);
  return `<div class="dots">${['easy', 'medium', 'hard'].map((l) => {
    const p = st.levels[l];
    return `<span class="dot ${p ? (p.best >= 80 ? 'pass' : 'tried') : ''}" title="${l}: ${p ? p.best + '%' : 'not started'}">${l[0].toUpperCase()}</span>`;
  }).join('')}</div>`;
}
