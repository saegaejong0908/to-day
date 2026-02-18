import { getExecutedDayCount, getRecentGap } from "./execution";
import { getLastNDateKeys } from "./date";
import type { GoalTrackWeeklyReview } from "@/types/goalTrackWeeklyReview";

const ACTION_MAX_LEN = 80;
const ACTION_MIN_LEN = 50;

export type WeeklyCoachResult = {
  fact: string;
  pattern: string;
  action: string;
};

/** 추상적 문구를 구체적 행동으로 정제 (50~80자 권장) */
export function sanitizeActionText(raw: string): string {
  let s = raw.trim();
  if (!s) return "";
  // 너무 짧으면 보강 힌트 (선택)
  if (s.length < 20) {
    s = s.replace(/^(한다?|하기|할 것)$/i, (m) => `오늘 ${m}`);
  }
  if (s.length > ACTION_MAX_LEN) {
    s = s.slice(0, ACTION_MAX_LEN - 1) + "…";
  }
  return s;
}

/** 룰 기반 주간 코치: 팩트 1줄 + 패턴 1줄 + 다음 행동 1개 */
export function buildWeeklyCoach(
  counts: Record<string, number>,
  review: Pick<
    GoalTrackWeeklyReview,
    | "rhythm"
    | "wobbleMoment"
    | "nextWeekOneChange"
    | "nextWeekRuleText"
    | "nextWeekKeepOne"
  >
): WeeklyCoachResult {
  const keys = getLastNDateKeys(7);
  const executedDays = getExecutedDayCount(counts, keys);
  const recentGap = getRecentGap(counts, keys);

  const fact = `최근 7일 실행 ${executedDays}일`;

  let pattern: string;
  if (executedDays === 0) {
    pattern = "실행 없음";
  } else if (executedDays <= 2) {
    pattern = "실행 빈도 낮음";
  } else {
    const recent3Count =
      (counts[keys[0] ?? ""] ?? 0) +
      (counts[keys[1] ?? ""] ?? 0) +
      (counts[keys[2] ?? ""] ?? 0);
    const older4Count =
      (counts[keys[3] ?? ""] ?? 0) +
      (counts[keys[4] ?? ""] ?? 0) +
      (counts[keys[5] ?? ""] ?? 0) +
      (counts[keys[6] ?? ""] ?? 0);
    if (recent3Count === 0 && older4Count > 0) {
      pattern = "주 후반 공백";
    } else if (recentGap >= 3) {
      pattern = "주 후반 공백";
    } else {
      pattern = "꾸준함";
    }
  }

  let action =
    review.nextWeekRuleText?.trim() || review.nextWeekOneChange?.trim() || "";
  if (action) {
    action = sanitizeActionText(action);
  }
  if (!action && review.nextWeekKeepOne?.trim()) {
    action = sanitizeActionText(review.nextWeekKeepOne);
  }
  if (!action) {
    action = "오늘 한 가지 행동 실행하기";
  }

  return { fact, pattern, action };
}
