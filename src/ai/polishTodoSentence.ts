import "server-only";

export type PolishTodoResult = {
  polishedTodo: string;
};

const SYSTEM_PROMPT =
  "너는 사용자가 직접 쓴 투두 문장을 실행 가능한 문장으로 다듬는 도우미다.\n" +
  "출력은 반드시 JSON 하나만 반환하라.\n" +
  "키는 polishedTodo 하나만 사용한다.\n" +
  "한 문장만 출력하고, 길게 설명하지 말라.";

const buildUserPrompt = (rawTodo: string) => {
  return `원문 투두: "${rawTodo}"

요구사항:
- 실행 가능한 한 문장으로 다듬기
- 시간/범위가 보이도록 구체화
- 하나만 출력

JSON 형식:
{
  "polishedTodo": "..."
}`;
};

const parseResult = (raw: string): PolishTodoResult | null => {
  const parsed = JSON.parse(raw) as Partial<PolishTodoResult>;
  const polishedTodo =
    typeof parsed.polishedTodo === "string" ? parsed.polishedTodo.trim() : "";
  if (!polishedTodo) return null;
  return { polishedTodo };
};

export async function polishTodoSentence(
  rawTodo: string
): Promise<PolishTodoResult | null> {
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
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(rawTodo) },
        ],
      }),
    });
    if (!response.ok) return null;
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

