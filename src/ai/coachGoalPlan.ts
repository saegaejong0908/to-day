import "server-only";

export type GoalCoachMode = "SPECIFY" | "REALITY_CHECK" | "BREAK_DOWN";

export type GoalCoachResult = {
  questions: string[];
  suggestion: string;
};

const SYSTEM_PROMPT =
  "너는 목표 설계를 돕는 코치다.\n" +
  "절대 전체 계획을 새로 생성하지 말고, 질문과 짧은 제안만 제공하라.\n" +
  "출력은 반드시 JSON 하나만 반환하라.\n" +
  "JSON 키는 questions, suggestion 두 개만 사용한다.\n" +
  "questions는 최대 3개, suggestion은 한 문장만 허용한다.\n" +
  "질문은 사용자가 스스로 설계하도록 유도해야 한다.";

const buildUserPrompt = (args: {
  mode: GoalCoachMode;
  yearGoal: string;
  currentStatus: string;
  dailyAvailableTime: string;
  weakestArea: string;
  note: string;
  threeMonthGoal: string;
}) => {
  const modeGuide =
    args.mode === "SPECIFY"
      ? "목표를 수치/기한/횟수로 구체화하도록 질문하라."
      : args.mode === "REALITY_CHECK"
        ? "현재 상태와 하루 시간 대비 현실성을 점검하는 질문을 하라."
        : "3개월 목표를 오늘 가능한 실행 단위로 쪼개는 질문을 하라.";

  return `모드: ${args.mode}
지시: ${modeGuide}

1년 목표: ${args.yearGoal}
현재 상태: ${args.currentStatus}
하루 가능 시간: ${args.dailyAvailableTime}
가장 약한 영역: ${args.weakestArea}
자유 메모: ${args.note}
3개월 목표: ${args.threeMonthGoal}

반드시 아래 JSON 형식으로만 답하라:
{
  "questions": ["질문1", "질문2", "질문3"],
  "suggestion": "한 줄 제안"
}`;
};

const parseResult = (raw: string): GoalCoachResult | null => {
  const parsed = JSON.parse(raw) as Partial<GoalCoachResult>;
  const questions = Array.isArray(parsed.questions)
    ? parsed.questions
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];
  const suggestion =
    typeof parsed.suggestion === "string" ? parsed.suggestion.trim() : "";
  if (questions.length === 0 || !suggestion) return null;
  return { questions, suggestion };
};

export async function coachGoalPlan(args: {
  mode: GoalCoachMode;
  yearGoal: string;
  currentStatus: string;
  dailyAvailableTime: string;
  weakestArea: string;
  note: string;
  threeMonthGoal: string;
}): Promise<GoalCoachResult | null> {
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

