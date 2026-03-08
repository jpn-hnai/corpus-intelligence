function getAnalysisUrl(): string {
  return process.env.ANALYSIS_SERVICE_URL || "http://analysis-service:8002";
}

export interface AnalysisVersion {
  schema_version: string;
  prompt_version: string;
  model_version: string;
  mock: boolean;
}

export interface AnalysisProvenance {
  chunk_ids: string[];
  spans: Array<{
    chunk_id: string;
    source_file?: string;
    start_char: number;
    end_char: number;
    excerpt?: string;
  }>;
}

export interface SummarizeEntryRequest {
  entry_id: string;
  text: string;
  entry_date?: string;
  source_file?: string;
  chunk_ids?: string[];
  max_summary_sentences?: number;
}

export interface SummarizeEntryResponse {
  analysis_id: string;
  entry_id: string;
  granularity: "entry";
  summary: string;
  highlights: string[];
  key_terms: string[];
  coverage_ratio: number;
  provenance: AnalysisProvenance;
  version: AnalysisVersion;
}

export interface StateLabelRequest {
  entry_id: string;
  text: string;
  entry_date?: string;
  source_file?: string;
  chunk_ids?: string[];
}

export interface StateLabelResponse {
  analysis_id: string;
  entry_id: string;
  state_profile: {
    score_range: {
      min: number;
      max: number;
    };
    dimensions: Array<{
      dimension:
        | "valence"
        | "activation"
        | "agency"
        | "certainty"
        | "relational_openness"
        | "self_trust"
        | "time_orientation"
        | "integration";
      score: number;
      low_anchor: string;
      high_anchor: string;
      label: string;
      evidence_spans: Array<{
        chunk_id: string;
        source_file?: string;
        start_char: number;
        end_char: number;
        excerpt?: string;
      }>;
    }>;
  };
  observed_text_signals: Array<{
    signal_id: string;
    signal: string;
    category: string;
    direction: "low" | "high" | "neutral";
    dimensions: string[];
    weight: number;
    evidence_spans: Array<{
      chunk_id: string;
      source_file?: string;
      start_char: number;
      end_char: number;
      excerpt?: string;
    }>;
  }>;
  inferred_state_labels: Array<{
    dimension: string;
    label: string;
    score: number;
    rationale: string;
    supporting_signal_ids: string[];
    confidence: number;
  }>;
  confidence: {
    overall: number;
    by_dimension: Array<{
      dimension: string;
      value: number;
    }>;
  };
  provenance: AnalysisProvenance;
  version: AnalysisVersion;
}

export interface ContextPacketRequest {
  query: string;
  date_start?: string;
  date_end?: string;
  top_k?: number;
  retrieval_hits?: Array<{
    chunk_id: string;
    source_file?: string;
    excerpt: string;
    relevance_score?: number;
  }>;
  graph_signals?: Array<{
    subject: string;
    relation: string;
    object: string;
    weight?: number;
  }>;
}

export interface ContextPacketResponse {
  packet_id: string;
  query: string;
  temporal_focus: string;
  retrieval_context: Array<{
    chunk_id: string;
    source_file?: string;
    relevance_score: number;
    rationale: string;
  }>;
  graph_context: Array<{
    subject: string;
    relation: string;
    object: string;
    weight: number;
  }>;
  context_brief: string;
  provenance: AnalysisProvenance;
  version: AnalysisVersion;
}

async function analysisRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  requestId?: string
): Promise<T> {
  const baseUrl = getAnalysisUrl();
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (requestId) {
    headers["x-request-id"] = requestId;
  }
  const options: RequestInit = {
    method,
    headers,
    signal,
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(url, options);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw err;
    }
    throw new Error(
      `Analysis service unavailable at ${baseUrl}. Is docker compose up running?`
    );
  }

  if (!response.ok) {
    let detail = "";
    try {
      const rawText = await response.text();
      try {
        const errBody = JSON.parse(rawText) as { detail?: string };
        detail = errBody.detail || rawText;
      } catch {
        detail = rawText;
      }
    } catch {
      detail = "(could not read error body)";
    }
    throw new Error(`Analysis service error (${response.status}): ${detail}`);
  }

  return response.json() as Promise<T>;
}

export async function summarizeEntry(
  payload: SummarizeEntryRequest,
  signal?: AbortSignal,
  requestId?: string
): Promise<SummarizeEntryResponse> {
  return analysisRequest("POST", "/summarize/entry", payload, signal, requestId);
}

export async function labelEntryState(
  payload: StateLabelRequest,
  signal?: AbortSignal,
  requestId?: string
): Promise<StateLabelResponse> {
  return analysisRequest("POST", "/state/label", payload, signal, requestId);
}

export async function buildContextPacket(
  payload: ContextPacketRequest,
  signal?: AbortSignal,
  requestId?: string
): Promise<ContextPacketResponse> {
  return analysisRequest("POST", "/context/packet", payload, signal, requestId);
}

export async function analysisHealthCheck(requestId?: string): Promise<Record<string, unknown>> {
  return analysisRequest("GET", "/health", undefined, undefined, requestId);
}

// --- Entry summary (provider-based, pre-computed) ---

export interface EntrySummaryStateDimension {
  dimension: string;
  score: number;
  low_anchor: string;
  high_anchor: string;
  label: string;
}

export interface EntrySummaryStateProfile {
  score_range: { min: number; max: number };
  dimensions: EntrySummaryStateDimension[];
}

export interface EntrySummaryProcessing {
  provider: string;
  mock: boolean;
  model_version: string;
  prompt_version: string;
  schema_version: string;
  created_at: string;
}

export interface TypedEntity {
  name: string;
  type: "person" | "place" | "organization" | "concept" | "spiritual";
}

export interface EntrySummaryRecord {
  entry_id: string;
  entry_date: string | null;
  source_file: string | null;
  short_summary: string;
  detailed_summary: string;
  themes: string[];
  entities: TypedEntity[];
  decisions_actions: string[];
  state_profile: EntrySummaryStateProfile;
  provenance: AnalysisProvenance;
  processing: EntrySummaryProcessing;
}

export async function getEntrySummary(
  entryId: string,
  signal?: AbortSignal,
  requestId?: string
): Promise<EntrySummaryRecord | null> {
  const url = `${getAnalysisUrl()}/entry-summary/${encodeURIComponent(entryId)}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (requestId) {
    headers["x-request-id"] = requestId;
  }

  let response: Response;
  try {
    response = await fetch(url, { method: "GET", headers, signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    return null;
  }

  if (response.status === 404) return null;
  if (!response.ok) return null;

  return response.json() as Promise<EntrySummaryRecord>;
}

export async function getEntrySummaries(
  entryIds: string[],
  signal?: AbortSignal,
  requestId?: string
): Promise<Map<string, EntrySummaryRecord>> {
  const results = new Map<string, EntrySummaryRecord>();
  if (entryIds.length === 0) return results;

  const unique = [...new Set(entryIds)];
  const settled = await Promise.allSettled(
    unique.map((id) => getEntrySummary(id, signal, requestId))
  );

  for (let i = 0; i < unique.length; i++) {
    const outcome = settled[i];
    if (outcome.status === "fulfilled" && outcome.value) {
      results.set(unique[i], outcome.value);
    }
  }

  return results;
}
