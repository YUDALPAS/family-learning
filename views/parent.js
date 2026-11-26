import { SET_SIZES, DEFAULT_SIZE } from '../src/sizes.js';
import { app, render, go, esc, pct, nowISO, toast, items, conceptName, GROUP_NAME, REVEAL_NAME, ask } from '../app.js';
import { weeklyReport } from '../src/analysis/report.js';
import { conceptMastery } from '../src/analysis/mastery.js';
import { behaviorSignals, buildSet } from '../src/analysis/recommend.js';
import { docxXmlToLines } from '../src/parser/lines.js';
import { parseSolutionBook, metaFromFilename, SUBJECT_CODES } from '../src/parser/parse.js';
import { parseTermBook, isTermBook } from '../src/terms/parse.js';
import { termState, TERM_RULES } from '../src/terms/state.js';
import { loadTerms } from './terms.js';
import { isWhyBook, parseWhyBook, applyWhys } from '../src/whys/parse.js';

const STATUS_NAME = { mastered: '숙달', ok: '보통', weak: '약점', insufficient: '자료 부족' };

export async function dashboard() {
  const [learners, all, asg, reports, requests] = await Promise.all([app.store.learners(), items(), app.store.assignments(), app.store.reports(), app.store.requests()]);
  const now = nowISO();
  const cards = await Promise.all(learners.map(async l => {
    const at = await app.store.attempts(l.id);
    const r = weeklyReport(at, all.filter(i => i.group === l.group), asg.filter(a => a.learnerId === l.id), now);
    return { l, r };
  }));
  const waiting = asg.filter(a => a.status === 'done' && a.reveal?.solution === 'after_parent' && !a.released);
  const root = render(`
    <h1>보호자</h1>
    <div class="row"><a class="btn" href="#/assign">과제 내기</a><a class="btn ghost" href="#/upload">문제 올리기</a></div>
    <h2>이번 주</h2>
    <ul class="list">${cards.map(({ l, r }) => `<li><a href="#/learner?id=${encodeURIComponent(l.id)}"><span style="flex:1"><b>${esc(l.nickname)}</b> <span class="small muted">${GROUP_NAME[l.group]}</span><br>
      <span class="small">${r.days}일 공부 · ${r.count}문항 · 과제 ${r.assignmentRate == null ? '없음' : pct(r.assignmentRate)}</span>
      ${r.weak.length ? `<br><span class="small"><span class="tag weak">약점</span> ${r.weak.map(w => esc(conceptName(w.concept, all))).join(', ')}</span>` : ''}</span>
      <span class="meta">자세히</span></a></li>`).join('')}</ul>
    ${waiting.length ? `<h2>풀이를 열어줄 과제</h2><ul class="list">${waiting.map(a => `<li><div class="item"><span style="flex:1">${esc(learners.find(l => l.id === a.learnerId)?.nickname || '')} · ${esc(a.title || '과제')}</span><button class="btn ghost" data-release="${esc(a.id)}" type="button">풀이 열기</button></div></li>`).join('')}</ul>` : ''}
    <h2>확인할 일</h2>
    <ul class="list">
      <li><a href="#/settings?go=reports">신고된 문제<span class="meta">${new Set(reports.filter(r => all.find(i => i.id === r.itemId)?.status === 'reported').map(r => r.itemId)).size}개</span></a></li>
      <li><a href="#/settings?go=requests">문제 요청 목록<span class="meta">${requests.filter(r => !r.done).length}개</span></a></li>
      <li><a href="#/settings">과목·학기 설정</a></li>
    </ul>`);
  root.querySelectorAll('[data-release]').forEach(b => b.onclick = async () => { await app.store.releaseSolutions(b.dataset.release); toast('풀이를 열었어요.'); dashboard(); });
}

