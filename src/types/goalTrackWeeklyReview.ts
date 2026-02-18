export type WeeklyReviewRhythm = "steady" | "sporadic" | "stopped";

export type GoalTrackWeeklyReview = {
  id: string;
  goalTrackId: string;
  weekStartKey: string;
  rhythm: WeeklyReviewRhythm;
  wobbleMoment: string;
  nextWeekOneChange: string;
  nextWeekKeepOne?: string;
  /** 데이터 기반 관찰 1줄 (팩트) */
  coachFact?: string;
  /** 패턴 1줄 (실행 빈도 낮음/주 후반 공백 등) */
  coachPattern?: string;
  /** 다음 행동 1개 (투두로 내려갈 텍스트) */
  coachAction?: string;
  /** @deprecated UI에서 숨김, coachFact/coachPattern/coachAction 사용 */
  coachSummary?: string;
  /** @deprecated UI에서 숨김 */
  coachQuestion?: string;
  createdAt: Date;
  updatedAt: Date;
};
