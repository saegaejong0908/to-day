import { getLocalDateKey } from "@/lib/date";

const pad = (value: number) => String(value).padStart(2, "0");

/** KST 기준 dateKey (YYYY-MM-DD) */
export const toDateKeyKST = (date: Date = new Date()): string => {
  const utc = date.getTime();
  const kstOffset = 9 * 60 * 60 * 1000;
  const kst = new Date(utc + kstOffset);
  const year = kst.getUTCFullYear();
  const month = pad(kst.getUTCMonth() + 1);
  const day = pad(kst.getUTCDate());
  return `${year}-${month}-${day}`;
};

/** 오늘(KST) dateKey */
export const getTodayKeyKST = () => toDateKeyKST(new Date());

/** 이번 주 월요일 dateKey (KST) */
export const getWeekStartKeyKST = (date: Date = new Date()): string => {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(kst);
  monday.setUTCDate(kst.getUTCDate() + mondayOffset);
  return toDateKeyKST(monday);
};

/** 주의 일요일 dateKey (KST) */
export const getWeekEndKeyKST = (date: Date = new Date()): string => {
  const weekStart = getWeekStartKeyKST(date);
  const [y, m, d] = weekStart.split("-").map(Number);
  const sunday = new Date(Date.UTC(y, m - 1, d + 6));
  return toDateKeyKST(sunday);
};

/** 최근 N일 dateKey 배열 (오늘 포함, 오늘→과거 순) - getLocalDateKey 사용 (앱 todayKey와 일치) */
export const getLastNDateKeys = (n: number, date: Date = new Date()): string[] => {
  const keys: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(date);
    d.setDate(d.getDate() - i);
    keys.push(getLocalDateKey(d));
  }
  return keys;
};

/** 최근 N주 월요일 dateKey 배열 (이번 주 포함, 중복 제거) */
export const getWeekStartKeysForLastNWeeks = (n: number): string[] => {
  const seen = new Set<string>();
  const keys: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    const k = getWeekStartKeyKST(d);
    if (!seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  }
  return keys;
};

/** dateKey 문자열 비교 (a < b) */
export const isDateKeyBefore = (a: string, b: string): boolean => a < b;

/** dateKey 문자열 비교 (a <= b) */
export const isDateKeyBeforeOrEqual = (a: string, b: string): boolean => a <= b;
