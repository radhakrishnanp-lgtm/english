// My Space (bookmarks, important, notes, saved, mistakes), Reference pages, AI chat list.
import { md, esc } from './md.js';
import { api, store, unitMeta, $, $$, toast, fmtDate, confirmBox, setFlag, levelDots, speak } from './core.js';
import { notesTab, progressChart } from './unit.js';
import { tutor } from './tutor.js';
import { VERBS } from './verbs.js';

export async function renderSpace(view, tab = 'bookmarks') {
  document.title = 'My Space — English Path';
  const st = store.state;
  const tabs = [
    ['bookmarks', '🔖 Bookmarks', st.flags.filter((f) => f.bookmarked).length],
    ['important', '⭐ Important', st.flags.filter((f) => f.important).length],
    ['notes', '🗒️ Notes', st.noteCounts.reduce((n, x) => n + x.n, 0)],
    ['saved', '☆ Saved', null],
    ['mistakes', '🔁 Mistakes', st.mistakes.length],
    ['results', '📊 Results', null],
    ['history', '🕘 Recently viewed', null],
  ];
  view.innerHTML = `<div class="page">
    <h1>My Space</h1>
    <p class="muted">Everything you have saved, marked and written — private to you.</p>
    <div class="tabs">${tabs.map(([k, l, n]) => `<a href="#/space/${k}" class="${k === tab ? 'on' : ''}">${l}${n ? `<span class="count"> ${n}</span>` : ''}</a>`).join('')}</div>
    <div class="host"></div></div>`;
  const host = $('.host', view);

  const unitList = (ids, empty, flag) => {
    host.innerHTML = ids.length ? `<div class="unit-grid">${ids.map((id) => {
      const u = unitMeta(id);
      return `<div class="unit-card"><a class="unit-num" href="#/unit/${id}">${id}</a>
        <a class="unit-info" href="#/unit/${id}"><b>${esc(u.title)}</b><span class="muted small">${esc(u.section)}</span></a>
        <div class="unit-side">${levelDots(id)}${flag ? `<button class="icon-btn small" data-unflag="${id}" title="Remove">✕</button>` : ''}</div></div>`;
    }).join('')}</div>` : `<div class="empty card">${empty}</div>`;
    $$('[data-unflag]', host).forEach((b) => {
      b.onclick = async () => { await setFlag(Number(b.dataset.unflag), { [flag]: false }); renderSpace(view, tab); };
    });
  };

  if (tab === 'bookmarks') unitList(st.flags.filter((f) => f.bookmarked).map((f) => f.unit_id).sort((a, b) => a - b), 'No bookmarks yet. Tap 📑 on any unit to bookmark it.', 'bookmarked');
  if (tab === 'important') unitList(st.flags.filter((f) => f.important).map((f) => f.unit_id).sort((a, b) => a - b), 'Nothing marked important yet. Tap ☆ on any unit.', 'important');
  if (tab === 'history') unitList(st.flags.filter((f) => f.visited_at).sort((a, b) => b.visited_at - a.visited_at).slice(0, 30).map((f) => f.unit_id), 'You have not opened any unit yet.');
  if (tab === 'notes') await notesTab(host, null);
  if (tab === 'results') {
    const list = await api('/api/attempts');
    const avg = list.length ? Math.round(list.reduce((n, a) => n + a.score / a.total, 0) / list.length * 100) : 0;
    host.innerHTML = `<div class="grid cards-2">
        <div class="card"><div class="stat-row"><div><b>${list.length}</b><span class="muted small">tests taken</span></div><div><b>${avg}%</b><span class="muted small">average score</span></div><div><b>${list.filter((a) => a.kind === 'exam').length}</b><span class="muted small">unit exams</span></div></div></div>
        <div class="card"><b>Recent scores</b>${progressChart(list.slice(0, 14).reverse())}</div></div>
      ${list.length ? `<div class="table-wrap"><table class="results-table"><thead><tr><th>Date</th><th>Unit</th><th>Test</th><th>Score</th></tr></thead><tbody>
      ${list.map((a) => { const pct = Math.round((a.score / a.total) * 100); return `<tr><td>${fmtDate(a.created_at)}</td>
        <td>${a.unit_id ? `<a href="#/unit/${a.unit_id}/exam">Unit ${a.unit_id}</a>` : '—'}</td><td>${esc(a.title || a.kind)}${a.has_feedback ? ' 🤖' : ''}</td>
        <td><span class="score-pill ${pct >= 80 ? 'ok' : pct >= 50 ? 'mid' : 'low'}">${a.score}/${a.total} · ${pct}%</span></td></tr>`; }).join('')}
      </tbody></table></div>` : '<div class="empty card">No results yet.</div>'}
      <p class="muted small">Open a unit's 📝 Exam & results tab to see every answer and get an AI report.</p>`;
  }
  if (tab === 'mistakes') {
    const by = {};
    for (const m of st.mistakes) (by[m.unit_id] ||= []).push(m);
    const ids = Object.keys(by).map(Number).sort((a, b) => by[b].length - by[a].length);
    host.innerHTML = ids.length ? `<p><a class="btn primary" href="#/practice/review">🔁 Review now</a></p>
      <div class="table-wrap"><table><thead><tr><th>Unit</th><th>Questions to review</th><th>Times wrong</th><th></th></tr></thead><tbody>
      ${ids.map((id) => `<tr><td><a href="#/unit/${id}">Unit ${id}: ${esc(unitMeta(id).title)}</a></td><td>${by[id].length}</td><td>${by[id].reduce((n, m) => n + m.wrong, 0)}</td>
      <td><button class="btn small ai-btn" data-ask="${id}">🤖 Help me</button></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty card">No mistakes saved. 🎉</div>';
    $$('[data-ask]', host).forEach((b) => {
      b.onclick = () => tutor.show(`unit:${b.dataset.ask}`, 'I keep making mistakes in this unit. Explain the rule again very clearly, show the most common mistakes, then quiz me with 3 questions one by one.');
    });
  }
  if (tab === 'saved') {
    const items = await api('/api/saved');
    const kinds = { example: '💬 Sentence', question: '🎯 Question', ai: '🤖 AI answer', word: '🔤 Word' };
    let filter = 'all';
    const draw = () => {
      const list = items.filter((x) => filter === 'all' || x.kind === filter);
      host.innerHTML = `<div class="row wrap gap"><div class="seg">${[['all', 'All'], ...Object.entries(kinds)].map(([k, l]) => `<button data-k="${k}" class="${filter === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${items.some((x) => x.kind !== 'ai') ? '<button class="btn small" data-cards>🃏 Practise as flashcards</button>' : ''}</div>
        <div class="saved">${list.map((x) => `<div class="card saved-item">
          <div class="muted small">${kinds[x.kind]}${x.unit_id ? ` · <a href="#/unit/${x.unit_id}">Unit ${x.unit_id}</a>` : ''} · ${fmtDate(x.created_at)}</div>
          <div class="${x.kind === 'ai' ? 'md' : 'saved-text'}">${x.kind === 'ai' ? md(x.text, { examples: false }) : esc(x.text)}</div>
          ${x.extra ? `<div class="muted small">${esc(x.extra)}</div>` : ''}
          <div class="row gap"><button class="icon-btn small" data-say="${esc(x.text.replace(/[*#`>|_~]/g, '').slice(0, 600))}">🔊</button><button class="icon-btn small" data-del="${x.id}">🗑️</button></div>
        </div>`).join('') || '<div class="empty card">Nothing saved yet. Tap ☆ next to sentences, questions or AI answers.</div>'}</div>`;
      $$('[data-k]', host).forEach((b) => { b.onclick = () => { filter = b.dataset.k; draw(); }; });
      $$('[data-del]', host).forEach((b) => {
        b.onclick = async () => { await api(`/api/saved/${b.dataset.del}`, { method: 'DELETE' }); items.splice(items.findIndex((x) => x.id === Number(b.dataset.del)), 1); draw(); };
      });
      const c = $('[data-cards]', host);
      if (c) c.onclick = () => savedCards(host, items.filter((x) => x.kind !== 'ai'), draw);
    };
    draw();
  }
}

