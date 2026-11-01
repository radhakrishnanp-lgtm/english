// Practice hub: review mistakes, daily mix, placement test, irregular verbs, dictation, speaking, speed round.
import { esc } from './md.js';
import {
  api, store, getUnit, unitMeta, unitStatus, toast, $, $$, speak, listen, canListen, similarity, shuffle, today,
  loadState, norm,
} from './core.js';
import { runQuiz, fullSentence } from './quiz.js';
import { VERBS, VERB_GROUPS } from './verbs.js';

const rand = (n) => Math.floor(Math.random() * n);
const post = (results, bonusXp = 0) => api('/api/results', { method: 'POST', body: { day: today(), results, bonusXp } })
  .then((r) => { loadState(); return r; }).catch((e) => toast(e.message, 'error'));

/** Units the learner has opened or practised (falls back to the first units). */
function studiedUnits() {
  const ids = new Set([
    ...store.state.flags.filter((f) => f.visited_at).map((f) => f.unit_id),
    ...store.state.progress.map((p) => p.unit_id),
  ]);
  return ids.size ? [...ids] : [1, 2, 3, 4, 5];
}

export async function renderPractice(view, sub, arg) {
  const pages = { review, mix, placement, verbs, dictation, speaking, speed };
  if (pages[sub]) { await pages[sub](view, arg); return; }
  document.title = 'Practice — Fluento';
  const due = store.state.mistakes.filter((m) => m.due_at <= Date.now()).length;
  const cards = [
    ['../review', '🧠', "Today's review", `Spaced review of units, verbs and saved sentences — so you never forget.${store.state.reviewDue ? ` <b>${store.state.reviewDue} due now.</b>` : ''}`],
    ['review', '🔁', 'Review mistakes', `Questions you got wrong come back after 1, 3 and 7 days until you know them.${due ? ` <b>${due} due now.</b>` : ''}`],
    ['mix', '🎲', 'Daily mix', '10 mixed questions from the units you have studied.'],
    ['speed', '⏱️', 'Speed round', 'Answer as many as you can in 60 seconds!'],
    ['placement', '🧭', 'Level test', 'Find out which sections you know and where to start.'],
    ['verbs', '⚡', 'Irregular verbs', 'Flashcards, groups and a typing drill for go–went–gone.'],
    ['dictation', '🎧', 'Listening (dictation)', 'Listen to a sentence and type what you hear.'],
    ['speaking', '🎤', 'Speaking', canListen ? 'Say sentences out loud and get a pronunciation score.' : 'Needs Chrome or Edge (speech recognition).'],
  ];
  view.innerHTML = `<div class="page">
    <h1>Practice</h1>
    <p class="muted">Different ways to practise. Every correct answer gives you XP.</p>
    <div class="grid practice-grid">${cards.map(([k, ic, t, d]) => `<a class="card practice-card" href="${k.startsWith('../') ? '#/' + k.slice(3) : '#/practice/' + k}"><span class="p-ic">${ic}</span><h3>${t}</h3><p class="muted small">${d}</p></a>`).join('')}</div>
  </div>`;
}

const header = (title, sub) => `<div class="crumbs"><a href="#/practice">Practice</a> › ${esc(title)}</div><h1>${esc(title)}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}`;

// ---------- review ----------
async function review(view) {
  document.title = 'Review mistakes — Fluento';
  const all = store.state.mistakes;
  const due = all.filter((m) => m.due_at <= Date.now());
  view.innerHTML = `<div class="page narrow">${header('Review mistakes', `${all.length} question${all.length === 1 ? '' : 's'} in your review list · ${due.length} due now.`)}<div class="host"></div></div>`;
  const host = $('.host', view);
  if (!all.length) { host.innerHTML = '<div class="empty card">🎉 No mistakes to review. Practise some units and come back.</div>'; return; }
  const start = async (list) => {
    const qs = await api(`/api/questions?ids=${list.slice(0, 20).map((m) => m.qid).join(',')}`);
    runQuiz(host, shuffle(qs), { title: 'Review mistakes', kind: 'review' });
  };
  if (due.length) start(due);
  else {
    host.innerHTML = `<div class="card center"><p>Nothing is due yet — great! You can still review early.</p><button class="btn primary">Review ${Math.min(20, all.length)} anyway</button></div>`;
    host.querySelector('button').onclick = () => start(all);
  }
}

