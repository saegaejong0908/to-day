export const runtime = "edge";

export async function GET() {
  return Response.json({
    version: process.env.NEXT_PUBLIC_BUILD_TIME ?? "dev",
  });
}
