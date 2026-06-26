import { NextResponse } from "next/server";
import { getJobs } from "@/lib/local-store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    history: getJobs().map((job) => ({
      id: job.id,
      workflow_id: "local",
      status: job.status,
      final_output: job.label,
      started_at: job.startedAt,
      completed_at: job.completedAt,
    })),
  });
}
