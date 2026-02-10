import "server-only";

type ReasonType = "HARD_TO_START" | "TOO_BIG" | "EMOTIONALLY_HEAVY";

const SYSTEM_PROMPT =
  "너는 할 일을 다시 구성하는 도구다.\n설명하거나 판단하지 말고, 요청한 결과만 생성하라.";

const buildUserPrompt = (originalTodoText: string, reasonType: ReasonType) => {
  if (reasonType === "HARD_TO_START") {
    return `기존 할 일: "${originalTodoText}"

이 사용자는 이 할 일을 '시작하기 어려워서' 하지 못했다.
아래를 생성하라:
1) 상태를 인식할 수 있는 질문 1~2개
2) 지금 당장 할 수 있는 첫 행동 형태의 새로운 투두 1개

출력은 반드시 아래 JSON 형식만 사용하라.

{
  "reflectionQuestions": ["...", "..."],
  "rewrittenTodo": "..."
}`;
  }
  if (reasonType === "TOO_BIG") {
    return `기존 할 일: "${originalTodoText}"

이 사용자는 이 할 일이 '너무 커서' 하지 못했다.
아래를 생성하라:
1) 막히는 지점을 인식하는 질문 1~2개
2) 가장 작은 하위 단계 투두 1개

출력은 반드시 아래 JSON 형식만 사용하라.

{
  "reflectionQuestions": ["...", "..."],
  "rewrittenTodo": "..."
}`;
  }
  return `기존 할 일: "${originalTodoText}"

이 사용자는 이 할 일이 '감정적으로 부담돼서' 하지 못했다.
아래를 생성하라:
1) 감정을 인식할 수 있는 질문 1~2개
2) 부담 없는 대체 투두 1개

출력은 반드시 아래 JSON 형식만 사용하라.

{
  "reflectionQuestions": ["...", "..."],
  "rewrittenTodo": "..."
}`;
};

const parseResult = (raw: string) => {
  const parsed = JSON.parse(raw) as {
    reflectionQuestions?: unknown;
    rewrittenTodo?: unknown;
  };
  const questions = Array.isArray(parsed.reflectionQuestions)
    ? parsed.reflectionQuestions.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0
      )
    : [];
  const rewrittenTodo =
    typeof parsed.rewrittenTodo === "string" ? parsed.rewrittenTodo.trim() : "";
  if (questions.length < 1 || questions.length > 2 || !rewrittenTodo) {
    return null;
  }
  return { reflectionQuestions: questions, rewrittenTodo };
};

export async function rewriteTodoWithReason(
  originalTodoText: string,
  reasonType: ReasonType
): Promise<{
  reflectionQuestions: string[];
  rewrittenTodo: string;
} | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: buildUserPrompt(originalTodoText, reasonType),
          },
        ],
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    return parseResult(content);
  } catch {
    return null;
  }
}
