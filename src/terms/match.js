// 문장 속 용어 찾기: 공백 차이 허용, 긴 용어 우선, 단어 안쪽 글자 무시, 문항당 한 번
const norm = (s) => s.replace(/\s+/g, '').toLowerCase();
const WORDCHAR = /[0-9A-Za-z가-힣]/;

export function buildMatcher(terms) {
  const entries = [];
  for (const t of terms) {
    for (const surface of [t.term, ...(t.aliases || [])]) {
      const key = norm(surface);
      if (key) entries.push({ key, termId: t.id, group: t.group, subject: t.subject, unit: t.unit });
    }
  }
  entries.sort((a, b) => b.key.length - a.key.length);
  return { entries };
}

export function findTerms(matcher, text, { group, subject, maxUnit, exclude, seen } = {}) {
  if (!text) return [];
  // 공백을 뺀 문자열과 원래 위치 대응표
  const pos = [];
  let n = '';
  for (let i = 0; i < text.length; i++) if (!/\s/.test(text[i])) { n += text[i].toLowerCase(); pos.push(i); }
  const inScope = matcher.entries.filter(e => (!group || e.group === group) && (!subject || e.subject === subject));
  const eligible = (e) => (maxUnit == null || e.unit <= maxUnit) && !(exclude && exclude.has(e.termId));
  const hits = [];
  let i = 0;
  while (i < n.length) {
    const before = pos[i] > 0 ? text[pos[i] - 1] : '';
    if (before && WORDCHAR.test(before)) { i++; continue; }
    const longest = inScope.find(e => eligible(e) && n.startsWith(e.key, i));
    if (!longest) { i++; continue; }
    if (!(seen && seen.has(longest.termId))) {
      hits.push({ start: pos[i], end: pos[i + longest.key.length - 1] + 1, termId: longest.termId });
      if (seen) seen.add(longest.termId);
      else (seen = new Set([longest.termId]));
    }
    i += longest.key.length;
  }
  return hits;
}

export function segment(text, hits) {
  const out = [];
  let at = 0;
  for (const h of [...hits].sort((a, b) => a.start - b.start)) {
    if (h.start > at) out.push(text.slice(at, h.start));
    out.push({ text: text.slice(h.start, h.end), termId: h.termId });
    at = h.end;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}
