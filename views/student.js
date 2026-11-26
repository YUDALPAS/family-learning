import { app, render, go, esc, pct, nowISO, today, publicItems, conceptName, GROUP_NAME, REVEAL_NAME, toast } from '../app.js';
import { conceptMastery } from '../src/analysis/mastery.js';
import { reviewDue } from '../src/analysis/review.js';
import { buildSet } from '../src/analysis/recommend.js';
import { createSession } from '../src/session.js';
import { termContext } from './terms.js';

const STATUS_NAME = { mastered: '숙달', ok: '보통', weak: '약점', insufficient: '자료 부족' };

export function startSession(list, opts) {
  app.current = { session: createSession({ items: list, learnerId: app.me.id, ...opts.session }), ctx: opts.ctx || {}, startedAt: Date.now(), at: 0 };
  go('#/solve');
}

export async function home() {
  const me = app.me;
  const [all, attempts, queue, asg, subjects] = await Promise.all([
    publicItems(), app.store.attempts(me.id), app.store.reviewQueue(me.id), app.store.assignments(), app.store.subjects(),
  ]);
  const mine = all.filter(i => i.group === me.group);
  const due = reviewDue(queue, nowISO()).filter(id => mine.some(i => i.id === id));
  const open = asg.filter(a => a.learnerId === me.id && a.status !== 'done');
  const doneAsg = asg.filter(a => a.learnerId === me.id && a.status === 'done').slice(0, 5);
  const m = conceptMastery(attempts, Object.fromEntries(mine.map(i => [i.id, i])), nowISO());
  const subj = subjects.filter(s => s.group === me.group);
  const subjMastery = (s) => {
    const ms = Object.entries(m).filter(([c]) => mine.some(i => i.concept === c && i.subject === s));
    const done = new Set(attempts.map(a => a.itemId));
    const total = mine.filter(i => i.subject === s).length;
    const tried = mine.filter(i => i.subject === s && done.has(i.id)).length;
    return { total, tried, weak: ms.filter(([, v]) => v.status === 'weak').length };
  };
  const root = render(`
    <h1>${esc(me.nickname)}, 오늘 할 공부예요</h1>
    <h2>과제</h2>
    ${open.length ? `<ul class="list">${open.map(a => `<li><a href="#/assignment?id=${encodeURIComponent(a.id)}"><span>${esc(a.title || '과제')}<br><span class="small muted">${a.itemIds.length}문항 · 풀이는 ${esc(REVEAL_NAME[a.reveal?.solution] || '바로')} 공개</span></span><span class="meta">${a.dueAt ? esc(a.dueAt.slice(5, 10).replace('-', '/')) + '까지' : ''}</span></a></li>`).join('')}</ul>`
      : `<p class="empty">받은 과제가 없어요.</p>`}
    ${doneAsg.length ? `<details class="card"><summary>끝낸 과제 다시 보기</summary><ul class="list">${doneAsg.map(a => `<li><a href="#/assignment?id=${encodeURIComponent(a.id)}">${esc(a.title || '과제')}<span class="meta">결과 보기</span></a></li>`).join('')}</ul></details>` : ''}
    <h2>오답 다시 풀기</h2>
    ${due.length ? `<button class="btn wide" id="review">복습할 문제 ${due.length}개 풀기</button>` : `<p class="empty">오늘 복습할 문제가 없어요. 틀린 문제는 1·3·7·14·30일 뒤에 다시 나와요.</p>`}
    <h2>과목</h2>
    ${subj.length ? `<ul class="list">${subj.map(s => { const x = subjMastery(s.subject); return `<li><a href="#/setup?subject=${encodeURIComponent(s.subject)}"><span style="flex:1">${esc(s.subject)} <span class="small muted">${esc(s.gradeTerm || '')}</span>
        <span class="meter" aria-label="푼 문항 ${x.tried}/${x.total}"><i style="width:${x.total ? Math.round(100 * x.tried / x.total) : 0}%"></i></span></span>
        <span class="meta">${x.tried}/${x.total}${x.weak ? ` · <span class="tag weak">약점 ${x.weak}</span>` : ''}</span></a></li>`; }).join('')}</ul>
      <div class="row" style="margin-top:16px"><a class="btn ghost" href="#/setup?mode=recommend">맞춤 추천 10문항</a></div>`
      : `<p class="empty">아직 ${esc(GROUP_NAME[me.group])} 문제가 없어요. 보호자가 문제를 올리면 여기에 나타나요.</p>`}`);
  root.querySelector('#review')?.addEventListener('click', () => {
    const list = due.map(id => mine.find(i => i.id === id)).filter(Boolean).slice(0, 20);
    startSession(list, { session: { mode: 'review', reveal: { answer: 'immediate', solution: 'immediate' }, shuffle: true }, ctx: { title: '오답 다시 풀기' } });
  });
}

