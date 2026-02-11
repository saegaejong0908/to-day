import "server-only";

export type GoalRoadmapResult = {
  marchGoal: string;
  juneGoal: string;
  septemberGoal: string;
  monthlyPlan: string[];
  aiTodos: string[];
};

const SYSTEM_PROMPT =
  "너는 1년 목표를 실행 가능한 로드맵으로 바꾸는 도구다.\n" +
  "설명하거나 판단하지 말고, 요청한 결과만 생성하라.\n" +
  "출력은 반드시 JSON 하나만 반환하라.\n" +
  "추상적인 표현(열심히/꾸준히/잘/최선을 등) 금지.\n" +
  "수치화된 목표(횟수/시간/개수/기한 등)를 반드시 포함하라.\n" +
  "aiTodos는 구체적 행동 3개만 포함하라.\n" +
  "monthlyPlan은 실행 가능한 월간 계획 항목 리스트(문장)로 작성하라.\n" +
  "키는 반드시 marchGoal, juneGoal, septemberGoal, monthlyPlan, aiTodos 만 포함하라.";

const buildUserPrompt = (goalTitle: string, category: string) => {
  return `1년 목표: "${goalTitle}"
카테고리: "${category}"

아래 JSON 형식으로만 출력하라.

{
  "marchGoal": "string",
  "juneGoal": "string",
  "septemberGoal": "string",
  "monthlyPlan": ["string"],
  "aiTodos": ["string", "string", "string"]
}`.trim();
};

const parseResult = (raw: string): GoalRoadmapResult | null => {
  const parsed = JSON.parse(raw) as Partial<GoalRoadmapResult>;
  const marchGoal = typeof parsed.marchGoal === "string" ? parsed.marchGoal.trim() : "";
  const juneGoal = typeof parsed.juneGoal === "string" ? parsed.juneGoal.trim() : "";
  const septemberGoal =
    typeof parsed.septemberGoal === "string" ? parsed.septemberGoal.trim() : "";
  const monthlyPlan = Array.isArray(parsed.monthlyPlan)
    ? parsed.monthlyPlan
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  const aiTodos = Array.isArray(parsed.aiTodos)
    ? parsed.aiTodos
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

  if (!marchGoal || !juneGoal || !septemberGoal) return null;
  if (monthlyPlan.length === 0) return null;
  if (aiTodos.length !== 3) return null;
  return { marchGoal, juneGoal, septemberGoal, monthlyPlan, aiTodos };
};

export async function generateGoalRoadmap(
  goalTitle: string,
  category: string
): Promise<GoalRoadmapResult | null> {
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
        temperature: 0.6,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(goalTitle, category) },
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