// ---------- mix ----------
async function mix(view) {
  document.title = 'Daily mix — Fluento';
  view.innerHTML = `<div class="page narrow">${header('Daily mix', 'Mixed questions from units you have studied.')}<div class="host"><p class="muted">Loading…</p></div></div>`;
  const ids = shuffle(studiedUnits()).slice(0, 8);
  const units = await Promise.all(ids.map(getUnit));
  const pool = units.flatMap((u) => ['easy', 'medium', 'hard'].flatMap((l) => u.practice[l].map((q) => ({ ...q, unit: u.id, unitTitle: u.title }))));
  runQuiz($('.host', view), shuffle(pool).slice(0, 10), { title: 'Daily mix', kind: 'mix' });
}

// ---------- speed round ----------
async function speed(view) {
  document.title = 'Speed round — Fluento';
  view.innerHTML = `<div class="page narrow">${header('Speed round', 'Multiple-choice questions. 60 seconds. +1 second for each correct answer!')}
    <div class="card center host"><div class="big-emoji">⏱️</div><button class="btn primary lg" data-go>Start</button>
    <p class="muted small">Best: ${Number(localStorage.getItem('speedBest') || 0)}</p></div></div>`;
  $('[data-go]', view).onclick = async () => {
    const units = await Promise.all(shuffle(studiedUnits()).slice(0, 10).map(getUnit));
    const pool = shuffle(units.flatMap((u) => ['easy', 'medium'].flatMap((l) => u.practice[l].filter((q) => q.t === 'mc').map((q) => ({ ...q, unit: u.id })))));
    const host = $('.host', view);
    let time = 60;
    let score = 0;
    let n = 0;
    const results = [];
    const tick = setInterval(() => { time--; draw(); if (time <= 0) end(); }, 1000);
    const end = () => {
      clearInterval(tick);
      const best = Math.max(score, Number(localStorage.getItem('speedBest') || 0));
      localStorage.setItem('speedBest', best);
      host.innerHTML = `<div class="big-emoji">🏁</div><h2>${score} correct!</h2><p class="muted">Best: ${best}</p><a class="btn primary" href="#/practice/speed" data-again>Play again</a>`;
      host.querySelector('[data-again]').onclick = (e) => { e.preventDefault(); speed(view); };
      post(results);
    };
    window.addEventListener('hashchange', () => clearInterval(tick), { once: true });
    function draw() {
      const q = pool[n % pool.length];
      if (!q) { end(); return; }
      if (host.dataset.q !== String(n)) {
        host.dataset.q = String(n);
        host.innerHTML = `<div class="row between"><span class="pill">⏱️ <b data-time>${time}</b>s</span><span class="pill">✔ ${score}</span></div>
          <div class="q-text big">${esc(q.q).replace('___', '<span class="blank">____</span>')}</div>
          <div class="options">${q.o.map((o, k) => `<button class="option" data-k="${k}"><kbd>${k + 1}</kbd> ${esc(o)}</button>`).join('')}</div>`;
        $$('.option', host).forEach((b) => { b.onclick = () => answer(Number(b.dataset.k)); });
      } else host.querySelector('[data-time]').textContent = time;
    }
    function answer(k) {
      const q = pool[n % pool.length];
      const ok = k === q.a;
      results.push({ qid: q.id, correct: ok });
      if (ok) { score++; time++; }
      host.classList.remove('flash-ok', 'flash-no');
      void host.offsetWidth;
      host.classList.add(ok ? 'flash-ok' : 'flash-no');
      n++;
      draw();
    }
    host.onkeydown = (e) => { if (/^[1-4]$/.test(e.key)) answer(Number(e.key) - 1); };
    host.tabIndex = -1;
    host.focus();
    draw();
  };
}

