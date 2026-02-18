"use client";

import React from "react";
import type { GoalTrack } from "@/types/goalTrack";
import type {
  GoalTrackWeeklyReview,
  WeeklyStatus,
} from "@/types/goalTrackWeeklyReview";
import { MissedReasonType } from "@/types/missed-reason";
import { buildWeeklyCoach } from "@/domain/weeklyCoach";
import { getExecutedDayCount, getRecentGap } from "@/domain/execution";
import { getLastNDateKeys } from "@/domain/date";
import {
  BLOCK_REASON_LABELS,
  WEEKLY_REVIEW_BLOCK_REASONS,
} from "@/domain/blockReason";
import {
  type StrategyType,
  STRATEGY_LABELS,
  STRATEGY_OPTIONS,
} from "@/types/strategyType";

/** 0=일, 1=월, ... 6=토 (Date.getDay()) */
const REVIEW_DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

const STATUS_OPTIONS: { value: WeeklyStatus; label: string }[] = [
  { value: "STEADY", label: "유지됨" },
  { value: "SPORADIC", label: "들쭉날쭉" },
  { value: "STOPPED", label: "멈춤" },
];

/** 기존 rhythm → status 매핑 */
function rhythmToStatus(
  r?: "steady" | "sporadic" | "stopped"
): WeeklyStatus {
  if (r === "steady") return "STEADY";
  if (r === "sporadic") return "SPORADIC";
  if (r === "stopped") return "STOPPED";
  return "STEADY";
}

/** status → rhythm (하위호환 저장용) */
function statusToRhythm(s: WeeklyStatus): "steady" | "sporadic" | "stopped" {
  if (s === "STEADY") return "steady";
  if (s === "SPORADIC") return "sporadic";
  return "stopped";
}

/** review에서 nextWeekRuleText 또는 nextWeekOneChange 추출 */
function getNextWeekRuleText(review: GoalTrackWeeklyReview | null): string {
  if (!review) return "";
  return (
    review.nextWeekRuleText?.trim() ||
    review.nextWeekOneChange?.trim() ||
    ""
  );
}

/** review에서 status 추출 (기존 rhythm 매핑) */
function getReviewStatus(review: GoalTrackWeeklyReview | null): WeeklyStatus {
  if (!review) return "STEADY";
  if (review.status) return review.status;
  return rhythmToStatus(review.rhythm);
}

type Props = {
  track: GoalTrack;
  review: GoalTrackWeeklyReview | null;
  weekStartKey: string;
  last7DaysCounts?: Record<string, number>;
  recentExecution?: { executedDays: number; lastExecutedText: string };
  editingReviewDayGoalTrackId?: string | null;
  onUpdateReviewWeekday?: (goalTrackId: string, reviewWeekday: number) => void;
  onEditingReviewDayChange?: (goalTrackId: string | null) => void;
  onApplyAction?: (goalTrackId: string, actionText: string, weekday: number) => void;
  onSave: (data: {
    goalTrackId: string;
    weekStartKey: string;
    status: WeeklyStatus;
    blockReason?: MissedReasonType | null;
    blockNote?: string;
    nextWeekRuleText: string;
    plannedWeekdays?: number[];
    selectedStrategies?: StrategyType[];
    aiRefinedRuleText?: string;
    aiRefineRationale?: string;
  }) => Promise<void>;
  saving?: boolean;
};

