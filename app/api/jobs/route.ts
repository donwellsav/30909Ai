import { NextResponse } from "next/server";
import { getActionDefinitions, getJobLog, getJobs, startJob } from "@/lib/local-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const log = searchParams.get("log");

  if (log) {
    return NextResponse.json({ log: getJobLog(log) });
  }

  return NextResponse.json({
    actions: getActionDefinitions().map(({ action, label }) => ({ action, label })),
    jobs: getJobs(),
  });
}

export async function POST(request: Request) {
  const { action } = await request.json();
  const job = startJob(action);
  return NextResponse.json({ job });
}
