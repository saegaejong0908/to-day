import { NextResponse } from "next/server";
import { refineWeeklyRule } from "@/ai/refineWeeklyRule";
import { MissedReasonType } from "@/types/missed-reason";
import { STRATEGY_OPTIONS } from "@/types/strategyType";

const isStatus = (v: unknown): v is "STEADY" | "SPORADIC" | "STOPPED" =>
  v === "STEADY" || v === "SPORADIC" || v === "STOPPED";

const isBlockReason = (v: unknown): v is MissedReasonType =>
  typeof v === "string" && Object.values(MissedReasonType).includes(v as MissedReasonType);

const isStrategyType = (v: unknown): v is (typeof STRATEGY_OPTIONS)[number] =>
  typeof v === "string" && STRATEGY_OPTIONS.includes(v as (typeof STRATEGY_OPTIONS)[number]);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      goalTrackTitle?: unknown;
      weeklyStatus?: unknown;
      status?: unknown;
      blockReason?: unknown;
      draftRule?: unknown;
      draftText?: unknown;
      selectedStrategies?: unknown;
      recentExecution?: unknown;
    };

    const goalTrackTitle =
      typeof body.goalTrackTitle === "string" ? body.goalTrackTitle.trim() : "";
    const draftRule =
      typeof body.draftRule === "string"
        ? body.draftRule.trim()
        : typeof body.draftText === "string"
          ? body.draftText.trim()
          : "";
    const status = body.weeklyStatus ?? body.status;
    if (!goalTrackTitle || !isStatus(status)) {
      return NextResponse.json({ result: null }, { status: 400 });
    }
    const selectedStrategies = Array.isArray(body.selectedStrategies)
      ? (body.selectedStrategies as unknown[]).filter(isStrategyType)
      : [];
    if (selectedStrategies.length === 0) {
      return NextResponse.json({ result: null }, { status: 400 });
    }

    let recentExecution: { executedDays: number; lastExecutedText: string } | undefined;
    if (
      body.recentExecution &&
      typeof body.recentExecution === "object" &&
      "executedDays" in body.recentExecution
    ) {
      const re = body.recentExecution as Record<string, unknown>;
      recentExecution = {
        executedDays: typeof re.executedDays === "number" ? re.executedDays : 0,
        lastExecutedText: typeof re.lastExecutedText === "string" ? re.lastExecutedText : "",
      };
    }

    const result = await refineWeeklyRule({
      goalTrackTitle,
      status,
      blockReason: isBlockReason(body.blockReason) ? body.blockReason : null,
      draftRule: draftRule || "(초안 없음)",
      selectedStrategies,
      recentExecution,
    });
    return NextResponse.json({ result });
  } catch {
    return NextResponse.json({ result: null }, { status: 500 });
  }
}
