// 개념 사전 docx(줄 배열) → 용어 카드 + 연결 관계
const FIELD = /^【([^】]+)】\s*(.*)$/;
const KEYS = {
  '용어': 'term', '과목': 'subject', '단원': 'unit', '다른 이름': 'aliases', '정의': 'definition',
  '쉬운 설명': 'easy', '예시': 'example', '그림': 'figure', '선수': 'prereq', '관련': 'related',
  '헷갈리는 짝': 'confusing', '출처': 'source',
};
const LINK_KEYS = ['prereq', 'related', 'confusing'];
const list = (s) => (s || '').split(/[,，]/).map(x => x.trim()).filter(Boolean);

export function isTermBook(lines) {
  return lines.slice(0, 20).some(l => /^\s*【사전】/.test(l));
}

export function parseTermBook(lines, meta = {}) {
  const head = { group: meta.group || 'knou', subject: meta.subject || '' };
  const raw = [];
  let cur = null, key = null;
  for (const line of lines) {
    const m = line.trim().match(FIELD);
    if (m) {
      const label = m[1].trim(), val = m[2];
      if (label === '사전') { key = null; continue; }
      if (label === '학습자군' && !cur) { head.group = val.trim(); key = null; continue; }
      if (label === '과목' && !cur) { head.subject = val.trim(); key = null; continue; }
      const k = KEYS[label];
      if (!k) { key = null; continue; }
      if (k === 'term') { cur = { fields: { term: val.trim() } }; raw.push(cur); key = 'term'; continue; }
      if (!cur) continue;
      key = k; cur.fields[k] = val;
      continue;
    }
    if (cur && key && key !== 'term') cur.fields[key] += '\n' + line;
  }

  const warnings = [];
  const terms = raw.map(({ fields: f }) => {
    const subject = (f.subject || head.subject).trim();
    const unit = parseInt(f.unit, 10);
    if (!Number.isFinite(unit)) warnings.push(`「${f.term}」: 단원이 없어요`);
    if (!(f.definition || '').trim()) warnings.push(`「${f.term}」: 정의가 없어요`);
    const fig = (f.figure || '').trim();
    return {
      id: `${head.group}|${subject}|${f.term}`, group: head.group, subject, unit: Number.isFinite(unit) ? unit : 0,
      term: f.term, aliases: list(f.aliases), definition: (f.definition || '').trim(), easy: (f.easy || '').trim(),
      example: (f.example || '').trim(), figure: fig || null, source: (f.source || '').trim(), status: 'public',
      _links: Object.fromEntries(LINK_KEYS.map(k => [k, list(f[k])])),
    };
  });

  const find = (name, from) => terms.find(t => t.term === name && t.subject === from.subject) || terms.find(t => t.term === name || t.aliases.includes(name));
  const links = [];
  for (const t of terms) {
    for (const type of LINK_KEYS) {
      for (const name of t._links[type]) {
        const to = find(name, t);
        if (!to) { warnings.push(`「${t.term}」의 ${type === 'prereq' ? '선수' : type === 'related' ? '관련' : '헷갈리는 짝'} 용어 「${name}」가 사전에 없어요`); continue; }
        links.push({ from: t.id, to: to.id, type });
      }
    }
  }
  // 선수 관계 순환 검사
  const pre = {};
  for (const l of links) if (l.type === 'prereq') (pre[l.from] ||= []).push(l.to);
  const state = {};
  const visit = (id, path) => {
    if (state[id] === 2) return;
    if (state[id] === 1) { warnings.push(`선수 관계가 순환해요: ${[...path, id].map(x => x.split('|')[2]).join(' → ')}`); return; }
    state[id] = 1;
    for (const n of pre[id] || []) visit(n, [...path, id]);
    state[id] = 2;
  };
  for (const t of terms) visit(t.id, []);

  for (const t of terms) delete t._links;
  return { terms, links, warnings };
}
