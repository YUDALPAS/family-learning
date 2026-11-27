// 개념 사전 검색: 공백 무시 부분 일치(용어명+다른 이름), 지금 과목 먼저, 검색어로 시작하는 이름 먼저
const norm = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase();

export function searchTerms(terms, query, { group, subject, limit = 30 } = {}) {
  const q = norm(query);
  if (!q) return [];
  const scored = [];
  for (const t of terms) {
    if (group && t.group !== group) continue;
    const names = [t.term, ...(t.aliases || [])].map(norm);
    if (!names.some(n => n.includes(q))) continue;
    scored.push({ t, other: t.subject === subject ? 0 : 1, starts: names.some(n => n.startsWith(q)) ? 0 : 1 });
  }
  scored.sort((a, b) => a.other - b.other || a.starts - b.starts || a.t.unit - b.t.unit || a.t.term.localeCompare(b.t.term, 'ko'));
  return scored.slice(0, limit).map(x => x.t);
}
