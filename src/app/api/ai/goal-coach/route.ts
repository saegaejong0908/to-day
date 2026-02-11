import { NextResponse } from "next/server";
import { coachGoalPlan, type GoalCoachMode } from "@/ai/coachGoalPlan";

const isGoalCoachMode = (value: unknown): value is GoalCoachMode => {
  return value === "SPECIFY" || value === "REALITY_CHECK" || value === "BREAK_DOWN";
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      mode?: unknown;
      yearGoal?: unknown;
      currentStatus?: unknown;
      dailyAvailableTime?: unknown;
      weakestArea?: unknown;
      note?: unknown;
      threeMonthGoal?: unknown;
    };

    if (!isGoalCoachMode(body.mode)) {
      return NextResponse.json({ result: null }, { status: 400 });
    }

    const yearGoal = typeof body.yearGoal === "string" ? body.yearGoal.trim() : "";
    const currentStatus =
      typeof body.currentStatus === "string" ? body.currentStatus.trim() : "";
    const dailyAvailableTime =
      typeof body.dailyAvailableTime === "string"
        ? body.dailyAvailableTime.trim()
        : "";
    const weakestArea =
      typeof body.weakestArea === "string" ? body.weakestArea.trim() : "";
    const note = typeof body.note === "string" ? body.note.trim() : "";
    const threeMonthGoal =
      typeof body.threeMonthGoal === "string" ? body.threeMonthGoal.trim() : "";

    if (!yearGoal || !threeMonthGoal) {
      return NextResponse.json({ result: null }, { status: 400 });
    }

    const result = await coachGoalPlan({
      mode: body.mode,
      yearGoal,
      currentStatus,
      dailyAvailableTime,
      weakestArea,
      note,
      threeMonthGoal,
    });
    return NextResponse.json({ result });
  } catch {
    return NextResponse.json({ result: null }, { status: 500 });
  }
}

