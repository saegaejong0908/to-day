import type { GoalTrackEvent } from "@/types/goalTrackEvent";
import { getLocalDateKey } from "@/lib/date";
import {
  getWeekStartKeyKST,
  getWeekEndKeyKST,
  getLastNDateKeys,
} from "./date";

/** deterministic eventId for upsert/deduplication */
export const buildEventId = (
  goalTrackId: string,
  todoId: string,
  dateKey: string
): string => `${goalTrackId}_${todoId}_${dateKey}`;

/** 오늘 실행 수 (getLocalDateKey와 일치) */
export const calcTodayCount = (
  events: GoalTrackEvent[],
  goalTrackId: string
): number => {
  const today = getLocalDateKey();
  return events.filter(
    (e) => e.goalTrackId === goalTrackId && e.dateKey === today
  ).length;
};

/** 이번 주 실행 수 (월~일, 로컬 기준) */
export const calcWeekCount = (
  events: GoalTrackEvent[],
  goalTrackId: string
): number => {
  const now = new Date();
  const start = getWeekStartKeyKST(now);
  const end = getWeekEndKeyKST(now);
  return events.filter(
    (e) =>
      e.goalTrackId === goalTrackId &&
      e.dateKey >= start &&
      e.dateKey <= end
  ).length;
};

/** 최근 7일별 실행 수 (오늘→6일전, dateKey → count) */
export const calcLast7Days = (
  events: GoalTrackEvent[],
  goalTrackId: string
): Record<string, number> => {
  const keys = getLastNDateKeys(7);
  const map: Record<string, number> = {};
  keys.forEach((k) => (map[k] = 0));
  events
    .filter((e) => e.goalTrackId === goalTrackId && keys.includes(e.dateKey))
    .forEach((e) => (map[e.dateKey] = (map[e.dateKey] ?? 0) + 1));
  return map;
};

/** 최근 7일 중 실행한 날 수 (counts 기반) */
export const getExecutedDayCount = (
  counts: Record<string, number>,
  keys: string[]
): number => keys.filter((k) => (counts[k] ?? 0) > 0).length;

/** 최근 7일 총 행동 수 */
export const getTotalActionCount = (
  counts: Record<string, number>,
  keys: string[]
): number => keys.reduce((sum, k) => sum + (counts[k] ?? 0), 0);

/** 최근 미실행 일수 (0=오늘 실행, 1=어제 실행, ... 7=7일간 미실행) */
export const getRecentGap = (
  counts: Record<string, number>,
  keys: string[]
): number => {
  const idx = keys.findIndex((k) => (counts[k] ?? 0) > 0);
  return idx === -1 ? 7 : idx;
};

/** 최근 실행 5개 (최신순) */
export const recentEvents = (
  events: GoalTrackEvent[],
  goalTrackId: string,
  limit = 5
): GoalTrackEvent[] =>
  events
    .filter((e) => e.goalTrackId === goalTrackId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
