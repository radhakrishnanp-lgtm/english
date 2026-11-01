// Unit page: Learn (normal or book view) · Examples · Practice · Exam & results · Visual · Notes
import { md, esc, inline } from './md.js';
import {
  api, store, getUnit, unitMeta, unitStatus, flagsOf, setFlag, toast, $, $$, speak, listen, canListen,
  similarity, shuffle, confirmBox, fmtDate, levelDots, loadState, modal,
} from './core.js';
import { startQuiz } from './quiz.js';
import { renderGames } from './games.js';
import { recallNow, daysText } from './review.js';
import { tutor, aiQuizDialog } from './tutor.js';

const LEVELS = [
  ['easy', '🟢', 'Easy', 'Basic forms and short sentences'],
  ['medium', '🟡', 'Medium', 'Negatives, questions and real sentences'],
  ['hard', '🔴', 'Hard', 'Tricky cases, traps and error correction'],
];
const TABS = [['learn', '📖 Learn'], ['examples', '💬 Examples'], ['practice', '🎯 Practice'], ['games', '🎮 Games'], ['exam', '📝 Exam & results'], ['visual', '🗺️ Visual'], ['notes', '🗒️ Notes']];

export async function renderUnit(view, id, tab = 'learn', level) {
  const meta = unitMeta(id);
  if (!meta) { view.innerHTML = '<div class="page"><h1>Unit not found</h1></div>'; return; }
  const u = await getUnit(id);
  document.title = `Unit ${u.id}: ${u.title} — Fluento`;
  setFlag(u.id, { visited: true }).catch(() => {});
  const prev = unitMeta(u.id - 1);
  const next = unitMeta(u.id + 1);
  if (!TABS.some(([k]) => k === tab)) tab = 'learn';
  const book = tab === 'learn' && store.me.settings.bookView;

  view.innerHTML = `
    <div class="page unit-page ${book ? 'wide' : ''}">
      <div class="crumbs"><a href="#/course">Course</a> › <a href="#/course/${encodeURIComponent(u.section)}">${esc(u.section)}</a> › Unit ${u.id}</div>
      <div class="unit-head">
        <div class="unit-badge">${u.id}</div>
        <div class="grow">
          <h1>${esc(u.title)} <span class="cefr">${u.cefr}</span></h1>
          <p class="muted">${esc(u.summary)}</p>
          <div class="unit-status"></div>
        </div>
        <div class="unit-tools">
          <button class="icon-btn lg" data-flag="bookmarked" title="Bookmark"></button>
          <button class="icon-btn lg" data-flag="important" title="Mark as important"></button>
          <button class="btn ai-btn" data-ask>🤖 Ask AI</button>
        </div>
      </div>
      <div class="tabs sticky-tabs" role="tablist">${TABS.map(([k, l]) => `<a role="tab" href="#/unit/${u.id}/${k}" class="${k === tab ? 'on' : ''}">${l}${k === 'notes' ? '<span class="count" data-notecount></span>' : ''}</a>`).join('')}</div>
      <div class="tab-body"></div>
      <div class="unit-nav">
        ${prev ? `<a class="btn ghost" href="#/unit/${prev.id}">← ${prev.id}. ${esc(prev.title)}</a>` : '<span></span>'}
        ${next ? `<a class="btn ghost" href="#/unit/${next.id}">${next.id}. ${esc(next.title)} →</a>` : ''}
      </div>
    </div>`;

  const drawHead = () => {
    const f = flagsOf(u.id);
    const b = $('[data-flag="bookmarked"]', view);
    const i = $('[data-flag="important"]', view);
    if (!b) return;
    b.textContent = f.bookmarked ? '🔖' : '📑';
    b.classList.toggle('on', Boolean(f.bookmarked));
    b.title = f.bookmarked ? 'Remove bookmark' : 'Bookmark this unit';
    i.textContent = f.important ? '⭐' : '☆';
    i.classList.toggle('on', Boolean(f.important));
    i.title = f.important ? 'Unmark important' : 'Mark as important';
    const st = unitStatus(u.id);
    const mem = (store.state.memory || []).find((x) => x.unit_id === u.id);
    const memTxt = mem ? (mem.due_at <= Date.now()
      ? ` · <a href="#/review" class="mem-pill low">🧠 Review due (${Math.round(recallNow(mem) * 100)}%)</a>`
      : ` · <span class="mem-pill" title="Chance you still remember this unit">🧠 Memory ${Math.round(recallNow(mem) * 100)}% · review in ${daysText(mem.due_at - Date.now())}</span>`) : '';
    $('.unit-status', view).innerHTML = `${levelDots(u.id)} <span class="muted small">${st.mastered ? '✅ Mastered' : `${st.passedCount}/3 levels passed`}${memTxt}</span>`;
    const nc = store.state.noteCounts.find((n) => n.unit_id === u.id)?.n || 0;
    const c = $('[data-notecount]', view);
    if (c) c.textContent = nc ? ` ${nc}` : '';
  };
  drawHead();
  store.listeners.add(drawHead);
  window.addEventListener('hashchange', () => store.listeners.delete(drawHead), { once: true });

  $$('[data-flag]', view).forEach((b) => {
    b.onclick = async () => {
      const k = b.dataset.flag;
      const f = await setFlag(u.id, { [k]: !flagsOf(u.id)[k] });
      toast(k === 'bookmarked' ? (f.bookmarked ? 'Bookmarked 🔖' : 'Bookmark removed') : (f.important ? 'Marked important ⭐' : 'Unmarked'));
    };
  });
  $('[data-ask]', view).onclick = () => tutor.show(`unit:${u.id}`);

  const body = $('.tab-body', view);
  if (tab === 'learn') learnTab(body, u, view);
  if (tab === 'examples') examplesTab(body, u);
  if (tab === 'practice') practiceTab(body, u, level);
  if (tab === 'exam') await examTab(body, u);
  if (tab === 'visual') await visualTab(body, u, level);
  if (tab === 'games') renderGames(body, u, level);
  if (tab === 'notes') await notesTab(body, u);
}

