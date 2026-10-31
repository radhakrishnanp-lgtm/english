// AI Tutor drawer: unit-focused mode and general mode, streaming answers, quick actions, AI quizzes.
import { md, esc } from './md.js';
import { api, store, toast, speak, listen, canListen, modal, unitMeta, $ } from './core.js';
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
];
const GENERAL_ACTIONS = [
  ['✍️ Correct my English', 'Please correct my English and explain the mistakes: '],
  ['📖 Word meaning', 'What does this word or phrase mean? Give the meaning, 3 example sentences and synonyms: '],
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
    this.open = false;
    this.busy = false;
    this.messages = [];
    this.abort = null;
  }

  ensure() {
    if (this.el) return;
    const el = document.createElement('aside');
    el.className = 'tutor';
    el.innerHTML = `
      <div class="tutor-head">
        <div class="tutor-title">🤖 AI Tutor</div>
        <div class="seg" role="tablist">
          <button data-mode="unit">This unit</button>
          <button data-mode="general">General AI</button>
        </div>
        <button class="icon-btn" data-menu title="More" aria-label="More">⋯</button>
        <button class="icon-btn" data-close title="Close" aria-label="Close">✕</button>
      </div>
      <div class="tutor-scope"></div>
      <div class="tutor-msgs" aria-live="polite"></div>
      <div class="tutor-actions"></div>
      <form class="tutor-input">
        <textarea rows="1" placeholder="Ask your doubt…" aria-label="Message"></textarea>
        ${canListen ? '<button type="button" class="icon-btn" data-mic title="Speak" aria-label="Speak">🎤</button>' : ''}
        <button class="btn primary" data-send>Send</button>
      </form>`;
    document.body.append(el);
    this.el = el;
    el.querySelector('[data-close]').onclick = () => this.hide();
    el.querySelectorAll('[data-mode]').forEach((b) => {
      b.onclick = () => {
        if (b.dataset.mode === 'unit' && !this.unitId) { toast('Open a unit first to use unit mode.', 'warn'); return; }
        this.setScope(b.dataset.mode === 'unit' ? `unit:${this.unitId}` : 'general');
      };
    });
    el.querySelector('[data-menu]').onclick = (e) => this.menu(e.currentTarget);
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
    if (this.open && this.unitId && this.scope !== `unit:${this.unitId}` && this.scope.startsWith('unit:')) this.setScope(`unit:${this.unitId}`);
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
      if (message) {
        const ta = this.el.querySelector('textarea');
        ta.value = message;
        if (!message.endsWith(': ')) this.send(); else ta.focus();
      } else this.el.querySelector('textarea').focus();
    });
  }
  hide() {
    this.open = false;
    this.abort?.abort();
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
      sc.innerHTML = `🎯 Focused on <strong>Unit ${u.id}: ${esc(u.title)}</strong>. I only answer about this unit. <button class="link" data-aiquiz>✨ AI practice quiz</button>`;
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
        if (msg.endsWith(': ')) { ta.value = msg; ta.focus(); ta.setSelectionRange(msg.length, msg.length); }
        else { ta.value = msg; this.send(); }
      };
    });
  }

  async setScope(scope) {
    this.ensure();
    this.abort?.abort();
    this.scope = scope;
    this.loaded = true;
    this.updateHead();
    this.messages = [];
    this.renderMsgs();
    try {
      this.messages = await api(`/api/chat?scope=${encodeURIComponent(scope)}`);
    } catch (e) { toast(e.message, 'error'); }
    this.renderMsgs();
  }

  renderMsgs() {
    const box = this.el.querySelector('.tutor-msgs');
    if (!this.messages.length) {
      const ai = store.me?.ai;
      const ready = ai?.configured || store.me?.settings?.aiKeySet || store.me?.settings?.aiBaseUrl;
      box.innerHTML = `<div class="tutor-empty">
        <div class="big-emoji">👋</div>
        <p>Hi ${esc(store.me?.user.displayName || '')}! I'm your AI tutor.</p>
        <p class="muted small">${this.scope.startsWith('unit:') ? 'Ask me any doubt about this unit, or tap a quick action below.' : 'Ask me anything about English.'}</p>
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
    return `<div class="msg ai" data-n="${n}"><div class="bubble md">${md(m.content, { examples: false })}</div>
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
          if (b.dataset.t === 'speak') speak(plain);
          if (b.dataset.t === 'copy') { await navigator.clipboard?.writeText(m.content); toast('Copied'); }
          const unitId = this.scope.startsWith('unit:') ? Number(this.scope.slice(5)) : null;
          if (b.dataset.t === 'save') {
            await api('/api/saved', { method: 'POST', body: { kind: 'ai', text: m.content, unitId } });
            b.textContent = '★'; toast('Saved to My Space');
          }
          if (b.dataset.t === 'note') {
            await api('/api/notes', { method: 'POST', body: { unitId, title: 'From AI Tutor', body: m.content, color: 'purple' } });
            toast('Added to your notes'); store.emit();
          }
        };
      });
    });
  }

  async send() {
    const ta = this.el.querySelector('textarea');
    const text = ta.value.trim();
    if (!text || this.busy) return;
    ta.value = '';
    ta.style.height = 'auto';
    this.messages.push({ role: 'user', content: text });
    const ai = { role: 'assistant', content: '' };
    this.messages.push(ai);
    this.renderMsgs();
    const box = this.el.querySelector('.tutor-msgs');
    const last = box.lastElementChild.querySelector('.bubble');
    last.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    this.setBusy(true);
    const ac = new AbortController();
    this.abort = ac;
    const scope = this.scope;
    try {
      const r = await fetch('/api/ai/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ac.signal,
        body: JSON.stringify({ scope, message: text }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `AI error (${r.status})`);
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let pending = false;
      const paint = () => { pending = false; last.innerHTML = md(ai.content, { examples: false }); box.scrollTop = box.scrollHeight; };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let k;
        while ((k = buf.indexOf('\n\n')) !== -1) {
          const ev = buf.slice(0, k).replace(/^data: /, '');
          buf = buf.slice(k + 2);
          let j;
          try { j = JSON.parse(ev); } catch { continue; }
          if (j.error) throw new Error(j.error);
          if (j.t) { ai.content += j.t; if (!pending) { pending = true; requestAnimationFrame(paint); } }
        }
      }
      if (!ai.content) ai.content = '_(no answer — try again or check the model in Settings)_';
    } catch (e) {
      if (e.name === 'AbortError') ai.content += ai.content ? '\n\n_(stopped)_' : '_(stopped)_';
      else { ai.content = `⚠️ ${e.message}`; }
    } finally {
      this.setBusy(false);
      if (this.scope === scope) this.renderMsgs();
    }
  }

  setBusy(b) {
    this.busy = b;
    const btn = this.el.querySelector('[data-send]');
    btn.textContent = b ? 'Stop' : 'Send';
    btn.classList.toggle('danger', b);
  }

  menu(anchor) {
    const m = modal(`<h3>AI Tutor</h3>
      <div class="col gap">
        <button class="btn" data-clear>🗑️ Clear this chat</button>
        <a class="btn" href="#/ai" data-go>🗂️ All my chats</a>
        <a class="btn" href="#/settings" data-go>⚙️ AI settings (provider, model, language)</a>
      </div>`);
    void anchor;
    m.el.querySelector('[data-clear]').onclick = async () => {
      await api(`/api/chat?scope=${encodeURIComponent(this.scope)}`, { method: 'DELETE' });
      this.messages = [];
      this.renderMsgs();
      m.close();
    };
    m.el.querySelectorAll('[data-go]').forEach((a) => { a.onclick = () => m.close(); });
  }
}

export const tutor = new Tutor();

window.addEventListener('ask-ai', (e) => tutor.show(e.detail.scope, e.detail.message));

/** Dialog that asks the AI for a fresh interactive quiz on a unit. */
export function aiQuizDialog(unitId, level = 'medium') {
  const u = unitMeta(unitId);
  const m = modal(`
    <h3>✨ AI practice quiz</h3>
    <p class="muted">New questions written by AI for <strong>Unit ${u.id}: ${esc(u.title)}</strong>.</p>
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
    const box = m.el.querySelector('.ai-quiz-box');
    try {
      const { questions } = await api('/api/ai/quiz', {
        method: 'POST',
        body: { unitId, level: $('[data-level]', m.el).value, count: Number($('[data-count]', m.el).value), focus: $('[data-focus]', m.el).value },
      });
      m.el.querySelector('.form').remove();
      runQuiz(box, questions, { title: `AI quiz · Unit ${u.id}`, unitId, save: true });
    } catch (e) {
      toast(e.message, 'error', 5000);
      btn.disabled = false;
      btn.textContent = 'Create quiz';
    }
  };
}
