import { NextResponse } from "next/server";
import { generateWeeklyActionPlan } from "@/ai/generateWeeklyActionPlan";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      deadlineDate?: unknown;
      desiredOutcome?: unknown;
      requiredState?: unknown;
      weeklyState?: unknown;
      constraints?: unknown;
    };

    const deadlineDate =
      typeof body.deadlineDate === "string" ? body.deadlineDate.trim() : "";
    const desiredOutcome =
      typeof body.desiredOutcome === "string" ? body.desiredOutcome.trim() : "";
    const requiredState =
      typeof body.requiredState === "string" ? body.requiredState.trim() : "";
    const weeklyState =
      typeof body.weeklyState === "string" ? body.weeklyState.trim() : "";
    const constraints =
      typeof body.constraints === "string" ? body.constraints.trim() : "";

    if (!desiredOutcome || !weeklyState) {
      return NextResponse.json({ result: null }, { status: 400 });
    }

    const result = await generateWeeklyActionPlan({
      deadlineDate,
      desiredOutcome,
      requiredState,
      weeklyState,
      constraints,
    });
    return NextResponse.json({ result });
  } catch {
    return NextResponse.json({ result: null }, { status: 500 });
  }
}

