import { app, render, go, esc, nowISO, toast, saveResults, publicItems, REVEAL_NAME, ask } from '../app.js';
import { LABELS, renumber } from '../src/session.js';
import { startSession } from './student.js';
import { termContext, itemMarks, marked, termChips } from './terms.js';
import { sanitizeSvg } from '../src/terms/sanitize.js';

const CIRCLE = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M33 6c15 0 26 11 25 26-1 14-13 25-27 25C16 57 6 46 7 31 8 17 20 7 36 9"/></svg>';
const SLASH = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M14 54L52 8"/></svg>';

// ---------- 빨간펜 해설 (공통) ----------
// item: 문항, chosen: 고른 보기(원래 번호) 또는 null, label: 원래 번호 → 표시 기호
export function feedbackHTML(item, chosen, label, { similar = true, tc = null, marks = null } = {}) {
  const map = Object.fromEntries(item.options.map(o => [o.n, LABELS.indexOf(label(o.n)) + 1]));
  const rn = (t) => marked(renumber(t, map), tc, marks);
  const correct = chosen === item.answer;
  const chosenOpt = item.options.find(o => o.n === chosen);
  const ans = item.options.find(o => o.n === item.answer);
  const others = item.options.filter(o => o.n !== item.answer && o.n !== chosen && o.why);
  const why = chosenOpt?.why;
  return `
  <section class="redpen" aria-label="빨간펜 해설">
    <p class="pen">${correct ? '잘했어! 정답이야.' : chosen ? `${label(chosen)}을 골랐구나. 왜 틀렸는지 먼저 보자.` : '이 문제는 답을 고르지 않았어.'}</p>
    ${tc && marks && marks.all.length ? `<div class="key-terms"><span class="small muted">이 문제의 핵심 용어</span><div class="chips">${termChips(tc, marks.all)}</div></div>` : ''}
    ${!correct && chosen ? `<h3>내가 고른 답 ${label(chosen)}</h3>
      <div class="callout">${why ? rn(why) : `<span class="small muted">자주 하는 실수</span>\n${rn(item.mistakes || '이 보기에 대한 해설은 아직 준비 중이에요.')}`}</div>` : ''}
    <h3>정답 ${label(item.answer)}</h3>
    <p>${rn(ans?.text)}</p>
    <h3>단계별 풀이</h3>
    <ol class="steps" id="steps">${item.steps.map((s, k) => `<li ${k ? 'hidden' : ''}>${rn(s)}</li>`).join('')}</ol>
    ${item.steps.length > 1 ? `<div class="row"><button class="btn ghost" type="button" id="nextStep">다음 단계 보기</button><button class="link" type="button" id="allSteps">모두 펼치기</button></div>` : ''}
    ${item.figure ? (() => { const svg = sanitizeSvg(item.figure, DOMParser, XMLSerializer); return svg ? `<figure class="why-fig" aria-label="풀이 그림">${svg}</figure>` : ''; })() : ''}
    ${others.length ? `<h3>다른 보기는 왜 틀렸을까</h3>${others.map(o => `<p><b>${label(o.n)}</b> ${rn(o.why)}</p>`).join('')}` : ''}
    ${correct && item.mistakes ? `<h3>자주 하는 실수</h3><p>${rn(item.mistakes)}</p>` : ''}
    ${item.tip || item.link ? `<h3>빨간펜 첨삭·팁</h3>${item.tip ? `<p>${rn(item.tip)}</p>` : ''}${item.link ? `<p class="small muted">${rn(item.link)}</p>` : ''}` : ''}
    <details class="card"><summary>개념 카드: ${esc(item.chapter)}</summary><p>${rn(item.core)}</p>${item.source ? `<p class="small muted">출처: ${esc(item.source)}</p>` : ''}</details>
    <div class="row" style="margin-top:12px">
      ${similar ? `<button class="btn ghost" type="button" id="similar">비슷한 문제 하나 더</button>` : ''}
      <button class="link" type="button" id="report">문제가 이상해요</button>
    </div>
  </section>`;
}

