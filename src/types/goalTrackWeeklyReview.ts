import type { MissedReasonType } from "@/types/missed-reason";
import type { StrategyType } from "@/types/strategyType";

export type WeeklyReviewRhythm = "steady" | "sporadic" | "stopped";

/** 이번 주 상태 (3택1) */
export type WeeklyStatus = "STEADY" | "SPORADIC" | "STOPPED";

/** 결과 스냅샷 모드 */
export type OutcomeMode = "metric" | "sense" | "skip";

/** 체감 기록 (가까워짐/제자리/멀어짐) */
export type OutcomeSense = "closer" | "same" | "farther";

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
  /** 결과 스냅샷 모드 (metric | sense | skip) */
  outcomeMode?: OutcomeMode;
  /** metric일 때: 라벨 (선택) */
  metricLabel?: string;
  /** metric일 때: 값 (필수) */
  metricValue?: number | null;
  /** metric일 때: 단위 (선택) */
  metricUnit?: string;
  /** sense일 때: 체감 (필수) */
  sense?: OutcomeSense | null;
  /** 한 줄 이유 (선택) */
  outcomeNote?: string;
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
