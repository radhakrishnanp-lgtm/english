// Unit games: Quick Fire (beat the clock), Memory Match (pair sentence halves), Sentence Builder (word order race).
import { esc, inline } from './md.js';
import { api, toast, shuffle, speak, norm, today, loadState } from './core.js';
import { fullSentence } from './quiz.js';

const GAMES = [
  ['quick', '⚡', 'Quick Fire', 'Answer as fast as you can. 3 lives, 60 seconds, combos for streaks!'],
  ['match', '🃏', 'Memory Match', 'Flip the cards and join the two halves of each sentence.'],
  ['build', '🧩', 'Sentence Builder', 'Build sentences from mixed-up words before the timer runs out.'],
];
const bestKey = (u, g) => `best:${u.id}:${g}`;
const best = (u, g) => Number(localStorage.getItem(bestKey(u, g)) || 0);

function record(u, game, results, bonusXp) {
  return api('/api/results', {
    method: 'POST',
    body: { unitId: u.id, kind: 'game', title: `Unit ${u.id} · ${GAMES.find((g) => g[0] === game)[2]}`, day: today(), results, bonusXp, detail: [] },
  }).then((r) => { loadState(); return r; }).catch(() => ({ xp: 0 }));
}

export function renderGames(body, u, game) {
  if (game === 'quick') return quickFire(body, u);
  if (game === 'match') return memoryMatch(body, u);
  if (game === 'build') return builder(body, u);
  body.innerHTML = `<p class="muted">Play to remember! Games mix questions from all three levels of this unit.</p>
    <div class="grid practice-grid">${GAMES.map(([k, ic, name, desc]) => `<a class="card practice-card game-card" href="#/unit/${u.id}/games/${k}">
      <span class="p-ic">${ic}</span><h3>${name}</h3><p class="muted small">${desc}</p><span class="pill">🏆 Best: ${best(u, k)}</span></a>`).join('')}</div>`;
}

const back = (u) => `<a class="btn ghost small" href="#/unit/${u.id}/games">← All games</a>`;

function endScreen(body, u, game, score, extra, results, bonusXp) {
  const prev = best(u, game);
  const isBest = score > prev;
  if (isBest) localStorage.setItem(bestKey(u, game), score);
  body.innerHTML = `<div class="card center game-end">
    <div class="big-emoji">${isBest ? '🏆' : '🎮'}</div>
    <h2>${isBest ? 'New best score!' : 'Game over'}</h2>
    <div class="big-score">${score}</div>
    <p class="muted">${extra}${prev && !isBest ? ` · Best: ${prev}` : ''}</p>
    <div class="xp-pill" data-xp hidden></div>
    <div class="row center gap"><button class="btn primary" data-again>Play again</button>${back(u)}</div></div>`;
  body.querySelector('[data-again]').onclick = () => renderGames(body, u, game);
  record(u, game, results, bonusXp).then((r) => { const x = body.querySelector('[data-xp]'); if (x && r.xp) { x.hidden = false; x.textContent = `+${r.xp} XP`; } });
}

// ---------- Quick Fire ----------
function quickPool(u) {
  const all = ['easy', 'medium', 'hard'].flatMap((l) => u.practice[l]);
  const mc = all.filter((q) => q.t === 'mc');
  // Turn one-blank fill questions into multiple choice using other answers as wrong options.
  const fills = all.filter((q) => q.t === 'fill' && q.q.split('___').length === 2);
  const answers = [...new Set(fills.map((q) => q.a[0]))];
  const fromFill = fills.map((q) => {
    const wrong = shuffle(answers.filter((a) => norm(a) !== norm(q.a[0]) && !q.a.some((x) => norm(x) === norm(a)))).slice(0, 2);
    if (wrong.length < 2) return null;
    const o = shuffle([q.a[0], ...wrong]);
    return { ...q, t: 'mc', q: q.q, o, a: o.indexOf(q.a[0]) };
  }).filter(Boolean);
  return shuffle([...mc, ...fromFill]);
}