// ---------- placement ----------
async function placement(view) {
  document.title = 'Level test — Fluento';
  const secs = store.course.sections;
  view.innerHTML = `<div class="page narrow">${header('Level test', `${secs.length * 2} questions — two from each section. Don't guess: skip if you don't know. It takes about 10 minutes.`)}
    <div class="host card center"><div class="big-emoji">🧭</div><button class="btn primary lg">Start the test</button></div></div>`;
  $('.host button', view).onclick = async () => {
    const ids = [];
    for (const s of secs) {
      const us = shuffle(s.units);
      for (const [n, lv] of [[0, 'e'], [1, 'm']]) {
        const u = store.course.index.find((x) => x.id === us[n % us.length]);
        const cnt = u.counts[lv === 'e' ? 'easy' : 'medium'];
        if (cnt) ids.push(`${u.id}-${lv}${rand(cnt)}`);
      }
    }
    const qs = await api(`/api/questions?ids=${ids.join(',')}`);
    const host = $('.host', view);
    host.classList.remove('center', 'card');
    runQuiz(host, qs, {
      title: 'Level test', record: false, save: false,
      onDone: ({ results, root }) => {
        const bySec = secs.map((s) => {
          const rs = results.filter((r) => s.units.includes(r.q.unit));
          return { s, ok: rs.filter((r) => r.correct).length, n: rs.length };
        });
        const weak = bySec.filter((x) => x.ok < x.n);
        const first = weak[0]?.s.units[0] || 1;
        const box = document.createElement('div');
        box.className = 'card placement-result';
        box.innerHTML = `<h2>Your study map</h2>
          <table><tbody>${bySec.map((x) => `<tr><td>${esc(x.s.name)}</td><td>${'🟢'.repeat(x.ok)}${'⚪'.repeat(x.n - x.ok)}</td>
          <td>${x.ok === x.n ? '<span class="ok-txt">Looks good</span>' : `<a href="#/course/${encodeURIComponent(x.s.name)}">Study this →</a>`}</td></tr>`).join('')}</tbody></table>
          <p>${weak.length ? `Start with <b>Unit ${first}: ${esc(unitMeta(first).title)}</b>.` : 'Excellent! Try the Hard levels to master each unit.'}</p>
          <div class="row gap wrap"><a class="btn primary" href="#/unit/${first}">Go to Unit ${first}</a>
          ${weak.length ? '<button class="btn" data-mark>⭐ Mark weak sections as important</button>' : ''}</div>`;
        root.querySelector('.quiz-done').prepend(box);
        const mk = box.querySelector('[data-mark]');
        if (mk) mk.onclick = async () => {
          for (const x of weak) for (const id of x.s.units) await api(`/api/flags/${id}`, { method: 'PUT', body: { important: true } });
          await loadState();
          toast('Weak sections marked ⭐ important. Filter them in Course.', 'ok');
          mk.disabled = true;
        };
      },
    });
  };
}

