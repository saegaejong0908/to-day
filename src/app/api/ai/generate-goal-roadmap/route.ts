import { NextResponse } from "next/server";
import { generateGoalRoadmap } from "@/ai/generateGoalRoadmap";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      goalTitle?: unknown;
      category?: unknown;
    };
    const goalTitle = typeof body.goalTitle === "string" ? body.goalTitle.trim() : "";
    const category = typeof body.category === "string" ? body.category.trim() : "";

    if (!goalTitle || !category) {
      return NextResponse.json({ result: null }, { status: 400 });
    }

    const result = await generateGoalRoadmap(goalTitle, category);
    return NextResponse.json({ result });
  } catch {
    return NextResponse.json({ result: null }, { status: 500 });
  }
}

