// 실서비스 저장소: Supabase(Postgres + RLS). 권한은 DB 정책(supabase/schema.sql)이 최종 판단한다.
import { DEFAULT_GRADE_TERM } from './local.js';

export const loginEmail = (id) => { const s = String(id).trim().toLowerCase(); return s.includes('@') ? s : `${s}@family.local`; };

export function itemToRow(i) {
  const { id, group, subject, set, chapterNo, no, concept, difficulty, status, ...body } = i;
  return { id, grp: group, subject, set_name: set, chapter_no: chapterNo, no, concept, difficulty, status: status ?? 'public', body };
}
export function rowToItem(r) {
  return { id: r.id, group: r.grp, subject: r.subject, set: r.set_name, chapterNo: r.chapter_no, no: r.no, concept: r.concept, difficulty: r.difficulty, status: r.status, ...r.body };
}
export function attemptToRow(a) {
  return { learner_id: a.learnerId, item_id: a.itemId, concept: a.concept, first_choice: a.firstChoice, final_choice: a.finalChoice, correct: a.correct,
    confidence: a.confidence, hint_used: a.hintUsed, retry: a.retry, ms: a.ms, at: a.at, misconception: a.misconception, session_id: a.sessionId };
}
export function rowToAttempt(r) {
  return { learnerId: r.learner_id, itemId: r.item_id, concept: r.concept, firstChoice: r.first_choice, finalChoice: r.final_choice, correct: r.correct,
    confidence: r.confidence, hintUsed: r.hint_used, retry: r.retry, ms: r.ms, at: new Date(r.at).toISOString(), misconception: r.misconception, sessionId: r.session_id };
}
export function assignmentToRow(a) {
  const row = { learner_id: a.learnerId, title: a.title, scope: a.scope, size: a.size, due_at: a.dueAt, reveal: a.reveal, item_ids: a.itemIds, status: a.status ?? 'open', released: a.released ?? false };
  if (a.id) row.id = a.id;
  return row;
}
export function rowToAssignment(r) {
  return { id: r.id, learnerId: r.learner_id, title: r.title, scope: r.scope, size: r.size, dueAt: r.due_at ? new Date(r.due_at).toISOString() : null,
    reveal: r.reveal, itemIds: r.item_ids, status: r.status, released: r.released };
}

export function termToRow(t) {
  const { id, group, subject, unit, term, status, ...body } = t;
  return { id, grp: group, subject, unit, term, status: status ?? 'public', body };
}
export function rowToTerm(r) {
  return { id: r.id, group: r.grp, subject: r.subject, unit: r.unit, term: r.term, status: r.status, ...r.body };
}
export function termEventToRow(e) { return { learner_id: e.learnerId, term_id: e.termId, kind: e.kind, correct: e.correct ?? null, at: e.at }; }
export function rowToTermEvent(r) {
  const e = { learnerId: r.learner_id, termId: r.term_id, kind: r.kind, at: new Date(r.at).toISOString() };
  if (r.correct != null) e.correct = r.correct;
  return e;
}

const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const PAGE = 1000;

export class SupabaseStore {
  constructor(client) { this.sb = client; this.kind = 'supabase'; this._me = null; }

  async signIn(id, pw) {
    must(await this.sb.auth.signInWithPassword({ email: loginEmail(id), password: pw }));
    this._me = null;
    return this.me();
  }
  async signOut() { await this.sb.auth.signOut(); this._me = null; }
  async me() {
    if (this._me) return this._me;
    const { data: { user } } = await this.sb.auth.getUser();
    if (!user) throw new Error('로그인이 필요해요');
    const r = must(await this.sb.from('learners').select('*').eq('id', user.id).single());
    return (this._me = { id: r.id, nickname: r.nickname, group: r.grp, role: r.role });
  }
  async learners() {
    return must(await this.sb.from('learners').select('*').order('role')).map(r => ({ id: r.id, nickname: r.nickname, group: r.grp, role: r.role }));
  }

  async items({ group, subject, set, chapterNo } = {}) {
    const out = [];
    for (let from = 0; ; from += PAGE) {
      let q = this.sb.from('items').select('*').order('id').range(from, from + PAGE - 1);
      if (group) q = q.eq('grp', group);
      if (subject) q = q.eq('subject', subject);
      if (set) q = q.eq('set_name', set);
      if (chapterNo) q = q.eq('chapter_no', chapterNo);
      const rows = must(await q);
      out.push(...rows.map(rowToItem));
      if (rows.length < PAGE) break;
    }
    return out;
  }
  async upsertItems(items) {
    let inserted = 0;
    for (let i = 0; i < items.length; i += 200) {
      const rows = must(await this.sb.from('items').upsert(items.slice(i, i + 200).map(itemToRow), { onConflict: 'id', ignoreDuplicates: true }).select('id'));
      inserted += rows.length;
    }
    return { inserted, skipped: items.length - inserted };
  }
  async setItemStatus(itemId, status) { must(await this.sb.from('items').update({ status }).eq('id', itemId)); }
  async subjects() {
    const rows = must(await this.sb.rpc('subject_list'));
    return rows.map(r => ({ group: r.grp, subject: r.subject, gradeTerm: r.grade_term ?? DEFAULT_GRADE_TERM[r.grp] }));
  }
  async setGradeTerm(group, subject, gradeTerm) { must(await this.sb.from('subjects').upsert({ grp: group, subject, grade_term: gradeTerm })); }