// ---------- irregular verbs ----------
async function verbs(view, mode = 'cards') {
  document.title = 'Irregular verbs — Fluento';
  const tabs = [['cards', '🃏 Flashcards'], ['drill', '⌨️ Typing drill'], ['groups', '🧩 Groups'], ['list', '📋 Full list']];
  view.innerHTML = `<div class="page narrow">${header('Irregular verbs', `${VERBS.length} common irregular verbs.`)}
    <div class="tabs">${tabs.map(([k, l]) => `<a href="#/practice/verbs/${k}" class="${k === mode ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div class="host"></div></div>`;
  const host = $('.host', view);
  if (mode === 'list') {
    host.innerHTML = `<input class="text-input wide" placeholder="Filter…" data-f>
      <div class="table-wrap"><table class="verbs"><thead><tr><th>Base</th><th>Past simple</th><th>Past participle</th><th>Meaning</th></tr></thead><tbody></tbody></table></div>`;
    const tb = host.querySelector('tbody');
    const draw = (f = '') => {
      tb.innerHTML = VERBS.filter((v) => !f || Object.values(v).join(' ').toLowerCase().includes(f)).map((v) =>
        `<tr><td><button class="link" data-say="${esc(`${v.base}, ${v.past}, ${v.pp}`)}">🔊 <b>${esc(v.base)}</b></button></td><td>${esc(v.past)}</td><td>${esc(v.pp)}</td><td class="muted small">${esc(v.meaning)}</td></tr>`).join('');
    };
    draw();
    host.querySelector('[data-f]').oninput = (e) => draw(e.target.value.toLowerCase().trim());
    return;
  }
  if (mode === 'groups') {
    host.innerHTML = `<p class="muted">Learn verbs in groups with the same pattern — it's much easier!</p>${VERB_GROUPS.map(([name, list]) => `
      <div class="card"><h3>${esc(name)}</h3><div class="verb-chips">${list.map((b) => { const v = VERBS.find((x) => x.base === b); return v ? `<button class="chip" data-say="${esc(`${v.base}, ${v.past}, ${v.pp}`)}"><b>${v.base}</b> · ${v.past} · ${v.pp}</button>` : ''; }).join('')}</div></div>`).join('')}`;
    return;
  }
  if (mode === 'cards') {
    let deck = shuffle(VERBS);
    let i = 0;
    let known = 0;
    const draw = () => {
      if (i >= deck.length) { host.innerHTML = `<div class="card center"><h2>Deck finished!</h2><p>You knew ${known} of ${deck.length}.</p><button class="btn primary">Again</button></div>`; host.querySelector('button').onclick = () => { deck = shuffle(VERBS); i = 0; known = 0; draw(); }; return; }
      const v = deck[i];
      host.innerHTML = `<div class="flashcard" tabindex="0"><div class="fc-inner">
        <div class="fc-front"><div class="muted small">${i + 1} / ${deck.length}</div><div class="fc-word">${esc(v.base)}</div><div class="muted">${esc(v.meaning)}</div><div class="muted small">Say the past and past participle, then tap to flip</div></div>
        <div class="fc-back"><div class="fc-word">${esc(v.base)} · ${esc(v.past)} · ${esc(v.pp)}</div>
          <button class="btn ghost small" data-say="${esc(`${v.base}, ${v.past}, ${v.pp}`)}">🔊 Listen</button></div></div></div>
        <div class="row center gap"><button class="btn" data-r="0">🔁 Again</button><button class="btn primary" data-r="1">✅ I knew it</button></div>`;
      const fc = host.querySelector('.flashcard');
      fc.onclick = (e) => { if (!e.target.closest('[data-say]')) fc.classList.toggle('flip'); };
      fc.onkeydown = (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); fc.classList.toggle('flip'); } };
      host.querySelectorAll('[data-r]').forEach((b) => {
        b.onclick = () => { if (b.dataset.r === '1') known++; else deck.push(v); i++; draw(); };
      });
      fc.focus();
    };
    draw();
    return;
  }
  // typing drill
  const round = shuffle(VERBS).slice(0, 10);
  let i = 0;
  const results = [];
  const draw = () => {
    if (i >= round.length) {
      const ok = results.filter((r) => r.correct).length;
      host.innerHTML = `<div class="card center"><h2>${ok} / ${round.length}</h2><p class="muted">${ok === round.length ? 'Perfect! 🎉' : 'Keep practising!'}</p>
        <ul class="review-list left">${results.filter((r) => !r.correct).map((r) => `<li><b>${r.v.base}</b> → ${r.v.past} · ${r.v.pp} <span class="muted small">(you wrote: ${esc(r.given)})</span></li>`).join('')}</ul>
        <a class="btn primary" href="#/practice/verbs/drill" data-again>New round</a></div>`;
      host.querySelector('[data-again]').onclick = (e) => { e.preventDefault(); verbs(view, 'drill'); };
      post(results.map((r) => ({ qid: `verb-${r.v.base}`, correct: r.correct })));
      return;
    }
    const v = round[i];
    host.innerHTML = `<form class="card drill"><div class="muted small">${i + 1} / ${round.length}</div>
      <div class="fc-word">${esc(v.base)} <button type="button" class="icon-btn" data-say="${esc(v.base)}">🔊</button></div><div class="muted">${esc(v.meaning)}</div>
      <div class="row gap wrap center"><label>Past simple<input name="past" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <label>Past participle<input name="pp" autocomplete="off" autocapitalize="off" spellcheck="false"></label></div>
      <div class="drill-fb"></div><button class="btn primary">Check</button></form>`;
    const f = host.querySelector('form');
    f.past.focus();
    let done = false;
    f.onsubmit = (e) => {
      e.preventDefault();
      if (done) { i++; draw(); return; }
      const okForm = (given, want) => want.replace(/\s*\(.*?\)/g, '').split('/').some((w) => norm(w) === norm(given));
      const ok = okForm(f.past.value, v.past) && okForm(f.pp.value, v.pp);
      results.push({ v, correct: ok, given: `${f.past.value} · ${f.pp.value}` });
      host.querySelector('.drill-fb').innerHTML = ok ? '✅ Correct!' : `❌ ${esc(v.base)} → <b>${esc(v.past)}</b> → <b>${esc(v.pp)}</b>`;
      speak(`${v.base}, ${v.past}, ${v.pp}`);
      done = true;
      f.querySelector('.btn').textContent = 'Next →';
    };
  };
  draw();
}