export async function setup(params) {
  const me = app.me;
  const mine = (await publicItems()).filter(i => i.group === me.group);
  const subjects = [...new Set(mine.map(i => i.subject))];
  const subject = params.subject || subjects[0] || '';
  const sets = [...new Set(mine.filter(i => i.subject === subject).map(i => i.set))];
  const chapters = [...new Map(mine.filter(i => i.subject === subject).map(i => [i.chapterNo, i.chapter])).entries()].sort((a, b) => a[0] - b[0]);
  const mode = params.mode || 'practice';
  const radio = (name, value, label, checked) => `<label class="chip"><input type="radio" name="${name}" value="${esc(value)}" ${checked ? 'checked' : ''}><span>${esc(label)}</span></label>`;
  const root = render(`
    <h1>문제 풀기 준비</h1>
    <form id="f">
      <fieldset><legend>무엇을 풀까요</legend><div class="chips">
        ${radio('mode', 'practice', '단원 연습', mode === 'practice')}${radio('mode', 'recommend', '맞춤 추천', mode === 'recommend')}${radio('mode', 'mock', '모의고사', mode === 'mock')}
      </div></fieldset>
      <label class="field">과목<select name="subject">${subjects.map(s => `<option ${s === subject ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
      <label class="field">문제집<select name="set"><option value="">전체</option>${sets.map(s => `<option>${esc(s)}</option>`).join('')}</select></label>
      <label class="field">단원<select name="chapter"><option value="">전체</option>${chapters.map(([n, c]) => `<option value="${n}">${n}장 ${esc(c)}</option>`).join('')}</select></label>
      <label class="field">문항 수<select name="size">${[5, 10, 15, 20].map(n => `<option ${n === 10 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <fieldset id="revealBox"><legend>정답과 풀이는 언제 볼까요</legend><div class="chips">
        ${radio('reveal', 'immediate', '한 문제씩 바로', true)}${radio('reveal', 'after_retry', '한 번 더 풀어본 뒤', false)}${radio('reveal', 'after_submit', '다 풀고 한꺼번에', false)}
      </div><p class="small muted" id="mockNote" hidden>모의고사는 다 풀고 제출한 뒤에 채점해요.</p></fieldset>
      <fieldset><legend>보기 순서</legend><div class="chips">${radio('shuffle', '0', '그대로', true)}${radio('shuffle', '1', '섞기', false)}</div></fieldset>
      <button class="btn wide" type="submit">시작하기</button>
    </form>`);
  const f = root.querySelector('#f');
  f.subject.onchange = () => go(`#/setup?subject=${encodeURIComponent(f.subject.value)}&mode=${f.mode.value}`);
  const syncMode = () => { const mock = f.mode.value === 'mock'; root.querySelectorAll('[name=reveal]').forEach(r => r.disabled = mock); root.querySelector('#mockNote').hidden = !mock; };
  f.querySelectorAll('[name=mode]').forEach(r => r.onchange = syncMode); syncMode();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const size = +f.size.value;
    const scope = { subject: f.subject.value, set: f.set.value || undefined, chapterNo: f.chapter.value ? +f.chapter.value : undefined };
    const attempts = await app.store.attempts(me.id);
    const queue = await app.store.reviewQueue(me.id);
    const m = f.mode.value;
    let ids;
    if (m === 'recommend') ids = buildSet({ items: mine, attempts, queue, learner: me, scope: { subject: scope.subject }, size, nowISO: nowISO() });
    else {
      ids = buildSet({ items: mine, attempts, queue: [], learner: me, scope, size: size, nowISO: nowISO() });
      if (m === 'practice') ids = ids.map(id => mine.find(i => i.id === id)).sort((a, b) => a.chapterNo - b.chapterNo || a.no - b.no).map(i => i.id);
    }
    if (!ids.length) return toast('이 범위에는 지금 풀 문제가 없어요. 범위를 넓혀 보세요.');
    const list = ids.map(id => mine.find(i => i.id === id));
    const reveal = m === 'mock' ? 'after_submit' : f.reveal.value;
    startSession(list, {
      session: { mode: m, reveal: { answer: reveal, solution: reveal, retries: 1 }, shuffle: f.shuffle.value === '1' },
      ctx: { title: m === 'mock' ? '모의고사' : m === 'recommend' ? '맞춤 추천' : `${scope.subject} 단원 연습`, timer: m === 'mock' },
    });
  };
}

export async function notes() {
  const me = app.me;
  const [mine, attempts, queue] = await Promise.all([publicItems().then(l => l.filter(i => i.group === me.group)), app.store.attempts(me.id), app.store.reviewQueue(me.id)]);
  const byId = Object.fromEntries(mine.map(i => [i.id, i]));
  const m = conceptMastery(attempts, byId, nowISO());
  const last = {};
  for (const a of attempts) last[a.itemId] = a;
  const wrong = Object.values(last).filter(a => !a.correct && byId[a.itemId]).reverse();
  const concepts = Object.entries(m).sort((a, b) => (a[1].score ?? 0) - (b[1].score ?? 0));
  const qmap = Object.fromEntries(queue.map(q => [q.itemId, q]));
  const tc = await termContext();
  const confusing = tc.terms.filter(t => t.group === me.group && tc.states[t.id]?.confusing);
  const root = render(`
    <h1>오답노트</h1>
    <h2>개념별 숙련도</h2>
    ${concepts.length ? `<ul class="list">${concepts.map(([c, v]) => `<li><div class="item"><span style="flex:1">${esc(conceptName(c, mine))}
      <span class="meter"><i style="width:${v.status === 'insufficient' ? 0 : v.score}%"></i></span></span>
      <span class="meta"><span class="tag ${v.status === 'weak' ? 'weak' : ''}">${STATUS_NAME[v.status]}</span> ${v.status === 'insufficient' ? `${v.n}문항` : Math.round(v.score) + '점'}</span></div></li>`).join('')}</ul>
      <p class="small muted">3문항 이상 풀어야 숙련도를 판정해요. 최근 기록과 어려운 문제일수록 더 크게 반영돼요.</p>`
      : `<p class="empty">아직 푼 문제가 없어요. 공부 탭에서 시작해 보세요.</p>`}
    <h2>헷갈리는 용어 ${confusing.length}개</h2>
    ${confusing.length ? `<div class="chips">${confusing.map(t => `<button type="button" class="term-chip confusing" data-term="${esc(t.id)}">${esc(t.term)}</button>`).join('')}</div><p class="small muted">여러 번 찾아봤거나 관련 문제를 틀린 용어예요. 누르면 뜻을 다시 볼 수 있어요.</p>` : '<p class="empty">아직 헷갈리는 용어가 없어요.</p>'}
    <h2>틀린 문제 ${wrong.length}개</h2>
    ${wrong.length ? `<ul class="list">${wrong.map(a => { const it = byId[a.itemId]; const q = qmap[a.itemId]; return `<li><a href="#/result?item=${encodeURIComponent(it.id)}"><span style="flex:1"><span class="small muted">${esc(it.subject)} ${it.set} ${it.no}번</span><br>${esc(it.stem.split('\n')[0].slice(0, 60))}</span>
      <span class="meta">${q && !q.graduated ? (q.due <= today() ? '오늘 복습' : esc(q.due.slice(5).replace('-', '/')) + ' 복습') : ''}</span></a></li>`; }).join('')}</ul>` : `<p class="empty">틀린 문제가 없어요.</p>`}`);
  return root;
}
