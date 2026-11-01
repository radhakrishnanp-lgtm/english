'use strict';
/*
 * AI tutor: talks to any OpenAI-compatible Chat Completions API (OpenRouter, OpenAI, Groq,
 * Together, DeepSeek, a local Ollama / LM Studio / vLLM, ...).
 */
const dns = require('node:dns');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const config = require('./config');
const { HttpError } = require('./http');

function isPrivateIp(ip) {
  ip = String(ip).replace(/^\[|\]$/g, '');
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || a >= 224;
  }
  if (!net.isIPv6(ip)) return true; // not an IP at all: treat as unsafe
  const v = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return isPrivateIp(mapped[1]);
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(v)) return true; // hex-form IPv4-mapped
  return v === '::1' || v === '::' || /^(fc|fd|fe[89ab])/.test(v) || v.startsWith('64:ff9b:') || v.startsWith('2001:db8:') || v.startsWith('ff');
}

/**
 * HTTP(S) request used for every AI provider call.
 * - Never follows redirects (a redirect could point at an internal address).
 * - When blockPrivate is set, every IP is checked at connect time (no DNS-rebinding gap).
 * - Has a timeout and a size cap for non-streaming bodies.
 */
function safeRequest(url, { method = 'GET', headers: hdrs = {}, body, signal, blockPrivate = false, timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { reject(new HttpError(400, 'AI base URL is not a valid URL')); return; }
    if (!/^https?:$/.test(u.protocol)) { reject(new HttpError(400, 'AI base URL must start with http:// or https://')); return; }
    if (u.username || u.password) { reject(new HttpError(400, 'AI base URL must not contain a user name or password')); return; }
    const blocked = () => new HttpError(400, 'Private/local AI URLs are disabled on this server (set ALLOW_PRIVATE_AI_URL=true to allow).');
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (blockPrivate && net.isIP(host) && isPrivateIp(host)) { reject(blocked()); return; }
    const lookup = (hostname, opts, cb) => {
      dns.lookup(hostname, { all: true, family: opts?.family || 0 }, (err, addrs) => {
        if (err) { cb(err); return; }
        if (blockPrivate && (!addrs.length || addrs.some((a) => isPrivateIp(a.address)))) { cb(blocked()); return; }
        if (opts?.all) cb(null, addrs); else cb(null, addrs[0].address, addrs[0].family);
      });
    };
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method, headers: hdrs, signal, lookup, timeout: timeoutMs }, (res) => {
      const MAX = 5 * 1024 * 1024;
      resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        headers: { get: (k) => res.headers[String(k).toLowerCase()] ?? null },
        body: res,
        async text() {
          let out = '';
          for await (const c of res) { out += c; if (out.length > MAX) { res.destroy(); throw new HttpError(502, 'AI provider reply is too large'); } }
          return out;
        },
        async json() { return JSON.parse(await this.text()); },
      });
    });
    req.on('timeout', () => req.destroy(new HttpError(504, 'The AI provider did not answer in time.')));
    req.on('error', (e) => reject(e instanceof HttpError ? e : (e.name === 'AbortError' ? e : new HttpError(502, `Could not reach the AI provider: ${e.message}`))));
    if (body) req.write(body);
    req.end();
  });
}

/** Resolve which provider a user talks to. User settings override server defaults when allowed. */
function providerFor(settings, decrypt, defaults = {}) {
  const d = {
    baseUrl: defaults.baseUrl || config.AI_BASE_URL, apiKey: defaults.apiKey ?? config.AI_API_KEY,
    model: defaults.model || config.AI_MODEL, allowUserAi: defaults.allowUserAi ?? config.ALLOW_USER_AI,
  };
  const own = d.allowUserAi && settings.aiBaseUrl;
  return {
    baseUrl: (own ? settings.aiBaseUrl : d.baseUrl).replace(/\/+$/, ''),
    apiKey: own ? decrypt(settings.aiKeyEnc || '') : ((d.allowUserAi && decrypt(settings.aiKeyEnc || '')) || d.apiKey),
    // A learner may only pick the model when they pay for it (own key or own URL);
    // otherwise they could run expensive models on the shared key.
    model: ((own || (d.allowUserAi && settings.aiKeyEnc)) && settings.aiModel) || d.model,
    reasoning: Boolean(settings.aiReasoning),
    userUrl: Boolean(own),
    ownKey: Boolean(own || (d.allowUserAi && settings.aiKeyEnc)),
  };
}

