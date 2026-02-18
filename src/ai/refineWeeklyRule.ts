import "server-only";
import { MissedReasonType } from "@/types/missed-reason";
import {
  type StrategyType,
  STRATEGY_LABELS,
} from "@/types/strategyType";
import { BLOCK_REASON_LABELS } from "@/domain/blockReason";

export type WeeklyStatus = "STEADY" | "SPORADIC" | "STOPPED";

const STATUS_LABELS: Record<WeeklyStatus, string> = {
  STEADY: "유지됨",
  SPORADIC: "들쭉날쭉",
  STOPPED: "멈춤",
};

export type RefineWeeklyRuleInput = {
  goalTrackTitle: string;
  status: WeeklyStatus;
  blockReason?: MissedReasonType | null;
  draftRule: string;
  selectedStrategies: StrategyType[];
  recentExecution?: {
    executedDays: number;
    lastExecutedText: string;
  };
};

export type RefineWeeklyRuleResult = {
  refinedText: string;
  rationale: string;
};

/** 선택 전략을 종합하여 1개의 실행 문장 생성 (실행 확률 + 성과 동시 고려) */
export async function refineWeeklyRule(
  input: RefineWeeklyRuleInput
): Promise<RefineWeeklyRuleResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (input.selectedStrategies.length === 0) return null;

  const statusLabel = STATUS_LABELS[input.status];
  const blockLabel = input.blockReason
    ? BLOCK_REASON_LABELS[input.blockReason]
    : "";
  const strategyLabels = input.selectedStrategies
    .map((s) => STRATEGY_LABELS[s])
    .join(", ");

  const systemPrompt =
    "너는 사용자가 선택한 전략들을 종합하여 다음 주 실행 규칙 1개를 설계하는 도우미다.\n" +
    "출력은 반드시 JSON 하나만: {\"refinedText\": \"실행 문장 1개\", \"rationale\": \"이유 1문장\"}\n" +
    "규칙:\n" +
    "- 항상 1개의 실행 문장만 생성\n" +
    "- 너무 약하게 만들지 말 것 (성과 유지)\n" +
    "- 실행 확률과 성과를 동시에 고려\n" +
    "- 선택된 전략을 반드시 반영\n" +
    "- 문장은 구체적이어야 함\n" +
    "- refinedText는 25단어 이하\n" +
    "- rationale은 1문장만";

  const userPrompt = `목표: ${input.goalTrackTitle}
이번 주 상태: ${statusLabel}
${blockLabel ? `막힌 이유: ${blockLabel}` : ""}
선택 전략: ${strategyLabels}
사용자 초안: ${input.draftRule}
${input.recentExecution ? `최근 7일 실행 ${input.recentExecution.executedDays}일${input.recentExecution.lastExecutedText ? `, 마지막 실행: ${input.recentExecution.lastExecutedText}` : ""}` : ""}

위를 바탕으로 refinedText와 rationale을 JSON으로만 답하라.`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
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

    const parsed = JSON.parse(content) as Partial<RefineWeeklyRuleResult>;
    const refinedText =
      typeof parsed.refinedText === "string" ? parsed.refinedText.trim() : "";
    const rationale =
      typeof parsed.rationale === "string" ? parsed.rationale.trim() : "";
    if (!refinedText || !rationale) return null;

    return { refinedText, rationale };
  } catch {
    return null;
  }
}
