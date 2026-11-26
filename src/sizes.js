// 한 번에 풀거나 과제로 낼 수 있는 문항 수
export const SET_SIZES = [5, 10, 20, 30, 50];
export const DEFAULT_SIZE = 10;

// 고른 문항 수보다 범위 안 문제가 적을 때 알려 줄 말 (없으면 null)
export const shortNote = (asked, got) => got > 0 && got < asked ? `이 범위에는 풀 문제가 ${got}문항이라 ${got}문항으로 정했어요.` : null;
