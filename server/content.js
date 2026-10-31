'use strict';
/*
 * Course content loader.
 *
 * Lessons live in content/*.txt in a compact plain-text format so they are easy to write and
 * review. Format (one file can hold many units):
 *
 *   # 12 | Past simple: negatives and questions | Past | A1
 *   summary: One-line description.
 *   [learn]        explanation (light markdown, see public/js/md.js; "= sentence" is an example line)
 *   [examples]     Sentence. :: optional note
 *   [mistakes]     Wrong sentence. => Right sentence. :: why
 *   [easy] [medium] [hard]   practice questions, one per line:
 *       mc: She ___ here. | *is | are | am :: explanation      (* marks the right option)
 *       fill: They ___ (be) late. = are | 're :: explanation   (accepted answers after =;
 *             with two blanks, give the parts in order: "Where ___ you ___ (go)? = are, going")
 *       order: This is my bag. :: hint                          (words are shuffled in the UI)
 *       fix: He are tired. => He is tired. | He's tired. :: why  (correct the sentence)
 *
 * Reference pages use "@ slug | Title" headings and contain only [learn]-style text.
 */
const fs = require('node:fs');
const path = require('node:path');

const CONTENT_DIR = path.resolve(__dirname, '..', 'content');
const LEVELS = ['easy', 'medium', 'hard'];
const SECTIONS = new Set(['learn', 'examples', 'mistakes', ...LEVELS]);

function splitExpl(s) {
  const i = s.indexOf(' :: ');
  return i === -1 ? [s.trim(), ''] : [s.slice(0, i).trim(), s.slice(i + 4).trim()];
}
const alts = (s) => s.split(' | ').map((x) => x.trim()).filter(Boolean);

function parseQuestion(line, where) {
  const m = /^(mc|fill|order|fix):\s*(.*)$/.exec(line);
  if (!m) throw new Error(`${where}: unknown question line "${line}"`);
  const [type, rest] = [m[1], m[2]];
  const [body, e] = splitExpl(rest);
  if (type === 'mc') {
    const parts = alts(body);
    const q = parts.shift();
    const a = parts.findIndex((p) => p.startsWith('*'));
    if (a === -1 || parts.length < 2) throw new Error(`${where}: mc needs options and one *answer`);
    return { t: 'mc', q, o: parts.map((p) => p.replace(/^\*/, '')), a, e };
  }
  if (type === 'fill') {
    const i = body.lastIndexOf(' = ');
    if (i === -1 || !body.includes('___')) throw new Error(`${where}: fill needs ___ and = answers`);
    const q = body.slice(0, i).trim();
    const a = alts(body.slice(i + 3));
    const blanks = q.split('___').length - 1;
    if (blanks > 1 && a.some((x) => x.split(/\s*,\s*/).length !== blanks)) throw new Error(`${where}: each answer needs ${blanks} parts separated by ", "`);
    if (/placeholder/i.test(e)) throw new Error(`${where}: placeholder explanation`);
    return { t: 'fill', q, a, e };
  }
  if (type === 'order') {
    if (body.split(/\s+/).length < 3) throw new Error(`${where}: order sentence too short`);
    return { t: 'order', a: body, e };
  }
  const i = body.indexOf(' => ');
  if (i === -1) throw new Error(`${where}: fix needs =>`);
  return { t: 'fix', q: body.slice(0, i).trim(), a: alts(body.slice(i + 4)), e };
}

function parseFile(text, file) {
  const units = [];
  const refs = [];
  let cur = null;
  let section = null;
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, n) => {
    const where = `${file}:${n + 1}`;
    const line = raw.replace(/\s+$/, '');
    let m;
    if ((m = /^# (\d+) \| (.+?) \| (.+?) \| (\w+)$/.exec(line))) {
      cur = {
        id: Number(m[1]), title: m[2], section: m[3], cefr: m[4], summary: '',
        learn: '', examples: [], mistakes: [], practice: { easy: [], medium: [], hard: [] },
      };
      units.push(cur);
      section = null;
      return;
    }
    if ((m = /^@ ([a-z0-9-]+) \| (.+)$/.exec(line))) {
      cur = { slug: m[1], title: m[2], learn: '', ref: true };
      refs.push(cur);
      section = 'learn';
      return;
    }
    if (!cur) {
      if (line.trim() && !line.startsWith('//')) throw new Error(`${where}: text before first unit`);
      return;
    }
    if ((m = /^\[(\w+)\]$/.exec(line))) {
      if (!SECTIONS.has(m[1])) throw new Error(`${where}: unknown section [${m[1]}]`);
      section = m[1];
      return;
    }
    if (!section) {
      if ((m = /^summary:\s*(.+)$/.exec(line))) cur.summary = m[1];
      else if (line.trim()) throw new Error(`${where}: expected summary or [section]`);
      return;
    }
    if (section === 'learn') { cur.learn += line + '\n'; return; }
    if (!line.trim() || line.startsWith('//')) return;
    if (section === 'examples') {
      const [s, note] = splitExpl(line);
      cur.examples.push(note ? { s, note } : { s });
    } else if (section === 'mistakes') {
      const [body, why] = splitExpl(line);
      const i = body.indexOf(' => ');
      if (i === -1) throw new Error(`${where}: mistake needs =>`);
      cur.mistakes.push({ wrong: body.slice(0, i).trim(), right: body.slice(i + 4).trim(), why });
    } else {
      cur.practice[section].push(parseQuestion(line.trim(), where));
    }
  });
  for (const u of [...units, ...refs]) u.learn = u.learn.trim();
  return { units, refs };
}

