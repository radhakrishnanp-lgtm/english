// Admin console: overview, users (create / edit / AI switch / limits), live tracker,
// AI usage history (tokens, cost), conversations, and server settings (provider, prices, registration).
import { md, esc } from './md.js';
import { api, store, toast, modal, confirmBox, unitMeta, $, $$ } from './core.js';

const money = (n) => `$${(Number(n) || 0).toFixed((Number(n) || 0) < 1 ? 4 : 2)}`;
const num = (n) => (Number(n) || 0).toLocaleString();
const ago = (t) => {
  if (!t) return 'never';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};
const when = (t) => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const KINDS = ['chat', 'voice', 'quiz', 'hint', 'feedback', 'flow', 'memory', 'check', 'recall', 'test'];
const TABS = [['overview', '📊 Overview'], ['users', '👥 Users'], ['live', '🛰️ Live tracker'], ['usage', '🤖 AI usage'], ['chats', '💬 AI conversations'], ['settings', '⚙️ Settings']];

let liveTimer = null;

export async function renderAdmin(view, tab = 'overview', arg) {
  clearInterval(liveTimer);
  if (store.me.user.role !== 'admin') { view.innerHTML = '<div class="page"><h1>Admins only</h1></div>'; return; }
  document.title = 'Admin — Fluento';
  const active = tab === 'user' ? 'users' : tab;
  view.innerHTML = `<div class="page wide admin">
    <div class="row between wrap"><h1>🛡️ Admin</h1><span class="muted small">Signed in as ${esc(store.me.user.displayName)}</span></div>
    <div class="tabs">${TABS.map(([k, l]) => `<a href="#/admin/${k}" class="${k === active ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div class="host"><p class="muted">Loading…</p></div></div>`;
  const host = $('.host', view);
  const pages = { overview, users, user: userDetail, live, usage, chats, settings };
  await (pages[tab] || overview)(host, arg);
  window.addEventListener('hashchange', () => clearInterval(liveTimer), { once: true });
}

// ---------- tiny charts ----------
function bars(series, key, { fmt = num, color = 'var(--brand)', label = (d) => d.day.slice(5) } = {}) {
  if (!series.length) return '<p class="muted small">No data yet.</p>';
  const max = Math.max(...series.map((d) => Number(d[key]) || 0), 1);
  return `<div class="a-chart">${series.map((d) => `<div class="a-bar" title="${esc(d.day)}: ${fmt(d[key])}">
    <span style="height:${Math.max(2, ((Number(d[key]) || 0) / max) * 100)}%;background:${color}"></span><small>${esc(label(d))}</small></div>`).join('')}</div>`;
}
const stat = (label, value, sub = '') => `<div class="card a-stat"><span class="muted small">${label}</span><b>${value}</b>${sub ? `<span class="muted small">${sub}</span>` : ''}</div>`;