export function wireFeedback(root, item) {
  const steps = [...root.querySelectorAll('#steps li')];
  root.querySelector('#nextStep')?.addEventListener('click', (e) => {
    const nxt = steps.find(li => li.hidden); if (nxt) nxt.hidden = false;
    if (!steps.some(li => li.hidden)) e.target.disabled = true;
  });
  root.querySelector('#allSteps')?.addEventListener('click', () => { steps.forEach(li => li.hidden = false); const b = root.querySelector('#nextStep'); if (b) b.disabled = true; });
  root.querySelector('#report')?.addEventListener('click', async () => {
    const note = await ask('어떤 점이 이상한가요? 보호자에게 전달돼요.', { input: true, ok: '보내기', placeholder: '예: 2번 보기에 오타가 있어요' });
    if (note == null) return;
    await app.store.reportItem(item.id, note);
    toast('보호자에게 알렸어요. 고쳐질 때까지 이 문제는 나오지 않아요.');
  });
  root.querySelector('#similar')?.addEventListener('click', async () => {
    const attempts = await app.store.attempts(app.me.id);
    const done = new Set(attempts.map(a => a.itemId));
    const pool = (await publicItems()).filter(i => i.group === app.me.group && i.concept === item.concept && i.id !== item.id);
    const pick = pool.find(i => !done.has(i.id)) || pool[0];
    if (!pick) return toast('같은 단원의 다른 문제가 아직 없어요.');
    startSession([pick], { session: { mode: 'practice', reveal: { answer: 'immediate', solution: 'immediate' }, shuffle: false }, ctx: { title: '비슷한 문제' } });
  });
}

const markHTML = (n, mark, anim = false) => `<span class="qnum${anim ? ' anim' : ''}">${n}${mark === 'o' ? CIRCLE : mark === 'x' ? SLASH : ''}</span>`;

