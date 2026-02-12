import "server-only";

export type WeeklyActionPlanResult = {
  rationale: string;
  todos: string[];
};

const SYSTEM_PROMPT =
  "너는 사용자가 작성한 실행 항목을 가볍게 보완하는 도우미다.\n" +
  "결과를 과장하거나 동기부여 문구를 쓰지 말라.\n" +
  "사용자 문장을 최대한 유지하고 표현만 더 명확하게 다듬어라.\n" +
  "출력은 반드시 JSON 하나만 반환하라.\n" +
  "키는 rationale, todos 두 개만 사용한다.\n" +
  "rationale은 한 문장, todos는 사용자 초안 개수와 동일하게 반환하라.";

const buildUserPrompt = (args: {
  deadlineDate: string;
  desiredOutcome: string;
  requiredState: string;
  weeklyState: string;
  constraints: string;
  seedTodos: string[];
}) => {
  return `데드라인: ${args.deadlineDate || "(미정)"}
원하는 결과: ${args.desiredOutcome}
필요 상태: ${args.requiredState}
이번 주 상태 목표: ${args.weeklyState}
현실 조건: ${args.constraints || "(없음)"}
사용자 초안 실행 항목:
${args.seedTodos.map((todo, index) => `${index + 1}. ${todo}`).join("\n")}

요구사항:
- 사용자 초안 항목을 유지/보완하는 방식으로 정리하기
- 사용자가 적은 의도를 바꾸지 말기
- 항목 개수는 사용자 초안과 반드시 같게 유지하기
- 새로운 항목을 추가 생성하지 말기
- 중복/모호한 항목은 다듬기
- 요일/날짜를 직접 지정하지 않기
- 사용자가 직접 요일을 배치할 수 있도록 중립 문장으로 작성

반드시 아래 JSON 형식으로만 답하라:
{
  "rationale": "한 줄 설명",
  "todos": ["투두1", "투두2", "투두3"]
}`;
};

const parseResult = (raw: string): WeeklyActionPlanResult | null => {
  const parsed = JSON.parse(raw) as Partial<WeeklyActionPlanResult>;
  const rationale =
    typeof parsed.rationale === "string" ? parsed.rationale.trim() : "";
  const todos = Array.isArray(parsed.todos)
    ? parsed.todos
        .filter((todo): todo is string => typeof todo === "string")
        .map((todo) => todo.trim())
        .filter(Boolean)
        .slice(0, 7)
    : [];
  if (!rationale || todos.length === 0) return null;
  return { rationale, todos };
};

export async function generateWeeklyActionPlan(args: {
  deadlineDate: string;
  desiredOutcome: string;
  requiredState: string;
  weeklyState: string;
  constraints: string;
  seedTodos: string[];
}): Promise<WeeklyActionPlanResult | null> {
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
        temperature: 0.5,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(args) },
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