async function checkUrl(p) {
  let u;
  try { u = new URL(p.baseUrl); } catch { throw new HttpError(400, 'AI base URL is not a valid URL'); }
  if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, 'AI base URL must start with http:// or https://');
}
const blockFor = (p) => Boolean(p.userUrl && !config.ALLOW_PRIVATE_AI_URL);

function headers(p) {
  const h = { 'Content-Type': 'application/json', 'HTTP-Referer': 'https://english-path.local', 'X-Title': 'English Path' };
  if (p.apiKey) h.Authorization = `Bearer ${p.apiKey}`;
  return h;
}

async function upstreamError(r) {
  let msg = `AI provider returned ${r.status}`;
  try {
    const t = await r.text();
    const j = JSON.parse(t);
    msg += ': ' + (j.error?.message || j.message || t).toString().slice(0, 300);
  } catch { /* ignore */ }
  return new HttpError(502, msg);
}

/** Stream a chat completion. Calls onDelta(text) for each chunk; resolves with the full text. */
function normUsage(u) {
  if (!u) return null;
  return {
    prompt: Number(u.prompt_tokens ?? u.input_tokens ?? 0) || 0,
    completion: Number(u.completion_tokens ?? u.output_tokens ?? 0) || 0,
    reasoning: Number(u.completion_tokens_details?.reasoning_tokens ?? u.reasoning_tokens ?? 0) || 0,
    cost: typeof u.cost === 'number' ? u.cost : null,
  };
}

/**
 * Stream a chat completion. Calls onDelta(text) per chunk, onReasoning(text) for thinking,
 * onUsage({prompt, completion, reasoning, cost}) once at the end if the provider reports usage.
 * Resolves with the full text.
 */
async function streamChat(p, messages, { onDelta = () => {}, onReasoning, onUsage, signal, temperature = 0.5, maxTokens = 1200, reasoning }) {
  await checkUrl(p);
  if (!p.model) throw new HttpError(400, 'No AI model is set. Choose one in Settings.');
  const useReasoning = reasoning ?? p.reasoning;
  const body = { model: p.model, messages, stream: true, temperature, max_tokens: useReasoning ? maxTokens + 2000 : maxTokens };
  // OpenRouter-style reasoning switch. Only sent when turned on, because some providers reject unknown fields.
  if (useReasoning) body.reasoning = { enabled: true };
  // Ask for token usage in the final stream chunk (OpenAI style; OpenRouter always sends it).
  body.stream_options = { include_usage: true };
  const send = () => safeRequest(`${p.baseUrl}/chat/completions`, { method: 'POST', headers: headers(p), signal, body: JSON.stringify(body), blockPrivate: blockFor(p) });
  let r = await send();
  if (r.status === 400) {
    // Some providers don't know stream_options — retry once without it.
    await r.text().catch(() => {});
    delete body.stream_options;
    r = await send();
  }
  if (!r.ok) throw await upstreamError(r);
  const type = r.headers.get('content-type') || '';
  if (!type.includes('event-stream')) {
    // Provider ignored stream:true; fall back to a normal JSON reply.
    const j = await r.json();
    const text = j.choices?.[0]?.message?.content || '';
    const rz = j.choices?.[0]?.message?.reasoning || j.choices?.[0]?.message?.reasoning_content;
    if (rz && onReasoning) onReasoning(rz);
    if (text) onDelta(text);
    if (onUsage && j.usage) onUsage(normUsage(j.usage));
    return text;
  }
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  let usage = null;
  const finish = () => { if (onUsage) onUsage(usage); return full; };
  for await (const chunk of r.body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return finish();
      try {
        const j = JSON.parse(data);
        if (j.error) throw new HttpError(502, j.error.message || 'AI provider error');
        if (j.usage) usage = normUsage(j.usage);
        const delta = j.choices?.[0]?.delta || {};
        const rz = delta.reasoning || delta.reasoning_content;
        if (rz && onReasoning) onReasoning(rz);
        const d = delta.content;
        if (d) { full += d; onDelta(d); }
      } catch (e) { if (e instanceof HttpError) throw e; }
    }
  }
  return finish();
}

