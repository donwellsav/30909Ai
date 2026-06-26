import { NextResponse } from "next/server";
import { addSearch, getSearchHistory, getSettings, runFile, setSearchHistory } from "@/lib/local-store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ searches: getSearchHistory() });
}

export async function DELETE() {
  setSearchHistory([]);
  return NextResponse.json({ searches: [] });
}

export async function POST(request: Request) {
  const { query, openBrowser = true } = await request.json();
  if (!query || typeof query !== "string") {
    return NextResponse.json({ error: "Search query is required" }, { status: 400 });
  }

  const settings = getSettings();
  const url = `${settings.searchEngine}${encodeURIComponent(query)}`;
  const record = addSearch(query, url);
  const previewOnly = openBrowser === false;
  const browser = settings.browser || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const opened = previewOnly
    ? { ok: false, stderr: "" }
    : await runFile("powershell.exe", [
        "-NoProfile",
        "-Command",
        `Start-Process ${JSON.stringify(browser)} ${JSON.stringify(url)}`,
      ], 5000);

  return NextResponse.json({
    search: record,
    opened: opened.ok,
    previewOnly,
    error: opened.ok || previewOnly ? "" : opened.stderr,
  });
}
