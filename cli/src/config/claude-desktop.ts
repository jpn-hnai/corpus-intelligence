import fs from "node:fs";
import path from "node:path";
import { getClaudeDesktopConfigPath } from "./paths.js";
import { logSuccess, logWarning, logInfo } from "../ui/log.js";

const MCP_CONFIG = {
  url: "http://127.0.0.1:3001/sse",
};

export async function injectClaudeDesktopConfig(): Promise<{
  injected: boolean;
  configPath: string;
}> {
  const configPath = getClaudeDesktopConfigPath();
  const configDir = path.dirname(configPath);

  if (!fs.existsSync(configDir)) {
    logWarning("Claude Desktop not found");
    logInfo("Add this to your MCP client config manually:");
    console.log();
    console.log(
      JSON.stringify(
        { mcpServers: { "corpus-intelligence": MCP_CONFIG } },
        null,
        2,
      ),
    );
    console.log();
    return { injected: false, configPath };
  }

  let existing: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
      logWarning("Could not parse existing Claude Desktop config — creating fresh");
    }
  }

  const mcpServers = (existing.mcpServers ?? {}) as Record<string, unknown>;
  mcpServers["corpus-intelligence"] = MCP_CONFIG;
  existing.mcpServers = mcpServers;

  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
  logSuccess(`Claude Desktop config updated: ${configPath}`);

  return { injected: true, configPath };
}
