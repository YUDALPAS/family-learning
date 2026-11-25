// 오답 복습 상자: 1·3·7·14·30일
export const BOX_DAYS = [1, 3, 7, 14, 30];

export function nextBox(box, correct) {
  if (!correct) return { box: 1, graduated: false };
  if (box >= BOX_DAYS.length) return { box: BOX_DAYS.length, graduated: true };
  return { box: box + 1, graduated: false };
}

export function dueDate(box, fromISO) {
  const d = new Date(fromISO.slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + BOX_DAYS[Math.min(Math.max(box, 1), BOX_DAYS.length) - 1]);
  return d.toISOString().slice(0, 10);
}

export function reviewDue(queue, nowISO) {
  const today = nowISO.slice(0, 10);
  return queue.filter(q => !q.graduated && q.due <= today).map(q => q.itemId);
}