async function complete(p, messages, { temperature = 0.7, maxTokens = 2500, signal, reasoning = false, onUsage } = {}) {
  let out = '';
  await streamChat(p, messages, { onDelta: (d) => { out += d; }, temperature, maxTokens, signal, reasoning, onUsage });
  return out;
}

/** Prices per 1M tokens from OpenRouter's public model list. */
async function fetchOpenRouterPrices(baseUrl = 'https://openrouter.ai/api/v1') {
  const r = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`);
  if (!r.ok) throw new HttpError(502, `Could not load prices (${r.status})`);
  const j = await r.json();
  const out = {};
  for (const m of j.data || []) {
    const pin = Number(m.pricing?.prompt);
    const pout = Number(m.pricing?.completion);
    if (Number.isFinite(pin) && Number.isFinite(pout)) out[m.id] = { in: +(pin * 1e6).toFixed(4), out: +(pout * 1e6).toFixed(4) };
  }
  return out;
}

function checkPrompt(text, unitText) {
  return [
    { role: 'system', content: 'You are a kind English teacher. The learner wrote their own sentence(s). Reply in simple English, max 80 words, markdown: first "✅ Correct!" or "✍️ Better:" with the corrected sentence(s), then one short reason. If a unit is given, say whether they used that unit\'s grammar well.' },
    { role: 'user', content: `${unitText ? `Unit:\n${unitText.slice(0, 1500)}\n\n` : ''}Learner wrote:\n${text}` },
  ];
}

function recallPrompt(text, unitText) {
  return [
    { role: 'system', content: 'You check a learner\'s "brain dump": they wrote from memory what they remember about a grammar unit, without looking. Reply in markdown, max 140 words: **What you remembered** (praise specific points), **What you forgot** (the 2-3 most important missing or wrong points, with one example each), **Memory score**: X/10. Simple English, encouraging.' },
    { role: 'user', content: `Unit:\n${unitText.slice(0, 3000)}\n\nLearner's recall:\n${text}` },
  ];
}

async function listModels(p) {
  await checkUrl(p);
  const r = await safeRequest(`${p.baseUrl}/models`, { headers: headers(p), blockPrivate: blockFor(p), timeoutMs: 20000 });
  if (!r.ok) throw await upstreamError(r);
  const j = await r.json();
  return (j.data || j.models || []).map((m) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean).sort();
}

// ---------- prompts ----------

function learnerProfile(user, settings, weak, memories = []) {
  const lines = [`Learner name: ${user.display_name}.`];
  for (const m of memories) if (m.text) lines.push(`What you remember about this learner (${m.scope === 'general' ? 'from general chats' : 'from earlier chats about this unit'}):\n${m.text}`);
  if (settings.nativeLanguage) lines.push(`Learner's first language: ${settings.nativeLanguage}. When it helps, or when asked, add a short explanation in ${settings.nativeLanguage}.`);
  lines.push(`Preferred explanation style: ${settings.explainStyle || 'simple'} (simple = very easy English, A2 level; normal = B1; detailed = B2 with more grammar terms).`);
  if (weak?.length) lines.push(`Units where the learner makes the most mistakes: ${weak.join('; ')}.`);
  return lines.join('\n');
}

function unitSystemPrompt(unitText, profile, unitList) {
  return `You are "Tutor", a friendly, patient English grammar teacher inside the English Path course.
The learner is studying ONE unit right now. Its content is below between <unit> tags.

FOCUS RULES (very important):
- Teach ONLY this unit's grammar point. Base answers on the unit content, and you may add your own extra examples and practice for the same grammar point.
- If the learner asks about anything outside this unit (another grammar point, general knowledge, other topics), do NOT answer it. Reply in 1-2 short sentences: say it is outside this unit, name the unit from the course list that covers it if there is one, and suggest switching the chat to "General AI" mode.
- Never invent rules that contradict the unit.

HOW TO TEACH:
- Use short paragraphs and bullet points. Put the key grammar words in **bold**.
- Always give clear example sentences. Mark wrong forms with ❌ and correct forms with ✅.
- If the learner writes a sentence, check it: say if it is correct, show the corrected version, and explain why in one or two lines.
- If asked to quiz or practise: ask ONE question at a time, wait for the answer, then give feedback and the next question.
- End longer answers with one short follow-up question to check understanding.

${profile}

<unit>
${unitText}
</unit>

Course unit list (for pointing to other units): ${unitList}`;
}

