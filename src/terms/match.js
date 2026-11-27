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
    // 영문·숫자로 끝나는 용어는 바로 뒤에 영문·숫자가 이어지면 단어의 일부로 본다 (requests 속 re)
    const endsOk = (e) => {
      if (!/[a-z0-9]$/.test(e.key)) return true;
      const after = text[pos[i + e.key.length - 1] + 1] || '';
      return !/[0-9A-Za-z_]/.test(after);
    };
    const longest = inScope.find(e => eligible(e) && n.startsWith(e.key, i) && endsOk(e));
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

// 문장을 표시 조각으로: ⚠(진도 규칙 그대로)를 먼저 찾고, 남은 부분에서만 그 밖의 사전 용어를 'faint'로 찾는다.
// maxUnit·exclude는 ⚠ 패스에만 쓴다(기존 ⚠ 동작 유지). seen은 문항 전체에서 공유.
export function markSegments(matcher, text, { group, subject, maxUnit, exclude, allowed = new Set(), seen = new Set() } = {}) {
  if (!text) return [];
  const marks = findTerms(matcher, text, { group, subject, maxUnit, exclude, seen: new Set(seen) })
    .filter(h => allowed.has(h.termId)).map(h => ({ ...h, kind: 'mark' }));
  for (const h of marks) seen.add(h.termId);
  const covered = (h) => marks.some(m => h.start < m.end && m.start < h.end);
  const faint = [];
  for (const h of findTerms(matcher, text, { group, subject })) {
    if (covered(h) || seen.has(h.termId)) continue;
    seen.add(h.termId); faint.push({ ...h, kind: 'faint' });
  }
  const hits = [...marks, ...faint].sort((a, b) => a.start - b.start);
  let k = 0;
  return segment(text, hits).map(s => typeof s === 'string' ? s : { ...s, kind: hits[k++].kind });
}