// ---------- learn ----------
function sectionsOf(learn) {
  const out = [];
  let cur = { title: '', text: '' };
  for (const line of learn.split('\n')) {
    const m = /^##\s+(.*)$/.exec(line.trim());
    if (m) { if (cur.title || cur.text.trim()) out.push(cur); cur = { title: m[1], text: '' }; } else cur.text += line + '\n';
  }
  if (cur.title || cur.text.trim()) out.push(cur);
  return out;
}

function lessonHtml(u) {
  const secs = sectionsOf(u.learn);
  return secs.map((s, n) => s.title
    ? `<details class="lsec" id="sec-${n}" open><summary><span class="lsec-num">${n + 1}</span>${inline(s.title)}<span class="lsec-tools"><button class="icon-btn small" data-read="${n}" title="Read this part aloud">🔊</button></span></summary><div class="md">${md(s.text)}</div></details>`
    : `<div class="lsec-intro md">${md(s.text)}</div>`).join('');
}

function learnTab(body, u, view) {
  const book = Boolean(store.me.settings.bookView);
  const secs = sectionsOf(u.learn);
  const mistakesHtml = u.mistakes.length ? `<h2>⚠️ Common mistakes</h2>
    <div class="mistakes">${u.mistakes.map((m) => `
      <div class="mistake"><div class="wrong-sent">❌ ${esc(m.wrong)}</div><div class="right-sent">✅ ${m.right.split(' | ').map(esc).join(' <span class="muted">or</span> ')} <button class="icon-btn small" data-say="${esc(m.right.split(' | ')[0])}">🔊</button></div><div class="muted small">${inline(m.why)}</div></div>`).join('')}</div>` : '';
  const toolbar = `<div class="lesson-bar">
      <div class="seg"><button data-view="normal" class="${book ? '' : 'on'}">📄 Normal</button><button data-view="book" class="${book ? 'on' : ''}">📖 Book view</button></div>
      <button class="chip small" data-collapse>▾ Collapse all</button>
      <button class="chip small ${store.tapToHear ? 'on' : ''}" data-tap title="Tap any word in the lesson to hear how it sounds">🔈 Tap a word to hear it</button>
      <button class="chip small" data-readall>▶️ Read lesson</button>
      <span class="grow"></span>
      <div class="font-size"><button class="chip small" data-font="-1" aria-label="Smaller text">A−</button><button class="chip small" data-font="1" aria-label="Bigger text">A+</button></div>
    </div>`;

  if (book) {
    view.querySelector('.page').classList.add('wide');
    body.innerHTML = `${toolbar}
      <div class="book">
        <section class="book-page left">
          <div class="page-head"><span>Unit ${u.id}</span><span>${esc(u.section)}</span></div>
          <h2 class="book-title">${esc(u.title)}</h2>
          <article class="lesson-body">${lessonHtml(u)}</article>
          ${mistakesHtml}
          <div class="page-foot">${u.id * 2 - 1}</div>
        </section>
        <section class="book-page right">
          <div class="page-head"><span>Exercises</span><span>Unit ${u.id}</span></div>
          <div class="book-ex">
            <div class="seg">${LEVELS.map(([k, ic, n]) => `<button data-blevel="${k}">${ic} ${n}</button>`).join('')}</div>
            <div class="book-quiz"></div>
          </div>
          <div class="page-foot">${u.id * 2}</div>
        </section>
      </div>`;
    const bq = body.querySelector('.book-quiz');
    const start = (lv) => {
      body.querySelectorAll('[data-blevel]').forEach((b) => b.classList.toggle('on', b.dataset.blevel === lv));
      startQuiz(bq, shuffle(u.practice[lv]), { title: `Unit ${u.id} · ${lv}`, unitId: u.id, level: lv, saveKey: `u${u.id}-${lv}` });
    };
    body.querySelectorAll('[data-blevel]').forEach((b) => { b.onclick = () => start(b.dataset.blevel); });
    const st = unitStatus(u.id);
    start(['easy', 'medium', 'hard'].find((l) => !(st.levels[l]?.best >= 80)) || 'easy');
  } else {
    body.innerHTML = `${toolbar}
      <div class="lesson-wrap">
        ${secs.filter((s) => s.title).length > 2 ? `<nav class="toc"><b>In this lesson</b>${secs.map((s, n) => (s.title ? `<a href="#" data-goto="${n}">${inline(s.title)}</a>` : '')).join('')}</nav>` : ''}
        <article class="lesson lesson-body">${lessonHtml(u)}</article>
      </div>
      ${mistakesHtml}
      <div class="cta card">
        <div><b>Ready to practise?</b><p class="muted">Pass all three levels with 80% or more to master this unit, then take the unit exam.</p></div>
        <div class="row gap wrap">
          <a class="btn primary" href="#/unit/${u.id}/practice">🎯 Start practice</a>
          <a class="btn" href="#/unit/${u.id}/visual">🗺️ See it as a diagram</a>
          <button class="btn ai-btn" data-explain>🤖 Explain it more simply</button>
        </div>
      </div>`;
    body.querySelector('[data-explain]').onclick = () => tutor.show(`unit:${u.id}`, 'Explain this unit to me very simply, step by step, with easy examples.');
    // contents bar: jump + highlight the current section
    const links = $$('[data-goto]', body);
    links.forEach((a) => {
      a.onclick = (e) => {
        e.preventDefault();
        const d = document.getElementById(`sec-${a.dataset.goto}`);
        d.open = true;
        d.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    });
    if (links.length && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        for (const en of entries) if (en.isIntersecting) links.forEach((a) => a.classList.toggle('on', `sec-${a.dataset.goto}` === en.target.id));
      }, { rootMargin: '-80px 0px -70% 0px' });
      $$('.lsec', body).forEach((s) => io.observe(s));
      window.addEventListener('hashchange', () => io.disconnect(), { once: true });
    }
  }

  // toolbar actions
  body.querySelectorAll('[data-view]').forEach((b) => {
    b.onclick = async () => {
      const r = await api('/api/settings', { method: 'PUT', body: { bookView: b.dataset.view === 'book' } });
      store.me.settings = r.settings;
      renderUnit(view, u.id, 'learn');
    };
  });
  const col = body.querySelector('[data-collapse]');
  col.onclick = () => {
    const all = $$('.lsec', body);
    const close = all.some((d) => d.open);
    all.forEach((d) => { d.open = !close; });
    col.textContent = close ? '▸ Expand all' : '▾ Collapse all';
  };
  body.querySelectorAll('[data-read]').forEach((b) => {
    b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); speak(plainText(secs[Number(b.dataset.read)].text)); };
  });
  body.querySelector('[data-readall]').onclick = (e) => {
    if (speechSynthesis.speaking) { speechSynthesis.cancel(); e.currentTarget.textContent = '▶️ Read lesson'; return; }
    speak(plainText(u.learn));
    e.currentTarget.textContent = '⏹ Stop reading';
  };
  const size = () => { document.documentElement.style.setProperty('--lesson-size', `${store.fontScale || 1}rem`); };
  body.querySelectorAll('[data-font]').forEach((b) => {
    b.onclick = () => { store.fontScale = Math.min(1.4, Math.max(0.85, (store.fontScale || 1) + Number(b.dataset.font) * 0.08)); size(); localStorage.setItem('fontScale', store.fontScale); };
  });
  store.fontScale = store.fontScale || Number(localStorage.getItem('fontScale')) || 1;
  size();
  const tap = body.querySelector('[data-tap]');
  tap.onclick = () => { store.tapToHear = !store.tapToHear; tap.classList.toggle('on', store.tapToHear); toast(store.tapToHear ? 'Tap any word in the lesson to hear it 🔈' : 'Tap-to-hear is off'); };
  const lb = body.querySelector('.lesson-body');
  lb.addEventListener('click', (e) => {
    if (!store.tapToHear || e.target.closest('button, a, summary')) return;
    const w = wordAt(e);
    if (w) { speak(w, { rate: 0.8 }); flashWord(e); }
  });
  selectionTools(lb, u);
}

