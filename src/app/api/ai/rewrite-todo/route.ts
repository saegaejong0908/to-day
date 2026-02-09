import { NextResponse } from "next/server";
import { rewriteTodoWithReason } from "@/ai/rewriteTodoWithReason";

type ReasonType = "HARD_TO_START" | "TOO_BIG" | "EMOTIONALLY_HEAVY";

const isReasonType = (value: unknown): value is ReasonType =>
  value === "HARD_TO_START" || value === "TOO_BIG" || value === "EMOTIONALLY_HEAVY";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      originalTodoText?: unknown;
      reasonType?: unknown;
    };
    const originalTodoText =
      typeof body.originalTodoText === "string" ? body.originalTodoText.trim() : "";
    const reasonType = body.reasonType;

    if (!originalTodoText || !isReasonType(reasonType)) {
      return NextResponse.json({ result: null }, { status: 400 });
    }

    const result = await rewriteTodoWithReason(originalTodoText, reasonType);
    return NextResponse.json({ result });
  } catch {
    return NextResponse.json({ result: null }, { status: 500 });
  }
}
