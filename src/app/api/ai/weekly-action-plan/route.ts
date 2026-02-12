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
      seedTodos?: unknown;
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
    const seedTodos = Array.isArray(body.seedTodos)
      ? body.seedTodos
          .filter((todo): todo is string => typeof todo === "string")
          .map((todo) => todo.trim())
          .filter(Boolean)
      : [];

    if (!desiredOutcome || !weeklyState || seedTodos.length === 0) {
      return NextResponse.json({ result: null }, { status: 400 });
    }

    const result = await generateWeeklyActionPlan({
      deadlineDate,
      desiredOutcome,
      requiredState,
      weeklyState,
      constraints,
      seedTodos,
    });
    return NextResponse.json({ result });
  } catch {
    return NextResponse.json({ result: null }, { status: 500 });
  }
}

