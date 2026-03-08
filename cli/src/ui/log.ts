import { c } from "./colors.js";

export function logStep(n: number, total: number, text: string): void {
  console.log(`\n  ${c.accent(`[${n}/${total}]`)} ${text}`);
}

export function logSuccess(text: string): void {
  console.log(`  ${c.success("✓")} ${text}`);
}

export function logWarning(text: string): void {
  console.log(`  ${c.warning("!")} ${text}`);
}

export function logError(text: string): void {
  console.log(`  ${c.error("✗")} ${text}`);
}

export function logInfo(text: string): void {
  console.log(`  ${c.info("→")} ${text}`);
}
