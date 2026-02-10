import { NextResponse } from "next/server";
import { rewriteTodoWithReason } from "@/ai/rewriteTodoWithReason";

type ReasonType = "HARD_TO_START" | "NOT_ENOUGH_TIME";

const isReasonType = (value: unknown): value is ReasonType =>
  value === "HARD_TO_START" || value === "NOT_ENOUGH_TIME";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      originalTodoText?: unknown;
      reasonType?: unknown;
      contextQuestions?: unknown;
    };
    const originalTodoText =
      typeof body.originalTodoText === "string" ? body.originalTodoText.trim() : "";
    const reasonType = body.reasonType;
    const contextQuestions = Array.isArray(body.contextQuestions)
      ? body.contextQuestions.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0
        )
      : undefined;

    if (!originalTodoText || !isReasonType(reasonType)) {
      return NextResponse.json({ result: null }, { status: 400 });
    }

    const result = await rewriteTodoWithReason(
      originalTodoText,
      reasonType,
      contextQuestions
    );
    return NextResponse.json({ result });
  } catch {
    return NextResponse.json({ result: null }, { status: 500 });
  }
}
