export type BlockType =
  | "START_FRICTION"   // 시작이 어려움(마찰)
  | "SCOPE_TOO_BIG"    // 너무 큼(범위 큼)
  | "STRUCTURE_CONFUSION"; // 뭐부터 해야 할지 모름(구조 혼란)

export type TodoBlockSuggestion = {
  question: string;
  rewrittenTodo: string;
};
