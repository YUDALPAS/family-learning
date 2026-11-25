// 데모용 저장소: 브라우저 localStorage(또는 주입된 storage)에 저장. 실서비스는 SupabaseStore.
export const DEMO_USERS = {
  samson: { pw: '1234', id: 'u-samson', nickname: '샘슨', group: 'knou', role: 'parent' },
  kid1: { pw: '1234', id: 'u-kid1', nickname: '첫째(고1)', group: 'h1', role: 'student' },
  kid2: { pw: '1234', id: 'u-kid2', nickname: '둘째(초6)', group: 'e6', role: 'student' },
};
export const DEFAULT_GRADE_TERM = { knou: '방송대 2학년 2학기', h1: '고1 1학기', e6: '초6 1학기' };
const KEY = 'family-learning.v1';
const SESSION = 'family-learning.session';

const deny = (msg = '권한이 없어요') => { throw new Error(msg); };
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export class LocalStore {
  constructor({ storage, seedItems = [] }) {
    this.storage = storage;
    this.seed = seedItems;
    this.kind = 'local';
  }
  _db() {
    let raw = null;
    try { raw = this.storage.getItem(KEY); } catch { /* storage unavailable */ }
    const db = raw ? JSON.parse(raw) : {};
    return { items: [], gradeTerms: {}, statuses: {}, attempts: [], queue: [], assignments: [], reports: [], requests: [], ...db };
  }
  _save(db) { try { this.storage.setItem(KEY, JSON.stringify(db)); } catch (e) { throw new Error('기기 저장 공간이 부족해요: ' + e.message); } }
  _user() {
    let id = null;
    try { id = this.storage.getItem(SESSION); } catch { /* */ }
    const u = Object.values(DEMO_USERS).find(x => x.id === id);
    if (!u) deny('로그인이 필요해요');
    return u;
  }
  _parent() { const u = this._user(); if (u.role !== 'parent') deny(); return u; }
  _self(learnerId) { const u = this._user(); if (u.role !== 'parent' && learnerId !== u.id) deny(); return u; }
  _allItems(db) {
    const map = new Map(this.seed.map(i => [i.id, i]));
    for (const i of db.items) if (!map.has(i.id)) map.set(i.id, i);
    return [...map.values()].map(i => ({ ...i, status: db.statuses[i.id] ?? i.status ?? 'public' }));
  }

  async signIn(id, pw) {
    const u = DEMO_USERS[String(id).trim().toLowerCase()];
    if (!u || u.pw !== pw) throw new Error('아이디나 비밀번호가 맞지 않아요');
    this.storage.setItem(SESSION, u.id);
    return this.me();
  }
  async signOut() { try { this.storage.removeItem(SESSION); } catch { /* */ } }
  async me() { const { id, nickname, group, role } = this._user(); return { id, nickname, group, role }; }
  async learners() { this._parent(); return Object.values(DEMO_USERS).map(({ id, nickname, group, role }) => ({ id, nickname, group, role })); }

  async items({ group, subject, set, chapterNo } = {}) {
    const u = this._user();
    const g = u.role === 'parent' ? group : u.group;
    return this._allItems(this._db()).filter(i => (!g || i.group === g) && (!subject || i.subject === subject) && (!set || i.set === set) && (!chapterNo || i.chapterNo === chapterNo));
  }
  async upsertItems(items) {
    this._parent();
    const db = this._db();
    const have = new Set(this._allItems(db).map(i => i.id));
    let inserted = 0, skipped = 0;
    for (const i of items) { if (have.has(i.id)) { skipped++; continue; } db.items.push(i); have.add(i.id); inserted++; }
    this._save(db);
    return { inserted, skipped };
  }
  async setItemStatus(itemId, status) { this._parent(); const db = this._db(); db.statuses[itemId] = status; this._save(db); }
  async subjects() {
    this._user();
    const db = this._db();
    const seen = new Map();
    for (const i of this._allItems(db)) {
      const k = i.group + '|' + i.subject;
      if (!seen.has(k)) seen.set(k, { group: i.group, subject: i.subject, gradeTerm: db.gradeTerms[k] ?? DEFAULT_GRADE_TERM[i.group] });
    }
    return [...seen.values()];
  }
  async setGradeTerm(group, subject, gradeTerm) { this._parent(); const db = this._db(); db.gradeTerms[group + '|' + subject] = gradeTerm; this._save(db); }

  async addAttempts(list) {
    const u = this._user();
    const db = this._db();
    for (const a of list) db.attempts.push({ ...a, learnerId: u.id });
    this._save(db);
  }
  async attempts(learnerId) { this._self(learnerId); return this._db().attempts.filter(a => a.learnerId === learnerId); }
  async reviewQueue(learnerId) {
    this._self(learnerId);
    return this._db().queue.filter(q => q.learnerId === learnerId).map(({ itemId, box, due, graduated }) => ({ itemId, box, due, graduated }));
  }
  async saveReview(learnerId, itemId, box, due, graduated = false) {
    this._self(learnerId);
    const db = this._db();
    db.queue = db.queue.filter(q => !(q.learnerId === learnerId && q.itemId === itemId));
    db.queue.push({ learnerId, itemId, box, due, graduated });
    this._save(db);
  }

  async assignments(learnerId) {
    const u = this._user();
    const all = this._db().assignments;
    if (u.role !== 'parent') return all.filter(a => a.learnerId === u.id);
    return learnerId ? all.filter(a => a.learnerId === learnerId) : all;
  }
  async saveAssignment(a) {
    const u = this._user();
    const db = this._db();
    const idx = db.assignments.findIndex(x => x.id === a.id);
    if (u.role !== 'parent') {
      const old = db.assignments[idx];
      if (!old || old.learnerId !== u.id) deny();
      const changed = Object.keys({ ...old, ...a }).filter(k => k !== 'status' && JSON.stringify(old[k]) !== JSON.stringify(a[k]));
      if (changed.length) deny('과제는 상태만 바꿀 수 있어요');
      old.status = a.status;
      this._save(db);
      return old;
    }
    const rec = { status: 'open', released: false, createdAt: new Date().toISOString(), ...a, id: a.id || uid() };
    if (idx >= 0) db.assignments[idx] = rec; else db.assignments.push(rec);
    this._save(db);
    return rec;
  }
  async releaseSolutions(assignmentId) {
    this._parent();
    const db = this._db();
    const a = db.assignments.find(x => x.id === assignmentId);
    if (a) { a.released = true; this._save(db); }
  }

  async reportItem(itemId, note) {
    const u = this._user();
    const db = this._db();
    db.reports.push({ id: uid(), itemId, learnerId: u.id, note, at: new Date().toISOString(), resolved: false });
    db.statuses[itemId] = 'reported';
    this._save(db);
  }
  async reports() { this._parent(); return this._db().reports; }
  async requests() { this._parent(); return this._db().requests; }
  async addRequest(r) {
    this._user();
    const db = this._db();
    if (db.requests.some(x => !x.done && x.concept === r.concept && x.learnerId === r.learnerId && x.reason === r.reason)) return;
    db.requests.push({ id: uid(), at: new Date().toISOString(), done: false, ...r });
    this._save(db);
  }
}
