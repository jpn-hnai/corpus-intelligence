import { execa } from "execa";
import net from "node:net";
import fs from "node:fs";
import { createSpinner } from "../ui/spinner.js";
import { logSuccess, logError, logWarning } from "../ui/log.js";

export interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
  critical: boolean;
}

async function checkDocker(): Promise<CheckResult> {
  try {
    const { stdout } = await execa("docker", ["--version"], { stdio: "pipe" });
    const match = stdout.match(/Docker version ([\d.]+)/);
    return {
      name: "Docker Desktop",
      passed: true,
      detail: match ? `v${match[1]}` : stdout.trim(),
      critical: true,
    };
  } catch {
    return {
      name: "Docker Desktop",
      passed: false,
      detail: "Not found. Install Docker Desktop first.",
      critical: true,
    };
  }
}

async function checkDockerRunning(): Promise<CheckResult> {
  try {
    await execa("docker", ["info"], { stdio: "pipe" });
    return { name: "Docker daemon", passed: true, detail: "running", critical: true };
  } catch {
    return {
      name: "Docker daemon",
      passed: false,
      detail: "Not running. Start Docker Desktop first.",
      critical: true,
    };
  }
}

async function checkMemory(): Promise<CheckResult> {
  try {
    const { stdout } = await execa("docker", ["info", "--format", "{{.MemTotal}}"], {
      stdio: "pipe",
    });
    const bytes = parseInt(stdout.trim(), 10);
    const gb = bytes / 1e9;
    const passed = gb >= 4;
    return {
      name: "Available memory",
      passed,
      detail: `${gb.toFixed(1)} GB${passed ? "" : " (need 4 GB)"}`,
      critical: false,
    };
  } catch {
    return { name: "Available memory", passed: true, detail: "unknown", critical: false };
  }
}

async function checkDisk(): Promise<CheckResult> {
  try {
    const { stdout } = await execa("df", ["-g", "."], { stdio: "pipe" });
    const lines = stdout.trim().split("\n");
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      const available = parseInt(parts[3], 10);
      const passed = available >= 8;
      return {
        name: "Available disk",
        passed,
        detail: `${available} GB${passed ? "" : " (need 8 GB)"}`,
        critical: false,
      };
    }
    return { name: "Available disk", passed: true, detail: "unknown", critical: false };
  } catch {
    return { name: "Available disk", passed: true, detail: "unknown", critical: false };
  }
}

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function checkPorts(): Promise<CheckResult[]> {
  const ports = [
    { port: 3001, label: "MCP" },
    { port: 7474, label: "Neo4j" },
    { port: 3000, label: "Web UI" },
    { port: 8000, label: "Embeddings" },
    { port: 8001, label: "Graph" },
    { port: 8002, label: "Analysis" },
  ];

  const results: CheckResult[] = [];
  for (const { port, label } of ports) {
    const available = await checkPort(port);
    results.push({
      name: `Port ${port} (${label})`,
      passed: available,
      detail: available ? "available" : "in use",
      critical: false,
    });
  }
  return results;
}

export async function runAllPreflight(): Promise<{
  results: CheckResult[];
  allCriticalPassed: boolean;
}> {
  const spinner = createSpinner("Running preflight checks...");
  spinner.start();

  const docker = await checkDocker();
  const daemon = docker.passed ? await checkDockerRunning() : null;
  const memory = daemon?.passed ? await checkMemory() : null;
  const disk = await checkDisk();
  const ports = daemon?.passed ? await checkPorts() : [];

  spinner.stop();

  const results = [docker, daemon, memory, disk, ...ports].filter(
    (r): r is CheckResult => r !== null,
  );

  for (const r of results) {
    if (r.passed) {
      logSuccess(`${r.name} — ${r.detail}`);
    } else if (r.critical) {
      logError(`${r.name} — ${r.detail}`);
    } else {
      logWarning(`${r.name} — ${r.detail}`);
    }
  }

  const allCriticalPassed = results.filter((r) => r.critical).every((r) => r.passed);
  return { results, allCriticalPassed };
}