const plainText = (s) => s.replace(/^\|?[-:| ]+\|?$/gm, '').replace(/[*~`#>|=_]/g, ' ').replace(/\s+/g, ' ');

function wordAt(e) {
  let range;
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(e.clientX, e.clientY);
    if (!p) return '';
    range = document.createRange();
    range.setStart(p.offsetNode, p.offset);
  } else if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(e.clientX, e.clientY);
  if (!range || range.startContainer.nodeType !== 3) return '';
  const text = range.startContainer.textContent;
  let s = range.startOffset;
  let en = s;
  while (s > 0 && /[\w'’-]/.test(text[s - 1])) s--;
  while (en < text.length && /[\w'’-]/.test(text[en])) en++;
  return text.slice(s, en).replace(/’/g, "'");
}
function flashWord(e) {
  const dot = document.createElement('span');
  dot.className = 'tap-dot';
  dot.style.left = `${e.pageX}px`;
  dot.style.top = `${e.pageY}px`;
  document.body.append(dot);
  setTimeout(() => dot.remove(), 600);
}

/** Select any text in a lesson → Explain / Listen / Note popup. */
function selectionTools(el, u) {
  let pop = null;
  const hide = () => { pop?.remove(); pop = null; };
  el.addEventListener('mouseup', () => setTimeout(show, 10));
  el.addEventListener('touchend', () => setTimeout(show, 300));
  const outside = (e) => { if (pop && !pop.contains(e.target)) hide(); };
  document.addEventListener('mousedown', outside);
  window.addEventListener('hashchange', () => { hide(); document.removeEventListener('mousedown', outside); }, { once: true });
  function show() {
    const sel = window.getSelection();
    const text = sel.toString().trim();
    if (!text || text.length < 2 || !el.contains(sel.anchorNode)) { hide(); return; }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    hide();
    pop = document.createElement('div');
    pop.className = 'sel-pop';
    pop.innerHTML = '<button data-x="ai">🤖 Explain</button><button data-x="say">🔊 Listen</button><button data-x="note">🗒️ Note</button><button data-x="save">☆ Save</button>';
    pop.style.top = `${window.scrollY + r.top - 46}px`;
    pop.style.left = `${Math.max(8, window.scrollX + r.left + r.width / 2 - 140)}px`;
    document.body.append(pop);
    pop.onclick = async (e) => {
      const x = e.target.closest('[data-x]')?.dataset.x;
      if (x === 'ai') tutor.show(`unit:${u.id}`, `In this unit, please explain this part more simply with examples: "${text}"`);
      if (x === 'say') speak(text);
      if (x === 'note') { await api('/api/notes', { method: 'POST', body: { unitId: u.id, title: 'Highlight', body: `> ${text}\n\n`, color: 'yellow' } }); toast('Added to notes'); loadState(); }
      if (x === 'save') { await api('/api/saved', { method: 'POST', body: { kind: 'example', text, unitId: u.id } }); toast('Saved'); }
      hide();
      sel.removeAllRanges();
    };
  }
}

// ---------- examples ----------
function examplesTab(body, u) {
  body.innerHTML = `
    <div class="row wrap gap toolbar">
      <button class="btn" data-play-all>▶️ Listen to all</button>
      <button class="btn" data-hide>🙈 Hide & recall</button>
      <a class="btn" href="#/practice/dictation/${u.id}">🎧 Dictation</a>
      ${canListen ? `<a class="btn" href="#/practice/speaking/${u.id}">🎤 Speaking</a>` : ''}
      <button class="btn ai-btn" data-more>🤖 More examples</button>
    </div>
    <p class="muted small">Tip: tap 🐢 to hear a sentence slowly, and 🎤 to say it and get a score.</p>
    <div class="examples">${u.examples.map((e, n) => `
      <div class="example" data-n="${n}">
        <div class="ex-text"><span class="ex-s">${inline(e.s)}</span>${e.note ? `<span class="ex-note muted small">${inline(e.note)}</span>` : ''}</div>
        <div class="ex-tools">
          <button class="icon-btn" data-say="${esc(e.s)}" title="Listen">🔊</button>
          <button class="icon-btn" data-slow title="Listen slowly">🐢</button>
          ${canListen ? '<button class="icon-btn" data-rec title="Say it">🎤</button>' : ''}
          <button class="icon-btn" data-save title="Save">☆</button>
        </div>
        <div class="ex-result small"></div>
      </div>`).join('')}</div>`;
  $('[data-more]', body).onclick = () => tutor.show(`unit:${u.id}`, 'Give me 5 new example sentences for this grammar point, with a short note on each.');
  $('[data-play-all]', body).onclick = async () => {
    for (const e of u.examples) {
      speak(e.s);
      await new Promise((r) => { const t = setInterval(() => { if (!speechSynthesis.speaking) { clearInterval(t); r(); } }, 200); });
      await new Promise((r) => setTimeout(r, 500));
      if (!document.body.contains(body)) return;
    }
  };
  let hidden = false;
  $('[data-hide]', body).onclick = (e) => {
    hidden = !hidden;
    body.querySelector('.examples').classList.toggle('recall', hidden);
    e.currentTarget.textContent = hidden ? '👀 Show all' : '🙈 Hide & recall';
    if (hidden) toast('Try to say each sentence, then tap it to check.');
  };
  body.querySelector('.examples').addEventListener('click', async (e) => {
    const ex = e.target.closest('.example');
    if (!ex) return;
    const item = u.examples[Number(ex.dataset.n)];
    if (e.target.closest('.ex-text')) ex.classList.toggle('peek');
    if (e.target.closest('[data-slow]')) speak(item.s, { rate: 0.6 });
    if (e.target.closest('[data-save]')) {
      await api('/api/saved', { method: 'POST', body: { kind: 'example', text: item.s, extra: item.note || '', unitId: u.id } });
      e.target.closest('[data-save]').textContent = '★';
      toast('Saved to My Space');
    }
    const rec = e.target.closest('[data-rec]');
    if (rec) {
      const out = ex.querySelector('.ex-result');
      rec.classList.add('rec');
      out.textContent = 'Listening… say the sentence';
      try {
        const alts = await listen();
        const best = Math.max(0, ...alts.map((a) => similarity(a, item.s)));
        out.innerHTML = alts[0]
          ? `${best >= 0.9 ? '🌟 Excellent!' : best >= 0.7 ? '👍 Good!' : '🔁 Try again.'} I heard: “${esc(alts[0])}” <b>${Math.round(best * 100)}%</b>`
          : 'I did not hear anything. Try again.';
      } catch (err) { out.textContent = err.message; }
      rec.classList.remove('rec');
    }
  });
}

// ---------- practice ----------
function practiceTab(body, u, level) {
  const st = unitStatus(u.id);
  if (level && u.practice[level]) {
    const lv = LEVELS.find(([k]) => k === level);
    body.innerHTML = '<div class="quiz-host"></div>';
    const nextLevel = LEVELS[LEVELS.findIndex(([k]) => k === level) + 1];
    startQuiz(body.firstElementChild, shuffle(u.practice[level]), {
      title: `Unit ${u.id} · ${lv[2]}`, unitId: u.id, level, saveKey: `u${u.id}-${level}`,
      extraActions: `${nextLevel ? `<a class="btn" href="#/unit/${u.id}/practice/${nextLevel[0]}">Next: ${nextLevel[2]} →</a>` : `<a class="btn" href="#/unit/${u.id}/exam">📝 Take the unit exam</a>`}
        <a class="btn ghost" href="#/unit/${u.id}/practice">All levels</a>`,
    });
    return;
  }
  body.innerHTML = `
    <div class="levels">${LEVELS.map(([k, ic, name, desc]) => {
      const p = st.levels[k];
      return `<a class="card level-card ${p && p.best >= 80 ? 'passed' : ''}" href="#/unit/${u.id}/practice/${k}">
        <div class="lv-ic">${ic}</div><h3>${name}</h3><p class="muted small">${desc}</p>
        <div class="muted small">${u.practice[k].length} questions</div>
        <div class="lv-score">${p ? `Best: <b>${p.best}%</b> · ${p.attempts} tr${p.attempts === 1 ? 'y' : 'ies'}` : 'Not started'}</div>
        <span class="btn ${p && p.best >= 80 ? '' : 'primary'} small">${p ? (p.best >= 80 ? 'Practise again' : 'Try again') : 'Start'}</span>
      </a>`;
    }).join('')}</div>
    <div class="grid cards-2">
      <div class="card cta"><div><b>✨ Unlimited AI practice</b><p class="muted">The AI writes fresh Easy, Medium or Hard questions for this unit — different every time.</p></div>
        <button class="btn ai-btn" data-aiquiz>✨ AI practice quiz</button></div>
      <div class="card cta"><div><b>📝 Unit exam</b><p class="muted">A mixed test of all levels, with a results history and an AI report.</p></div>
        <a class="btn" href="#/unit/${u.id}/exam">Go to exam</a></div>
    </div>`;
  $('[data-aiquiz]', body).onclick = () => aiQuizDialog(u.id);
}

// ---------- exam & results ----------
async function examTab(body, u) {
  const draw = async () => {
    const hist = await api(`/api/attempts?unit=${u.id}`);
    const exams = hist.filter((a) => a.kind === 'exam');
    const best = exams.reduce((m, a) => Math.max(m, Math.round((a.score / a.total) * 100)), 0);
    body.innerHTML = `
      <div class="grid cards-2">
        <div class="card exam-card">
          <h2>📝 Unit ${u.id} exam</h2>
          <p class="muted">12 questions: 4 Easy, 4 Medium and 4 Hard, in random order. Score 80% to pass (+20 XP).</p>
          <label class="row gap small"><input type="checkbox" data-ai-extra> Add 4 new AI questions (needs AI)</label>
          <label class="row gap small"><input type="checkbox" data-timer> ⏱️ Timed (8 minutes)</label>
          <button class="btn primary lg" data-start>Start exam</button>
        </div>
        <div class="card">
          <h3>Your results</h3>
          <div class="stat-row"><div><b>${exams.length}</b><span class="muted small">exams taken</span></div><div><b>${best}%</b><span class="muted small">best exam</span></div><div><b>${hist.length}</b><span class="muted small">tests in total</span></div></div>
          ${progressChart(hist.slice(0, 12).reverse())}
        </div>
      </div>
      <h3>History</h3>
      ${hist.length ? `<div class="table-wrap"><table class="results-table"><thead><tr><th>Date</th><th>Test</th><th>Score</th><th></th></tr></thead><tbody>
        ${hist.map((a) => { const pct = Math.round((a.score / a.total) * 100); return `<tr><td>${fmtDate(a.created_at)}</td><td>${esc(a.title || a.kind)}</td>
          <td><span class="score-pill ${pct >= 80 ? 'ok' : pct >= 50 ? 'mid' : 'low'}">${a.score}/${a.total} · ${pct}%</span></td>
          <td><button class="btn small" data-view-att="${a.id}">View${a.has_feedback ? ' + AI report' : ''}</button></td></tr>`; }).join('')}
      </tbody></table></div>` : '<div class="empty card">No results yet. Practise a level or take the exam.</div>'}`;
    body.querySelector('[data-start]').onclick = () => startExam();
    body.querySelectorAll('[data-view-att]').forEach((b) => { b.onclick = () => showAttempt(Number(b.dataset.viewAtt)); });
  };

  const startExam = async () => {
    const withAi = body.querySelector('[data-ai-extra]').checked;
    const timed = body.querySelector('[data-timer]').checked;
    let qs = ['easy', 'medium', 'hard'].flatMap((l) => shuffle(u.practice[l]).slice(0, 4).map((q) => ({ ...q, unit: u.id })));
    body.innerHTML = '<div class="exam-top"></div><div class="quiz-host"><p class="muted">Preparing your exam…</p></div>';
    if (withAi) {
      try {
        const r = await api('/api/ai/quiz', { method: 'POST', body: { unitId: u.id, level: 'hard', count: 4 } });
        qs = qs.concat(r.questions.slice(0, 4).map((q) => ({ ...q, unit: u.id })));
      } catch (e) { toast(`AI questions skipped: ${e.message}`, 'warn', 4000); }
    }
    qs = shuffle(qs);
    const host = body.querySelector('.quiz-host');
    let timer = null;
    let ctl = null;
    if (timed) {
      let left = 8 * 60;
      const top = body.querySelector('.exam-top');
      const tick = () => {
        top.innerHTML = `<span class="pill ${left < 60 ? 'danger-pill' : ''}">⏱️ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</span>`;
        if (left-- <= 0) { clearInterval(timer); toast('Time is up!', 'warn'); ctl?.finish(); }
      };
      tick();
      timer = setInterval(tick, 1000);
      window.addEventListener('hashchange', () => clearInterval(timer), { once: true });
    }
    ctl = await startQuiz(host, qs, {
      title: `Unit ${u.id} exam`, unitId: u.id, kind: 'exam', saveKey: `u${u.id}-exam`,
      extraActions: '<button class="btn ghost" data-back-hist>📊 See my results</button>',
      onDone: ({ root }) => {
        clearInterval(timer);
        root.querySelector('[data-back-hist]').onclick = () => draw();
      },
    });
  };

  const showAttempt = async (id) => {
    const a = await api(`/api/attempts/${id}`);
    const pct = Math.round((a.score / a.total) * 100);
    const m = modal(`<h3>${esc(a.title || a.kind)} — ${fmtDate(a.created_at)}</h3>
      <div class="big-score">${a.score} / ${a.total} <small>(${pct}%)</small></div>
      <div class="ai-feedback ${a.feedback ? 'card md' : ''}">${a.feedback ? md(a.feedback, { examples: false }) : ''}</div>
      ${a.feedback ? '' : '<button class="btn ai-btn" data-fb>🤖 AI analysis of this result</button>'}
      <ul class="review-list">${a.detail.map((x) => `<li class="${x.correct ? 'ok-li' : 'bad-li'}">${x.correct ? '✅' : '❌'} ${esc(x.q)}
        <div class="small">Your answer: <span class="${x.correct ? 'ok-txt' : 'bad-txt'}">${esc(x.given || '—')}</span>${x.correct ? '' : ` · Correct: <span class="ok-txt">${esc(x.answer)}</span>`}</div>
        ${!x.correct && x.e ? `<div class="muted small">${inline(x.e)}</div>` : ''}</li>`).join('')}</ul>`, { wide: true });
    const fb = m.el.querySelector('[data-fb]');
    if (fb) fb.onclick = async () => {
      fb.disabled = true; fb.textContent = '🤖 Analysing…';
      try {
        const r = await api('/api/ai/feedback', { method: 'POST', body: { unitId: u.id, title: a.title, items: a.detail, attemptId: a.id } });
        const box = m.el.querySelector('.ai-feedback');
        box.className = 'ai-feedback card md';
        box.innerHTML = md(r.text, { examples: false });
        fb.remove();
      } catch (e) { toast(e.message, 'error', 5000); fb.disabled = false; fb.textContent = '🤖 AI analysis of this result'; }
    };
  };
  await draw();
}

/** Tiny bar chart of recent scores. */
export function progressChart(list) {
  if (!list.length) return '<p class="muted small">Your score chart will appear here.</p>';
  return `<div class="mini-chart" role="img" aria-label="Recent scores">${list.map((a) => {
    const pct = Math.round((a.score / a.total) * 100);
    return `<div class="bar-col" title="${esc(a.title || a.kind)}: ${pct}%"><span style="height:${Math.max(4, pct)}%" class="${pct >= 80 ? 'ok' : pct >= 50 ? 'mid' : 'low'}"></span><small>${pct}</small></div>`;
  }).join('')}</div>`;
}

// ---------- visual: grammar map, AI flowchart, canvas ----------
async function visualTab(body, u, sub = 'map') {
  const subs = [['map', '🧭 Grammar map'], ['flow', '🔀 AI flowchart'], ['canvas', '✏️ My canvas']];
  body.innerHTML = `<div class="seg vis-tabs">${subs.map(([k, l]) => `<a href="#/unit/${u.id}/visual/${k}" class="${k === sub ? 'on' : ''}">${l}</a>`).join('')}</div><div class="vis-body"></div>`;
  const vb = body.querySelector('.vis-body');
  if (sub === 'flow') return flowView(vb, u);
  if (sub === 'canvas') return canvasView(vb, u);
  // grammar map: a mind map built from the lesson's own sections
  const secs = sectionsOf(u.learn).filter((s) => s.title);
  const ex = (text) => (/^= (.+)$/m.exec(text)?.[1] || '').replace(/[*~`]/g, '');
  vb.innerHTML = `<div class="mindmap">
    <div class="mm-center"><span>Unit ${u.id}</span><b>${esc(u.title)}</b><small>${esc(u.summary)}</small></div>
    <div class="mm-branches">${secs.map((s, n) => `<a class="mm-node c${n % 6}" href="#/unit/${u.id}/learn" data-sec="${n}">
      <b>${inline(s.title)}</b>${ex(s.text) ? `<span class="mm-ex">“${esc(ex(s.text))}”</span>` : ''}</a>`).join('')}
      ${u.mistakes[0] ? `<div class="mm-node warn"><b>⚠️ Watch out</b><span class="mm-ex">❌ ${esc(u.mistakes[0].wrong)}<br>✅ ${esc(u.mistakes[0].right.split(' | ')[0])}</span></div>` : ''}
    </div></div>
    <p class="muted small center">Tap a box to read that part of the lesson. For a step-by-step decision chart, open 🔀 AI flowchart.</p>`;
}

