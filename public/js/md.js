// Small, safe markdown renderer (escapes all HTML first).
// Supports: ## headings, | tables |, - lists, 1. lists, > tips, "= example" lines, ``` code,
// **bold**, *italic*, ~~wrong~~, `code`, ✅ ❌.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del class="wrong">$1</del>');
}

export function md(src, { examples = true } = {}) {
  const lines = String(src || '').replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  const para = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para.length = 0; } };
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) { flush(); i++; continue; }
    if (t.startsWith('```')) {
      flush();
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    let m;
    if ((m = /^(#{1,4})\s+(.*)$/.exec(t))) {
      flush();
      const lv = Math.min(4, m[1].length + 1);
      out.push(`<h${lv}>${inline(m[2])}</h${lv}>`);
      i++;
      continue;
    }
    if (t.startsWith('|')) {
      flush();
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const r = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (!r.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(r);
        i++;
      }
      let [head, ...body] = rows;
      const noHead = head.every((c) => !c);
      if (noHead) head = null;
      out.push(`<div class="table-wrap"><table>${head ? `<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>` : ''}<tbody>${
        body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^[-•]\s+/.test(t) || /^\d+[.)]\s+/.test(t)) {
      flush();
      const ordered = /^\d/.test(t);
      const items = [];
      while (i < lines.length && (ordered ? /^\d+[.)]\s+/ : /^[-•]\s+/).test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^([-•]|\d+[.)])\s+/, ''));
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</${tag}>`);
      continue;
    }
    if (t.startsWith('>')) {
      flush();
      const buf = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) buf.push(lines[i++].trim().replace(/^>\s?/, ''));
      out.push(`<div class="tip">💡 ${buf.map(inline).join('<br>')}</div>`);
      continue;
    }
    if (examples && t.startsWith('= ')) {
      flush();
      const buf = [];
      while (i < lines.length && lines[i].trim().startsWith('= ')) buf.push(lines[i++].trim().slice(2));
      out.push(`<div class="ex-block">${buf.map((x) => `<div class="ex-line"><button class="icon-btn speak" data-say="${esc(x.replace(/[*~`]/g, ''))}" title="Listen" aria-label="Listen">🔊</button><span>${inline(x)}</span></div>`).join('')}</div>`);
      continue;
    }
    para.push(t);
    i++;
  }
  flush();
  return out.join('\n');
}
