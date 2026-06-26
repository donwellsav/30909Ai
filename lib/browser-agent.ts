import * as controlledBrowser from "./browser-use";
import type { BrowserAction, BrowserActionLog, BrowserUseState } from "./browser-types";

export type ModelMessage = { role: "system" | "user" | "assistant"; content: string };

export interface BrowserContext {
  query?: unknown;
  url?: unknown;
  previewUrl?: unknown;
  controlledBrowser?: unknown;
}

export interface BrowserAgentResult {
  content: string;
  browserState: BrowserUseState | null;
  browserActions: BrowserActionLog[];
}

export const browserControlMessage: ModelMessage = {
  role: "system",
  content: [
    "You can control the local headless browser when useful.",
    "To request browser control, reply with only one JSON object and no prose:",
    '{"browser_action":"open","url":"https://example.com"}',
    '{"browser_action":"snapshot"}',
    '{"browser_action":"back"}',
    '{"browser_action":"forward"}',
    '{"browser_action":"reload"}',
    '{"browser_action":"click","selector":"text=Example"}',
    '{"browser_action":"type","selector":"input[name=\\"q\\"]","text":"query"}',
    "Use selectors from the controlled browser elements list when possible.",
    "Do not submit forms, purchases, deletes, auth, permissions, or sensitive data unless the user explicitly asks.",
    "When you have enough browser context, answer normally.",
  ].join("\n"),
};

export function browserContextMessage(context: BrowserContext): ModelMessage | null {
  if (typeof context.query !== "string" || typeof context.url !== "string") return null;
  return {
    role: "system",
    content: [
      "Active browser preview context:",
      `Search query: ${context.query}`,
      `Page URL: ${context.url}`,
      typeof context.previewUrl === "string" ? `Preview URL: ${context.previewUrl}` : "",
      "You can use this as browser/search context, but do not claim you can see page contents unless the user pasted them.",
    ].filter(Boolean).join("\n"),
  };
}

export function cleanBrowserState(value: unknown): BrowserUseState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const elements = Array.isArray(raw.elements)
    ? raw.elements.slice(0, 40).map((item) => {
      const element = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        tag: typeof element.tag === "string" ? element.tag.slice(0, 40) : "",
        label: typeof element.label === "string" ? element.label.slice(0, 120) : "",
        selector: typeof element.selector === "string" ? element.selector.slice(0, 240) : "",
      };
    }).filter((element) => element.selector)
    : [];
  return {
    url: typeof raw.url === "string" ? raw.url.slice(0, 1000) : "",
    title: typeof raw.title === "string" ? raw.title.slice(0, 300) : "",
    text: typeof raw.text === "string" ? raw.text.slice(0, 4000) : "",
    screenshot: typeof raw.screenshot === "string" ? raw.screenshot : "",
    elements,
  };
}

export function browserStateMessage(state: BrowserUseState | null): ModelMessage | null {
  if (!state) return null;
  const elements = state.elements.slice(0, 25).map((element, index) => (
    `${index + 1}. ${element.tag || "element"} "${element.label || "(no label)"}" selector=${element.selector}`
  )).join("\n");
  return {
    role: "system",
    content: [
      "Controlled browser state:",
      `URL: ${state.url || "about:blank"}`,
      `Title: ${state.title || "(none)"}`,
      "Visible text:",
      state.text || "(none)",
      elements ? `Elements:\n${elements}` : "Elements: none",
    ].join("\n"),
  };
}

