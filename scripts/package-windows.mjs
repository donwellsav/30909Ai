import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist", "3090Ai");
const app = path.join(dist, "app");
const nodeDir = path.join(dist, "node");
const launcherBuild = path.join(root, "dist", ".launcher-build");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32", ...options });
  if (result.status !== 0) process.exit(result.status || 1);
}

function copyDir(from, to) {
  if (!existsSync(from)) throw new Error(`Missing ${from}`);
  cpSync(from, to, { recursive: true });
}

rmSync(dist, { recursive: true, force: true });
rmSync(launcherBuild, { recursive: true, force: true });
mkdirSync(app, { recursive: true });
mkdirSync(nodeDir, { recursive: true });

run("pnpm", ["build"]);

copyDir(path.join(root, ".next"), path.join(app, ".next"));
rmSync(path.join(app, ".next", "cache"), { recursive: true, force: true });
copyDir(path.join(root, "public"), path.join(app, "public"));
copyFileSync(path.join(root, "package.json"), path.join(app, "package.json"));
copyFileSync(path.join(root, "pnpm-lock.yaml"), path.join(app, "pnpm-lock.yaml"));
copyFileSync(path.join(root, "next.config.mjs"), path.join(app, "next.config.mjs"));
mkdirSync(path.join(app, "data"), { recursive: true });

run("pnpm", ["install", "--prod", "--ignore-workspace", "--no-frozen-lockfile", "--ignore-scripts", "--config.node-linker=hoisted"], { cwd: app });

const sourceNodeDir = path.dirname(process.execPath);
for (const file of readdirSync(sourceNodeDir)) {
  if (file === "node.exe" || file.toLowerCase().endsWith(".dll")) {
    cpSync(path.join(sourceNodeDir, file), path.join(nodeDir, file));
  }
}

mkdirSync(launcherBuild, { recursive: true });
writeFileSync(path.join(launcherBuild, "Launcher.csproj"), `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <AssemblyName>3090Ai</AssemblyName>
    <Nullable>enable</Nullable>
  </PropertyGroup>
</Project>
`);
writeFileSync(path.join(launcherBuild, "Program.cs"), String.raw`using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

var baseDir = AppContext.BaseDirectory;
var appDir = Path.Combine(baseDir, "app");
var node = Path.Combine(baseDir, "node", "node.exe");
var nextCli = Path.Combine(appDir, "node_modules", "next", "dist", "bin", "next");
var port = Environment.GetEnvironmentVariable("PORT");
if (string.IsNullOrWhiteSpace(port)) port = "3090";

if (!File.Exists(node) || !File.Exists(nextCli))
{
    Console.Error.WriteLine("3090Ai package is incomplete.");
    Environment.Exit(1);
}

var process = new Process();
process.StartInfo.FileName = node;
process.StartInfo.Arguments = $"node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port {port}";
process.StartInfo.WorkingDirectory = appDir;
process.StartInfo.UseShellExecute = false;
process.StartInfo.Environment["NODE_ENV"] = "production";
process.StartInfo.Environment["HOSTNAME"] = "127.0.0.1";
process.StartInfo.Environment["PORT"] = port;

Console.CancelKeyPress += (_, eventArgs) =>
{
    eventArgs.Cancel = true;
    if (!process.HasExited) process.Kill(true);
};

process.Start();
var url = $"http://127.0.0.1:{port}/";
Console.WriteLine($"3090Ai running at {url}");
Thread.Sleep(1200);
if (Environment.GetEnvironmentVariable("NO_OPEN") != "1")
{
    Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
}
process.WaitForExit();
Environment.Exit(process.ExitCode);
`);

run("dotnet", [
  "publish",
  launcherBuild,
  "-c", "Release",
  "-r", "win-x64",
  "--self-contained", "true",
  "-p:PublishSingleFile=true",
  "-p:PublishTrimmed=false",
  "-o", dist,
]);

rmSync(launcherBuild, { recursive: true, force: true });
rmSync(path.join(dist, "3090Ai.pdb"), { force: true });
writeFileSync(path.join(dist, "README.txt"), [
  "3090Ai Windows package",
  "",
  "Run 3090Ai.exe.",
  "Default URL: http://127.0.0.1:3090/",
  "Override port: set PORT=3091 before launching.",
  "",
  "Bundled: production app build, production Node dependencies, node.exe launcher runtime.",
  "External machine dependencies remain external: Chrome/Chromium, WSL, Docker, NVIDIA drivers, model files.",
  "",
].join("\r\n"));

console.log(`Packaged ${path.join(dist, "3090Ai.exe")}`);
