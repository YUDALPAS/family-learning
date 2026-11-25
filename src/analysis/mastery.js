// 숙련도 = 100 × Σ(w·s)/Σw, w = d × 0.9^(경과일/7)
export const DIFF_WEIGHT = { 1: 1, 2: 1.5, 3: 2 };
export const MIN_ATTEMPTS = 3;

export function attemptScore(a) {
  if (!a.correct) return 0;
  if (a.retry || a.hintUsed || a.confidence === 'guess') return 0.5;
  if (a.confidence === 'unsure') return 0.8;
  return 1;
}

export function statusFor(score, n) {
  if (n < MIN_ATTEMPTS) return 'insufficient';
  if (score >= 80) return 'mastered';
  if (score >= 60) return 'ok';
  return 'weak';
}

export function conceptMastery(attempts, itemsById, nowISO) {
  const now = Date.parse(nowISO);
  const acc = {};
  for (const a of attempts) {
    const it = itemsById[a.itemId];
    const concept = it?.concept ?? a.concept;
    if (!concept) continue;
    const days = Math.max(0, (now - Date.parse(a.at)) / 864e5);
    const w = (DIFF_WEIGHT[it?.difficulty] ?? 1) * Math.pow(0.9, days / 7);
    const c = (acc[concept] ??= { sw: 0, sws: 0, n: 0, last: null });
    c.sw += w; c.sws += w * attemptScore(a); c.n += 1;
    if (!c.last || a.at > c.last) c.last = a.at;
  }
  const out = {};
  for (const [k, c] of Object.entries(acc)) {
    const score = c.sw > 0 ? Math.round((1000 * c.sws) / c.sw) / 10 : null;
    out[k] = { score, n: c.n, status: statusFor(score ?? 0, c.n), last: c.last };
  }
  return out;
}
