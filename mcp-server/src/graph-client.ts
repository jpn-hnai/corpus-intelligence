function getGraphUrl(): string {
  return process.env.GRAPH_SERVICE_URL || "http://graph-service:8001";
}

async function graphRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  requestId?: string
): Promise<T> {
  const baseUrl = getGraphUrl();
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
      `Graph service unavailable at ${baseUrl}. Is docker compose up running?`
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
    throw new Error(`Graph service error (${response.status}): ${detail}`);
  }

  return response.json() as Promise<T>;
}

export async function graphSearch(
  query: string,
  topK: number = 5,
  signal?: AbortSignal,
  requestId?: string
): Promise<Record<string, unknown>> {
  return graphRequest("POST", "/graph/search", { query, top_k: topK }, signal, requestId);
}

export async function findConnectedConcepts(
  name: string,
  limit: number = 30,
  signal?: AbortSignal,
  requestId?: string
): Promise<Record<string, unknown>> {
  return graphRequest(
    "GET",
    `/graph/concept/${encodeURIComponent(name)}?limit=${limit}`,
    undefined,
    signal,
    requestId
  );
}

export async function findEntityRelationships(
  name: string,
  limit: number = 30,
  signal?: AbortSignal,
  requestId?: string
): Promise<Record<string, unknown>> {
  return graphRequest(
    "GET",
    `/graph/person/${encodeURIComponent(name)}?limit=${limit}`,
    undefined,
    signal,
    requestId
  );
}

export async function traceConceptEvolution(
  name: string,
  limit: number = 20,
  signal?: AbortSignal,
  requestId?: string
): Promise<Record<string, unknown>> {
  return graphRequest(
    "GET",
    `/graph/evolution/${encodeURIComponent(name)}?limit=${limit}`,
    undefined,
    signal,
    requestId
  );
}

export async function comparePeriods(
  start1: string,
  end1: string,
  start2: string,
  end2: string,
  signal?: AbortSignal,
  requestId?: string
): Promise<Record<string, unknown>> {
  return graphRequest("POST", "/graph/compare", { start1, end1, start2, end2 }, signal, requestId);
}

export async function getDecisionContext(
  keyword?: string,
  limit: number = 10,
  signal?: AbortSignal,
  requestId?: string
): Promise<Record<string, unknown>> {
  return graphRequest("POST", "/graph/decision_context", { keyword, limit }, signal, requestId);
}

export async function getArchetypePatterns(
  limit: number = 10,
  signal?: AbortSignal,
  requestId?: string
): Promise<Record<string, unknown>> {
  return graphRequest("GET", `/graph/archetypes?limit=${limit}`, undefined, signal, requestId);
}

export async function getConceptFlows(
  name: string,
  limit: number = 20,
  signal?: AbortSignal,
  requestId?: string
): Promise<Record<string, unknown>> {
  return graphRequest(
    "GET",
    `/graph/flows/${encodeURIComponent(name)}?limit=${limit}`,
    undefined,
    signal,
    requestId
  );
}

export interface GraphFeedbackPayload {
  signal: "up" | "down";
  query?: string;
  note?: string;
  concepts?: string[];
  people?: string[];
  places?: string[];
  sources?: string[];
}

export async function submitGraphFeedback(
  payload: GraphFeedbackPayload,
  signal?: AbortSignal,
  requestId?: string
): Promise<Record<string, unknown>> {
  return graphRequest("POST", "/graph/feedback", payload, signal, requestId);
}

export async function getGraphFeedbackProfile(
  topN: number = 15,
  signal?: AbortSignal,
  requestId?: string
): Promise<Record<string, unknown>> {
  return graphRequest(
    "GET",
    `/graph/feedback_profile?top_n=${topN}`,
    undefined,
    signal,
    requestId
  );
}

export async function getGraphFeedbackReview(
  topN: number = 15,
  recentLimit: number = 40,
  signal?: AbortSignal,
  requestId?: string
): Promise<Record<string, unknown>> {
  return graphRequest(
    "GET",
    `/graph/feedback_review?top_n=${topN}&recent_limit=${recentLimit}`,
    undefined,
    signal,
    requestId
  );
}

export async function getGraphFeedbackHealth(
  signal?: AbortSignal,
  requestId?: string
): Promise<Record<string, unknown>> {
  return graphRequest("GET", "/graph/feedback/health", undefined, signal, requestId);
}

export async function getGraphFeedbackTuningPreview(
  signal?: AbortSignal,
  requestId?: string
): Promise<Record<string, unknown>> {
  return graphRequest("GET", "/graph/feedback/tuning_preview", undefined, signal, requestId);
}

export async function applyGraphFeedbackTuning(
  signal?: AbortSignal,
  requestId?: string
): Promise<Record<string, unknown>> {
  return graphRequest("POST", "/graph/feedback/apply_tuning", undefined, signal, requestId);
}

export async function aggregateGraphFeedback(
  signal?: AbortSignal,
  requestId?: string
): Promise<Record<string, unknown>> {
  return graphRequest("POST", "/graph/feedback/aggregate", undefined, signal, requestId);
}

export async function getGraphSubgraph(
  center: string,
  depth: number = 1,
  limit: number = 50,
  signal?: AbortSignal,
  requestId?: string
): Promise<Record<string, unknown>> {
  return graphRequest(
    "GET",
    `/graph/subgraph?center=${encodeURIComponent(center)}&depth=${depth}&limit=${limit}`,
    undefined,
    signal,
    requestId
  );
}

export async function getThemeNetwork(
  name: string,
  limit: number = 30,
  signal?: AbortSignal,
  requestId?: string
): Promise<Record<string, unknown>> {
  return graphRequest(
    "GET",
    `/graph/theme/${encodeURIComponent(name)}?limit=${limit}`,
    undefined,
    signal,
    requestId
  );
}

export async function getEntriesByState(
  dimension: string,
  minScore: number = -1,
  maxScore: number = 1,
  limit: number = 20,
  signal?: AbortSignal,
  requestId?: string
): Promise<Record<string, unknown>> {
  return graphRequest(
    "GET",
    `/graph/entries_by_state?dimension=${encodeURIComponent(dimension)}&min_score=${minScore}&max_score=${maxScore}&limit=${limit}`,
    undefined,
    signal,
    requestId
  );
}

export async function getOrganizationNetwork(
  name: string,
  limit: number = 30,
  signal?: AbortSignal,
  requestId?: string
): Promise<Record<string, unknown>> {
  return graphRequest(
    "GET",
    `/graph/organization/${encodeURIComponent(name)}?limit=${limit}`,
    undefined,
    signal,
    requestId
  );
}

export async function graphHealthCheck(requestId?: string): Promise<Record<string, unknown>> {
  return graphRequest("GET", "/health", undefined, undefined, requestId);
}
