import "server-only";
import type { BlockType, TodoBlockSuggestion } from "@/types/todoBlock";

export async function todoBlockSuggestion(
  blockType: BlockType,
  originalTodo: string,
  situation?: string
): Promise<TodoBlockSuggestion | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const blockLabels: Record<BlockType, string> = {
    START_FRICTION: "시작이 어려움(마찰)",
    SCOPE_TOO_BIG: "너무 큼(범위 큼)",
    STRUCTURE_CONFUSION: "뭐부터 해야 할지 모름(구조 혼란)",
  };

  const systemPrompt =
    "너는 막힌 투두를 행동으로 바꾸는 조정 코치다.\n" +
    "출력은 반드시 JSON 하나만: {\"question\": \"질문 1개\", \"rewrittenTodo\": \"재작성된 투두 1개\"}\n" +
    "question: 사용자가 스스로 생각하도록 유도하는 질문 1개만.\n" +
    "rewrittenTodo: 원문을 유지하되 실행 가능한 구체적 행동 1개로 재작성. 위로/감성 멘트 금지.";

  const userPrompt = `막힘 유형: ${blockLabels[blockType]}
원래 투두: ${originalTodo}
${situation ? `상황: ${situation}` : ""}

위 내용을 바탕으로 question 1개와 rewrittenTodo 1개를 JSON으로만 답하라.`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content) as Partial<TodoBlockSuggestion>;
    const question =
      typeof parsed.question === "string" ? parsed.question.trim() : "";
    const rewrittenTodo =
      typeof parsed.rewrittenTodo === "string" ? parsed.rewrittenTodo.trim() : "";
    if (!question || !rewrittenTodo) return null;

    return { question, rewrittenTodo };
  } catch {
    return null;
  }
}