// ---------- overview ----------
async function overview(host) {
  const o = await api('/api/admin/overview');
  const ai = o.ai;
  const tok = (x) => num(x.prompt + x.completion);
  const acc = o.learning.answered ? Math.round((o.learning.correct / o.learning.answered) * 100) : 0;
  host.innerHTML = `
    <h2>People</h2>
    <div class="a-stats">
      ${stat('Users', num(o.users.total), `${o.users.admins} admin · ${o.users.disabled} off`)}
      ${stat('🟢 Online now', num(o.users.online), 'last 3 minutes')}
      ${stat('Active today', num(o.users.today))}
      ${stat('Active this week', num(o.users.week))}
      ${stat('Questions answered', num(o.learning.answered), `${acc}% correct`)}
      ${stat('Tests taken', num(o.learning.tests), `${num(o.learning.xp)} XP earned`)}
    </div>
    <h2>AI usage & spend</h2>
    <div class="a-stats">
      ${stat('Today', money(ai.today.cost), `${num(ai.today.calls)} calls · ${tok(ai.today)} tokens`)}
      ${stat('Last 7 days', money(ai.week.cost), `${num(ai.week.calls)} calls · ${tok(ai.week)} tokens`)}
      ${stat('Last 30 days', money(ai.month.cost), `${num(ai.month.calls)} calls · ${tok(ai.month)} tokens`)}
      ${stat('All time', money(ai.all.cost), `${num(ai.all.calls)} calls · ${tok(ai.all)} tokens`)}
      ${stat('Reasoning tokens', num(ai.all.reasoning), 'all time')}
      ${stat('Errors', num(ai.all.errors), ai.all.calls ? `${Math.round((ai.all.errors / ai.all.calls) * 100)}% of calls` : '')}
    </div>
    <div class="grid cards-2">
      <div class="card"><h3>Tokens per day (30 days)</h3>${bars(ai.daily, 'tokens')}</div>
      <div class="card"><h3>Cost per day (30 days)</h3>${bars(ai.daily, 'cost', { fmt: money, color: 'var(--warn)' })}</div>
      <div class="card"><h3>Learners per day</h3>${bars(o.learning.daily, 'learners', { color: 'var(--ok)' })}</div>
      <div class="card"><h3>Questions answered per day</h3>${bars(o.learning.daily, 'answered', { color: 'var(--ai)' })}</div>
    </div>
    <div class="grid cards-2">
      <div class="card"><h3>By model</h3><div class="table-wrap"><table><thead><tr><th>Model</th><th>Calls</th><th>Input</th><th>Output</th><th>Cost</th><th>Avg time</th></tr></thead><tbody>
        ${ai.byModel.map((m) => `<tr><td><b>${esc(m.model)}</b><div class="muted small">${esc(m.provider)}</div></td><td>${num(m.calls)}</td><td>${num(m.prompt)}</td><td>${num(m.completion)}</td><td>${money(m.cost)}</td><td>${(m.ms / 1000).toFixed(1)}s</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No AI calls yet.</td></tr>'}
      </tbody></table></div></div>
      <div class="card"><h3>By feature (30 days)</h3><div class="table-wrap"><table><thead><tr><th>Feature</th><th>Calls</th><th>Tokens</th><th>Cost</th></tr></thead><tbody>
        ${ai.byKind.map((k) => `<tr><td>${esc(k.kind)}</td><td>${num(k.calls)}</td><td>${num(k.tokens)}</td><td>${money(k.cost)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">—</td></tr>'}
      </tbody></table></div>
      <h3>Top users (30 days)</h3><div class="table-wrap"><table><tbody>
        ${ai.topUsers.map((u) => `<tr><td><a href="#/admin/user/${u.id}">${esc(u.display_name)}</a> <span class="muted small">@${esc(u.username)}</span></td><td>${num(u.calls)} calls</td><td>${num(u.tokens)} tok</td><td>${money(u.cost)}</td></tr>`).join('') || '<tr><td class="muted">—</td></tr>'}
      </tbody></table></div></div>
    </div>`;
}

// ---------- users ----------
function genPassword() {
  const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), (x) => a[x % a.length]).join('');
}

