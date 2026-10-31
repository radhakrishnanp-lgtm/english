// Unit page: Learn · Examples · Practice (easy/medium/hard) · Notes
import { md, esc, inline } from './md.js';
import {
  api, store, getUnit, unitMeta, unitStatus, flagsOf, setFlag, toast, $, $$, speak, listen, canListen,
  similarity, shuffle, confirmBox, fmtDate, levelDots, loadState,
} from './core.js';
import { runQuiz } from './quiz.js';
import { tutor, aiQuizDialog } from './tutor.js';

const LEVELS = [
  ['easy', '🟢', 'Easy', 'Basic forms and short sentences'],
  ['medium', '🟡', 'Medium', 'Negatives, questions and real sentences'],
  ['hard', '🔴', 'Hard', 'Tricky cases, traps and error correction'],
];

export async function renderUnit(view, id, tab = 'learn', level) {
  const meta = unitMeta(id);
  if (!meta) { view.innerHTML = '<div class="page"><h1>Unit not found</h1></div>'; return; }
  const u = await getUnit(id);
  document.title = `Unit ${u.id}: ${u.title} — English Path`;
  setFlag(u.id, { visited: true }).catch(() => {});
  const prev = unitMeta(u.id - 1);
  const next = unitMeta(u.id + 1);
  const tabs = [['learn', '📖 Learn'], ['examples', '💬 Examples'], ['practice', '🎯 Practice'], ['notes', '🗒️ Notes']];
  if (!tabs.some(([k]) => k === tab)) tab = 'learn';

  view.innerHTML = `
    <div class="page unit-page">
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
      <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<a role="tab" href="#/unit/${u.id}/${k}" class="${k === tab ? 'on' : ''}">${l}${k === 'notes' ? `<span class="count" data-notecount></span>` : ''}</a>`).join('')}</div>
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
    $('.unit-status', view).innerHTML = `${levelDots(u.id)} <span class="muted small">${st.mastered ? '✅ Mastered' : `${st.passedCount}/3 levels passed`}</span>`;
    const nc = store.state.noteCounts.find((n) => n.unit_id === u.id)?.n || 0;
    const c = $('[data-notecount]', view);
    if (c) c.textContent = nc ? ` ${nc}` : '';
  };
  drawHead();
  const unsub = () => store.listeners.delete(drawHead);
  store.listeners.add(drawHead);
  window.addEventListener('hashchange', unsub, { once: true });

  $$('[data-flag]', view).forEach((b) => {
    b.onclick = async () => {
      const k = b.dataset.flag;
      const f = await setFlag(u.id, { [k]: !flagsOf(u.id)[k] });
      toast(k === 'bookmarked' ? (f.bookmarked ? 'Bookmarked 🔖' : 'Bookmark removed') : (f.important ? 'Marked important ⭐' : 'Unmarked'));
    };
  });
  $('[data-ask]', view).onclick = () => tutor.show(`unit:${u.id}`);

  const body = $('.tab-body', view);
  if (tab === 'learn') learnTab(body, u);
  if (tab === 'examples') examplesTab(body, u);
  if (tab === 'practice') practiceTab(body, u, level);
  if (tab === 'notes') await notesTab(body, u);
}

// ---------- learn ----------
function learnTab(body, u) {
  body.innerHTML = `
    <article class="lesson md">${md(u.learn)}</article>
    ${u.mistakes.length ? `<h2>⚠️ Common mistakes</h2>
      <div class="mistakes">${u.mistakes.map((m) => `
        <div class="mistake"><div class="wrong-sent">❌ ${esc(m.wrong)}</div><div class="right-sent">✅ ${m.right.split(' | ').map(esc).join(' <span class="muted">or</span> ')} <button class="icon-btn small" data-say="${esc(m.right.split(' | ')[0])}">🔊</button></div><div class="muted small">${inline(m.why)}</div></div>`).join('')}</div>` : ''}
    <div class="cta card">
      <div><b>Ready to practise?</b><p class="muted">Pass all three levels with 80% or more to master this unit.</p></div>
      <div class="row gap wrap">
        <a class="btn primary" href="#/unit/${u.id}/practice">🎯 Start practice</a>
        <button class="btn" data-explain>🤖 Explain it more simply</button>
      </div>
    </div>`;
  $('[data-explain]', body).onclick = () => tutor.show(`unit:${u.id}`, 'Explain this unit to me very simply, step by step, with easy examples.');
  selectionTools(body.querySelector('.lesson'), u);
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
    <div class="examples">${u.examples.map((e, n) => `
      <div class="example" data-n="${n}">
        <div class="ex-text"><span class="ex-s">${inline(e.s)}</span>${e.note ? `<span class="ex-note muted small">${inline(e.note)}</span>` : ''}</div>
        <div class="ex-tools">
          <button class="icon-btn" data-say="${esc(e.s)}" title="Listen">🔊</button>
          ${canListen ? '<button class="icon-btn" data-rec title="Say it">🎤</button>' : ''}
          <button class="icon-btn" data-save title="Save">☆</button>
        </div>
        <div class="ex-result small"></div>
      </div>`).join('')}</div>`;
  $('[data-more]', body).onclick = () => tutor.show(`unit:${u.id}`, 'Give me 5 new example sentences for this grammar point, with a short note on each.');
  $('[data-play-all]', body).onclick = async () => {
    for (const e of u.examples) {
      speak(e.s);
      await new Promise((r) => {
        const t = setInterval(() => { if (!speechSynthesis.speaking) { clearInterval(t); r(); } }, 200);
      });
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
        const heard = alts[0] || '';
        out.innerHTML = heard
          ? `${best >= 0.9 ? '🌟 Excellent!' : best >= 0.7 ? '👍 Good!' : '🔁 Try again.'} I heard: “${esc(heard)}” <b>${Math.round(best * 100)}%</b>`
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
    runQuiz(body.firstElementChild, shuffle(u.practice[level]), {
      title: `Unit ${u.id} · ${lv[2]}`, unitId: u.id, level,
      extraActions: `${nextLevel ? `<a class="btn" href="#/unit/${u.id}/practice/${nextLevel[0]}">Next: ${nextLevel[2]} →</a>` : (unitMeta(u.id + 1) ? `<a class="btn" href="#/unit/${u.id + 1}">Next unit →</a>` : '')}
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
    <div class="card cta">
      <div><b>✨ Want more?</b><p class="muted">The AI can write fresh questions for this unit at any level — unlimited practice.</p></div>
      <button class="btn ai-btn" data-aiquiz>✨ AI practice quiz</button>
    </div>`;
  $('[data-aiquiz]', body).onclick = () => aiQuizDialog(u.id);
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
