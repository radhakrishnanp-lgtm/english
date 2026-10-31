// AI Tutor drawer: unit-focused and general modes, multiple chats (threads), memory,
// streaming answers with optional "thinking", quick actions, AI quizzes and live voice conversation.
import { md, esc } from './md.js';
import { api, store, toast, speak, speakAsync, listen, canListen, modal, unitMeta, fmtDate, $ } from './core.js';
import { runQuiz } from './quiz.js';

const UNIT_ACTIONS = [
  ['🧒 Explain simply', 'Explain this unit to me very simply, step by step, with easy examples.'],
  ['➕ 5 more examples', 'Give me 5 new example sentences for this grammar point, with a short note on each.'],
  ['🎯 Quiz me', 'Quiz me on this unit. Ask one question at a time and wait for my answer.'],
  ['✍️ Check my sentence', 'Please check my sentence: '],
  ['🌐 In my language', 'Explain the main rule of this unit in my first language, then give 3 English examples with translations.'],
  ['⚠️ Common mistakes', 'What are the most common mistakes learners make with this grammar? Show ❌ and ✅ examples.'],
  ['💬 Real-life dialogue', 'Write a short real-life dialogue (6-8 lines) that uses this grammar a lot. Bold the grammar.'],
  ['🗒️ Summary notes', 'Make short revision notes for this unit: the rule, a mini table, 3 examples, and 1 memory tip.'],
  ['🤔 When do I use it?', 'When exactly do I use this grammar, and when do I NOT use it? Compare with similar grammar.'],
  ['🔁 Continue where we stopped', 'Remind me what we practised last time in this unit and continue from there.'],
];
const GENERAL_ACTIONS = [
  ['✍️ Correct my English', 'Please correct my English and explain the mistakes: '],
  ['📖 Word meaning', 'What does this word or phrase mean? Give the meaning, 3 example sentences and synonyms: '],
  ['🗣️ How do I say it?', 'How do I pronounce this word? Show the stress and a simple sound guide: '],
  ['📧 Help me write', 'Help me write a short, polite message about: '],
  ['🎭 Role-play', 'Let\'s do a speaking role-play. You are a shop assistant and I am a customer. Start the conversation and keep your lines short.'],
  ['🔁 Translate', 'Translate this into natural English and explain any difficult parts: '],
  ['🌟 Word of the day', 'Teach me one useful English word of the day with meaning, pronunciation tip, and 3 examples. Then ask me to make a sentence.'],
  ['🗺️ What should I study?', 'Based on my weak units, what should I study next and why? Make me a short plan for this week.'],
];

class Tutor {
  constructor() {
    this.scope = 'general';
    this.unitId = null;
    this.threadId = null;
    this.open = false;
    this.busy = false;
    this.messages = [];
    this.abort = null;
    this.voice = null;
  }

