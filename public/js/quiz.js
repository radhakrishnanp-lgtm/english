// Interactive quiz engine used by unit practice, review, placement test, daily mix and AI quizzes.
import { esc, inline, md } from './md.js';
import { api, norm, shuffle, speak, toast, today, loadState } from './core.js';

const TYPE_LABEL = { mc: 'Choose the answer', fill: 'Fill in the blank', order: 'Put the words in order', fix: 'Correct the mistake' };

const blankCount = (q) => q.q.split('___').length - 1;
const parts = (q, alt) => (blankCount(q) > 1 ? alt.split(/\s*,\s*/) : [alt]);

export function fullSentence(q) {
  if (q.t === 'mc') return q.q.replace('___', q.o[q.a]);
  if (q.t === 'fill') {
    const p = parts(q, q.a[0]);
    let k = 0;
    return q.q.replace(/\s*\([^)]*\)/g, '').replace(/___/g, () => p[k++] || '').replace(/\s+/g, ' ').replace(/\s+([?.!,])/g, '$1').trim();
  }
  if (q.t === 'order') return q.a;
  return q.a[0];
}
const answerText = (q) => (q.t === 'mc' ? q.o[q.a] : q.t === 'order' ? q.a : q.a.join('  /  '));
export { blankCount };

function orderWords(sentence) {
  return sentence.replace(/[.!?]+$/, '').split(/\s+/);
}

/**
 * Run a quiz inside `root`.
 * opts: { title, unitId, level, scopeForAi, save: true|false, onDone(summary), extraActions(html) }
 */
