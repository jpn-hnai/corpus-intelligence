# Corpus Intelligence

**Turn any corpus of unstructured writing into a queryable intelligence system with psychological profiling, knowledge graphs, and gravity-based semantic orchestration.**

Corpus Intelligence transforms personal writing, journal entries, or any body of unstructured text into a multi-engine knowledge system — searchable by meaning, traversable by relationship, and profiled across 8 psychological dimensions. Built and battle-tested on a 1.5M-word personal writing corpus spanning 6 years.

The system exposes 22 specialized tools via MCP (Model Context Protocol), orchestrated by the **Gravity Model** — a semantic activation framework where queries decompose into typed fragments that exert gravitational pull on tools proportionally to their relevance.

## Quick Start

### Option A: Clone and run

```bash
git clone https://github.com/jpn-hnai/corpus-intelligence.git
cd corpus-intelligence
./setup.sh
```

The installer walks you through authentication, environment setup, Docker image building, service startup, and Claude Desktop configuration — all interactively.

### Option B: npm

```bash
npx corpus-intelligence
```

### After setup: ingest your corpus

The installer prompts you for your corpus path (a directory of `.md` files) and saves it to `.env`. Once configured, just run:

```bash
corpus
```

This runs all 5 ingestion pipelines (vector embeddings, knowledge graph, psychological profiling, graph enrichment, timeseries backfill) with progress bars and a completion summary.

## Requirements