async function users(host) {
  const list = await api('/api/admin/users');
  let filter = '';
  const draw = () => {
    const f = filter.toLowerCase();
    const rows = list.filter((u) => !f || `${u.username} ${u.display_name}`.toLowerCase().includes(f));
    host.innerHTML = `
      <div class="row between wrap gap">
        <input class="text-input" placeholder="Search users…" data-q value="${esc(filter)}">
        <button class="btn primary" data-new>＋ Create user</button>
      </div>
      <div class="table-wrap"><table class="a-users"><thead><tr><th>User</th><th>Status</th><th>Now on</th><th>Progress</th><th>Accuracy</th><th>AI tokens (today / total)</th><th>AI cost</th><th>AI</th><th></th></tr></thead><tbody>
      ${rows.map((u) => `<tr class="${u.disabled ? 'off' : ''}">
        <td><a href="#/admin/user/${u.id}"><b>${esc(u.display_name)}</b></a> ${u.role === 'admin' ? '<span class="tag">admin</span>' : ''}<div class="muted small">@${esc(u.username)}</div></td>
        <td>${u.disabled ? '<span class="tag bad">turned off</span>' : u.online ? '<span class="dot-on"></span> online' : `<span class="muted small">${ago(u.last_seen)}</span>`}</td>
        <td class="small">${u.resume ? `<a href="${esc(u.resume.route)}">${esc(u.resume.title || u.resume.route)}</a>` : '—'}</td>
        <td class="small">${u.mastered} mastered · ${u.levelsPassed} levels<br>🔥 ${u.streak} · ${num(u.xp)} XP</td>
        <td>${u.answered ? Math.round((u.correct / u.answered) * 100) + '%' : '—'}<div class="muted small">${num(u.answered)} answers</div></td>
        <td>${num(u.aiTokensToday)} / ${num(u.aiTokens)}${u.ai_daily_tokens ? `<div class="muted small">limit ${num(u.ai_daily_tokens)}/day</div>` : ''}</td>
        <td>${money(u.aiCost)}<div class="muted small">${num(u.aiCalls)} calls</div></td>
        <td><label class="switch" title="AI tutor on/off"><input type="checkbox" data-ai="${u.id}" ${u.ai_enabled ? 'checked' : ''}><span></span></label></td>
        <td><button class="btn small" data-edit="${u.id}">Edit</button></td></tr>`).join('')}
      </tbody></table></div>`;
    const q = $('[data-q]', host);
    q.oninput = () => { filter = q.value; draw(); const n = $('[data-q]', host); n.focus(); n.setSelectionRange(filter.length, filter.length); };
    $('[data-new]', host).onclick = () => createUserDialog(() => users(host));
    $$('[data-ai]', host).forEach((c) => {
      c.onchange = async () => {
        await api(`/api/admin/users/${c.dataset.ai}`, { method: 'PUT', body: { aiEnabled: c.checked } });
        list.find((u) => u.id === Number(c.dataset.ai)).ai_enabled = c.checked ? 1 : 0;
        toast(c.checked ? 'AI turned on' : 'AI turned off', 'ok');
      };
    });
    $$('[data-edit]', host).forEach((b) => { b.onclick = () => editUserDialog(list.find((u) => u.id === Number(b.dataset.edit)), () => users(host)); });
  };
  draw();
}

function createUserDialog(done) {
  const pw = genPassword();
  const m = modal(`<h3>＋ Create user</h3>
    <form class="form" data-f>
      <label>Name<input name="displayName" placeholder="e.g. Kavya" required></label>
      <label>Username<input name="username" required autocapitalize="off" spellcheck="false" pattern="[A-Za-z0-9_.\\-]{3,40}"></label>
      <label>Password<div class="row gap"><input name="password" value="${pw}" required minlength="8"><button type="button" class="btn small" data-gen>New</button></div>
        <span class="muted small">Share it with the learner. They can change it in Settings.</span></label>
      <label>Role<select name="role"><option value="user">Learner</option><option value="admin">Admin</option></select></label>
      <label class="check"><input type="checkbox" name="aiEnabled" checked> AI tutor allowed</label>
      <label>Daily AI token limit <span class="muted small">(0 = no limit)</span><input name="aiDailyTokens" type="number" min="0" step="1000" value="0"></label>
      <div class="form-err" hidden></div>
      <button class="btn primary">Create</button>
    </form>`);
  const f = m.el.querySelector('[data-f]');
  m.el.querySelector('[data-gen]').onclick = () => { f.password.value = genPassword(); };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(f));
    body.aiEnabled = f.aiEnabled.checked;
    body.aiDailyTokens = Number(body.aiDailyTokens) || 0;
    try {
      await api('/api/admin/users', { method: 'POST', body });
      m.close();
      const card = modal(`<h3>✅ User created</h3><p>Give these login details to <b>${esc(body.displayName)}</b>:</p>
        <pre class="cred">Website:  ${esc(location.origin)}\nUsername: ${esc(body.username)}\nPassword: ${esc(body.password)}</pre>
        <button class="btn" data-copy>📋 Copy</button>`);
      card.el.querySelector('[data-copy]').onclick = async () => { await navigator.clipboard?.writeText(card.el.querySelector('pre').textContent); toast('Copied'); };
      done();
    } catch (ex) { const er = m.el.querySelector('.form-err'); er.textContent = ex.message; er.hidden = false; }
  };
}