  async addAttempts(list) {
    const me = await this.me();
    if (list.length) must(await this.sb.from('attempts').insert(list.map(a => attemptToRow({ ...a, learnerId: me.id }))));
  }
  async attempts(learnerId) {
    const out = [];
    for (let from = 0; ; from += PAGE) {
      const rows = must(await this.sb.from('attempts').select('*').eq('learner_id', learnerId).order('at').range(from, from + PAGE - 1));
      out.push(...rows.map(rowToAttempt));
      if (rows.length < PAGE) break;
    }
    return out;
  }
  async reviewQueue(learnerId) {
    return must(await this.sb.from('review_queue').select('*').eq('learner_id', learnerId)).map(r => ({ itemId: r.item_id, box: r.box, due: r.due, graduated: r.graduated }));
  }
  async saveReview(learnerId, itemId, box, due, graduated = false) {
    must(await this.sb.from('review_queue').upsert({ learner_id: learnerId, item_id: itemId, box, due, graduated }));
  }

  async assignments(learnerId) {
    let q = this.sb.from('assignments').select('*').order('created_at', { ascending: false });
    if (learnerId) q = q.eq('learner_id', learnerId);
    return must(await q).map(rowToAssignment);
  }
  async saveAssignment(a) {
    const me = await this.me();
    if (me.role !== 'parent') {
      return rowToAssignment(must(await this.sb.from('assignments').update({ status: a.status }).eq('id', a.id).select().single()));
    }
    return rowToAssignment(must(await this.sb.from('assignments').upsert(assignmentToRow(a)).select().single()));
  }
  async releaseSolutions(assignmentId) { must(await this.sb.from('assignments').update({ released: true }).eq('id', assignmentId)); }

  async reportItem(itemId, note) {
    const me = await this.me();
    must(await this.sb.from('reports').insert({ item_id: itemId, learner_id: me.id, note }));
  }
  async reports() { return must(await this.sb.from('reports').select('*').order('at', { ascending: false })).map(r => ({ id: r.id, itemId: r.item_id, learnerId: r.learner_id, note: r.note, at: r.at, resolved: r.resolved })); }
  async requests() { return must(await this.sb.from('requests').select('*').order('at', { ascending: false })).map(r => ({ id: r.id, learnerId: r.learner_id, concept: r.concept, misconception: r.misconception, reason: r.reason, at: r.at, done: r.done })); }
  async addRequest(r) {
    must(await this.sb.from('requests').upsert({ learner_id: r.learnerId, concept: r.concept, misconception: r.misconception ?? null, reason: r.reason }, { onConflict: 'learner_id,concept,reason', ignoreDuplicates: true }));
  }

  // ---- 개념 사전 ----
  async terms({ group, subject } = {}) {
    const out = [];
    for (let from = 0; ; from += PAGE) {
      let q = this.sb.from('terms').select('*').order('id').range(from, from + PAGE - 1);
      if (group) q = q.eq('grp', group);
      if (subject) q = q.eq('subject', subject);
      const rows = must(await q);
      out.push(...rows.map(rowToTerm));
      if (rows.length < PAGE) break;
    }
    return out;
  }
  async termLinks() {
    return must(await this.sb.from('term_links').select('*')).map(r => ({ from: r.from_id, to: r.to_id, type: r.type }));
  }
  async upsertTerms(terms, links = []) {
    const ids = terms.map(t => t.id);
    let existing = 0;
    for (let i = 0; i < ids.length; i += 200) existing += must(await this.sb.from('terms').select('id').in('id', ids.slice(i, i + 200))).length;
    for (let i = 0; i < terms.length; i += 200) must(await this.sb.from('terms').upsert(terms.slice(i, i + 200).map(termToRow)));
    for (let i = 0; i < ids.length; i += 200) must(await this.sb.from('term_links').delete().in('from_id', ids.slice(i, i + 200)));
    const own = new Set(ids);
    const rows = links.filter(l => own.has(l.from)).map(l => ({ from_id: l.from, to_id: l.to, type: l.type }));
    for (let i = 0; i < rows.length; i += 500) must(await this.sb.from('term_links').upsert(rows.slice(i, i + 500)));
    return { inserted: terms.length - existing, updated: existing };
  }
  async addTermEvents(list) {
    const me = await this.me();
    if (list.length) must(await this.sb.from('term_events').insert(list.map(e => termEventToRow({ ...e, learnerId: me.id }))));
  }
  async termEvents(learnerId) {
    const out = [];
    for (let from = 0; ; from += PAGE) {
      const rows = must(await this.sb.from('term_events').select('*').eq('learner_id', learnerId).order('at').range(from, from + PAGE - 1));
      out.push(...rows.map(rowToTermEvent));
      if (rows.length < PAGE) break;
    }
    return out;
  }
  async progress(learnerId) {
    return Object.fromEntries(must(await this.sb.from('progress').select('*').eq('learner_id', learnerId)).map(r => [r.subject, r.unit]));
  }
  async setProgress(learnerId, subject, unit) {
    if (unit == null) { must(await this.sb.from('progress').delete().eq('learner_id', learnerId).eq('subject', subject)); return; }
    must(await this.sb.from('progress').upsert({ learner_id: learnerId, subject, unit }));
  }
}
