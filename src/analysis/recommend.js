import { conceptMastery } from './mastery.js';
import { reviewDue } from './review.js';

export const RECENT_CORRECT_DAYS = 14;
export const MIX = { weak: 0.4, review: 0.3, progress: 0.2, challenge: 0.1 };

export function misconceptionFlags(attempts, nowISO) {
  const since = Date.parse(nowISO) - 30 * 864e5;
  const counts = {}, sure = new Set();
  for (const a of attempts) {
    if (a.correct || !a.misconception || Date.parse(a.at) < since) continue;
    counts[a.misconception] = (counts[a.misconception] || 0) + 1;
    if (a.confidence === 'sure') sure.add(a.misconception);
  }
  return Object.keys(counts).filter(k => counts[k] >= 2 || sure.has(k));
}

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};

export function behaviorSignals(attempts) {
  const med = median(attempts.map(a => a.ms).filter(Boolean));
  const fast = attempts.filter(a => !a.correct && a.ms && a.ms < med / 3).length;
  return {
    fastWrong: fast >= 3,
    slowCorrectItemIds: attempts.filter(a => a.correct && a.ms > 2 * med).map(a => a.itemId),
    switchers: attempts.filter(a => a.firstChoice != null && a.firstChoice !== a.finalChoice).map(a => a.itemId),
  };
}

function inScope(it, learner, scope) {
  if (it.group !== learner.group) return false;
  if (scope.subject && it.subject !== scope.subject) return false;
  if (scope.set && it.set !== scope.set) return false;
  if (scope.chapterNo && it.chapterNo !== scope.chapterNo) return false;
  return true;
}

function shuffled(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function buildSet({ items, attempts, queue = [], learner, scope = {}, size = 10, nowISO, rng = Math.random }) {
  const pool = items.filter(it => inScope(it, learner, scope));
  const byId = Object.fromEntries(items.map(i => [i.id, i]));
  const now = Date.parse(nowISO);
  const recentCorrect = new Set(attempts.filter(a => a.correct && now - Date.parse(a.at) < RECENT_CORRECT_DAYS * 864e5).map(a => a.itemId));
  const attempted = new Set(attempts.map(a => a.itemId));
  const eligible = pool.filter(it => !recentCorrect.has(it.id));
  const mastery = conceptMastery(attempts, byId, nowISO);
  const picked = [];
  const take = (cands, n) => {
    for (const it of cands) {
      if (n <= 0 || picked.length >= size) break;
      if (picked.includes(it.id)) continue;
      picked.push(it.id); n--;
    }
  };
  const quota = (k) => Math.round(size * MIX[k]);

  const due = new Set(reviewDue(queue, nowISO));
  take(shuffled(pool.filter(it => due.has(it.id)), rng), quota('review'));

  const weakConcepts = new Set(Object.entries(mastery).filter(([, m]) => m.status === 'weak').map(([k]) => k));
  const weak = shuffled(eligible.filter(it => weakConcepts.has(it.concept)), rng)
    .sort((a, b) => (attempted.has(a.id) - attempted.has(b.id)) || (a.difficulty - b.difficulty));
  take(weak, quota('weak'));

  const fresh = eligible.filter(it => !attempted.has(it.id));
  const progress = [...fresh].sort((a, b) => (a.subject.localeCompare(b.subject)) || (a.chapterNo - b.chapterNo) || (a.no - b.no));
  take(progress, quota('progress'));

  const maxD = Math.max(1, ...eligible.map(i => i.difficulty));
  take(shuffled(fresh.filter(it => it.difficulty === maxD), rng), quota('challenge'));

  take(shuffled(fresh, rng), size);
  take(shuffled(eligible, rng), size);
  return picked;
}
