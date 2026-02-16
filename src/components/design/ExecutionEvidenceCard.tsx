"use client";

import type { GoalTrack } from "@/types/goalTrack";
import type { GoalTrackEvent } from "@/types/goalTrackEvent";
import {
  calcLast7Days,
  getExecutedDayCount,
  getTotalActionCount,
  getRecentGap,
  recentEvents,
} from "@/domain/execution";
import { getLastNDateKeys } from "@/domain/date";

type Props = {
  track: GoalTrack;
  events: GoalTrackEvent[];
};

export function ExecutionEvidenceCard({ track, events }: Props) {
  const last7 = calcLast7Days(events, track.id);
  const last7Keys = getLastNDateKeys(7);
  const executedDays = getExecutedDayCount(last7, last7Keys);
  const totalActions = getTotalActionCount(last7, last7Keys);
  const gap = getRecentGap(last7, last7Keys);
  const recent = recentEvents(events, track.id, 5);

  return (
    <div className="mt-2 rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2">
      <p className="text-[11px] font-medium text-slate-500">쌓임 증거</p>
      <div className="mt-1 text-xs text-slate-600">
        최근 7일 중 {executedDays}일 실행 / 총 {totalActions}회 행동
      </div>
      <div className="mt-2 flex items-center justify-between gap-1">
        {last7Keys.map((key) => {
          const count = last7[key] ?? 0;
          const filled = count > 0;
          return (
            <div
              key={key}
              className={`h-2 w-2 flex-shrink-0 rounded-full transition-colors ${
                filled ? "bg-slate-700" : "bg-slate-200"
              }`}
              title={`${key}: ${count}개`}
            />
          );
        })}
      </div>
      <p className="mt-1 text-[10px] text-slate-400">최근 7일</p>
      {gap >= 3 && (
        <p className="mt-1 text-[11px] text-amber-600">
          최근 {gap}일 미실행
        </p>
      )}
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
    </div>
  );
}