async function flowView(vb, u) {
  vb.innerHTML = '<div class="card center"><p>🔀 The AI turns this unit into a decision flowchart: “Which form do I use?”</p><button class="btn ai-btn" data-make>Create flowchart</button></div>';
  const make = async (refresh = false) => {
    vb.innerHTML = '<div class="card center"><span class="typing"><i></i><i></i><i></i></span><p class="muted">Drawing the flowchart…</p></div>';
    try {
      const flow = await api('/api/ai/flow', { method: 'POST', body: { unitId: u.id, refresh } });
      vb.innerHTML = `<div class="row between wrap"><h3>${esc(flow.title || u.title)}</h3><div class="row gap"><button class="btn small" data-print>🖨️ Print</button><button class="btn small ghost" data-again>↻ Redraw</button></div></div>
        <div class="flow-wrap">${flowSvg(flow)}</div>
        <p class="muted small">Made by AI from this unit's lesson. If something looks wrong, ask the tutor or redraw.</p>`;
      vb.querySelector('[data-again]').onclick = () => make(true);
      vb.querySelector('[data-print]').onclick = () => window.print();
    } catch (e) {
      vb.innerHTML = `<div class="card warn-box">${esc(e.message)}</div>`;
    }
  };
  vb.querySelector('[data-make]').onclick = () => make();
  make(); // shows the cached chart instantly if it exists
}

