export interface ProgressUpdate {
  current: number;
  total: number;
  label?: string;
}

export interface PipelineParser {
  parseLine(line: string): ProgressUpdate | null;
  parseSummary(lines: string[]): Record<string, number>;
}

// ---------------------------------------------------------------------------
// Vector Embeddings (tqdm + logging)
// ---------------------------------------------------------------------------
export function createEmbeddingsParser(): PipelineParser {
  // tqdm: Processing files: 45%|████ | 234/520 [...]
  const tqdmRe = /(\d+)%\|[^|]*\|\s*(\d+)\/(\d+)/;
  // Summary: N chunks indexed
  const chunksRe = /(\d+)\s+chunks\s+indexed/;
  const filesRe = /(\d+)\s+files?\s+processed/;

  return {
    parseLine(line) {
      const m = tqdmRe.exec(line);
      if (m) return { current: parseInt(m[2], 10), total: parseInt(m[3], 10) };
      return null;
    },
    parseSummary(lines) {
      const stats: Record<string, number> = {};
      for (const line of lines) {
        const cm = chunksRe.exec(line);
        if (cm) stats.chunks = parseInt(cm[1], 10);
        const fm = filesRe.exec(line);
        if (fm) stats.files = parseInt(fm[1], 10);
      }
      return stats;
    },
  };
}

// ---------------------------------------------------------------------------
// Graph Ingest
// ---------------------------------------------------------------------------
export function createGraphIngestParser(): PipelineParser {
  // Progress: 50/520 files processed
  const progressRe = /Progress:\s*(\d+)\/(\d+)\s+files?\s+processed/;
  const entriesRe = /(\d+)\s+entries?\s+processed/;
  const errorsRe = /(\d+)\s+errors?/;
  const nodesRe = /(\w+):\s+(\d+)\s+nodes?/;
  const relsRe = /(\w+):\s+(\d+)\s+relationships?/;

  return {
    parseLine(line) {
      const m = progressRe.exec(line);
      if (m) return { current: parseInt(m[1], 10), total: parseInt(m[2], 10) };
      return null;
    },
    parseSummary(lines) {
      const stats: Record<string, number> = {};
      let totalNodes = 0;
      let totalRels = 0;
      for (const line of lines) {
        const em = entriesRe.exec(line);
        if (em) stats.entries = parseInt(em[1], 10);
        const erm = errorsRe.exec(line);
        if (erm) stats.errors = parseInt(erm[1], 10);
        const nm = nodesRe.exec(line);
        if (nm) totalNodes += parseInt(nm[2], 10);
        const rm = relsRe.exec(line);
        if (rm) totalRels += parseInt(rm[2], 10);
      }
      if (totalNodes) stats.nodes = totalNodes;
      if (totalRels) stats.relationships = totalRels;
      return stats;
    },
  };
}

// ---------------------------------------------------------------------------
// Batch Analysis (JSON lines)
// ---------------------------------------------------------------------------
export function createBatchAnalysisParser(): PipelineParser {
  // Progress: 10/520 analyzed (0 errors)
  const progressRe = /Progress:\s*(\d+)\/(\d+)\s+analyzed/;
  const analyzedRe = /(\d+)\s+analyzed/;
  const skippedRe = /(\d+)\s+skipped/;
  const errorsRe = /(\d+)\s+errors?/;

  return {
    parseLine(line) {
      // Handle JSON lines — extract message field
      let text = line;
      if (line.trimStart().startsWith("{")) {
        try {
          const obj = JSON.parse(line) as { message?: string };
          if (obj.message) text = obj.message;
        } catch {
          // Not JSON, use raw line
        }
      }
      const m = progressRe.exec(text);
      if (m) return { current: parseInt(m[1], 10), total: parseInt(m[2], 10) };
      return null;
    },
    parseSummary(lines) {
      const stats: Record<string, number> = {};
      for (const raw of lines) {
        let line = raw;
        if (raw.trimStart().startsWith("{")) {
          try {
            const obj = JSON.parse(raw) as { message?: string };
            if (obj.message) line = obj.message;
          } catch {
            // ignore
          }
        }
        const am = analyzedRe.exec(line);
        if (am) stats.analyzed = parseInt(am[1], 10);
        const sm = skippedRe.exec(line);
        if (sm) stats.skipped = parseInt(sm[1], 10);
        const em = errorsRe.exec(line);
        if (em) stats.errors = parseInt(em[1], 10);
      }
      return stats;
    },
  };
}

// ---------------------------------------------------------------------------
// Graph Enrichment
// ---------------------------------------------------------------------------
export function createGraphEnrichParser(): PipelineParser {
  // Processed 100/715...
  const progressRe = /Processed\s+(\d+)\/(\d+)/;
  const entriesRe = /Entries\s+processed:\s+(\d+)/;
  const themesRe = /Themes\s+created:\s+(\d+)/;
  const entitiesRe = /Entities\s+merged:\s+(\d+)/;
  const statesRe = /State\s+profiles\s+set:\s+(\d+)/;

  return {
    parseLine(line) {
      const m = progressRe.exec(line);
      if (m) return { current: parseInt(m[1], 10), total: parseInt(m[2], 10) };
      return null;
    },
    parseSummary(lines) {
      const stats: Record<string, number> = {};
      for (const line of lines) {
        const em = entriesRe.exec(line);
        if (em) stats.entries = parseInt(em[1], 10);
        const tm = themesRe.exec(line);
        if (tm) stats.themes = parseInt(tm[1], 10);
        const enm = entitiesRe.exec(line);
        if (enm) stats.entities = parseInt(enm[1], 10);
        const sm = statesRe.exec(line);
        if (sm) stats.states = parseInt(sm[1], 10);
      }
      return stats;
    },
  };
}

// ---------------------------------------------------------------------------
// Timeseries Backfill
// ---------------------------------------------------------------------------
export function createTimeseriesParser(): PipelineParser {
  // Done: 718 inserted, 0 skipped, 0 errors
  const insertedRe = /(\d+)\s+inserted/;
  const skippedRe = /(\d+)\s+skipped/;

  return {
    parseLine(_line) {
      // No intermediate progress — runs fast
      return null;
    },
    parseSummary(lines) {
      const stats: Record<string, number> = {};
      for (const line of lines) {
        const im = insertedRe.exec(line);
        if (im) stats.inserted = parseInt(im[1], 10);
        const sm = skippedRe.exec(line);
        if (sm) stats.skipped = parseInt(sm[1], 10);
      }
      return stats;
    },
  };
}
