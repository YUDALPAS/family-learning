// 개념 사전 화면 조각: ⚠ 표시, 용어 시트, 사전 탭
import { app, render, esc, nowISO, toast } from '../app.js';
import { buildMatcher, markSegments } from '../src/terms/match.js';
import { searchTerms } from '../src/terms/search.js';
import { termState, termsInItem, pickMarks, TERM_RULES } from '../src/terms/state.js';
import { sanitizeSvg } from '../src/terms/sanitize.js';

// ---------- 데이터 준비 ----------
export async function loadTerms(force = false) {
  if (!app.dict || force) {
    const [terms, links] = await Promise.all([app.store.terms({}), app.store.termLinks()]);
    app.dict = { terms, links, byId: Object.fromEntries(terms.map(t => [t.id, t])), matcher: buildMatcher(terms) };
    app.termStates = null;
  }
  return app.dict;
}

// 지금 학습자의 용어 상태 + 진도
export async function termContext(force = false) {
  const d = await loadTerms();
  if (!app.termStates || force) {
    const me = app.me;
    const [events, progress] = await Promise.all([app.store.termEvents(me.id), app.store.progress(me.id)]);
    const byTerm = {};
    for (const e of events) (byTerm[e.termId] ||= []).push(e);
    const now = nowISO();
    const states = {};
    for (const t of d.terms) {
      if (t.group !== me.group) continue;
      const reached = progress[t.subject] != null ? t.unit <= progress[t.subject] : false;
      states[t.id] = termState((byTerm[t.id] || []).sort((a, b) => a.at.localeCompare(b.at)), { reached }, now, TERM_RULES);
    }
    app.termStates = { states, progress, events };
  }
  return { ...d, ...app.termStates };
}

// 한 문항의 ⚠ 준비: 문항 전체에서 용어를 찾고, 표시할 것을 고른다
export function itemMarks(tc, item) {
  const ctx = { group: item.group, subject: item.subject, maxUnit: tc.progress[item.subject] };
  const all = termsInItem(tc.matcher, item, ctx);
  const unitOf = Object.fromEntries(all.map(id => [id, tc.byId[id]?.unit]));
  const allowed = pickMarks(all, { states: tc.states, unitOf, itemUnit: item.chapterNo });
  return { ctx, all, allowed, seen: new Set() };
}

// 문장에 ⚠·흐린 밑줄 넣기 (escape 포함). marks.seen을 같은 문항 안에서 공유한다.
// ⚠: 진도 안에서 고른 용어. 흐린 밑줄: 그 밖의 사전 용어(진도 밖·4개 초과·익힌 용어). 보기 버튼 안의 밑줄은 누를 수 없다.
export function marked(text, tc, marks, { inButton = false } = {}) {
  if (!text) return '';
  if (!tc || !marks) return esc(text);
  const exclude = new Set(marks.all.filter(id => !marks.allowed.has(id)));
  const segs = markSegments(tc.matcher, text, { ...marks.ctx, exclude, allowed: marks.allowed, seen: marks.seen });
  return segs.map(s => {
    if (typeof s === 'string') return esc(s);
    const name = esc(tc.byId[s.termId]?.term);
    if (s.kind === 'faint') return inButton
      ? `<span class="term-faint">${esc(s.text)}</span>`
      : `<button type="button" class="term-faint" data-term="${esc(s.termId)}" aria-label="「${name}」 뜻 보기">${esc(s.text)}</button>`;
    return inButton
      ? `<span class="term">${esc(s.text)}<span class="term-mark" role="button" tabindex="0" data-term="${esc(s.termId)}" data-unit="${tc.byId[s.termId]?.unit ?? 0}" aria-label="「${name}」 뜻 보기">⚠</span></span>`
      : `<span class="term">${esc(s.text)}<button type="button" class="term-mark" data-term="${esc(s.termId)}" data-unit="${tc.byId[s.termId]?.unit ?? 0}" aria-label="「${name}」 뜻 보기">⚠</button></span>`;
  }).join('');
}

export function termChips(tc, ids, limit = 6) {
  const sorted = [...ids].sort((a, b) => (tc.states[b]?.confusing ? 1 : 0) - (tc.states[a]?.confusing ? 1 : 0)).slice(0, limit);
  return sorted.map(id => `<button type="button" class="term-chip ${tc.states[id]?.confusing ? 'confusing' : ''}" data-term="${esc(id)}">${esc(tc.byId[id]?.term)}</button>`).join('');
}

// ---------- 용어 시트 ----------
let sheet = null;
const LINK_NAME = { confusing: '헷갈리는 짝', prereq: '먼저 알면 좋은 말', related: '관련 용어' };

