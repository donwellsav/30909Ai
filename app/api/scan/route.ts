import { NextResponse } from "next/server";
import { getSettings, runFile } from "@/lib/local-store";

export const dynamic = "force-dynamic";

const COMMON_PORTS = [8020, 8000, 8080, 11434, 1234, 5000, 7860, 5001, 3000, 3090];
const MAX_PORTS = 100;

function validPort(value: number) {
  return Number.isInteger(value) && value > 0 && value <= 65535;
}

function parsePortText(value: unknown) {
  if (typeof value !== "string") return [];
  const ports: number[] = [];

  for (const token of value.split(/[,\s]+/)) {
    const range = token.match(/^(\d{1,5})-(\d{1,5})$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (validPort(start) && validPort(end)) {
        for (let port = Math.min(start, end); port <= Math.max(start, end) && ports.length < MAX_PORTS; port += 1) ports.push(port);
      }
      continue;
    }

    const port = Math.round(Number(token));
    if (validPort(port)) ports.push(port);
  }

  return ports;
}

function parsePortArray(value: unknown) {
  const requested = Array.isArray(value) ? value : [];
  return requested
    .map((port) => Math.round(Number(port)))
    .filter(validPort);
}

async function dockerHostPorts() {
  const dockerPs = await runFile("docker", ["ps", "--format", "{{.Ports}}"], 2500);
  if (!dockerPs.ok) return [];
  const ports = [...dockerPs.stdout.matchAll(/(?::|\b)(\d{2,5})->\d{1,5}\/tcp/g)]
    .map((match) => Number(match[1]))
    .filter(validPort);
  return [...new Set(ports)];
}

function portList(body: Record<string, unknown>, fallbackPort: number, dockerPorts: number[]) {
  const requested = [...parsePortArray(body.ports), ...parsePortText(body.ports), ...parsePortText(body.scanText)];

  const aroundCurrent = Array.from({ length: 41 }, (_, index) => fallbackPort - 20 + index)
    .filter(validPort);

  return [...new Set([fallbackPort, ...dockerPorts, ...requested, ...COMMON_PORTS, ...aroundCurrent])].slice(0, MAX_PORTS);
}

async function probePort(port: number) {
  const started = Date.now();
  const baseUrl = `http://localhost:${port}/v1`;
  const url = `http://127.0.0.1:${port}/v1/models`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(900) });
    const json = await response.json().catch(() => ({}));
    const models = Array.isArray(json.data)
      ? json.data.flatMap((item: { id?: unknown }) => typeof item.id === "string" && item.id.length > 0 ? [item.id] : [])
      : [];

    return {
      port,
      baseUrl,
      ok: response.ok && models.length > 0,
      status: response.status,
      latencyMs: Date.now() - started,
      models,
    };
  } catch (error) {
    return {
      port,
      baseUrl,
      ok: false,
      latencyMs: Date.now() - started,
      models: [],
      error: error instanceof Error ? error.message : "unreachable",
    };
  }
}

export async function POST(request: Request) {
  const settings = getSettings();
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const dockerPorts = await dockerHostPorts();
  const ports = portList(body, settings.port, dockerPorts);
  const started = Date.now();
  const results = await Promise.all(ports.map(probePort));

  return NextResponse.json({
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    ports,
    dockerPorts,
    results: results.sort((a, b) => Number(b.ok) - Number(a.ok) || a.port - b.port),
  });
}
