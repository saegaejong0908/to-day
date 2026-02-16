import type { WeeklyReviewRhythm } from "@/types/goalTrackWeeklyReview";

export type CoachInput = {
  rhythm: WeeklyReviewRhythm;
  wobbleMoment: string;
  nextWeekOneChange: string;
  nextWeekKeepOne?: string;
  last7DaysCounts?: Record<string, number>;
};

const RHYTHM_LABELS: Record<WeeklyReviewRhythm, string> = {
  steady: "꾸준함",
  sporadic: "들쭉날쭉",
  stopped: "멈춤",
};

/** deterministic reviewId */
export const buildReviewId = (goalTrackId: string, weekStartKey: string) =>
  `${goalTrackId}_${weekStartKey}`;

/** 룰 기반 코치 응답 (팩트→관찰→제안 1개 + 질문 1개. 위로/도덕판단 금지) */
export function generateCoachResponse(input: CoachInput): {
  coachSummary: string;
  coachQuestion: string;
} {
  const { rhythm, wobbleMoment, nextWeekOneChange, nextWeekKeepOne } = input;
  const rhythmLabel = RHYTHM_LABELS[rhythm];

  let summary = "";
  let question = "";

  switch (rhythm) {
    case "steady":
      summary = `이번 주는 ${rhythmLabel}한 편이었어요. 흔들린 순간('${wobbleMoment.slice(0, 20)}${wobbleMoment.length > 20 ? "…" : ""}')을 인지하고, 다음 주 '${nextWeekOneChange.slice(0, 20)}${nextWeekOneChange.length > 20 ? "…" : ""}'로 바꾸려는 방향이 정해졌어요.`;
      question = nextWeekKeepOne
        ? `'${nextWeekKeepOne}'를 유지하려면 어떤 조건이 필요할까요?`
        : `'${nextWeekOneChange}'를 실행하려면 먼저 무엇을 준비하면 좋을까요?`;
      break;
    case "sporadic":
      summary = `이번 주는 ${rhythmLabel}했어요. 흔들린 순간('${wobbleMoment.slice(0, 20)}${wobbleMoment.length > 20 ? "…" : ""}')을 기준으로, 다음 주 '${nextWeekOneChange.slice(0, 20)}${nextWeekOneChange.length > 20 ? "…" : ""}'로 바꾸는 걸 시도해보세요.`;
      question = nextWeekKeepOne
        ? `'${nextWeekKeepOne}'가 잘 유지된 날에는 어떤 점이 달랐나요?`
        : `'${wobbleMoment}' 상황에서 가장 먼저 할 수 있는 작은 행동은 무엇일까요?`;
      break;
    case "stopped":
      summary = `이번 주는 ${rhythmLabel} 상태였어요. 흔들린 순간('${wobbleMoment.slice(0, 20)}${wobbleMoment.length > 20 ? "…" : ""}')을 돌아보고, 다음 주 '${nextWeekOneChange.slice(0, 20)}${nextWeekOneChange.length > 20 ? "…" : ""}' 한 가지만 바꿔보는 걸 제안해요.`;
      question = `'${nextWeekOneChange}'를 다시 시작하려면, 가장 낮은 문턱의 첫 단계는 무엇일까요?`;
      break;
    default:
      summary = `이번 주를 돌아보고, 다음 주 '${nextWeekOneChange.slice(0, 30)}${nextWeekOneChange.length > 30 ? "…" : ""}'로 바꿀 계획이에요.`;
      question = `그 변화를 위해 이번 주 중에 미리 할 수 있는 일은 무엇일까요?`;
  }

  return { coachSummary: summary, coachQuestion: question };
}