function quickFire(body, u) {
  const pool = quickPool(u);
  if (pool.length < 3) { body.innerHTML = `<p>Not enough questions for this game in this unit.</p>${back(u)}`; return; }
  let time = 60; let lives = 3; let score = 0; let combo = 0; let n = 0;
  const results = [];
  body.innerHTML = `<div class="game-hud row between"><span class="pill">⏱️ <b data-t>60</b>s</span><span class="pill" data-lives>❤️❤️❤️</span><span class="pill">⭐ <b data-s>0</b></span><span class="pill combo" data-c></span></div>
    <div class="card game-stage"></div><div class="row">${back(u)}</div>`;
  const stage = body.querySelector('.game-stage');
  const hud = () => {
    body.querySelector('[data-t]').textContent = time;
    body.querySelector('[data-lives]').textContent = '❤️'.repeat(lives) + '🤍'.repeat(3 - lives);
    body.querySelector('[data-s]').textContent = score;
    body.querySelector('[data-c]').textContent = combo > 1 ? `🔥 x${Math.min(5, combo)}` : '';
  };
  const end = () => { clearInterval(timer); endScreen(body, u, 'quick', score, `${results.filter((r) => r.correct).length} correct · ${results.length} answered`, results, Math.min(20, Math.floor(score / 50))); };
  const timer = setInterval(() => { time--; hud(); if (time <= 0) end(); }, 1000);
  window.addEventListener('hashchange', () => clearInterval(timer), { once: true });
  const show = () => {
    const q = pool[n % pool.length];
    stage.innerHTML = `<div class="q-text big">${inline(q.q).replace('___', '<span class="blank">____</span>')}</div>
      <div class="options">${q.o.map((o, k) => `<button class="option" data-k="${k}"><kbd>${k + 1}</kbd> ${esc(o)}</button>`).join('')}</div>`;
    stage.querySelectorAll('.option').forEach((b) => { b.onclick = () => answer(Number(b.dataset.k)); });
  };
  const answer = (k) => {
    const q = pool[n % pool.length];
    const ok = k === q.a;
    results.push({ qid: q.id, correct: ok });
    if (ok) { combo++; score += 10 * Math.min(5, combo); time += 2; } else { combo = 0; lives--; toast(`✗ ${q.o[q.a]}`, 'warn', 1200); }
    stage.classList.remove('flash-ok', 'flash-no'); void stage.offsetWidth; stage.classList.add(ok ? 'flash-ok' : 'flash-no');
    hud();
    n++;
    if (lives <= 0) end(); else show();
  };
  body.onkeydown = (e) => { if (/^[1-4]$/.test(e.key)) answer(Number(e.key) - 1); };
  body.tabIndex = -1; body.focus();
  hud(); show();
}

