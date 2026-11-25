// Parses a solution book (풀이서) in either the 【tag】 format or the emoji/table (디딤돌) format.

export const SUBJECT_CODES = {
  '대학수학': 'MATH', '선형대수': 'LA', '오픈소스데이터분석': 'DA', '자료구조': 'DS', '프로그래밍언어론': 'PL',
};

export function metaFromFilename(name) {
  const base = name.replace(/\.docx$/i, '');
  const subject = base.split('_')[0];
  const set = base.includes('디딤돌') ? '디딤돌' : base.includes('2차') ? '2차' : '1차';
  return { subject, set, group: 'knou', subjectCode: SUBJECT_CODES[subject] || subject.slice(0, 4).toUpperCase() };
}

export function hash8(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

const CIRCLED = '①②③④';
const SECTIONS = [
  ['core', /^(?:【핵심 개념】|💡\s*핵심 개념)\s*:?\s*/],
  ['steps', /^(?:【단계별 풀이】|🪜\s*단계별 풀이)\s*:?\s*/],
  ['mistakes', /^(?:【자주 하는 실수】|⚠️?\s*자주 하는 실수)\s*:?\s*/],
  ['tip', /^(?:【중학교 연결·선배 팁】|🔗\s*중학교 연결\s*·?\s*꿀팁)\s*:?\s*/],
  ['link', /^【1차분 연계】\s*:?\s*/],
  ['source', /^(?:【출처】|📖\s*출처)\s*:?\s*/],
];
const CHAPTER = /^제(\d+)장\s+(.+?)(?:\s+—\s*풀이)?\s*$/;
const TAG_START = /^문제\s*(\d+)(?:\s+제(\d+)장\s*(.*))?\s*$/;
const NUM_START = /^(\d+)\.\s+(.+)$/s;
const ANSWER = /^정답\s*([①②③④])/;

function splitOptions(line) {
  // returns [{n, text}] for every circled number found in the line
  const parts = line.split(/([①②③④])/);
  const out = [];
  for (let i = 1; i < parts.length; i += 2) out.push({ n: CIRCLED.indexOf(parts[i]) + 1, text: (parts[i + 1] || '').trim() });
  return out;
}

export function parseSolutionBook(lines, meta) {
  const items = [];
  const warnings = [];
  let chapterNo = 0, chapter = '';
  let cur = null;
  let state = null; // 'stem' | 'options' | 'post' | section key

  const finish = () => {
    if (!cur) return;
    const t = (s) => s.join('\n').trim();
    const it = {
      id: `${meta.subject}|${meta.set}|${cur.no}|` + hash8(t(cur.stem)),
      group: meta.group, subject: meta.subject, subjectCode: meta.subjectCode, set: meta.set,
      chapterNo: cur.chapterNo, chapter: cur.chapter, no: cur.no,
      stem: t(cur.stem),
      options: cur.options.map(o => ({ n: o.n, text: o.text.trim(), why: null, misconception: null })),
      answer: cur.answer,
      concept: `${meta.subjectCode}-${cur.chapterNo}`,
      hint: null,
      core: t(cur.core), steps: cur.steps.map(s => s.trim()).filter(Boolean),
      mistakes: t(cur.mistakes), link: t(cur.link), tip: t(cur.tip), source: t(cur.source),
      difficulty: meta.set === '2차' ? 2 : 1,
    };
    if (it.options.length !== 4 || !it.answer) warnings.push(`문제 ${it.no}: 보기 ${it.options.length}개, 정답 ${it.answer ?? '없음'}`);
    items.push(it);
    cur = null; state = null;
  };

  const start = (no, firstStem) => {
    finish();
    cur = { no, chapterNo, chapter, stem: firstStem ? [firstStem] : [], options: [], answer: null,
      core: [], steps: [], mistakes: [], tip: [], link: [], source: [] };
    state = 'stem';
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (cur && /^(참고 자료|빠른 정답표)\s*$/.test(trimmed)) { finish(); break; }

    const ch = trimmed.match(CHAPTER);
    if (ch && trimmed.includes('— 풀이')) { finish(); chapterNo = +ch[1]; chapter = ch[2].trim(); continue; }

    const tag = trimmed.match(TAG_START);
    if (tag) {
      if (tag[2]) { chapterNo = +tag[2]; chapter = (tag[3] || chapter).trim(); }
      start(+tag[1], '');
      continue;
    }
    if (chapterNo > 0) {
      const num = trimmed.match(NUM_START);
      const expected = items.length + (cur ? 1 : 0) + 1;
      if (num && +num[1] === expected && (!cur || state === 'source' || state === 'tip' || state === 'link' || state === 'mistakes')) {
        start(+num[1], num[2]);
        continue;
      }
    }
    if (!cur) continue;

    const ans = trimmed.match(ANSWER);
    if (ans && (state === 'stem' || state === 'options')) { cur.answer = CIRCLED.indexOf(ans[1]) + 1; state = 'post'; continue; }

    const sec = SECTIONS.find(([, re]) => re.test(trimmed));
    if (sec && state !== 'stem' && state !== 'options') {
      state = sec[0];
      const rest = trimmed.replace(sec[1], '').trim();
      if (rest) (state === 'steps' ? cur.steps : cur[state]).push(rest);
      continue;
    }

    if (state === 'stem' || state === 'options') {
      if (/^[①②③④]/.test(trimmed)) {
        for (const o of splitOptions(trimmed)) cur.options.push(o);
        state = 'options';
      } else if (state === 'options' && cur.options.length) {
        cur.options[cur.options.length - 1].text += '\n' + line;
      } else {
        cur.stem.push(line);
      }
      continue;
    }
    if (state === 'steps') {
      if (/^→\s*따라서 정답은/.test(trimmed)) continue;
      cur.steps.push(trimmed);
      continue;
    }
    if (state && state !== 'post') cur[state].push(trimmed);
  }
  finish();
  return { items, warnings };
}