export function runQuiz(root, questions, opts = {}) {
  let i = 0;
  const results = [];
  let answered = false;
  // Resume an unfinished quiz (auto-saved on the server).
  if (opts.resumeFrom) {
    i = Math.min(opts.resumeFrom.i, questions.length - 1);
    for (const r of opts.resumeFrom.results || []) if (questions[r.idx]) results.push({ qid: questions[r.idx].id, correct: r.correct, given: r.given, q: questions[r.idx], idx: r.idx });
  }
  const saveState = () => {
    if (!opts.saveKey) return;
    api(`/api/quiz-state/${encodeURIComponent(opts.saveKey)}`, {
      method: 'PUT',
      body: { state: { title: opts.title, i: i + 1, total: questions.length, questions, results: results.map((r) => ({ idx: r.idx, correct: r.correct, given: r.given })) } },
    }).catch(() => {});
  };
  const clearState = () => { if (opts.saveKey) api(`/api/quiz-state/${encodeURIComponent(opts.saveKey)}`, { method: 'DELETE' }).catch(() => {}); };

  const ask = (q, given) => {
    const scope = opts.scopeForAi || (q.unit || opts.unitId ? `unit:${q.unit || opts.unitId}` : 'general');
    const qText = q.t === 'order' ? `Put in order: ${shuffle(orderWords(q.a)).join(' / ')}` : q.q;
    const msg = `I am practising this question:\n"${qText}"${q.o ? `\nOptions: ${q.o.join(', ')}` : ''}\nMy answer: "${given || '(no answer)'}"\nCorrect answer: "${answerText(q)}"\nPlease explain simply why the correct answer is right${given ? ' and why mine is wrong' : ''}, and give me 2 more similar examples.`;
    window.dispatchEvent(new CustomEvent('ask-ai', { detail: { scope, message: msg } }));
  };

  function render() {
    const q = questions[i];
    answered = false;
    const pct = Math.round((i / questions.length) * 100);
    root.innerHTML = `
      <div class="quiz">
        <div class="quiz-top">
          <span class="muted">${esc(opts.title || 'Practice')}</span>
          <span class="row gap"><button class="chip small ${typeMode() ? 'on' : ''}" data-type title="Type your answers instead of tapping">⌨️ Type answers</button>
          <span class="muted">${i + 1} / ${questions.length}</span>${opts.saveKey ? '<span class="muted small" title="Your place is saved automatically">💾</span>' : ''}</span>
        </div>
        <div class="bar"><span style="width:${pct}%"></span></div>
        <div class="quiz-card">
          <div class="q-type">${TYPE_LABEL[q.t]}${q.unitTitle ? ` · <a href="#/unit/${q.unit}">Unit ${q.unit}: ${esc(q.unitTitle)}</a>` : ''}</div>
          <div class="q-body"></div>
          <div class="q-feedback" hidden></div>
          <div class="q-actions row">
            <button class="btn ghost small" data-hint title="Show a small part of the answer">💡 Hint</button>
            <button class="btn ghost small ai-btn" data-aihint title="AI gives a clue without the answer">🤖 AI hint</button>
            <span class="grow"></span>
            <button class="btn ghost small" data-skip>Skip</button>
            <button class="btn primary" data-check>Check</button>
          </div>
        </div>
      </div>`;
    const body = root.querySelector('.q-body');
    const check = root.querySelector('[data-check]');

    let getAnswer;
    const typed = typeMode() && (q.t === 'mc' || q.t === 'order');
    root.querySelector('[data-type]').onclick = () => { localStorage.setItem('typeMode', typeMode() ? '0' : '1'); if (!answered) render(); };
    if (typed && q.t === 'mc') {
      const hasBlank = q.q.includes('___');
      body.innerHTML = `<div class="q-text fill">${hasBlank ? q.q.split('___').map((x) => inline(x)).join('<input class="blank-input" style="width:10ch" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Your answer">') : inline(q.q)}</div>
        <div class="muted small">Choices: ${q.o.map((o) => `<span class="chip small static">${esc(o)}</span>`).join(' ')}</div>
        ${hasBlank ? '' : '<input class="text-input wide" autocomplete="off" spellcheck="false" placeholder="Type the correct choice" aria-label="Your answer">'}`;
      const inp = body.querySelector('input');
      setTimeout(() => inp.focus(), 30);
      getAnswer = () => inp.value;
    } else if (typed && q.t === 'order') {
      body.innerHTML = `<div class="q-text">Words: ${shuffle(orderWords(q.a)).map((w) => `<span class="chip small static">${esc(w)}</span>`).join(' ')}</div>
        <input class="text-input wide" autocomplete="off" spellcheck="false" placeholder="Type the full sentence" aria-label="Your sentence">`;
      const inp = body.querySelector('input');
      setTimeout(() => inp.focus(), 30);
      getAnswer = () => inp.value;
    } else if (q.t === 'mc') {
      const opts2 = q.o.map((o, k) => ({ o, k }));
      body.innerHTML = `<div class="q-text">${inline(q.q).replace('___', '<span class="blank">____</span>')}</div>
        <div class="options">${opts2.map(({ o, k }, n) => `<button class="option" data-k="${k}"><kbd>${n + 1}</kbd> ${esc(o)}</button>`).join('')}</div>`;
      check.hidden = true;
      body.querySelectorAll('.option').forEach((b) => { b.onclick = () => submit(Number(b.dataset.k)); });
      getAnswer = () => null;
    } else if (q.t === 'fill') {
      const segs = q.q.split('___');
      const n = segs.length - 1;
      const width = (k) => Math.max(5, Math.max(...q.a.map((x) => (parts(q, x)[k] || '').length)) + 2);
      body.innerHTML = `<div class="q-text fill">${segs.map((s, k) => inline(s) + (k < n ? `<input class="blank-input" style="width:${width(k)}ch" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Blank ${k + 1}">` : '')).join('')}</div>`;
      const inputs = [...body.querySelectorAll('input')];
      setTimeout(() => inputs[0].focus(), 30);
      getAnswer = () => inputs.map((x) => x.value);
    } else if (q.t === 'order') {
      const words = orderWords(q.a);
      let pool = shuffle(words.map((w, k) => ({ w, k })));
      if (pool.map((x) => x.w).join(' ') === words.join(' ') && words.length > 2) pool = [...pool.slice(1), pool[0]];
      const chosen = [];
      const draw = () => {
        body.innerHTML = `<div class="order-answer ${chosen.length ? '' : 'empty'}">${chosen.map((x, n) => `<button class="chip on" data-n="${n}">${esc(x.w)}</button>`).join('') || '<span class="muted">Tap the words in the right order</span>'}</div>
          <div class="order-pool">${pool.map((x, n) => `<button class="chip" data-p="${n}" ${x.used ? 'disabled' : ''}>${esc(x.w)}</button>`).join('')}</div>`;
        body.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => { if (answered) return; const x = pool[Number(b.dataset.p)]; x.used = true; chosen.push(x); draw(); }; });
        body.querySelectorAll('[data-n]').forEach((b) => { b.onclick = () => { if (answered) return; const [x] = chosen.splice(Number(b.dataset.n), 1); x.used = false; draw(); }; });
      };
      draw();
      getAnswer = () => chosen.map((x) => x.w).join(' ');
      body.hint = () => {
        const want = words[chosen.length];
        const x = pool.find((p) => !p.used && p.w === want);
        if (x) { x.used = true; chosen.push(x); draw(); }
      };
    } else {
      body.innerHTML = `<div class="q-text"><span class="wrong-sent">❌ ${esc(q.q)}</span></div>
        <input class="text-input wide" value="${esc(q.q)}" autocomplete="off" spellcheck="false" aria-label="Corrected sentence">`;
      const inp = body.querySelector('input');
      setTimeout(() => { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }, 30);
      getAnswer = () => inp.value;
    }

    const isRight = (given) => {
      if (q.t === 'mc' && typeof given === 'string') return norm(given) === norm(q.o[q.a]);
      if (q.t === 'mc') return given === q.a;
      if (q.t === 'order') return norm(given) === norm(q.a);
      if (q.t === 'fill') return q.a.some((alt) => parts(q, alt).every((p, k) => norm(p) === norm(given[k] || '')));
      return q.a.some((a) => norm(a) === norm(given));
    };

    function submit(given, skipped = false) {
      if (answered) { next(); return; }
      if (!skipped && (q.t !== 'mc' || typeof given === 'string') && !String(given).replace(/,/g, '').trim()) { toast('Type or choose an answer first', 'warn', 1500); return; }
      answered = true;
      const ok = isRight(given);
      const givenText = q.t === 'mc' && typeof given === 'number' ? q.o[given] : Array.isArray(given) ? given.join(', ') : given;
      results.push({ qid: q.id, correct: ok, given: givenText, q, idx: i });
      saveState();
      if (q.t === 'mc' && !typed) {
        body.querySelectorAll('.option').forEach((b) => {
          const k = Number(b.dataset.k);
          b.disabled = true;
          if (k === q.a) b.classList.add('right');
          else if (k === given) b.classList.add('bad');
        });
      } else {
        body.querySelectorAll('input').forEach((x) => { x.readOnly = true; x.classList.add(ok ? 'right' : 'bad'); });
      }
      const fb = root.querySelector('.q-feedback');
      fb.hidden = false;
      fb.className = `q-feedback ${ok ? 'ok' : 'no'}`;
      const sentence = fullSentence(q);
      fb.innerHTML = `
        <div class="fb-title">${ok ? pick(['✅ Correct!', '✅ Great job!', '✅ Well done!', '✅ Perfect!']) : '❌ Not quite.'}</div>
        ${ok ? '' : `<div>Correct answer: <strong>${esc(answerText(q))}</strong></div>`}
        ${q.e ? `<div class="fb-expl">${inline(q.e)}</div>` : ''}
        <div class="row wrap fb-tools">
          <button class="btn ghost small" data-say="${esc(sentence)}">🔊 Listen</button>
          <button class="btn ghost small" data-ask>🤖 ${ok ? 'Explain more' : 'Ask AI why'}</button>
          ${opts.save === false ? '' : '<button class="btn ghost small" data-savq>☆ Save</button>'}
          <button class="btn ghost small" data-own>✍️ Write your own sentence</button>
        </div>
        <div class="own" hidden>
          <textarea class="text-input wide" rows="2" placeholder="Write your own sentence using this grammar…" spellcheck="true"></textarea>
          <div class="row gap wrap"><button class="btn small primary" data-own-save>💾 Save</button><button class="btn small ai-btn" data-own-check>🤖 Check it</button><span class="muted small" data-own-out></span></div>
          <div class="own-fb md"></div>
        </div>`;
      const own = fb.querySelector('.own');
      const ownTa = own.querySelector('textarea');
      const draftKey = `draft:${opts.saveKey || opts.title || 'quiz'}:${q.id || i}`;
      ownTa.value = localStorage.getItem(draftKey) || '';
      ownTa.oninput = () => localStorage.setItem(draftKey, ownTa.value);
      fb.querySelector('[data-own]').onclick = () => { own.hidden = !own.hidden; if (!own.hidden) ownTa.focus(); };
      ownTa.onkeydown = (e) => e.stopPropagation();
      own.querySelector('[data-own-save]').onclick = async () => {
        if (!ownTa.value.trim()) return;
        await api('/api/saved', { method: 'POST', body: { kind: 'writing', text: ownTa.value.trim(), extra: `Practice: ${sentence}`, unitId: q.unit || opts.unitId || null } });
        localStorage.removeItem(draftKey);
        own.querySelector('[data-own-out]').textContent = 'Saved to My Space ✓';
      };
      own.querySelector('[data-own-check]').onclick = async (e) => {
        if (!ownTa.value.trim()) return;
        const b = e.currentTarget;
        b.disabled = true;
        try {
          const r = await api('/api/ai/check', { method: 'POST', body: { text: ownTa.value, unitId: q.unit || opts.unitId || null } });
          own.querySelector('.own-fb').innerHTML = md(r.text, { examples: false });
        } catch (err) { toast(err.message, 'error', 4000); }
        b.disabled = false;
      };
      fb.querySelector('[data-ask]').onclick = () => ask(q, givenText);
      const sv = fb.querySelector('[data-savq]');
      if (sv) sv.onclick = async () => {
        await api('/api/saved', { method: 'POST', body: { kind: 'question', text: sentence, extra: q.e || '', unitId: q.unit || opts.unitId || null } });
        sv.textContent = '★ Saved'; sv.disabled = true;
      };
      root.querySelector('[data-hint]').hidden = true;
      root.querySelector('[data-aihint]').hidden = true;
      root.querySelector('[data-skip]').hidden = true;
      check.hidden = false;
      check.textContent = i + 1 < questions.length ? 'Next →' : 'See results';
      check.focus();
      if (!ok && navigator.vibrate) navigator.vibrate(60);
    }

    function next() {
      i++;
      if (i < questions.length) render(); else finish();
    }

    check.onclick = () => submit(getAnswer());
    root.querySelector('[data-skip]').onclick = () => submit(q.t === 'mc' ? -1 : '', true);
    root.querySelector('[data-hint]').onclick = () => {
      if (q.t === 'mc') {
        const wrong = [...body.querySelectorAll('.option:not([disabled])')].filter((b) => Number(b.dataset.k) !== q.a);
        if (wrong.length > 1) { wrong[0].disabled = true; wrong[0].classList.add('dim'); }
      } else if (q.t === 'fill') {
        const want = parts(q, q.a[0]);
        const inputs = [...body.querySelectorAll('input')];
        const k = Math.max(0, inputs.findIndex((x, j) => norm(x.value) !== norm(want[j])));
        inputs[k].value = want[k].slice(0, Math.max(1, inputs[k].value.length + 1));
        inputs[k].focus();
      } else if (q.t === 'order') body.hint();
      else toast(`Look at: ${diffHint(q.q, q.a[0])}`, 'info', 3500);
    };
    root.querySelector('[data-aihint]').onclick = async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      b.textContent = '🤖 Thinking…';
      let attempt = '';
      try { const a = getAnswer(); attempt = Array.isArray(a) ? a.join(', ') : a || ''; } catch { /* mc */ }
      try {
        const r = await api('/api/ai/hint', {
          method: 'POST',
          body: { question: { t: q.t, q: q.q, o: q.o, words: q.t === 'order' ? orderWords(q.a).join(' / ') : '', attempt, answer: answerText(q), unit: q.unit || opts.unitId } },
        });
        let box = root.querySelector('.ai-hint');
        if (!box) { box = document.createElement('div'); box.className = 'ai-hint'; root.querySelector('.q-body').after(box); }
        box.innerHTML = `🤖 ${inline(r.hint)}`;
        b.textContent = '🤖 Another hint';
      } catch (err) { toast(err.message, 'error', 4000); b.textContent = '🤖 AI hint'; }
      b.disabled = false;
    };
    root.onkeydown = (e) => {
      if (e.target.closest?.('.own')) return;
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (answered) next(); else if (q.t !== 'mc' || typed) submit(getAnswer()); }
      if (q.t === 'mc' && !typed && !answered && /^[1-9]$/.test(e.key)) {
        const b = body.querySelectorAll('.option')[Number(e.key) - 1];
        if (b && !b.disabled) submit(Number(b.dataset.k));
      }
    };
    root.tabIndex = -1;
    if (q.t === 'mc' && !typed) root.focus();
  }

  async function finish() {
    clearState();
    const correct = results.filter((r) => r.correct).length;
    const pct = Math.round((correct / results.length) * 100);
    let xp = 0;
    let attemptId = null;
    const detail = results.map((r) => ({
      q: r.q.t === 'order' ? `Word order: ${r.q.a}` : r.q.q, given: r.given || '', answer: answerText(r.q), correct: r.correct, e: r.q.e || '',
    }));
    const kind = opts.kind || opts.level;
    if (opts.record !== false) {
      try {
        const r = await api('/api/results', {
          method: 'POST',
          body: {
            unitId: opts.unitId, level: opts.level, kind, title: opts.title, day: today(), detail,
            results: results.map(({ qid, correct: c }) => ({ qid, correct: c })),
          },
        });
        xp = r.xp;
        attemptId = r.attemptId;
        loadState();
      } catch (e) { toast(e.message, 'error'); }
    }
    const stars = pct >= 95 ? 3 : pct >= 80 ? 2 : pct >= 50 ? 1 : 0;
    const wrong = results.filter((r) => !r.correct);
    root.innerHTML = `
      <div class="quiz-done">
        <div class="stars">${'★'.repeat(stars)}<span class="muted">${'★'.repeat(3 - stars)}</span></div>
        <h2>${pct >= 80 ? (pct === 100 ? 'Perfect score! 🎉' : 'Level passed! 🎉') : pct >= 50 ? 'Good try — keep going!' : 'Let\'s practise a bit more'}</h2>
        <div class="big-score">${correct} / ${results.length} <small>(${pct}%)</small></div>
        ${xp ? `<div class="xp-pill">+${xp} XP</div>` : ''}
        ${opts.level && pct < 80 ? '<p class="muted">Score 80% or more to pass this level.</p>' : ''}
        <div class="row wrap center gap">
          ${wrong.length ? '<button class="btn primary" data-retry-wrong>Retry wrong answers</button>' : ''}
          <button class="btn ai-btn" data-feedback>🤖 AI analysis of my result</button>
          <button class="btn" data-again>Try again</button>
          ${opts.extraActions || ''}
        </div>
        <div class="ai-feedback"></div>
        ${wrong.length ? `<h3>Review</h3><ul class="review-list">${wrong.map((r) => `
          <li><div>${esc(r.q.t === 'order' ? 'Word order' : r.q.q)}</div>
          <div class="small">Your answer: <span class="bad-txt">${esc(r.given || '—')}</span> · Correct: <span class="ok-txt">${esc(answerText(r.q))}</span></div></li>`).join('')}</ul>` : ''}
      </div>`;
    if (pct >= 80) confetti(root);
    root.querySelector('[data-feedback]').onclick = async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      b.textContent = '🤖 Analysing…';
      const box = root.querySelector('.ai-feedback');
      try {
        const r = await api('/api/ai/feedback', { method: 'POST', body: { unitId: opts.unitId, title: opts.title, items: detail, attemptId } });
        box.className = 'ai-feedback card md';
        box.innerHTML = md(r.text, { examples: false });
        b.remove();
      } catch (err) { toast(err.message, 'error', 5000); b.disabled = false; b.textContent = '🤖 AI analysis of my result'; }
    };
    root.querySelector('[data-again]').onclick = () => runQuiz(root, shuffle(questions), opts);
    const rw = root.querySelector('[data-retry-wrong]');
    if (rw) rw.onclick = () => runQuiz(root, wrong.map((r) => r.q), { ...opts, level: undefined, kind: 'review', title: 'Retry wrong answers' });
    opts.onDone?.({ pct, correct, total: results.length, xp, root, results, attemptId });
  }

  render();
  return {
    /** End the quiz now (e.g. timer ran out). Unanswered questions count as wrong. */
    finish() {
      if (i >= questions.length) return;
      if (answered) i++;
      for (; i < questions.length; i++) results.push({ qid: questions[i].id, correct: false, given: '', q: questions[i] });
      finish();
    },
  };
}