- **Docker Desktop** (v20+)
- **Node.js 18+** (for the CLI)
- 4GB RAM minimum, **8GB+ recommended**
- ~8GB disk for images + data
- **One of:**
  - `ANTHROPIC_API_KEY` (recommended — uses Claude Haiku for analysis, ~$0.25/1M input tokens)
  - [Ollama](https://ollama.com) installed locally (free, no API key)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Claude Desktop / MCP Client                                │
│  ↕ SSE (http://127.0.0.1:3001/sse)                         │
├─────────────────────────────────────────────────────────────┤
│  mcp-server (TypeScript)         port 3001                  │
│  22 tools + gravity orchestrator + timeseries               │
├──────────┬──────────┬──────────┬───────────────────────────┤
│ ChromaDB │  Neo4j   │ SQLite   │  DuckDB                   │
│ vectors  │  graph   │ analysis │  timeseries               │
├──────────┼──────────┼──────────┼───────────────────────────┤
│embeddings│  graph   │ analysis │                            │
│ service  │ service  │ service  │                            │
│ :8000    │ :8001    │ :8002    │                            │
└──────────┴──────────┴──────────┴───────────────────────────┘
```

| Service | Stack | Purpose |
|---------|-------|---------|
| **mcp-server** | TypeScript, Express | MCP tools + gravity orchestrator + HTTP API |
| **embeddings-service** | Python, FastAPI, ChromaDB | Sentence-transformers embeddings + vector search |
| **graph-service** | Python, FastAPI, Neo4j | spaCy NER + knowledge graph + GraphRAG |
| **analysis-service** | Python, FastAPI, SQLite | LLM-backed summarization + 8-D psychological profiling |
| **neo4j** | Neo4j 5 Community | Graph database |
| **web-ui** | React, Vite, nginx | Chat interface at localhost:3000 |

## What Makes This Different

- **Gravity-based orchestration**: Queries decompose into semantic fragments (concept, entity, temporal, emotional, relational, archetypal). Each fragment pulls on 22 tool identity vectors via cosine similarity. One tool call (`orchestrated_query`) replaces manual tool selection.
- **8-dimensional psychological profiling**: Every entry is scored across valence, activation, agency, certainty, relational openness, self-trust, time orientation, and integration.
- **Four storage engines in concert**: Vector search (ChromaDB) + graph search (Neo4j) + LLM analysis (Claude/Ollama) + time series (DuckDB).
- **Domain-agnostic**: The same pattern works for personal writing, legal archives, medical records, or any corpus of unstructured text.
- **Fully local option**: Runs entirely on local infrastructure with Ollama. Anthropic API is optional.

## Claude Desktop Integration

The installer auto-configures Claude Desktop. If you need to set it up manually, add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "corpus-intelligence": {
      "url": "http://127.0.0.1:3001/sse"
    }
  }
}
```

In gravity mode (default), Claude sees 4 tools:

| Tool | Purpose |
|------|---------|
| `orchestrated_query` | Multi-tool gravity dispatch |
| `get_entry_analysis` | Deep dive on specific entries |
| `get_entries_by_date` | Date-range retrieval |
| `get_recent_entries` | Recent entries |

Set `GRAVITY_MODE=0` in `.env` to expose all 23 tools individually.

## Ingestion Pipelines

The `corpus` command runs these sequentially:

| Pipeline | Profile | What it does |
|----------|---------|-------------|
| Vector Embeddings | `ingest` | Chunks text, generates embeddings, indexes in ChromaDB |
| Knowledge Graph | `graph-ingest` | spaCy NER, builds nodes + relationships in Neo4j |
| Entry Analysis | `batch-analysis` | LLM summarization + 8-D psychological profiling per entry |
| Graph Enrichment | `graph-enrich` | Wires analysis data (themes, entities, state scores) into Neo4j |
| Timeseries Backfill | `backfill-timeseries` | Populates DuckDB metrics for quantitative analysis |

To run individual pipelines manually:

```bash
docker compose --profile ingest run --rm ingest
docker compose --profile graph-ingest run --rm graph-ingest
docker compose --profile batch-analysis run --rm batch-analysis --provider anthropic --workers 5
docker compose --profile graph-enrich run --rm graph-enrich
docker compose --profile backfill-timeseries run --rm backfill-timeseries
```

## Example Questions

- "How has my thinking about stillness evolved this year?"
- "What concepts are connected to recovery in my writing?"
- "Compare my emotional landscape in Q1 vs Q2"
- "What decisions have I recorded and what emotions surrounded them?"
- "What people are most associated with themes of growth?"

## Gravity Orchestration

Instead of Claude manually selecting from 22 tools, it calls `orchestrated_query` with a natural language question. The system then:

1. **Decomposes** the query into typed semantic fragments (concept, entity, temporal, emotional, relational, archetypal)
2. **Embeds** each fragment + the full query via the embeddings service
3. **Computes a gravity field** — cosine similarity between fragment vectors and 22 tool identity vectors
4. **Activates tools** via adaptive gap detection (finds the natural elbow in sorted scores)
5. **Dispatches** all activated tools in parallel with per-tool timeouts
6. **Assembles** results ranked by composite score for Claude to synthesize

## Available Tools (22 + 1 orchestrator)

| Tool | Category | Description |
|------|----------|-------------|
| `orchestrated_query` | Orchestrator | Automatic multi-tool dispatch via semantic gravity |
| `search_writings` | Search | Semantic search — finds passages similar in meaning |
| `search_by_keyword` | Search | Exact text search with surrounding context |
| `get_entries_by_date` | Search | Retrieve entries within a date range |
| `get_recent_entries` | Search | Get the N most recent entries |
| `find_recurring_themes` | Pattern | Trace how a topic evolves over time |
| `get_writing_stats` | Meta | Corpus statistics |
| `get_entry_analysis` | Analysis | Per-entry summary, themes, entities, 8-D state profile |
| `find_connected_concepts` | Graph | Concepts, people, emotions connected to a concept |
| `trace_concept_evolution` | Graph | Concept appearances over time |
| `get_concept_flows` | Graph | Directed transition flows (X → Y) |
| `find_entity_relationships` | Graph | Person's presence across the corpus |
| `compare_periods` | Graph | Compare two time periods |
| `get_decision_context` | Graph | Decisions and their emotional context |
| `get_archetype_patterns` | Graph | Archetypal patterns (Warrior, Sage, Creator, etc.) |
| `search_themes` | Graph | Entries linked to a theme |
| `search_by_state` | Graph | Filter by psychological state dimension |
| `temporal_filter` | Quantitative | Filter entries by metric thresholds |
| `query_time_series` | Quantitative | Plot any metric over time |
| `detect_anomalies` | Quantitative | Flag outlier entries via z-score |
| `correlate_metrics` | Quantitative | Pearson correlation between metrics |
| `get_metric_summary` | Quantitative | Summary stats for a metric |
| `list_available_metrics` | Meta | Discover all queryable metrics |

## Knowledge Graph Schema

**Nodes:** Entry, Person, Place, Concept, Emotion, Decision, Archetype, Theme, Organization, Spiritual

**Relationships:** MENTIONS, CONTAINS, HAS_THEME, EXPRESSES, RECORDS, INVOKES, COOCCURS_WITH, THEME_COOCCURS, FLOWS_TO

## Manual Setup

<details>
<summary>If you prefer manual Docker Compose commands instead of the CLI</summary>

### 1. Configure environment

```bash
cp .env.example .env
# Edit .env: set CORPUS_PATH, NEO4J_PASSWORD, optionally ANTHROPIC_API_KEY
```

### 2. Build and start

```bash
docker compose build
./start.sh
```

### 3. Ingest your corpus

```bash
docker compose --profile ingest run --rm ingest
docker compose --profile graph-ingest run --rm graph-ingest
docker compose --profile batch-analysis run --rm batch-analysis --provider anthropic --workers 5
docker compose --profile graph-enrich run --rm graph-enrich
docker compose --profile backfill-timeseries run --rm backfill-timeseries
```

### Common operations

```bash
./start.sh status    # Service health
./start.sh logs      # Tail logs
./start.sh down      # Stop everything
./start.sh restart   # Stop + start
```

</details>

## Analysis Layer

The `analysis-service` provides LLM-backed per-entry analysis with dual-provider support:

- **Anthropic Claude** (preferred): Single API call per entry. Model: `claude-haiku-4-5-20251001`.
- **Ollama** (fallback): Chunk-and-merge for entries >1500 words. Model: `llama3.1:8b`.
- **Auto-resolution**: Claude is used when `ANTHROPIC_API_KEY` is set, otherwise Ollama.

Each entry receives:
- Short + detailed summaries
- Typed entities (person, place, organization, concept, spiritual)
- 3-8 abstract themes
- Decisions and commitments
- 8-dimension psychological state profile

## GraphRAG Mode

Toggle **GraphRAG** in the web UI header. When enabled, your query triggers both vector search and graph traversal in parallel, giving Claude enriched context with structural relationships.

## Personal Style Tuning

Graph extraction is tunable through:

- `graph-service/config/style_profile.json` — custom emotion/archetype keywords, concept boosting
- `graph-service/config/entity_aliases.json` — nickname normalization, shorthand mapping

Feedback-based reranking is built into the web UI — upvote/downvote graph results to tune future retrieval.

## Quality Checks

```bash
cd mcp-server && npm run check    # TypeScript lint + tests
cd web-ui && npm run check        # React build check
cd embeddings-service && pytest -q # Python unit tests
```

## Roadmap

### Done
- Open source release with full architecture
- CLI installer (`./setup.sh` / `npx corpus-intelligence`)
- SSE transport for Claude Desktop (URL-based config)
- npm publish (`npx corpus-intelligence`)

### Next
- Docker image registry (GHCR) for faster setup
- Subscription auth (Claude Pro/Max/Team via OAuth)
- Gravity model benchmarking against manually-evaluated query sets

### Later
- Multi-corpus federation
- Predictive psychological vulnerability forecasting
- Voice and real-time input
- Clinical and recovery applications

---

*Built in Oklahoma City by Jer Nguyen*

*[LinkedIn](https://www.linkedin.com/in/jerrypn/) · [jerry@hewesnguyen.com](mailto:jerry@hewesnguyen.com)*
