import { execa } from "execa";
import type { PipelineParser, ProgressUpdate } from "./parsers.js";

export interface PipelineConfig {
  name: string;
  profile: string;
  service: string;
  args: string[];
  parser: PipelineParser;
}

export interface PipelineResult {
  name: string;
  success: boolean;
  durationMs: number;
  summary: Record<string, number>;
  error?: string;
}

export async function runPipeline(
  config: PipelineConfig,
  projectRoot: string,
  onProgress?: (update: ProgressUpdate) => void,
): Promise<PipelineResult> {
  const start = Date.now();
  const allLines: string[] = [];

  try {
    const proc = execa(
      "docker",
      [
        "compose",
        "--profile", config.profile,
        "run", "--rm",
        config.service,
        ...config.args,
      ],
      {
        cwd: projectRoot,
        stdio: "pipe",
        timeout: 1_800_000, // 30 minutes max per pipeline
      },
    );

    function processOutput(chunk: Buffer): void {
      const text = chunk.toString();
      // Handle both \r and \n delimited lines (tqdm uses \r)
      const lines = text.split(/[\r\n]+/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        allLines.push(trimmed);
        if (onProgress) {
          const update = config.parser.parseLine(trimmed);
          if (update) onProgress(update);
        }
      }
    }

    proc.stdout?.on("data", processOutput);
    proc.stderr?.on("data", processOutput);

    await proc;

    return {
      name: config.name,
      success: true,
      durationMs: Date.now() - start,
      summary: config.parser.parseSummary(allLines),
    };
  } catch (err) {
    return {
      name: config.name,
      success: false,
      durationMs: Date.now() - start,
      summary: config.parser.parseSummary(allLines),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
