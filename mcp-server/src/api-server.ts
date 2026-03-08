import express from "express";
import {
  runAgent,
  checkOllamaHealth,
  type ChatMode,
  type SSEEvent,
} from "./agent.js";
import {
  getGraphSubgraph,
  graphHealthCheck,
  submitGraphFeedback,
  getGraphFeedbackProfile,
  getGraphFeedbackReview,
  getGraphFeedbackHealth,
  getGraphFeedbackTuningPreview,
  applyGraphFeedbackTuning,
  aggregateGraphFeedback,
} from "./graph-client.js";
import {
  summarizeEntry,
  labelEntryState,
  buildContextPacket,
  analysisHealthCheck,
  type ContextPacketRequest,
} from "./analysis-client.js";

import { randomUUID } from "node:crypto";
import { getLastTrace } from "./request-trace.js";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { registerTools } from "./tools.js";
import { registerTimeSeriesTools } from "./timeseries/tools.js";
import { registerGravityTools } from "./gravity/tools.js";

const app = express();
const PORT = 3001;

app.use(express.json({ limit: "1mb" }));

function getRequestId(req: express.Request): string {
  const header = req.headers["x-request-id"];
  const value = Array.isArray(header) ? header[0] : header;
  return (typeof value === "string" && value.trim()) ? value.trim() : randomUUID();
}

function parseBoundedInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function toOptionalString(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLen);
}

function toStringList(value: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed.slice(0, maxLen));
    if (result.length >= maxItems) break;
  }

  return result;
}

interface ModelInfo {
  id: string;
  label: string;
  size_gb: number | null;
}

const OLLAMA_URL = process.env.OLLAMA_URL || "http://host.docker.internal:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "llama3.2";

function formatBytes(bytes: number): number | null {
  if (!bytes || bytes <= 0) return null;
  return Math.round((bytes / 1e9) * 10) / 10;
}

app.get("/models", async (_req, res) => {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!response.ok) {
      res.status(502).json({ error: `Ollama returned ${response.status}` });
      return;
    }
    const data = (await response.json()) as {
      models?: Array<{ name?: string; size?: number; details?: { parameter_size?: string } }>;
    };
    const models: ModelInfo[] = (data.models || []).map((m) => ({
      id: m.name || "",
      label: m.name || "",
      size_gb: formatBytes(m.size || 0),
    }));
    res.json({ models, default: DEFAULT_MODEL });
  } catch {
    res.json({ models: [], default: DEFAULT_MODEL });
  }
});

