"use client";

import React from "react";
import type { DesignPlan } from "@/types/designPlan";
import type { GoalTrack } from "@/types/goalTrack";

type Props = {
  designPlans: DesignPlan[];
  goalTracks: GoalTrack[];
  currentGoalTrackId: string | null;
  onSave: (goalTrackId: string) => void;
  onCancel: () => void;
  onUnlink: () => void;
  /** 초기 설계 선택 (currentGoalTrackId의 designPlanId) */
  initialDesignPlanId: string | null;
  /** 초기 목표 선택 */
  initialGoalTrackId: string | null;
};

export function InlineGoalLinkEditor({
  designPlans,
  goalTracks,
  currentGoalTrackId,
  onSave,
  onCancel,
  onUnlink,
  initialDesignPlanId,
  initialGoalTrackId,
}: Props) {
  const [designPlanId, setDesignPlanId] = React.useState(initialDesignPlanId ?? "");
  const [goalTrackId, setGoalTrackId] = React.useState(initialGoalTrackId ?? "");

  React.useEffect(() => {
    setDesignPlanId(initialDesignPlanId ?? "");
    setGoalTrackId(initialGoalTrackId ?? "");
  }, [initialDesignPlanId, initialGoalTrackId]);

  const tracksForPlan = goalTracks.filter((t) => t.designPlanId === designPlanId);
  const canSave = Boolean(goalTrackId.trim());

  return (
    <div className="mt-2 rounded-xl border border-slate-100 bg-slate-50/80 p-3">
      <p className="text-[11px] font-medium text-slate-500">목표 연결</p>
      <div className="mt-2 flex flex-col gap-2">
        <select
          value={designPlanId}
          onChange={(e) => {
            setDesignPlanId(e.target.value);
            setGoalTrackId("");
          }}
          className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
        >
          <option value="">설계 선택</option>
          {designPlans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title || "제목 없음"}
            </option>
          ))}
        </select>
        <select
          value={goalTrackId}
          onChange={(e) => setGoalTrackId(e.target.value)}
          disabled={!designPlanId}
          className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs disabled:bg-slate-100"
        >
          <option value="">목표/주제 선택</option>
          {tracksForPlan.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title || "제목 없음"}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-600"
          onClick={onCancel}
        >
          취소
        </button>
        <button
          type="button"
          className="rounded-full bg-slate-900 px-3 py-1 text-[11px] font-medium text-white disabled:bg-slate-300"
          onClick={() => canSave && onSave(goalTrackId)}
          disabled={!canSave}
        >
          저장
        </button>
        {currentGoalTrackId && (
          <button
            type="button"
            className="rounded-full border border-slate-200 px-3 py-1 text-[11px] text-slate-500"
            onClick={onUnlink}
          >
            해제
          </button>
        )}
      </div>
    </div>
  );
}