function generalSystemPrompt(profile, unitList) {
  return `You are "Tutor", a friendly English teacher in the English Path learning website (General AI mode).
Help with anything about English: grammar, vocabulary, meaning of words and idioms, pronunciation tips, writing and email help, speaking practice, exam preparation, translation to/from English.
You may also answer normal everyday questions, but always help the learner improve their English: if the learner's message has mistakes, add a short "✍️ Better English:" line at the end with the corrected sentence.
Use simple, clear English, short paragraphs, bullet points and **bold** key words. Give examples. When a course unit is relevant, mention it as "Unit N: title".

${profile}

Course unit list: ${unitList}`;
}

const QUIZ_FORMAT = `Return ONLY a JSON object, no markdown, in exactly this shape:
{"questions":[
 {"t":"mc","q":"She ___ a nurse.","o":["am","is","are"],"a":1,"e":"Use is with he/she/it."},
 {"t":"fill","q":"They ___ (be) at home now.","a":["are","'re"],"e":"They + are."},
 {"t":"order","a":"My sister is a doctor.","e":"Subject + be + noun."},
 {"t":"fix","q":"He are happy.","a":["He is happy.","He's happy."],"e":"He + is."}
]}
Rules: "mc" has 3-4 options and "a" is the 0-based index of the correct one. "fill" has exactly one ___ and "a" lists all accepted answers. "order" gives the correct sentence (it will be shuffled). "fix" gives a wrong sentence and accepted corrections. "e" is a one-line explanation. Mix the types.`;

function quizPrompt(unitText, level, count, focus) {
  const lv = {
    easy: 'EASY: basic forms, very common words, short sentences, obvious context.',
    medium: 'MEDIUM: normal sentences, negatives and questions, some tricky forms.',
    hard: 'HARD: longer sentences, contrasts with similar grammar, common learner traps, error correction.',
  }[level] || 'MEDIUM';
  return [
    { role: 'system', content: `You write English grammar practice questions. ${QUIZ_FORMAT}` },
    { role: 'user', content: `Write ${count} NEW practice questions for this unit. Difficulty: ${lv}${focus ? `\nExtra focus: ${focus}` : ''}\nUse different sentences from the unit's own examples.\n\n${unitText}` },
  ];
}

function parseQuiz(text) {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s === -1 || e <= s) throw new HttpError(502, 'The AI did not return a quiz. Try again.');
  let j;
  try { j = JSON.parse(text.slice(s, e + 1)); } catch { throw new HttpError(502, 'The AI returned broken JSON. Try again.'); }
  const str = (x) => (typeof x === 'string' ? x.trim() : '');
  const out = [];
  for (const q of Array.isArray(j.questions) ? j.questions : []) {
    const e2 = str(q.e);
    if (q.t === 'mc' && str(q.q) && Array.isArray(q.o) && q.o.length >= 2 && Number.isInteger(q.a) && q.o[q.a] !== undefined) {
      out.push({ t: 'mc', q: str(q.q), o: q.o.map(str), a: q.a, e: e2 });
    } else if (q.t === 'fill' && str(q.q).includes('___')) {
      const a = (Array.isArray(q.a) ? q.a : [q.a]).map(str).filter(Boolean);
      if (a.length) out.push({ t: 'fill', q: str(q.q), a, e: e2 });
    } else if (q.t === 'order' && str(q.a).split(/\s+/).length >= 3) {
      out.push({ t: 'order', a: str(q.a), e: e2 });
    } else if (q.t === 'fix' && str(q.q)) {
      const a = (Array.isArray(q.a) ? q.a : [q.a]).map(str).filter(Boolean);
      if (a.length) out.push({ t: 'fix', q: str(q.q), a, e: e2 });
    }
  }
  if (!out.length) throw new HttpError(502, 'The AI quiz had no usable questions. Try again.');
  return out.slice(0, 20).map((q, i) => ({ ...q, id: `ai-${Date.now().toString(36)}-${i}` }));
}

const VOICE_RULES = `
THIS IS A LIVE SPOKEN CONVERSATION (your reply is read aloud):
- Reply in 1-3 short, natural spoken sentences. No markdown, no lists, no emojis.
- Keep the conversation going: end with a simple question.
- If the learner makes a grammar mistake, gently say the correct version once ("You mean: ...") and continue.`;

