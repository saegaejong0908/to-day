import type { BlockType, TodoBlockSuggestion } from "@/types/todoBlock";
import { getExecutedDayCount } from "./execution";
import { getLastNDateKeys } from "./date";

const BLOCK_LABELS: Record<BlockType, string> = {
  START_FRICTION: "시작이 어려움(마찰)",
  SCOPE_TOO_BIG: "너무 큼(범위 큼)",
  STRUCTURE_CONFUSION: "뭐부터 해야 할지 모름(구조 혼란)",
};

/** blockType별 룰 기반 fallback */
export function fallbackSuggestion(
  blockType: BlockType,
  originalTodo: string
): TodoBlockSuggestion {
  const short = originalTodo.slice(0, 30) + (originalTodo.length > 30 ? "…" : "");
  switch (blockType) {
    case "START_FRICTION":
      return {
        question: `'${short}'를 시작하려면 가장 낮은 문턱의 첫 행동은 무엇일까요?`,
        rewrittenTodo: `[5분] ${originalTodo}`,
      };
    case "SCOPE_TOO_BIG":
      return {
        question: `'${short}'를 오늘 할 수 있는 가장 작은 단위로 나누면 무엇인가요?`,
        rewrittenTodo: `${originalTodo} (1단계만)`,
      };
    case "STRUCTURE_CONFUSION":
      return {
        question: `'${short}'를 하기 전에 꼭 해야 할 선행 단계는 무엇인가요?`,
        rewrittenTodo: `1) ___ 확인 → 2) ${originalTodo}`,
      };
    default:
      return {
        question: `'${short}'를 실행하려면 먼저 무엇을 준비하면 좋을까요?`,
        rewrittenTodo: originalTodo,
      };
  }
}

/** 리듬 예측: 완료 시 최근 7일 실행 X → Y */
export function calcRhythmImpact(
  counts: Record<string, number>,
  keys: string[]
): { currentDays: number; predictedDays: number } {
  const currentDays = getExecutedDayCount(counts, keys);
  const todayKey = keys[0] ?? "";
  const todayCount = counts[todayKey] ?? 0;
  const predictedDays = todayCount === 0 ? currentDays + 1 : currentDays;
  return { currentDays, predictedDays };
}

export { BLOCK_LABELS };
