```
 ██████╗ ██████╗ ██████╗ ██████╗ ██╗   ██╗███████╗
██╔════╝██╔═══██╗██╔══██╗██╔══██╗██║   ██║██╔════╝
██║     ██║   ██║██████╔╝██████╔╝██║   ██║███████╗
██║     ██║   ██║██╔══██╗██╔═══╝ ██║   ██║╚════██║
╚██████╗╚██████╔╝██║  ██║██║     ╚██████╔╝███████║
 ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝      ╚═════╝ ╚══════╝
 private intelligence for your writing
```

Turn any corpus of unstructured writing into a queryable intelligence system with psychological profiling, knowledge graphs, and gravity-based semantic orchestration.

Built and battle-tested on a 1.5M-word personal writing corpus spanning 6 years. 22 specialized tools via MCP, orchestrated by a semantic activation framework where queries decompose into typed fragments that exert gravitational pull on tools proportionally to their relevance.

---

## quick start

```bash
$ npx corpus-intelligence
```

Or clone and run:

```bash
$ git clone https://github.com/jpn-hnai/corpus-intelligence.git
$ cd corpus-intelligence
$ ./setup.sh
```

The installer walks you through auth, environment, Docker builds, service startup, and Claude Desktop configuration.

### ingest your corpus

```bash
$ corpus
```

Runs all 5 ingestion pipelines with progress bars and a completion summary.

---

## requirements

```
docker desktop    v20+
node.js           18+
ram               4GB min, 8GB+ recommended
disk              ~8GB for images + data
llm               anthropic api key (recommended, ~$0.25/1M tokens)
                  — or ollama installed locally (free)
```

---

## architecture

```
┌─────────────────────────────────────────────────────────────┐
│  claude desktop / mcp client                                │
│  ↕ sse (http://127.0.0.1:3001/sse)                          │
├─────────────────────────────────────────────────────────────┤
│  mcp-server          typescript    :3001                    │
│  22 tools + gravity orchestrator + timeseries               │
├──────────┬──────────┬──────────┬───────────────────────────┤
│ chromadb │  neo4j   │  sqlite  │  duckdb                   │
│ vectors  │  graph   │ analysis │  timeseries               │
├──────────┼──────────┼──────────┼───────────────────────────┤
│embeddings│  graph   │ analysis │                            │
│ service  │ service  │ service  │                            │
│ :8000    │ :8001    │ :8002    │                            │
└──────────┴──────────┴──────────┴───────────────────────────┘
```

```
service              stack                     purpose
─────────────────────────────────────────────────────────────────
mcp-server           typescript, express       mcp tools + gravity orchestrator
embeddings-service   python, fastapi, chromadb sentence-transformers + vector search
graph-service        python, fastapi, neo4j    spacy ner + knowledge graph + graphrag
analysis-service     python, fastapi, sqlite   llm summarization + 8-d psych profiling
neo4j                neo4j 5 community         graph database
web-ui               react, vite, nginx        chat interface at localhost:3000
```

---

## what makes this different

```
→ gravity-based orchestration     queries decompose into semantic fragments.
                                  each fragment pulls on 22 tool identity
                                  vectors via cosine similarity. one call
                                  (orchestrated_query) replaces manual
                                  tool selection.

→ 8-d psychological profiling     every entry scored across valence,
                                  activation, agency, certainty, relational
                                  openness, self-trust, time orientation,
                                  and integration.

→ four storage engines            vector search (chromadb) + graph (neo4j) +
                                  llm analysis (claude/ollama) + timeseries
                                  (duckdb) — working in concert.

→ fully local option              runs entirely on local infrastructure.
                                  fine-tuned neural models for profiling
                                  and theme classification ($0, no api).

→ domain-agnostic                 works for journals, legal archives,
                                  medical records, or any unstructured text.
```

---

## claude desktop

The installer auto-configures Claude Desktop. For manual setup:

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

```
tool                     purpose
────────────────────────────────────────────────────
orchestrated_query       multi-tool gravity dispatch
get_entry_analysis       deep dive on specific entries
get_entries_by_date      date-range retrieval
get_recent_entries       recent entries
```

Set `GRAVITY_MODE=0` in `.env` to expose all 23 tools individually.

---

## example questions

```
"how has my thinking about stillness evolved this year?"
"what concepts are connected to recovery in my writing?"
"compare my emotional landscape in q1 vs q2"
"what decisions have i recorded and what emotions surrounded them?"
"what people are most associated with themes of growth?"
```

---

## gravity orchestration

Instead of manually selecting from 22 tools, call `orchestrated_query` with a natural language question:

```
1. decompose    query → typed semantic fragments
                (concept, entity, temporal, emotional, relational, archetypal)
                91% resolve via rule-based decomposition ($0)

2. embed        each fragment + full query via embeddings service

3. gravity      cosine similarity between fragment vectors
                and 22 tool identity vectors

4. activate     adaptive gap detection finds the natural elbow
                in sorted scores

5. dispatch     all activated tools run in parallel
                with per-tool timeouts

6. assemble     results ranked by composite score
                for claude to synthesize
```