function wrap(text, n) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > n && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) lines.push(cur);
  return lines;
}

/** Lay out a small DAG in rows and draw it as SVG. */
export function flowSvg(flow) {
  const nodes = new Map(flow.nodes.map((n) => [n.id, { ...n, level: 0 }]));
  const start = flow.nodes.find((n) => n.type === 'start')?.id || flow.nodes[0].id;
  // longest-path levels (bounded loop protects against cycles)
  for (let i = 0; i < nodes.size; i++) for (const e of flow.edges) {
    const a = nodes.get(e.from); const b = nodes.get(e.to);
    if (b.id !== start && b.level < a.level + 1) b.level = a.level + 1;
  }
  const rows = [];
  for (const n of nodes.values()) (rows[n.level] ||= []).push(n);
  const W = 230; const GAP = 30; const VG = 70;
  const colors = { start: ['#4f46e5', '#fff'], question: ['#fef3c7', '#78350f'], answer: ['#d1fae5', '#064e3b'], tip: ['#ede9fe', '#4c1d95'] };
  let y = 20;
  const maxW = Math.max(...rows.filter(Boolean).map((r) => r.length)) * (W + GAP);
  for (const row of rows.filter(Boolean)) {
    const rowH = Math.max(...row.map((n) => (wrap(n.text, 28).length + (n.example ? wrap(n.example, 32).length : 0)) * 18 + 26));
    const total = row.length * W + (row.length - 1) * GAP;
    row.forEach((n, i) => { n.x = (maxW - total) / 2 + i * (W + GAP); n.y = y; n.h = rowH; });
    y += rowH + VG;
  }
  const H = y;
  const edgeSvg = flow.edges.map((e) => {
    const a = nodes.get(e.from); const b = nodes.get(e.to);
    const x1 = a.x + W / 2; const y1 = a.y + a.h; const x2 = b.x + W / 2; const y2 = b.y;
    const my = (y1 + y2) / 2;
    return `<path d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2 - 4}" class="f-edge" marker-end="url(#arr)"/>${e.label ? `<text x="${(x1 + x2) / 2}" y="${my - 4}" class="f-label">${esc(e.label)}</text>` : ''}`;
  }).join('');
  const nodeSvg = [...nodes.values()].map((n) => {
    const [bg, fg] = colors[n.type] || colors.answer;
    const lines = wrap(n.text, 28);
    const exl = n.example ? wrap(n.example, 32) : [];
    const shape = n.type === 'question'
      ? `<rect x="${n.x}" y="${n.y}" width="${W}" height="${n.h}" rx="22" fill="${bg}" stroke="#f59e0b" stroke-width="2"/>`
      : `<rect x="${n.x}" y="${n.y}" width="${W}" height="${n.h}" rx="10" fill="${bg}" stroke="${n.type === 'start' ? bg : '#cbd5e1'}"/>`;
    return `<g class="f-node">${shape}${lines.map((l, i) => `<text x="${n.x + W / 2}" y="${n.y + 22 + i * 18}" fill="${fg}" class="f-text">${esc(l)}</text>`).join('')}${exl.map((l, i) => `<text x="${n.x + W / 2}" y="${n.y + 26 + (lines.length + i) * 18}" fill="${fg}" class="f-ex">${esc(l)}</text>`).join('')}</g>`;
  }).join('');
  return `<svg viewBox="0 0 ${maxW} ${H}" class="flow-svg" role="img" aria-label="${esc(flow.title || 'Flowchart')}">
    <defs><marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#94a3b8"/></marker></defs>
    ${edgeSvg}${nodeSvg}</svg>`;
}

