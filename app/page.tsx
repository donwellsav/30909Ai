"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Bot,
  Boxes,
  Camera,
  CheckCircle2,
  Cpu,
  ExternalLink,
  Gauge,
  HardDrive,
  History,
  MessageSquare,
  Power,
  RefreshCw,
  Save,
  Search,
  SquareTerminal,
  Send,
  Workflow,
  XCircle,
} from "lucide-react";
import { Panel as SplitPanel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import type { BrowserActionLog, BrowserUseState } from "@/lib/browser-types";

interface AppSettings {
  projectRoot: string;
  appRoot: string;
  clubRepo: string;
  modelDir: string;
  wslDistro: string;
  endpoint: string;
  model: string;
  providerId: string;
  providerName: string;
  apiKey: string;
  storageBudgetGb: number;
  browser: string;
  searchEngine: string;
  weightProfile: "iq4ks" | "gguf" | "autoround";
  launchVariant: string;
  port: number;
  contextTokens: number;
  batchSize: number;
  ubatchSize: number;
  gpuMemoryUtilization: number;
  reasoning: "off" | "on";
  reasoningFormat: "none" | "deepseek" | "auto";
  temperature: number;
  topP: number;
  topK: number;
  minP: number;
  repeatPenalty: number;
  maxTokens: number;
  seed: number;
  thinkingEnabled: boolean;
}

interface JobRecord {
  id: string;
  action: string;
  label: string;
  commandLabel: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  exitCode?: number | null;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

interface SearchRecord {
  id: string;
  query: string;
  url: string;
  createdAt: string;
}

interface BrowserContext {
  query: string;
  url: string;
  previewUrl: string;
  controlledBrowser?: Omit<BrowserUseState, "screenshot">;
}

interface ModelFile {
  label: string;
  present: boolean;
  path: string;
  sizeGb: number;
}

interface StatusPayload {
  settings: AppSettings;
  host: { platform: string; release: string; hostname: string; cpus: number; memoryGb: number };
  gpu: { ok: boolean; rows: string[]; error?: string };
  wsl: { ok: boolean; list: string; tools: string[]; repoPath: string; modelPath: string };
  docker: { ok: boolean; summary: string; containers: string[]; disk: string };
  repo: { ok: boolean; status: string; head: string };
  storage: { disk: { UsedGB?: number; FreeGB?: number } | null; budgetGb: number; models: ModelFile[] };
  endpoint: { ok: boolean; url: string; status?: number; error?: string; models: string[] };
}

interface ScanResult {
  port: number;
  baseUrl: string;
  ok: boolean;
  status?: number;
  latencyMs: number;
  models: string[];
  error?: string;
}

interface ScanPayload {
  scannedAt: string;
  durationMs: number;
  ports: number[];
  dockerPorts: number[];
  results: ScanResult[];
}

interface ProbePayload {
  testedAt: string;
  baseUrl: string;
  model: string;
  totalMs: number;
  models: { ok: boolean; status: number; latencyMs: number; count: number; ids: string[] };
  chat: {
    ok: boolean;
    status: number;
    latencyMs: number;
    content: string;
    usage?: { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null };
    completionTokensPerSecond?: number | null;
  };
}

interface JobsPayload {
  actions: { action: string; label: string }[];
  jobs: JobRecord[];
}

interface FlowNodeData extends Record<string, unknown> {
  title: string;
  detail: string;
  state: string;
}

const tabs = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "telemetry", label: "Telemetry", icon: Activity },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "canvas", label: "Canvas", icon: Workflow },
  { id: "logs", label: "Logs", icon: SquareTerminal },
] as const;

type TabId = (typeof tabs)[number]["id"];
type SelectOption = { value: string; label: string; description?: string };
type SnippetId = "env" | "opencode" | "pi" | "json";
type Tone = "neutral" | "good" | "warn" | "bad";

const launchVariantOptions: SelectOption[] = [
  { value: "ik-llama/iq4ks-mtp", label: "ik-llama IQ4_KS MTP", description: "Fast 200K single-card profile." },
  { value: "llamacpp/default", label: "llama.cpp Q4_K_M", description: "Stable fallback on one RTX 3090." },
  { value: "vllm/minimal", label: "vLLM minimal", description: "Short-context vLLM sanity path." },
  { value: "ik-llama/iq4ks-mtp-vision", label: "ik-llama vision", description: "Vision profile with lower context." },
  { value: "llamacpp/mtp", label: "llama.cpp MTP", description: "Experimental MTP path." },
];

const weightProfileOptions: SelectOption[] = [
  { value: "iq4ks", label: "IQ4_KS", description: "Recommended ik-llama weights." },
  { value: "gguf", label: "GGUF Q4_K_M", description: "llama.cpp fallback weights." },
  { value: "autoround", label: "AutoRound INT4", description: "vLLM-oriented quantized weights." },
];

const reasoningOptions: SelectOption[] = [
  { value: "off", label: "Off" },
  { value: "on", label: "On" },
];

const reasoningFormatOptions: SelectOption[] = [
  { value: "deepseek", label: "DeepSeek parser" },
  { value: "auto", label: "Auto" },
  { value: "none", label: "None" },
];

const snippetOptions: SelectOption[] = [
  { value: "opencode", label: "OpenCode config" },
  { value: "pi", label: "Pi provider" },
  { value: "env", label: "OpenAI env" },
  { value: "json", label: "Generic JSON" },
];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(json.error || response.statusText));
  }
  return json as T;
}

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function toneTextClass(tone: Tone) {
  return cx(
    tone === "good" && "text-emerald-300",
    tone === "warn" && "text-amber-300",
    tone === "bad" && "text-rose-300",
    tone === "neutral" && "text-workflow-text"
  );
}

