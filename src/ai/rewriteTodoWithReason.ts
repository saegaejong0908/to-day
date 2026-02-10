import "server-only";

type ReasonType = "HARD_TO_START" | "NOT_ENOUGH_TIME";

const SYSTEM_PROMPT =
  "너는 할 일을 다시 구성하는 도구다.\n" +
  "설명하거나 판단하지 말고, 요청한 결과만 생성하라.\n" +
  "출력은 반드시 JSON 하나만 반환하라.\n" +
  "JSON 형식은 반드시 아래 키만 포함하라: conditionMessage, rewrittenTodo\n" +
  "conditionMessage는 왜 이렇게 바꿨는지 조건 설명 1줄이다.\n" +
  "rewrittenTodo는 행동 단위의 투두 1개만 포함한다.\n" +
  "동기부여 문구/설명/여러 투두 제안은 금지한다.";

const buildUserPrompt = (args: {
  originalTodoText: string;
  reasonType: ReasonType;
  contextQuestions?: string[];
}) => {
  const contextBlock =
    Array.isArray(args.contextQuestions) && args.contextQuestions.length > 0
      ? `\n\n참고 질문(사용자가 머릿속에서 떠올렸을 맥락):\n- ${args.contextQuestions
          .slice(0, 3)
          .map((q) => String(q).trim())
          .filter(Boolean)
          .join("\n- ")}`
      : "";

  if (args.reasonType === "HARD_TO_START") {
    return `기존 할 일: "${args.originalTodoText}"

이 사용자는 이 할 일을 '시작하기가 어려워서' 하지 못했다.${contextBlock}

아래 JSON만 생성하라.
- conditionMessage: 왜 이렇게 바꿨는지 조건 설명 1줄
- rewrittenTodo: 첫 행동만 남긴 실행 가능한 투두 1개

{
  "conditionMessage": "string",
  "rewrittenTodo": "string"
}`;
  }

  return `기존 할 일: "${args.originalTodoText}"

이 사용자는 이 할 일을 '끝내기 위한 시간이 부족해서' 하지 못했다.${contextBlock}

아래 JSON만 생성하라.
- conditionMessage: 왜 이렇게 바꿨는지 조건 설명 1줄
- rewrittenTodo: 오늘 하지 않아도 되는 요소를 제거하고 핵심만 남긴 투두 1개

{
  "conditionMessage": "string",
  "rewrittenTodo": "string"
}`;
};

const parseResult = (raw: string) => {
  const parsed = JSON.parse(raw) as {
    conditionMessage?: unknown;
    rewrittenTodo?: unknown;
  };
  const conditionMessage =
    typeof parsed.conditionMessage === "string"
      ? parsed.conditionMessage.trim()
      : "";
  const rewrittenTodo =
    typeof parsed.rewrittenTodo === "string" ? parsed.rewrittenTodo.trim() : "";
  if (!conditionMessage || !rewrittenTodo) return null;
  return { conditionMessage, rewrittenTodo };
};

export async function rewriteTodoWithReason(
  originalTodoText: string,
  reasonType: ReasonType,
  contextQuestions?: string[]
): Promise<{
  conditionMessage: string;
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
            content: buildUserPrompt({
              originalTodoText,
              reasonType,
              contextQuestions,
            }),
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
