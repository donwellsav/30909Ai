import { NextResponse } from "next/server";
import { getSettings } from "@/lib/local-store";

export const dynamic = "force-dynamic";

async function detectModel(endpoint: string) {
  try {
    const response = await fetch(`${endpoint.replace(/\/$/, "")}/models`, { signal: AbortSignal.timeout(4000) });
    const json = await response.json();
    return json?.data?.[0]?.id || "";
  } catch {
    return "";
  }
}

export async function POST(request: Request) {
  const { prompt, systemPrompt, temperature } = await request.json();
  if (!prompt) return NextResponse.json({ error: "Prompt is required" }, { status: 400 });

  const settings = getSettings();
  const model = settings.model || await detectModel(settings.endpoint);
  if (!model) {
    return NextResponse.json({ error: "No served model found at the configured endpoint" }, { status: 503 });
  }

  const requestBody: Record<string, unknown> = {
    model,
    messages: [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      { role: "user", content: prompt },
    ],
    temperature: temperature ?? settings.temperature,
    top_p: settings.topP,
    top_k: settings.topK,
    min_p: settings.minP,
    repetition_penalty: settings.repeatPenalty,
    max_tokens: settings.maxTokens,
    chat_template_kwargs: { enable_thinking: settings.thinkingEnabled },
  };
  if (settings.seed >= 0) requestBody.seed = settings.seed;

  const response = await fetch(`${settings.endpoint.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(120000),
  });
  const json = await response.json();
  if (!response.ok) {
    return NextResponse.json({ error: json?.error?.message || "Generation failed" }, { status: response.status });
  }
  return NextResponse.json({ text: json?.choices?.[0]?.message?.content || "" });
}
