"use client";

import React from "react";
import type { GoalTrack } from "@/types/goalTrack";
import type { GoalTrackWeeklyReview, WeeklyReviewRhythm } from "@/types/goalTrackWeeklyReview";
import { buildWeeklyCoach } from "@/domain/weeklyCoach";
import { getExecutedDayCount, getRecentGap } from "@/domain/execution";
import { getLastNDateKeys } from "@/domain/date";

const WEEKDAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
/** 0=일, 1=월, ... 6=토 (Date.getDay()) */
const REVIEW_DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

/** 추천 요일: recentGap>=3→월, executedDays>=4→수, 기본 수 */
function getRecommendedWeekday(
  counts: Record<string, number> | undefined
): number {
  if (!counts) return 2;
  const keys = getLastNDateKeys(7);
  const executedDays = getExecutedDayCount(counts, keys);
  const recentGap = getRecentGap(counts, keys);
  if (recentGap >= 3) return 0;
  if (executedDays >= 4) return 2;
  return 2;
}

const RHYTHM_OPTIONS: { value: WeeklyReviewRhythm; label: string }[] = [
  { value: "steady", label: "꾸준함" },
  { value: "sporadic", label: "들쭉날쭉" },
  { value: "stopped", label: "멈춤" },
];

type Props = {
  track: GoalTrack;
  review: GoalTrackWeeklyReview | null;
  weekStartKey: string;
  last7DaysCounts?: Record<string, number>;
  editingReviewDayGoalTrackId?: string | null;
  onUpdateReviewWeekday?: (goalTrackId: string, reviewWeekday: number) => void;
  onEditingReviewDayChange?: (goalTrackId: string | null) => void;
  onApplyAction?: (goalTrackId: string, actionText: string, weekday: number) => void;
  onSave: (data: {
    goalTrackId: string;
    weekStartKey: string;
    rhythm: WeeklyReviewRhythm;
    wobbleMoment: string;
    nextWeekOneChange: string;
    nextWeekKeepOne?: string;
  }) => Promise<void>;
  saving?: boolean;
};