function memoryPrompt(oldMemory, transcript, scopeName) {
  return [
    { role: 'system', content: 'You keep short tutoring notes about an English learner. Return ONLY the updated notes as 3-8 short bullet points (max 90 words total). Keep durable, useful facts: goals, level, recurring mistakes, what they understood or found hard, preferences (language, style), personal details they shared that help with examples. Drop small talk. No preamble.' },
    { role: 'user', content: `Scope: ${scopeName}\n\nCurrent notes:\n${oldMemory || '(none yet)'}\n\nNew conversation:\n${transcript}` },
  ];
}

function hintPrompt(q, unitText) {
  return [
    { role: 'system', content: 'You are a kind English tutor giving a HINT for a practice question. NEVER give the answer, never write the missing word(s) or the corrected sentence, and do not list which option is correct. Give one or two short sentences that point the learner to the rule (e.g. "Look at the subject — is it singular or plural?"). Use simple English.' },
    { role: 'user', content: `Unit:\n${unitText.slice(0, 2500)}\n\nQuestion type: ${q.t}\nQuestion: ${q.t === 'order' ? 'Put these words in order: ' + q.words : q.q}${q.o ? '\nOptions: ' + q.o.join(' / ') : ''}\nLearner's current attempt: ${q.attempt || '(nothing yet)'}\n(Secret answer, do NOT reveal: ${q.answer})` },
  ];
}

function feedbackPrompt(title, unitText, items, score, total) {
  return [
    { role: 'system', content: 'You are an encouraging English teacher writing a short result report. Use markdown with these sections: **Score**, **What you did well**, **What to work on** (explain each wrong answer\'s rule simply, with a correct example), **Next steps** (2-3 concrete actions, e.g. which level to retry). Keep it under 220 words. Simple English.' },
    { role: 'user', content: `Test: ${title}\nScore: ${score}/${total}\n${unitText ? 'Unit content:\n' + unitText.slice(0, 2500) + '\n' : ''}\nAnswers:\n${items.map((x, i) => `${i + 1}. ${x.correct ? 'RIGHT' : 'WRONG'} — Q: ${x.q} | learner: ${x.given || '(skipped)'} | correct: ${x.answer}`).join('\n')}` },
  ];
}

function flowPrompt(unitText) {
  return [
    { role: 'system', content: `You turn an English grammar lesson into a simple decision flowchart that helps a learner choose the right form. Return ONLY JSON, no markdown:
{"title":"short title","nodes":[{"id":"a","type":"start|question|answer|tip","text":"max 12 words","example":"optional short example"}],"edges":[{"from":"a","to":"b","label":"optional: yes/no/he-she-it…"}]}
Rules: 6-14 nodes. Exactly one "start" node. "question" nodes ask a yes/no or choice question; "answer" nodes give the form to use with an example. Every node except start must have an incoming edge. No cycles.` },
    { role: 'user', content: unitText.slice(0, 5000) },
  ];
}

function parseFlow(text) {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  let j;
  try { j = JSON.parse(text.slice(s, e + 1)); } catch { throw new HttpError(502, 'The AI returned a broken diagram. Try again.'); }
  const str = (x, n) => (typeof x === 'string' ? x.trim().slice(0, n) : '');
  const nodes = (Array.isArray(j.nodes) ? j.nodes : []).slice(0, 20).map((n) => ({
    id: str(String(n.id), 20), type: ['start', 'question', 'answer', 'tip'].includes(n.type) ? n.type : 'answer',
    text: str(n.text, 120), example: str(n.example, 120),
  })).filter((n) => n.id && n.text);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (Array.isArray(j.edges) ? j.edges : []).map((x) => ({ from: str(String(x.from), 20), to: str(String(x.to), 20), label: str(x.label, 30) }))
    .filter((x) => ids.has(x.from) && ids.has(x.to) && x.from !== x.to).slice(0, 40);
  if (nodes.length < 2) throw new HttpError(502, 'The AI diagram was empty. Try again.');
  return { title: str(j.title, 80), nodes, edges };
}

module.exports = {
  normUsage, fetchOpenRouterPrices, safeRequest, checkPrompt, recallPrompt,
  VOICE_RULES, memoryPrompt, hintPrompt, feedbackPrompt, flowPrompt, parseFlow,
  providerFor, streamChat, complete, listModels, learnerProfile, unitSystemPrompt, generalSystemPrompt,
  quizPrompt, parseQuiz, isPrivateIp,
};