function toneFillClass(tone: Tone) {
  return cx(
    tone === "good" && "bg-emerald-400",
    tone === "warn" && "bg-amber-400",
    tone === "bad" && "bg-rose-400",
    tone === "neutral" && "bg-sky-400"
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return <span className={cx("h-2 w-2 rounded-full", ok ? "bg-emerald-400" : "bg-rose-400")} />;
}

function parseGpuRow(row?: string) {
  if (!row) return null;
  const [name, driver, total, used, free, utilization, temp, power] = row.split(",").map((part) => part.trim());
  return {
    name,
    driver,
    totalMb: Number(total),
    usedMb: Number(used),
    freeMb: Number(free),
    utilization: Number(utilization),
    temp: Number(temp),
    power: Number(power),
  };
}

function mbToGb(value: number) {
  return Number.isFinite(value) ? `${(value / 1024).toFixed(1)} GB` : "?";
}

function compactText(value: string, max = 80) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function formatTokens(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString() : "unavailable";
}

function formatTokenRate(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toLocaleString()} tok/s` : "unavailable";
}

function framePreviewUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("google.") && parsed.pathname === "/search") parsed.searchParams.set("igu", "1");
    return parsed.toString();
  } catch {
    return url;
  }
}

function browserContextForSearch(search?: SearchRecord): BrowserContext | null {
  return search ? { query: search.query, url: search.url, previewUrl: framePreviewUrl(search.url) } : null;
}

function formatPercent(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "unavailable";
  if (value > 0 && value < 0.1) return "<0.1%";
  return `${value.toFixed(value < 10 ? 1 : 0)}%`;
}

function fallbackCopy(value: string) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, value.length);
  const ok = document.execCommand("copy");
  textarea.remove();
  return ok;
}

function Panel({
  title,
  icon,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx("min-h-[10rem] min-w-0 overflow-hidden rounded-md border border-workflow-border bg-workflow-surface", className)}>
      <div className="flex items-center gap-2 border-b border-workflow-border px-3 py-2">
        <div className="text-workflow-text-muted">{icon}</div>
        <h2 className="font-mono text-xs font-semibold uppercase tracking-wide text-workflow-text">{title}</h2>
      </div>
      <div className={cx("min-h-0 p-3", bodyClassName)}>{children}</div>
    </section>
  );
}

function SplitHandle({ direction = "horizontal" }: { direction?: "horizontal" | "vertical" }) {
  const vertical = direction === "vertical";

  return (
    <PanelResizeHandle
      className={cx(
        "group relative z-10 shrink-0 rounded-sm bg-workflow-border/70 outline-none transition hover:bg-emerald-400/70 focus-visible:ring-1 focus-visible:ring-emerald-300",
        vertical ? "h-2 cursor-row-resize" : "w-2 cursor-col-resize"
      )}
    >
      <span
        className={cx(
          "absolute left-1/2 top-1/2 rounded-full bg-workflow-text-subtle/60 transition group-hover:bg-black/70",
          vertical ? "h-px w-10 -translate-x-1/2 -translate-y-1/2" : "h-10 w-px -translate-x-1/2 -translate-y-1/2"
        )}
      />
    </PanelResizeHandle>
  );
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="min-h-[3.25rem] min-w-[7rem] rounded-md border border-workflow-border bg-workflow-node-input px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-workflow-text-subtle">{label}</div>
      <div className={cx("mt-0.5 truncate font-mono text-xs", toneTextClass(tone))}>
        {value}
      </div>
    </div>
  );
}

function FlowNode({ data, selected }: NodeProps<Node<FlowNodeData>>) {
  const ok = data.state === "ready";
  const warn = data.state === "attention";
  return (
    <div className={cx("min-w-[220px] rounded-lg border-2 bg-workflow-node-bg shadow-lg transition", selected ? "border-emerald-400/80" : "border-zinc-500/50")}>
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !bg-zinc-500" />
      <div className="border-b border-workflow-border px-3 py-2">
        <div className="flex items-center gap-2">
          <StatusDot ok={ok} />
          <span className="font-mono text-sm font-semibold text-workflow-text">{data.title}</span>
        </div>
      </div>
      <div className="px-3 py-2 text-xs leading-5 text-workflow-text-muted">{data.detail}</div>
      <div className={cx("px-3 pb-3 text-[11px] uppercase tracking-wide", ok && "text-emerald-300", warn && "text-amber-300", !ok && !warn && "text-zinc-400")}>
        {data.state}
      </div>
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !bg-zinc-500" />
    </div>
  );
}

const flowNodeTypes: NodeTypes = { control: FlowNode };
const flowFitViewOptions = { padding: 0.2 };

export default function Page() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [jobsPayload, setJobsPayload] = useState<JobsPayload>({ actions: [], jobs: [] });
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [searches, setSearches] = useState<SearchRecord[]>([]);
  const [selectedJob, setSelectedJob] = useState<string>("");
  const [selectedCanvasNodeId, setSelectedCanvasNodeId] = useState("models");
  const [selectedSearchId, setSelectedSearchId] = useState("");
  const [jobLog, setJobLog] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [browserUse, setBrowserUse] = useState<BrowserUseState | null>(null);
  const [browserActions, setBrowserActions] = useState<BrowserActionLog[]>([]);
  const [browserUseUrl, setBrowserUseUrl] = useState("");
  const [browserUseSelector, setBrowserUseSelector] = useState("");
  const [browserUseText, setBrowserUseText] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [selectedSnippet, setSelectedSnippet] = useState<SnippetId>("opencode");
  const [scanPayload, setScanPayload] = useState<ScanPayload | null>(null);
  const [scanInput, setScanInput] = useState("8020, 8000, 8080, 11434, 1234");
  const [probePayload, setProbePayload] = useState<ProbePayload | null>(null);

  const latestJob = jobsPayload.jobs[0];
  const activeJob = jobsPayload.jobs.find((job) => job.status === "running");
  const selectedVariant = settings ? launchVariantOptions.find((option) => option.value === settings.launchVariant) : undefined;
  const selectedWeights = settings ? weightProfileOptions.find((option) => option.value === settings.weightProfile) : undefined;
  const clientBaseUrl = settings?.endpoint.replace(/\/$/, "") || "";
  const clientModelId = settings?.model || status?.endpoint.models[0] || "MODEL_ID_FROM_/v1/models";
  const clientApiKey = settings?.apiKey || "local";
  const modelsUrl = clientBaseUrl ? `${clientBaseUrl}/models` : "";
  const envSnippet = settings
    ? `OPENAI_BASE_URL=${clientBaseUrl}\nOPENAI_API_KEY=${clientApiKey}\nOPENAI_MODEL=${clientModelId}`
    : "";
  const connectionJson = settings
    ? JSON.stringify(
        {
          providerId: settings.providerId,
          name: settings.providerName,
          baseURL: clientBaseUrl,
          apiKey: clientApiKey,
          model: clientModelId,
          modelsURL: modelsUrl,
        },
        null,
        2
      )
    : "";
  const openCodeConfig = settings
    ? JSON.stringify(
        {
          $schema: "https://opencode.ai/config.json",
          provider: {
            [settings.providerId]: {
              npm: "@ai-sdk/openai-compatible",
              name: settings.providerName,
              options: { baseURL: clientBaseUrl, apiKey: clientApiKey },
              models: {
                [clientModelId]: {
                  name: clientModelId,
                  limit: { context: settings.contextTokens, output: settings.maxTokens },
                },
              },
            },
          },
          model: `${settings.providerId}/${clientModelId}`,
          small_model: `${settings.providerId}/${clientModelId}`,
        },
        null,
        2
      )
    : "";
  const piProviderSnippet = settings
    ? `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";\n\nexport default function (pi: ExtensionAPI) {\n  pi.registerProvider(${JSON.stringify(settings.providerId)}, {\n    name: ${JSON.stringify(settings.providerName)},\n    baseUrl: ${JSON.stringify(clientBaseUrl)},\n    apiKey: ${JSON.stringify(clientApiKey)},\n    api: "openai-completions",\n    models: [\n      {\n        id: ${JSON.stringify(clientModelId)},\n        name: ${JSON.stringify(clientModelId)},\n        reasoning: ${settings.reasoning === "on"},\n        input: ["text"],\n        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },\n        contextWindow: ${settings.contextTokens},\n        maxTokens: ${settings.maxTokens},\n      },\n    ],\n  });\n}`
    : "";
  const snippets: Record<SnippetId, { title: string; value: string }> = {
    env: { title: "OpenAI env", value: envSnippet },
    opencode: { title: "OpenCode config", value: openCodeConfig },
    pi: { title: "Pi provider", value: piProviderSnippet },
    json: { title: "Generic JSON", value: connectionJson },
  };
  const activeSnippet = snippets[selectedSnippet];
  const gpuSummary = parseGpuRow(status?.gpu.rows[0]);
  const modelSizeGb = status?.storage.models.reduce((sum, model) => sum + model.sizeGb, 0) ?? 0;
  const budgetRemainingGb = settings ? settings.storageBudgetGb - modelSizeGb : 0;
  const toolOkCount = status?.wsl.tools.filter((tool) => tool.startsWith("OK:")).length ?? 0;
  const totalToolCount = status?.wsl.tools.length ?? 0;
  const missingTools = status?.wsl.tools.filter((tool) => !tool.startsWith("OK:")) ?? [];
  const runningContainer = status?.docker.containers[0]?.split("|")[0] || "none";
  const foundScanResults = scanPayload?.results.filter((result) => result.ok) ?? [];
  const bestScanResult = foundScanResults[0];
  const selectedSearch = searches.find((search) => search.id === selectedSearchId) || searches[0];
  const activeBrowserContext = browserContextForSearch(selectedSearch);
  const browserPreviewUrl = activeBrowserContext?.previewUrl || "";
  const probeOk = Boolean(probePayload?.models.ok && probePayload.chat.ok);
  const vramPercent = gpuSummary?.totalMb ? Math.min(100, Math.max(0, Math.round((gpuSummary.usedMb / gpuSummary.totalMb) * 100))) : 0;
  const storageBudgetGb = settings?.storageBudgetGb || status?.storage.budgetGb || 0;
  const modelBudgetPercent = storageBudgetGb ? Math.min(100, Math.max(0, Math.round((modelSizeGb / storageBudgetGb) * 100))) : 0;
  const servedModelId = status?.endpoint.models[0] || clientModelId;
  const modelFingerprint = `${settings?.launchVariant || ""} ${settings?.weightProfile || ""} ${servedModelId}`.toLowerCase();
  const modelRuntime = modelFingerprint.includes("vllm")
    ? "vLLM"
    : modelFingerprint.includes("llama") || modelFingerprint.includes("gguf") || modelFingerprint.includes("iq4")
      ? "llama.cpp / ik-llama"
      : "OpenAI-compatible";
  const modelQuant = modelFingerprint.includes("iq4")
    ? "IQ4_KS"
    : modelFingerprint.includes("q4")
      ? "Q4"
      : modelFingerprint.includes("autoround") || modelFingerprint.includes("int4")
        ? "AutoRound INT4"
        : settings?.weightProfile || "unknown";
  const probeUsage = probePayload?.chat.usage;
  const contextWindow = settings?.contextTokens || status?.settings.contextTokens || 0;
  const contextUsedPercent = probeUsage?.totalTokens && contextWindow ? (probeUsage.totalTokens / contextWindow) * 100 : null;

  async function refreshAll() {
    const settingsData = await api<{ settings: AppSettings }>("/api/settings");
    setSettings(settingsData.settings);

    const [statusResult, jobsResult, chatResult, searchResult] = await Promise.allSettled([
      api<StatusPayload>("/api/status"),
      api<JobsPayload>("/api/jobs"),
      api<{ messages: ChatMessage[] }>("/api/chat"),
      api<{ searches: SearchRecord[] }>("/api/search"),
    ]);

    if (statusResult.status === "fulfilled") setStatus(statusResult.value);
    if (jobsResult.status === "fulfilled") {
      setJobsPayload(jobsResult.value);
      if (!selectedJob && jobsResult.value.jobs[0]) setSelectedJob(jobsResult.value.jobs[0].id);
    }
    if (chatResult.status === "fulfilled") setMessages(chatResult.value.messages);
    if (searchResult.status === "fulfilled") setSearches(searchResult.value.searches);
  }

  useEffect(() => {
    refreshAll().catch((err: Error) => setError(err.message));
    const id = window.setInterval(() => {
      refreshAll().catch(() => undefined);
    }, 8000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedJob) {
      setJobLog("");
      return;
    }

    let cancelled = false;
    const load = () => {
      api<{ log: string }>(`/api/jobs?log=${selectedJob}`)
        .then((data) => {
          if (!cancelled) setJobLog(data.log);
        })
        .catch(() => {
          if (!cancelled) setJobLog("");
        });
    };
    load();
    const id = window.setInterval(load, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [selectedJob]);

  async function startAction(action: string) {
    setError("");
    setBusy(action);
    try {
      await api("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await refreshAll();
      setActiveTab("logs");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy("");
    }
  }

  function updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings((current) => {
      if (!current) return current;
      const next = { ...current, [key]: value };
      if (key === "port" && typeof value === "number" && /^https?:\/\/(localhost|127\.0\.0\.1):\d+\/v1\/?$/.test(current.endpoint)) {
        next.endpoint = current.endpoint.replace(/:\d+\/v1\/?$/, `:${value}/v1`);
      }
      return next;
    });
  }

  async function persistSettings() {
    if (!settings) return null;
    const response = await api<{ settings: AppSettings }>("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    setSettings(response.settings);
    return response.settings;
  }

  async function saveSettings() {
    if (!settings) return;
    setError("");
    setBusy("settings");
    try {
      await persistSettings();
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy("");
    }
  }

  async function scanLocalPorts() {
    setError("");
    setBusy("scan");
    try {
      const response = await api<ScanPayload>("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ports: settings ? [settings.port] : [], scanText: scanInput }),
      });
      setScanPayload(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setBusy("");
    }
  }

  async function probeEndpoint() {
    if (!settings) return;
    setError("");
    setBusy("probe");
    try {
      const response = await api<ProbePayload>("/api/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: clientBaseUrl, model: clientModelId, apiKey: clientApiKey }),
      });
      setProbePayload(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Probe failed");
    } finally {
      setBusy("");
    }
  }

  async function applyScanResult(result: ScanResult) {
    if (!settings) return;
    const next = {
      ...settings,
      endpoint: result.baseUrl,
      port: result.port,
      model: result.models[0] || settings.model,
    };
    setError("");
    setSettings(next);
    setBusy("settings");
    try {
      const response = await api<{ settings: AppSettings }>("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      setSettings(response.settings);
      setProbePayload(null);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apply failed");
    } finally {
      setBusy("");
    }
  }

  async function copyText(label: string, value: string) {
    setError("");
    try {
      try {
        await Promise.race([
          navigator.clipboard.writeText(value),
          new Promise((_, reject) => window.setTimeout(() => reject(new Error("clipboard timeout")), 500)),
        ]);
      } catch {
        if (!fallbackCopy(value)) throw new Error("Copy failed");
      }
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1500);
    } catch {
      setError("Clipboard blocked. Click a field and press Ctrl+C.");
    }
  }

  async function saveAndStart(action: string) {
    if (!settings) return;
    setError("");
    setBusy(action);
    try {
      await persistSettings();
      await api("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await refreshAll();
      setActiveTab("logs");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy("");
    }
  }

  async function sendChat() {
    if (!chatInput.trim()) return;
    const content = chatInput.trim();
    const controlledBrowser = browserUse ? {
      url: browserUse.url,
      title: browserUse.title,
      text: browserUse.text,
      elements: browserUse.elements,
    } : undefined;
    const browserContext = {
      ...(activeBrowserContext || {}),
      ...(controlledBrowser ? { controlledBrowser } : {}),
    };
    setChatInput("");
    setError("");
    setBusy("chat");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, browserContext }),
      });
      const json = await response.json().catch(() => ({})) as { messages?: ChatMessage[]; error?: string; browserState?: BrowserUseState; browserActions?: BrowserActionLog[] };
      if (json.messages) setMessages(json.messages);
      if (json.browserActions) setBrowserActions(json.browserActions);
      if (json.browserState) {
        setBrowserUse(json.browserState);
        setBrowserUseUrl(json.browserState.url);
      }
      if (!response.ok) throw new Error(json.error || response.statusText);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chat failed");
    } finally {
      setBusy("");
    }
  }

  async function clearChat() {
    setError("");
    const response = await api<{ messages: ChatMessage[] }>("/api/chat", { method: "DELETE" });
    setMessages(response.messages);
    setBrowserActions([]);
  }

  async function runSearch() {
    if (!searchInput.trim()) return;
    setError("");
    setBusy("search");
    try {
      const response = await api<{ search: SearchRecord; opened: boolean; previewOnly?: boolean; error?: string }>("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchInput.trim(), openBrowser: false }),
      });
      setSearches([response.search, ...searches]);
      setSelectedSearchId(response.search.id);
      setSearchInput("");
      if (!response.opened && !response.previewOnly) setError(response.error || "Browser did not open");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setBusy("");
    }
  }

  async function clearSearches() {
    setError("");
    const response = await api<{ searches: SearchRecord[] }>("/api/search", { method: "DELETE" });
    setSearches(response.searches);
    setSelectedSearchId("");
  }

  function useSearchInChat(search?: SearchRecord) {
    if (!search) return;
    const prompt = `Use this browser preview as context.\nSearch query: ${search.query}\nPreview URL: ${search.url}\n\nHelp me inspect the results, compare sources, and decide what to open next.`;
    setChatInput((current) => current.trim() ? `${current.trim()}\n\n${prompt}` : prompt);
  }

  async function runBrowserUse(action: "open" | "snapshot" | "click" | "type" | "back" | "forward" | "reload") {
    setError("");
    setBusy(`browser-${action}`);
    try {
      const response = await api<{ state: BrowserUseState }>("/api/browser-use", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          url: browserUseUrl.trim() || selectedSearch?.url || "about:blank",
          selector: browserUseSelector,
          text: browserUseText,
        }),
      });
      setBrowserUse(response.state);
      setBrowserUseUrl(response.state.url);
      setBrowserActions([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Browser action failed");
    } finally {
      setBusy("");
    }
  }

  function useBrowserUseInChat() {
    if (!browserUse) return;
    const prompt = `Use this controlled browser state as context.\nURL: ${browserUse.url}\nTitle: ${browserUse.title}\nVisible text:\n${browserUse.text.slice(0, 2000)}`;
    setChatInput((current) => current.trim() ? `${current.trim()}\n\n${prompt}` : prompt);
  }

  function exportChatMarkdown() {
    const markdown = messages
      .map((message) => `## ${message.role}\n\n${message.content}`)
      .join("\n\n");
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "3090Ai-chat.md";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const flowNodes: Node<FlowNodeData>[] = useMemo(() => {
    const modelReady = status?.storage.models.some((model) => model.present) ?? false;
    return [
      { id: "settings", type: "control", position: { x: 0, y: 90 }, data: { title: "Settings", detail: settings?.modelDir || "Model path", state: settings ? "ready" : "attention" } },
      { id: "docker", type: "control", position: { x: 290, y: 0 }, data: { title: "Docker", detail: status?.docker.summary || "Docker Desktop / WSL integration", state: status?.docker.ok ? "ready" : "attention" } },
      { id: "models", type: "control", position: { x: 290, y: 180 }, data: { title: "Models", detail: modelReady ? "At least one model file is present" : "Download a model first", state: modelReady ? "ready" : "attention" } },
      { id: "launch", type: "control", position: { x: 580, y: 90 }, data: { title: "Launch", detail: activeJob ? activeJob.label : "Start ik-llama or llama.cpp", state: activeJob ? "running" : "ready" } },
      { id: "endpoint", type: "control", position: { x: 870, y: 90 }, data: { title: "API", detail: status?.endpoint.models[0] || status?.settings.endpoint || "Local endpoint", state: status?.endpoint.ok ? "ready" : "attention" } },
    ];
  }, [activeJob, settings, status]);

  const flowEdges: Edge[] = [
    { id: "e1", source: "settings", target: "models", animated: true },
    { id: "e2", source: "settings", target: "docker", animated: true },
    { id: "e3", source: "models", target: "launch", animated: true },
    { id: "e4", source: "docker", target: "launch", animated: true },
    { id: "e5", source: "launch", target: "endpoint", animated: true },
  ];
  const selectedCanvasNode = flowNodes.find((node) => node.id === selectedCanvasNodeId) || flowNodes[0];
  const canvasActions: Record<string, { label: string; run: () => void; danger?: boolean }[]> = {
    settings: [{ label: "Open overview", run: () => setActiveTab("overview") }],
    docker: [{ label: "Run preflight doctor", run: () => void startAction("doctor") }],
    models: [
      { label: "Download selected weights", run: () => void saveAndStart("setup-selected") },
      { label: "Download IQ4_KS", run: () => void startAction("setup-iq4ks") },
      { label: "Download Q4_K_M", run: () => void startAction("setup-llamacpp") },
      { label: "List variants", run: () => void startAction("variants") },
    ],
    launch: [
      { label: "Launch selected profile", run: () => void saveAndStart("launch-selected") },
      { label: "Launch ik-llama", run: () => void startAction("launch-iq4ks") },
      { label: "Launch llama.cpp", run: () => void startAction("launch-llamacpp") },
      { label: "Stop models", run: () => void startAction("stop"), danger: true },
    ],
    endpoint: [
      { label: "Run verify", run: () => void startAction("verify") },
      { label: "Open chat", run: () => setActiveTab("chat") },
    ],
  };

  return (
    <div className="app-stage">
      <main className="app-shell flex flex-col overflow-hidden bg-workflow-bg text-workflow-text">
      <header className="flex min-h-12 shrink-0 flex-col items-stretch gap-2 border-b border-workflow-border px-3 py-2 md:h-12 md:flex-row md:items-center md:justify-between md:py-0">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-md border border-emerald-500/40 bg-emerald-500/10">
            <Bot className="h-4 w-4 text-emerald-300" />
          </div>
          <div>
            <h1 className="font-mono text-sm font-semibold tracking-tight">3090Ai</h1>
            <p className="text-[11px] text-workflow-text-muted">Local RTX 3090 control surface</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {error && <div className="w-full truncate rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200 md:max-w-[520px]">{error}</div>}
          <div className="flex h-8 items-center gap-2 rounded-md border border-workflow-border bg-workflow-surface px-3 text-xs text-workflow-text-muted">
            <StatusDot ok={Boolean(status?.endpoint.ok)} />
            <span>{status?.endpoint.ok ? "Endpoint online" : "Endpoint offline"}</span>
          </div>
          <button
            onClick={() => refreshAll().catch((err: Error) => setError(err.message))}
            className="grid h-8 w-8 place-items-center rounded-md border border-workflow-border bg-workflow-surface text-workflow-text-muted hover:text-workflow-text"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </header>

      <PanelGroup direction="horizontal" className="min-h-0 flex-1">
        <SplitPanel defaultSize={9} minSize={7} maxSize={18} className="min-w-[8.5rem]">
        <nav className="h-full border-r border-workflow-border bg-workflow-surface/50 p-2">
          <div className="flex flex-wrap gap-1 lg:block">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cx(
                    "flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-left font-mono text-xs transition lg:w-full",
                    activeTab === tab.id
                      ? "bg-workflow-surface-hover text-workflow-text"
                      : "text-workflow-text-muted hover:bg-workflow-surface-hover hover:text-workflow-text"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>
          <div className="mt-3 hidden rounded-md border border-workflow-border bg-workflow-node-input p-2 text-[11px] text-workflow-text-muted lg:block">
            <div className="mb-1 flex items-center gap-2 font-mono text-workflow-text">
              <History className="h-3.5 w-3.5" />
              Latest job
            </div>
            {latestJob ? (
              <div>
                <div className="truncate">{latestJob.label}</div>
                <div className="mt-1 capitalize text-workflow-text-subtle">{latestJob.status}</div>
              </div>
            ) : (
              <div>No jobs yet</div>
            )}
          </div>
        </nav>
        </SplitPanel>

        <SplitHandle />

        <SplitPanel defaultSize={91} minSize={55} className="min-w-0">
        <section className="flex h-full min-h-0 w-full flex-col overflow-y-auto p-3">
          {activeTab === "overview" && (
            <Panel title="Overview" icon={<Gauge className="h-4 w-4" />}>
              {settings ? (
                <>
                  <section className="rounded-md border border-workflow-border bg-workflow-node-input p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="font-mono text-[10px] font-semibold uppercase tracking-wide text-workflow-text-muted">Client connection</h3>
                      {copied && <span className="font-mono text-[10px] text-emerald-300">Copied {copied}</span>}
                    </div>
                    <div className="grid grid-cols-1 gap-2 xl:grid-cols-3">
                      <ConnectionField label="Base URL" value={settings.endpoint} copyValue={clientBaseUrl} onChange={(value) => updateSetting("endpoint", value)} onCopy={() => void copyText("base URL", clientBaseUrl)} />
                      <ConnectionField label="Model ID" value={settings.model} copyValue={clientModelId} placeholder={clientModelId} onChange={(value) => updateSetting("model", value)} onCopy={() => void copyText("model ID", clientModelId)} />
                      <ConnectionField label="Provider ID" value={settings.providerId} onChange={(value) => updateSetting("providerId", value)} onCopy={() => void copyText("provider ID", settings.providerId)} />
                      <ConnectionField label="Provider name" value={settings.providerName} onChange={(value) => updateSetting("providerName", value)} onCopy={() => void copyText("provider name", settings.providerName)} />
                      <ConnectionField label="API key" value={settings.apiKey} copyValue={clientApiKey} onChange={(value) => updateSetting("apiKey", value)} onCopy={() => void copyText("API key", clientApiKey)} />
                      <ConnectionField label="Models URL" value={modelsUrl} readOnly onCopy={() => void copyText("models URL", modelsUrl)} />
                    </div>
                    <div className="mt-3 rounded-md border border-workflow-border bg-workflow-surface p-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-mono text-[10px] font-semibold uppercase tracking-wide text-workflow-text-muted">Endpoint scan</div>
                        <div className="font-mono text-[10px] text-workflow-text-subtle">loopback only</div>
                      </div>
                      <div className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_8rem_8rem]">
                        <label className="grid min-w-0 grid-cols-[6rem_minmax(0,1fr)] items-center gap-2 rounded-md border border-workflow-border bg-workflow-node-input px-2 py-1.5">
                          <span className="truncate text-[10px] uppercase tracking-wide text-workflow-text-subtle">Ports/ranges</span>
                          <input
                            aria-label="Ports or ranges to scan"
                            value={scanInput}
                            onChange={(event) => setScanInput(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") void scanLocalPorts();
                            }}
                            className="min-h-7 min-w-0 rounded-md border border-workflow-border bg-workflow-surface px-2 font-mono text-xs text-workflow-text outline-none focus:border-emerald-500/60"
                          />
                        </label>
                        <button type="button" onClick={() => void scanLocalPorts()} disabled={busy === "scan"} className="h-10 rounded-md border border-workflow-border bg-workflow-node-input px-2 font-mono text-xs text-workflow-text-muted hover:text-workflow-text disabled:opacity-50">
                          {busy === "scan" ? "Scanning..." : "Scan"}
                        </button>
                        <button type="button" onClick={() => void probeEndpoint()} disabled={busy === "probe"} className="h-10 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 font-mono text-xs text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50">
                          {busy === "probe" ? "Testing..." : "Test API"}
                        </button>
                      </div>
                      <div className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-3">
                        <SummaryRow label="Current" value={status?.endpoint.ok ? `${settings.port} online` : `${settings.port} offline`} />
                        <SummaryRow label="Best match" value={bestScanResult ? `${bestScanResult.baseUrl} ${bestScanResult.latencyMs}ms` : "none"} />
                        <SummaryRow label="Scanned" value={scanPayload ? `${foundScanResults.length}/${scanPayload.ports.length} found in ${scanPayload.durationMs}ms` : "not run"} />
                        <SummaryRow label="Docker ports" value={scanPayload?.dockerPorts.length ? scanPayload.dockerPorts.join(", ") : "none"} />
                        <SummaryRow label="Models API" value={probePayload ? `${probePayload.models.ok ? "OK" : "fail"} ${probePayload.models.status} ${probePayload.models.latencyMs}ms` : "not run"} />
                        <SummaryRow label="Chat API" value={probePayload ? `${probePayload.chat.ok ? "OK" : "fail"} ${probePayload.chat.status} ${probePayload.chat.latencyMs}ms` : "not run"} />
                        <SummaryRow label="Probe reply" value={probePayload ? compactText(probePayload.chat.content) || "empty" : "not run"} />
                      </div>
                      {scanPayload && (
                        <div className="mt-2 space-y-1">
                          {foundScanResults.length === 0 && (
                            <div className="rounded-md bg-workflow-node-input px-2 py-1.5 text-xs text-workflow-text-muted">No local OpenAI-compatible endpoint found.</div>
                          )}
                          {foundScanResults.slice(0, 6).map((result) => (
                            <div key={result.port} className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-2 rounded-md bg-workflow-node-input px-2 py-1.5 text-xs">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 font-mono text-workflow-text">
                                  <StatusDot ok={result.ok} />
                                  <span className="truncate">{result.baseUrl}</span>
                                  <span className="shrink-0 text-workflow-text-subtle">{result.latencyMs}ms</span>
                                </div>
                                <div className="mt-1 truncate text-workflow-text-muted">{result.models[0] || "no model id"}</div>
                              </div>
                              <button type="button" onClick={() => void applyScanResult(result)} disabled={busy === "settings"} className="h-7 rounded-md border border-emerald-500/40 bg-emerald-500/10 font-mono text-[10px] text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50">
                                Apply
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[17rem_minmax(0,1fr)]">
                      <div className="rounded-md border border-workflow-border bg-workflow-surface p-2">
                        <SelectField label="Preset" value={selectedSnippet} options={snippetOptions} onChange={(value) => setSelectedSnippet(value as SnippetId)} />
                        <div className="mt-2 space-y-1 text-[11px] text-workflow-text-muted">
                          <SummaryRow label="Provider" value={settings.providerId} />
                          <SummaryRow label="Model" value={clientModelId} />
                          <SummaryRow label="API" value="OpenAI-compatible" />
                        </div>
                      </div>
                      <SnippetCard title={activeSnippet.title} value={activeSnippet.value} onCopy={() => void copyText(activeSnippet.title, activeSnippet.value)} />
                    </div>
                  </section>

                  <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
                    <Metric label="GPU" value={status?.gpu.rows[0]?.split(",")[0] || "Unknown"} tone={status?.gpu.ok ? "good" : "bad"} />
                    <Metric label="VRAM" value={gpuSummary ? `${mbToGb(gpuSummary.usedMb)} / ${mbToGb(gpuSummary.totalMb)}` : "?"} tone={gpuSummary && gpuSummary.freeMb < 2048 ? "warn" : "neutral"} />
                    <Metric label="GPU load" value={gpuSummary ? `${gpuSummary.utilization}% / ${gpuSummary.temp}C` : "?"} />
                    <Metric label="Docker" value={status?.docker.ok ? "Running" : "Unavailable"} tone={status?.docker.ok ? "good" : "warn"} />
                    <Metric label="Endpoint" value={status?.endpoint.ok ? status.endpoint.models[0] || "Online" : "Offline"} tone={status?.endpoint.ok ? "good" : "warn"} />
                    <Metric label="Model budget" value={`${modelSizeGb.toFixed(1)} / ${settings.storageBudgetGb} GB`} tone={budgetRemainingGb < 20 ? "warn" : "neutral"} />
                    <Metric label="C free" value={`${status?.storage.disk?.FreeGB ?? "?"} GB`} tone={(status?.storage.disk?.FreeGB ?? 9999) < 50 ? "warn" : "neutral"} />
                    <Metric label="Variant" value={selectedVariant?.label || settings.launchVariant} />
                    <Metric label="Container" value={runningContainer} tone={status?.docker.containers.length ? "good" : "warn"} />
                    <Metric label="Deps" value={`${toolOkCount}/${status?.wsl.tools.length || 0} OK`} tone={toolOkCount === (status?.wsl.tools.length || 0) ? "good" : "warn"} />
                    <Metric label="Weights" value={selectedWeights?.label || settings.weightProfile} />
                    <Metric label="Context" value={`${settings.contextTokens.toLocaleString()} tok`} />
                    <Metric label="Sampling" value={`T ${settings.temperature} / P ${settings.topP}`} />
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 border-y border-workflow-border py-3">
                    <ActionButton label="Save" onClick={() => void saveSettings()} busy={busy === "settings"} />
                    <ActionButton label="Download" onClick={() => void saveAndStart("setup-selected")} busy={busy === "setup-selected"} />
                    <ActionButton label="Launch" onClick={() => void saveAndStart("launch-selected")} busy={busy === "launch-selected"} primary />
                    <ActionButton label="Stop" onClick={() => void startAction("stop")} busy={busy === "stop"} danger />
                    <ActionButton label="Doctor" onClick={() => void startAction("doctor")} busy={busy === "doctor"} />
                    <ActionButton label="Verify" onClick={() => void startAction("verify")} busy={busy === "verify"} />
                    <ActionButton label="Bench" onClick={() => void startAction("bench")} busy={busy === "bench"} />
                    <ActionButton label="Scan ports" onClick={() => void scanLocalPorts()} busy={busy === "scan"} />
                    <ActionButton label="Test API" onClick={() => void probeEndpoint()} busy={busy === "probe"} />
                    <ActionButton label="Variants" onClick={() => void startAction("variants")} busy={busy === "variants"} />
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-2 xl:grid-cols-3">
                    {status?.storage.models.map((model) => (
                      <SummaryRow key={model.label} label={model.label} value={model.present ? `${model.sizeGb} GB` : "missing"} />
                    ))}
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-4">
                    <SettingsGroup title="Runtime">
                      <SelectField label="Launch variant" value={settings.launchVariant} options={launchVariantOptions} onChange={(value) => updateSetting("launchVariant", value)} />
                      <SelectField label="Weights" value={settings.weightProfile} options={weightProfileOptions} onChange={(value) => updateSetting("weightProfile", value as AppSettings["weightProfile"])} />
                      <TextField label="WSL distro" value={settings.wslDistro} onChange={(value) => updateSetting("wslDistro", value)} />
                      <NumberField label="Port" value={settings.port} min={1} max={65535} step={1} onChange={(value) => updateSetting("port", value)} />
                      <SliderField label="GPU memory" value={settings.gpuMemoryUtilization} min={50} max={99} step={1} suffix="%" onChange={(value) => updateSetting("gpuMemoryUtilization", value)} />
                      <SliderField label="Context tokens" value={settings.contextTokens} min={4096} max={262144} step={4096} suffix=" tok" onChange={(value) => updateSetting("contextTokens", value)} />
                      <NumberField label="Batch size" value={settings.batchSize} min={128} max={8192} step={128} onChange={(value) => updateSetting("batchSize", value)} />
                      <NumberField label="uBatch size" value={settings.ubatchSize} min={64} max={4096} step={64} onChange={(value) => updateSetting("ubatchSize", value)} />
                      <SelectField label="Reasoning" value={settings.reasoning} options={reasoningOptions} onChange={(value) => updateSetting("reasoning", value as AppSettings["reasoning"])} />
                      <SelectField label="Reasoning format" value={settings.reasoningFormat} options={reasoningFormatOptions} onChange={(value) => updateSetting("reasoningFormat", value as AppSettings["reasoningFormat"])} />
                      <CheckboxField label="Thinking traces" checked={settings.thinkingEnabled} onChange={(value) => updateSetting("thinkingEnabled", value)} />
                    </SettingsGroup>

                    <SettingsGroup title="Inference">
                      <SliderField label="Temperature" value={settings.temperature} min={0} max={2} step={0.05} onChange={(value) => updateSetting("temperature", value)} />
                      <SliderField label="Top P" value={settings.topP} min={0.01} max={1} step={0.01} onChange={(value) => updateSetting("topP", value)} />
                      <NumberField label="Top K" value={settings.topK} min={0} max={200} step={1} onChange={(value) => updateSetting("topK", value)} />
                      <SliderField label="Min P" value={settings.minP} min={0} max={1} step={0.01} onChange={(value) => updateSetting("minP", value)} />
                      <SliderField label="Repeat penalty" value={settings.repeatPenalty} min={0.8} max={2} step={0.01} onChange={(value) => updateSetting("repeatPenalty", value)} />
                      <NumberField label="Max output tokens" value={settings.maxTokens} min={64} max={8192} step={64} onChange={(value) => updateSetting("maxTokens", value)} />
                      <NumberField label="Seed (-1 random)" value={settings.seed} min={-1} max={2147483647} step={1} onChange={(value) => updateSetting("seed", value)} />
                    </SettingsGroup>

                    <SettingsGroup title="Paths">
                      <TextField label="Project root" value={settings.projectRoot} onChange={(value) => updateSetting("projectRoot", value)} />
                      <TextField label="3090Ai app root" value={settings.appRoot} onChange={(value) => updateSetting("appRoot", value)} />
                      <TextField label="club-3090 repo" value={settings.clubRepo} onChange={(value) => updateSetting("clubRepo", value)} />
                      <TextField label="Model directory" value={settings.modelDir} onChange={(value) => updateSetting("modelDir", value)} />
                      <NumberField label="Storage budget GB" value={settings.storageBudgetGb} min={1} max={2000} step={1} onChange={(value) => updateSetting("storageBudgetGb", value)} />
                    </SettingsGroup>

                    <SettingsGroup title="Browser">
                      <TextField label="Chromium command" value={settings.browser} onChange={(value) => updateSetting("browser", value)} />
                      <TextField label="Search URL prefix" value={settings.searchEngine} onChange={(value) => updateSetting("searchEngine", value)} />
                    </SettingsGroup>
                  </div>
                </>
              ) : (
                <div className="rounded-md border border-workflow-border bg-workflow-node-input px-3 py-2 text-sm text-workflow-text-muted">Loading settings...</div>
              )}
            </Panel>
          )}

          {activeTab === "telemetry" && (
            <div className="space-y-3">
              <section className="min-h-[14rem] min-w-0 overflow-hidden rounded-md border border-workflow-border bg-workflow-surface">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-workflow-border px-3 py-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Activity className="h-4 w-4 text-workflow-text-muted" />
                    <h2 className="font-mono text-xs font-semibold uppercase tracking-wide text-workflow-text">Telemetry console</h2>
                    <span className={cx("inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[10px]", status?.endpoint.ok ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-amber-500/40 bg-amber-500/10 text-amber-200")}>
                      <StatusDot ok={Boolean(status?.endpoint.ok)} />
                      {status?.endpoint.ok ? "endpoint online" : "endpoint offline"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <ActionButton label="Refresh" onClick={() => refreshAll().catch((err: Error) => setError(err.message))} />
                    <ActionButton label="Scan ports" onClick={() => void scanLocalPorts()} busy={busy === "scan"} />
                    <ActionButton label="Test API" onClick={() => void probeEndpoint()} busy={busy === "probe"} primary />
                  </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3">
                  <TelemetryLine label="Base URL" value={clientBaseUrl || status?.endpoint.url || "not configured"} detail={status?.endpoint.status ? `HTTP ${status.endpoint.status}` : status?.endpoint.error || "OpenAI-compatible /v1"} tone={status?.endpoint.ok ? "good" : "warn"} />
                  <TelemetryLine label="Model" value={servedModelId} detail={`${status?.endpoint.models.length ?? 0} model id(s) from /models`} tone={status?.endpoint.models.length ? "good" : "warn"} />
                  <TelemetryLine label="Model type" value={modelRuntime} detail={`${modelQuant}, ${settings?.launchVariant || "variant unknown"}`} tone={modelQuant === "unknown" ? "neutral" : "good"} />
                  <TelemetryLine label="Context window" value={contextWindow ? `${contextWindow.toLocaleString()} tok` : "unknown"} detail={settings ? `max output ${settings.maxTokens.toLocaleString()}, batch ${settings.batchSize}/${settings.ubatchSize}` : "settings loading"} />
                  <TelemetryLine label="Context used" value={probeUsage?.totalTokens && contextWindow ? `${formatTokens(probeUsage.totalTokens)} tok / ${formatPercent(contextUsedPercent)}` : "unavailable"} detail={probeUsage ? `prompt ${formatTokens(probeUsage.promptTokens)}, completion ${formatTokens(probeUsage.completionTokens)}` : "run Test API for usage"} tone={contextUsedPercent === null ? "neutral" : contextUsedPercent > 90 ? "bad" : contextUsedPercent > 75 ? "warn" : "good"} />
                  <TelemetryLine label="Token speed" value={formatTokenRate(probePayload?.chat.completionTokensPerSecond)} detail={probePayload ? `completion tokens over ${probePayload.chat.latencyMs}ms` : "run Test API"} tone={probePayload?.chat.completionTokensPerSecond ? "good" : "neutral"} />
                  <TelemetryLine label="Provider" value={settings?.providerId || "local"} detail={settings?.providerName || "OpenAI compatible"} />
                  <TelemetryLine label="Container" value={runningContainer} detail={compactText(status?.docker.summary || "Docker summary unavailable", 92)} tone={runningContainer !== "none" ? "good" : status?.docker.ok ? "neutral" : "warn"} />
                  <TelemetryLine label="Last job" value={latestJob ? `${latestJob.label}: ${latestJob.status}` : "none"} detail={latestJob ? new Date(latestJob.startedAt).toLocaleString() : "no runtime command in this session"} tone={latestJob?.status === "completed" ? "good" : latestJob?.status === "failed" ? "bad" : latestJob?.status === "running" ? "warn" : "neutral"} />
                  <TelemetryLine label="Dependencies" value={`${toolOkCount}/${totalToolCount} OK`} detail={missingTools.length ? compactText(missingTools.join(" | "), 92) : "WSL tools found"} tone={totalToolCount && toolOkCount === totalToolCount ? "good" : "warn"} />
                  <TelemetryLine label="API probe" value={probePayload ? `${probeOk ? "OK" : "fail"} in ${probePayload.totalMs}ms` : "not run"} detail={probePayload ? `models ${probePayload.models.status} / chat ${probePayload.chat.status}` : "tests /models and /chat/completions"} tone={probePayload ? (probeOk ? "good" : "bad") : "neutral"} />
                  <TelemetryLine label="Probe reply" value={probePayload ? compactText(probePayload.chat.content, 96) || "empty" : "not run"} detail={probePayload ? `${probePayload.chat.latencyMs}ms chat latency` : "click Test API"} tone={probePayload ? (probePayload.chat.ok ? "good" : "bad") : "neutral"} />
                  <TelemetryLine label="Last scan" value={scanPayload ? `${foundScanResults.length}/${scanPayload.ports.length} ports found` : "not run"} detail={scanPayload ? `${scanPayload.durationMs}ms, docker ports ${scanPayload.dockerPorts.length || 0}` : "click Scan ports"} tone={scanPayload ? (foundScanResults.length ? "good" : "warn") : "neutral"} />
                  <TelemetryLine label="Best scan" value={bestScanResult ? bestScanResult.baseUrl : "none"} detail={bestScanResult ? `${bestScanResult.latencyMs}ms, ${bestScanResult.models[0] || "no model id"}` : "no responsive endpoint selected"} tone={bestScanResult ? "good" : "neutral"} />
                  <TelemetryLine label="Host" value={status ? `${status.host.cpus} CPU / ${status.host.memoryGb} GB RAM` : "loading"} detail={status ? `${status.host.platform} ${status.host.release}` : "waiting for status"} />
                  <TelemetryLine label="Repo" value={status?.repo.head ? status.repo.head.slice(0, 12) : "unknown"} detail={compactText(status?.repo.status || "repo status unavailable", 92)} tone={status?.repo.ok ? "good" : "warn"} />
                </div>
              </section>

              <PanelGroup direction="horizontal" className="min-h-[22rem]">
                <SplitPanel defaultSize={68} minSize={35} className="min-w-0">
                <PanelGroup direction="vertical" className="min-h-[22rem]">
                  <SplitPanel defaultSize={44} minSize={28} className="min-h-[10rem]">
                  <section className="h-full min-h-0 min-w-0 overflow-hidden rounded-md border border-workflow-border bg-workflow-surface">
                    <div className="flex items-center justify-between gap-2 border-b border-workflow-border px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Cpu className="h-4 w-4 text-workflow-text-muted" />
                        <h2 className="font-mono text-xs font-semibold uppercase tracking-wide text-workflow-text">Resource load</h2>
                      </div>
                      <span className="font-mono text-[10px] text-workflow-text-subtle">budget {storageBudgetGb || "?"} GB</span>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2">
                      <TelemetryBar label="VRAM" value={gpuSummary ? `${mbToGb(gpuSummary.usedMb)} / ${mbToGb(gpuSummary.totalMb)}` : "unknown"} detail={gpuSummary ? `${mbToGb(gpuSummary.freeMb)} free, ${gpuSummary.utilization}% load` : status?.gpu.error || "waiting for nvidia-smi"} percent={vramPercent} tone={vramPercent > 92 ? "bad" : vramPercent > 82 ? "warn" : "good"} />
                      <TelemetryBar label="Model budget" value={storageBudgetGb ? `${modelSizeGb.toFixed(1)} / ${storageBudgetGb.toFixed(0)} GB` : `${modelSizeGb.toFixed(1)} GB`} detail={`${budgetRemainingGb.toFixed(1)} GB remaining in project budget`} percent={modelBudgetPercent} tone={budgetRemainingGb < 0 ? "bad" : modelBudgetPercent > 85 ? "warn" : "good"} />
                      <TelemetryLine label="GPU core" value={gpuSummary ? `${gpuSummary.utilization}% / ${gpuSummary.temp}C / ${gpuSummary.power}W` : "unknown"} detail={gpuSummary ? `${gpuSummary.name} driver ${gpuSummary.driver}` : "no parsed GPU row"} tone={gpuSummary ? "good" : "warn"} />
                      <TelemetryLine label="Disk" value={status?.storage.disk ? `${status.storage.disk.FreeGB ?? "?"} GB free` : "unknown"} detail={status?.storage.disk ? `${status.storage.disk.UsedGB ?? "?"} GB used on project drive` : "drive query unavailable"} tone={status?.storage.disk?.FreeGB && status.storage.disk.FreeGB < 100 ? "warn" : "neutral"} />
                    </div>
                  </section>
                  </SplitPanel>

                  <SplitHandle direction="vertical" />

                  <SplitPanel defaultSize={56} minSize={28} className="min-h-[9rem]">
                  <section className="h-full min-h-0 min-w-0 overflow-hidden rounded-md border border-workflow-border bg-workflow-surface">
                    <div className="flex items-center justify-between gap-2 border-b border-workflow-border px-3 py-2">
                      <div className="flex items-center gap-2">
                        <SquareTerminal className="h-4 w-4 text-workflow-text-muted" />
                        <h2 className="font-mono text-xs font-semibold uppercase tracking-wide text-workflow-text">Raw diagnostics</h2>
                      </div>
                      <span className="font-mono text-[10px] text-workflow-text-subtle">collapsed by default</span>
                    </div>
                    <div className="divide-y divide-workflow-border/70">
                      <RawTelemetry title="GPU" icon={<Cpu className="h-4 w-4" />} summary={gpuSummary ? `${gpuSummary.name}, ${mbToGb(gpuSummary.usedMb)} used` : "no GPU row"} value={status?.gpu.rows.join("\n") || status?.gpu.error || ""} />
                      <RawTelemetry title="Docker" icon={<Boxes className="h-4 w-4" />} summary={`${status?.docker.containers.length ?? 0} container row(s)`} value={[status?.docker.summary, "", ...(status?.docker.containers || []), "", status?.docker.disk].filter((line) => line !== undefined).join("\n")} />
                      <RawTelemetry title="WSL" icon={<SquareTerminal className="h-4 w-4" />} summary={`${totalToolCount} tool check(s)`} value={[status?.wsl.list, "", ...(status?.wsl.tools || [])].filter((line) => line !== undefined).join("\n")} />
                      <RawTelemetry title="Repo" icon={<HardDrive className="h-4 w-4" />} summary={status?.repo.head ? `HEAD ${status.repo.head.slice(0, 12)}` : "repo status"} value={`HEAD ${status?.repo.head || ""}\n${status?.repo.status || ""}`} />
                    </div>
                  </section>
                  </SplitPanel>
                </PanelGroup>
                </SplitPanel>

                <SplitHandle />

                <SplitPanel defaultSize={32} minSize={20} className="min-w-[19rem]">
                <section className="h-full min-h-[10rem] min-w-0 overflow-hidden rounded-md border border-workflow-border bg-workflow-surface">
                  <div className="flex items-center justify-between gap-2 border-b border-workflow-border px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Search className="h-4 w-4 text-workflow-text-muted" />
                      <h2 className="font-mono text-xs font-semibold uppercase tracking-wide text-workflow-text">Local endpoint scan</h2>
                    </div>
                    <span className="font-mono text-[10px] text-workflow-text-subtle">{scanPayload ? `${scanPayload.ports.length} checked` : "not run"}</span>
                  </div>
                  <div className="max-h-56 overflow-auto">
                    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_4.5rem_5.5rem] border-b border-workflow-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-workflow-text-subtle">
                      <span>Port</span>
                      <span>Base URL / model</span>
                      <span>Status</span>
                      <span className="text-right">Latency</span>
                    </div>
                    {scanPayload ? (
                      scanPayload.results.map((result) => (
                        <div key={result.port} className="grid grid-cols-[4.5rem_minmax(0,1fr)_4.5rem_5.5rem] items-center gap-2 border-b border-workflow-border/60 px-3 py-1.5 text-xs last:border-b-0">
                          <span className="flex items-center gap-2 font-mono text-workflow-text">
                            <StatusDot ok={result.ok} />
                            {result.port}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-mono text-workflow-text">{result.baseUrl}</span>
                            <span className="block truncate text-[11px] text-workflow-text-muted">{result.models[0] || result.error || "no model id"}</span>
                          </span>
                          <span className={cx("font-mono", result.ok ? "text-emerald-300" : "text-rose-300")}>{result.status || "fail"}</span>
                          <span className="text-right font-mono text-workflow-text-muted">{result.latencyMs}ms</span>
                        </div>
                      ))
                    ) : (
                      <div className="px-3 py-3 text-xs text-workflow-text-muted">Run a local scan to list OpenAI-compatible endpoints and Docker-published ports.</div>
                    )}
                  </div>
                </section>
                </SplitPanel>
              </PanelGroup>
            </div>
          )}

          {activeTab === "chat" && (
            <PanelGroup direction="horizontal" className="min-h-[32rem] flex-1">
              <SplitPanel defaultSize={54} minSize={35} className="min-w-[24rem]">
              <Panel title="Local Chat" icon={<MessageSquare className="h-4 w-4" />} className="flex h-full min-h-0 flex-col" bodyClassName="flex min-h-0 flex-1 flex-col">
                <PanelGroup direction="vertical" className="min-h-0 flex-1">
                  <SplitPanel defaultSize={74} minSize={35} className="min-h-[14rem]">
                  <div className="h-full space-y-3 overflow-y-auto pr-2">
                    {messages.length === 0 && <div className="text-sm text-workflow-text-muted">Launch a model, then start chatting. Responses render markdown.</div>}
                    {messages.map((message) => (
                      <div key={message.id} className={cx("rounded-lg border p-3", message.role === "user" ? "border-blue-500/40 bg-blue-500/10" : "border-emerald-500/30 bg-emerald-500/10")}>
                        <div className="mb-2 font-mono text-xs uppercase tracking-wide text-workflow-text-muted">{message.role}</div>
                        <div className="prose prose-invert max-w-none prose-pre:bg-black/40 prose-code:text-emerald-200">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                        </div>
                      </div>
                    ))}
                  </div>
                  </SplitPanel>

                  <SplitHandle direction="vertical" />

                  <SplitPanel defaultSize={26} minSize={18} maxSize={45} className="min-h-[8rem]">
                  <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_6rem] items-end gap-2">
                    <textarea
                      value={chatInput}
                      onChange={(event) => setChatInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void sendChat();
                      }}
                      className="h-full min-h-0 resize-none rounded-md border border-workflow-border bg-workflow-node-input p-3 text-sm outline-none focus:border-emerald-500/60"
                      placeholder="Ask the local model..."
                    />
                    <button onClick={() => void sendChat()} disabled={busy === "chat"} className="h-10 rounded-md bg-emerald-400 px-4 font-mono text-sm font-semibold text-black disabled:opacity-50">
                      Send
                    </button>
                  </div>
                  </SplitPanel>
                </PanelGroup>
              </Panel>
              </SplitPanel>

              <SplitHandle />

              <SplitPanel defaultSize={28} minSize={20} className="min-w-[20rem]">
              <Panel title="Browser Preview" icon={<Search className="h-4 w-4" />} className="flex h-full min-h-0 flex-col" bodyClassName="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
                <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-2">
                  <input
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void runSearch();
                    }}
                    className="min-h-8 min-w-0 rounded-md border border-workflow-border bg-workflow-node-input px-2 font-mono text-xs text-workflow-text outline-none focus:border-cyan-500/60"
                    placeholder="Search web..."
                  />
                  <button onClick={() => void runSearch()} disabled={busy === "search"} className="rounded-md bg-cyan-300 px-3 font-mono text-xs font-semibold text-black disabled:opacity-50">
                    {busy === "search" ? "..." : "Search"}
                  </button>
                </div>

                {selectedSearch ? (
                  <>
                    <div className="grid grid-cols-[minmax(0,1fr)_4.75rem_4.25rem] items-center gap-2 rounded-md border border-workflow-border bg-workflow-node-input px-2 py-1.5 text-xs">
                      <div className="min-w-0">
                        <div className="truncate font-mono text-workflow-text">{selectedSearch.query}</div>
                        <div className="truncate text-[11px] text-workflow-text-subtle">{selectedSearch.url}</div>
                        <div className="truncate text-[11px] text-emerald-300">AI context: query + URL</div>
                      </div>
                      <button type="button" onClick={() => useSearchInChat(selectedSearch)} className="h-7 rounded-md border border-emerald-500/40 bg-emerald-500/10 font-mono text-[10px] text-emerald-200 hover:bg-emerald-500/20">
                        Ask AI
                      </button>
                      <a href={selectedSearch.url} target="_blank" rel="noreferrer" className="grid h-7 place-items-center rounded-md border border-workflow-border bg-workflow-surface font-mono text-[10px] text-workflow-text-muted hover:text-workflow-text">
                        Open
                      </a>
                    </div>
                    <div className="min-h-[18rem] flex-1 overflow-hidden rounded-md border border-workflow-border bg-white">
                      <iframe title="Browser preview" src={browserPreviewUrl} sandbox="allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts" className="h-full w-full" />
                    </div>
                  </>
                ) : (
                  <div className="grid min-h-0 flex-1 place-items-center rounded-md border border-workflow-border bg-workflow-node-input p-3 text-center text-xs text-workflow-text-muted">
                    Search results preview appears here.
                  </div>
                )}

                <div className="max-h-32 overflow-auto rounded-md border border-workflow-border">
                  {searches.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedSearchId(item.id)}
                      className={cx("grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-workflow-border/60 px-2 py-1.5 text-left text-xs last:border-b-0 hover:bg-workflow-surface-hover", selectedSearch?.id === item.id && "bg-workflow-node-input")}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-workflow-text">{item.query}</span>
                        <span className="block truncate text-[11px] text-workflow-text-subtle">{new Date(item.createdAt).toLocaleString()}</span>
                      </span>
                      <ExternalLink className="h-3.5 w-3.5 text-workflow-text-muted" />
                    </button>
                  ))}
                  {searches.length === 0 && <div className="px-2 py-1.5 text-xs text-workflow-text-muted">No searches yet</div>}
                </div>

                <section className="space-y-2 rounded-md border border-workflow-border bg-workflow-node-input p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-mono text-[10px] font-semibold uppercase tracking-wide text-workflow-text">Browser use</div>
                    <button type="button" onClick={useBrowserUseInChat} disabled={!browserUse} className="h-7 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 font-mono text-[10px] text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-40">
                      Use in chat
                    </button>
                  </div>
                  <div className="grid grid-cols-[2rem_2rem_2rem_minmax(0,1fr)_2rem_2rem] gap-1.5 rounded-md border border-workflow-border bg-workflow-surface p-1">
                    <button type="button" title="Back" aria-label="Back controlled browser" onClick={() => void runBrowserUse("back")} disabled={busy === "browser-back"} className="grid h-8 place-items-center rounded border border-workflow-border bg-workflow-node-input text-workflow-text-muted hover:text-workflow-text disabled:opacity-50">
                      <ArrowLeft className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" title="Forward" aria-label="Forward controlled browser" onClick={() => void runBrowserUse("forward")} disabled={busy === "browser-forward"} className="grid h-8 place-items-center rounded border border-workflow-border bg-workflow-node-input text-workflow-text-muted hover:text-workflow-text disabled:opacity-50">
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" title="Reload" aria-label="Reload controlled browser" onClick={() => void runBrowserUse("reload")} disabled={busy === "browser-reload"} className="grid h-8 place-items-center rounded border border-workflow-border bg-workflow-node-input text-workflow-text-muted hover:text-workflow-text disabled:opacity-50">
                      <RefreshCw className={cx("h-3.5 w-3.5", busy === "browser-reload" && "animate-spin")} />
                    </button>
                    <input
                      aria-label="Browser address bar"
                      value={browserUseUrl}
                      onChange={(event) => setBrowserUseUrl(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void runBrowserUse("open");
                      }}
                      className="h-8 min-w-0 rounded border border-workflow-border bg-black/20 px-2 font-mono text-xs text-workflow-text outline-none placeholder:text-workflow-text-subtle focus:border-cyan-500/60"
                      placeholder={selectedSearch?.url || "https://example.com"}
                    />
                    <button type="button" title="Go" aria-label="Open address in controlled browser" onClick={() => void runBrowserUse("open")} disabled={busy === "browser-open"} className="grid h-8 place-items-center rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50">
                      <Send className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" title="Snapshot" aria-label="Snapshot controlled browser" onClick={() => void runBrowserUse("snapshot")} disabled={busy === "browser-snapshot"} className="grid h-8 place-items-center rounded border border-workflow-border bg-workflow-node-input text-workflow-text-muted hover:text-workflow-text disabled:opacity-50">
                      <Camera className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_4.5rem_4.5rem] gap-2">
                    <input
                      aria-label="Browser use selector"
                      value={browserUseSelector}
                      onChange={(event) => setBrowserUseSelector(event.target.value)}
                      className="min-h-8 min-w-0 rounded-md border border-workflow-border bg-workflow-surface px-2 font-mono text-xs text-workflow-text outline-none focus:border-cyan-500/60"
                      placeholder="css / text= / label= / placeholder="
                    />
                    <input
                      aria-label="Browser use text"
                      value={browserUseText}
                      onChange={(event) => setBrowserUseText(event.target.value)}
                      className="min-h-8 min-w-0 rounded-md border border-workflow-border bg-workflow-surface px-2 font-mono text-xs text-workflow-text outline-none focus:border-cyan-500/60"
                      placeholder="text to type"
                    />
                    <button type="button" aria-label="Click controlled browser target" onClick={() => void runBrowserUse("click")} disabled={busy === "browser-click"} className="rounded-md border border-workflow-border bg-workflow-surface font-mono text-[10px] text-workflow-text-muted hover:text-workflow-text disabled:opacity-50">
                      Click
                    </button>
                    <button type="button" aria-label="Type into controlled browser target" onClick={() => void runBrowserUse("type")} disabled={busy === "browser-type"} className="rounded-md border border-workflow-border bg-workflow-surface font-mono text-[10px] text-workflow-text-muted hover:text-workflow-text disabled:opacity-50">
                      Type
                    </button>
                  </div>
                  {browserActions.length > 0 && (
                    <div className="max-h-24 overflow-auto rounded-md border border-workflow-border bg-workflow-surface">
                      <div className="grid grid-cols-[4.5rem_4rem_minmax(0,1fr)] gap-2 border-b border-workflow-border/60 bg-black/20 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-workflow-text-subtle">
                        <span>Status</span>
                        <span>AI</span>
                        <span>Browser action</span>
                      </div>
                      {browserActions.map((item, index) => (
                        <div key={`${item.action}-${index}`} className="grid grid-cols-[4.5rem_4rem_minmax(0,1fr)] gap-2 border-b border-workflow-border/60 px-2 py-1 text-[10px] last:border-b-0">
                          <span className={cx("font-mono", item.status === "ok" ? "text-emerald-300" : "text-rose-300")}>{item.status}</span>
                          <span className="font-mono text-workflow-text-subtle">{item.action}</span>
                          <span className="truncate text-workflow-text-muted">{item.error || item.title || item.url || item.selector || "browser action"}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {browserUse && (
                    <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_12rem]">
                      <div className="min-w-0 rounded-md border border-workflow-border bg-workflow-surface p-2">
                        <div className="truncate font-mono text-[11px] text-workflow-text">{browserUse.title || browserUse.url}</div>
                        <div className="truncate text-[10px] text-workflow-text-subtle">{browserUse.url}</div>
                        <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap text-[10px] leading-4 text-workflow-text-muted">{browserUse.text || "No visible text"}</pre>
                      </div>
                      {browserUse.screenshot && <img alt="Controlled browser screenshot" src={`data:image/png;base64,${browserUse.screenshot}`} className="h-32 w-full rounded-md border border-workflow-border object-cover" />}
                      <div className="max-h-28 overflow-auto rounded-md border border-workflow-border bg-workflow-surface xl:col-span-2">
                        {browserUse.elements.map((element, index) => (
                          <button key={`${element.selector}-${index}`} type="button" onClick={() => setBrowserUseSelector(element.selector)} className="grid w-full grid-cols-[4rem_minmax(0,1fr)] gap-2 border-b border-workflow-border/60 px-2 py-1 text-left text-[10px] last:border-b-0 hover:bg-workflow-surface-hover">
                            <span className="font-mono text-workflow-text-subtle">{element.tag}</span>
                            <span className="truncate text-workflow-text-muted">{element.label || element.selector}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              </Panel>
              </SplitPanel>

              <SplitHandle />

              <SplitPanel defaultSize={18} minSize={16} className="min-w-[16rem]">
              <Panel title="Chat Tools" icon={<Save className="h-4 w-4" />} className="h-full min-h-0" bodyClassName="h-full overflow-y-auto">
                <div className="space-y-3">
                  <button onClick={exportChatMarkdown} className="w-full rounded-md border border-workflow-border bg-workflow-node-input px-3 py-2 text-sm hover:bg-workflow-surface-hover">Export markdown</button>
                  <button onClick={() => void clearChat()} className="w-full rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200 hover:bg-rose-500/20">Clear history</button>
                  {searches.length > 0 && (
                    <button onClick={() => void clearSearches()} className="w-full rounded-md border border-workflow-border bg-workflow-node-input px-3 py-2 text-sm hover:bg-workflow-surface-hover">
                      Clear search history
                    </button>
                  )}
                  {settings && (
                    <>
                      <section className="resizable-surface min-h-[8rem] min-w-0 rounded-md border border-workflow-border">
                        <div className="flex items-center justify-between gap-2 border-b border-workflow-border bg-workflow-node-input px-2 py-1.5">
                          <span className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-wide text-workflow-text">
                            <Bot className="h-3.5 w-3.5 text-workflow-text-muted" />
                            AI telemetry
                          </span>
                          <span className={cx("font-mono text-[10px]", status?.endpoint.ok ? "text-emerald-300" : "text-amber-300")}>{status?.endpoint.ok ? "online" : "offline"}</span>
                        </div>
                        <TelemetryLine label="Model" value={servedModelId} detail={`${modelRuntime}, ${modelQuant}`} tone={status?.endpoint.ok ? "good" : "warn"} />
                        <TelemetryLine label="Context" value={contextWindow ? `${contextWindow.toLocaleString()} tok` : "unknown"} detail={`max ${settings.maxTokens.toLocaleString()}, batch ${settings.batchSize}/${settings.ubatchSize}`} />
                        <TelemetryBar label="Context used" value={probeUsage?.totalTokens && contextWindow ? `${formatTokens(probeUsage.totalTokens)} / ${contextWindow.toLocaleString()} tok` : "unavailable"} detail={probeUsage ? `prompt ${formatTokens(probeUsage.promptTokens)}, completion ${formatTokens(probeUsage.completionTokens)}` : "run Test API on Telemetry"} percent={contextUsedPercent ?? 0} tone={contextUsedPercent === null ? "neutral" : contextUsedPercent > 90 ? "bad" : contextUsedPercent > 75 ? "warn" : "good"} />
                        <TelemetryLine label="Token speed" value={formatTokenRate(probePayload?.chat.completionTokensPerSecond)} detail={probePayload ? `${probePayload.chat.latencyMs}ms last probe` : "run Test API on Telemetry"} tone={probePayload?.chat.completionTokensPerSecond ? "good" : "neutral"} />
                        <TelemetryLine label="Sampling" value={`T ${settings.temperature} / P ${settings.topP}`} detail={`top-k ${settings.topK}, min-p ${settings.minP}, repeat ${settings.repeatPenalty}`} />
                        <TelemetryLine label="Reasoning" value={settings.reasoning} detail={`thinking ${settings.thinkingEnabled ? "on" : "off"}, ${settings.reasoningFormat}`} tone={settings.thinkingEnabled || settings.reasoning === "on" ? "good" : "neutral"} />
                      </section>

                      <section className="resizable-surface min-h-[8rem] min-w-0 rounded-md border border-workflow-border">
                        <div className="flex items-center justify-between gap-2 border-b border-workflow-border bg-workflow-node-input px-2 py-1.5">
                          <span className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-wide text-workflow-text">
                            <Cpu className="h-3.5 w-3.5 text-workflow-text-muted" />
                            GPU telemetry
                          </span>
                          <span className="font-mono text-[10px] text-workflow-text-subtle">{gpuSummary?.name || "unknown"}</span>
                        </div>
                        <TelemetryBar label="VRAM" value={gpuSummary ? `${mbToGb(gpuSummary.usedMb)} / ${mbToGb(gpuSummary.totalMb)}` : "unknown"} detail={gpuSummary ? `${mbToGb(gpuSummary.freeMb)} free, ${gpuSummary.utilization}% load` : status?.gpu.error || "waiting for nvidia-smi"} percent={vramPercent} tone={vramPercent > 92 ? "bad" : vramPercent > 82 ? "warn" : "good"} />
                        <TelemetryLine label="GPU core" value={gpuSummary ? `${gpuSummary.utilization}% / ${gpuSummary.temp}C` : "unknown"} detail={gpuSummary ? `${gpuSummary.power}W, driver ${gpuSummary.driver}` : "no parsed GPU row"} tone={gpuSummary ? "good" : "warn"} />
                        <TelemetryLine label="Container" value={runningContainer} detail={compactText(status?.docker.summary || "Docker summary unavailable", 72)} tone={runningContainer !== "none" ? "good" : "warn"} />
                        <TelemetryBar label="Model budget" value={storageBudgetGb ? `${modelSizeGb.toFixed(1)} / ${storageBudgetGb.toFixed(0)} GB` : `${modelSizeGb.toFixed(1)} GB`} detail={`${budgetRemainingGb.toFixed(1)} GB remaining`} percent={modelBudgetPercent} tone={budgetRemainingGb < 0 ? "bad" : modelBudgetPercent > 85 ? "warn" : "good"} />
                      </section>
                    </>
                  )}
                  <div className="rounded-md bg-workflow-node-input p-3 text-xs text-workflow-text-muted">
                    History is stored locally in this app repo under `data/chat-history.json`.
                  </div>
                </div>
              </Panel>
              </SplitPanel>
            </PanelGroup>
          )}

          {activeTab === "canvas" && (
            <PanelGroup direction="horizontal" className="min-h-[32rem] flex-1">
              <SplitPanel defaultSize={76} minSize={45} className="min-w-[24rem]">
              <Panel title="Automation Canvas" icon={<Workflow className="h-4 w-4" />} className="flex h-full min-h-0 flex-col" bodyClassName="min-h-0 flex-1">
                <div className="h-full min-h-[28rem]">
                  <ReactFlow
                    nodes={flowNodes.map((node) => ({ ...node, selected: node.id === selectedCanvasNodeId }))}
                    edges={flowEdges}
                    nodeTypes={flowNodeTypes}
                    onNodeClick={(_, node) => setSelectedCanvasNodeId(node.id)}
                    fitView
                    fitViewOptions={flowFitViewOptions}
                  >
                    <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#27272a" />
                    <Controls showInteractive={false} />
                  </ReactFlow>
                </div>
              </Panel>
              </SplitPanel>

              <SplitHandle />

              <SplitPanel defaultSize={24} minSize={18} className="min-w-[18rem]">
              <Panel title="Canvas Actions" icon={<Power className="h-4 w-4" />} className="h-full" bodyClassName="h-full overflow-y-auto">
                <div className="space-y-3">
                  <div className="rounded-md bg-workflow-node-input p-3">
                    <div className="font-mono text-sm font-semibold">{selectedCanvasNode?.data.title}</div>
                    <div className="mt-2 text-xs leading-5 text-workflow-text-muted">{selectedCanvasNode?.data.detail}</div>
                    <div className="mt-3 flex items-center gap-2 text-xs text-workflow-text-muted">
                      <StatusDot ok={selectedCanvasNode?.data.state === "ready"} />
                      <span>{selectedCanvasNode?.data.state}</span>
                    </div>
                  </div>
                  {(canvasActions[selectedCanvasNode?.id || ""] || []).map((action) => (
                    <button
                      key={action.label}
                      onClick={action.run}
                      disabled={Boolean(busy)}
                      className={cx(
                        "w-full rounded-md border px-3 py-2 text-left text-sm disabled:opacity-50",
                        action.danger ? "border-rose-500/40 bg-rose-500/10 text-rose-200" : "border-workflow-border bg-workflow-node-input hover:bg-workflow-surface-hover"
                      )}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </Panel>
              </SplitPanel>
            </PanelGroup>
          )}

          {activeTab === "logs" && (
            <PanelGroup direction="horizontal" className="min-h-[32rem] flex-1">
              <SplitPanel defaultSize={24} minSize={15} className="min-w-[16rem]">
              <Panel title="Jobs" icon={<History className="h-4 w-4" />} className="h-full" bodyClassName="h-full overflow-y-auto">
                <div className="space-y-2">
                  {jobsPayload.jobs.map((job) => (
                    <button key={job.id} onClick={() => setSelectedJob(job.id)} className={cx("w-full rounded-md border px-3 py-2 text-left text-sm", selectedJob === job.id ? "border-emerald-500/50 bg-emerald-500/10" : "border-workflow-border bg-workflow-node-input")}>
                      <div className="flex items-center justify-between">
                        <span className="truncate">{job.label}</span>
                        {job.status === "completed" ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : job.status === "failed" ? <XCircle className="h-4 w-4 text-rose-300" /> : <RefreshCw className="h-4 w-4 animate-spin text-amber-300" />}
                      </div>
                      <div className="mt-1 text-xs text-workflow-text-subtle">{new Date(job.startedAt).toLocaleString()}</div>
                    </button>
                  ))}
                </div>
              </Panel>
              </SplitPanel>

              <SplitHandle />

              <SplitPanel defaultSize={76} minSize={40} className="min-w-[24rem]">
              <Panel title="Log Output" icon={<SquareTerminal className="h-4 w-4" />} className="flex h-full min-h-0 flex-col" bodyClassName="min-h-0 flex-1">
                <pre className="resizable-surface h-full min-h-[12rem] overflow-auto rounded-md bg-black p-4 text-xs leading-5 text-zinc-300">{jobLog || "No log selected"}</pre>
              </Panel>
              </SplitPanel>
            </PanelGroup>
          )}
        </section>
        </SplitPanel>
      </PanelGroup>
      </main>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  busy,
  primary,
  danger,
}: {
  label: string;
  onClick: () => void;
  busy?: boolean;
  primary?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cx(
        "min-h-8 min-w-20 rounded-md px-3 py-1.5 text-center font-mono text-xs font-semibold transition disabled:opacity-50",
        primary && "bg-emerald-400 text-black hover:bg-emerald-300",
        danger && "border border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20",
        !primary && !danger && "border border-workflow-border bg-workflow-node-input text-workflow-text hover:bg-workflow-surface-hover"
      )}
    >
      {busy ? "Running..." : label}
    </button>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-workflow-node-input px-2 py-1.5 text-xs">
      <span className="shrink-0 text-workflow-text-muted">{label}</span>
      <span className="min-w-0 truncate font-mono text-xs text-workflow-text">{value}</span>
    </div>
  );
}

function TelemetryLine({ label, value, detail, tone = "neutral" }: { label: string; value: string; detail?: string; tone?: Tone }) {
  return (
    <div className="grid min-h-10 min-w-0 grid-cols-[7.25rem_minmax(0,1fr)] gap-3 border-b border-workflow-border/70 px-3 py-2 text-xs">
      <span className="truncate text-workflow-text-muted">{label}</span>
      <span className="min-w-0">
        <span className={cx("block truncate font-mono", toneTextClass(tone))}>{value}</span>
        {detail && <span className="mt-0.5 block truncate text-[11px] text-workflow-text-subtle">{detail}</span>}
      </span>
    </div>
  );
}

function TelemetryBar({ label, value, detail, percent, tone = "neutral" }: { label: string; value: string; detail?: string; percent: number; tone?: Tone }) {
  const clamped = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));

  return (
    <div className="min-h-10 min-w-0 border-b border-workflow-border/70 px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-workflow-text-muted">{label}</span>
        <span className={cx("shrink-0 font-mono", toneTextClass(tone))}>{value}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/30">
        <div className={cx("h-full rounded-full", toneFillClass(tone))} style={{ width: `${clamped}%` }} />
      </div>
      {detail && <div className="mt-1 truncate text-[11px] text-workflow-text-subtle">{detail}</div>}
    </div>
  );
}

function RawTelemetry({ title, icon, summary, value }: { title: string; icon: React.ReactNode; summary: string; value: string }) {
  const text = value.trim() || "No data";

  return (
    <details className="group">
      <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-xs hover:bg-workflow-surface-hover [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-workflow-text-muted">{icon}</span>
          <span className="shrink-0 font-mono font-semibold uppercase tracking-wide text-workflow-text">{title}</span>
          <span className="min-w-0 truncate text-workflow-text-muted">{summary}</span>
        </span>
        <span className="font-mono text-[10px] text-workflow-text-subtle group-open:hidden">open</span>
        <span className="hidden font-mono text-[10px] text-workflow-text-subtle group-open:inline">close</span>
      </summary>
      <pre className="resizable-surface max-h-72 min-h-24 overflow-auto whitespace-pre-wrap bg-black/30 px-3 py-2 font-mono text-xs leading-5 text-workflow-text-muted">{text}</pre>
    </details>
  );
}

function ConnectionField({
  label,
  value,
  copyValue = value,
  placeholder,
  readOnly,
  onChange,
  onCopy,
}: {
  label: string;
  value: string;
  copyValue?: string;
  placeholder?: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onCopy: () => void;
}) {
  return (
    <div className="grid min-h-10 min-w-0 grid-cols-[6.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 rounded-md border border-workflow-border bg-workflow-surface px-2 py-1.5">
      <span className="truncate text-[10px] uppercase tracking-wide text-workflow-text-subtle">{label}</span>
      <input
        aria-label={label}
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        onChange={(event) => onChange?.(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        className="min-h-7 min-w-0 rounded-md border border-workflow-border bg-workflow-node-input px-2 font-mono text-xs text-workflow-text outline-none placeholder:text-workflow-text-subtle focus:border-emerald-500/60 read-only:text-workflow-text-muted"
      />
      <button type="button" aria-label={`Copy ${label}`} onClick={onCopy} disabled={!copyValue} className="h-7 rounded-md border border-workflow-border bg-workflow-node-input font-mono text-[10px] text-workflow-text-muted hover:text-workflow-text disabled:opacity-40">
        Copy
      </button>
    </div>
  );
}

function SnippetCard({ title, value, onCopy }: { title: string; value: string; onCopy: () => void }) {
  return (
    <div className="resizable-surface min-h-[10rem] min-w-0 rounded-md border border-workflow-border bg-workflow-surface">
      <div className="flex items-center justify-between gap-2 border-b border-workflow-border px-2 py-1.5">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-workflow-text-muted">{title}</span>
        <button type="button" aria-label={`Copy ${title}`} onClick={onCopy} disabled={!value} className="rounded-md border border-workflow-border bg-workflow-node-input px-2 py-1 font-mono text-[10px] text-workflow-text-muted hover:text-workflow-text disabled:opacity-40">
          Copy
        </button>
      </div>
      <textarea
        aria-label={`${title} snippet`}
        readOnly
        value={value}
        onFocus={(event) => event.currentTarget.select()}
        className="h-44 min-h-28 w-full resize bg-transparent p-2 font-mono text-[10px] leading-4 text-workflow-text-muted outline-none focus:bg-black/20"
      />
    </div>
  );
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-h-[5rem] min-w-0 border-t border-workflow-border pt-2 first:border-t-0 first:pt-0">
      <h3 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-wide text-workflow-text-muted">{title}</h3>
      <div className="grid grid-cols-1 gap-2">{children}</div>
    </section>
  );
}

function FieldShell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid min-w-0 grid-cols-[7.25rem_minmax(0,1fr)] items-center gap-2">
      <span className="truncate text-[11px] text-workflow-text-muted">{label}</span>
      {children}
    </label>
  );
}

function fieldClass(extra = "") {
  return cx(
    "min-h-8 w-full rounded-md border border-workflow-border bg-workflow-node-input px-2 py-1.5 font-mono text-xs text-workflow-text outline-none transition focus:border-emerald-500/60",
    extra
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <FieldShell label={label}>
      <input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className={fieldClass()} />
    </FieldShell>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: SelectOption[]; onChange: (value: string) => void }) {
  return (
    <FieldShell label={label}>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className={fieldClass("cursor-pointer")}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <FieldShell label={label}>
      <input
        type="number"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        className={fieldClass()}
      />
    </FieldShell>
  );
}

function displayNumber(value: number, suffix = "") {
  const formatted = Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${formatted}${suffix}`;
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  suffix = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-workflow-text-muted">{label}</span>
        <span className="font-mono text-xs text-workflow-text">{displayNumber(value, suffix)}</span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_5.75rem] items-center gap-2">
        <input
          type="range"
          aria-label={`${label} slider`}
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-8 min-w-0 accent-emerald-400"
        />
        <input
          type="number"
          aria-label={label}
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(Number(event.target.value))}
          className={fieldClass("text-right")}
        />
      </div>
    </div>
  );
}

function CheckboxField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex min-h-8 items-center justify-between gap-2 rounded-md border border-workflow-border bg-workflow-node-input px-2 py-1.5">
      <span className="text-[11px] text-workflow-text-muted">{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-emerald-400" />
    </label>
  );
}
