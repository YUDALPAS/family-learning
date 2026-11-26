import config from './config.js';
import { getStore } from './src/store/index.js';
import { conceptMastery } from './src/analysis/mastery.js';
import { nextBox, dueDate } from './src/analysis/review.js';
import * as auth from './views/auth.js';
import * as student from './views/student.js';
import * as solve from './views/solve.js';
import * as parent from './views/parent.js';
import * as terms from './views/terms.js';

// ---------- 공용 도구 ----------
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const nowISO = () => new Date().toISOString();
export const today = () => nowISO().slice(0, 10);
export function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}
export function render(html) { const app = $('#app'); app.innerHTML = html; app.focus({ preventScroll: true }); window.scrollTo(0, 0); return app; }
export const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
export const pct = (x) => x == null ? '–' : Math.round(x * 100) + '%';
export const GROUP_NAME = { knou: '방송대', h1: '고1', e6: '초6' };
export const REVEAL_NAME = { immediate: '바로', after_retry: '다시 풀어본 뒤', after_submit: '다 풀고 제출한 뒤', after_due: '마감일이 지난 뒤', after_parent: '보호자가 열어준 뒤' };

// ---------- 앱 상태 ----------
export const app = { store: null, me: null, items: null, flash: null, dict: null, termStates: null };

export async function items(force = false) {
  if (!app.items || force) app.items = await app.store.items({});
  return app.items;
}
export const publicItems = async () => (await items()).filter(i => i.status !== 'reported' && i.status !== 'review');
export async function itemsById() { return Object.fromEntries((await items()).map(i => [i.id, i])); }
export function conceptName(concept, list) {
  const it = list.find(i => i.concept === concept);
  return it ? `${it.subject} ${it.chapterNo}장 ${it.chapter}` : concept;
}

// 풀이를 마친 뒤: 기록 저장, 복습 상자 갱신, 문항 부족 요청
export async function saveResults(attempts, { assignment } = {}) {
  if (!attempts.length && !assignment) return;
  const me = app.me;
  await app.store.addAttempts(attempts);
  const queue = Object.fromEntries((await app.store.reviewQueue(me.id)).map(q => [q.itemId, q]));
  const last = {};
  for (const a of attempts) last[a.itemId] = a;
  for (const a of Object.values(last)) {
    const q = queue[a.itemId];
    if (!a.correct) await app.store.saveReview(me.id, a.itemId, 1, dueDate(1, today()), false);
    else if (q && !q.graduated) { const nb = nextBox(q.box, true); await app.store.saveReview(me.id, a.itemId, nb.box, dueDate(nb.box, today()), nb.graduated); }
  }
  if (assignment) await app.store.saveAssignment({ ...assignment, status: 'done' });
  try { await terms.recordAnswers(attempts.filter(a => !a.retry || a.correct)); } catch (e) { console.warn('term events failed', e); }
  try {
    const all = await app.store.attempts(me.id);
    const list = (await publicItems()).filter(i => i.group === me.group);
    const tried = new Set(all.map(a => a.itemId));
    const m = conceptMastery(all, Object.fromEntries(list.map(i => [i.id, i])), nowISO());
    for (const [concept, v] of Object.entries(m)) {
      if (v.status !== 'weak') continue;
      const fresh = list.filter(i => i.concept === concept && !tried.has(i.id)).length;
      if (fresh < 5) await app.store.addRequest({ learnerId: me.id, concept, reason: '약점 개념 문항 부족' });
    }
  } catch (e) { console.warn('request check failed', e); }
}

// ---------- 라우터 ----------
const routes = {
  login: auth.login,
  home: student.home,
  setup: student.setup,
  notes: student.notes,
  solve: solve.solveView,
  result: solve.resultView,
  assignment: solve.assignmentView,
  parent: parent.dashboard,
  learner: parent.learner,
  assign: parent.assign,
  upload: parent.upload,
  settings: parent.settings,
  dict: terms.dictView,
};

