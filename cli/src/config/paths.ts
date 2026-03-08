import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getProjectRoot(): string {
  // CLI lives at cli/dist/, project root is two levels up
  const candidate = path.resolve(__dirname, "../..");
  if (fs.existsSync(path.join(candidate, "docker-compose.yml"))) {
    return candidate;
  }
  // Fallback: walk up from cwd
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "docker-compose.yml"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error(
    "Cannot find project root (no docker-compose.yml found). Run from the corpus-intelligence directory.",
  );
}

export function getEnvPath(): string {
  return path.join(getProjectRoot(), ".env");
}

export function getClaudeDesktopConfigPath(): string {
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json",
    );
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      "Claude",
      "claude_desktop_config.json",
    );
  }
  return path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json");
}