function parseBrowserAction(content: string): BrowserAction | null {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim();
  const candidate = fenced || trimmed.match(/\{[\s\S]*\}/)?.[0] || trimmed;
  try {
    const raw = JSON.parse(candidate) as Record<string, unknown>;
    const source = raw.browser_action && typeof raw.browser_action === "object" ? raw.browser_action as Record<string, unknown> : raw;
    const rawAction = source.action || source.browser_action || raw.browser_action;
    const action = rawAction === "navigate" || rawAction === "goto"
      ? "open"
      : rawAction === "fill" || rawAction === "input"
        ? "type"
        : rawAction;
    if (action !== "open" && action !== "snapshot" && action !== "click" && action !== "type" && action !== "back" && action !== "forward" && action !== "reload") return null;
    const selector = typeof source.selector === "string"
      ? source.selector
      : typeof source.target === "string"
        ? source.target
        : typeof source.label === "string"
          ? `text=${source.label}`
          : undefined;
    return {
      action,
      url: typeof source.url === "string" ? source.url : undefined,
      selector,
      text: typeof source.text === "string" ? source.text : typeof source.value === "string" ? source.value : "",
    };
  } catch {
    return null;
  }
}

function safeBrowserUrl(value: string | undefined) {
  let url = value?.trim();
  if (!url) throw new Error("Browser open requires a URL.");
  if (url === "about:blank") return url;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    url = /^(localhost|127\.0\.0\.1|\[::1\])/i.test(url) ? `http://${url}` : `https://${url}`;
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Browser open only allows http/https URLs.");
  return parsed.href;
}

function safeSelector(value: string | undefined) {
  const selector = value?.trim();
  if (!selector) throw new Error("Browser action requires a selector.");
  if (selector.length > 500) throw new Error("Browser selector is too long.");
  return selector;
}

async function runBrowserAction(command: BrowserAction) {
  if (command.action === "open") return controlledBrowser.goto(safeBrowserUrl(command.url));
  if (command.action === "snapshot") return controlledBrowser.snapshot();
  if (command.action === "back") return controlledBrowser.back();
  if (command.action === "forward") return controlledBrowser.forward();
  if (command.action === "reload") return controlledBrowser.reload();
  if (command.action === "click") return controlledBrowser.click(safeSelector(command.selector));
  return controlledBrowser.type(safeSelector(command.selector), command.text || "");
}

function actionLabel(command: BrowserAction) {
  if (command.action === "open") return `open ${command.url}`;
  if (command.action === "snapshot") return "snapshot";
  if (command.action === "back" || command.action === "forward" || command.action === "reload") return command.action;
  return `${command.action} ${command.selector}`;
}

function browserActionLog(command: BrowserAction, state: BrowserUseState | null, error?: string): BrowserActionLog {
  return {
    action: command.action,
    status: error ? "failed" : "ok",
    url: state?.url || command.url,
    selector: command.selector,
    title: state?.title,
    error,
  };
}

function browserResultMessage(command: BrowserAction, state: BrowserUseState | null, error?: string): ModelMessage {
  return {
    role: "system",
    content: [
      `Browser action result: ${actionLabel(command)}`,
      error ? `Error: ${error}` : "Status: ok",
      state ? browserStateMessage(state)?.content : "",
      "Now continue. Use another browser_action JSON object only if another browser step is required; otherwise answer the user normally.",
    ].filter(Boolean).join("\n"),
  };
}

export async function runBrowserAgentLoop({
  messages,
  initialState,
  complete,
  maxActions = 4,
}: {
  messages: ModelMessage[];
  initialState: BrowserUseState | null;
  complete: (messages: ModelMessage[]) => Promise<string>;
  maxActions?: number;
}): Promise<BrowserAgentResult> {
  let content = "";
  let browserState = initialState;
  const browserActions: BrowserActionLog[] = [];

  for (let step = 0; step < maxActions; step += 1) {
    content = await complete(messages);
    const command = parseBrowserAction(content);
    if (!command) break;
    messages.push({ role: "assistant", content });
    try {
      browserState = cleanBrowserState(await runBrowserAction(command));
      browserActions.push(browserActionLog(command, browserState));
      messages.push(browserResultMessage(command, browserState));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Browser action failed";
      browserActions.push(browserActionLog(command, browserState, message));
      messages.push(browserResultMessage(command, browserState, message));
    }

    if (step === maxActions - 1) {
      messages.push({ role: "system", content: "Browser action limit reached. Answer the user with the current browser state." });
      content = await complete(messages);
    }
  }

  return { content, browserState, browserActions };
}