const typeMode = () => localStorage.getItem('typeMode') === '1';

/**
 * Start a quiz, offering to continue where the learner stopped if an unfinished one was saved.
 * opts.saveKey turns on auto-save.
 */
export async function startQuiz(root, questions, opts = {}) {
  if (!opts.saveKey) return runQuiz(root, questions, opts);
  let saved = null;
  try { saved = (await api(`/api/quiz-state/${encodeURIComponent(opts.saveKey)}`)).state; } catch { /* offline */ }
  if (!saved || !Array.isArray(saved.questions) || saved.i <= 0 || saved.i >= saved.questions.length) return runQuiz(root, questions, opts);
  const right = (saved.results || []).filter((r) => r.correct).length;
  root.innerHTML = `<div class="card center resume-card">
    <div class="big-emoji">📍</div><h3>You stopped at question ${saved.i + 1} of ${saved.questions.length}</h3>
    <p class="muted">${right} correct so far. Continue where you left off?</p>
    <div class="row center gap"><button class="btn primary" data-cont>▶ Continue</button><button class="btn" data-restart>Start again</button></div></div>`;
  return new Promise((resolve) => {
    root.querySelector('[data-cont]').onclick = () => resolve(runQuiz(root, saved.questions, { ...opts, resumeFrom: saved }));
    root.querySelector('[data-restart]').onclick = () => resolve(runQuiz(root, questions, opts));
  });
}

function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function diffHint(wrong, right) {
  const w = wrong.split(/\s+/);
  const r = right.split(/\s+/);
  const k = w.findIndex((x, n) => norm(x) !== norm(r[n] || ''));
  return k === -1 ? 'the end of the sentence' : `"${w[k]}"`;
}

function confetti(root) {
  const box = document.createElement('div');
  box.className = 'confetti';
  const colors = ['#4f46e5', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#ec4899'];
  for (let n = 0; n < 40; n++) {
    const s = document.createElement('i');
    s.style.left = Math.random() * 100 + '%';
    s.style.background = colors[n % colors.length];
    s.style.animationDelay = Math.random() * 0.4 + 's';
    s.style.transform = `rotate(${Math.random() * 360}deg)`;
    box.append(s);
  }
  root.append(box);
  setTimeout(() => box.remove(), 2200);
}

export { speak };
