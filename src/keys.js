// 풀이 화면 키보드: 숫자 1~n으로 보기 고르기, Enter로 확정. 결과 { choose: n } | { confirm: true } | null
const TYPING = new Set(['input', 'textarea', 'select']);
const CONTROLS = new Set(['button', 'a', ...TYPING]);

export function solveKey(e, { count, locked, sheetOpen, target = 'body', canConfirm }) {
  if (locked || sheetOpen || e.ctrlKey || e.metaKey || e.altKey) return null;
  const tag = String(target).toLowerCase();
  if (TYPING.has(tag)) return null;
  if (/^[1-9]$/.test(e.key)) { const n = +e.key; return n <= count ? { choose: n } : null; }
  if (e.key === 'Enter') return canConfirm && !CONTROLS.has(tag) ? { confirm: true } : null;
  return null;
}
