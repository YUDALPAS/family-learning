// 보기해설 파일: 문항별로 "왜 이 보기는 틀렸는지"와 그림을 덧붙인다. 원래 풀이서는 건드리지 않는다.
const CIRCLED = '①②③④';
const norm = (s) => (s || '').replace(/\s+/g, '');

export function isWhyBook(lines) {
  return lines.slice(0, 20).some(l => /^\s*【보기해설】/.test(l));
}

export function parseWhyBook(lines) {
  const out = { subject: null, entries: [], warnings: [] };
  let cur = null, field = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { field = null; continue; }
    const m = line.match(/^【([^】]+)】\s*(.*)$/);
    if (!m) {
      if (cur && field) {
        if (field === 'figure') cur.figure += line;
        else if (field === 'stem') cur.stem += ' ' + line;
        else cur.whys[field] += ' ' + line;
      }
      continue;
    }
    const [, tag, val] = m;
    if (tag === '보기해설') continue;
    if (tag === '과목') { out.subject = val; continue; }
    if (tag === '문항') {
      const mm = val.match(/^(\S+)\s+(\d+)/);
      if (!mm) { out.warnings.push(`문항 표시를 읽지 못했어요: ${val}`); cur = null; field = null; continue; }
      cur = { set: mm[1], no: Number(mm[2]), stem: '', whys: {}, figure: null };
      out.entries.push(cur); field = null; continue;
    }
    if (!cur) continue;
    if (tag === '문제') { cur.stem = val; field = 'stem'; continue; }
    if (tag === '그림') { cur.figure = val; field = 'figure'; continue; }
    const k = CIRCLED.indexOf(tag);
    if (k >= 0) { cur.whys[k + 1] = val; field = k + 1; continue; }
    out.warnings.push(`${cur.set} ${cur.no}: 알 수 없는 칸 【${tag}】`);
    field = null;
  }
  return out;
}

// items 중 해설이 붙을 문항의 새 사본을 돌려준다
export function applyWhys(items, book) {
  const byKey = new Map(items.filter(i => i.subject === book.subject).map(i => [`${i.set} ${i.no}`, i]));
  const r = { updated: [], missing: [], mismatched: [], warnings: [...book.warnings] };
  for (const e of book.entries) {
    const key = `${e.set} ${e.no}`;
    const it = byKey.get(key);
    if (!it) { r.missing.push(key); continue; }
    if (e.stem) {
      const a = norm(e.stem).slice(0, 15), b = norm(it.stem).slice(0, 15);
      const n = Math.min(a.length, b.length);
      if (a.slice(0, n) !== b.slice(0, n)) { r.mismatched.push(key); continue; }
    }
    const options = it.options.map(o => {
      const w = e.whys[o.n];
      if (w == null) return { ...o };
      if (o.n === it.answer) { r.warnings.push(`${key}: 정답 보기(${CIRCLED[o.n - 1]})의 해설은 넣지 않았어요`); return { ...o }; }
      return { ...o, why: w };
    });
    r.updated.push({ ...it, options, ...(e.figure ? { figure: e.figure } : {}) });
  }
  return r;
}