function savedCards(host, items, back) {
  let i = 0;
  const deck = [...items].sort(() => Math.random() - 0.5);
  const draw = () => {
    if (i >= deck.length) { back(); toast('Finished! 🎉', 'ok'); return; }
    const x = deck[i];
    const words = x.text.split(' ');
    const hidden = words.map((w, n) => (n % 3 === 1 && w.length > 2 ? '＿'.repeat(Math.min(6, w.length)) : w)).join(' ');
    host.innerHTML = `<div class="flashcard"><div class="fc-inner"><div class="fc-front"><div class="muted small">${i + 1}/${deck.length} · fill the gaps in your head, then tap</div><div class="fc-sent">${esc(hidden)}</div></div>
      <div class="fc-back"><div class="fc-sent">${esc(x.text)}</div><button class="btn ghost small" data-say="${esc(x.text)}">🔊</button></div></div></div>
      <div class="row center gap"><button class="btn" data-back>Exit</button><button class="btn primary" data-next>Next →</button></div>`;
    host.querySelector('.flashcard').onclick = (e) => { if (!e.target.closest('[data-say]')) e.currentTarget.classList.toggle('flip'); };
    host.querySelector('[data-next]').onclick = () => { i++; draw(); };
    host.querySelector('[data-back]').onclick = back;
  };
  draw();
}

