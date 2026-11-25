// 풀이 세션: 보기 섞기, 확정/제출, 정답·풀이 공개 시점
export const LABELS = ['①', '②', '③', '④'];
const DEFERRED = new Set(['after_submit', 'after_due', 'after_parent']);

export function renumber(text, map) {
  if (!text) return text;
  return text.replace(/[①②③④]/g, (c) => LABELS[(map[LABELS.indexOf(c) + 1] ?? LABELS.indexOf(c) + 1) - 1]);
}

function permutation(n, rng) {
  const a = Array.from({ length: n }, (_, i) => i + 1);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function createSession({ items, mode = 'practice', reveal = { answer: 'immediate', solution: 'immediate' }, shuffle = false,
  rng = Math.random, dueAt = null, parentReleased = false, learnerId = null, sessionId = null }) {
  const sid = sessionId || `s${Date.now().toString(36)}${Math.floor(rng() * 1e6).toString(36)}`;
  const retries = reveal.retries ?? 1;
  const deferred = DEFERRED.has(reveal.answer);
  let submitted = false, released = parentReleased;
  const recorded = [];
  const st = items.map((it) => {
    const order = shuffle && !it.noShuffle ? permutation(it.options.length, rng) : it.options.map(o => o.n);
    return { it, order, current: null, first: null, confirmed: false, done: false, correct: null, tries: 0, meta: null };
  });

  const toOrig = (i, label) => st[i].order[LABELS.indexOf(label)];
  const record = (s, meta, retry) => {
    recorded.push({
      learnerId, itemId: s.it.id, concept: s.it.concept, firstChoice: s.first, finalChoice: s.current,
      correct: s.current === s.it.answer, confidence: meta?.confidence ?? 'sure', hintUsed: !!meta?.hintUsed, retry,
      ms: meta?.ms ?? 0, at: meta?.at ?? new Date().toISOString(),
      misconception: s.current && s.current !== s.it.answer ? (s.it.options.find(o => o.n === s.current)?.misconception ?? null) : null,
      sessionId: sid,
    });
  };

  const visible = (timing, i, nowISO) => {
    const s = st[i];
    switch (timing) {
      case 'immediate': return s.done;
      case 'after_retry': return s.done;
      case 'after_submit': return submitted;
      case 'after_due': return submitted && (!dueAt || Date.parse(nowISO) >= Date.parse(dueAt));
      case 'after_parent': return submitted && released;
      default: return false;
    }
  };

  return {
    id: sid, mode, reveal, items,
    get length() { return st.length; },
    get submitted() { return submitted; },
    view(i) {
      const s = st[i];
      return { stem: s.it.stem, options: s.order.map((orig, k) => ({ label: LABELS[k], text: s.it.options.find(o => o.n === orig).text, orig })) };
    },
    state(i) { const s = st[i]; return { current: s.current, confirmed: s.confirmed, done: s.done, correct: s.correct, tries: s.tries }; },
    optionMap(i) { return Object.fromEntries(st[i].order.map((orig, k) => [orig, k + 1])); },
    labelOf(i, orig) { return LABELS[st[i].order.indexOf(orig)]; },
    renumbered(i, text) { return renumber(text, this.optionMap(i)); },
    choose(i, label) {
      const s = st[i];
      if (submitted || s.done) throw new Error('이미 채점된 문항이에요');
      s.current = toOrig(i, label);
      if (s.first == null) s.first = s.current;
    },
    confirm(i, meta) {
      const s = st[i];
      if (s.current == null) throw new Error('보기를 먼저 골라 주세요');
      s.confirmed = true; s.meta = meta;
      if (deferred) return { graded: false };
      s.tries += 1;
      const correct = s.current === s.it.answer;
      record(s, meta, s.tries > 1);
      const retryAllowed = reveal.answer === 'after_retry' && !correct && s.tries <= retries;
      if (retryAllowed) { s.first = null; s.current = null; s.confirmed = false; }
      else { s.done = true; s.correct = correct; }
      return { graded: true, correct, retryAllowed };
    },
    submit(nowISO) {
      if (submitted) return;
      submitted = true;
      for (const s of st) {
        if (s.done) continue;
        s.done = true;
        s.correct = s.current === s.it.answer;
        if (deferred) record(s, { ...(s.meta || {}), at: s.meta?.at ?? nowISO }, false);
      }
    },
    setParentReleased(v) { released = !!v; },
    canSeeAnswer(i, nowISO) { return visible(reveal.answer, i, nowISO); },
    canSeeSolution(i, nowISO) { return visible(reveal.solution, i, nowISO) && visible(reveal.answer, i, nowISO); },
    attempts() { return recorded.slice(); },
    score() { const d = st.filter(s => s.done); return { done: d.length, correct: d.filter(s => s.correct).length, total: st.length }; },
  };
}
