"use client";

import React from "react";
import type { GoalTrack } from "@/types/goalTrack";
import type {
  GoalTrackWeeklyReview,
  WeeklyStatus,
} from "@/types/goalTrackWeeklyReview";
import { MissedReasonType } from "@/types/missed-reason";
import { buildWeeklyCoach } from "@/domain/weeklyCoach";
import {
  getExecutedDayCount,
  getRecentGap,
  getTotalActionCount,
  getLastExecutedText,
} from "@/domain/execution";
import { getLastNDateKeys } from "@/domain/date";
import { getLocalDateKey } from "@/lib/date";
import { RhythmDots } from "@/components/design/RhythmDots";
import type { OutcomeMode, OutcomeSense } from "@/types/goalTrackWeeklyReview";
import { OutcomeSnapshot } from "@/components/design/OutcomeSnapshot";

/** 0=일, 1=월, ... 6=토 (Date.getDay()) */
const REVIEW_DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

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

/** review에서 nextWeekRules 추출 (하위호환) */
function getNextWeekRules(
  review: GoalTrackWeeklyReview | null
): Array<{ text: string; weekdays?: number[] }> {
  if (!review) return [];
  if (review.nextWeekRules && review.nextWeekRules.length > 0) {
    return review.nextWeekRules
      .filter((r) => r.text?.trim())
      .map((r) => {
        const raw = r as { text: string; weekdays?: number[]; weekday?: number };
        const weekdays = Array.isArray(raw.weekdays)
          ? raw.weekdays.filter((d) => d >= 0 && d <= 6)
          : typeof raw.weekday === "number" &&
              raw.weekday >= 0 &&
              raw.weekday <= 6
            ? [raw.weekday]
            : undefined;
        return {
          text: raw.text.trim(),
          weekdays: weekdays && weekdays.length > 0 ? weekdays : undefined,
        };
      });
  }
  const legacy = getNextWeekRuleText(review);
  if (!legacy) return [];
  return [
    {
      text: legacy,
      weekdays: review.plannedWeekdays?.filter((d) => d >= 0 && d <= 6),
    },
  ];
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
  /** DesignPlan 내 첫 목표의 평가 요일. 없으면 track.reviewWeekday 사용 */
  planReviewWeekday?: number;
  last7DaysCounts?: Record<string, number>;
  /** 날짜별 완료 비율 (done/total). 있으면 점 강도에 사용 */
  last7DaysCompletionRatios?: Record<
    string,
    { done: number; total: number }
  >;
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
    nextWeekRules: Array<{ text: string; weekdays?: number[] }>;
    outcomeMode?: OutcomeMode;
    metricLabel?: string;
    metricValue?: number | null;
    metricUnit?: string;
    sense?: OutcomeSense | null;
    outcomeNote?: string;
  }) => Promise<void>;
  /** 스냅샷만 저장 (nextWeekRules 등 기존 데이터 보존) */
  onSaveSnapshotOnly?: (data: {
    goalTrackId: string;
    weekStartKey: string;
    outcomeMode?: OutcomeMode;
    metricLabel?: string;
    metricValue?: number | null;
    metricUnit?: string;
    sense?: OutcomeSense | null;
    outcomeNote?: string;
  }) => Promise<void>;
  /** 부모 제어: 모든 카드 동기화용. 없으면 내부 state 사용 */
  reviewContentExpanded?: boolean;
  onReviewContentExpandedChange?: (expanded: boolean) => void;
  saving?: boolean;
};

