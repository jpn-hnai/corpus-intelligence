function getEmbeddingsUrl(): string {
  return process.env.EMBEDDINGS_SERVICE_URL || "http://embeddings-service:8000";
}

interface SearchResult {
  text: string;
  date: string;
  source_file: string;
  relevance_score: number;
  word_count?: number;
}

interface SearchResponse {
  query: string;
  results: SearchResult[];
}

interface Entry {
  date: string;
  filename: string;
  word_count: number;
  text: string;
}

interface EntriesResponse {
  start_date: string;
  end_date: string;
  count: number;
  entries: Entry[];
}

interface ThemesResponse {
  topic: string;
  results: SearchResult[];
}

interface StatsResponse {
  total_chunks: number;
  total_entries: number;
  total_words: number;
  date_range: {
    earliest: string | null;
    latest: string | null;
  };
  avg_words_per_entry: number;
  entries_per_year: Record<string, number>;
}

interface RecentResponse {
  count: number;
  entries: Entry[];
}

interface KeywordMatch {
  date: string;
  filename: string;
  context: string;
}

interface KeywordResponse {
  keyword: string;
  total_matches: number;
  results: KeywordMatch[];
}

interface HealthResponse {
  status: string;
  index_ready: boolean;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  requestId?: string
): Promise<T> {
  const baseUrl = getEmbeddingsUrl();
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
      `Embeddings service unavailable at ${baseUrl}. Is docker compose up running?`
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
    throw new Error(
      `Embeddings service error (${response.status}): ${detail}`
    );
  }

  return response.json() as Promise<T>;
}

export async function searchWritings(
  query: string,
  topK: number = 5,
  signal?: AbortSignal,
  requestId?: string
): Promise<SearchResponse> {
  return request<SearchResponse>("POST", "/search", { query, top_k: topK }, signal, requestId);
}

export async function getEntriesByDate(
  startDate: string,
  endDate: string,
  signal?: AbortSignal,
  requestId?: string
): Promise<EntriesResponse> {
  return request<EntriesResponse>(
    "GET",
    `/entries?start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`,
    undefined,
    signal,
    requestId
  );
}

export async function findRecurringThemes(
  topic: string,
  topK: number = 10,
  signal?: AbortSignal,
  requestId?: string
): Promise<ThemesResponse> {
  return request<ThemesResponse>("POST", "/themes", { topic, top_k: topK }, signal, requestId);
}

export async function getWritingStats(
  signal?: AbortSignal,
  requestId?: string
): Promise<StatsResponse> {
  return request<StatsResponse>("GET", "/stats", undefined, signal, requestId);
}

export async function getRecentEntries(
  n: number = 7,
  signal?: AbortSignal,
  requestId?: string
): Promise<RecentResponse> {
  return request<RecentResponse>("GET", `/recent?n=${n}`, undefined, signal, requestId);
}

export async function searchByKeyword(
  keyword: string,
  contextWords: number = 100,
  signal?: AbortSignal,
  requestId?: string
): Promise<KeywordResponse> {
  return request<KeywordResponse>("POST", "/keyword", {
    keyword,
    context_words: contextWords,
  }, signal, requestId);
}

export async function healthCheck(requestId?: string): Promise<HealthResponse> {
  return request<HealthResponse>("GET", "/health", undefined, undefined, requestId);
}

interface EmbedResponse {
  embeddings: number[][];
}

export async function embedTexts(
  texts: string[],
  signal?: AbortSignal,
  requestId?: string
): Promise<number[][]> {
  const resp = await request<EmbedResponse>("POST", "/embed", { texts }, signal, requestId);
  return resp.embeddings;
}
