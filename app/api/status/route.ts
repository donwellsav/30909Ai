import { existsSync, statSync } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { getSettings, hostSummary, runFile, windowsToWslPath } from "@/lib/local-store";

export const dynamic = "force-dynamic";

function firstLine(value: string) {
  return value.split(/\r?\n/).find(Boolean) || "";
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function modelFile(label: string, file: string) {
  if (!existsSync(file)) return { label, present: false, path: file, sizeGb: 0 };
  return {
    label,
    present: true,
    path: file,
    sizeGb: Number((statSync(file).size / 1024 / 1024 / 1024).toFixed(2)),
  };
}

async function endpointStatus(endpoint: string) {
  try {
    const url = `${endpoint.replace(/\/$/, "")}/models`;
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const json = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      url,
      status: response.status,
      models: Array.isArray(json.data) ? json.data.map((item: { id?: string }) => item.id).filter(Boolean) : [],
    };
  } catch (error) {
    return {
      ok: false,
      url: `${endpoint.replace(/\/$/, "")}/models`,
      error: error instanceof Error ? error.message : "endpoint unreachable",
      models: [],
    };
  }
}

export async function GET() {
  const settings = getSettings();
  const toolChecks = ["git", "curl", "sha256sum", "python3", "docker", "nvidia-smi", "hf", "huggingface-cli", "jq", "dos2unix"];
  const wslToolCommand = toolChecks
    .map((tool) => `command -v ${tool} >/dev/null 2>&1 && echo OK:${tool} || echo MISSING:${tool}`)
    .join("; ");
  const gpu = await runFile("nvidia-smi", [
    "--query-gpu=name,driver_version,memory.total,memory.used,memory.free,utilization.gpu,temperature.gpu,power.draw",
    "--format=csv,noheader,nounits",
  ]);
  const wsl = await runFile("wsl.exe", ["-l", "-v"]);
  const dockerInfo = await runFile("docker", ["info"], 5000);
  const dockerPs = await runFile("docker", ["ps", "--format", "{{.Names}}|{{.Status}}|{{.Ports}}"], 5000);
  const dockerDf = await runFile("docker", ["system", "df"], 5000);
  const repoStatus = await runFile("git", ["-C", settings.clubRepo, "status", "--short", "--branch"], 5000);
  const repoHead = await runFile("git", ["-C", settings.clubRepo, "rev-parse", "--short", "HEAD"], 5000);
  const disk = await runFile("powershell.exe", [
    "-NoProfile",
    "-Command",
    "$d=Get-PSDrive -Name C; [pscustomobject]@{UsedGB=[math]::Round($d.Used/1GB,2); FreeGB=[math]::Round($d.Free/1GB,2)} | ConvertTo-Json -Compress",
  ]);
  const wslTools = await runFile("wsl.exe", [
    "-d",
    settings.wslDistro,
    "--",
    "bash",
    "-lc",
    wslToolCommand,
  ], 8000);

  const modelDir = settings.modelDir;
  const models = [
    modelFile("ik-llama IQ4_KS", path.join(modelDir, "qwen3.6-27b-gguf", "ubergarm-mtp-iq4ks", "Qwen3.6-27B-MTP-IQ4_KS.gguf")),
    modelFile("llama.cpp Q4_K_M", path.join(modelDir, "qwen3.6-27b-gguf", "unsloth-mtp-q4km", "Qwen3.6-27B-Q4_K_M.gguf")),
    modelFile("vLLM AutoRound config", path.join(modelDir, "qwen3.6-27b-autoround-int4", "config.json")),
  ];

  return NextResponse.json({
    settings,
    host: hostSummary(),
    gpu: {
      ok: gpu.ok,
      rows: gpu.stdout.split(/\r?\n/).filter(Boolean),
      error: gpu.stderr || (!gpu.ok ? "nvidia-smi unavailable" : ""),
    },
    wsl: {
      ok: wsl.ok,
      list: wsl.stdout,
      tools: wslTools.stdout.split(/\r?\n/).filter(Boolean),
      repoPath: windowsToWslPath(settings.clubRepo),
      modelPath: windowsToWslPath(settings.modelDir),
    },
    docker: {
      ok: dockerInfo.ok,
      summary: firstLine(dockerInfo.stdout) || dockerInfo.stderr || "Docker daemon unavailable",
      containers: dockerPs.stdout.split(/\r?\n/).filter(Boolean),
      disk: dockerDf.stdout,
    },
    repo: {
      ok: repoStatus.ok,
      status: repoStatus.stdout || repoStatus.stderr,
      head: repoHead.stdout.trim(),
    },
    storage: {
      disk: parseJson<{ UsedGB?: number; FreeGB?: number } | null>(disk.stdout, null),
      budgetGb: settings.storageBudgetGb,
      models,
    },
    endpoint: await endpointStatus(settings.endpoint),
  });
}
