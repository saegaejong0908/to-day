import type { MissedReasonType } from "@/types/missed-reason";
import type { StrategyType } from "@/types/strategyType";

export type WeeklyReviewRhythm = "steady" | "sporadic" | "stopped";

/** 이번 주 상태 (3택1) */
export type WeeklyStatus = "STEADY" | "SPORADIC" | "STOPPED";

export type GoalTrackWeeklyReview = {
  id: string;
  goalTrackId: string;
  weekStartKey: string;
  /** @deprecated status 사용, 하위호환 */
  rhythm?: WeeklyReviewRhythm;
  /** 이번 주 상태. 없으면 rhythm 매핑 */
  status?: WeeklyStatus;
  /** @deprecated blockReason 사용 */
  wobbleMoment?: string;
  /** 막힌 이유 (투두 탭과 동일 enum) */
  blockReason?: MissedReasonType | null;
  /** 막힌 이유 메모 (선택) */
  blockNote?: string;
  /** @deprecated nextWeekRuleText 사용 */
  nextWeekOneChange?: string;
  /** 다음 주 실행 규칙 1개 (필수) */
  nextWeekRuleText?: string;
  /** @deprecated */
  nextWeekKeepOne?: string;
  /** 언제 할지 (0=일...6=토, 복수) */
  plannedWeekdays?: number[];
  /** 선택한 전략 태그 (복수) */
  selectedStrategies?: StrategyType[];
  /** AI 정리 결과 */
  aiRefinedRuleText?: string;
  aiRefineRationale?: string;
  /** 데이터 기반 관찰 1줄 */
  coachFact?: string;
  coachPattern?: string;
  coachAction?: string;
  coachSummary?: string;
  coachQuestion?: string;
  createdAt: Date;
  updatedAt: Date;
};
