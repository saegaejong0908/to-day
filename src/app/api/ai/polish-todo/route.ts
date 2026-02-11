import { NextResponse } from "next/server";
import { polishTodoSentence } from "@/ai/polishTodoSentence";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      rawTodo?: unknown;
    };
    const rawTodo = typeof body.rawTodo === "string" ? body.rawTodo.trim() : "";
    if (!rawTodo) {
      return NextResponse.json({ result: null }, { status: 400 });
    }

    const result = await polishTodoSentence(rawTodo);
    return NextResponse.json({ result });
  } catch {
    return NextResponse.json({ result: null }, { status: 500 });
  }
}