// ---------- 문제 풀기 ----------
export async function solveView(params) {
  const cur = app.current;
  if (!cur) return go('#/home');
  const s = cur.session;
  const i = Math.min(Math.max(+(params.i ?? cur.at), 0), s.length - 1);
  cur.at = i;
  const justGraded = cur.justGraded; cur.justGraded = null;
  const deferred = ['after_submit', 'after_due', 'after_parent'].includes(s.reveal.answer);
  const item = s.items[i];
  const v = s.view(i);
  const st = s.state(i);
  const showFeedback = st.done && s.canSeeSolution(i, nowISO());
  const answerShown = st.done && s.canSeeAnswer(i, nowISO());
  const mark = answerShown ? (st.correct ? 'o' : 'x') : null;
  const strip = deferred ? `<nav class="strip" aria-label="문항 이동">${s.items.map((_, k) => `<a href="#/solve?i=${k}" class="${s.state(k).current != null ? 'done' : ''}" ${k === i ? 'aria-current="true"' : ''}>${k + 1}</a>`).join('')}</nav>` : '';
  const conf = cur.conf ?? 'sure';
  const tc = await termContext();
  const mk = itemMarks(tc, item);
  const root = render(`
    <p class="small muted">${esc(cur.ctx.title || '')} · ${i + 1} / ${s.length}${cur.ctx.timer ? ` · <span id="clock"></span>` : ''}</p>
    ${strip}
    <div class="qhead">${markHTML(i + 1, mark, justGraded === i)}<span>${esc(item.subject)} ${esc(item.set)} ${item.no}번 · ${item.chapterNo}장 ${esc(item.chapter)}</span></div>
    <div class="stem">${marked(v.stem, tc, mk)}</div>
    <ul class="omr">${v.options.map(o => {
      const pressed = st.current === o.orig;
      const isAns = answerShown && o.orig === item.answer;
      return `<li><button type="button" class="opt ${isAns ? 'is-answer' : ''}" aria-pressed="${pressed}" data-label="${o.label}" ${st.done || s.submitted ? 'aria-disabled="true"' : ''}><span class="bubble">${LABELS.indexOf(o.label) + 1}</span><span class="opt-text">${marked(o.text, tc, mk, { inButton: true })}</span></button></li>`;
    }).join('')}</ul>
    ${!st.done && !s.submitted ? `
      <div id="hintBox"></div>
      <fieldset><legend>얼마나 자신 있어?</legend><div class="chips">
        ${[['sure', '확실해'], ['unsure', '헷갈려'], ['guess', '모르겠어']].map(([k, t]) => `<label class="chip"><input type="radio" name="conf" value="${k}" ${conf === k ? 'checked' : ''}><span>${t}</span></label>`).join('')}
      </div></fieldset>
      <div class="row"><button class="btn" id="confirm" type="button" ${st.current == null ? 'disabled' : ''}>${deferred ? '이 답으로 정하기' : '확정하기'}</button><button class="btn ghost" id="hint" type="button">힌트</button></div>` : ''}
    <div id="fb">${showFeedback ? feedbackHTML(item, st.current ?? null, (n) => s.labelOf(i, n), { tc, marks: mk }) : st.done && !answerShown && !deferred ? '' : ''}</div>
    <div class="row" style="margin-top:20px">
      ${i > 0 ? `<a class="btn ghost" href="#/solve?i=${i - 1}">이전</a>` : ''}
      ${i < s.length - 1 ? `<a class="btn ghost" href="#/solve?i=${i + 1}" id="next">다음 문제</a>` : ''}
      ${i === s.length - 1 || deferred ? `<button class="btn" id="finish" type="button">${deferred ? '제출하기' : '끝내기'}</button>` : ''}
    </div>`);

  root.querySelectorAll('.opt').forEach(b => b.onclick = (e) => {
    if (e.target.closest('.term-mark') || b.getAttribute('aria-disabled') === 'true') return;
    s.choose(i, b.dataset.label);
    root.querySelectorAll('.opt').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    root.querySelector('#confirm').disabled = false;
  });
  root.querySelectorAll('[name=conf]').forEach(r => r.onchange = () => { cur.conf = r.value; });
  let hintUsed = false;
  root.querySelector('#hint')?.addEventListener('click', () => {
    hintUsed = true;
    const h = item.hint || (item.core || '').split(/(?<=[.!?다요])\s/)[0];
    root.querySelector('#hintBox').innerHTML = `<p class="callout"><span class="pen" style="font-size:21px">힌트</span>\n${esc(renumber(h, s.optionMap(i)))}</p>`;
  });
  const t0 = Date.now();
  root.querySelector('#confirm')?.addEventListener('click', () => {
    const r = s.confirm(i, { confidence: cur.conf ?? 'sure', hintUsed, ms: Date.now() - t0, at: nowISO() });
    cur.conf = 'sure';
    if (r.graded && !r.retryAllowed) cur.justGraded = i;
    if (!r.graded) return go(i < s.length - 1 ? `#/solve?i=${i + 1}` : `#/solve?i=${i}&t=${Date.now()}`);
    if (r.retryAllowed) { toast('아쉬워! 힌트를 보고 한 번 더 골라 보자.'); return solveView({ i }); }
    solveView({ i });
  });
  root.querySelector('#finish')?.addEventListener('click', async () => {
    if (deferred) {
      const blank = s.items.filter((_, k) => s.state(k).current == null).length;
      const msg = blank ? `아직 안 푼 문제가 ${blank}개 있어요. 제출하면 답을 바꿀 수 없어요.` : '제출하면 답을 바꿀 수 없어요. 제출할까요?';
      if (!(await ask(msg, { ok: '제출하기', cancel: '계속 풀기' }))) return;
    }
    s.submit(nowISO());
    try { await saveResults(s.attempts(), { assignment: cur.ctx.assignment }); }
    catch (e) { return toast('저장하지 못했어요: ' + e.message); }
    go('#/result');
  });
  if (showFeedback) wireFeedback(root, item);
  if (cur.ctx.timer) {
    const el = root.querySelector('#clock');
    const tick = () => { if (!document.body.contains(el)) return clearInterval(id); const sec = Math.floor((Date.now() - cur.startedAt) / 1000); el.textContent = `${Math.floor(sec / 60)}분 ${sec % 60}초`; };
    const id = setInterval(tick, 1000); tick();
  }
}