// ---------- Memory Match ----------
function halves(sentence) {
  const w = sentence.replace(/[*~`]/g, '').split(/\s+/);
  if (w.length < 4) return null;
  const cut = Math.ceil(w.length / 2);
  return [w.slice(0, cut).join(' ') + ' …', '… ' + w.slice(cut).join(' ')];
}
function memoryMatch(body, u) {
  const sents = shuffle([...new Set([...u.examples.map((e) => e.s), ...u.practice.easy.map(fullSentence)])]).map((s) => ({ s, h: halves(s) })).filter((x) => x.h).slice(0, 6);
  if (sents.length < 3) { body.innerHTML = `<p>Not enough sentences for this game.</p>${back(u)}`; return; }
  const cards = shuffle(sents.flatMap((x, id) => [{ id, side: 0, text: x.h[0] }, { id, side: 1, text: x.h[1] }]));
  let open = []; let moves = 0; let found = 0; const t0 = Date.now(); let lock = false;
  body.innerHTML = `<div class="game-hud row between"><span class="pill">🔄 Moves: <b data-m>0</b></span><span class="pill">✅ <b data-f>0</b>/${sents.length}</span></div>
    <div class="mm-grid">${cards.map((c, i) => `<button class="mm-card" data-i="${i}"><span class="mm-back">?</span><span class="mm-front">${esc(c.text)}</span></button>`).join('')}</div>
    <div class="row">${back(u)}</div>`;
  body.querySelectorAll('.mm-card').forEach((el) => {
    el.onclick = () => {
      if (lock || el.classList.contains('flip')) return;
      el.classList.add('flip');
      open.push(el);
      if (open.length < 2) return;
      moves++;
      body.querySelector('[data-m]').textContent = moves;
      const [a, b] = open.map((x) => cards[Number(x.dataset.i)]);
      if (a.id === b.id && a.side !== b.side) {
        open.forEach((x) => x.classList.add('done'));
        found++;
        body.querySelector('[data-f]').textContent = found;
        speak(sents[a.id].s);
        open = [];
        if (found === sents.length) {
          const secs = Math.round((Date.now() - t0) / 1000);
          const score = Math.max(10, 200 - (moves - sents.length) * 10 - secs);
          setTimeout(() => endScreen(body, u, 'match', score, `${moves} moves · ${secs}s`, sents.map((_, k) => ({ qid: `game-match-${k}`, correct: true })), 5), 900);
        }
      } else {
        lock = true;
        setTimeout(() => { open.forEach((x) => x.classList.remove('flip')); open = []; lock = false; }, 900);
      }
    };
  });
}

// ---------- Sentence Builder ----------
function builder(body, u) {
  const pool = shuffle([...new Set([...['easy', 'medium', 'hard'].flatMap((l) => u.practice[l].filter((q) => q.t === 'order').map((q) => q.a)), ...u.examples.map((e) => e.s.replace(/[*~`]/g, ''))])]
    .filter((s) => { const n = s.split(/\s+/).length; return n >= 3 && n <= 10; })).slice(0, 8);
  if (pool.length < 3) { body.innerHTML = `<p>Not enough sentences for this game.</p>${back(u)}`; return; }
  let n = 0; let score = 0; const results = []; let time; let timer;
  const words = (s) => s.replace(/[.!?]+$/, '').split(/\s+/);
  body.innerHTML = `<div class="game-hud row between"><span class="pill">🧩 <b data-n>1</b>/${pool.length}</span><span class="pill">⏱️ <b data-t></b>s</span><span class="pill">⭐ <b data-s>0</b></span></div>
    <div class="card game-stage"></div><div class="row">${back(u)}</div>`;
  const stage = body.querySelector('.game-stage');
  const round = () => {
    if (n >= pool.length) { clearInterval(timer); endScreen(body, u, 'build', score, `${results.filter((r) => r.correct).length} of ${pool.length} sentences`, results, Math.min(15, Math.floor(score / 40))); return; }
    const target = pool[n];
    const ws = words(target);
    time = 8 + ws.length * 2;
    let picked = [];
    let mixed = shuffle(ws.map((w, k) => ({ w, k })));
    if (mixed.map((x) => x.w).join(' ') === ws.join(' ')) mixed = [...mixed.slice(1), mixed[0]];
    body.querySelector('[data-n]').textContent = n + 1;
    const draw = () => {
      stage.innerHTML = `<div class="order-answer ${picked.length ? '' : 'empty'}">${picked.map((x, i) => `<button class="chip on" data-b="${i}">${esc(x.w)}</button>`).join('') || '<span class="muted">Tap the words in order</span>'}</div>
        <div class="order-pool">${mixed.map((x, i) => `<button class="chip" data-p="${i}" ${picked.includes(x) ? 'disabled' : ''}>${esc(x.w)}</button>`).join('')}</div>`;
      stage.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => { picked.push(mixed[Number(b.dataset.p)]); if (picked.length === ws.length) done(); else draw(); }; });
      stage.querySelectorAll('[data-b]').forEach((b) => { b.onclick = () => { picked.splice(Number(b.dataset.b), 1); draw(); }; });
    };
    const done = (timeout = false) => {
      clearInterval(timer);
      const ok = !timeout && norm(picked.map((x) => x.w).join(' ')) === norm(target);
      results.push({ qid: `game-build-${n}`, correct: ok });
      if (ok) score += 20 + time * 5;
      body.querySelector('[data-s]').textContent = score;
      stage.innerHTML = `<div class="q-text">${ok ? '✅' : '❌'} ${esc(target)}</div>`;
      speak(target);
      n++;
      setTimeout(round, ok ? 1100 : 2000);
    };
    draw();
    body.querySelector('[data-t]').textContent = time;
    timer = setInterval(() => { time--; body.querySelector('[data-t]').textContent = Math.max(0, time); if (time <= 0) done(true); }, 1000);
  };
  window.addEventListener('hashchange', () => clearInterval(timer), { once: true });
  round();
}
