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
}
