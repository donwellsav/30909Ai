import { execFile, spawn } from "child_process";
import { randomUUID } from "crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import os from "os";
import path from "path";

export type JobStatus = "running" | "completed" | "failed";

export interface AppSettings {
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

export interface JobRecord {
  id: string;
  action: string;
  label: string;
  commandLabel: string;
  status: JobStatus;
  startedAt: string;
  completedAt?: string;
  exitCode?: number | null;
  logFile: string;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

export interface SearchRecord {
  id: string;
  query: string;
  url: string;
  createdAt: string;
}

export const dataDir = path.join(process.cwd(), "data");
const jobsDir = path.join(dataDir, "jobs");
const settingsFile = path.join(dataDir, "settings.json");
const jobsFile = path.join(dataDir, "jobs.json");
const chatFile = path.join(dataDir, "chat-history.json");
const searchFile = path.join(dataDir, "search-history.json");
const workflowsFile = path.join(dataDir, "workflows.json");
const memoryFile = path.join(dataDir, "memory.json");

function ensureDataDir() {
  mkdirSync(jobsDir, { recursive: true });
}

function readJson<T>(file: string, fallback: T): T {
  ensureDataDir();
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(file: string, value: T) {
  ensureDataDir();
  writeFileSync(file, JSON.stringify(value, null, 2));
}

export function defaultSettings(): AppSettings {
  return {
    projectRoot: "C:\\3090ai",
    appRoot: "C:\\3090ai\\repo\\3090Ai",
    clubRepo: "C:\\3090ai\\repo\\club-3090",
    modelDir: "C:\\3090ai\\models",
    wslDistro: "club3090",
    endpoint: "http://localhost:8020/v1",
    model: "",
    providerId: "3090ai",
    providerName: "3090Ai Local",
    apiKey: "local",
    storageBudgetGb: 200,
    browser: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    searchEngine: "https://www.google.com/search?q=",
    weightProfile: "iq4ks",
    launchVariant: "ik-llama/iq4ks-mtp",
    port: 8020,
    contextTokens: 200000,
    batchSize: 4096,
    ubatchSize: 1024,
    gpuMemoryUtilization: 92,
    reasoning: "off",
    reasoningFormat: "deepseek",
    temperature: 0.6,
    topP: 0.95,
    topK: 20,
    minP: 0,
    repeatPenalty: 1,
    maxTokens: 1200,
    seed: -1,
    thinkingEnabled: false,
  };
}

export function getSettings(): AppSettings {
  return { ...defaultSettings(), ...readJson<Partial<AppSettings>>(settingsFile, {}) };
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  return Math.round(clampNumber(value, fallback, min, max));
}

function option<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

function cleanString(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function cleanProviderId(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") : "";
  return text || fallback;
}

export function saveSettings(next: Partial<AppSettings>) {
  const current = getSettings();
  const raw = { ...current, ...next };
  const merged = {
    ...raw,
    projectRoot: cleanString(raw.projectRoot, current.projectRoot),
    appRoot: cleanString(raw.appRoot, current.appRoot),
    clubRepo: cleanString(raw.clubRepo, current.clubRepo),
    modelDir: cleanString(raw.modelDir, current.modelDir),
    wslDistro: typeof raw.wslDistro === "string" ? raw.wslDistro.trim() : "",
    endpoint: cleanString(raw.endpoint, current.endpoint),
    model: typeof raw.model === "string" ? raw.model.trim() : "",
    providerId: cleanProviderId(raw.providerId, current.providerId),
    providerName: cleanString(raw.providerName, current.providerName),
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey.trim() : "",
    browser: cleanString(raw.browser, current.browser),
    searchEngine: cleanString(raw.searchEngine, current.searchEngine),
    storageBudgetGb: clampInteger(raw.storageBudgetGb, current.storageBudgetGb || 200, 1, 2000),
    weightProfile: option(raw.weightProfile, ["iq4ks", "gguf", "autoround"] as const, current.weightProfile),
    launchVariant: cleanString(raw.launchVariant, current.launchVariant),
    port: clampInteger(raw.port, current.port || 8020, 1, 65535),
    contextTokens: clampInteger(raw.contextTokens, current.contextTokens || 200000, 4096, 262144),
    batchSize: clampInteger(raw.batchSize, current.batchSize || 4096, 128, 8192),
    ubatchSize: clampInteger(raw.ubatchSize, current.ubatchSize || 1024, 64, 4096),
    gpuMemoryUtilization: clampNumber(raw.gpuMemoryUtilization, current.gpuMemoryUtilization || 92, 50, 99),
    reasoning: option(raw.reasoning, ["off", "on"] as const, current.reasoning),
    reasoningFormat: option(raw.reasoningFormat, ["none", "deepseek", "auto"] as const, current.reasoningFormat),
    temperature: clampNumber(raw.temperature, current.temperature ?? 0.6, 0, 2),
    topP: clampNumber(raw.topP, current.topP || 0.95, 0.01, 1),
    topK: clampInteger(raw.topK, current.topK ?? 20, 0, 200),
    minP: clampNumber(raw.minP, current.minP ?? 0, 0, 1),
    repeatPenalty: clampNumber(raw.repeatPenalty, current.repeatPenalty || 1, 0.8, 2),
    maxTokens: clampInteger(raw.maxTokens, current.maxTokens || 1200, 64, 8192),
    seed: clampInteger(raw.seed, current.seed ?? -1, -1, 2147483647),
    thinkingEnabled: Boolean(raw.thinkingEnabled),
  } satisfies AppSettings;
  writeJson(settingsFile, merged);
  return merged;
}

export function windowsToWslPath(value: string) {
  const normalized = value.replace(/\\/g, "/");
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (!match) return normalized;
  return `/mnt/${match[1].toLowerCase()}/${match[2]}`;
}

export function shQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function getJobs(): JobRecord[] {
  return readJson<JobRecord[]>(jobsFile, []);
}

function setJobs(jobs: JobRecord[]) {
  writeJson(jobsFile, jobs.slice(0, 100));
}

function updateJob(id: string, patch: Partial<JobRecord>) {
  const jobs = getJobs();
  const index = jobs.findIndex((job) => job.id === id);
  if (index === -1) return;
  jobs[index] = { ...jobs[index], ...patch };
  setJobs(jobs);
}

export function getJobLog(id: string, maxBytes = 50000) {
  const job = getJobs().find((item) => item.id === id);
  if (!job || !existsSync(job.logFile)) return "";
  const size = statSync(job.logFile).size;
  const text = readFileSync(job.logFile);
  return text.subarray(Math.max(0, size - maxBytes)).toString("utf8");
}

export interface JobDefinition {
  action: string;
  label: string;
  commandLabel: string;
  file: string;
  args: string[];
}

function wslJob(settings: AppSettings, action: string, label: string, command: string): JobDefinition {
  const args = settings.wslDistro
    ? ["-d", settings.wslDistro, "--", "bash", "-lc", command]
    : ["--", "bash", "-lc", command];
  return {
    action,
    label,
    commandLabel: `wsl ${command}`,
    file: "wsl.exe",
    args,
  };
}

export function getActionDefinitions(settings = getSettings()) {
  const repo = shQuote(windowsToWslPath(settings.clubRepo));
  const modelDir = shQuote(windowsToWslPath(settings.modelDir));
  const cdRepo = `cd ${repo}`;
  const env = `MODEL_DIR=${modelDir}`;
  const contextTokens = String(settings.contextTokens);
  const gpuMemoryFraction = (settings.gpuMemoryUtilization / 100).toFixed(2);
  const reasoningEnv = settings.reasoningFormat === "none" ? "REASONING_FORMAT=" : `REASONING_FORMAT=${shQuote(settings.reasoningFormat)}`;
  const runtimeEnv = [
    env,
    `PORT=${settings.port}`,
    `CTX_SIZE=${contextTokens}`,
    `MAX_MODEL_LEN=${contextTokens}`,
    `BATCH_SIZE=${settings.batchSize}`,
    `UBATCH_SIZE=${settings.ubatchSize}`,
    `GPU_MEMORY_UTILIZATION=${gpuMemoryFraction}`,
    `MEM_UTIL=${gpuMemoryFraction}`,
    `TEMP=${settings.temperature}`,
    `TEMPERATURE=${settings.temperature}`,
    `TOP_P=${settings.topP}`,
    `TOP_K=${settings.topK}`,
    `MIN_P=${settings.minP}`,
    `REPEAT_PENALTY=${settings.repeatPenalty}`,
    `REASONING=${shQuote(settings.reasoning)}`,
    reasoningEnv,
    `ENABLE_THINKING=${settings.thinkingEnabled ? 1 : 0}`,
    "PYTORCH_CUDA_ALLOC_CONF=expandable_segments:False",
  ].join(" ");

  return [
    wslJob(
      settings,
      "doctor",
      "Run preflight doctor",
      `${cdRepo} && SKIP_MODEL=1 ${env} bash scripts/setup.sh qwen3.6-27b`
    ),
    wslJob(
      settings,
      "setup-iq4ks",
      "Download IQ4_KS model",
      `${cdRepo} && ${env} WEIGHTS=iq4ks bash scripts/setup.sh qwen3.6-27b`
    ),
    wslJob(
      settings,
      "setup-selected",
      "Download selected weights",
      `${cdRepo} && ${env} WEIGHTS=${shQuote(settings.weightProfile)} bash scripts/setup.sh qwen3.6-27b`
    ),
    wslJob(
      settings,
      "setup-llamacpp",
      "Download llama.cpp Q4_K_M model",
      `${cdRepo} && ${env} WEIGHTS=gguf bash scripts/setup.sh qwen3.6-27b`
    ),
    wslJob(
      settings,
      "launch-iq4ks",
      "Launch ik-llama",
      `${cdRepo} && ${env} bash scripts/launch.sh --variant ik-llama/iq4ks-mtp`
    ),
    wslJob(
      settings,
      "launch-selected",
      "Launch selected profile",
      `${cdRepo} && ${runtimeEnv} bash scripts/launch.sh --variant ${shQuote(settings.launchVariant)}`
    ),
    wslJob(
      settings,
      "launch-llamacpp",
      "Launch llama.cpp",
      `${cdRepo} && ${env} bash scripts/launch.sh --variant llamacpp/default`
    ),
    wslJob(settings, "verify", "Run verify-full", `${cdRepo} && ${env} bash scripts/verify-full.sh`),
    wslJob(settings, "bench", "Run benchmark", `${cdRepo} && ${env} bash scripts/bench.sh`),
    wslJob(settings, "variants", "List variants", `${cdRepo} && bash scripts/switch.sh --list --all`),
    wslJob(
      settings,
      "stop",
      "Stop model containers",
      "docker ps --format '{{.Names}}' | grep -E '^(vllm-|llama-cpp-|ik-llama-|beellama-)' | xargs -r docker stop"
    ),
  ];
}

export function startJob(action: string) {
  ensureDataDir();
  const settings = getSettings();
  const definition = getActionDefinitions(settings).find((item) => item.action === action);
  if (!definition) throw new Error(`Unsupported action: ${action}`);

  const id = randomUUID();
  const logFile = path.join(jobsDir, `${id}.log`);
  const now = new Date().toISOString();
  const job: JobRecord = {
    id,
    action,
    label: definition.label,
    commandLabel: definition.commandLabel,
    status: "running",
    startedAt: now,
    logFile,
  };

  setJobs([job, ...getJobs()]);
  appendFileSync(logFile, `[3090Ai] ${definition.label}\n[3090Ai] ${definition.commandLabel}\n\n`);

  const child = spawn(definition.file, definition.args, {
    cwd: process.cwd(),
    windowsHide: true,
    env: { ...process.env },
  });

  child.stdout.on("data", (chunk) => appendFileSync(logFile, chunk));
  child.stderr.on("data", (chunk) => appendFileSync(logFile, chunk));
  child.on("error", (error) => {
    appendFileSync(logFile, `\n[3090Ai] failed to start: ${error.message}\n`);
    updateJob(id, {
      status: "failed",
      completedAt: new Date().toISOString(),
      error: error.message,
      exitCode: null,
    });
  });
  child.on("close", (code) => {
    appendFileSync(logFile, `\n[3090Ai] exited with code ${code}\n`);
    updateJob(id, {
      status: code === 0 ? "completed" : "failed",
      completedAt: new Date().toISOString(),
      exitCode: code,
    });
  });

  return job;
}

export function getChatHistory(): ChatMessage[] {
  return readJson<ChatMessage[]>(chatFile, []);
}

export function setChatHistory(messages: ChatMessage[]) {
  writeJson(chatFile, messages.slice(-200));
}

export function getSearchHistory(): SearchRecord[] {
  return readJson<SearchRecord[]>(searchFile, []);
}

export function setSearchHistory(searches: SearchRecord[]) {
  writeJson(searchFile, searches.slice(0, 100));
}

export function addSearch(query: string, url: string) {
  const record: SearchRecord = {
    id: randomUUID(),
    query,
    url,
    createdAt: new Date().toISOString(),
  };
  writeJson(searchFile, [record, ...getSearchHistory()].slice(0, 100));
  return record;
}

export function getWorkflows() {
  return readJson<Record<string, unknown>[]>(workflowsFile, []);
}

export function setWorkflows(workflows: Record<string, unknown>[]) {
  writeJson(workflowsFile, workflows);
}

export function getMemoryStore() {
  return readJson<Record<string, unknown>>(memoryFile, {});
}

export function setMemoryStore(memory: Record<string, unknown>) {
  writeJson(memoryFile, memory);
}

export function runFile(file: string, args: string[], timeoutMs = 10000) {
  return new Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }>((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 * 4 }, (error, stdout, stderr) => {
      const maybeCode = (error as unknown as { code?: unknown } | null)?.code;
      const code = typeof maybeCode === "number" ? maybeCode : error ? 1 : 0;
      resolve({
        ok: !error,
        stdout: String(stdout || "").replace(/\0/g, ""),
        stderr: String(stderr || "").replace(/\0/g, ""),
        code,
      });
    });
  });
}

export function hostSummary() {
  return {
    platform: os.platform(),
    release: os.release(),
    hostname: os.hostname(),
    cpus: os.cpus().length,
    memoryGb: Math.round(os.totalmem() / 1024 / 1024 / 1024),
  };
}
