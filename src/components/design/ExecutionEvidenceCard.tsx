"use client";

import React from "react";
import type { GoalTrack } from "@/types/goalTrack";
import type { GoalTrackEvent } from "@/types/goalTrackEvent";
import {
  calcLast7Days,
  calcLast7DaysCompletionRatios,
  getExecutedDayCount,
  getTotalActionCount,
  getLastExecutedText,
  recentEvents,
} from "@/domain/execution";
import { getLastNDateKeys } from "@/domain/date";
import { getLocalDateKey } from "@/lib/date";
import { RhythmDots } from "@/components/design/RhythmDots";

type TodoForRatio = { done: boolean; goalTrackId?: string | null };

type Props = {
  track: GoalTrack;
  events: GoalTrackEvent[];
  /** 날짜별 투두. 있으면 완료 비율 기반 점 사용 */
  todosByDateKey?: Record<string, TodoForRatio[]>;
};

export function ExecutionEvidenceCard({
  track,
  events,
  todosByDateKey = {},
}: Props) {
  const [expanded, setExpanded] = React.useState(false);
  const last7Keys = getLastNDateKeys(7);
  const last7 = calcLast7Days(events, track.id);
  const completionRatios = calcLast7DaysCompletionRatios(
    todosByDateKey,
    track.id,
    last7Keys
  );
  const executedDays = getExecutedDayCount(last7, last7Keys);
  const totalActions = getTotalActionCount(last7, last7Keys);
  const lastExecuted = getLastExecutedText(last7, last7Keys);
  const recent = recentEvents(events, track.id, 5);

  return (
    <div
      className="mt-3 rounded-[12px] px-4 py-4"
      style={{ background: "#F6F7F8" }}
    >
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => setExpanded((e) => !e)}
      >
        <p className="text-[11px] font-medium text-slate-500">쌓임 증거</p>
        <span className="text-[10px] text-slate-400">
          {expanded ? "접기" : "펼치기"}
        </span>
      </button>
      <p className="mt-0.5 text-xs text-slate-600">
        최근 7일 중 {executedDays}일 실행 / 총 {totalActions}회 행동
      </p>
      <p
        className={`mt-1 text-[11px] ${lastExecuted.isWarning ? "" : "text-slate-600"}`}
        style={lastExecuted.isWarning ? { color: "#B45309" } : undefined}
      >
        {lastExecuted.text}
      </p>
      {expanded && (
        <>
          <div className="mt-2 overflow-visible">
            <RhythmDots
              dateKeys={last7Keys}
              completionRatios={completionRatios}
              todayKey={getLocalDateKey()}
            />
          </div>
          {recent.length > 0 ? (
            <ul className="mt-1 space-y-0.5">
              {recent.map((e) => (
                <li
                  key={e.id}
                  className="truncate text-[11px] text-slate-600"
                  title={e.todoText}
                >
                  {e.dateKey} · {e.todoText}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[11px] text-slate-400">아직 실행 기록 없음</p>
          )}
        </>
      )}
    </div>
  );
}