export function WeeklyReviewCard({
  track,
  review,
  weekStartKey,
  planReviewWeekday,
  last7DaysCounts,
  last7DaysCompletionRatios,
  recentExecution,
  editingReviewDayGoalTrackId = null,
  onUpdateReviewWeekday,
  onEditingReviewDayChange,
  onApplyAction,
  onSave,
  onSaveSnapshotOnly,
  reviewContentExpanded: reviewContentExpandedProp,
  onReviewContentExpandedChange,
  saving = false,
}: Props) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [reviewContentExpandedLocal, setReviewContentExpandedLocal] =
    React.useState(false);
  const reviewContentExpanded =
    reviewContentExpandedProp ?? reviewContentExpandedLocal;
  const setReviewContentExpanded = (v: boolean) => {
    if (onReviewContentExpandedChange) {
      onReviewContentExpandedChange(v);
    } else {
      setReviewContentExpandedLocal(v);
    }
  };
  const [nextWeekRules, setNextWeekRules] = React.useState<
    Array<{ text: string; weekdays?: number[] }>
  >(getNextWeekRules(review));
  const [outcomeSnapshotExpanded, setOutcomeSnapshotExpanded] =
    React.useState(false);
  const [outcomeMode, setOutcomeMode] = React.useState<
    OutcomeMode | undefined
  >(review?.outcomeMode);
  const [metricLabel, setMetricLabel] = React.useState(
    review?.metricLabel ?? ""
  );
  const [metricValue, setMetricValue] = React.useState<number | "">(
    review?.metricValue != null ? review.metricValue : ""
  );
  const [metricUnit, setMetricUnit] = React.useState(
    review?.metricUnit ?? ""
  );
  const [sense, setSense] = React.useState<OutcomeSense | null>(
    review?.sense ?? null
  );
  const [outcomeNote, setOutcomeNote] = React.useState(
    review?.outcomeNote ?? ""
  );
  const [error, setError] = React.useState("");
  const [selectedWeekday, setSelectedWeekday] = React.useState<number | null>(
    null
  );
  const [executionCheckExpanded, setExecutionCheckExpanded] = React.useState(false);
  const [expandedWeekdayRuleIdx, setExpandedWeekdayRuleIdx] = React.useState<
    number | null
  >(null);

  const reviewWeekday =
    planReviewWeekday ?? track.reviewWeekday ?? 6;
  const todayWeekday = new Date().getDay();
  const isReviewDay = todayWeekday === reviewWeekday;
  const reviewDayLabel = REVIEW_DAY_LABELS[reviewWeekday] ?? "토";

  React.useEffect(() => {
    if (review) {
      if (!onReviewContentExpandedChange) setReviewContentExpanded(false);
      setExecutionCheckExpanded(false);
      setOutcomeSnapshotExpanded(false);
      setNextWeekRules(getNextWeekRules(review));
      setOutcomeMode(review.outcomeMode);
      setMetricLabel(review.metricLabel ?? "");
      setMetricValue(review.metricValue != null ? review.metricValue : "");
      setMetricUnit(review.metricUnit ?? "");
      setSense(review.sense ?? null);
      setOutcomeNote(review.outcomeNote ?? "");
      setOutcomeSnapshotExpanded(!!review.outcomeMode);
    } else {
      setNextWeekRules([]);
      setOutcomeMode(undefined);
      setMetricLabel("");
      setMetricValue("");
      setMetricUnit("");
      setSense(null);
      setOutcomeNote("");
      setOutcomeSnapshotExpanded(false);
    }
  }, [review]);

  const handleStartEdit = () => {
    setIsEditing(true);
    setError("");
  };

  const handleCancel = () => {
    setIsEditing(false);
    setExpandedWeekdayRuleIdx(null);
    if (review) {
      setNextWeekRules(getNextWeekRules(review));
      setOutcomeMode(review.outcomeMode);
      setMetricLabel(review.metricLabel ?? "");
      setMetricValue(review.metricValue != null ? review.metricValue : "");
      setMetricUnit(review.metricUnit ?? "");
      setSense(review.sense ?? null);
      setOutcomeNote(review.outcomeNote ?? "");
      setOutcomeSnapshotExpanded(!!review.outcomeMode);
    } else {
      setNextWeekRules([]);
      setOutcomeMode(undefined);
      setMetricLabel("");
      setMetricValue("");
      setMetricUnit("");
      setSense(null);
      setOutcomeNote("");
      setOutcomeSnapshotExpanded(false);
    }
  };

  const addNextWeekRule = () => {
    setNextWeekRules((prev) => [...prev, { text: "", weekdays: undefined }]);
  };

  const removeNextWeekRule = (idx: number) => {
    setNextWeekRules((prev) => prev.filter((_, i) => i !== idx));
  };

  const toggleRuleWeekday = (idx: number, d: number) => {
    setNextWeekRules((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        const list = r.weekdays ?? [];
        const has = list.includes(d);
        const next = has ? list.filter((x) => x !== d) : [...list, d].sort();
        return { ...r, weekdays: next.length > 0 ? next : undefined };
      })
    );
  };

  const updateNextWeekRule = (
    idx: number,
    upd: Partial<{ text: string; weekdays?: number[] }>
  ) => {
    setNextWeekRules((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, ...upd } : r))
    );
  };

  const handleSave = async () => {
    const rules = nextWeekRules
      .map((r) => ({ ...r, text: r.text.trim() }))
      .filter((r) => r.text);
    if (rules.length === 0) {
      setError("다음 주 실행을 1개 이상 입력해 주세요.");
      return;
    }
    if (outcomeMode === "metric" && (metricValue === "" || metricValue === null)) {
      setError("지표 값을 입력해 주세요.");
      return;
    }
    if (outcomeMode === "sense" && !sense) {
      setError("체감을 선택해 주세요.");
      return;
    }
    setError("");
    try {
      await onSave({
        goalTrackId: track.id,
        weekStartKey,
        status: getReviewStatus(review),
        blockReason: review?.blockReason ?? null,
        nextWeekRules: rules,
        outcomeMode: outcomeMode ?? undefined,
        metricLabel:
          outcomeMode === "metric" ? metricLabel.trim() || undefined : undefined,
        metricValue:
          outcomeMode === "metric" && metricValue !== ""
            ? Number(metricValue)
            : undefined,
        metricUnit:
          outcomeMode === "metric" ? metricUnit.trim() || undefined : undefined,
        sense: outcomeMode === "sense" ? sense : undefined,
        outcomeNote: outcomeNote.trim() || undefined,
      });
      setIsEditing(false);
    } catch {
      setError("저장에 실패했어요. 다시 시도해 주세요.");
    }
  };

  const handleSaveSnapshotOnly = async () => {
    if (!outcomeMode) {
      setError("지표, 체감, 생략 중 하나를 선택해 주세요.");
      return;
    }
    if (outcomeMode === "metric" && (metricValue === "" || metricValue === null)) {
      setError("지표 값을 입력해 주세요.");
      return;
    }
    if (outcomeMode === "sense" && !sense) {
      setError("체감을 선택해 주세요.");
      return;
    }
    setError("");
    try {
      if (onSaveSnapshotOnly) {
        await onSaveSnapshotOnly({
          goalTrackId: track.id,
          weekStartKey,
          outcomeMode: outcomeMode ?? undefined,
          metricLabel:
            outcomeMode === "metric" ? metricLabel.trim() || undefined : undefined,
          metricValue:
            outcomeMode === "metric" && metricValue !== ""
              ? Number(metricValue)
              : undefined,
          metricUnit:
            outcomeMode === "metric" ? metricUnit.trim() || undefined : undefined,
          sense: outcomeMode === "sense" ? sense : undefined,
          outcomeNote: outcomeNote.trim() || undefined,
        });
      } else {
        const rules = getNextWeekRules(review).map((r) => ({
          ...r,
          text: r.text.trim(),
        })).filter((r) => r.text);
        await onSave({
          goalTrackId: track.id,
          weekStartKey,
          status: getReviewStatus(review),
          blockReason: review?.blockReason ?? null,
          nextWeekRules: rules,
          outcomeMode: outcomeMode ?? undefined,
          metricLabel:
            outcomeMode === "metric" ? metricLabel.trim() || undefined : undefined,
          metricValue:
            outcomeMode === "metric" && metricValue !== ""
              ? Number(metricValue)
              : undefined,
          metricUnit:
            outcomeMode === "metric" ? metricUnit.trim() || undefined : undefined,
          sense: outcomeMode === "sense" ? sense : undefined,
          outcomeNote: outcomeNote.trim() || undefined,
        });
      }
      setOutcomeSnapshotExpanded(false);
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
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-slate-600">이번 주 평가</p>
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
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-slate-500">
                평가 요일: {reviewDayLabel}요일
              </span>
              <span className="text-slate-300">·</span>
              <button
                type="button"
                className="text-[11px] text-slate-500 underline hover:text-slate-700"
                onClick={() => onEditingReviewDayChange?.(track.id)}
              >
                변경
              </button>
            </div>
          )}
        </div>
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
      </div>
    );
  }

  if (!isEditing && review && (!reviewContentExpanded || !isReviewDay)) {
    const isEditingReviewDay = editingReviewDayGoalTrackId === track.id;
    return (
      <div
        className="mt-4 rounded-[14px] px-[18px] py-[18px]"
        style={{
          background: "#FFFFFF",
          border: "1px solid rgba(0,0,0,0.08)",
        }}
      >
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-slate-600">이번 주 평가</p>
          {isEditingReviewDay ? (
            <div className="flex flex-wrap gap-1">
              {REVIEW_DAY_LABELS.map((label, idx) => (
                <button
                  key={label}
                  type="button"
                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                    (planReviewWeekday ?? track.reviewWeekday ?? 6) === idx
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
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-slate-500">
                평가 요일: {reviewDayLabel}요일
              </span>
              <span className="text-slate-300">·</span>
              <button
                type="button"
                className="text-[11px] text-slate-500 underline hover:text-slate-700"
                onClick={() => onEditingReviewDayChange?.(track.id)}
              >
                변경
              </button>
            </div>
          )}
        </div>
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
            onClick={() => setReviewContentExpanded(true)}
          >
            이번 주 평가 보기
          </button>
        ) : (
          <p className="mt-3 text-[11px] text-slate-500">
            이번 주 평가는 {reviewDayLabel}요일에 열립니다.
          </p>
        )}
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
              nextWeekRuleText:
                getNextWeekRules(review)[0]?.text ||
                getNextWeekRuleText(review),
            })
          : null;

    const rules = getNextWeekRules(review);
    const firstRuleText = rules[0]?.text?.trim() ?? "";
    const actionSameAsRule =
      coach && firstRuleText === coach.action.trim();
    const effectiveWeekday =
      selectedWeekday ?? rules[0]?.weekdays?.[0] ?? 1;

    const readKeys = getLastNDateKeys(7);
    const readExecutedDays = last7DaysCounts
      ? getExecutedDayCount(last7DaysCounts, readKeys)
      : 0;
    const readTotalActions = last7DaysCounts
      ? getTotalActionCount(last7DaysCounts, readKeys)
      : 0;
    const readLastExecuted = last7DaysCounts
      ? getLastExecutedText(last7DaysCounts, readKeys)
      : { text: "-", isWarning: false };
    const readShowLastExecuted =
      readLastExecuted.text !== "오늘 실행했어요." &&
      readLastExecuted.text !== "-";

    const isEditingReviewDay = editingReviewDayGoalTrackId === track.id;

    return (
      <div
        className="mt-4 rounded-[14px] px-[18px] py-[18px]"
        style={{
          background: "#FFFFFF",
          border: "1px solid rgba(0,0,0,0.08)",
        }}
      >
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-slate-600">이번 주 평가</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-[10px] text-slate-400 hover:text-slate-600"
              onClick={() => {
                setReviewContentExpanded(false);
                setExecutionCheckExpanded(false);
              }}
            >
              접기
            </button>
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
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-slate-500">
                  평가 요일: {reviewDayLabel}요일
                </span>
                <span className="text-slate-300">·</span>
                <button
                  type="button"
                  className="text-[11px] text-slate-500 underline hover:text-slate-700"
                  onClick={() => onEditingReviewDayChange?.(track.id)}
                >
                  변경
                </button>
              </div>
            )}
          </div>
        </div>
        {!isReviewDay && (
          <p className="mt-2 text-[11px] text-slate-500">
            이번 주 평가는 {reviewDayLabel}요일에 열립니다.
          </p>
        )}
        {executionCheckExpanded ? (
          <div
            className="mt-3 rounded-[12px] px-4 py-3"
            style={{ background: "#F6F7F8" }}
          >
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium text-slate-600">
                이번 주 실행 점검
              </p>
              <button
                type="button"
                className="text-[10px] text-slate-400 hover:text-slate-600"
                onClick={() => setExecutionCheckExpanded(false)}
              >
                접기
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white px-2.5 py-0.5 text-[10px] font-medium text-slate-600 shadow-sm">
                최근 7일 · {readExecutedDays}일
              </span>
              <span className="rounded-full bg-white px-2.5 py-0.5 text-[10px] font-medium text-slate-600 shadow-sm">
                총 {readTotalActions}회
              </span>
            </div>
            {readShowLastExecuted && (
              <p
                className="mt-1.5 text-[10px] text-slate-500"
                style={
                  readLastExecuted.isWarning ? { color: "#B45309" } : undefined
                }
              >
                마지막 실행: {readLastExecuted.text}
              </p>
            )}
            <div className="mt-2 overflow-visible">
              <RhythmDots
                dateKeys={readKeys}
                completionRatios={
                  last7DaysCompletionRatios ??
                  Object.fromEntries(
                    readKeys.map((k) => [
                      k,
                      {
                        done: last7DaysCounts?.[k] ?? 0,
                        total: (last7DaysCounts?.[k] ?? 0) || 0,
                      },
                    ])
                  )
                }
                todayKey={getLocalDateKey()}
              />
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="mt-3 w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-[11px] text-slate-600 hover:bg-slate-50"
            onClick={() => setExecutionCheckExpanded(true)}
          >
            이번 주 실행 점검
          </button>
        )}
        <div
          className="mt-3 rounded-[12px] border border-slate-200 bg-white"
        >
          {(review.outcomeMode === "metric" ||
            review.outcomeMode === "sense" ||
            review.outcomeMode === "skip") ? (
            <div className="p-3">
              <div className="flex items-center gap-2">
                <p className="text-[11px] font-medium text-slate-600">
                  결과 스냅샷
                </p>
                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500">
                  선택
                </span>
              </div>
              {review.outcomeMode === "metric" && review.metricValue != null && (
                <p className="mt-1 text-[11px] text-slate-500">
                  이번 주 결과:{" "}
                  {[review.metricLabel, review.metricValue, review.metricUnit]
                    .filter(Boolean)
                    .join(" ")}
                </p>
              )}
              {review.outcomeMode === "sense" && review.sense && (
                <p className="mt-1 text-[11px] text-slate-500">
                  이번 주 변화:{" "}
                  {review.sense === "closer"
                    ? "가까워짐"
                    : review.sense === "same"
                      ? "제자리"
                      : "멀어짐"}
                </p>
              )}
              {review.outcomeMode === "skip" && (
                <p className="mt-1 text-[11px] text-slate-500">이번 주 생략</p>
              )}
            </div>
          ) : outcomeSnapshotExpanded ? (
            <div className="p-3">
              <OutcomeSnapshot
                outcomeMode={outcomeMode}
                metricLabel={metricLabel}
                metricValue={metricValue}
                metricUnit={metricUnit}
                sense={sense}
                outcomeNote={outcomeNote}
                expanded={true}
                onExpandedChange={() => {}}
                onOutcomeModeChange={setOutcomeMode}
                onMetricLabelChange={setMetricLabel}
                onMetricValueChange={setMetricValue}
                onMetricUnitChange={setMetricUnit}
                onSenseChange={setSense}
                onOutcomeNoteChange={setOutcomeNote}
              />
              {error && (
                <p className="mt-2 text-[11px] text-rose-500">{error}</p>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] text-slate-600 hover:bg-slate-50"
                  onClick={() => {
                    setOutcomeSnapshotExpanded(false);
                    setError("");
                  }}
                >
                  취소
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-slate-800 bg-slate-800 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-slate-700"
                  onClick={handleSaveSnapshotOnly}
                  disabled={saving}
                >
                  {saving ? "저장 중..." : "저장"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 px-3 py-3">
              <div className="flex-1">
                <p className="text-[11px] text-slate-500">
                  이번 주 결과/변화를 한 줄로 남길 수 있어요.
                </p>
                <span className="mt-1 inline-block rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500">
                  선택
                </span>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] text-slate-600 hover:bg-slate-50"
                onClick={() => setOutcomeSnapshotExpanded(true)}
              >
                스냅샷 남기기
              </button>
            </div>
          )}
        </div>
        {(rules.length > 0 || coach) && (
          <div
            className="mt-3 rounded-[12px] px-4 py-3"
            style={{ background: "#F6F7F8" }}
          >
            <p className="text-[11px] font-medium text-slate-600">
              다음 주 설계
            </p>
            {rules.length > 0 ? (
              <div className="mt-2 space-y-4">
                {rules.map((r, i) => (
                  <div key={i} className="block">
                    <p className="text-[11px] font-medium text-slate-600 break-words">
                      {r.text}
                    </p>
                    <div className="mt-2">
                      <p className="mb-1.5 text-[10px] text-slate-400">
                        언제 할지
                      </p>
                        <div className="flex flex-wrap gap-1">
                          {REVIEW_DAY_LABELS.map((label, idx) => {
                            const isSelected = r.weekdays
                              ? r.weekdays.includes(idx)
                              : effectiveWeekday === idx;
                            return (
                              <button
                                key={label}
                                type="button"
                                className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                                  isSelected
                                    ? "border-2 border-slate-800 bg-slate-100 font-medium text-slate-800"
                                    : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                                }`}
                                onClick={() => setSelectedWeekday(idx)}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              coach && (
                <>
                  <p className="mt-1 break-words text-[11px] font-medium text-slate-600">
                    {coach.action}
                  </p>
                  {onApplyAction && isReviewDay && (
                    <div className="mt-2">
                      <p className="mb-1.5 text-[10px] text-slate-400">
                        언제 할지
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
                </>
              )
            )}
            {isReviewDay && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200/60 pt-3">
                {coach?.action && onApplyAction && (
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] text-slate-600 hover:bg-slate-50"
                    onClick={() =>
                      onApplyAction(
                        track.id,
                        coach.action,
                        rules.length > 0 && rules[0].weekdays?.[0] != null
                          ? rules[0].weekdays[0]
                          : effectiveWeekday
                      )
                    }
                  >
                    다음 주 구조 적용(투두 추가)
                  </button>
                )}
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] text-slate-600 hover:bg-slate-50"
                  onClick={handleStartEdit}
                >
                  수정
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  const keys = getLastNDateKeys(7);
  const executedDays = last7DaysCounts
    ? getExecutedDayCount(last7DaysCounts, keys)
    : 0;
  const totalActions = last7DaysCounts
    ? getTotalActionCount(last7DaysCounts, keys)
    : 0;
  const lastExecuted = last7DaysCounts
    ? getLastExecutedText(last7DaysCounts, keys)
    : { text: "-", isWarning: false };
  const showLastExecuted =
    lastExecuted.text !== "오늘 실행했어요." && lastExecuted.text !== "-";

  const isEditingReviewDay = editingReviewDayGoalTrackId === track.id;
  return (
    <div
      className="mt-4 rounded-[14px] px-[18px] py-[18px]"
      style={{
        background: "#FFFFFF",
        border: "1px solid rgba(0,0,0,0.08)",
      }}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-600">이번 주 평가</p>
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
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-slate-500">
              평가 요일: {reviewDayLabel}요일
            </span>
            <span className="text-slate-300">·</span>
            <button
              type="button"
              className="text-[11px] text-slate-500 underline hover:text-slate-700"
              onClick={() => onEditingReviewDayChange?.(track.id)}
            >
              변경
            </button>
          </div>
        )}
      </div>
      <div className="mt-3 space-y-3">
        <div
          className="rounded-[12px] px-4 py-3"
          style={{ background: "#F6F7F8" }}
        >
          <p className="text-[11px] font-medium text-slate-600">
            이번 주 실행 점검
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white px-2.5 py-0.5 text-[10px] font-medium text-slate-600 shadow-sm">
              최근 7일 · {executedDays}일
            </span>
            <span className="rounded-full bg-white px-2.5 py-0.5 text-[10px] font-medium text-slate-600 shadow-sm">
              총 {totalActions}회
            </span>
          </div>
          {showLastExecuted && (
            <p
              className="mt-1.5 text-[10px] text-slate-500"
              style={
                lastExecuted.isWarning ? { color: "#B45309" } : undefined
              }
            >
              마지막 실행: {lastExecuted.text}
            </p>
          )}
          <div className="mt-2 overflow-visible">
            <RhythmDots
              dateKeys={keys}
              completionRatios={
                last7DaysCompletionRatios ??
                Object.fromEntries(
                  keys.map((k) => [
                    k,
                    {
                      done: last7DaysCounts?.[k] ?? 0,
                      total: (last7DaysCounts?.[k] ?? 0) || 0,
                    },
                  ])
                )
              }
              todayKey={getLocalDateKey()}
            />
          </div>
        </div>
        <div
          className="rounded-[12px] border border-slate-200 bg-white p-0"
        >
          <OutcomeSnapshot
          outcomeMode={outcomeMode}
          metricLabel={metricLabel}
          metricValue={metricValue}
          metricUnit={metricUnit}
          sense={sense}
          outcomeNote={outcomeNote}
          expanded={outcomeSnapshotExpanded}
          onExpandedChange={setOutcomeSnapshotExpanded}
          onOutcomeModeChange={setOutcomeMode}
          onMetricLabelChange={setMetricLabel}
          onMetricValueChange={setMetricValue}
          onMetricUnitChange={setMetricUnit}
          onSenseChange={setSense}
          onOutcomeNoteChange={setOutcomeNote}
        />
        </div>
        <div
          className="mt-3 rounded-[12px] px-4 py-3"
          style={{ background: "#F6F7F8" }}
        >
          <p className="text-[11px] font-medium text-slate-600">
            다음 주 설계
          </p>
          <p className="mt-1.5 text-[10px] text-slate-500">
            다음 주 실행
          </p>
          <div className="mt-2 space-y-4">
            {nextWeekRules.map((rule, idx) => (
              <div key={idx} className="space-y-2">
                <div className="flex items-start gap-2">
                  <input
                    type="text"
                    value={rule.text}
                    onChange={(e) =>
                      updateNextWeekRule(idx, { text: e.target.value })
                    }
                    placeholder="예) 아침 9시에 1차 블로킹"
                    className="w-full min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                  />
                  <button
                    type="button"
                    className="shrink-0 text-[10px] text-slate-400 hover:text-rose-500"
                    onClick={() => removeNextWeekRule(idx)}
                    aria-label="삭제"
                  >
                    삭제
                  </button>
                </div>
                <div>
                  <button
                    type="button"
                    className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] text-slate-600 hover:bg-slate-50"
                    onClick={() =>
                      setExpandedWeekdayRuleIdx((prev) =>
                        prev === idx ? null : idx
                      )
                    }
                  >
                    요일
                  </button>
                  {expandedWeekdayRuleIdx === idx && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {REVIEW_DAY_LABELS.map((label, d) => (
                        <button
                          key={label}
                          type="button"
                          className={`rounded-full px-2 py-0.5 text-[10px] ${
                            rule.weekdays?.includes(d)
                              ? "border-2 border-slate-800 bg-slate-100 font-medium"
                              : "border border-slate-200"
                          }`}
                          onClick={() => toggleRuleWeekday(idx, d)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <button
              type="button"
              className="rounded-lg border border-dashed border-slate-200 px-2 py-1 text-[10px] text-slate-500 hover:border-slate-300"
              onClick={addNextWeekRule}
            >
              + 추가
            </button>
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
    </div>
  );
}
