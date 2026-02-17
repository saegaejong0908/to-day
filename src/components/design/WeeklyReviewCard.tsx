"use client";

import React from "react";
import type { GoalTrack } from "@/types/goalTrack";
import type { GoalTrackWeeklyReview, WeeklyReviewRhythm } from "@/types/goalTrackWeeklyReview";
import { generateCoachResponse } from "@/domain/weeklyReview";

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
  onAddTodo?: (goalTrackId: string, text: string) => void;
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
  onAddTodo,
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
    return (
      <div className="mt-2 rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2">
        <button
          type="button"
          className="w-full rounded-lg border border-dashed border-slate-200 py-2 text-xs text-slate-500 hover:border-slate-300"
          onClick={handleStartEdit}
        >
          이번 주 평가 작성
        </button>
      </div>
    );
  }

  if (!isEditing && review) {
    return (
      <div className="mt-2 rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2">
        <p className="text-[11px] font-medium text-slate-500">이번 주 평가</p>
        <div className="mt-1 space-y-1 text-xs text-slate-600">
          <p>
            <span className="text-slate-400">리듬:</span>{" "}
            {RHYTHM_OPTIONS.find((o) => o.value === review.rhythm)?.label}
          </p>
          <p>
            <span className="text-slate-400">흔들린 순간:</span> {review.wobbleMoment}
          </p>
          <p>
            <span className="text-slate-400">다음 주 바꿀 행동:</span>{" "}
            {review.nextWeekOneChange}
          </p>
          {review.nextWeekKeepOne && (
            <p>
              <span className="text-slate-400">유지할 행동:</span>{" "}
              {review.nextWeekKeepOne}
            </p>
          )}
        </div>
        <div className="mt-2 rounded-lg border border-slate-100 bg-white/80 p-2">
          <p className="text-[11px] text-slate-500">{review.coachSummary}</p>
          <p className="mt-1 text-[11px] font-medium text-slate-600">
            {review.coachQuestion}
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {review.nextWeekOneChange && onAddTodo && (
            <button
              type="button"
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
              onClick={() => onAddTodo(track.id, review.nextWeekOneChange)}
            >
              이 행동을 투두로 추가
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
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2">
      <p className="text-[11px] font-medium text-slate-500">이번 주 평가</p>
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
          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-600"
          onClick={handleCancel}
        >
          취소
        </button>
        <button
          type="button"
          className="rounded-full bg-slate-900 px-3 py-1 text-[11px] font-medium text-white disabled:bg-slate-300"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </div>
  );
}