export function WeeklyReviewCard({
  track,
  review,
  weekStartKey,
  last7DaysCounts,
  recentExecution,
  editingReviewDayGoalTrackId = null,
  onUpdateReviewWeekday,
  onEditingReviewDayChange,
  onApplyAction,
  onSave,
  saving = false,
}: Props) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [status, setStatus] = React.useState<WeeklyStatus>(
    getReviewStatus(review)
  );
  const [blockReason, setBlockReason] = React.useState<MissedReasonType | null>(
    review?.blockReason ?? null
  );
  const [nextWeekRuleText, setNextWeekRuleText] = React.useState(
    getNextWeekRuleText(review)
  );
  const [plannedWeekdays, setPlannedWeekdays] = React.useState<number[]>(
    review?.plannedWeekdays ?? []
  );
  const [selectedStrategies, setSelectedStrategies] = React.useState<
    StrategyType[]
  >(review?.selectedStrategies ?? []);
  const [error, setError] = React.useState("");
  const [selectedWeekday, setSelectedWeekday] = React.useState<number | null>(
    null
  );
  const [evaluationExpanded, setEvaluationExpanded] = React.useState(false);
  const [aiLoading, setAiLoading] = React.useState(false);
  const [aiResult, setAiResult] = React.useState<{
    refinedText: string;
    rationale: string;
  } | null>(null);

  const reviewWeekday = track.reviewWeekday ?? 6;
  const todayWeekday = new Date().getDay();
  const isReviewDay = todayWeekday === reviewWeekday;
  const reviewDayLabel = REVIEW_DAY_LABELS[reviewWeekday] ?? "토";

  React.useEffect(() => {
    if (review) {
      setStatus(getReviewStatus(review));
      setBlockReason(review.blockReason ?? null);
      setNextWeekRuleText(getNextWeekRuleText(review));
      setPlannedWeekdays(review.plannedWeekdays ?? []);
      setSelectedStrategies(review.selectedStrategies ?? []);
    } else {
      setStatus("STEADY");
      setBlockReason(null);
      setNextWeekRuleText("");
      setPlannedWeekdays([]);
      setSelectedStrategies([]);
    }
    setAiResult(null);
  }, [review]);

  const handleStartEdit = () => {
    setIsEditing(true);
    setError("");
    setAiResult(null);
  };

  const handleCancel = () => {
    setIsEditing(false);
    if (review) {
      setStatus(getReviewStatus(review));
      setBlockReason(review.blockReason ?? null);
      setNextWeekRuleText(getNextWeekRuleText(review));
      setPlannedWeekdays(review.plannedWeekdays ?? []);
      setSelectedStrategies(review.selectedStrategies ?? []);
    } else {
      setBlockReason(null);
      setNextWeekRuleText("");
      setPlannedWeekdays([]);
      setSelectedStrategies([]);
    }
    setAiResult(null);
  };

  const toggleStrategy = (s: StrategyType) => {
    setSelectedStrategies((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  };

  const togglePlannedWeekday = (d: number) => {
    setPlannedWeekdays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()
    );
  };

  const handleSave = async () => {
    const rule = nextWeekRuleText.trim();
    if (!rule) {
      setError("다음 주 실행 규칙 1개를 입력해 주세요.");
      return;
    }
    setError("");
    try {
      await onSave({
        goalTrackId: track.id,
        weekStartKey,
        status,
        blockReason: status === "STEADY" ? null : blockReason,
        nextWeekRuleText: rule,
        plannedWeekdays: plannedWeekdays.length > 0 ? plannedWeekdays : undefined,
        selectedStrategies:
          selectedStrategies.length > 0 ? selectedStrategies : undefined,
      });
      setIsEditing(false);
      setAiResult(null);
    } catch {
      setError("저장에 실패했어요. 다시 시도해 주세요.");
    }
  };

  const handleAiRefine = async () => {
    if (selectedStrategies.length === 0) {
      setError("전략을 1개 이상 선택해 주세요.");
      return;
    }
    setAiLoading(true);
    setError("");
    setAiResult(null);
    try {
      const res = await fetch("/api/ai/refine-weekly-rule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goalTrackTitle: track.title,
          weeklyStatus: status,
          blockReason: blockReason ?? undefined,
          draftRule: nextWeekRuleText.trim() || "(초안 없음)",
          selectedStrategies,
          recentExecution,
        }),
      });
      const json = (await res.json()) as { result?: { refinedText: string; rationale: string } };
      if (json.result?.refinedText && json.result?.rationale) {
        setAiResult(json.result);
      } else {
        setError("AI 정리에 실패했어요. 다시 시도해 주세요.");
      }
    } catch {
      setError("AI 정리에 실패했어요. 다시 시도해 주세요.");
    } finally {
      setAiLoading(false);
    }
  };

  const handleApplyAiResult = () => {
    if (aiResult?.refinedText) {
      setNextWeekRuleText(aiResult.refinedText);
      setAiResult(null);
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
        <p className="text-xs font-medium text-slate-600">
          이번 주 평가 (평가 요일: {reviewDayLabel}요일)
        </p>
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
          ? buildWeeklyCoach(last7DaysCounts, {
              rhythm: statusToRhythm(getReviewStatus(review)),
              wobbleMoment: "",
              nextWeekOneChange: "",
              nextWeekRuleText: getNextWeekRuleText(review),
            })
          : null;

    const ruleText = getNextWeekRuleText(review);
    const actionSameAsRule =
      coach && ruleText.trim() === coach.action.trim();
    const effectiveWeekday =
      selectedWeekday ?? (plannedWeekdays[0] ?? 1);

    const isEditingReviewDay = editingReviewDayGoalTrackId === track.id;
    return (
      <div
        className="mt-4 rounded-[14px] px-[18px] py-[18px]"
        style={{
          background: "#FFFFFF",
          border: "1px solid rgba(0,0,0,0.08)",
        }}
      >
        <p className="text-xs font-medium text-slate-600">
          이번 주 평가 (평가 요일: {reviewDayLabel}요일)
        </p>
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
                <p className="mb-1.5 text-[10px] text-slate-400">
                  언제 할지 (요일)
                </p>
                <div className="flex flex-wrap gap-1">
                  {REVIEW_DAY_LABELS.map((label, idx) => (
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
          }}
        >
          <span>이번 주 평가 {evaluationExpanded ? "접기" : "보기"}</span>
        </button>
        {evaluationExpanded && (
          <div className="mt-1 space-y-1 rounded-lg border border-slate-100 bg-white/60 p-2 text-xs text-slate-600">
            <p>
              <span className="text-slate-400">이번 주 상태:</span>{" "}
              {STATUS_OPTIONS.find((o) => o.value === getReviewStatus(review))
                ?.label}
            </p>
            {review.blockReason && (
              <p>
                <span className="text-slate-400">막힌 이유:</span>{" "}
                {BLOCK_REASON_LABELS[review.blockReason]}
              </p>
            )}
            {!actionSameAsRule && (
              <p>
                <span className="text-slate-400">다음 주 실행 규칙:</span>{" "}
                {ruleText}
              </p>
            )}
            {review.selectedStrategies && review.selectedStrategies.length > 0 && (
              <p>
                <span className="text-slate-400">선택 전략:</span>{" "}
                {review.selectedStrategies
                  .map((s) => STRATEGY_LABELS[s])
                  .join(", ")}
              </p>
            )}
            {review.plannedWeekdays && review.plannedWeekdays.length > 0 && (
              <p>
                <span className="text-slate-400">언제 할지:</span>{" "}
                {review.plannedWeekdays
                  .map((d) => REVIEW_DAY_LABELS[d])
                  .join(", ")}
                요일
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
                onClick={() =>
                  onApplyAction(track.id, coach.action, effectiveWeekday)
                }
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
      <p className="text-xs font-medium text-slate-600">
        이번 주 평가 (평가 요일: {reviewDayLabel}요일)
      </p>
      <div className="mt-2 space-y-3">
        <div>
          <label className="text-[11px] text-slate-500">
            이번 주 상태 (3택1)
          </label>
          <div className="mt-1 flex flex-wrap gap-1">
            {STATUS_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`rounded-full px-2.5 py-1 text-[11px] ${
                  status === o.value
                    ? "border-2 border-slate-800 bg-slate-100 font-medium"
                    : "border border-slate-200"
                }`}
                onClick={() => setStatus(o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        {status !== "STEADY" && (
          <div>
            <label className="text-[11px] text-slate-500">
              막힌 이유 (선택)
            </label>
            <div className="mt-1 flex flex-wrap gap-1">
              {WEEKLY_REVIEW_BLOCK_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`rounded-full px-2.5 py-1 text-[11px] ${
                    blockReason === r
                      ? "border-2 border-slate-800 bg-slate-100 font-medium"
                      : "border border-slate-200"
                  }`}
                  onClick={() => setBlockReason(blockReason === r ? null : r)}
                >
                  {BLOCK_REASON_LABELS[r]}
                </button>
              ))}
            </div>
          </div>
        )}
        <div>
          <label className="text-[11px] text-slate-500">
            다음 주 실행 규칙 1개 (필수)
          </label>
          <input
            type="text"
            value={nextWeekRuleText}
            onChange={(e) => setNextWeekRuleText(e.target.value)}
            placeholder="예) 아침 9시에 1차 블로킹"
            className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
          />
          <p className="mt-2 text-[11px] text-slate-500">
            전략 선택 (복수 선택 가능)
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            {STRATEGY_OPTIONS.map((s) => (
              <button
                key={s}
                type="button"
                className="rounded-[20px] px-3 py-1.5 text-[11px] transition-colors"
                style={
                  selectedStrategies.includes(s)
                    ? { background: "#111", color: "#fff" }
                    : {
                        border: "1px solid #e2e8f0",
                        background: "#fff",
                        color: "#64748b",
                      }
                }
                onClick={() => toggleStrategy(s)}
              >
                {STRATEGY_LABELS[s]}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              onClick={handleAiRefine}
              disabled={aiLoading || selectedStrategies.length === 0}
            >
              {aiLoading ? "정리 중..." : "AI로 한 줄 정리"}
            </button>
          </div>
          {aiResult && (
            <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50/50 p-2">
              <p className="text-[10px] text-slate-400">정리 결과</p>
              <p className="mt-0.5 text-[11px] font-medium text-slate-700">
                {aiResult.refinedText}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-500">
                {aiResult.rationale}
              </p>
              <div className="mt-2 flex gap-1">
                <button
                  type="button"
                  className="rounded px-2 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-100"
                  onClick={handleApplyAiResult}
                >
                  적용
                </button>
                <button
                  type="button"
                  className="rounded px-2 py-0.5 text-[10px] text-slate-500 hover:bg-slate-100"
                  onClick={() => setAiResult(null)}
                >
                  닫기
                </button>
              </div>
            </div>
          )}
        </div>
        <div>
          <label className="text-[11px] text-slate-500">
            언제 할지 (요일, 선택)
          </label>
          <div className="mt-1 flex flex-wrap gap-1">
            {REVIEW_DAY_LABELS.map((label, idx) => (
              <button
                key={label}
                type="button"
                className={`rounded-full px-2.5 py-1 text-[11px] ${
                  plannedWeekdays.includes(idx)
                    ? "border-2 border-slate-800 bg-slate-100 font-medium"
                    : "border border-slate-200"
                }`}
                onClick={() => togglePlannedWeekday(idx)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {error && (
        <p className="mt-1 text-[11px] text-rose-500">{error}</p>
      )}
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