function editUserDialog(u, done) {
  const self = u.id === store.me.user.id;
  const m = modal(`<h3>Edit ${esc(u.display_name)} <span class="muted small">@${esc(u.username)}</span></h3>
    <form class="form" data-f>
      <label>Name<input name="displayName" value="${esc(u.display_name)}"></label>
      <label>Role<select name="role"><option value="user" ${u.role === 'user' ? 'selected' : ''}>Learner</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option></select></label>
      <label class="check"><input type="checkbox" name="aiEnabled" ${u.ai_enabled ? 'checked' : ''}> AI tutor allowed</label>
      <label>Daily AI token limit <span class="muted small">(0 = no limit)</span><input name="aiDailyTokens" type="number" min="0" step="1000" value="${u.ai_daily_tokens || 0}"></label>
      <label>New password <span class="muted small">(leave empty to keep)</span><div class="row gap"><input name="password" autocomplete="new-password"><button type="button" class="btn small" data-gen>Generate</button></div></label>
      <div class="form-err" hidden></div>
      <div class="row gap wrap"><button class="btn primary">Save</button>
        ${self ? '' : `<button type="button" class="btn" data-toggle>${u.disabled ? '✅ Turn account on' : '⛔ Turn account off'}</button><button type="button" class="btn danger" data-del>Delete</button>`}</div>
    </form>`);
  const f = m.el.querySelector('[data-f]');
  m.el.querySelector('[data-gen]').onclick = () => { f.password.value = genPassword(); };
  const err = (ex) => { const er = m.el.querySelector('.form-err'); er.textContent = ex.message; er.hidden = false; };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = { displayName: f.displayName.value, role: f.role.value, aiEnabled: f.aiEnabled.checked, aiDailyTokens: Number(f.aiDailyTokens.value) || 0 };
    if (f.password.value) body.password = f.password.value;
    try {
      await api(`/api/admin/users/${u.id}`, { method: 'PUT', body });
      m.close();
      toast(body.password ? `Saved. New password: ${body.password}` : 'Saved', 'ok', body.password ? 8000 : 2500);
      done();
    } catch (ex) { err(ex); }
  };
  const tg = m.el.querySelector('[data-toggle]');
  if (tg) tg.onclick = async () => { try { await api(`/api/admin/users/${u.id}`, { method: 'PUT', body: { disabled: !u.disabled } }); m.close(); done(); } catch (ex) { err(ex); } };
  const del = m.el.querySelector('[data-del]');
  if (del) del.onclick = async () => {
    if (!await confirmBox(`Delete ${u.display_name} and ALL their progress, notes and chats?`, 'Delete forever')) return;
    try { await api(`/api/admin/users/${u.id}`, { method: 'DELETE' }); m.close(); done(); } catch (ex) { err(ex); }
  };
}

