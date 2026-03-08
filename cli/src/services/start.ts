import { execa } from "execa";
import { createSpinner } from "../ui/spinner.js";
import { logSuccess, logError } from "../ui/log.js";

interface ServiceDef {
  name: string;
  url: string;
  timeout: number; // ms
}

const SERVICES: ServiceDef[] = [
  { name: "neo4j", url: "http://127.0.0.1:7474", timeout: 60_000 },
  { name: "embeddings-service", url: "http://127.0.0.1:8000/health", timeout: 60_000 },
  { name: "graph-service", url: "http://127.0.0.1:8001/health", timeout: 30_000 },
  { name: "analysis-service", url: "http://127.0.0.1:8002/health", timeout: 30_000 },
  { name: "mcp-server", url: "http://127.0.0.1:3001/health", timeout: 30_000 },
  { name: "web-ui", url: "http://127.0.0.1:3000", timeout: 15_000 },
];

async function waitForHealth(
  url: string,
  timeoutMs: number,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

export async function startServices(projectRoot: string): Promise<void> {
  const spinner = createSpinner("Starting Docker services...");
  spinner.start();

  await execa(
    "docker",
    [
      "compose",
      "-f", "docker-compose.yml",
      "-f", "docker-compose.neo4j-ports.yml",
      "up", "-d",
      "neo4j", "embeddings-service", "graph-service",
      "analysis-service", "mcp-server", "web-ui",
    ],
    { cwd: projectRoot, stdio: "pipe" },
  );

  spinner.succeed("Containers started");

  // Health poll each service
  let allHealthy = true;
  for (const svc of SERVICES) {
    const svcSpinner = createSpinner(`Waiting for ${svc.name}...`);
    svcSpinner.start();

    const healthy = await waitForHealth(svc.url, svc.timeout);
    if (healthy) {
      svcSpinner.succeed(`${svc.name} — healthy`);
    } else {
      svcSpinner.fail(`${svc.name} — not responding after ${svc.timeout / 1000}s`);
      allHealthy = false;
    }
  }

  if (!allHealthy) {
    logError("Some services failed to start. Check logs with: docker compose logs");
  }
}
