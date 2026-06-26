import { NextResponse } from "next/server";
import { getSettings } from "@/lib/local-store";

export const dynamic = "force-dynamic";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function localBaseUrl(value: unknown) {
  const settings = getSettings();
  const raw = typeof value === "string" && value.trim() ? value.trim() : settings.endpoint;
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || !LOCAL_HOSTS.has(url.hostname)) {
    throw new Error("Only localhost endpoints can be probed.");
  }
  url.pathname = url.pathname.replace(/\/$/, "") || "/v1";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

async function readJson(response: Response) {
  return response.json().catch(() => ({}));
}

function modelIds(json: unknown) {
  const data = (json as { data?: unknown }).data;
  return Array.isArray(data)
    ? data.flatMap((item: { id?: unknown }) => typeof item.id === "string" && item.id.length > 0 ? [item.id] : [])
    : [];
}

function tokenNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function tokenUsage(json: unknown) {
  const usage = (json as { usage?: Record<string, unknown> }).usage || {};
  const promptTokens = tokenNumber(usage.prompt_tokens);
  const completionTokens = tokenNumber(usage.completion_tokens);
  const totalTokens = tokenNumber(usage.total_tokens) ?? ((promptTokens ?? 0) + (completionTokens ?? 0) || null);
  return { promptTokens, completionTokens, totalTokens };
}

export async function POST(request: Request) {
  try {
    const settings = getSettings();
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const baseUrl = localBaseUrl(body.baseUrl);
    const apiKey = typeof body.apiKey === "string" && body.apiKey ? body.apiKey : settings.apiKey || "local";
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
    const started = Date.now();

    const modelsStarted = Date.now();
    const modelsResponse = await fetch(`${baseUrl}/models`, { headers, signal: AbortSignal.timeout(5000) });
    const modelsJson = await readJson(modelsResponse);
    const models = modelIds(modelsJson);
    const modelsLatencyMs = Date.now() - modelsStarted;
    const model = typeof body.model === "string" && body.model ? body.model : settings.model || models[0];
    if (!model) throw new Error("No model ID available for chat probe.");

    const chatStarted = Date.now();
    const chatResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply exactly: OK" }],
        max_tokens: 32,
        temperature: 0,
      }),
    });
    const chatJson = await readJson(chatResponse);
    const chatLatencyMs = Date.now() - chatStarted;
    const choice = (chatJson as { choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown } }> }).choices?.[0];
    const content = String(choice?.message?.content || choice?.message?.reasoning_content || "");
    const usage = tokenUsage(chatJson);
    const completionTokensPerSecond = usage.completionTokens && chatLatencyMs > 0
      ? Number((usage.completionTokens / (chatLatencyMs / 1000)).toFixed(2))
      : null;

    return NextResponse.json({
      testedAt: new Date().toISOString(),
      baseUrl,
      model,
      totalMs: Date.now() - started,
      models: {
        ok: modelsResponse.ok,
        status: modelsResponse.status,
        latencyMs: modelsLatencyMs,
        count: models.length,
        ids: models,
      },
      chat: {
        ok: chatResponse.ok && Boolean(choice),
        status: chatResponse.status,
        latencyMs: chatLatencyMs,
        content,
        usage,
        completionTokensPerSecond,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Probe failed";
    const status = message.startsWith("Only localhost") || message.startsWith("No model") ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