// ---------- one user's tracker ----------
async function userDetail(host, id) {
  const d = await api(`/api/admin/users/${id}`);
  const u = d.user;
  const lv = {};
  for (const p of d.progress) (lv[p.unit_id] ||= {})[p.level] = p.best;
  const passedCount = (uid) => ['easy', 'medium', 'hard'].filter((l) => (lv[uid]?.[l] || 0) >= 80).length;
  const days = [];
  for (let n = 59; n >= 0; n--) {
    const dt = new Date(); dt.setDate(dt.getDate() - n);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const a = d.activity.find((x) => x.day === key);
    days.push({ key, xp: a?.xp || 0, answered: a?.answered || 0 });
  }
  const acc = d.activity.reduce((s, a) => s + a.answered, 0);
  const cor = d.activity.reduce((s, a) => s + a.correct, 0);
  host.innerHTML = `
    <div class="crumbs"><a href="#/admin/users">Users</a> › ${esc(u.display_name)}</div>
    <div class="row between wrap"><h2>${esc(u.display_name)} <span class="muted small">@${esc(u.username)}</span> ${u.role === 'admin' ? '<span class="tag">admin</span>' : ''} ${u.disabled ? '<span class="tag bad">turned off</span>' : ''}</h2>
      <button class="btn" data-edit>Edit user</button></div>
    <div class="a-stats">
      ${stat('Last seen', ago(u.last_seen), u.last_seen ? when(u.last_seen) : '')}
      ${stat('Now on', u.resume ? `<a href="${esc(u.resume.route)}">${esc(u.resume.title || '—')}</a>` : '—', u.resume ? ago(u.resume.at) : '')}
      ${stat('Joined', new Date(u.created_at).toLocaleDateString())}
      ${stat('Accuracy (60 days)', acc ? Math.round((cor / acc) * 100) + '%' : '—', `${num(acc)} answers`)}
      ${stat('AI today', `${num(d.usageToday.prompt + d.usageToday.completion)} tok`, money(d.usageToday.cost))}
      ${stat('AI all time', `${num(d.usage.prompt + d.usage.completion)} tok`, `${money(d.usage.cost)} · ${num(d.usage.calls)} calls`)}
    </div>
    <div class="grid cards-2">
      <div class="card"><h3>Course map</h3><p class="muted small">Each square is a unit: darker = more levels passed (Easy / Medium / Hard).</p>
        <div class="a-map">${Array.from({ length: 115 }, (_, i) => i + 1).map((n) => `<span class="p${passedCount(n)}" title="Unit ${n}: ${esc(unitMeta(n)?.title || '')} — ${passedCount(n)}/3">${n}</span>`).join('')}</div></div>
      <div class="card"><h3>Activity (60 days)</h3>${bars(days.map((x) => ({ day: x.key, answered: x.answered })), 'answered', { color: 'var(--ok)', label: (x) => x.day.slice(8) })}
        <p class="muted small">Memory reviews: ${d.memory.map((m) => `${m.kind}: ${m.n} (${m.due || 0} due)`).join(' · ') || 'none yet'} · Mistakes to review: ${d.mistakes} · Notes: ${d.notes}</p></div>
    </div>
    <div class="grid cards-2">
      <div class="card"><h3>Recent tests</h3><div class="table-wrap"><table><tbody>
        ${d.attempts.map((a) => { const p = Math.round((a.score / a.total) * 100); return `<tr><td class="small">${when(a.created_at)}</td><td>${esc(a.title || a.kind)}</td><td><span class="score-pill ${p >= 80 ? 'ok' : p >= 50 ? 'mid' : 'low'}">${a.score}/${a.total}</span></td></tr>`; }).join('') || '<tr><td class="muted">No tests yet.</td></tr>'}
      </tbody></table></div></div>
      <div class="card"><h3>AI conversations</h3><div class="table-wrap"><table><tbody>
        ${d.threads.map((t) => `<tr><td><button class="link" data-thread="${t.id}">${esc(t.title)}</button><div class="muted small">${t.scope === 'general' ? 'General' : 'Unit ' + t.scope.slice(5)} · ${t.n} msgs</div></td><td class="small">${when(t.updated_at)}</td></tr>`).join('') || '<tr><td class="muted">No chats.</td></tr>'}
      </tbody></table></div>
      <a class="btn small" href="#/admin/usage" data-usage>See this user's AI usage →</a></div>
    </div>`;
  $('[data-edit]', host).onclick = () => editUserDialog(u, () => userDetail(host, id));
  $('[data-usage]', host).onclick = () => { sessionStorage.setItem('adminUsageUser', id); };
  $$('[data-thread]', host).forEach((b) => { b.onclick = () => showThread(b.dataset.thread); });
}

// ---------- live tracker ----------
async function live(host) {
  const draw = async () => {
    const list = await api('/api/admin/users');
    const sorted = [...list].sort((a, b) => (b.last_seen || 0) - (a.last_seen || 0));
    host.innerHTML = `<p class="muted small">Updates every 15 seconds. 🟢 = active in the last 3 minutes.</p>
      <div class="live-grid">${sorted.map((u) => `<a class="card live-card ${u.online ? 'on' : ''} ${u.disabled ? 'off' : ''}" href="#/admin/user/${u.id}">
        <div class="row between"><b>${u.online ? '<span class="dot-on"></span>' : ''}${esc(u.display_name)}</b><span class="muted small">${ago(u.last_seen)}</span></div>
        <div class="small">${u.resume ? `📍 ${esc(u.resume.title || u.resume.route)}` : '<span class="muted">No activity yet</span>'}</div>
        <div class="muted small">🔥 ${u.streak} · ${u.mastered} mastered · ${num(u.answered)} answers · AI ${num(u.aiTokensToday)} tok today</div></a>`).join('')}</div>`;
  };
  await draw();
  liveTimer = setInterval(() => { if (document.body.contains(host)) draw(); else clearInterval(liveTimer); }, 15000);
}

