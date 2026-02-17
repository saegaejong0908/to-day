import "server-only";

export type WeeklyReviewCoachInput = {
  rhythm: "steady" | "sporadic" | "stopped";
  wobbleMoment: string;
  nextWeekOneChange: string;
  nextWeekKeepOne?: string;
};

export type WeeklyReviewCoachResult = {
  coachSummary: string;
  coachQuestion: string;
};

const RHYTHM_LABELS: Record<string, string> = {
  steady: "꾸준함",
  sporadic: "들쭉날쭉",
  stopped: "멈춤",
};

const SYSTEM_PROMPT =
  "너는 주간 평가를 돕는 직면형 코치다.\n" +
  "팩트→관찰→제안(1개) + 질문 1개만 제공한다.\n" +
  "위로, 도덕 판단, 감정 몰이, 퍼센트/점수는 금지한다.\n" +
  "출력은 반드시 JSON 하나만: {\"coachSummary\": \"1~2문장\", \"coachQuestion\": \"질문 1개\"}\n" +
  "coachSummary는 사용자 입력을 요약·반영하고, 다음 주 방향을 한 줄로 제안한다.\n" +
  "coachQuestion은 사용자가 스스로 생각하도록 유도하는 질문 1개만.";

export async function weeklyReviewCoach(
  input: WeeklyReviewCoachInput
): Promise<WeeklyReviewCoachResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const rhythmLabel = RHYTHM_LABELS[input.rhythm] ?? input.rhythm;
    const userPrompt = `리듬: ${rhythmLabel}
흔들린 순간: ${input.wobbleMoment}
다음 주 바꿀 행동: ${input.nextWeekOneChange}
${input.nextWeekKeepOne ? `유지할 행동: ${input.nextWeekKeepOne}` : ""}

위 내용을 바탕으로 coachSummary(1~2문장)와 coachQuestion(질문 1개)를 JSON으로만 답하라.`;

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

    const parsed = JSON.parse(content) as Partial<WeeklyReviewCoachResult>;
    const coachSummary =
      typeof parsed.coachSummary === "string" ? parsed.coachSummary.trim() : "";
    const coachQuestion =
      typeof parsed.coachQuestion === "string" ? parsed.coachQuestion.trim() : "";
    if (!coachSummary || !coachQuestion) return null;

    return { coachSummary, coachQuestion };
  } catch {
    return null;
  }
}