// ---------- 결과 ----------
export async function resultView(params) {
  if (params.item) return singleItem(params.item);
  const cur = app.current;
  if (!cur) return go('#/home');
  const s = cur.session;
  const sc = s.score();
  const now = nowISO();
  const anyLocked = s.items.some((_, k) => !s.canSeeSolution(k, now));
  render(`
    <h1>${esc(cur.ctx.title || '결과')}</h1>
    ${s.items.every((_, k) => s.canSeeAnswer(k, now)) ? `<p class="score">${sc.correct} / ${sc.total}</p>` : `<p class="muted">제출했어요. 정답은 ${esc(REVEAL_NAME[s.reveal.answer])} 볼 수 있어요.</p>`}
    ${anyLocked ? `<p class="locked">풀이는 ${esc(REVEAL_NAME[s.reveal.solution])} 열려요.${cur.ctx.assignment ? ' 공부 탭의 "끝낸 과제 다시 보기"에서 확인할 수 있어요.' : ''}</p>` : ''}
    <ul class="list">${s.items.map((it, k) => { const st = s.state(k); const seen = s.canSeeAnswer(k, now); return `<li><a href="#/solve?i=${k}"><span>${markHTML(k + 1, seen ? (st.correct ? 'o' : 'x') : null)}</span><span style="flex:1">${esc(it.stem.split('\n')[0].slice(0, 50))}</span><span class="meta">${seen ? (st.correct ? '정답' : '오답') : '채점 대기'}</span></a></li>`; }).join('')}</ul>
    <div class="row" style="margin-top:20px"><a class="btn" href="#/home">공부 탭으로</a><a class="btn ghost" href="#/notes">오답노트</a></div>`);
}

async function singleItem(id) {
  const it = (await publicItems()).find(i => i.id === id);
  if (!it) return go('#/notes');
  const attempts = (await app.store.attempts(app.me.id)).filter(a => a.itemId === id);
  const last = attempts[attempts.length - 1];
  const label = (n) => LABELS[n - 1];
  const tc = await termContext();
  const mk = itemMarks(tc, it);
  const root = render(`
    <p class="small muted">오답노트</p>
    <div class="qhead">${markHTML(it.no, last ? (last.correct ? 'o' : 'x') : null)}<span>${esc(it.subject)} ${esc(it.set)} · ${it.chapterNo}장 ${esc(it.chapter)}</span></div>
    <div class="stem">${marked(it.stem, tc, mk)}</div>
    <ul class="omr">${it.options.map(o => `<li><button type="button" class="opt ${o.n === it.answer ? 'is-answer' : ''}" aria-pressed="${last?.finalChoice === o.n}" aria-disabled="true"><span class="bubble">${o.n}</span><span class="opt-text">${marked(o.text, tc, mk, { inButton: true })}</span></button></li>`).join('')}</ul>
    ${feedbackHTML(it, last?.finalChoice ?? null, label, { tc, marks: mk })}
    <div class="row"><button class="btn" id="again" type="button">다시 풀어보기</button></div>`);
  wireFeedback(root, it);
  root.querySelector('#again').onclick = () => startSession([it], { session: { mode: 'review', reveal: { answer: 'immediate', solution: 'immediate' }, shuffle: true }, ctx: { title: '다시 풀어보기' } });
}