async function canvasView(vb, u) {
  vb.innerHTML = `<div class="canvas-bar row wrap gap">
      ${['#1d2033', '#4f46e5', '#dc2626', '#059669', '#f59e0b', '#ec4899'].map((c, i) => `<button class="color-dot ${i === 0 ? 'on' : ''}" data-color="${c}" style="background:${c}" aria-label="colour"></button>`).join('')}
      <select data-size><option value="2">Thin</option><option value="4" selected>Medium</option><option value="8">Thick</option><option value="16">Marker</option></select>
      <button class="chip small" data-tool="pen">✏️ Pen</button><button class="chip small" data-tool="eraser">🧽 Eraser</button><button class="chip small" data-tool="text">🔤 Text</button>
      <button class="chip small" data-undo>↶ Undo</button><button class="chip small" data-clear>🗑️ Clear</button>
      <span class="grow"></span><span class="muted small" data-status></span><button class="btn primary small" data-save>💾 Save</button><button class="btn small" data-png>⬇️ PNG</button>
    </div>
    <div class="canvas-wrap"><canvas width="1400" height="900"></canvas></div>
    <p class="muted small">Draw your own grammar diagrams, timelines or notes for this unit. It saves to your space.</p>`;
  const cv = vb.querySelector('canvas');
  const ctx = cv.getContext('2d');
  const bg = () => { ctx.fillStyle = '#fffdf6'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.strokeStyle = '#e8e2cf'; ctx.lineWidth = 1; for (let y = 60; y < cv.height; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cv.width, y); ctx.stroke(); } };
  bg();
  const saved = await api(`/api/canvas/${u.id}`);
  if (saved.data) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0); img.src = saved.data; }
  let color = '#1d2033'; let size = 4; let tool = 'pen'; let drawing = false; let dirty = false;
  const undo = [];
  const status = vb.querySelector('[data-status]');
  const mark = () => { dirty = true; status.textContent = 'Not saved'; };
  const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * (cv.width / r.width), (e.clientY - r.top) * (cv.height / r.height)]; };
  cv.addEventListener('pointerdown', (e) => {
    undo.push(ctx.getImageData(0, 0, cv.width, cv.height)); if (undo.length > 20) undo.shift();
    const [x, y] = pos(e);
    if (tool === 'text') {
      const t = prompt('Text to add:');
      if (t) { ctx.fillStyle = color; ctx.font = `${12 + size * 3}px system-ui, sans-serif`; ctx.fillText(t, x, y); mark(); }
      return;
    }
    drawing = true; cv.setPointerCapture(e.pointerId);
    ctx.beginPath(); ctx.moveTo(x, y);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const [x, y] = pos(e);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = tool === 'eraser' ? '#fffdf6' : color;
    ctx.lineWidth = tool === 'eraser' ? size * 5 : size;
    ctx.lineTo(x, y); ctx.stroke(); mark();
  });
  cv.addEventListener('pointerup', () => { drawing = false; });
  vb.querySelectorAll('[data-color]').forEach((b) => { b.onclick = () => { color = b.dataset.color; tool = tool === 'eraser' ? 'pen' : tool; vb.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === b)); }; });
  vb.querySelector('[data-size]').onchange = (e) => { size = Number(e.target.value); };
  vb.querySelectorAll('[data-tool]').forEach((b) => { b.onclick = () => { tool = b.dataset.tool; vb.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('on', x === b)); }; });
  vb.querySelector('[data-tool="pen"]').classList.add('on');
  vb.querySelector('[data-undo]').onclick = () => { const d = undo.pop(); if (d) { ctx.putImageData(d, 0, 0); mark(); } };
  vb.querySelector('[data-clear]').onclick = async () => { if (await confirmBox('Clear the whole canvas?', 'Clear')) { undo.push(ctx.getImageData(0, 0, cv.width, cv.height)); bg(); mark(); } };
  const save = async () => {
    status.textContent = 'Saving…';
    try { await api(`/api/canvas/${u.id}`, { method: 'PUT', body: { data: cv.toDataURL('image/png') } }); dirty = false; status.textContent = 'Saved ✓'; }
    catch (e) { status.textContent = ''; toast(e.message, 'error'); }
  };
  vb.querySelector('[data-save]').onclick = save;
  vb.querySelector('[data-png]').onclick = () => { const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = `unit-${u.id}-canvas.png`; a.click(); };
  window.addEventListener('hashchange', () => { if (dirty) save(); }, { once: true });
}

