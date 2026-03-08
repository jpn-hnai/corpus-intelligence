import { execa, type ResultPromise } from "execa";

export function compose(
  args: string[],
  projectRoot: string,
  opts?: { overlay?: boolean },
): ResultPromise {
  const files = ["-f", "docker-compose.yml"];
  if (opts?.overlay) {
    files.push("-f", "docker-compose.neo4j-ports.yml");
  }
  return execa("docker", ["compose", ...files, ...args], {
    cwd: projectRoot,
    stdio: "pipe",
  });
}

export async function isDockerRunning(): Promise<boolean> {
  try {
    await execa("docker", ["info"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export async function getDockerVersion(): Promise<string | null> {
  try {
    const { stdout } = await execa("docker", ["--version"], { stdio: "pipe" });
    const match = stdout.match(/Docker version ([\d.]+)/);
    return match ? match[1] : stdout.trim();
  } catch {
    return null;
  }
}