export async function learner(params) {
  const learners = await app.store.learners();
  const l = learners.find(x => x.id === params.id);
  if (!l) return go('#/parent');
  const all = (await items()).filter(i => i.group === l.group);
  const [at, asg] = await Promise.all([app.store.attempts(l.id), app.store.assignments(l.id)]);
  const now = nowISO();
  const r = weeklyReport(at, all, asg, now);
  const m = conceptMastery(at, Object.fromEntries(all.map(i => [i.id, i])), now);
  const sig = behaviorSignals(at.slice(-60));
  const dict = await loadTerms();
  const [tev, prog] = await Promise.all([app.store.termEvents(l.id), app.store.progress(l.id)]);
  const byTerm = {}; for (const e of tev) (byTerm[e.termId] ||= []).push(e);
  const weekAgo = new Date(Date.parse(now) - 7 * 864e5).toISOString();
  const tstates = dict.terms.filter(t => t.group === l.group).map(t => ({ t, ev: byTerm[t.id] || [], s: termState((byTerm[t.id] || []).sort((a, b) => a.at.localeCompare(b.at)), { reached: prog[t.subject] != null && t.unit <= prog[t.subject] }, now, TERM_RULES) }));
  const confusingTop = tstates.filter(x => x.s.confusing).sort((a, b) => b.s.opens - a.s.opens).slice(0, 5);
  const knownThisWeek = tstates.filter(x => x.s.state === 'known' && x.ev.some(e => e.at >= weekAgo)).length;
  const tips = [];
  if (sig.fastWrong) tips.push('최근 빨리 풀고 틀린 문제가 많아요. "문제에 밑줄 치고 다시 읽기"를 권해 주세요.');
  if (sig.switchers.length >= 3) tips.push(`답을 바꾼 문제가 ${sig.switchers.length}개예요. 두 보기의 차이를 비교하는 개념 카드를 함께 보면 좋아요.`);
  if (r.flags.length) tips.push(`굳어진 오개념: ${r.flags.join(', ')}`);
  render(`
    <p class="small muted"><a href="#/parent">보호자</a></p>
    <h1>${esc(l.nickname)}의 주간 리포트</h1>
    <table class="simple"><tr><th>공부한 날</th><td>${r.days}일</td></tr><tr><th>푼 문항</th><td>${r.count}개</td></tr><tr><th>과제 완료</th><td>${r.assignmentRate == null ? '이번 주 마감 과제 없음' : pct(r.assignmentRate)}</td></tr></table>
    <h2>과목별 정답률</h2>
    <table class="simple"><tr><th>과목</th><th>이번 주</th><th>지난주</th></tr>${r.bySubject.map(s => `<tr><td>${esc(s.subject)}</td><td>${pct(s.rate)}</td><td>${pct(s.prevRate)}</td></tr>`).join('')}</table>
    <h2>개념별 숙련도</h2>
    ${Object.keys(m).length ? `<table class="simple"><tr><th>개념</th><th>상태</th><th>점수</th></tr>${Object.entries(m).sort((a, b) => (a[1].score ?? 0) - (b[1].score ?? 0)).map(([c, v]) => `<tr><td>${esc(conceptName(c, all))}</td><td><span class="tag ${v.status === 'weak' ? 'weak' : ''}">${STATUS_NAME[v.status]}</span></td><td>${v.status === 'insufficient' ? `${v.n}문항` : Math.round(v.score)}</td></tr>`).join('')}</table>` : '<p class="empty">아직 기록이 없어요.</p>'}
    <h2>용어</h2>
    <p>이번 주 익힌 용어 <b>${knownThisWeek}개</b></p>
    ${confusingTop.length ? `<p class="small muted">헷갈리는 용어 Top ${confusingTop.length}</p><div class="chips">${confusingTop.map(x => `<button type="button" class="term-chip confusing" data-term="${esc(x.t.id)}">${esc(x.t.term)} · ${x.s.opens}번 찾아봄</button>`).join('')}</div>` : '<p class="small muted">헷갈리는 용어가 아직 없어요.</p>'}
    ${tips.length ? `<h2>학습 방법 제안</h2><ul>${tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    <div class="row" style="margin-top:20px"><a class="btn" href="#/assign?learner=${encodeURIComponent(l.id)}&weak=1">약점 위주 과제 만들기</a></div>`);
}

export async function assign(params) {
  const learners = await app.store.learners();
  const all = (await items()).filter(i => i.status !== 'reported');
  const lid = params.learner || learners.find(l => l.role === 'student')?.id || learners[0].id;
  const l = learners.find(x => x.id === lid);
  const mine = all.filter(i => i.group === l.group);
  let subject = params.subject || [...new Set(mine.map(i => i.subject))][0] || '';
  let chapterNo = '';
  if (params.weak) {
    const at = await app.store.attempts(l.id);
    const m = conceptMastery(at, Object.fromEntries(mine.map(i => [i.id, i])), nowISO());
    const worst = Object.entries(m).filter(([, v]) => v.status === 'weak').sort((a, b) => a[1].score - b[1].score)[0];
    const it = worst && mine.find(i => i.concept === worst[0]);
    if (it) { subject = it.subject; chapterNo = it.chapterNo; }
  }
  const chapters = [...new Map(mine.filter(i => i.subject === subject).map(i => [i.chapterNo, i.chapter])).entries()].sort((a, b) => a[0] - b[0]);
  const sets = [...new Set(mine.filter(i => i.subject === subject).map(i => i.set))];
  const due = new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10);
  const opt = (v, t, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(t)}</option>`;
  const revealOpts = (sel) => Object.entries(REVEAL_NAME).map(([k, t]) => opt(k, t, k === sel)).join('');
  const root = render(`
    <p class="small muted"><a href="#/parent">보호자</a></p>
    <h1>과제 내기</h1>
    <form id="f">
      <label class="field">누구에게<select name="learner">${learners.map(x => opt(x.id, `${x.nickname} (${GROUP_NAME[x.group]})`, x.id === lid)).join('')}</select></label>
      ${mine.length ? `
      <label class="field">과목<select name="subject">${[...new Set(mine.map(i => i.subject))].map(s => opt(s, s, s === subject)).join('')}</select></label>
      <label class="field">문제집<select name="set">${opt('', '전체', true)}${sets.map(s => opt(s, s)).join('')}</select></label>
      <label class="field">단원<select name="chapter">${opt('', '전체', !chapterNo)}${chapters.map(([n, c]) => opt(n, `${n}장 ${c}`, n === chapterNo)).join('')}</select></label>
      <label class="field">문항 수<select name="size">${SET_SIZES.map(n => opt(n, `${n}문항`, n === DEFAULT_SIZE)).join('')}</select></label>
      <label class="field">마감일<input name="due" type="date" value="${due}"></label>
      <label class="field">정답은 언제 보여줄까요<select name="answer">${revealOpts('after_submit')}</select></label>
      <label class="field">풀이는 언제 열까요<select name="solution">${revealOpts('after_submit')}</select></label>
      <label class="field">제목<input name="title" value="${esc(subject)} ${chapterNo ? chapterNo + '장 ' : ''}과제"></label>
      <button class="btn wide" type="submit">과제 보내기</button>` : `<p class="empty">${esc(l.nickname)}의 학습자군(${GROUP_NAME[l.group]})에는 아직 문제가 없어요. 먼저 문제를 올려 주세요.</p>`}
    </form>`);
  const f = root.querySelector('#f');
  f.elements.learner.onchange = () => go(`#/assign?learner=${encodeURIComponent(f.elements.learner.value)}`);
  if (!mine.length) return;
  f.elements.subject.onchange = () => go(`#/assign?learner=${encodeURIComponent(lid)}&subject=${encodeURIComponent(f.elements.subject.value)}`);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const E = f.elements;
    const scope = { subject: E.subject.value, set: E.set.value || undefined, chapterNo: E.chapter.value ? +E.chapter.value : undefined };
    const at = await app.store.attempts(l.id);
    const ids = buildSet({ items: mine, attempts: at, queue: [], learner: l, scope, size: +E.size.value || 10, nowISO: nowISO() });
    if (!ids.length) return toast('이 범위에는 낼 문제가 없어요.');
    const ordered = ids.map(id => mine.find(i => i.id === id)).sort((a, b) => a.difficulty - b.difficulty || a.chapterNo - b.chapterNo || a.no - b.no).map(i => i.id);
    let answer = E.answer.value, solution = E.solution.value;
    const rank = ['immediate', 'after_retry', 'after_submit', 'after_due', 'after_parent'];
    if (rank.indexOf(solution) < rank.indexOf(answer)) solution = answer;
    await app.store.saveAssignment({ learnerId: l.id, title: E.title.value, scope, size: ordered.length, dueAt: new Date(E.due.value + 'T23:59:59+09:00').toISOString(), reveal: { answer, solution, retries: 1 }, itemIds: ordered });
    toast(`${l.nickname}에게 ${ordered.length}문항 과제를 보냈어요.${ordered.length < +E.size.value ? ' (범위 안 문제가 그만큼이에요)' : ''}`);
    go('#/parent');
  };
}

export async function upload() {
  const groups = Object.entries(GROUP_NAME);
  const root = render(`
    <p class="small muted"><a href="#/parent">보호자</a></p>
    <h1>문제 올리기</h1>
    <p class="muted">풀이서, 개념 사전, 보기해설(docx)을 고르면 내용을 읽어 미리 보여줘요. 같은 풀이서를 다시 올려도 중복되지 않고, 사전과 보기해설은 고친 내용으로 바뀌어요.</p>
    <label class="field">학습자군<select id="grp">${groups.map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
    <label class="field">풀이서·사전·보기해설 파일<input id="file" type="file" accept=".docx" multiple></label>
    <div id="preview"></div>`);
  let parsed = [];
  let book = { terms: [], links: [], warnings: [] };
  let whys = [];
  root.querySelector('#file').onchange = async (e) => {
    const out = root.querySelector('#preview');
    out.innerHTML = '<p class="muted">읽는 중…</p>';
    parsed = [];
    book = { terms: [], links: [], warnings: [] };
    whys = [];
    const rows = [];
    for (const file of e.target.files) {
      try {
        const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
        const xml = await zip.file('word/document.xml').async('string');
        const lines = docxXmlToLines(xml, DOMParser);
        if (isWhyBook(lines)) {
          const b = parseWhyBook(lines);
          const r = applyWhys(await items(), b);
          whys.push(...r.updated);
          const warn = [...r.warnings, ...(r.missing.length ? [`문항을 찾지 못함: ${r.missing.join(', ')}`] : []), ...(r.mismatched.length ? [`문제 내용이 달라 건너뜀: ${r.mismatched.join(', ')}`] : [])];
          rows.push({ name: file.name, n: r.updated.length, warnings: warn, why: true, figs: r.updated.filter(u => u.figure).length, meta: { subject: b.subject || '', set: '보기해설' } });
          continue;
        }
        if (isTermBook(lines)) {
          const b = parseTermBook(lines, { group: root.querySelector('#grp').value });
          book.terms.push(...b.terms); book.links.push(...b.links); book.warnings.push(...b.warnings);
          rows.push({ name: file.name, n: b.terms.length, warnings: b.warnings, dict: true, meta: { subject: b.terms[0]?.subject || '', set: '개념 사전' } });
          continue;
        }
        const meta = { ...metaFromFilename(file.name), group: root.querySelector('#grp').value };
        const { items: got, warnings } = parseSolutionBook(lines, meta);
        parsed.push(...got);
        rows.push({ name: file.name, n: got.length, warnings, meta });
      } catch (err) { rows.push({ name: file.name, n: 0, warnings: ['파일을 읽지 못했어요: ' + err.message] }); }
    }
    const first = parsed[0];
    out.innerHTML = `
      <table class="simple"><tr><th>파일</th><th>과목·문제집</th><th>문항</th></tr>${rows.map(r => `<tr><td>${esc(r.name)}${r.warnings.length ? `<br><span class="small" style="color:var(--pen)">${r.warnings.slice(0, 3).map(esc).join('<br>')}${r.warnings.length > 3 ? ` 외 ${r.warnings.length - 3}건` : ''}</span>` : ''}</td><td>${r.meta ? `${esc(r.meta.subject)} ${esc(r.meta.set)}` : ''}${r.meta && !SUBJECT_CODES[r.meta.subject] ? '<br><span class="small muted">새 과목</span>' : ''}</td><td>${r.dict ? `용어 ${r.n}개` : r.why ? `해설 ${r.n}문항${r.figs ? ` · 그림 ${r.figs}` : ''}` : r.n}</td></tr>`).join('')}</table>
      ${first ? `<h2>첫 문항 미리보기</h2><p class="small muted">${esc(first.subject)} ${esc(first.set)} ${first.no}번 · ${first.chapterNo}장 ${esc(first.chapter)}</p><p style="white-space:pre-wrap">${esc(first.stem)}</p><ol style="list-style:none;padding:0">${first.options.map(o => `<li ${o.n === first.answer ? 'style="color:var(--pen);font-weight:700"' : ''}>${'①②③④'[o.n - 1]} ${esc(o.text)}</li>`).join('')}</ol>` : ''}
      ${book.terms.length ? `<p>개념 사전 <b>용어 ${book.terms.length}개</b>, 연결 ${book.links.length}개${book.terms.filter(t => t.figure).length ? `, 그림 ${book.terms.filter(t => t.figure).length}개` : ''}</p>` : ''}
      ${parsed.length || book.terms.length || whys.length ? `<button class="btn wide" id="save" type="button">${[parsed.length ? `${parsed.length}문항` : '', book.terms.length ? `용어 ${book.terms.length}개` : '', whys.length ? `보기해설 ${whys.length}문항` : ''].filter(Boolean).join(' · ')} 공개하기</button>` : '<p class="empty">읽은 내용이 없어요. 풀이서나 사전 양식이 맞는지 확인해 주세요.</p>'}`;
    out.querySelector('#save')?.addEventListener('click', async (ev) => {
      ev.target.disabled = true;
      try {
        const msgs = [];
        if (parsed.length) {
          const r = await app.store.upsertItems(parsed);
          await items(true);
          msgs.push(`새 문항 ${r.inserted}개${r.skipped ? `(이미 있던 ${r.skipped}개 건너뜀)` : ''}`);
        }
        if (whys.length) {
          const r = await app.store.updateItems(whys);
          await items(true);
          msgs.push(`보기해설 ${r.updated}문항`);
        }
        if (book.terms.length) {
          const r = await app.store.upsertTerms(book.terms, book.links);
          await loadTerms(true);
          msgs.push(`용어 새로 ${r.inserted}개·고침 ${r.updated}개`);
        }
        toast(msgs.join(', ') + '를 올렸어요.');
        go('#/parent');
      } catch (err) { ev.target.disabled = false; toast('올리지 못했어요: ' + err.message); }
    });
  };
}

export async function settings(params = {}) {
  const [subjects, reports, requests, all] = await Promise.all([app.store.subjects(), app.store.reports(), app.store.requests(), items()]);
  const learners = await app.store.learners();
  const dict = await loadTerms();
  const progressOf = Object.fromEntries(await Promise.all(learners.map(async l => [l.id, await app.store.progress(l.id)])));
  const progressRows = learners.flatMap(l => {
    const subs = [...new Set([...all.filter(i => i.group === l.group).map(i => i.subject), ...dict.terms.filter(t => t.group === l.group).map(t => t.subject)])];
    return subs.map(sub => {
      const maxUnit = Math.max(1, ...all.filter(i => i.group === l.group && i.subject === sub).map(i => i.chapterNo), ...dict.terms.filter(t => t.group === l.group && t.subject === sub).map(t => t.unit));
      return { l, sub, maxUnit, cur: progressOf[l.id][sub] };
    });
  });
  const open = requests.filter(r => !r.done);
  const stillReported = reports.filter(r => !r.resolved && all.find(i => i.id === r.itemId)?.status === 'reported').filter((r, k, arr) => arr.findIndex(x => x.itemId === r.itemId) === k);
  const reqText = open.map(r => `- ${learners.find(l => l.id === r.learnerId)?.nickname ?? ''} / ${conceptName(r.concept, all)}${r.misconception ? ` / 오개념 ${r.misconception}` : ''} / ${r.reason}`).join('\n');
  const root = render(`
    <p class="small muted"><a href="#/parent">보호자</a></p>
    <h1>설정</h1>
    <h2 id="progress">진도 (현재 단원)</h2>
    <p class="small muted">정한 단원까지의 용어에만 ⚠가 붙어요. '정하지 않음'이면 그 과목의 모든 용어에 붙어요.</p>
    ${progressRows.length ? `<table class="simple"><tr><th>학습자</th><th>과목</th><th>현재 단원</th></tr>${progressRows.map(r => `<tr><td>${esc(r.l.nickname)}</td><td>${esc(r.sub)}</td><td><select data-progress="${esc(r.l.id)}|${esc(r.sub)}" style="min-height:40px;border:1.5px solid var(--line);border-radius:6px"><option value="">정하지 않음</option>${Array.from({ length: r.maxUnit }, (_, k) => k + 1).map(u => `<option value="${u}" ${r.cur === u ? 'selected' : ''}>${u}장(강)</option>`).join('')}</select></td></tr>`).join('')}</table>` : '<p class="empty">과목이 없어요.</p>'}
    <h2>과목별 학년·학기</h2>
    <table class="simple"><tr><th>과목</th><th>학년·학기</th></tr>${subjects.map((s, k) => `<tr><td>${esc(s.subject)} <span class="small muted">${GROUP_NAME[s.group]}</span></td><td><input data-k="${k}" value="${esc(s.gradeTerm || '')}" style="width:100%;min-height:40px;border:1.5px solid var(--line);border-radius:6px;padding:4px 8px"></td></tr>`).join('')}</table>
    <h2 id="reports">신고된 문제</h2>
    ${stillReported.length ? `<ul class="list">${stillReported.map(r => { const it = all.find(i => i.id === r.itemId); return `<li><div class="item"><span style="flex:1">${esc(it ? `${it.subject} ${it.set} ${it.no}번` : r.itemId)}<br><span class="small muted">${esc(r.note || '')}</span></span><button class="btn ghost" data-ok="${esc(r.itemId)}" type="button">다시 출제</button></div></li>`; }).join('')}</ul>` : '<p class="empty">신고된 문제가 없어요.</p>'}
    <h2 id="requests">문제 요청 목록</h2>
    ${open.length ? `<p class="muted small">약점 개념에 풀 문제가 모자랄 때 자동으로 쌓여요. 아래 내용을 복사해 쪼에게 주면 같은 양식으로 문제를 만들어 드려요.</p><pre class="copy" id="req">${esc(reqText)}</pre><button class="btn ghost" id="copy" type="button">목록 복사</button>` : '<p class="empty">요청이 없어요.</p>'}
    ${app.store.kind === 'local' ? `<h2>체험판</h2><button class="btn ghost" id="reset" type="button">체험 기록 모두 지우기</button>` : ''}`);
  root.querySelectorAll('[data-progress]').forEach(sel => sel.onchange = async () => {
    const [lid, sub] = sel.dataset.progress.split('|');
    await app.store.setProgress(lid, sub, sel.value ? +sel.value : null);
    app.termStates = null;
    toast('진도를 저장했어요.');
  });
  root.querySelectorAll('[data-k]').forEach(inp => inp.onchange = async () => { const s = subjects[+inp.dataset.k]; await app.store.setGradeTerm(s.group, s.subject, inp.value); toast('저장했어요.'); });
  root.querySelectorAll('[data-ok]').forEach(b => b.onclick = async () => { await app.store.setItemStatus(b.dataset.ok, 'public'); await items(true); toast('다시 출제해요.'); settings(); });
  root.querySelector('#copy')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(reqText); toast('복사했어요.'); } catch { toast('복사하지 못했어요. 길게 눌러 직접 복사해 주세요.'); } });
  root.querySelector('#reset')?.addEventListener('click', async () => { if (!(await ask('이 기기의 체험 기록을 모두 지울까요?', { ok: '지우기' }))) return; try { localStorage.removeItem('family-learning.v1'); } catch { /* */ } app.items = null; toast('지웠어요.'); go('#/home'); });
  if (params.go) root.querySelector('#' + params.go)?.scrollIntoView();
}
