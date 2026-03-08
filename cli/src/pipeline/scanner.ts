import fs from "node:fs";
import path from "node:path";

export interface ScanResult {
  corpusPath: string;
  fileCount: number;
  totalSizeBytes: number;
}

export function scanCorpus(corpusPath: string): ScanResult {
  const resolved = path.resolve(corpusPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Corpus path not found: ${resolved}`);
  }

  let fileCount = 0;
  let totalSizeBytes = 0;

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name.startsWith("._")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".md")) {
        fileCount++;
        totalSizeBytes += fs.statSync(full).size;
      }
    }
  }

  walk(resolved);
  return { corpusPath: resolved, fileCount, totalSizeBytes };
}