app.post("/chat", async (req, res) => {
  const { message, conversation_id, graphrag, mode, replace_last_user, request_id, model } = req.body as {
    message?: string;
    conversation_id?: string;
    graphrag?: boolean;
    mode?: ChatMode;
    replace_last_user?: boolean;
    request_id?: string;
    model?: string;
  };

  const trimmedMessage = typeof message === "string" ? message.trim() : "";
  const conversationId =
    typeof conversation_id === "string" ? conversation_id.trim() : "";
  const requestId =
    typeof request_id === "string" ? request_id.trim() || undefined : undefined;
  const chatMode: ChatMode = mode === "converse" ? "converse" : "classic";
  const modelOverride = typeof model === "string" ? model.trim().slice(0, 64) || undefined : undefined;

  if (!trimmedMessage || !conversationId) {
    res.status(400).json({ error: "message and conversation_id are required" });
    return;
  }
  if (trimmedMessage.length > 4000) {
    res.status(400).json({ error: "message exceeds 4000 character limit" });
    return;
  }
  if (conversationId.length > 128) {
    res.status(400).json({ error: "conversation_id exceeds 128 character limit" });
    return;
  }
  if (requestId && requestId.length > 128) {
    res.status(400).json({ error: "request_id exceeds 128 character limit" });
    return;
  }

  // Set up SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const abortController = new AbortController();
  let clientDisconnected = false;
  req.on("aborted", () => {
    clientDisconnected = true;
    abortController.abort();
  });
  res.on("close", () => {
    // `close` fires both on disconnect and after successful completion.
    // Only treat it as a disconnect if the response was not fully sent.
    if (!res.writableEnded) {
      clientDisconnected = true;
      abortController.abort();
    }
  });

  function sendEvent(event: SSEEvent): void {
    if (clientDisconnected || res.writableEnded || res.destroyed) return;
    const payload = requestId ? { ...event, request_id: requestId } : event;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  try {
    await runAgent(
      conversationId,
      trimmedMessage,
      sendEvent,
      graphrag === true,
      chatMode,
      {
        abortSignal: abortController.signal,
        replaceLastUserMessage: replace_last_user === true,
        requestId,
        modelOverride,
      }
    );
  } catch (err) {
    if (!abortController.signal.aborted) {
      sendEvent({ type: "error", message: String(err) });
      sendEvent({ type: "done" });
    }
  }

  if (!res.writableEnded && !res.destroyed) {
    res.end();
  }
});

// Proxy graph subgraph requests for the web UI visualization
app.get("/graph/subgraph", async (req, res) => {
  try {
    const rid = getRequestId(req);
    const center = req.query.center as string;
    const normalizedCenter = typeof center === "string" ? center.trim() : "";
    const depth = parseBoundedInt(req.query.depth as string | undefined, 1, 1, 3);
    const limit = parseBoundedInt(req.query.limit as string | undefined, 50, 1, 200);
    if (!normalizedCenter) {
      res.status(400).json({ error: "center parameter required" });
      return;
    }
    if (normalizedCenter.length > 200) {
      res.status(400).json({ error: "center parameter too long (max 200 chars)" });
      return;
    }
    const result = await getGraphSubgraph(normalizedCenter, depth, limit, undefined, rid);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

app.post("/graph/feedback", async (req, res) => {
  try {
    const rid = getRequestId(req);
    const payload = req.body as {
      signal?: "up" | "down";
      query?: string;
      note?: string;
      concepts?: string[];
      people?: string[];
      places?: string[];
      sources?: string[];
    };
    if (!payload || (payload.signal !== "up" && payload.signal !== "down")) {
      res.status(400).json({ error: "signal must be 'up' or 'down'" });
      return;
    }
    const result = await submitGraphFeedback({
      signal: payload.signal,
      query: payload.query,
      note: payload.note,
      concepts: payload.concepts,
      people: payload.people,
      places: payload.places,
      sources: payload.sources,
    }, undefined, rid);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

app.get("/graph/feedback_profile", async (req, res) => {
  try {
    const rid = getRequestId(req);
    const topN = parseBoundedInt(req.query.top_n as string | undefined, 15, 1, 100);
    const result = await getGraphFeedbackProfile(topN, undefined, rid);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

app.get("/graph/feedback_review", async (req, res) => {
  try {
    const rid = getRequestId(req);
    const topN = parseBoundedInt(req.query.top_n as string | undefined, 15, 1, 50);
    const recentLimit = parseBoundedInt(
      req.query.recent_limit as string | undefined,
      40,
      1,
      200
    );
    const result = await getGraphFeedbackReview(topN, recentLimit, undefined, rid);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

app.get("/graph/feedback/health", async (req, res) => {
  try {
    const rid = getRequestId(req);
    const result = await getGraphFeedbackHealth(undefined, rid);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

app.get("/graph/feedback/tuning_preview", async (req, res) => {
  try {
    const rid = getRequestId(req);
    const result = await getGraphFeedbackTuningPreview(undefined, rid);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

app.post("/graph/feedback/apply_tuning", async (req, res) => {
  try {
    const rid = getRequestId(req);
    const result = await applyGraphFeedbackTuning(undefined, rid);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

app.post("/graph/feedback/aggregate", async (req, res) => {
  try {
    const rid = getRequestId(req);
    const result = await aggregateGraphFeedback(undefined, rid);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

app.post("/analysis/entry", async (req, res) => {
  try {
    const rid = getRequestId(req);
    const payload = req.body as {
      entry_id?: string;
      text?: string;
      entry_date?: string;
      source_file?: string;
      query?: string;
      chunk_ids?: unknown;
      max_summary_sentences?: number;
    };

    const entryId = toOptionalString(payload.entry_id, 256);
    const text = toOptionalString(payload.text, 100000);
    const entryDate = toOptionalString(payload.entry_date, 10);
    const sourceFile = toOptionalString(payload.source_file, 512);
    const chunkIds = toStringList(payload.chunk_ids, 200, 256);
    const maxSummarySentences = parseBoundedInt(
      payload.max_summary_sentences !== undefined
        ? String(payload.max_summary_sentences)
        : undefined,
      3,
      1,
      8
    );

    if (!entryId || !text) {
      res.status(400).json({ error: "entry_id and text are required" });
      return;
    }
    const query = toOptionalString(payload.query, 2000) || text.slice(0, 2000);

    const [summary, state] = await Promise.all([
      summarizeEntry(
        {
          entry_id: entryId,
          text,
          entry_date: entryDate,
          source_file: sourceFile,
          chunk_ids: chunkIds,
          max_summary_sentences: maxSummarySentences,
        },
        undefined,
        rid,
      ),
      labelEntryState(
        {
          entry_id: entryId,
          text,
          entry_date: entryDate,
          source_file: sourceFile,
          chunk_ids: chunkIds,
        },
        undefined,
        rid,
      ),
    ]);

    const contextRequest: ContextPacketRequest = {
      query: query || text,
      top_k: 5,
      retrieval_hits: [
        {
          chunk_id: chunkIds[0] || `${entryId}::chunk-000`,
          source_file: sourceFile,
          excerpt: text.slice(0, 280),
          relevance_score: 0.84,
        },
      ],
      graph_signals: [],
    };

    const context = await buildContextPacket(contextRequest, undefined, rid);

    res.json({
      entry_id: entryId,
      summary,
      state,
      context,
    });
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

app.get("/analysis/health", async (req, res) => {
  try {
    const rid = getRequestId(req);
    const result = await analysisHealthCheck(rid);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

app.get("/health", async (req, res) => {
  const rid = getRequestId(req);
  const llmOk = await checkOllamaHealth();
  let graphOk = false;
  let analysisOk = false;
  try {
    const gh = await graphHealthCheck(rid);
    graphOk = (gh as Record<string, string>).status === "ok";
  } catch {
    // graph service not available
  }
  try {
    const ah = await analysisHealthCheck(rid);
    analysisOk = (ah as Record<string, string>).status === "ok";
  } catch {
    // analysis service not available
  }
  res.json({
    status: "ok",
    ollama: llmOk ? "connected" : "unavailable",
    graph: graphOk ? "connected" : "unavailable",
    analysis: analysisOk ? "connected" : "unavailable",
  });
});

app.get("/debug/last-query", (_req, res) => {
  const trace = getLastTrace();
  if (!trace) {
    res.status(404).json({ error: "no queries recorded yet" });
    return;
  }
  res.json(trace);
});

// ---------------------------------------------------------------------------
// MCP over SSE — allows Claude Desktop to connect via URL
// ---------------------------------------------------------------------------

function createMcpServer(): McpServer {
  const server = new McpServer({ name: "corpus-intelligence", version: "1.0.0" });
  const gravityMode = process.env.GRAVITY_MODE !== "0";
  if (gravityMode) {
    registerGravityTools(server);
    registerTools(server, { only: ["get_entry_analysis", "get_entries_by_date", "get_recent_entries"] });
  } else {
    registerTools(server);
    registerTimeSeriesTools(server);
    registerGravityTools(server);
  }
  return server;
}

const sseTransports = new Map<string, SSEServerTransport>();

app.get("/sse", async (_req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  const sessionId = transport.sessionId;
  sseTransports.set(sessionId, transport);

  res.on("close", () => {
    sseTransports.delete(sessionId);
  });

  const server = createMcpServer();
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = sseTransports.get(sessionId);
  if (!transport) {
    res.status(400).json({ error: "Unknown session" });
    return;
  }
  await transport.handlePostMessage(req, res);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`API server listening on port ${PORT}`);
});