export async function openSheet(termId, path = [], { backToSearch = null } = {}) {
  const tc = await loadTerms();
  const t = tc.byId[termId];
  if (!t) return;
  ensureSheet();
  const trail = [...path, termId];
  const links = tc.links.filter(l => l.from === termId && tc.byId[l.to]);
  const group = (type) => links.filter(l => l.type === type).map(l => l.to);
  const st = app.termStates?.states?.[termId];
  const box = sheet.querySelector('.term-sheet');
  box.innerHTML = `
    <div class="term-top">
      ${path.length || backToSearch ? `<button type="button" class="link term-back" aria-label="${path.length ? '이전 용어로' : '검색 결과로'}">‹ 뒤로</button>` : ''}
      <span class="term-path">${trail.map(id => esc(tc.byId[id]?.term)).join(' › ')}</span>
      <button type="button" class="link term-close">닫기</button>
    </div>
    <h2 class="term-title" id="term-title">${esc(t.term)}</h2>
    <p class="small muted">${esc(t.subject)} ${t.unit}장${t.aliases.length ? ` · ${esc(t.aliases.join(', '))}` : ''}${st?.confusing ? ' · <span class="tag weak">헷갈림</span>' : st?.state === 'known' ? ' · <span class="tag">익힘</span>' : ''}</p>
    <p class="term-def">${esc(t.definition)}</p>
    ${t.easy ? `<p class="pen term-easy">${esc(t.easy)}</p>` : ''}
    ${t.example ? `<p><span class="small muted">예시</span><br>${esc(t.example)}</p>` : ''}
    ${t.figure ? `<button type="button" class="btn ghost term-fig-btn">그림 보기</button><div class="term-fig" hidden></div>` : ''}
    ${['confusing', 'prereq', 'related'].map(type => group(type).length ? `<h3>${LINK_NAME[type]}</h3><div class="chips">${group(type).map(id => `<button type="button" class="term-chip" data-term="${esc(id)}">${esc(tc.byId[id].term)}</button>`).join('')}</div>` : '').join('')}
    ${t.source ? `<p class="small muted" style="margin-top:14px">출처: ${esc(t.source)}</p>` : ''}`;
  box.scrollTop = 0;
  box.querySelector('.term-close').onclick = closeSheet;
  box.querySelector('.term-back')?.addEventListener('click', () => path.length ? openSheet(path[path.length - 1], path.slice(0, -1), { backToSearch }) : openSearch(backToSearch.subject, backToSearch.query));
  box.querySelectorAll('.term-chip').forEach(b => b.onclick = () => openSheet(b.dataset.term, trail, { backToSearch }));
  box.querySelector('.term-fig-btn')?.addEventListener('click', (e) => {
    const fig = box.querySelector('.term-fig');
    const svg = sanitizeSvg(t.figure, DOMParser, XMLSerializer);
    fig.innerHTML = svg || '<p class="small muted">그림을 표시할 수 없어요.</p>';
    fig.hidden = false; e.target.hidden = true;
  });
  box.querySelector('.term-close').focus();
  if (app.me?.role) {
    try { await app.store.addTermEvents([{ termId, kind: 'open', at: nowISO() }]); app.termStates = null; } catch (err) { console.warn(err); }
  }
}

function ensureSheet() {
  if (sheet) return;
  sheet = document.createElement('div');
  sheet.className = 'term-wrap';
  sheet.innerHTML = '<section class="term-sheet" role="dialog" aria-modal="true" aria-labelledby="term-title"></section>';
  sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
  document.addEventListener('keydown', onKey);
  document.body.append(sheet);
}

// ---------- 문제 화면의 돋보기: 사전 검색 시트 ----------
export async function openSearch(subject, query = '') {
  const tc = await loadTerms();
  ensureSheet();
  const box = sheet.querySelector('.term-sheet');
  box.innerHTML = `
    <div class="term-top"><span class="term-path" id="term-title">개념 사전 찾기</span><button type="button" class="link term-close">닫기</button></div>
    <input class="dict-search" type="search" placeholder="용어 찾기 (예: 힙)" aria-label="용어 찾기" style="margin-top:8px">
    <ul class="list dict-list" style="margin-top:10px" aria-live="polite"></ul>`;
  const input = box.querySelector('.dict-search');
  const listEl = box.querySelector('.dict-list');
  input.value = query;
  const draw = () => {
    const q = input.value;
    const list = searchTerms(tc.terms, q, { group: app.me?.group, subject });
    listEl.innerHTML = !q.trim() ? '<li class="empty">용어를 입력해 보세요</li>'
      : !list.length ? '<li class="empty">사전에 없는 용어예요</li>'
      : list.map(t => `<li><button type="button" class="item term-chip-row" data-result="${esc(t.id)}"><span style="flex:1;text-align:left"><b>${esc(t.term)}</b><br><span class="small muted">${esc(t.definition.slice(0, 40))}${t.definition.length > 40 ? '…' : ''}</span></span><span class="meta">${t.subject === subject ? '' : esc(t.subject) + ' '}${t.unit}장</span></button></li>`).join('');
    listEl.querySelectorAll('[data-result]').forEach(b => b.onclick = () => openSheet(b.dataset.result, [], { backToSearch: { subject, query: input.value } }));
  };
  input.addEventListener('input', draw);
  box.querySelector('.term-close').onclick = closeSheet;
  draw();
  box.scrollTop = 0;
  input.focus();
}

