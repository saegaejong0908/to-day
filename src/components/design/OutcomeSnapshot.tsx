"use client";

import React from "react";
import type { OutcomeMode, OutcomeSense } from "@/types/goalTrackWeeklyReview";

const SENSE_OPTIONS: { value: OutcomeSense; label: string }[] = [
  { value: "closer", label: "가까워짐" },
  { value: "same", label: "제자리" },
  { value: "farther", label: "멀어짐" },
];

type OutcomeSnapshotProps = {
  outcomeMode: OutcomeMode | undefined;
  metricLabel: string;
  metricValue: number | "";
  metricUnit: string;
  sense: OutcomeSense | null;
  outcomeNote: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onOutcomeModeChange: (mode: OutcomeMode) => void;
  onMetricLabelChange: (v: string) => void;
  onMetricValueChange: (v: number | "") => void;
  onMetricUnitChange: (v: string) => void;
  onSenseChange: (v: OutcomeSense | null) => void;
  onOutcomeNoteChange: (v: string) => void;
};

export function OutcomeSnapshot({
  outcomeMode,
  metricLabel,
  metricValue,
  metricUnit,
  sense,
  outcomeNote,
  expanded,
  onExpandedChange,
  onOutcomeModeChange,
  onMetricLabelChange,
  onMetricValueChange,
  onMetricUnitChange,
  onSenseChange,
  onOutcomeNoteChange,
}: OutcomeSnapshotProps) {
  return (
    <div className="rounded-lg border border-slate-100">
      {!expanded ? (
        <div className="px-3 py-3">
          <div className="flex items-center justify-between gap-2">
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
              className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[10px] text-slate-600 hover:bg-slate-50"
              onClick={() => onExpandedChange(true)}
            >
              스냅샷 남기기
            </button>
          </div>
        </div>
      ) : (
        <div className="p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-slate-600">
              결과 스냅샷
            </span>
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500">
              선택
            </span>
            <button
              type="button"
              className="ml-auto text-[10px] text-slate-400 hover:text-slate-600"
              onClick={() => onExpandedChange(false)}
            >
              접기
            </button>
          </div>
          <div className="mt-2 flex gap-1 rounded-lg bg-slate-50/80 p-1">
            <button
              type="button"
              className={`flex-1 rounded-md px-2 py-1 text-[10px] ${
                outcomeMode === "metric"
                  ? "bg-white font-medium text-slate-700 shadow-sm"
                  : "text-slate-500"
              }`}
              onClick={() => onOutcomeModeChange("metric")}
            >
              지표 입력
            </button>
            <button
              type="button"
              className={`flex-1 rounded-md px-2 py-1 text-[10px] ${
                outcomeMode === "sense"
                  ? "bg-white font-medium text-slate-700 shadow-sm"
                  : "text-slate-500"
              }`}
              onClick={() => onOutcomeModeChange("sense")}
            >
              체감 기록
            </button>
            <button
              type="button"
              className={`flex-1 rounded-md px-2 py-1 text-[10px] ${
                outcomeMode === "skip"
                  ? "bg-white font-medium text-slate-700 shadow-sm"
                  : "text-slate-500"
              }`}
              onClick={() => onOutcomeModeChange("skip")}
            >
              이번 주 생략
            </button>
          </div>
          {outcomeMode === "metric" && (
            <div className="mt-2 space-y-2">
              <input
                type="text"
                value={metricLabel}
                onChange={(e) => onMetricLabelChange(e.target.value)}
                placeholder="예: 모의고사 점수"
                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px]"
              />
              <div className="flex gap-2">
                <input
                  type="number"
                  value={metricValue}
                  onChange={(e) => {
                    const v = e.target.value;
                    onMetricValueChange(v === "" ? "" : Number(v));
                  }}
                  placeholder="값"
                  className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px]"
                />
                <input
                  type="text"
                  value={metricUnit}
                  onChange={(e) => onMetricUnitChange(e.target.value)}
                  placeholder="단위 (예: 점)"
                  className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px]"
                />
              </div>
            </div>
          )}
          {outcomeMode === "sense" && (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap gap-1">
                {SENSE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className={`rounded-full px-2.5 py-1 text-[11px] ${
                      sense === o.value
                        ? "border-2 border-slate-800 bg-slate-100 font-medium"
                        : "border border-slate-200"
                    }`}
                    onClick={() =>
                      onSenseChange(sense === o.value ? null : o.value)
                    }
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={outcomeNote}
                onChange={(e) => onOutcomeNoteChange(e.target.value)}
                placeholder="한 줄 이유 (선택)"
                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px]"
              />
            </div>
          )}
          {outcomeMode === "skip" && (
            <p className="mt-1 text-[10px] text-slate-400">
              이번 주는 생략합니다.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
