#!/usr/bin/env node

import { printBanner } from "./ui/banner.js";
import { logStep, logError } from "./ui/log.js";
import { c } from "./ui/colors.js";
import { runAllPreflight } from "./preflight/checks.js";
import { runAuth } from "./auth/auth.js";
import { generateEnv } from "./config/env.js";
import { buildImages } from "./services/build.js";
import { startServices } from "./services/start.js";
import { injectClaudeDesktopConfig } from "./config/claude-desktop.js";
import { getProjectRoot } from "./config/paths.js";
import { config } from "./config/store.js";
import boxen from "boxen";

async function main() {
  printBanner();

  const projectRoot = getProjectRoot();

  // Step 1: Preflight
  logStep(1, 7, "Checking prerequisites...");
  const { allCriticalPassed } = await runAllPreflight();
  if (!allCriticalPassed) {
    logError("Critical checks failed. Fix the issues above and try again.");
    process.exit(1);
  }

  // Step 2: Auth
  logStep(2, 7, "Authentication...");
  const { apiKey } = await runAuth();

  // Step 3: Environment
  logStep(3, 7, "Configuring environment...");
  await generateEnv({ apiKey });

  // Step 4: Build
  logStep(4, 7, "Building Docker images...");
  await buildImages(projectRoot);

  // Step 5: Start
  logStep(5, 7, "Starting services...");
  await startServices(projectRoot);

  // Step 6: Claude Desktop
  logStep(6, 7, "Configuring Claude Desktop...");
  await injectClaudeDesktopConfig();

  // Step 7: Ready
  logStep(7, 7, "Ready!");

  config.set("installed", true);
  config.set("lastInstallDate", new Date().toISOString());
  config.set("projectRoot", projectRoot);

  const ready = boxen(
    [
      `${c.accent("corpus-intelligence is ready")}`,
      "",
      `  MCP endpoint   ${c.info("http://127.0.0.1:3001/sse")}`,
      `  Web UI         ${c.info("http://127.0.0.1:3000")}`,
      `  Neo4j          ${c.info("http://127.0.0.1:7474")}`,
      "",
      `  ${c.dim("cd into your corpus folder and type:")} ${c.bright("corpus")}`,
    ].join("\n"),
    {
      padding: 1,
      borderStyle: "round",
      borderColor: "#7c6aff",
    },
  );
  console.log();
  console.log(ready);
  console.log();
}

main().catch((err) => {
  logError(String(err));
  process.exit(1);
});