// ---------- AI usage log ----------
async function usage(host) {
  const people = await api('/api/admin/users');
  const pre = sessionStorage.getItem('adminUsageUser') || '';
  sessionStorage.removeItem('adminUsageUser');
  host.innerHTML = `<div class="row wrap gap">
      <select data-user><option value="">All users</option>${people.map((u) => `<option value="${u.id}" ${String(u.id) === pre ? 'selected' : ''}>${esc(u.display_name)} (@${esc(u.username)})</option>`).join('')}</select>
      <select data-kind><option value="">All features</option>${KINDS.map((k) => `<option>${k}</option>`).join('')}</select>
      <label class="small row gap"><input type="checkbox" data-err> Errors only</label>
      <span class="grow"></span><button class="btn small" data-csv>⬇️ Export CSV</button></div>
    <div class="usage-box"></div>`;
  let rows = [];
  const load = async () => {
    const qs = new URLSearchParams();
    if ($('[data-user]', host).value) qs.set('user', $('[data-user]', host).value);
    if ($('[data-kind]', host).value) qs.set('kind', $('[data-kind]', host).value);
    if ($('[data-err]', host).checked) qs.set('errors', '1');
    qs.set('limit', '500');
    rows = await api(`/api/admin/ai-usage?${qs}`);
    const tot = rows.reduce((t, r) => ({ p: t.p + r.prompt_tokens, c: t.c + r.completion_tokens, r: t.r + r.reasoning_tokens, cost: t.cost + r.cost }), { p: 0, c: 0, r: 0, cost: 0 });
    $('.usage-box', host).innerHTML = `<p class="muted small">Showing the latest ${rows.length} calls. Total: ${num(tot.p)} input + ${num(tot.c)} output tokens (${num(tot.r)} reasoning) = <b>${money(tot.cost)}</b>.
      “provider” cost comes from the API (OpenRouter); “price-table” uses your prices in Settings; “~” means tokens were estimated.</p>
      <div class="table-wrap"><table class="usage-table"><thead><tr><th>Time</th><th>User</th><th>Feature</th><th>Model</th><th>Input</th><th>Output</th><th>Reasoning</th><th>Cost</th><th>Time</th><th>Status</th></tr></thead><tbody>
      ${rows.map((r) => `<tr class="${r.ok ? '' : 'err'}"><td class="small">${when(r.created_at)}</td><td>${r.user_id ? `<a href="#/admin/user/${r.user_id}">${esc(r.username || '?')}</a>` : '—'}</td>
        <td>${esc(r.kind)}${r.thread_id ? ` <button class="link small" data-thread="${r.thread_id}">chat</button>` : ''}</td><td class="small">${esc(r.model)}<div class="muted">${esc(r.provider)}</div></td>
        <td>${r.estimated ? '~' : ''}${num(r.prompt_tokens)}</td><td>${r.estimated ? '~' : ''}${num(r.completion_tokens)}</td><td>${num(r.reasoning_tokens)}</td>
        <td>${money(r.cost)}<div class="muted small">${esc(r.cost_source)}</div></td><td>${(r.ms / 1000).toFixed(1)}s</td>
        <td>${r.ok ? '✅' : `❌ <span class="small">${esc(r.error)}</span>`}</td></tr>`).join('') || '<tr><td colspan="10" class="muted">No AI calls.</td></tr>'}
      </tbody></table></div>`;
    $$('[data-thread]', host).forEach((b) => { b.onclick = () => showThread(b.dataset.thread); });
  };
  host.querySelectorAll('select, input').forEach((x) => { x.onchange = load; });
  $('[data-csv]', host).onclick = () => {
    const head = ['time', 'user', 'kind', 'model', 'provider', 'prompt_tokens', 'completion_tokens', 'reasoning_tokens', 'cost_usd', 'cost_source', 'estimated', 'ms', 'ok', 'error'];
    const csv = [head.join(','), ...rows.map((r) => [new Date(r.created_at).toISOString(), r.username, r.kind, r.model, r.provider, r.prompt_tokens, r.completion_tokens, r.reasoning_tokens, r.cost, r.cost_source, r.estimated, r.ms, r.ok, r.error]
      .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `ai-usage-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };
  await load();
}

// ---------- conversations ----------
async function chats(host) {
  const people = await api('/api/admin/users');
  host.innerHTML = `<div class="row gap wrap"><select data-user><option value="">All users</option>${people.map((u) => `<option value="${u.id}">${esc(u.display_name)} (@${esc(u.username)})</option>`).join('')}</select>
    <span class="muted small">Every AI conversation of every learner, with its token use and cost.</span></div><div class="chat-box"></div>`;
  const load = async () => {
    const u = $('[data-user]', host).value;
    const list = await api(`/api/admin/threads${u ? `?user=${u}` : ''}`);
    $('.chat-box', host).innerHTML = `<div class="table-wrap"><table><thead><tr><th>Updated</th><th>User</th><th>Chat</th><th>Mode</th><th>Messages</th><th>Tokens</th><th>Cost</th></tr></thead><tbody>
      ${list.map((t) => `<tr><td class="small">${when(t.updated_at)}</td><td><a href="#/admin/user/${t.user_id}">${esc(t.display_name)}</a></td>
        <td><button class="link" data-thread="${t.id}">${esc(t.title)}</button></td><td>${t.scope === 'general' ? '🌍 General' : `🎯 Unit ${t.scope.slice(5)}`}</td>
        <td>${t.n}</td><td>${num(t.tokens)}</td><td>${money(t.cost)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No conversations yet.</td></tr>'}
      </tbody></table></div>`;
    $$('[data-thread]', host).forEach((b) => { b.onclick = () => showThread(b.dataset.thread); });
  };
  $('[data-user]', host).onchange = load;
  await load();
}

async function showThread(id) {
  const t = await api(`/api/admin/threads/${id}`);
  modal(`<h3>💬 ${esc(t.thread.title)}</h3><p class="muted small">@${esc(t.thread.username)} · ${t.thread.scope === 'general' ? 'General' : 'Unit ' + t.thread.scope.slice(5)} · started ${when(t.thread.created_at)}</p>
    <div class="a-thread">${t.messages.map((m) => m.role === 'user'
    ? `<div class="msg user"><div class="bubble">${esc(m.content).replace(/\n/g, '<br>')}</div></div>`
    : `<div class="msg ai">${m.reasoning ? `<details class="thinking"><summary>💭 Thinking</summary><div>${esc(m.reasoning)}</div></details>` : ''}<div class="bubble md">${md(m.content, { examples: false })}</div></div>`).join('')}</div>`, { wide: true });
}

// ---------- settings ----------
async function settings(host) {
  const s = await api('/api/admin/settings');
  const prices = Object.entries(s.prices).sort(([a], [b]) => a.localeCompare(b));
  host.innerHTML = `
    <div class="grid cards-2">
      <form class="card form" data-reg>
        <h2>👥 Accounts</h2>
        <label>Who can create accounts?
          <select name="registration"><option value="closed" ${s.registration === 'closed' ? 'selected' : ''}>Only admins (recommended)</option><option value="open" ${s.registration === 'open' ? 'selected' : ''}>Anyone can sign up</option></select></label>
        <label>Default daily AI token limit per learner <span class="muted small">(0 = no limit; a user's own limit wins)</span>
          <input name="defaultDailyTokens" type="number" min="0" step="1000" value="${s.defaultDailyTokens}"></label>
        <label class="check"><input type="checkbox" name="allowUserAi" ${s.allowUserAi ? 'checked' : ''}> Learners may use their own AI key / model (their own key has no limit)</label>
        <button class="btn primary">Save</button>
      </form>
      <form class="card form" data-ai>
        <h2>🤖 Shared AI provider</h2>
        <p class="muted small">Used by every learner. Now: <code>${esc(s.effective.baseUrl)}</code> · <code>${esc(s.effective.model)}</code> · key ${s.effective.keySet ? '✅ set' : '❌ missing'}. Empty fields use the .env values.</p>
        <label>Base URL<input name="aiBaseUrl" value="${esc(s.aiBaseUrl)}" placeholder="${esc(s.envDefaults.baseUrl)}"></label>
        <label>API key ${s.aiKeySet ? `<span class="muted small">(saved ${esc(s.aiKeyHint)} — leave empty to keep)</span>` : ''}<input name="aiApiKey" type="password" autocomplete="off" placeholder="sk-or-v1-…"></label>
        <label>Model<input name="aiModel" value="${esc(s.aiModel)}" placeholder="${esc(s.envDefaults.model)}" list="admin-models">
          <datalist id="admin-models"><option value="qwen/qwen3.8-omni-flash"><option value="openai/gpt-4o-mini"><option value="google/gemini-2.5-flash"></datalist></label>
        <div class="row gap wrap"><button class="btn primary">Save</button><button type="button" class="btn" data-test>Test</button>${s.aiKeySet ? '<button type="button" class="btn ghost" data-clearkey>Remove key</button>' : ''}</div>
        <div class="muted small" data-out></div>
      </form>
    </div>
    <div class="card">
      <div class="row between wrap"><h2>💲 Prices (USD per 1 million tokens)</h2>
        <div class="row gap"><button class="btn" data-fetch>⬇️ Get prices from OpenRouter</button><button class="btn" data-add>＋ Add model</button></div></div>
      <p class="muted small">OpenRouter already reports the exact cost of each call, so these prices are only used for other providers (or calls without a reported cost).</p>
      <div class="table-wrap"><table class="price-table"><thead><tr><th>Model</th><th>Input $/1M</th><th>Output $/1M</th><th></th></tr></thead><tbody>
        ${prices.map(([m, p]) => priceRow(m, p)).join('')}
      </tbody></table></div>
      <button class="btn primary" data-saveprices>Save prices</button>
    </div>`;
  const put = async (body, msg = 'Saved') => { const r = await api('/api/admin/settings', { method: 'PUT', body }); toast(msg, 'ok'); return r; };
  const reg = $('[data-reg]', host);
  reg.onsubmit = async (e) => { e.preventDefault(); await put({ registration: reg.registration.value, defaultDailyTokens: Number(reg.defaultDailyTokens.value) || 0, allowUserAi: reg.allowUserAi.checked }); };
  const aif = $('[data-ai]', host);
  aif.onsubmit = async (e) => {
    e.preventDefault();
    const body = { aiBaseUrl: aif.aiBaseUrl.value, aiModel: aif.aiModel.value };
    if (aif.aiApiKey.value) body.aiApiKey = aif.aiApiKey.value;
    try { await put(body, 'AI provider saved'); store.me = await api('/api/me'); settings(host); } catch (ex) { toast(ex.message, 'error'); }
  };
  $('[data-test]', host).onclick = async () => {
    const out = $('[data-out]', host);
    out.textContent = 'Testing… (save first if you changed something)';
    try { const r = await api('/api/admin/test-ai', { method: 'POST', body: {} }); out.innerHTML = `✅ ${esc(r.model)} replied “${esc(r.reply)}” in ${r.ms} ms.`; }
    catch (ex) { out.innerHTML = `❌ ${esc(ex.message)}`; }
  };
  const ck = $('[data-clearkey]', host);
  if (ck) ck.onclick = async () => { await put({ aiApiKey: '' }, 'Key removed'); settings(host); };
  const tbody = $('.price-table tbody', host);
  $('[data-add]', host).onclick = () => { tbody.insertAdjacentHTML('beforeend', priceRow('', { in: 0, out: 0 })); bindRows(); };
  const bindRows = () => $$('[data-delrow]', host).forEach((b) => { b.onclick = () => b.closest('tr').remove(); });
  bindRows();
  $('[data-saveprices]', host).onclick = async () => {
    const out = {};
    $$('.price-table tbody tr', host).forEach((tr) => {
      const [m, i, o] = $$('input', tr).map((x) => x.value.trim());
      if (m) out[m] = { in: Number(i) || 0, out: Number(o) || 0 };
    });
    await put({ prices: out }, 'Prices saved');
  };
  $('[data-fetch]', host).onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try { const r = await api('/api/admin/prices/fetch', { method: 'POST', body: {} }); toast(`Updated ${r.updated} model price(s) from OpenRouter`, 'ok'); settings(host); }
    catch (ex) { toast(ex.message, 'error', 5000); btn.disabled = false; }
  };
}
const priceRow = (m, p) => `<tr><td><input value="${esc(m)}" placeholder="provider/model"></td><td><input type="number" step="0.0001" min="0" value="${p.in}"></td><td><input type="number" step="0.0001" min="0" value="${p.out}"></td><td><button type="button" class="icon-btn small" data-delrow>🗑️</button></td></tr>`;
