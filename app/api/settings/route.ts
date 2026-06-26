import { NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/local-store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ settings: getSettings() });
}

export async function POST(request: Request) {
  const body = await request.json();
  return NextResponse.json({ settings: saveSettings(body) });
}
