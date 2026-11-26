// 용어별 학습자 상태: 안 배움 / 익히는 중 / 익힘 + 헷갈림 표시
import { findTerms } from './match.js';

export const TERM_RULES = { confuseOpens: 3, confuseWindowDays: 30, confuseWrong: 2, knownStreak: 3, knownQuietDays: 14 };

export function termState(events, { reached = false } = {}, nowISO, rules = TERM_RULES) {
  const now = Date.parse(nowISO);
  const within = (e, days) => now - Date.parse(e.at) <= days * 864e5;
  const opens = events.filter(e => e.kind === 'open');
  const answers = events.filter(e => e.kind === 'answer');
  if (!events.length) return { state: reached ? 'learning' : 'unseen', confusing: false, opens: 0 };

  let streak = 0;
  for (let i = answers.length - 1; i >= 0 && answers[i].correct; i--) streak++;
  const lastOpen = opens.length ? Math.max(...opens.map(e => Date.parse(e.at))) : null;
  const quiet = lastOpen == null || now - lastOpen >= rules.knownQuietDays * 864e5;
  if (streak >= rules.knownStreak && quiet) return { state: 'known', confusing: false, opens: opens.length };

  const recentOpens = opens.filter(e => within(e, rules.confuseWindowDays)).length;
  const recentWrong = answers.filter(e => !e.correct && within(e, rules.confuseWindowDays)).length;
  return { state: 'learning', confusing: recentOpens >= rules.confuseOpens || recentWrong >= rules.confuseWrong, opens: opens.length };
}

export function termsInItem(matcher, item, ctx) {
  const seen = new Set();
  const texts = [item.stem, ...(item.options || []).map(o => o.text), item.core, ...(item.steps || []), item.mistakes, item.tip];
  for (const t of texts) findTerms(matcher, t || '', { ...ctx, seen });
  return [...seen];
}

// 문항당 ⚠ 고르기: 익힌 용어 제외, 헷갈림 → 같은 단원 → 먼저 나온 순, 최대 limit개
export function pickMarks(ids, { states = {}, unitOf = {}, itemUnit, limit = 4 }) {
  const rank = (id) => (states[id]?.confusing ? 0 : unitOf[id] === itemUnit ? 1 : 2);
  return new Set(ids.map((id, i) => ({ id, i })).filter(x => states[x.id]?.state !== 'known')
    .sort((a, b) => rank(a.id) - rank(b.id) || a.i - b.i).slice(0, limit).map(x => x.id));
}
