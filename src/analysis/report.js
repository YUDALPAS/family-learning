import { conceptMastery } from './mastery.js';
import { misconceptionFlags } from './recommend.js';

export function weeklyReport(attempts, items, assignments, nowISO) {
  const now = Date.parse(nowISO);
  const wk = 7 * 864e5;
  const byId = Object.fromEntries(items.map(i => [i.id, i]));
  const inWin = (t, from, to) => { const x = Date.parse(t); return x > now - from && x <= now - to; };
  const thisW = attempts.filter(a => inWin(a.at, wk, 0));
  const prevW = attempts.filter(a => inWin(a.at, 2 * wk, wk));
  const rate = (arr) => arr.length ? arr.filter(a => a.correct).length / arr.length : null;
  const subjects = [...new Set(items.map(i => i.subject))];
  const subjOf = (a) => byId[a.itemId]?.subject;
  const mastery = conceptMastery(attempts, byId, nowISO);
  const due = assignments.filter(a => a.dueAt && inWin(a.dueAt, wk, 0));
  return {
    days: new Set(thisW.map(a => a.at.slice(0, 10))).size,
    count: thisW.length,
    bySubject: subjects.map(s => ({ subject: s, rate: rate(thisW.filter(a => subjOf(a) === s)), prevRate: rate(prevW.filter(a => subjOf(a) === s)) })),
    weak: Object.entries(mastery).filter(([, m]) => m.status === 'weak').sort((a, b) => a[1].score - b[1].score).slice(0, 3).map(([concept, m]) => ({ concept, score: m.score })),
    flags: misconceptionFlags(attempts, nowISO),
    assignmentRate: due.length ? due.filter(a => a.status === 'done').length / due.length : null,
  };
}
