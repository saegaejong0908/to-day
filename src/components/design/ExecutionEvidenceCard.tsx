"use client";

import type { GoalTrack } from "@/types/goalTrack";
import type { GoalTrackEvent } from "@/types/goalTrackEvent";
import {
  calcTodayCount,
  calcWeekCount,
  calcLast7Days,
  recentEvents,
} from "@/domain/execution";
import { getLastNDateKeys } from "@/domain/date";

type Props = {
  track: GoalTrack;
  events: GoalTrackEvent[];
};

export function ExecutionEvidenceCard({ track, events }: Props) {
  const todayCount = calcTodayCount(events, track.id);
  const weekCount = calcWeekCount(events, track.id);
  const last7 = calcLast7Days(events, track.id);
  const recent = recentEvents(events, track.id, 5);
  const last7Keys = getLastNDateKeys(7);
  const maxBar = Math.max(1, ...last7Keys.map((k) => last7[k] ?? 0));

  return (
    <div className="mt-2 rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2">
      <p className="text-[11px] font-medium text-slate-500">쌓임 증거</p>
      <div className="mt-1 flex gap-3 text-xs text-slate-600">
        <span>오늘 {todayCount}</span>
        <span>이번주 {weekCount}</span>
      </div>
      <div className="mt-2 flex h-6 items-end gap-1">
        {last7Keys.map((key) => {
          const count = last7[key] ?? 0;
          const h = maxBar > 0 ? Math.max(4, (count / maxBar) * 24) : 4;
          const filled = count > 0;
          return (
            <div
              key={key}
              className={`min-w-[6px] flex-1 rounded-sm transition-all ${
                filled ? "bg-slate-700" : "bg-slate-200"
              }`}
              style={{ height: h }}
              title={`${key}: ${count}개`}
            />
          );
        })}
      </div>
      <p className="mt-1 text-[10px] text-slate-400">최근 7일</p>
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