function onKey(e) { if (e.key === 'Escape') closeSheet(); }
export function closeSheet() {
  if (!sheet) return;
  sheet.remove(); sheet = null;
  document.removeEventListener('keydown', onKey);
}

// 화면 어디서든 ⚠·용어 칩을 누르면 시트를 연다
export function wireTermClicks(root) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('.term-mark, .term-chip, .term-faint[data-term]');
    if (!b || b.closest('.term-sheet')) return;
    e.preventDefault(); e.stopPropagation();
    openSheet(b.dataset.term);
  }, true);
  root.addEventListener('keydown', (e) => {
    const b = e.target.closest?.('span.term-mark');
    if (!b || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault(); e.stopPropagation();
    openSheet(b.dataset.term);
  }, true);
}

// 문항 확정 결과를 그 문항 용어들의 기록으로 남긴다
export async function recordAnswers(attempts) {
  if (!attempts.length) return;
  const tc = await termContext();
  const byId = Object.fromEntries((app.items || []).map(i => [i.id, i]));
  const events = [];
  for (const a of attempts) {
    const item = byId[a.itemId];
    if (!item) continue;
    const ids = termsInItem(tc.matcher, item, { group: item.group, subject: item.subject, maxUnit: tc.progress[item.subject] });
    for (const id of ids) events.push({ termId: id, kind: 'answer', correct: !!a.correct, at: a.at });
  }
  if (events.length) { await app.store.addTermEvents(events); app.termStates = null; }
}

// ---------- 사전 탭 ----------
export async function dictView(params) {
  const tc = await termContext();
  const me = app.me;
  const mine = tc.terms.filter(t => t.group === me.group);
  const subjects = [...new Set(mine.map(t => t.subject))];
  let subject = params.subject || subjects[0] || '';
  let mode = params.mode || 'unit';
  const root = render(`
    <h1>개념 사전</h1>
    ${mine.length ? `
    <input class="dict-search" type="search" placeholder="용어 찾기 (예: 패자 트리)" aria-label="용어 찾기">
    <div class="row" style="margin:10px 0">
      <label class="field" style="margin:0;flex:1">과목<select class="dict-subject">${subjects.map(s => `<option ${s === subject ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
    </div>
    <div class="chips" role="radiogroup" aria-label="보기 방식">
      ${[['unit', '진도순'], ['abc', '가나다순'], ['confusing', '헷갈리는 용어']].map(([k, n]) => `<label class="chip"><input type="radio" name="dmode" value="${k}" ${k === mode ? 'checked' : ''}><span>${n}</span></label>`).join('')}
    </div>
    <ul class="list dict-list" style="margin-top:12px"></ul>` : '<p class="empty">아직 사전이 없어요. 보호자가 사전을 올리면 여기에 나타나요.</p>'}`);
  if (!mine.length) return;
  const listEl = root.querySelector('.dict-list');
  const draw = () => {
    const q = root.querySelector('.dict-search').value.trim().replace(/\s+/g, '');
    let list = mine.filter(t => q ? [t.term, ...t.aliases].some(n => n.replace(/\s+/g, '').includes(q)) : t.subject === subject);
    if (mode === 'confusing' && !q) list = list.filter(t => tc.states[t.id]?.confusing);
    list.sort(mode === 'abc' ? (a, b) => a.term.localeCompare(b.term, 'ko') : (a, b) => a.unit - b.unit || a.term.localeCompare(b.term, 'ko'));
    const reach = tc.progress[subject];
    listEl.innerHTML = list.length ? list.map(t => {
      const s = tc.states[t.id];
      const label = s?.confusing ? '<span class="tag weak">헷갈림</span>' : s?.state === 'known' ? '<span class="tag">익힘</span>' : (reach != null && t.unit > reach) ? '<span class="tag">아직 안 배움</span>' : '';
      return `<li><button type="button" class="item term-chip-row" data-term="${esc(t.id)}"><span style="flex:1;text-align:left"><b>${esc(t.term)}</b><br><span class="small muted">${esc(t.definition.slice(0, 40))}${t.definition.length > 40 ? '…' : ''}</span></span><span class="meta">${t.unit}장 ${label}</span></button></li>`;
    }).join('') : `<li class="empty">${mode === 'confusing' ? '헷갈리는 용어가 없어요.' : '찾는 용어가 없어요.'}</li>`;
    listEl.querySelectorAll('[data-term]').forEach(b => b.onclick = () => openSheet(b.dataset.term));
  };
  root.querySelector('.dict-search').addEventListener('input', draw);
  root.querySelector('.dict-subject').onchange = (e) => { subject = e.target.value; draw(); };
  root.querySelectorAll('[name=dmode]').forEach(r => r.onchange = () => { mode = r.value; draw(); });
  draw();
}