---

## all tools

```
tool                          category        description
──────────────────────────────────────────────────────────────────────────
orchestrated_query            orchestrator    automatic multi-tool dispatch
search_writings               search          semantic search by meaning
search_by_keyword             search          exact text search with context
get_entries_by_date           search          entries within a date range
get_recent_entries            search          n most recent entries
find_recurring_themes         pattern         trace topic evolution over time
get_writing_stats             meta            corpus statistics
get_entry_analysis            analysis        summary + themes + 8-d state
find_connected_concepts       graph           concepts/people/emotions linked
trace_concept_evolution       graph           concept appearances over time
get_concept_flows             graph           directed transition flows
find_entity_relationships     graph           person's presence across corpus
compare_periods               graph           compare two time periods
get_decision_context          graph           decisions + emotional context
get_archetype_patterns        graph           warrior, sage, creator, etc.
search_themes                 graph           entries linked to a theme
search_by_state               graph           filter by psych dimension
temporal_filter               quantitative    filter by metric thresholds
query_time_series             quantitative    plot any metric over time
detect_anomalies              quantitative    flag outliers via z-score
correlate_metrics             quantitative    pearson correlation
get_metric_summary            quantitative    summary stats for a metric
list_available_metrics        meta            discover all queryable metrics
```

---

## analysis layer

```
provider       summary          state labels       themes             cost
───────────────────────────────────────────────────────────────────────────
anthropic      claude api       claude api         claude api         ~$10/corpus
hybrid         claude api       finetuned neural   finetuned neural   ~$3/corpus
finetuned      (default)        finetuned neural   finetuned neural   $0
local          rule-based       finetuned neural*  finetuned neural*  $0
ollama         ollama llm       ollama llm         ollama llm         $0 (local gpu)
```

*Falls back to rule-based when finetuned weights unavailable.

Auto-resolution prefers `hybrid > anthropic > finetuned > local` based on available API keys and model weights.

The **finetuned state classifier** is a sentence-transformer fine-tuned on Claude-labeled data with a regression head. 8-dimension psychological state scores at ~100ms/entry on CPU. MAE=0.169, Pearson r=0.662 vs Claude on held-out test data.

The **finetuned theme classifier** uses the same encoder with a multi-label head. 5,500+ unique themes clustered into 10 canonical labels. Macro F1=0.286 at ~300ms/entry on CPU.

Each entry receives:

```
→ short + detailed summaries
→ typed entities (person, place, organization, concept, spiritual)
→ 3-8 abstract themes
→ decisions and commitments
→ 8-d psychological state profile
```

---

## knowledge graph

```
nodes          Entry, Person, Place, Concept, Emotion, Decision,
               Archetype, Theme, Organization, Spiritual

relationships  MENTIONS, CONTAINS, HAS_THEME, EXPRESSES, RECORDS,
               INVOKES, COOCCURS_WITH, THEME_COOCCURS, FLOWS_TO
```

---

## dev engine

For local development (no web-ui or ingestion — just the engines you need):

```bash
$ ./dev.sh              # start engines with fade-in banner
$ ./dev.sh status       # check engine health
$ ./dev.sh stop         # shut down
$ ./dev.sh restart      # cycle engines
$ ./dev.sh logs         # tail docker logs
```

---

## manual setup

<details>
<summary>docker compose commands instead of the cli</summary>

```bash
# configure
$ cp .env.example .env
$ vim .env                # set CORPUS_PATH, NEO4J_PASSWORD, ANTHROPIC_API_KEY

# build and start
$ docker compose build
$ ./start.sh

# ingest
$ docker compose --profile ingest run --rm ingest
$ docker compose --profile graph-ingest run --rm graph-ingest
$ docker compose --profile batch-analysis run --rm batch-analysis --provider finetuned --skip-done --workers 4
$ docker compose --profile graph-enrich run --rm graph-enrich
$ docker compose --profile backfill-timeseries run --rm backfill-timeseries

# operate
$ ./start.sh status      # service health
$ ./start.sh logs        # tail logs
$ ./start.sh down        # stop everything
```

</details>

---

## quality checks

```bash
$ cd mcp-server && npm run check          # typescript lint + tests
$ cd web-ui && npm run check              # react build check
$ cd embeddings-service && pytest -q      # python unit tests
```

---

## roadmap

```
done     open source release with full architecture
         cli installer (./setup.sh / npx corpus-intelligence)
         sse transport for claude desktop
         npm publish (npx corpus-intelligence)
         finetuned state classifier ($0 inference)
         finetuned theme classifier (10 canonical themes, $0)
         hybrid rule-based decomposition (91% local)

next     web ui overhaul
         docker image registry (ghcr)
         gravity model benchmarking

later    multi-corpus federation
         predictive psychological vulnerability forecasting
         voice and real-time input
         clinical and recovery applications
```

---

```
built in oklahoma city by jer nguyen
linkedin.com/in/jerrypn · jerry@hewesnguyen.com
```
