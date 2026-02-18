"use client";

import { useState } from "react";
import type { BlockType, TodoBlockSuggestion } from "@/types/todoBlock";
import { BLOCK_LABELS } from "@/domain/todoBlock";

const BLOCK_TYPES: BlockType[] = [
  "START_FRICTION",
  "SCOPE_TOO_BIG",
  "STRUCTURE_CONFUSION",
];

type Props = {
  suggestion: TodoBlockSuggestion | null;
  loading: boolean;
  rhythm: { currentDays: number; predictedDays: number } | null;
  onFetch: (blockType: BlockType, situation?: string) => void;
  onApply: (newText: string) => void;
  onClose: () => void;
};

export function TodoBlockPanel({
  suggestion,
  loading,
  rhythm,
  onFetch,
  onApply,
  onClose,
}: Props) {
  const [blockType, setBlockType] = useState<BlockType>("START_FRICTION");
  const [situation, setSituation] = useState("");

  const handleFetch = () => {
    onFetch(blockType, situation.trim() || undefined);
  };

  return (
    <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-slate-500">막힘 해결(행동 조정)</p>
        <button
          type="button"
          className="text-[11px] text-slate-400 hover:text-slate-600"
          onClick={onClose}
        >
          접기
        </button>
      </div>

      <div className="mt-2 space-y-2">
        <label className="block text-[11px] text-slate-500">막힘 유형</label>
        <div className="flex flex-wrap gap-1">
          {BLOCK_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className={`rounded-full px-2.5 py-1 text-[11px] ${
                blockType === t
                  ? "bg-slate-800 text-white"
                  : "border border-slate-200 bg-white text-slate-600"
              }`}
              onClick={() => setBlockType(t)}
            >
              {BLOCK_LABELS[t]}
            </button>
          ))}
        </div>

        <label className="block text-[11px] text-slate-500">(선택) 상황 1줄</label>
        <input
          type="text"
          value={situation}
          onChange={(e) => setSituation(e.target.value)}
          placeholder="예: 아침에 시간이 없음"
          className="w-full rounded-xl border border-slate-200 px-2 py-1.5 text-xs"
        />

        <button
          type="button"
          className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] text-slate-600"
          onClick={handleFetch}
          disabled={loading}
        >
          {loading ? "생성 중..." : "AI 제안 받기"}
        </button>
      </div>

      {suggestion && (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-[11px] text-slate-400">질문</p>
          <p className="mt-0.5 text-xs text-slate-700">{suggestion.question}</p>
          <p className="mt-2 text-[11px] text-slate-400">재작성 투두</p>
          <p className="mt-0.5 text-xs text-slate-700">{suggestion.rewrittenTodo}</p>
          {rhythm !== null && (
            <p className="mt-2 text-[11px] text-slate-500">
              완료 시 최근 7일 실행: {rhythm.currentDays} → {rhythm.predictedDays}
            </p>
          )}
          <button
            type="button"
            className="mt-2 w-full rounded-full bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
            onClick={() => onApply(suggestion.rewrittenTodo)}
          >
            이 제안 적용
          </button>
        </div>
      )}
    </div>
  );
}
