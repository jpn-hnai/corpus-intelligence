import type { PipelineConfig } from "./runner.js";
import {
  createEmbeddingsParser,
  createGraphIngestParser,
  createBatchAnalysisParser,
  createGraphEnrichParser,
  createTimeseriesParser,
} from "./parsers.js";

export const PIPELINES: PipelineConfig[] = [
  {
    name: "Vector Embeddings",
    profile: "ingest",
    service: "ingest",
    args: [],
    parser: createEmbeddingsParser(),
  },
  {
    name: "Knowledge Graph",
    profile: "graph-ingest",
    service: "graph-ingest",
    args: [],
    parser: createGraphIngestParser(),
  },
  {
    name: "Entry Analysis",
    profile: "batch-analysis",
    service: "batch-analysis",
    args: ["--provider", "anthropic", "--workers", "5"],
    parser: createBatchAnalysisParser(),
  },
  {
    name: "Graph Enrichment",
    profile: "graph-enrich",
    service: "graph-enrich",
    args: [],
    parser: createGraphEnrichParser(),
  },
  {
    name: "Timeseries Backfill",
    profile: "backfill-timeseries",
    service: "backfill-timeseries",
    args: [],
    parser: createTimeseriesParser(),
  },
];
