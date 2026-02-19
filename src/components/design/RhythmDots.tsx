"use client";

import React from "react";
import { getDotStyleFromRatio } from "@/domain/execution";
import { getWeekdayKoFromDateKey } from "@/domain/date";

export type CompletionRatioEntry = { done: number; total: number };

type Props = {
  dateKeys: string[];
  /** 날짜별 완료 비율. 있으면 비율 기반 강도 사용 */
  completionRatios: Record<string, CompletionRatioEntry>;
  todayKey: string;
};

const DOT_SIZE = 14;
const GAP = 10;
const HIT_AREA = 28;
const PILL_HEIGHT = 22;
const PILL_PADDING_X = 12;

export function RhythmDots({
  dateKeys,
  completionRatios,
  todayKey,
}: Props) {
  const [activeDotKey, setActiveDotKey] = React.useState<string | null>(null);

  const handleClick = (key: string) => {
    setActiveDotKey((prev) => (prev === key ? null : key));
  };

  /** oldest → today 순서 (today가 오른쪽 끝) */
  const displayOrder = [...dateKeys].reverse();
  const dotsKeys = displayOrder.filter((k) => k !== todayKey);
  const todayData = completionRatios[todayKey] ?? { done: 0, total: 0 };
  const todayBorderColor = getDotStyleFromRatio(
    todayData.done,
    todayData.total
  ).background;
  const todayTooltip =
    todayData.total > 0
      ? `${todayKey} (${getWeekdayKoFromDateKey(todayKey)}) · ${todayData.done}/${todayData.total} 완료`
      : "계획 없음";

  return (
    <div className="flex w-full flex-col">
      <div
        className="flex w-full flex-nowrap items-center justify-between"
      >
        {dotsKeys.map((key) => {
          const { done, total } = completionRatios[key] ?? {
            done: 0,
            total: 0,
          };
          const weekdayKo = getWeekdayKoFromDateKey(key);
          const tooltip =
            total > 0
              ? `${key} (${weekdayKo}) · ${done}/${total} 완료`
              : `${key} (${weekdayKo})`;
          return (
            <button
              key={key}
              type="button"
              className="flex flex-shrink-0 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              style={{
                width: HIT_AREA,
                height: HIT_AREA,
                padding: (HIT_AREA - DOT_SIZE) / 2,
              }}
              onClick={() => handleClick(key)}
              title={tooltip}
              aria-label={tooltip}
            >
              <span
                className="rounded-full"
                style={{
                  width: DOT_SIZE,
                  height: DOT_SIZE,
                  ...getDotStyleFromRatio(done, total),
                }}
              />
            </button>
          );
        })}
        <button
          type="button"
          className="flex flex-shrink-0 items-center justify-center overflow-visible rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          style={{
            height: PILL_HEIGHT,
            paddingLeft: PILL_PADDING_X,
            paddingRight: PILL_PADDING_X,
            minWidth: 64,
            flex: "0 0 auto",
            background: "#F6F7F8",
            border: `2px solid ${todayBorderColor}`,
            boxSizing: "border-box",
          }}
          onClick={() => handleClick(todayKey)}
          title={todayTooltip}
          aria-label={todayTooltip}
        >
          <span
            className="whitespace-nowrap text-[10px] font-semibold text-slate-800"
            style={{ lineHeight: 1 }}
          >
            TODAY
          </span>
        </button>
      </div>
      {activeDotKey && (() => {
        const { done, total } = completionRatios[activeDotKey] ?? {
          done: 0,
          total: 0,
        };
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        return (
          <p className="mt-2 text-[10px] text-slate-500">
            {getWeekdayKoFromDateKey(activeDotKey)} · {done}/{total} 완료 (
            {pct}%)
          </p>
        );
      })()}
    </div>
  );
}
