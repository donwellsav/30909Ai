import { NextResponse } from "next/server";
import { back, click, forward, goto, reload, snapshot, type } from "@/lib/browser-use";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json();
  const action = typeof body.action === "string" ? body.action : "";
  const selector = typeof body.selector === "string" ? body.selector.trim() : "";
  const text = typeof body.text === "string" ? body.text : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";

  try {
    if (action === "open") {
      if (!url) return NextResponse.json({ error: "URL is required" }, { status: 400 });
      return NextResponse.json({ state: await goto(url) });
    }
    if (action === "click") {
      if (!selector) return NextResponse.json({ error: "Selector is required" }, { status: 400 });
      return NextResponse.json({ state: await click(selector) });
    }
    if (action === "type") {
      if (!selector) return NextResponse.json({ error: "Selector is required" }, { status: 400 });
      return NextResponse.json({ state: await type(selector, text) });
    }
    if (action === "back") return NextResponse.json({ state: await back() });
    if (action === "forward") return NextResponse.json({ state: await forward() });
    if (action === "reload") return NextResponse.json({ state: await reload() });
    return NextResponse.json({ state: await snapshot() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Browser action failed" }, { status: 500 });
  }
}
