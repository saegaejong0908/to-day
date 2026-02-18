import { NextResponse } from "next/server";
import { todoBlockSuggestion } from "@/ai/todoBlockSuggestion";

const isBlockType = (
  v: unknown
): v is "START_FRICTION" | "SCOPE_TOO_BIG" | "STRUCTURE_CONFUSION" =>
  v === "START_FRICTION" || v === "SCOPE_TOO_BIG" || v === "STRUCTURE_CONFUSION";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      blockType?: unknown;
      originalTodo?: unknown;
      situation?: unknown;
    };
    if (!isBlockType(body.blockType)) {
      return NextResponse.json({ result: null }, { status: 400 });
    }
    const originalTodo =
      typeof body.originalTodo === "string" ? body.originalTodo.trim() : "";
    const situation =
      typeof body.situation === "string" ? body.situation.trim() : undefined;

    if (!originalTodo) {
      return NextResponse.json({ result: null }, { status: 400 });
    }

    const result = await todoBlockSuggestion(
      body.blockType,
      originalTodo,
      situation
    );
    return NextResponse.json({ result });
  } catch {
    return NextResponse.json({ result: null }, { status: 500 });
  }
}