function plain(md) {
  return md.replace(/[*~`#>|=_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function load(dir = CONTENT_DIR) {
  const units = [];
  const refs = [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).sort();
  for (const f of files) {
    const r = parseFile(fs.readFileSync(path.join(dir, f), 'utf8'), f);
    units.push(...r.units);
    refs.push(...r.refs);
  }
  units.sort((a, b) => a.id - b.id);
  const seen = new Set();
  for (const u of units) {
    if (seen.has(u.id)) throw new Error(`duplicate unit ${u.id}`);
    seen.add(u.id);
    // stable question ids: <unit>-<e|m|h><index>
    for (const lv of LEVELS) u.practice[lv].forEach((q, i) => { q.id = `${u.id}-${lv[0]}${i}`; });
  }
  const sections = [];
  for (const u of units) {
    let s = sections.find((x) => x.name === u.section);
    if (!s) sections.push((s = { name: u.section, units: [] }));
    s.units.push(u.id);
  }
  const index = units.map((u) => ({
    id: u.id, title: u.title, section: u.section, cefr: u.cefr, summary: u.summary,
    counts: Object.fromEntries(LEVELS.map((l) => [l, u.practice[l].length])),
  }));
  const search = [
    ...units.map((u) => ({
      kind: 'unit', id: u.id, title: u.title, section: u.section,
      text: [u.summary, plain(u.learn), ...u.examples.map((e) => e.s + ' ' + (e.note || '')),
        ...u.mistakes.map((m) => `${m.wrong} ${m.right} ${m.why}`)].join(' '),
    })),
    ...refs.map((r) => ({ kind: 'ref', id: r.slug, title: r.title, text: plain(r.learn) })),
  ];
  const byId = new Map(units.map((u) => [u.id, u]));
  const refBySlug = new Map(refs.map((r) => [r.slug, r]));
  return { units, byId, index, sections, refs, refBySlug, search };
}

/** Plain-text version of a unit for the AI tutor's system prompt. */
function unitContext(u, max = 9000) {
  const parts = [
    `UNIT ${u.id}: ${u.title} (section: ${u.section}, level ${u.cefr})`,
    `Summary: ${u.summary}`,
    'Explanation:', u.learn.replace(/^= /gm, 'Example: '),
    'Examples:', ...u.examples.map((e) => `- ${e.s}${e.note ? ` (${e.note})` : ''}`),
    'Common mistakes:', ...u.mistakes.map((m) => `- Wrong: ${m.wrong} / Right: ${m.right} - ${m.why}`),
  ];
  const s = parts.join('\n');
  return s.length > max ? s.slice(0, max) + '\n...' : s;
}

module.exports = { load, parseFile, unitContext, LEVELS };

if (require.main === module) {
  const c = load();
  const q = c.units.reduce((n, u) => n + LEVELS.reduce((k, l) => k + u.practice[l].length, 0), 0);
  const missing = [];
  for (let i = 1; i <= 115; i++) if (!c.byId.has(i)) missing.push(i);
  console.log(`units: ${c.units.length}, questions: ${q}, reference pages: ${c.refs.length}`);
  if (missing.length) console.log(`missing units: ${missing.join(', ')}`);
  for (const u of c.units) {
    const thin = LEVELS.filter((l) => u.practice[l].length < 4);
    if (thin.length || u.examples.length < 4) console.log(`unit ${u.id}: thin (${thin.join(',')} examples=${u.examples.length})`);
  }
}