export function WeeklyReviewCard({
  track,
  review,
  weekStartKey,
  last7DaysCounts,
  editingReviewDayGoalTrackId = null,
  onUpdateReviewWeekday,
  onEditingReviewDayChange,
  onApplyAction,
  onSave,
  saving = false,
}: Props) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [rhythm, setRhythm] = React.useState<WeeklyReviewRhythm>(
    review?.rhythm ?? "steady"
  );
  const [wobbleMoment, setWobbleMoment] = React.useState(review?.wobbleMoment ?? "");
  const [nextWeekOneChange, setNextWeekOneChange] = React.useState(
    review?.nextWeekOneChange ?? ""
  );
  const [nextWeekKeepOne, setNextWeekKeepOne] = React.useState(
    review?.nextWeekKeepOne ?? ""
  );
  const [error, setError] = React.useState("");
  const [selectedWeekday, setSelectedWeekday] = React.useState<number | null>(null);
  const recommendedWeekday = last7DaysCounts
    ? getRecommendedWeekday(last7DaysCounts)
    : 2;
  const effectiveWeekday = selectedWeekday ?? recommendedWeekday;
  const [evaluationExpanded, setEvaluationExpanded] = React.useState(false);
  const [wobbleExpanded, setWobbleExpanded] = React.useState(false);

  const reviewWeekday = track.reviewWeekday ?? 6;
  const todayWeekday = new Date().getDay();
  const isReviewDay = todayWeekday === reviewWeekday;
  const reviewDayLabel = REVIEW_DAY_LABELS[reviewWeekday] ?? "토";

  React.useEffect(() => {
    if (review) {
      setRhythm(review.rhythm);
      setWobbleMoment(review.wobbleMoment);
      setNextWeekOneChange(review.nextWeekOneChange);
      setNextWeekKeepOne(review.nextWeekKeepOne ?? "");
    } else {
      setRhythm("steady");
      setWobbleMoment("");
      setNextWeekOneChange("");
      setNextWeekKeepOne("");
    }
  }, [review]);

  const handleStartEdit = () => {
    setIsEditing(true);
    setError("");
  };

  const handleCancel = () => {
    setIsEditing(false);
    if (review) {
      setRhythm(review.rhythm);
      setWobbleMoment(review.wobbleMoment);
      setNextWeekOneChange(review.nextWeekOneChange);
      setNextWeekKeepOne(review.nextWeekKeepOne ?? "");
    } else {
      setWobbleMoment("");
      setNextWeekOneChange("");
      setNextWeekKeepOne("");
    }
  };

  const handleSave = async () => {
    const wobble = wobbleMoment.trim();
    const change = nextWeekOneChange.trim();
    if (!wobble) {
      setError("흔들린 순간을 입력해 주세요.");
      return;
    }
    if (!change) {
      setError("다음 주 바꿀 행동 1개를 입력해 주세요.");
      return;
    }
    setError("");
    try {
      await onSave({
        goalTrackId: track.id,
        weekStartKey,
        rhythm,
        wobbleMoment: wobble,
        nextWeekOneChange: change,
        nextWeekKeepOne: nextWeekKeepOne.trim() || undefined,
      });
      setIsEditing(false);
    } catch {
      setError("저장에 실패했어요. 다시 시도해 주세요.");
    }
  };

  if (!isEditing && !review) {
    const isEditingReviewDay = editingReviewDayGoalTrackId === track.id;
    return (
      <div
        className="mt-4 rounded-[14px] px-[18px] py-[18px]"
        style={{
          background: "#FFFFFF",
          border: "1px solid rgba(0,0,0,0.08)",
        }}
      >
        <p className="text-xs font-medium text-slate-600">이번 주 평가</p>
        {isReviewDay ? (
          <button
            type="button"
            className="mt-3 w-full rounded-lg py-1.5 text-xs font-medium"
            style={{
              border: "1px solid #111",
              background: "transparent",
              color: "#111",
              padding: "6px 14px",
              borderRadius: 8,
            }}
            onClick={handleStartEdit}
          >
            이번 주 평가 작성
          </button>
        ) : (
          <p className="mt-3 text-[11px] text-slate-500">
            이번 주 평가는 {reviewDayLabel}요일에 열립니다.
          </p>
        )}
        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
          <span className="text-[11px] text-slate-500">
            평가 요일: {reviewDayLabel}요일
          </span>
          {isEditingReviewDay ? (
            <div className="flex flex-wrap gap-1">
              {REVIEW_DAY_LABELS.map((label, idx) => (
                <button
                  key={label}
                  type="button"
                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                    reviewWeekday === idx
                      ? "border-2 border-slate-800 bg-slate-100 font-medium"
                      : "border border-slate-200"
                  }`}
                  onClick={() => {
                    onUpdateReviewWeekday?.(track.id, idx);
                    onEditingReviewDayChange?.(null);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <button
              type="button"
              className="text-[11px] text-slate-500 underline hover:text-slate-700"
              onClick={() => onEditingReviewDayChange?.(track.id)}
            >
              변경
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!isEditing && review) {
    const coach =
      review.coachFact && review.coachPattern && review.coachAction
        ? {
            fact: review.coachFact,
            pattern: review.coachPattern,
            action: review.coachAction,
          }
        : last7DaysCounts
          ? buildWeeklyCoach(last7DaysCounts, review)
          : null;

    const actionSameAsNext =
      coach && review.nextWeekOneChange.trim() === coach.action.trim();
    const WOBBLE_MAX = 30;
    const wobbleLong = review.wobbleMoment.length > WOBBLE_MAX;
    const wobblePreview = wobbleLong
      ? review.wobbleMoment.slice(0, WOBBLE_MAX) + "…"
      : review.wobbleMoment;

    const isEditingReviewDay = editingReviewDayGoalTrackId === track.id;
    return (
      <div
        className="mt-4 rounded-[14px] px-[18px] py-[18px]"
        style={{
          background: "#FFFFFF",
          border: "1px solid rgba(0,0,0,0.08)",
        }}
      >
        <p className="text-xs font-medium text-slate-600">이번 주 평가</p>
        {!isReviewDay && (
          <p className="mt-2 text-[11px] text-slate-500">
            이번 주 평가는 {reviewDayLabel}요일에 열립니다.
          </p>
        )}
        {coach && (
          <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/50 p-2">
            <p className="text-[11px] text-slate-500">{coach.fact}</p>
            <p className="mt-0.5 text-[11px] text-slate-500">{coach.pattern}</p>
            <p className="mt-0.5 text-[11px] font-medium text-slate-600">
              {coach.action}
            </p>
            {onApplyAction && isReviewDay && (
              <div className="mt-2">
                <p className="mb-1.5 text-[10px] text-slate-400">언제 할지 (요일)</p>
                <div className="flex flex-wrap gap-1">
                  {WEEKDAY_LABELS.map((label, idx) => (
                    <button
                      key={label}
                      type="button"
                      className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                        effectiveWeekday === idx
                          ? "border-2 border-slate-800 bg-slate-100 font-medium text-slate-800"
                          : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                      }`}
                      onClick={() => setSelectedWeekday(idx)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          className="mt-2 flex w-full items-center justify-between text-left text-[11px] text-slate-500 hover:text-slate-600"
          onClick={() => {
            setEvaluationExpanded((e) => !e);
            if (evaluationExpanded) setWobbleExpanded(false);
          }}
        >
          <span>이번 주 평가 {evaluationExpanded ? "접기" : "보기"}</span>
        </button>
        {evaluationExpanded && (
          <div className="mt-1 space-y-1 rounded-lg border border-slate-100 bg-white/60 p-2 text-xs text-slate-600">
            <p>
              <span className="text-slate-400">리듬:</span>{" "}
              {RHYTHM_OPTIONS.find((o) => o.value === review.rhythm)?.label}
            </p>
            <p>
              <span className="text-slate-400">흔들린 순간:</span>{" "}
              {wobbleExpanded ? (
                <>
                  {review.wobbleMoment}
                  <button
                    type="button"
                    className="ml-1 text-[10px] text-slate-400 hover:underline"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setWobbleExpanded(false);
                    }}
                  >
                    접기
                  </button>
                </>
              ) : (
                <>
                  {wobblePreview}
                  {wobbleLong && (
                    <button
                      type="button"
                      className="ml-1 text-[10px] text-slate-400 hover:underline"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setWobbleExpanded(true);
                      }}
                    >
                      더보기
                    </button>
                  )}
                </>
              )}
            </p>
            {!actionSameAsNext && (
              <p>
                <span className="text-slate-400">다음 주 바꿀 행동:</span>{" "}
                {review.nextWeekOneChange}
              </p>
            )}
            {review.nextWeekKeepOne && (
              <p>
                <span className="text-slate-400">유지할 행동:</span>{" "}
                {review.nextWeekKeepOne}
              </p>
            )}
          </div>
        )}
        {isReviewDay && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {coach?.action && onApplyAction && (
              <button
                type="button"
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] text-slate-600 hover:bg-slate-50"
                onClick={() => onApplyAction(track.id, coach.action, effectiveWeekday)}
              >
                다음 주 구조 적용(투두 추가)
              </button>
            )}
            <button
              type="button"
              className="text-[11px] text-slate-500 underline-offset-1 hover:underline"
              onClick={handleStartEdit}
            >
              수정
            </button>
          </div>
        )}
        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
          <span className="text-[11px] text-slate-500">
            평가 요일: {reviewDayLabel}요일
          </span>
          {isEditingReviewDay ? (
            <div className="flex flex-wrap gap-1">
              {REVIEW_DAY_LABELS.map((label, idx) => (
                <button
                  key={label}
                  type="button"
                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                    reviewWeekday === idx
                      ? "border-2 border-slate-800 bg-slate-100 font-medium"
                      : "border border-slate-200"
                  }`}
                  onClick={() => {
                    onUpdateReviewWeekday?.(track.id, idx);
                    onEditingReviewDayChange?.(null);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <button
              type="button"
              className="text-[11px] text-slate-500 underline hover:text-slate-700"
              onClick={() => onEditingReviewDayChange?.(track.id)}
            >
              변경
            </button>
          )}
        </div>
      </div>
    );
  }

  const isEditingReviewDay = editingReviewDayGoalTrackId === track.id;
    return (
    <div
      className="mt-4 rounded-[14px] px-[18px] py-[18px]"
      style={{
        background: "#FFFFFF",
        border: "1px solid rgba(0,0,0,0.08)",
      }}
    >
      <p className="text-xs font-medium text-slate-600">이번 주 평가</p>
      <div className="mt-2 space-y-2">
        <div>
          <label className="text-[11px] text-slate-500">리듬 (3택1)</label>
          <select
            value={rhythm}
            onChange={(e) => setRhythm(e.target.value as WeeklyReviewRhythm)}
            className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
          >
            {RHYTHM_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-slate-500">흔들린 순간 (필수)</label>
          <textarea
            value={wobbleMoment}
            onChange={(e) => setWobbleMoment(e.target.value)}
            placeholder="예) 화요일 오후 집중이 안 됐을 때"
            rows={2}
            className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
          />
        </div>
        <div>
          <label className="text-[11px] text-slate-500">
            다음 주 바꿀 행동 1개 (필수)
          </label>
          <input
            type="text"
            value={nextWeekOneChange}
            onChange={(e) => setNextWeekOneChange(e.target.value)}
            placeholder="예) 아침 9시에 1차 블로킹"
            className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
          />
        </div>
        <div>
          <label className="text-[11px] text-slate-500">
            유지할 행동 1개 (선택)
          </label>
          <input
            type="text"
            value={nextWeekKeepOne}
            onChange={(e) => setNextWeekKeepOne(e.target.value)}
            placeholder="예) 저녁 리뷰 10분"
            className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
          />
        </div>
      </div>
      {error && <p className="mt-1 text-[11px] text-rose-500">{error}</p>}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className="rounded-lg px-3 py-1.5 text-[11px]"
          style={{
            border: "1px solid #ccc",
            background: "transparent",
            color: "#666",
          }}
          onClick={handleCancel}
        >
          취소
        </button>
        <button
          type="button"
          className="rounded-lg px-3 py-1.5 text-[11px] font-medium"
          style={{
            border: "1px solid #111",
            background: "transparent",
            color: "#111",
          }}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
        <span className="text-[11px] text-slate-500">
          평가 요일: {reviewDayLabel}요일
        </span>
        {isEditingReviewDay ? (
          <div className="flex flex-wrap gap-1">
            {REVIEW_DAY_LABELS.map((label, idx) => (
              <button
                key={label}
                type="button"
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  reviewWeekday === idx
                    ? "border-2 border-slate-800 bg-slate-100 font-medium"
                    : "border border-slate-200"
                }`}
                onClick={() => {
                  onUpdateReviewWeekday?.(track.id, idx);
                  onEditingReviewDayChange?.(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <button
            type="button"
            className="text-[11px] text-slate-500 underline hover:text-slate-700"
            onClick={() => onEditingReviewDayChange?.(track.id)}
          >
            변경
          </button>
        )}
      </div>
    </div>
  );
}
