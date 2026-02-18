import { MissedReasonType } from "@/types/missed-reason";

/** 투두 탭/주간 평가 공용 막힘 이유 라벨 (값은 MissedReasonType과 동일) */
export const BLOCK_REASON_LABELS: Record<MissedReasonType, string> = {
  [MissedReasonType.COMPLETED_BUT_NOT_CHECKED]: "완료했는데, 체크를 못했어요",
  [MissedReasonType.HARD_TO_START]: "시작하기가 어려워요",
  [MissedReasonType.NOT_ENOUGH_TIME]: "끝내기 위한 시간이 부족해요",
  [MissedReasonType.WANT_TO_REST]: "오늘은 쉬고싶어요",
};

/** 주간 평가에서 선택 가능한 막힘 이유 (유지됨 선택 시 제외) */
export const WEEKLY_REVIEW_BLOCK_REASONS: MissedReasonType[] = [
  MissedReasonType.COMPLETED_BUT_NOT_CHECKED,
  MissedReasonType.HARD_TO_START,
  MissedReasonType.NOT_ENOUGH_TIME,
  MissedReasonType.WANT_TO_REST,
];