// ---------- reference ----------
export async function renderRef(view, slug) {
  if (!slug) {
    document.title = 'Reference — English Path';
    view.innerHTML = `<div class="page"><h1>Reference</h1><p class="muted">Quick reference pages you can come back to any time.</p>
      <div class="grid practice-grid">
        <a class="card practice-card" href="#/ref/irregular-verbs"><span class="p-ic">📋</span><h3>Irregular verbs list</h3><p class="muted small">${VERBS.length} verbs with meanings</p></a>
        ${store.course.refs.map((r) => `<a class="card practice-card" href="#/ref/${r.slug}"><span class="p-ic">📘</span><h3>${esc(r.title)}</h3></a>`).join('')}
      </div></div>`;
    return;
  }
  if (slug === 'irregular-verbs') { location.hash = '#/practice/verbs/list'; return; }
  const r = await api(`/api/refs/${encodeURIComponent(slug)}`);
  document.title = `${r.title} — English Path`;
  view.innerHTML = `<div class="page"><div class="crumbs"><a href="#/ref">Reference</a> › ${esc(r.title)}</div>
    <h1>${esc(r.title)}</h1><article class="lesson md">${md(r.learn)}</article>
    <button class="btn ai-btn" data-ask>🤖 Ask AI about this</button></div>`;
  $('[data-ask]', view).onclick = () => tutor.show('general', `I am reading the reference page "${r.title}". Explain the most important points simply with examples.`);
}

// ---------- chats ----------
export async function renderChats(view) {
  document.title = 'AI Tutor — English Path';
  const [threads, mem] = await Promise.all([api('/api/threads'), api('/api/memory')]);
  const name = (s) => (s === 'general' ? '🌍 General' : `🎯 Unit ${s.slice(5)}: ${esc(unitMeta(s.slice(5))?.title || '')}`);
  view.innerHTML = `<div class="page narrow">
    <h1>🤖 AI Tutor</h1>
    <div class="card">
      <p>Your personal English tutor:</p>
      <ul>
        <li><b>🎯 Unit mode</b> — opens from any unit and focuses <i>only</i> on that unit's grammar.</li>
        <li><b>🌍 General</b> — anything about English: meanings, writing, pronunciation, translation.</li>
        <li><b>🎙️ Live talk</b> — a spoken conversation; it answers out loud and gently corrects you.</li>
        <li><b>🧠 Memory</b> — it keeps short notes about you, per unit and in general, so the next chat continues where you stopped.</li>
      </ul>
      <div class="row gap wrap"><button class="btn primary" data-general>Open General chat</button><button class="btn" data-mem>🧠 Memory (${mem.length})</button><a class="btn ghost" href="#/settings">⚙️ AI settings</a></div>
    </div>
    <h2>My chats</h2>
    ${threads.length ? `<div class="chat-list">${threads.map((t) => `<div class="card chat-row">
      <div class="grow"><button class="link" data-open="${t.id}" data-scope="${t.scope}">${esc(t.title)}</button><div class="muted small">${name(t.scope)} · ${t.n} messages · ${fmtDate(t.updated_at)}</div></div>
      <button class="icon-btn small" data-del="${t.id}" title="Delete">🗑️</button></div>`).join('')}</div>` : '<div class="empty card">No conversations yet.</div>'}
  </div>`;
  $('[data-general]', view).onclick = () => tutor.show('general');
  $('[data-mem]', view).onclick = () => { tutor.ensure(); tutor.menu(); };
  $$('[data-open]', view).forEach((b) => {
    b.onclick = async () => {
      const s = b.dataset.scope;
      if (s.startsWith('unit:')) tutor.unitId = Number(s.slice(5));
      tutor.show(s);
      await tutor.setScope(s);
      await tutor.openThread(Number(b.dataset.open));
    };
  });
  $$('[data-del]', view).forEach((b) => {
    b.onclick = async () => {
      if (!await confirmBox('Delete this conversation?', 'Delete')) return;
      await api(`/api/threads/${b.dataset.del}`, { method: 'DELETE' });
      renderChats(view);
    };
  });
  void speak;
}