// ---------- dictation / speaking ----------
async function sentencePool(unitId) {
  const units = unitId ? [await getUnit(unitId)] : await Promise.all(shuffle(studiedUnits()).slice(0, 6).map(getUnit));
  return shuffle(units.flatMap((u) => [...u.examples.map((e) => e.s), ...u.practice.easy.map(fullSentence)].map((s) => ({ s: s.replace(/[*~`]/g, ''), unit: u.id }))))
    .filter((x) => x.s.split(' ').length >= 3).slice(0, 10);
}

function diffHtml(given, want) {
  const g = norm(given).split(' ');
  return want.split(/\s+/).map((w) => (g.includes(norm(w)) ? `<span class="ok-txt">${esc(w)}</span>` : `<u class="bad-txt">${esc(w)}</u>`)).join(' ');
}

async function dictation(view, unitId) {
  document.title = 'Listening — Fluento';
  const u = unitId ? unitMeta(unitId) : null;
  view.innerHTML = `<div class="page narrow">${header('Listening (dictation)', u ? `Sentences from Unit ${u.id}: ${esc(u.title)}` : 'Sentences from units you have studied.')}<div class="host"></div></div>`;
  const pool = await sentencePool(unitId);
  const host = $('.host', view);
  let i = 0;
  const results = [];
  const draw = () => {
    if (i >= pool.length) {
      const ok = results.filter((r) => r.correct).length;
      host.innerHTML = `<div class="card center"><h2>${ok} / ${pool.length} perfect</h2><a class="btn primary" href="#/practice/dictation${unitId ? '/' + unitId : ''}" data-again>Again</a></div>`;
      host.querySelector('[data-again]').onclick = (e) => { e.preventDefault(); dictation(view, unitId); };
      post(results.map((r, n) => ({ qid: `dict-${n}`, correct: r.correct })));
      return;
    }
    const item = pool[i];
    host.innerHTML = `<form class="card drill"><div class="muted small">${i + 1} / ${pool.length}</div>
      <div class="row center gap"><button type="button" class="btn lg" data-play>🔊 Play</button><button type="button" class="btn" data-slow>🐢 Slow</button></div>
      <textarea class="text-input wide" rows="2" placeholder="Type what you hear…" spellcheck="false"></textarea>
      <div class="drill-fb"></div><button class="btn primary">Check</button></form>`;
    const f = host.querySelector('form');
    const ta = f.querySelector('textarea');
    host.querySelector('[data-play]').onclick = () => speak(item.s);
    host.querySelector('[data-slow]').onclick = () => speak(item.s, { rate: 0.6 });
    setTimeout(() => speak(item.s), 300);
    ta.focus();
    ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); f.requestSubmit(); } };
    let done = false;
    f.onsubmit = (e) => {
      e.preventDefault();
      if (done) { i++; draw(); return; }
      const sim = similarity(ta.value, item.s);
      const ok = sim >= 0.999;
      results.push({ correct: ok });
      host.querySelector('.drill-fb').innerHTML = `${ok ? '✅ Perfect!' : `${Math.round(sim * 100)}% — `}<div class="dict-ans">${diffHtml(ta.value, item.s)}</div>`;
      done = true;
      f.querySelector('.btn.primary').textContent = 'Next →';
    };
  };
  draw();
}

async function speaking(view, unitId) {
  document.title = 'Speaking — Fluento';
  const u = unitId ? unitMeta(unitId) : null;
  view.innerHTML = `<div class="page narrow">${header('Speaking', u ? `Sentences from Unit ${u.id}: ${esc(u.title)}` : 'Read each sentence out loud. The browser listens and scores you.')}<div class="host"></div></div>`;
  const host = $('.host', view);
  if (!canListen) { host.innerHTML = '<div class="card warn-box">Speech recognition needs Chrome, Edge or Safari. You can still use 🔊 Listen and repeat.</div>'; return; }
  const pool = await sentencePool(unitId);
  let i = 0;
  const results = [];
  const draw = () => {
    if (i >= pool.length) {
      const ok = results.filter((r) => r.correct).length;
      host.innerHTML = `<div class="card center"><h2>${ok} / ${pool.length} great!</h2><a class="btn primary" href="#" data-again>Again</a></div>`;
      host.querySelector('[data-again]').onclick = (e) => { e.preventDefault(); speaking(view, unitId); };
      post(results.map((r, n) => ({ qid: `speak-${n}`, correct: r.correct })));
      return;
    }
    const item = pool[i];
    host.innerHTML = `<div class="card drill center"><div class="muted small">${i + 1} / ${pool.length}</div>
      <div class="say-this">${esc(item.s)}</div>
      <div class="row center gap"><button class="btn" data-say="${esc(item.s)}">🔊 Listen first</button><button class="btn primary lg" data-rec>🎤 Speak</button></div>
      <div class="drill-fb"></div><div class="row center gap"><button class="btn ghost" data-skip>Next →</button></div></div>`;
    let best = 0;
    host.querySelector('[data-rec]').onclick = async (e) => {
      const b = e.currentTarget;
      b.classList.add('rec');
      b.textContent = '🎙️ Listening…';
      try {
        const alts = await listen();
        best = Math.max(best, ...alts.map((a) => similarity(a, item.s)), 0);
        host.querySelector('.drill-fb').innerHTML = alts[0]
          ? `${best >= 0.9 ? '🌟 Excellent!' : best >= 0.7 ? '👍 Good — try once more for 90%+' : '🔁 Try again, slowly.'} <b>${Math.round(best * 100)}%</b><div class="dict-ans">${diffHtml(alts[0], item.s)}</div>`
          : 'I did not hear anything.';
      } catch (err) { toast(err.message, 'error'); }
      b.classList.remove('rec');
      b.textContent = '🎤 Speak again';
    };
    host.querySelector('[data-skip]').onclick = () => { results.push({ correct: best >= 0.8 }); i++; draw(); };
  };
  draw();
}

export { unitStatus };