  ensure() {
    if (this.el) return;
    const el = document.createElement('aside');
    el.className = 'tutor';
    el.setAttribute('aria-label', 'AI tutor');
    el.innerHTML = `
      <div class="tutor-head">
        <div class="tutor-title">🤖 AI Tutor</div>
        <div class="seg" role="tablist">
          <button data-mode="unit">This unit</button>
          <button data-mode="general">General</button>
        </div>
        <button class="icon-btn" data-close title="Close (Esc)" aria-label="Close">✕</button>
      </div>
      <div class="tutor-bar">
        <button class="chip small" data-threads title="All chats in this mode">🗂️ <span data-thread-title>New chat</span> ▾</button>
        <button class="chip small" data-new title="Start a new chat">＋ New</button>
        ${canListen ? '<button class="chip small" data-voice title="Talk with the AI by voice">🎙️ Live talk</button>' : ''}
        <button class="chip small" data-menu title="Memory and settings">⋯</button>
      </div>
      <div class="tutor-scope"></div>
      <div class="tutor-msgs" aria-live="polite"></div>
      <div class="tutor-actions"></div>
      <form class="tutor-input">
        <textarea rows="1" placeholder="Ask your doubt…  (Enter to send)" aria-label="Message"></textarea>
        ${canListen ? '<button type="button" class="icon-btn" data-mic title="Speak your message" aria-label="Speak">🎤</button>' : ''}
        <button class="btn primary" data-send>Send</button>
      </form>`;
    document.body.append(el);
    this.el = el;
    el.querySelector('[data-close]').onclick = () => this.hide();
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.hide(); });
    el.querySelectorAll('[data-mode]').forEach((b) => {
      b.onclick = () => {
        if (b.dataset.mode === 'unit' && !this.unitId) { toast('Open a unit first to use unit mode.', 'warn'); return; }
        this.setScope(b.dataset.mode === 'unit' ? `unit:${this.unitId}` : 'general');
      };
    });
    el.querySelector('[data-new]').onclick = () => this.newThread();
    el.querySelector('[data-threads]').onclick = () => this.threadPicker();
    el.querySelector('[data-menu]').onclick = () => this.menu();
    const vb = el.querySelector('[data-voice]');
    if (vb) vb.onclick = () => this.startVoice();
    const ta = el.querySelector('textarea');
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); } });
    el.querySelector('form').onsubmit = (e) => { e.preventDefault(); if (this.busy) this.abort?.abort(); else this.send(); };
    const mic = el.querySelector('[data-mic]');
    if (mic) mic.onclick = async () => {
      mic.classList.add('rec');
      try { const [t] = await listen(); if (t) { ta.value = (ta.value ? ta.value + ' ' : '') + t; ta.focus(); } }
      catch (err) { toast(err.message, 'error'); }
      mic.classList.remove('rec');
    };
  }

  setUnit(id) {
    this.unitId = id ? Number(id) : null;
    if (this.open && this.unitId && this.scope.startsWith('unit:') && this.scope !== `unit:${this.unitId}`) this.setScope(`unit:${this.unitId}`);
    this.updateHead();
  }

  show(scope, message) {
    this.ensure();
    this.open = true;
    this.el.classList.add('open');
    document.body.classList.add('tutor-open');
    const want = scope || (this.unitId ? `unit:${this.unitId}` : 'general');
    const p = want !== this.scope || !this.loaded ? this.setScope(want) : Promise.resolve();
    p.then(() => {
      const ta = this.el.querySelector('textarea');
      if (message) {
        ta.value = message;
        if (!message.endsWith(': ')) this.send(); else ta.focus();
      } else ta.focus();
    });
  }
  hide() {
    this.open = false;
    this.abort?.abort();
    this.stopVoice();
    this.el?.classList.remove('open');
    document.body.classList.remove('tutor-open');
  }
  toggle() { if (this.open) this.hide(); else this.show(); }

  updateHead() {
    if (!this.el) return;
    const unitMode = this.scope.startsWith('unit:');
    this.el.querySelector('[data-mode="unit"]').classList.toggle('on', unitMode);
    this.el.querySelector('[data-mode="general"]').classList.toggle('on', !unitMode);
    this.el.querySelector('[data-mode="unit"]').disabled = !this.unitId && !unitMode;
    const sc = this.el.querySelector('.tutor-scope');
    if (unitMode) {
      const u = unitMeta(this.scope.slice(5));
      sc.innerHTML = `🎯 Focused on <strong>Unit ${u.id}: ${esc(u.title)}</strong> — I only answer about this unit. <button class="link" data-aiquiz>✨ AI quiz</button>`;
      sc.querySelector('[data-aiquiz]').onclick = () => aiQuizDialog(u.id);
    } else {
      sc.innerHTML = '🌍 General mode: ask anything about English — words, writing, speaking, any grammar.';
    }
    const acts = unitMode ? UNIT_ACTIONS : GENERAL_ACTIONS;
    const box = this.el.querySelector('.tutor-actions');
    box.innerHTML = acts.map(([l], n) => `<button class="chip small" data-a="${n}">${esc(l)}</button>`).join('');
    box.querySelectorAll('[data-a]').forEach((b) => {
      b.onclick = () => {
        const msg = acts[Number(b.dataset.a)][1];
        const ta = this.el.querySelector('textarea');
        ta.value = msg;
        if (msg.endsWith(': ')) { ta.focus(); ta.setSelectionRange(msg.length, msg.length); } else this.send();
      };
    });
    const t = this.threads?.find((x) => x.id === this.threadId);
    this.el.querySelector('[data-thread-title]').textContent = t ? t.title.slice(0, 28) : 'New chat';
  }

  /** Switch mode. Opens the most recent chat of that mode so the conversation continues. */
  async setScope(scope) {
    this.ensure();
    this.abort?.abort();
    this.scope = scope;
    this.loaded = true;
    this.threadId = null;
    this.messages = [];
    try {
      this.threads = await api(`/api/threads?scope=${encodeURIComponent(scope)}`);
      if (this.threads.length) { await this.openThread(this.threads[0].id); return; }
    } catch (e) { toast(e.message, 'error'); }
    this.updateHead();
    this.renderMsgs();
  }

  async openThread(id) {
    const r = await api(`/api/threads/${id}`);
    this.threadId = r.thread.id;
    this.messages = r.messages;
    this.updateHead();
    this.renderMsgs();
  }

  newThread() {
    this.abort?.abort();
    this.threadId = null;
    this.messages = [];
    this.updateHead();
    this.renderMsgs();
    this.el.querySelector('textarea').focus();
  }

  async threadPicker() {
    this.threads = await api(`/api/threads?scope=${encodeURIComponent(this.scope)}`);
    const m = modal(`<h3>🗂️ Chats — ${this.scope === 'general' ? 'General' : `Unit ${this.scope.slice(5)}`}</h3>
      <p class="muted small">Pick a chat to continue it, or start a new one. The tutor also keeps a short memory across chats.</p>
      <button class="btn primary small" data-new>＋ New chat</button>
      <div class="thread-list">${this.threads.map((t) => `<div class="thread-row ${t.id === this.threadId ? 'on' : ''}">
        <button class="link grow" data-open="${t.id}">${esc(t.title)}</button>
        <span class="muted small">${t.n} msgs · ${fmtDate(t.updated_at)}</span>
        <button class="icon-btn small" data-ren="${t.id}" title="Rename">✏️</button>
        <button class="icon-btn small" data-del="${t.id}" title="Delete">🗑️</button></div>`).join('') || '<p class="muted">No chats yet.</p>'}</div>`);
    m.el.querySelector('[data-new]').onclick = () => { m.close(); this.newThread(); };
    m.el.querySelectorAll('[data-open]').forEach((b) => { b.onclick = async () => { m.close(); await this.openThread(Number(b.dataset.open)); }; });
    m.el.querySelectorAll('[data-ren]').forEach((b) => {
      b.onclick = async () => {
        const t = this.threads.find((x) => x.id === Number(b.dataset.ren));
        const title = prompt('Chat name:', t.title);
        if (!title) return;
        await api(`/api/threads/${t.id}`, { method: 'PUT', body: { title } });
        m.close(); this.threadPicker(); this.threads = await api(`/api/threads?scope=${encodeURIComponent(this.scope)}`); this.updateHead();
      };
    });
    m.el.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        await api(`/api/threads/${b.dataset.del}`, { method: 'DELETE' });
        if (Number(b.dataset.del) === this.threadId) this.newThread();
        m.close(); this.threadPicker();
      };
    });
  }

  renderMsgs() {
    const box = this.el.querySelector('.tutor-msgs');
    if (!this.messages.length) {
      const ai = store.me?.ai;
      const ready = ai?.configured || store.me?.settings?.aiKeySet || store.me?.settings?.aiBaseUrl;
      box.innerHTML = `<div class="tutor-empty">
        <div class="big-emoji">👋</div>
        <p>Hi ${esc(store.me?.user.displayName || '')}! I'm your AI tutor.</p>
        <p class="muted small">${this.scope.startsWith('unit:') ? 'Ask me any doubt about this unit, tap a quick action, or try 🎙️ Live talk.' : 'Ask me anything about English.'}</p>
        <p class="muted small">🧠 I remember useful things from our earlier chats (you can edit this in ⋯ → Memory).</p>
        ${ready ? '' : '<p class="warn-box small">AI is not set up yet. Go to <a href="#/settings">Settings → AI Tutor</a> and add an API key (OpenRouter, OpenAI, or any OpenAI-compatible provider).</p>'}
      </div>`;
      return;
    }
    box.innerHTML = this.messages.map((m, n) => this.msgHtml(m, n)).join('');
    this.bindMsgTools(box);
    box.scrollTop = box.scrollHeight;
  }

  msgHtml(m, n) {
    if (m.role === 'user') return `<div class="msg user"><div class="bubble">${esc(m.content).replace(/\n/g, '<br>')}</div></div>`;
    return `<div class="msg ai" data-n="${n}">
      ${m.reasoning ? `<details class="thinking"><summary>💭 Thinking</summary><div>${esc(m.reasoning).replace(/\n/g, '<br>')}</div></details>` : ''}
      <div class="bubble md">${md(m.content, { examples: false })}</div>
      <div class="msg-tools">
        <button class="icon-btn small" data-t="speak" title="Listen">🔊</button>
        <button class="icon-btn small" data-t="copy" title="Copy">📋</button>
        <button class="icon-btn small" data-t="save" title="Save">☆</button>
        <button class="icon-btn small" data-t="note" title="Add to my notes">🗒️</button>
      </div></div>`;
  }

  bindMsgTools(box) {
    box.querySelectorAll('.msg.ai').forEach((el) => {
      const m = this.messages[Number(el.dataset.n)];
      if (!m) return;
      el.querySelectorAll('[data-t]').forEach((b) => {
        b.onclick = async () => {
          const plain = m.content.replace(/[*#`>|_~]/g, '').replace(/[✅❌]/g, '');
          const unitId = this.scope.startsWith('unit:') ? Number(this.scope.slice(5)) : null;
          if (b.dataset.t === 'speak') speak(plain);
          if (b.dataset.t === 'copy') { await navigator.clipboard?.writeText(m.content); toast('Copied'); }
          if (b.dataset.t === 'save') { await api('/api/saved', { method: 'POST', body: { kind: 'ai', text: m.content, unitId } }); b.textContent = '★'; toast('Saved to My Space'); }
          if (b.dataset.t === 'note') { await api('/api/notes', { method: 'POST', body: { unitId, title: 'From AI Tutor', body: m.content, color: 'purple' } }); toast('Added to your notes'); }
        };
      });
    });
  }

  /** Send a message and stream the answer. Returns the final text. */
  async send(textArg, { voice = false } = {}) {
    const ta = this.el.querySelector('textarea');
    const text = (textArg ?? ta.value).trim();
    if (!text || this.busy) return '';
    if (textArg === undefined) { ta.value = ''; ta.style.height = 'auto'; }
    this.messages.push({ role: 'user', content: text });
    const ai = { role: 'assistant', content: '', reasoning: '' };
    this.messages.push(ai);
    this.renderMsgs();
    const box = this.el.querySelector('.tutor-msgs');
    const node = box.lastElementChild;
    const bubble = node.querySelector('.bubble');
    bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    this.setBusy(true);
    const ac = new AbortController();
    this.abort = ac;
    const scope = this.scope;
    try {
      const r = await fetch('/api/ai/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ac.signal,
        body: JSON.stringify({ scope, threadId: this.threadId, message: text, voice }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `AI error (${r.status})`); }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let pending = false;
      let think = null;
      const paint = () => {
        pending = false;
        if (ai.reasoning) {
          if (!think) {
            think = document.createElement('details');
            think.className = 'thinking';
            think.open = !ai.content;
            think.innerHTML = '<summary>💭 Thinking…</summary><div></div>';
            node.insertBefore(think, bubble);
          }
          think.lastElementChild.textContent = ai.reasoning;
          if (ai.content) { think.open = false; think.firstElementChild.textContent = '💭 Thinking'; }
        }
        if (ai.content) bubble.innerHTML = md(ai.content, { examples: false });
        box.scrollTop = box.scrollHeight;
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let k;
        while ((k = buf.indexOf('\n\n')) !== -1) {
          const raw = buf.slice(0, k).replace(/^data: /, '');
          buf = buf.slice(k + 2);
          let j;
          try { j = JSON.parse(raw); } catch { continue; }
          if (j.error) throw new Error(j.error);
          if (j.threadId && !this.threadId && this.scope === scope) this.threadId = j.threadId;
          if (j.title) {
            const t = this.threads?.find((x) => x.id === j.threadId);
            if (t) t.title = j.title; else (this.threads ||= []).unshift({ id: j.threadId, title: j.title, n: 2, updated_at: Date.now() });
            this.updateHead();
          }
          if (j.r) ai.reasoning += j.r;
          if (j.t) ai.content += j.t;
          if ((j.r || j.t) && !pending) { pending = true; requestAnimationFrame(paint); }
        }
      }
      if (!ai.content) ai.content = '_(no answer — try again or check the model in Settings)_';
    } catch (e) {
      if (e.name === 'AbortError') ai.content += ai.content ? '\n\n_(stopped)_' : '_(stopped)_';
      else ai.content = `⚠️ ${e.message}`;
    } finally {
      this.setBusy(false);
      if (this.scope === scope) this.renderMsgs();
    }
    return ai.content;
  }

  setBusy(b) {
    this.busy = b;
    const btn = this.el.querySelector('[data-send]');
    btn.textContent = b ? 'Stop' : 'Send';
    btn.classList.toggle('danger', b);
  }

  async menu() {
    const mem = await api('/api/memory').catch(() => []);
    const s = store.me.settings;
    const m = modal(`<h3>🧠 AI memory</h3>
      <p class="muted small">Short notes the tutor keeps about you so it can help better next time. One note for general chat and one for each unit. You can edit or clear them.</p>
      <label class="row gap"><input type="checkbox" data-mem-on ${s.aiMemory === false ? '' : 'checked'}> Let the tutor remember things</label>
      <div class="mem-list">${mem.map((x) => `<div class="card mem">
        <div class="row between"><b>${x.scope === 'general' ? '🌍 General' : `🎯 Unit ${x.scope.slice(5)}: ${esc(unitMeta(x.scope.slice(5))?.title || '')}`}</b><span class="muted small">${fmtDate(x.updated_at)}</span></div>
        <textarea data-scope="${x.scope}" rows="4">${esc(x.text)}</textarea>
        <div class="row gap"><button class="btn small" data-save="${x.scope}">Save</button><button class="btn ghost small" data-clear="${x.scope}">Clear</button></div></div>`).join('') || '<p class="muted">Nothing remembered yet. Chat a little and I will start taking notes.</p>'}</div>
      <div class="row gap wrap"><a class="btn ghost small" href="#/ai" data-go>🗂️ All chats</a><a class="btn ghost small" href="#/settings" data-go>⚙️ AI settings</a></div>`, { wide: true });
    m.el.querySelector('[data-mem-on]').onchange = async (e) => {
      const r = await api('/api/settings', { method: 'PUT', body: { aiMemory: e.target.checked } });
      store.me.settings = r.settings;
      toast(e.target.checked ? 'Memory on' : 'Memory off');
    };
    m.el.querySelectorAll('[data-save]').forEach((b) => {
      b.onclick = async () => {
        await api('/api/memory', { method: 'PUT', body: { scope: b.dataset.save, text: m.el.querySelector(`textarea[data-scope="${b.dataset.save}"]`).value } });
        toast('Memory saved', 'ok');
      };
    });
    m.el.querySelectorAll('[data-clear]').forEach((b) => {
      b.onclick = async () => { await api('/api/memory', { method: 'PUT', body: { scope: b.dataset.clear, text: '' } }); b.closest('.mem').remove(); };
    });
    m.el.querySelectorAll('[data-go]').forEach((a) => { a.onclick = () => m.close(); });
  }

  // ---------- live voice conversation ----------
  startVoice() {
    if (this.voice) return;
    const ov = document.createElement('div');
    ov.className = 'voice-ov';
    const unitMode = this.scope.startsWith('unit:');
    ov.innerHTML = `
      <div class="voice-top"><b>🎙️ Live talk</b> <span class="muted small">${unitMode ? `Unit ${this.scope.slice(5)} practice` : 'General conversation'}</span>
        <button class="icon-btn" data-x aria-label="Stop">✕</button></div>
      <div class="voice-orb"><span></span></div>
      <div class="voice-status">Tap the mic and start talking.</div>
      <div class="voice-log"></div>
      <div class="row center gap">
        <button class="btn primary lg" data-talk>🎤 Talk</button>
        <label class="small row gap"><input type="checkbox" data-auto checked> Hands-free</label>
      </div>
      <p class="muted small center">The AI answers in short spoken sentences and gently corrects mistakes. Your talk is saved in this chat.</p>`;
    this.el.append(ov);
    const state = { on: true, auto: true };
    this.voice = { ov, state };
    const status = ov.querySelector('.voice-status');
    const orb = ov.querySelector('.voice-orb');
    const log = ov.querySelector('.voice-log');
    const add = (who, text) => { log.insertAdjacentHTML('beforeend', `<div class="vl ${who}"><b>${who === 'me' ? 'You' : 'Tutor'}:</b> ${esc(text)}</div>`); log.scrollTop = log.scrollHeight; };
    const turn = async () => {
      if (!state.on) return;
      orb.className = 'voice-orb listen';
      status.textContent = 'Listening… speak now';
      let heard = '';
      try { [heard] = await listen(); } catch (e) { status.textContent = e.message; orb.className = 'voice-orb'; return; }
      if (!state.on) return;
      if (!heard) { status.textContent = 'I didn\'t hear anything. Tap 🎤 to try again.'; orb.className = 'voice-orb'; return; }
      add('me', heard);
      orb.className = 'voice-orb think';
      status.textContent = 'Thinking…';
      const reply = await this.send(heard, { voice: true });
      if (!state.on) return;
      const plain = reply.replace(/[*#`>|_~]/g, '').replace(/[✅❌]/g, '');
      add('ai', plain);
      orb.className = 'voice-orb speak';
      status.textContent = 'Speaking… (tap ✕ to stop)';
      await speakAsync(plain);
      orb.className = 'voice-orb';
      if (state.on && state.auto) turn(); else status.textContent = 'Tap 🎤 to answer.';
    };
    ov.querySelector('[data-talk]').onclick = () => { speechSynthesis.cancel(); turn(); };
    ov.querySelector('[data-auto]').onchange = (e) => { state.auto = e.target.checked; };
    ov.querySelector('[data-x]').onclick = () => this.stopVoice();
    // Let the tutor start the conversation.
    (async () => {
      orb.className = 'voice-orb think';
      status.textContent = 'Starting…';
      const opener = await this.send(unitMode
        ? 'Let\'s practise this unit by speaking. Start a short friendly conversation that makes me use this grammar. Ask me one simple question.'
        : 'Let\'s have a friendly spoken conversation in English. Ask me one simple question to start.', { voice: true });
      if (!state.on) return;
      const plain = opener.replace(/[*#`>|_~]/g, '');
      add('ai', plain);
      orb.className = 'voice-orb speak';
      status.textContent = 'Speaking…';
      await speakAsync(plain);
      orb.className = 'voice-orb';
      if (state.on && state.auto) turn(); else status.textContent = 'Tap 🎤 to answer.';
    })();
  }

  stopVoice() {
    if (!this.voice) return;
    this.voice.state.on = false;
    speechSynthesis?.cancel();
    this.voice.ov.remove();
    this.voice = null;
  }
}

export const tutor = new Tutor();

window.addEventListener('ask-ai', (e) => tutor.show(e.detail.scope, e.detail.message));

/** Dialog that asks the AI for a fresh interactive quiz on a unit. */
export function aiQuizDialog(unitId, level = 'medium') {
  const u = unitMeta(unitId);
  const m = modal(`
    <h3>✨ AI practice quiz</h3>
    <p class="muted">New questions written by AI for <strong>Unit ${u.id}: ${esc(u.title)}</strong>. Unlimited — every quiz is different.</p>
    <div class="form">
      <label>Level <select data-level>
        ${['easy', 'medium', 'hard'].map((l) => `<option ${l === level ? 'selected' : ''}>${l}</option>`).join('')}
      </select></label>
      <label>Questions <select data-count><option>5</option><option selected>8</option><option>12</option></select></label>
      <label>Extra focus (optional) <input data-focus placeholder="e.g. questions only, negative forms, travel topic"></label>
      <button class="btn primary" data-go>Create quiz</button>
    </div>
    <div class="ai-quiz-box"></div>`, { wide: true });
  m.el.querySelector('[data-go]').onclick = async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Writing questions…';
    const level2 = $('[data-level]', m.el).value;
    try {
      const { questions } = await api('/api/ai/quiz', {
        method: 'POST',
        body: { unitId, level: level2, count: Number($('[data-count]', m.el).value), focus: $('[data-focus]', m.el).value },
      });
      m.el.querySelector('.form').remove();
      runQuiz(m.el.querySelector('.ai-quiz-box'), questions.map((q) => ({ ...q, unit: unitId })), { title: `AI quiz · Unit ${u.id} · ${level2}`, unitId, kind: 'ai' });
    } catch (e) {
      toast(e.message, 'error', 5000);
      btn.disabled = false;
      btn.textContent = 'Create quiz';
    }
  };
}
