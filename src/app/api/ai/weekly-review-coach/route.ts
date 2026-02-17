import { NextResponse } from "next/server";
import { weeklyReviewCoach } from "@/ai/weeklyReviewCoach";

const isRhythm = (v: unknown): v is "steady" | "sporadic" | "stopped" =>
  v === "steady" || v === "sporadic" || v === "stopped";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      rhythm?: unknown;
      wobbleMoment?: unknown;
      nextWeekOneChange?: unknown;
      nextWeekKeepOne?: unknown;
    };

    if (!isRhythm(body.rhythm)) {
      return NextResponse.json({ result: null }, { status: 400 });
    }
    const wobbleMoment =
      typeof body.wobbleMoment === "string" ? body.wobbleMoment.trim() : "";
    const nextWeekOneChange =
      typeof body.nextWeekOneChange === "string"
        ? body.nextWeekOneChange.trim()
        : "";
    const nextWeekKeepOne =
      typeof body.nextWeekKeepOne === "string"
        ? body.nextWeekKeepOne.trim()
        : undefined;

    if (!wobbleMoment || !nextWeekOneChange) {
      return NextResponse.json({ result: null }, { status: 400 });
    }

    const result = await weeklyReviewCoach({
      rhythm: body.rhythm,
      wobbleMoment,
      nextWeekOneChange,
      nextWeekKeepOne: nextWeekKeepOne || undefined,
    });
    return NextResponse.json({ result });
  } catch {
    return NextResponse.json({ result: null }, { status: 500 });
  }
}
