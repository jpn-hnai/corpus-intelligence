import { select, password as passwordPrompt } from "@inquirer/prompts";
import { c } from "../ui/colors.js";
import { logSuccess, logInfo } from "../ui/log.js";
import { config } from "../config/store.js";

export async function runAuth(): Promise<{ apiKey: string }> {
  // Check for previously stored key
  const existing = config.get("apiKey");
  if (existing) {
    const masked = existing.slice(0, 10) + "..." + existing.slice(-4);
    logInfo(`Using stored API key: ${c.dim(masked)}`);
    return { apiKey: existing };
  }

  const method = await select({
    message: "How would you like to authenticate?",
    choices: [
      {
        value: "api-key",
        name: "API Key",
        description: "Pay-per-use. ~$0.25/1M input tokens (Haiku)",
      },
      {
        value: "subscription",
        name: "Claude Subscription (coming soon)",
        description: "Use your Pro/Max/Team plan via OAuth",
      },
    ],
  });

  if (method === "subscription") {
    console.log();
    logInfo("Subscription auth is coming soon!");
    logInfo("For now, you'll need an API key from console.anthropic.com");
    console.log();
  }

  const apiKey = await passwordPrompt({
    message: "Anthropic API key:",
    mask: "*",
    validate: (value) => {
      if (!value.startsWith("sk-ant-")) {
        return "API key should start with sk-ant-";
      }
      return true;
    },
  });

  config.set("apiKey", apiKey);
  logSuccess("API key saved");

  return { apiKey };
}
