'use strict';
/*
 * AI tutor: talks to any OpenAI-compatible Chat Completions API (OpenRouter, OpenAI, Groq,
 * Together, DeepSeek, a local Ollama / LM Studio / vLLM, ...).
 */
const dns = require('node:dns').promises;
const net = require('node:net');
const config = require('./config');
const { HttpError } = require('./http');

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

/** Resolve which provider a user talks to. User settings override server defaults when allowed. */
function providerFor(settings, decrypt) {
  const own = config.ALLOW_USER_AI && settings.aiBaseUrl;
  return {
    baseUrl: (own ? settings.aiBaseUrl : config.AI_BASE_URL).replace(/\/+$/, ''),
    apiKey: own ? decrypt(settings.aiKeyEnc || '') : (decrypt(settings.aiKeyEnc || '') || config.AI_API_KEY),
    model: settings.aiModel || config.AI_MODEL,
    userUrl: Boolean(own),
  };
}

async function checkUrl(p) {
  let u;
  try { u = new URL(p.baseUrl); } catch { throw new HttpError(400, 'AI base URL is not a valid URL'); }
  if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, 'AI base URL must start with http:// or https://');
  if (p.userUrl && !config.ALLOW_PRIVATE_AI_URL) {
    const addrs = await dns.lookup(u.hostname, { all: true }).catch(() => []);
    if (!addrs.length) throw new HttpError(400, `Cannot resolve ${u.hostname}`);
    if (addrs.some((a) => isPrivateIp(a.address))) {
      throw new HttpError(400, 'Private/local AI URLs are disabled on this server (set ALLOW_PRIVATE_AI_URL=true to allow).');
    }
  }
}

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
async function streamChat(p, messages, { onDelta, signal, temperature = 0.5, maxTokens = 1200 }) {
  await checkUrl(p);
  if (!p.model) throw new HttpError(400, 'No AI model is set. Choose one in Settings.');
  const r = await fetch(`${p.baseUrl}/chat/completions`, {
    method: 'POST', headers: headers(p), signal,
    body: JSON.stringify({ model: p.model, messages, stream: true, temperature, max_tokens: maxTokens }),
  });
  if (!r.ok) throw await upstreamError(r);
  const type = r.headers.get('content-type') || '';
  if (!type.includes('event-stream')) {
    // Provider ignored stream:true; fall back to a normal JSON reply.
    const j = await r.json();
    const text = j.choices?.[0]?.message?.content || '';
    if (text) onDelta(text);
    return text;
  }
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  for await (const chunk of r.body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return full;
      try {
        const j = JSON.parse(data);
        if (j.error) throw new HttpError(502, j.error.message || 'AI provider error');
        const d = j.choices?.[0]?.delta?.content;
        if (d) { full += d; onDelta(d); }
      } catch (e) { if (e instanceof HttpError) throw e; }
    }
  }
  return full;
}

async function complete(p, messages, { temperature = 0.7, maxTokens = 2500, signal } = {}) {
  let out = '';
  await streamChat(p, messages, { onDelta: (d) => { out += d; }, temperature, maxTokens, signal });
  return out;
}

async function listModels(p) {
  await checkUrl(p);
  const r = await fetch(`${p.baseUrl}/models`, { headers: headers(p) });
  if (!r.ok) throw await upstreamError(r);
  const j = await r.json();
  return (j.data || j.models || []).map((m) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean).sort();
}

// ---------- prompts ----------

function learnerProfile(user, settings, weak) {
  const lines = [`Learner name: ${user.display_name}.`];
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

module.exports = {
  providerFor, streamChat, complete, listModels, learnerProfile, unitSystemPrompt, generalSystemPrompt,
  quizPrompt, parseQuiz, isPrivateIp,
};
