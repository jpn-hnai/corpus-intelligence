import { execa } from "execa";
import { createSpinner } from "../ui/spinner.js";
import { logSuccess, logError } from "../ui/log.js";

export async function buildImages(projectRoot: string): Promise<void> {
  const spinner = createSpinner("Building Docker images (this may take a few minutes on first run)...");
  spinner.start();

  try {
    const proc = execa("docker", ["compose", "build"], {
      cwd: projectRoot,
      stdio: "pipe",
      timeout: 600_000, // 10 minutes
    });

    // Parse build output for progress updates
    let currentService = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      // Docker BuildKit outputs progress like: #5 [embeddings-service 3/8] RUN ...
      const serviceMatch = text.match(/\[([a-z-]+)\s+(\d+)\/(\d+)\]/);
      if (serviceMatch) {
        const [, service, step, total] = serviceMatch;
        if (service !== currentService) {
          currentService = service;
          spinner.text = `Building ${service} (step ${step}/${total})...`;
        } else {
          spinner.text = `Building ${service} (step ${step}/${total})...`;
        }
      }
    });

    await proc;
    spinner.succeed("Docker images built");
  } catch (err) {
    spinner.fail("Docker build failed");
    if (err instanceof Error && "stderr" in err) {
      const stderr = (err as { stderr: string }).stderr;
      // Show last few lines of stderr for context
      const lines = stderr.trim().split("\n").slice(-5);
      for (const line of lines) {
        logError(line);
      }
    }
    throw err;
  }
}