// ---------- 과제 ----------
export async function assignmentView(params) {
  const a = (await app.store.assignments()).find(x => x.id === params.id);
  if (!a) return go('#/home');
  const byId = Object.fromEntries((await publicItems()).map(i => [i.id, i]));
  const list = a.itemIds.map(id => byId[id]).filter(Boolean);
  if (a.status !== 'done') {
    const root = render(`<h1>${esc(a.title || '과제')}</h1>
      <p>${list.length}문항${a.dueAt ? ` · ${esc(a.dueAt.slice(0, 10))}까지` : ''}</p>
      <p class="muted">정답은 ${esc(REVEAL_NAME[a.reveal?.answer] || '바로')}, 풀이는 ${esc(REVEAL_NAME[a.reveal?.solution] || '바로')} 볼 수 있어요.</p>
      <button class="btn wide" id="go" type="button">과제 시작</button>`);
    root.querySelector('#go').onclick = () => startSession(list, {
      session: { mode: 'assignment', reveal: { retries: 1, ...a.reveal }, shuffle: false, dueAt: a.dueAt, parentReleased: a.released },
      ctx: { title: a.title || '과제', assignment: a },
    });
    return;
  }
  // 끝낸 과제: 기록으로 결과를 다시 보여준다
  const attempts = (await app.store.attempts(app.me.id)).filter(x => a.itemIds.includes(x.itemId));
  const last = {}; for (const x of attempts) last[x.itemId] = x;
  const now = nowISO();
  const timingOk = (t) => t === 'after_due' ? (!a.dueAt || now >= a.dueAt) : t === 'after_parent' ? a.released : true;
  const ansOk = timingOk(a.reveal?.answer), solOk = ansOk && timingOk(a.reveal?.solution);
  const n = Number(params.n ?? -1);
  if (n >= 0 && list[n]) {
    const it = list[n], at = last[it.id];
    const label = (k) => LABELS[k - 1];
    const tc = await termContext();
    const mk = itemMarks(tc, it);
    const root = render(`<p class="small muted">${esc(a.title || '과제')} · ${n + 1}/${list.length}</p>
      <div class="qhead">${markHTML(n + 1, ansOk && at ? (at.correct ? 'o' : 'x') : null)}</div>
      <div class="stem">${marked(it.stem, tc, mk)}</div>
      <ul class="omr">${it.options.map(o => `<li><button type="button" class="opt ${ansOk && o.n === it.answer ? 'is-answer' : ''}" aria-pressed="${at?.finalChoice === o.n}" aria-disabled="true"><span class="bubble">${o.n}</span><span class="opt-text">${marked(o.text, tc, mk, { inButton: true })}</span></button></li>`).join('')}</ul>
      ${solOk ? feedbackHTML(it, at?.finalChoice ?? null, label, { tc, marks: mk }) : `<p class="locked">풀이는 ${esc(REVEAL_NAME[a.reveal?.solution])} 열려요.</p>`}
      <div class="row" style="margin-top:16px"><a class="btn ghost" href="#/assignment?id=${encodeURIComponent(a.id)}">목록</a></div>`);
    if (solOk) wireFeedback(root, it);
    return;
  }
  const correct = list.filter(it => last[it.id]?.correct).length;
  render(`<h1>${esc(a.title || '과제')}</h1>
    ${ansOk ? `<p class="score">${correct} / ${list.length}</p>` : `<p class="locked">정답은 ${esc(REVEAL_NAME[a.reveal?.answer])} 열려요.</p>`}
    <ul class="list">${list.map((it, k) => `<li><a href="#/assignment?id=${encodeURIComponent(a.id)}&n=${k}"><span>${markHTML(k + 1, ansOk && last[it.id] ? (last[it.id].correct ? 'o' : 'x') : null)}</span><span style="flex:1">${esc(it.stem.split('\n')[0].slice(0, 50))}</span></a></li>`).join('')}</ul>`);
}
