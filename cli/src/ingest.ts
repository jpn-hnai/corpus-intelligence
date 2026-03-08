#!/usr/bin/env node

import { printBanner } from "./ui/banner.js";
import { logStep, logSuccess, logError, logWarning, logInfo } from "./ui/log.js";
import { c } from "./ui/colors.js";
import { createSpinner } from "./ui/spinner.js";
import { createProgressBar } from "./ui/progress.js";
import { scanCorpus } from "./pipeline/scanner.js";
import { checkAllServices } from "./pipeline/health.js";
import { runPipeline, type PipelineResult } from "./pipeline/runner.js";
import { PIPELINES } from "./pipeline/pipelines.js";
import { getProjectRoot, getEnvPath } from "./config/paths.js";
import { parseEnvFile } from "./util/env-parser.js";
import boxen from "boxen";

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins > 0) return `${mins}m ${remainSecs}s`;
  return `${secs}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function main() {
  printBanner();

  const projectRoot = getProjectRoot();
  const env = parseEnvFile(getEnvPath());
  const corpusPath = env.CORPUS_PATH;

  if (!corpusPath) {
    logError("CORPUS_PATH not set in .env. Run corpus-intelligence first.");
    process.exit(1);
  }

  // Step 1: Scan corpus
  logStep(1, 4, "Scanning corpus...");
  const scan = scanCorpus(corpusPath);
  if (scan.fileCount === 0) {
    logError(`No .md files found in ${corpusPath}`);
    process.exit(1);
  }
  logSuccess(`${scan.fileCount} entries (${formatBytes(scan.totalSizeBytes)})`);

  // Step 2: Verify services
  logStep(2, 4, "Checking services...");
  const services = await checkAllServices();
  const unhealthy = services.filter((s) => !s.healthy);

  if (unhealthy.length > 0) {
    for (const s of unhealthy) {
      logError(`${s.name} — not running`);
    }
    logWarning("Start services first: npx corpus-intelligence");
    process.exit(1);
  }
  logSuccess("All services healthy");

  // Step 3: Run pipelines
  logStep(3, 4, "Running ingestion pipelines...");
  const results: PipelineResult[] = [];

  for (let i = 0; i < PIPELINES.length; i++) {
    const pipeline = PIPELINES[i];
    console.log();
    logInfo(`${c.bold(pipeline.name)} ${c.dim(`(${i + 1}/${PIPELINES.length})`)}`);

    const bar = createProgressBar(pipeline.name);
    let barStarted = false;

    const spinner = createSpinner(`${pipeline.name}...`);
    spinner.start();

    const result = await runPipeline(pipeline, projectRoot, (update) => {
      if (!barStarted && update.total > 0) {
        spinner.stop();
        bar.start(update.total, 0);
        barStarted = true;
      }
      if (barStarted) {
        bar.update(update.current);
      }
    });

    if (barStarted) {
      bar.stop();
    } else {
      spinner.stop();
    }

    if (result.success) {
      const stats = Object.entries(result.summary)
        .map(([k, v]) => `${v} ${k}`)
        .join(", ");
      logSuccess(
        `${pipeline.name} — ${formatDuration(result.durationMs)}${stats ? ` (${stats})` : ""}`,
      );
    } else {
      logError(`${pipeline.name} — failed: ${result.error}`);
    }

    results.push(result);
  }

  // Step 4: Summary
  logStep(4, 4, "Complete!");
  console.log();

  const summaryLines = results.map((r) => {
    const status = r.success ? c.success("OK") : c.error("FAIL");
    const stats = Object.entries(r.summary)
      .map(([k, v]) => `${v} ${k}`)
      .join(", ");
    return `  ${status}  ${r.name.padEnd(22)} ${formatDuration(r.durationMs).padStart(8)}  ${c.dim(stats)}`;
  });

  const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);
  const failed = results.filter((r) => !r.success).length;

  console.log(
    boxen(
      [
        c.accent("Ingestion Summary"),
        "",
        ...summaryLines,
        "",
        `  Total: ${formatDuration(totalDuration)}${failed > 0 ? `  ${c.error(`${failed} failed`)}` : ""}`,
        "",
        `  ${c.dim("MCP tools available at")} ${c.info("http://127.0.0.1:3001/sse")}`,
      ].join("\n"),
      {
        padding: 1,
        borderStyle: "round",
        borderColor: failed > 0 ? "#f87171" : "#7c6aff",
      },
    ),
  );
  console.log();

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  logError(String(err));
  process.exit(1);
});