function parseHash() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  return { name: path || 'home', params: Object.fromEntries(new URLSearchParams(query)) };
}

function chrome() {
  const me = app.me;
  $('#bar').hidden = $('#tabs').hidden = !me;
  if (!me) return;
  $('#who').textContent = `${me.nickname} · ${GROUP_NAME[me.group]}`;
  const { name } = parseHash();
  const tabs = [['home', '공부'], ['notes', '오답노트'], ['dict', '사전']];
  if (me.role === 'parent') tabs.push(['parent', '보호자']);
  $('#tabs').innerHTML = tabs.map(([k, t]) => `<a href="#/${k}" ${name === k ? 'aria-current="page"' : ''}>${t}</a>`).join('');
}

export async function route() {
  const { name, params } = parseHash();
  if (!app.me && name !== 'login') { try { app.me = await app.store.me(); } catch { app.me = null; } }
  if (!app.me && name !== 'login') return go('#/login');
  const view = routes[name] || routes.home;
  if (['parent', 'learner', 'assign', 'upload', 'settings'].includes(name) && app.me?.role !== 'parent') return go('#/home');
  chrome();
  terms.closeSheet();
  try { await view(params); }
  catch (e) { console.error(e); render(`<h1>문제가 생겼어요</h1><p class="muted">${esc(e.message)}</p><a class="btn" href="#/home">처음으로</a>`); }
}

async function boot() {
  let seedItems = [], seedTerms = [], seedLinks = [];
  let createClient = null;
  const live = config.supabaseUrl && config.supabaseAnonKey;
  if (live) {
    await new Promise((ok, fail) => { const s = document.createElement('script'); s.src = 'vendor/supabase.js'; s.onload = ok; s.onerror = fail; document.head.append(s); });
    createClient = window.supabase.createClient;
  } else {
    seedItems = await fetch('data/sample-bank.json').then(r => r.ok ? r.json() : []).catch(() => []);
    const st = await fetch('data/sample-terms.json').then(r => r.ok ? r.json() : null).catch(() => null);
    if (st) { seedTerms = st.terms; seedLinks = st.links; }
  }
  let storage = null;
  try { storage = window.localStorage; storage.getItem('x'); } catch { const m = new Map(); storage = { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }
  app.store = getStore(config, { storage, seedItems, seedTerms, seedLinks, createClient });
  $('#logout').onclick = async () => { await app.store.signOut(); app.me = null; app.items = null; app.dict = null; app.termStates = null; terms.closeSheet(); go('#/login'); };
  terms.wireTermClicks($('#app'));
  window.addEventListener('hashchange', route);
  route();
}
boot();

// 브라우저 기본 대화상자(alert/confirm/prompt) 대신 쓰는 화면 안 대화상자
export function ask(message, { ok = '확인', cancel = '취소', input = false, placeholder = '' } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'ask-wrap';
    wrap.innerHTML = `<div class="ask" role="dialog" aria-modal="true" aria-labelledby="ask-msg">
      <p id="ask-msg"></p>${input ? '<textarea rows="3"></textarea>' : ''}
      <div class="row"><button class="btn ghost" type="button" data-v="0"></button><button class="btn" type="button" data-v="1"></button></div></div>`;
    wrap.querySelector('#ask-msg').textContent = message;
    wrap.querySelector('[data-v="0"]').textContent = cancel;
    wrap.querySelector('[data-v="1"]').textContent = ok;
    const ta = wrap.querySelector('textarea'); if (ta) ta.placeholder = placeholder;
    const done = (v) => { wrap.remove(); document.removeEventListener('keydown', key); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') done(input ? null : false); };
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (b) done(b.dataset.v === '1' ? (input ? ta.value.trim() : true) : (input ? null : false));
      else if (e.target === wrap) done(input ? null : false);
    });
    document.addEventListener('keydown', key);
    document.body.append(wrap);
    (ta || wrap.querySelector('[data-v="1"]')).focus();
  });
}
