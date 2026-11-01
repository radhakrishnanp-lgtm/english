// "Today's review" — the never-forget session.
// Built on three well-tested learning methods:
//   1. Retrieval practice — recall from memory first (brain dump), then answer questions.
//   2. Spaced repetition — each unit / verb / card comes back just before you would forget it
//      (forgetting-curve model, like FSRS used by Anki).
//   3. Interleaving — questions from different units are mixed in one session.
import { esc, md } from './md.js';
import { api, store, getUnit, unitMeta, toast, shuffle, loadState, $ } from './core.js';
import { runQuiz } from './quiz.js';
import { VERBS } from './verbs.js';

const DAY = 86400e3;
export const recallNow = (m) => Math.pow(1 + (19 / 81) * ((Date.now() - m.last_review) / DAY) / Math.max(0.1, m.stability), -0.5);
export const daysText = (ms) => { const d = ms / DAY; return d < 1 ? `${Math.max(1, Math.round(d * 24))} h` : `${Math.round(d)} day${Math.round(d) === 1 ? '' : 's'}`; };

/** Pick a word to hide in a saved sentence (for a cloze card). */
function cloze(text) {
  const words = text.split(/\s+/);
  const cand = words.map((w, i) => ({ w: w.replace(/[^\w'-]/g, ''), i })).filter((x) => x.w.length >= 3);
  if (!cand.length) return null;
  const pick = cand[Math.floor(Math.random() * cand.length)];
  const q = words.map((w, i) => (i === pick.i ? w.replace(pick.w, '___') : w)).join(' ');
  return { q, a: [pick.w] };
}

export async function renderReview(view) {
  document.title = "Today's review — Fluento";
  view.innerHTML = '<div class="page narrow"><p class="muted">Getting your review ready…</p></div>';
  const [t] = await Promise.all([api('/api/review/today'), loadState()]);
  const page = view.firstElementChild;
  const total = t.units.length + t.mistakes.length + t.verbs.length + t.cards.length;
  const header = `<h1>🧠 Today's review</h1>
    <p class="muted">Short daily reviews keep everything in long-term memory. Things come back just before you would forget them — the better you remember, the longer the gap.</p>`;

  if (!total) {
    const weakest = [...(store.state.memory || [])].sort((a, b) => recallNow(a) - recallNow(b)).slice(0, 3);
    page.innerHTML = `${header}
      <div class="card center"><div class="big-emoji">🎉</div><h2>All caught up!</h2>
      <p class="muted">${t.next ? `Your next review is in ${daysText(t.next - Date.now())}.` : 'Pass a level in any unit and it will start coming back here for review.'}</p>
      ${weakest.length ? `<p>Want extra practice? Strengthen your weakest units:</p><button class="btn primary" data-extra>💪 Practise ${weakest.map((w) => 'Unit ' + w.unit_id).join(', ')}</button>` : '<a class="btn primary" href="#/course">Go to the course</a>'}</div>`;
    const ex = $('[data-extra]', page);
    if (ex) ex.onclick = () => session(page, { units: weakest.map((w) => ({ unitId: w.unit_id })), mistakes: [], verbs: [], cards: [] }, true);
    return;
  }
  page.innerHTML = `${header}
    <div class="card review-plan">
      <h3>Due today</h3>
      <ul class="plan-list">
        ${t.units.length ? `<li>📚 <b>${t.units.length}</b> unit${t.units.length > 1 ? 's' : ''}: ${t.units.map((x) => `Unit ${x.unitId} <span class="mem-pill" title="Chance you still remember">${Math.round(x.recall * 100)}%</span>`).join(' ')}</li>` : ''}
        ${t.mistakes.length ? `<li>🔁 <b>${t.mistakes.length}</b> question${t.mistakes.length > 1 ? 's' : ''} you got wrong before</li>` : ''}
        ${t.verbs.length ? `<li>⚡ <b>${t.verbs.length}</b> irregular verb${t.verbs.length > 1 ? 's' : ''}</li>` : ''}
        ${t.cards.length ? `<li>☆ <b>${t.cards.length}</b> saved sentence${t.cards.length > 1 ? 's' : ''}</li>` : ''}
      </ul>
      <p class="muted small">About ${Math.max(2, Math.round(total * 0.4))} minutes. Everything is mixed together — that helps memory.</p>
      <button class="btn primary lg" data-go>Start review</button>
    </div>`;
  $('[data-go]', page).onclick = () => session(page, t, false);
}

async function session(page, t, extra) {
  // Step 1 — brain dump (retrieval practice) for the first due unit.
  const first = t.units[0];
  if (first) {
    const u = unitMeta(first.unitId);
    const key = `recall-draft:${u.id}`;
    page.innerHTML = `<h1>🧠 Step 1: Remember first</h1>
      <div class="card">
        <p><b>Without looking</b>, write everything you remember about <b>Unit ${u.id}: ${esc(u.title)}</b> — the rule, when to use it, examples. Even a few words help: trying to remember is what makes memory strong.</p>
        <textarea class="text-input wide" rows="6" data-recall placeholder="Type what you remember…">${esc(localStorage.getItem(key) || '')}</textarea>
        <div class="row gap wrap"><button class="btn primary" data-check>🤖 Check what I remembered</button><button class="btn" data-skip>Skip →</button></div>
        <div class="recall-fb md"></div>
      </div>`;
    const ta = $('[data-recall]', page);
    ta.oninput = () => localStorage.setItem(key, ta.value);
    await new Promise((resolve) => {
      $('[data-skip]', page).onclick = resolve;
      $('[data-check]', page).onclick = async (e) => {
        const text = ta.value.trim();
        if (!text) { toast('Write something first (anything you remember!)', 'warn'); return; }
        const btn = e.currentTarget;
        btn.disabled = true;
        api('/api/saved', { method: 'POST', body: { kind: 'recall', text, extra: `What I remembered about Unit ${u.id}`, unitId: u.id } }).catch(() => {});
        localStorage.removeItem(key);
        try {
          const r = await api('/api/ai/check', { method: 'POST', body: { text, unitId: u.id, mode: 'recall' } });
          $('.recall-fb', page).innerHTML = md(r.text, { examples: false });
        } catch (err) { $('.recall-fb', page).innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
        btn.outerHTML = '<button class="btn primary" data-next>Continue to questions →</button>';
        $('[data-next]', page).onclick = resolve;
        $('[data-skip]', page).remove();
      };
    });
  }

  // Step 2 — one mixed quiz.
  page.innerHTML = '<p class="muted">Mixing your questions…</p>';
  const qs = [];
  for (const x of t.units) {
    const u = await getUnit(x.unitId);
    const pool = shuffle(['easy', 'medium', 'hard'].flatMap((l) => u.practice[l]));
    for (const q of pool.slice(0, 3)) qs.push({ ...q, unit: u.id, unitTitle: u.title, review: `unit:${u.id}` });
  }
  if (t.mistakes.length) for (const q of await api(`/api/questions?ids=${t.mistakes.join(',')}`)) qs.push(q);
  for (const base of t.verbs) {
    const v = VERBS.find((x) => x.base === base);
    if (v) qs.push({ t: 'fill', id: `rv-verb-${v.base}`, q: `${v.base} (${v.meaning}) → past simple ___ , past participle ___`, a: [`${v.past.split(/[/ ]/)[0]}, ${v.pp.split(/[/ ]/)[0]}`], e: `${v.base} – ${v.past} – ${v.pp}`, review: `verb:${v.base}` });
  }
  for (const c of t.cards) {
    const cz = cloze(c.text);
    if (cz) qs.push({ t: 'fill', id: `rv-card-${c.id}`, q: cz.q, a: cz.a, e: c.extra || 'From your saved sentences', unit: c.unit_id || undefined, review: `card:${c.id}` });
  }
  if (!qs.length) { page.innerHTML = '<div class="card">Nothing to review right now. 🎉</div>'; return; }
  page.innerHTML = '<h1>🧠 Step 2: Mixed questions</h1><div class="host"></div>';
  runQuiz($('.host', page), shuffle(qs), {
    title: extra ? 'Extra practice' : "Today's review", kind: 'today',
    onDone: async ({ results, root }) => {
      // Each unit counts as remembered if at least 2 of its 3 questions were right.
      const by = {};
      for (const r of results) if (r.q.review) (by[r.q.review] ||= []).push(r.correct);
      const items = Object.entries(by).map(([key, arr]) => ({ key, success: arr.filter(Boolean).length >= Math.ceil(arr.length * 0.6) }));
      let upd = [];
      try { upd = (await api('/api/review', { method: 'POST', body: { items } })).updated; } catch (e) { toast(e.message, 'error'); }
      loadState();
      const box = document.createElement('div');
      box.className = 'card review-summary';
      const label = (k) => (k.startsWith('unit:') ? `Unit ${k.slice(5)}: ${esc(unitMeta(k.slice(5))?.title || '')}` : k.startsWith('verb:') ? `Verb “${esc(k.slice(5))}”` : 'Saved sentence');
      box.innerHTML = `<h3>🧠 Memory updated</h3><ul class="plan-list">${upd.map((x) => {
        const ok = items.find((i) => i.key === x.key)?.success;
        return `<li>${ok ? '💪' : '🔁'} ${label(x.key)} — next review in <b>${daysText(x.stability * DAY)}</b>${ok ? '' : ' (you will see it again soon)'}</li>`;
      }).join('')}</ul>`;
      root.querySelector('.quiz-done')?.prepend(box);
    },
  });
}
