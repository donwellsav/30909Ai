import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import {
  browserContextMessage,
  browserControlMessage,
  browserStateMessage,
  cleanBrowserState,
  runBrowserAgentLoop,
  type BrowserContext,
  type ModelMessage,
} from "@/lib/browser-agent";
import { getChatHistory, getSettings, setChatHistory, type AppSettings, type ChatMessage } from "@/lib/local-store";

export const dynamic = "force-dynamic";

function chatUrl(endpoint: string) {
  const base = endpoint.replace(/\/$/, "");
  return base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
}

async function detectModel(endpoint: string) {
  try {
    const response = await fetch(`${endpoint.replace(/\/$/, "")}/models`, { signal: AbortSignal.timeout(4000) });
    const json = await response.json();
    return json?.data?.[0]?.id || "";
  } catch {
    return "";
  }
}

async function completeChat(settings: AppSettings, model: string, messages: ModelMessage[]) {
  const requestBody: Record<string, unknown> = {
    model,
    messages,
    temperature: settings.temperature,
    top_p: settings.topP,
    top_k: settings.topK,
    min_p: settings.minP,
    repetition_penalty: settings.repeatPenalty,
    max_tokens: settings.maxTokens,
    stream: false,
    chat_template_kwargs: { enable_thinking: settings.thinkingEnabled },
  };
  if (settings.seed >= 0) requestBody.seed = settings.seed;

  const response = await fetch(chatUrl(settings.endpoint), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(120000),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json?.error?.message || json?.error || `HTTP ${response.status}`);
  return json?.choices?.[0]?.message?.content || "";
}

export async function GET() {
  return NextResponse.json({ messages: getChatHistory() });
}

export async function DELETE() {
  setChatHistory([]);
  return NextResponse.json({ messages: [] });
}

export async function POST(request: Request) {
  const { content, browserContext } = await request.json();
  if (!content || typeof content !== "string") {
    return NextResponse.json({ error: "Message content is required" }, { status: 400 });
  }

  const settings = getSettings();
  const history = getChatHistory();
  const userMessage: ChatMessage = {
    id: randomUUID(),
    role: "user",
    content,
    createdAt: new Date().toISOString(),
  };
  const nextHistory = [...history, userMessage];
  setChatHistory(nextHistory);

  const model = settings.model || await detectModel(settings.endpoint);
  if (!model) {
    return NextResponse.json({ error: "No served model found at the configured endpoint", messages: nextHistory }, { status: 503 });
  }

  try {
    const context = browserContext && typeof browserContext === "object" ? browserContext as BrowserContext : null;
    let browserState = cleanBrowserState(context?.controlledBrowser);
    const modelMessages = [
      browserControlMessage,
      context ? browserContextMessage(context) : null,
      browserStateMessage(browserState),
      ...nextHistory
        .filter((message) => message.role !== "system")
        .map(({ role, content }) => ({ role, content })),
    ].filter(Boolean) as ModelMessage[];

    const { content, browserState: nextBrowserState, browserActions } = await runBrowserAgentLoop({
      messages: modelMessages,
      initialState: browserState,
      complete: (messages) => completeChat(settings, model, messages),
    });

    const assistantMessage: ChatMessage = {
      id: randomUUID(),
      role: "assistant",
      content,
      createdAt: new Date().toISOString(),
    };
    const messages = [...nextHistory, assistantMessage];
    setChatHistory(messages);
    return NextResponse.json({
      messages,
      model,
      browserActions,
      ...(browserActions.length > 0 && nextBrowserState ? { browserState: nextBrowserState } : {}),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "chat request failed",
        messages: nextHistory,
        model,
      },
      { status: 500 }
    );
  }
}