// ---------- notes ----------
const COLORS = ['yellow', 'green', 'blue', 'pink', 'purple'];
export async function notesTab(body, u) {
  const notes = await api(`/api/notes${u ? `?unit=${u.id}` : ''}`);
  const draw = () => {
    body.innerHTML = `
      <div class="row between wrap"><p class="muted">${u ? 'Your private notes for this unit. They save automatically.' : 'All your notes. They save automatically.'}</p>
      <button class="btn primary" data-new>＋ New note</button></div>
      <div class="notes">${notes.map((n) => `
        <div class="note c-${n.color}" data-id="${n.id}">
          <input class="note-title" value="${esc(n.title)}" placeholder="Title">
          ${!u && n.unit_id ? `<a class="small" href="#/unit/${n.unit_id}">Unit ${n.unit_id}: ${esc(unitMeta(n.unit_id)?.title || '')}</a>` : ''}
          <textarea class="note-body" placeholder="Write your note… (supports **bold**, - lists)">${esc(n.body)}</textarea>
          <div class="note-preview md" hidden></div>
          <div class="note-foot">
            <div class="colors">${COLORS.map((c) => `<button class="color c-${c} ${c === n.color ? 'on' : ''}" data-color="${c}" aria-label="${c}"></button>`).join('')}</div>
            <span class="muted small" data-saved>${fmtDate(n.updated_at)}</span>
            <button class="icon-btn small" data-preview title="Preview">👁️</button>
            <button class="icon-btn small" data-del title="Delete">🗑️</button>
          </div>
        </div>`).join('') || '<div class="empty">No notes yet. Tip: select text in a lesson and tap 🗒️ Note.</div>'}</div>`;
    $('[data-new]', body).onclick = async () => {
      const n = await api('/api/notes', { method: 'POST', body: { unitId: u?.id || null, title: '', body: '' } });
      notes.unshift(n);
      draw();
      body.querySelector('.note-title').focus();
      loadState();
    };
    $$('.note', body).forEach((el) => {
      const n = notes.find((x) => x.id === Number(el.dataset.id));
      let timer;
      const save = (patch) => {
        Object.assign(n, patch);
        clearTimeout(timer);
        el.querySelector('[data-saved]').textContent = 'Saving…';
        timer = setTimeout(async () => {
          await api(`/api/notes/${n.id}`, { method: 'PUT', body: patch.color ? patch : { title: n.title, body: n.body } });
          el.querySelector('[data-saved]').textContent = 'Saved ✓';
        }, patch.color ? 0 : 600);
      };
      el.querySelector('.note-title').oninput = (e) => save({ title: e.target.value });
      el.querySelector('.note-body').oninput = (e) => save({ body: e.target.value });
      el.querySelectorAll('[data-color]').forEach((b) => {
        b.onclick = () => { el.className = `note c-${b.dataset.color}`; el.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === b)); save({ color: b.dataset.color }); };
      });
      el.querySelector('[data-preview]').onclick = () => {
        const p = el.querySelector('.note-preview');
        const ta = el.querySelector('.note-body');
        p.hidden = !p.hidden;
        ta.hidden = !p.hidden;
        if (!p.hidden) p.innerHTML = md(n.body || '_Empty note_');
      };
      el.querySelector('[data-del]').onclick = async () => {
        if (!await confirmBox('Delete this note?', 'Delete')) return;
        await api(`/api/notes/${n.id}`, { method: 'DELETE' });
        notes.splice(notes.indexOf(n), 1);
        draw();
        loadState();
      };
    });
  };
  draw();
}
