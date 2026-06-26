import { NextResponse } from "next/server";
import { getMemoryStore, setMemoryStore } from "@/lib/local-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  const memory = getMemoryStore();
  return NextResponse.json({ value: key ? memory[key] ?? null : memory });
}

export async function POST(request: Request) {
  const { key, value } = await request.json();
  if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });
  const memory = getMemoryStore();
  memory[key] = value;
  setMemoryStore(memory);
  return NextResponse.json({ success: true });
}
