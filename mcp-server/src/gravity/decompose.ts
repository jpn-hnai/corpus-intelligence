import Anthropic from "@anthropic-ai/sdk";
import { embedTexts } from "../embeddings-client.js";
import type {
  DecompositionResult,
  Fragment,
  FragmentType,
  ExtractedParams,
} from "./types.js";

// ─── Known vocabulary for rule-based decomposition ────────────────────

const METRICS = new Set([
  "valence", "activation", "agency", "certainty",
  "relational_openness", "self_trust", "time_orientation", "integration",
  "word_count",
]);

const ARCHETYPES = new Set([
  "creator", "healer", "warrior", "sovereign", "integrator",
  "sage", "explorer", "destroyer", "lover", "magician",
]);

const EMOTIONAL_WORDS = new Set([
  "self-trust", "self_trust", "stuck", "empowered", "fragmented",
  "anxious", "calm", "angry", "peaceful", "shame", "guilt",
  "joy", "sadness", "fear", "grief", "hope", "despair",
  "overwhelmed", "grounded", "scattered", "centered", "numb",
  "alive", "drained", "energized", "lost", "found", "broken",
  "whole", "vulnerable", "strong", "weak", "confident",
  "uncertain", "grateful", "resentful", "lonely", "connected",
]);

const RELATIONAL_PATTERNS = [
  /relationship\s+with/i,
  /tension\s+between/i,
  /influence\s+of/i,
  /how\s+\w+\s+connects?\s+to/i,
  /connection\s+(between|to|with)/i,
  /dynamic\s+(between|with)/i,
  /interactions?\s+with/i,
];

const TEMPORAL_PATTERNS = [
  /(?:change|evolve|shift|grow|develop|progress)(?:d|ed|ing|s)?\s+over\s+time/i,
  /\bover\s+time\b/i,
  /since\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|\d{4}|last|i\s+started)/i,
  /last\s+(?:\d+\s+)?(?:week|month|year|quarter|summer|winter|spring|fall)s?/i,
  /(?:recently|lately|this\s+(?:week|month|year|quarter))/i,
  /(?:over|during|in|throughout)\s+(?:the\s+)?(?:past|last)\s+/i,
  /(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}/i,
  /Q[1-4]\s+(?:vs|versus|compared?\s+to|and)\s+Q[1-4]/i,
  /Q[1-4]\s+\d{4}/i,
  /(?:compare|comparing)\s+.*(?:period|time|month|quarter|year)/i,
  /\d{4}-\d{2}-\d{2}/,
  /how\s+ha(?:s|ve)\s+(?:my|I|i)\s+/i,
];

const MONTH_MAP: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04",
  may: "05", june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
};

// ─── Rule-based decomposition ─────────────────────────────────────────

function decomposeLocal(query: string): DecompositionResult | null {
  // Bail on degenerate queries (only punctuation/whitespace)
  const stripped = query.replace(/[^a-zA-Z0-9]/g, "");
  if (stripped.length === 0) return null;

  const lower = query.toLowerCase();
  // Expand contractions before splitting
  const expanded = lower
    .replace(/what's/g, "what is")
    .replace(/it's/g, "it is")
    .replace(/i've/g, "i have")
    .replace(/i'm/g, "i am")
    .replace(/i'd/g, "i would")
    .replace(/i'll/g, "i will")
    .replace(/he's/g, "he is")
    .replace(/she's/g, "she is")
    .replace(/that's/g, "that is")
    .replace(/there's/g, "there is")
    .replace(/how's/g, "how is")
    .replace(/who's/g, "who is")
    .replace(/don't/g, "do not")
    .replace(/doesn't/g, "does not")
    .replace(/didn't/g, "did not")
    .replace(/can't/g, "cannot")
    .replace(/won't/g, "will not")
    .replace(/isn't/g, "is not")
    .replace(/aren't/g, "are not")
    .replace(/wasn't/g, "was not")
    .replace(/weren't/g, "were not")
    .replace(/hasn't/g, "has not")
    .replace(/haven't/g, "have not")
    // Strip possessives (Kyle's → kyle, Mom's → mom)
    .replace(/(\w)'s\b/g, "$1");
  // Split on whitespace AND common punctuation joiners (/, ..., —, –, ;)
  const words = expanded
    .replace(/[/;—–]+/g, " ")
    .replace(/\.{2,}/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);
  const fragments: Fragment[] = [];
  const entities: string[] = [];
  const concepts: string[] = [];
  const metrics: string[] = [];
  const dateRanges: Array<{ start?: string; end?: string }> = [];
  const usedWords = new Set<string>();

  // 1. Detect metrics (also match hyphenated forms like "self-trust")
  // Check consecutive word pairs first (e.g., "word count" → "word_count")
  for (let i = 0; i < words.length - 1; i++) {
    const pair = words[i].replace(/[^a-z]/g, "") + "_" + words[i + 1].replace(/[^a-z]/g, "");
    if (METRICS.has(pair) && !usedWords.has(pair)) {
      fragments.push({ type: "emotional", text: pair });
      metrics.push(pair);
      usedWords.add(pair);
      usedWords.add(pair.replace(/_/g, ""));
      usedWords.add(words[i].replace(/[^a-z]/g, ""));
      usedWords.add(words[i + 1].replace(/[^a-z]/g, ""));
    }
  }
  // Then check individual words
  for (const word of words) {
    const normalized = word.replace(/-/g, "_").replace(/[^a-z_]/g, "");
    if (METRICS.has(normalized) && !usedWords.has(normalized)) {
      fragments.push({ type: "emotional", text: normalized });
      metrics.push(normalized);
      usedWords.add(normalized);
      // Also mark the hyphenated and unhyphenated forms
      usedWords.add(normalized.replace(/_/g, ""));
      usedWords.add(word.replace(/[^a-z-]/g, ""));
    }
  }

  // 2. Detect archetypes
  for (const word of words) {
    const clean = word.replace(/[^a-z]/g, "");
    if (ARCHETYPES.has(clean) && !usedWords.has(clean)) {
      fragments.push({ type: "archetypal", text: clean });
      usedWords.add(clean);
    }
  }

  // 3. Detect emotional words
  for (const word of words) {
    const clean = word.replace(/[^a-z-]/g, "");
    if (EMOTIONAL_WORDS.has(clean) && !usedWords.has(clean) && !METRICS.has(clean.replace(/-/g, "_"))) {
      fragments.push({ type: "emotional", text: clean });
      usedWords.add(clean);
      usedWords.add(clean.replace(/-/g, ""));
    }
  }

  // 4. Detect relational patterns and mark words as used
  for (const pattern of RELATIONAL_PATTERNS) {
    const match = query.match(pattern);
    if (match) {
      const matchText = match[0].toLowerCase();
      fragments.push({ type: "relational", text: matchText });
      for (const w of matchText.split(/\s+/)) {
        usedWords.add(w.replace(/[^a-z0-9]/g, ""));
      }
      break;
    }
  }

  // 5. Detect temporal patterns and extract date ranges
  for (const pattern of TEMPORAL_PATTERNS) {
    const match = query.match(pattern);
    if (match) {
      const matchText = match[0].toLowerCase();
      fragments.push({ type: "temporal", text: matchText });
      for (const w of matchText.split(/\s+/)) {
        usedWords.add(w.replace(/[^a-z0-9]/g, ""));
      }
      break;
    }
  }

  // Try to parse date ranges from temporal references
  const monthYearMatch = query.match(
    /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/i
  );
  if (monthYearMatch) {
    const m = MONTH_MAP[monthYearMatch[1].toLowerCase()];
    const y = monthYearMatch[2];
    dateRanges.push({ start: `${y}-${m}-01`, end: `${y}-${m}-28` });
  }

  const isoMatch = query.match(/(\d{4}-\d{2}-\d{2})/g);
  if (isoMatch) {
    if (isoMatch.length >= 2) {
      dateRanges.push({ start: isoMatch[0], end: isoMatch[1] });
    } else {
      dateRanges.push({ start: isoMatch[0] });
    }
  }

  // 6. Detect entities: capitalized phrases + alphanumeric names (e.g. StarSpace46)
  // Multi-word: consecutive capitalized words (e.g. "Plaza District", "Oklahoma City")
  // Single word with numbers: CamelCase or names with digits (e.g. StarSpace46)
  const entityPattern = /\b([A-Z][a-z]{1,}(?:\s+[A-Z][a-z]{1,})*)\b/g;
  const alphanumEntityPattern = /\b([A-Z][a-zA-Z]*\d+[a-zA-Z0-9]*)\b/g;
  // Also catch lowercase alphanumeric names (e.g. "starspace46" without caps)
  const lowerAlphanumPattern = /\b([a-z]+\d+[a-z0-9]*)\b/gi;
  let capMatch;
  const entitySkipWords = new Set([
    // Common sentence starters and function words
    "how", "what", "when", "where", "why", "who", "which", "the", "am",
    "and", "but", "for", "are", "was", "were", "has", "have", "had",
    "been", "being", "does", "did", "will", "would", "could", "should",
    "may", "might", "can", "shall", "not", "this", "that", "these",
    "those", "with", "from", "about", "into", "through", "during",
    "before", "after", "above", "below", "between", "compare",
    // Imperative verbs (sentence starters)
    "tell", "describe", "explain", "show", "list", "give", "find",
    "get", "look", "help", "make", "let", "suggest", "identify",
    "recall", "note", "consider", "notice",
    // Common nouns/verbs that aren't entities
    "entries", "entry", "dreams", "dream", "tension", "themes",
    "theme", "patterns", "pattern", "decisions", "decision",
    "relationship", "relationships", "connection", "connections",
    "energy", "writing", "writings", "thoughts", "feelings",
    "my", "times", "moments", "everything", "something", "nothing",
    "top", "early", "late", "plot", "summarize", "summary",
    "compare", "correlate", "analyze", "review", "track",
    "most", "gaps", "days", "places", "areas", "ways", "words",
    "signs", "pieces", "parts", "points", "steps", "levels",
    // Months
    "january", "february", "march", "april", "june", "july",
    "august", "september", "october", "november", "december",
    // Archetypes (handled separately)
    "creator", "healer", "warrior", "sovereign", "integrator",
    "sage", "explorer", "destroyer", "lover", "magician",
  ]);

  // Alphanumeric entities first (StarSpace46, etc.)
  let alphaMatch;
  while ((alphaMatch = alphanumEntityPattern.exec(query)) !== null) {
    const word = alphaMatch[1];
    if (!usedWords.has(word.toLowerCase())) {
      entities.push(word);
      fragments.push({ type: "entity", text: word });
      usedWords.add(word.toLowerCase());
      // Also mark the alpha-only form to prevent "starspace" appearing as concept
      usedWords.add(word.toLowerCase().replace(/[^a-z]/g, ""));
    }
  }

  // Lowercase alphanumeric names (e.g. "starspace46" in lowercase queries)
  let lowerAlpha;
  while ((lowerAlpha = lowerAlphanumPattern.exec(query)) !== null) {
    const word = lowerAlpha[1];
    const alphaOnly = word.toLowerCase().replace(/[^a-z]/g, "");
    // Must have letters + digits to count, and not already found
    if (/\d/.test(word) && /[a-z]/i.test(word) && !usedWords.has(word.toLowerCase())) {
      entities.push(word);
      fragments.push({ type: "entity", text: word });
      usedWords.add(word.toLowerCase());
      usedWords.add(alphaOnly);
    }
  }

  // Multi-word and single-word capitalized entities
  while ((capMatch = entityPattern.exec(query)) !== null) {
    const phrase = capMatch[1];
    // Skip if at very start of query (likely just capitalized sentence start)
    // unless it's multi-word (multi-word caps are almost always entities)
    const isAtStart = capMatch.index === 0;
    const isMultiWord = phrase.includes(" ");
    const phraseWords = phrase.split(/\s+/);

    if (isAtStart && !isMultiWord) {
      // Single word at start — only treat as entity if not a skip word
      if (entitySkipWords.has(phrase.toLowerCase())) continue;
    }

    // Filter out phrases where all words are skip words
    const meaningful = phraseWords.filter((w) => !entitySkipWords.has(w.toLowerCase()));
    if (meaningful.length === 0) continue;

    // Skip if all words already used
    const allUsed = phraseWords.every((w) => usedWords.has(w.toLowerCase()));
    if (allUsed) continue;

    entities.push(phrase);
    fragments.push({ type: "entity", text: phrase });
    for (const w of phraseWords) {
      usedWords.add(w.toLowerCase());
    }
  }

  // 7. Extract remaining meaningful words as concepts
  const stopWords = new Set([
    "i", "me", "my", "mine", "myself", "we", "our", "ours",
    "you", "your", "he", "she", "it", "they", "them", "their",
    "a", "an", "the", "is", "am", "are", "was", "were", "be",
    "been", "being", "have", "has", "had", "do", "does", "did",
    "will", "would", "could", "should", "can", "may", "might",
    "shall", "to", "of", "in", "for", "on", "with", "at", "by",
    "from", "as", "into", "through", "during", "before", "after",
    "above", "below", "between", "out", "off", "over", "under",
    "again", "further", "then", "once", "here", "there", "when",
    "where", "why", "how", "all", "each", "every", "both", "few",
    "more", "most", "other", "some", "such", "no", "nor", "not",
    "only", "own", "same", "so", "than", "too", "very", "just",
    "about", "what", "which", "who", "whom", "this", "that",
    "these", "those", "and", "but", "or", "if", "while", "because",
    "until", "although", "since", "whether", "after", "before",
    // Verbs that are functional, not conceptual
    "compare", "tell", "show", "find", "get", "look", "think",
    "know", "feel", "want", "need", "like", "make", "go", "see",
    "come", "take", "give", "say", "write", "written", "writing",
    "wrote", "talked", "talk", "related", "connected", "around",
    "much", "many", "something", "anything", "everything", "nothing",
    "change", "changed", "changes", "changing", "evolve", "evolved",
    "shift", "shifted", "grow", "grew", "grown", "develop", "developed",
    "felt", "feels", "feeling", "going", "done", "doing", "made",
    "getting", "got", "gets", "better", "worse", "best", "worst",
    "seem", "seems", "seemed", "seeming", "become", "became", "becomes",
    "keep", "keeps", "kept", "keeping", "start", "started", "starting",
    "stop", "stopped", "stopping", "try", "tried", "trying",
    "happen", "happened", "happens", "happening",
    "connect", "connects", "connecting",
    "correlate", "correlates", "correlating", "correlation",
    "affect", "affects", "affecting", "effect", "effects",
    "relate", "relates", "relating",
    "play", "plays", "playing", "played",
    "role", "roles",
    "mention", "mentioned", "mentions", "mentioning",
    "follow", "followed", "following", "follows",
    "first", "last", "next", "also", "still", "already", "never",
    // Contractions already expanded but catch fragments
    "whats", "its", "ive", "hes", "shes", "thats", "hows", "whos",
    "dont", "doesnt", "didnt", "cant", "wont", "isnt", "arent",
    // Common non-concept nouns
    "entries", "entry", "things", "thing", "stuff", "way", "lot",
    "time", "times", "part", "kind", "sort", "type",
    "mode", "scores", "score", "ones", "except", "moments", "moment",
    "top", "early", "late", "plot", "summarize", "summary",
    "available", "patterns", "pattern",
    "suggest", "suggested", "suggesting", "suggests",
    "identify", "identified", "identifying",
    "recall", "recalling", "notice", "noticed", "noticing",
    "consider", "considered", "considering",
    "gaps", "days", "places", "areas", "ways", "words",
    "signs", "pieces", "parts", "points", "steps", "levels",
  ]);

  for (const word of words) {
    const clean = word.replace(/[^a-z]/g, "");
    if (
      clean.length >= 3 &&
      !stopWords.has(clean) &&
      !usedWords.has(clean) &&
      !METRICS.has(clean) &&
      !ARCHETYPES.has(clean) &&
      !EMOTIONAL_WORDS.has(clean)
    ) {
      concepts.push(clean);
      fragments.push({ type: "concept", text: clean });
      usedWords.add(clean);
    }
  }

  // Handle single-word queries: return 1 fragment instead of requiring 2
  if (fragments.length === 0) {
    return null;
  }

  // Pick primary mass: first non-temporal, non-relational fragment (the subject)
  let primaryIndex = 0;
  for (let i = 0; i < fragments.length; i++) {
    if (fragments[i].type !== "temporal" && fragments[i].type !== "relational") {
      primaryIndex = i;
      break;
    }
  }

  return {
    fragments,
    primary_mass_index: primaryIndex,
    reasoning: "rule-based decomposition",
    extracted: {
      entities,
      concepts,
      date_ranges: dateRanges,
      metrics,
      search_query: query,
    },
  };
}

// ─── Claude-based decomposition (fallback) ────────────────────────────

const DECOMPOSITION_PROMPT = `\
You are a query decomposition engine for a personal writing corpus analysis system.

Given a natural language query, decompose it into typed semantic fragments AND extract structured parameters for tool dispatch.

## Fragment Types

- **concept**: Abstract ideas, themes, philosophical constructs (e.g., silence, sovereignty, shame, trust, discipline, recovery)
- **entity**: Named people, places, practices, organizations (e.g., Kyle, Blocworks, climbing, StarSpace46, Mom)
- **temporal**: Time dimensions, change markers, period references (e.g., change over time, since January, last 3 months, recently, since I started climbing)
- **emotional**: Feelings, states, psychological dimensions (e.g., self-trust, integration, agency, valence, stuck, empowered, fragmented)
- **relational**: Connection structure, influence, tension (e.g., relationship with, tension between, influence of, how X connects to Y)
- **archetypal**: Patterns, roles, mythic structures (e.g., Creator, Healer, Warrior, Sovereign, Integrator)

## Rules

1. Extract ALL meaningful fragments from the query. A single query typically has 2-6 fragments.
2. Each fragment should be a short phrase (1-5 words), not a full sentence.
3. A word/phrase can only appear in ONE fragment — no duplicates.
4. If a fragment could fit multiple types, choose the most specific type.
5. Identify the PRIMARY MASS — the fragment the query is fundamentally about. This is the subject being investigated, not the lens through which it's being viewed.
6. Empty categories are signal — don't force fragments into categories where they don't belong.
7. Infer implicit fragments only when strongly implied (e.g., "how have I changed" implies temporal: "change over time").

## Extracted Parameters

In addition to fragments, extract structured parameters that tools will use as arguments:
- **entities**: Person names mentioned in the query (e.g., ["Kyle", "Matt"])
- **concepts**: Abstract ideas or themes (e.g., ["silence", "sovereignty"])
- **date_ranges**: Any date references, converted to YYYY-MM-DD format where possible. Use approximate dates for relative references like "last summer" or "since January". If no dates mentioned, use empty array.
- **metrics**: Psychological dimensions or measurable quantities mentioned (e.g., ["agency", "self_trust", "valence", "word_count"])
- **search_query**: The full query text reformulated for semantic search (may be the original query or a cleaned version)

## Output Format

Return ONLY valid JSON with this structure:
{
  "fragments": [
    {"type": "<fragment_type>", "text": "<fragment_text>"},
    ...
  ],
  "primary_mass_index": <index of primary mass fragment in the array>,
  "reasoning": "<1-2 sentences explaining why you chose this primary mass>",
  "extracted": {
    "entities": [],
    "concepts": [],
    "date_ranges": [{"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}],
    "metrics": [],
    "search_query": "<query text for semantic search>"
  }
}`;

const VALID_FRAGMENT_TYPES = new Set<string>([
  "concept",
  "entity",
  "temporal",
  "emotional",
  "relational",
  "archetypal",
]);

async function decomposeLLM(
  query: string,
  signal?: AbortSignal
): Promise<DecompositionResult> {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: DECOMPOSITION_PROMPT,
    messages: [{ role: "user", content: query }],
  });

  let text =
    response.content[0].type === "text" ? response.content[0].text.trim() : "";

  // Handle markdown code blocks
  if (text.startsWith("```")) {
    text = text.split("\n").slice(1).join("\n");
    if (text.endsWith("```")) {
      text = text.slice(0, -3).trim();
    }
  }

  const data = JSON.parse(text) as {
    fragments: Array<{ type: string; text: string }>;
    primary_mass_index: number;
    reasoning?: string;
    extracted?: {
      entities?: string[];
      concepts?: string[];
      date_ranges?: Array<{ start?: string; end?: string }>;
      metrics?: string[];
      search_query?: string;
    };
  };

  const fragments: Fragment[] = data.fragments.map((f) => ({
    type: (VALID_FRAGMENT_TYPES.has(f.type) ? f.type : "concept") as FragmentType,
    text: f.text,
  }));

  const ext = data.extracted || {};

  // Normalize metric names: hyphens → underscores, lowercase
  const normalizedMetrics = (ext.metrics || []).map((m) =>
    m.toLowerCase().trim().replace(/-/g, "_")
  );

  const extracted: ExtractedParams = {
    entities: ext.entities || [],
    concepts: ext.concepts || [],
    date_ranges: ext.date_ranges || [],
    metrics: normalizedMetrics,
    search_query: ext.search_query || query,
  };

  return {
    fragments,
    primary_mass_index: data.primary_mass_index,
    reasoning: data.reasoning || "",
    extracted,
  };
}

// ─── Hybrid decomposition (public API) ────────────────────────────────

export async function decompose(
  query: string,
  signal?: AbortSignal
): Promise<DecompositionResult> {
  // Guard against empty/whitespace/punctuation-only queries
  const meaningful = query.replace(/[^a-zA-Z0-9]/g, "");
  if (meaningful.length === 0) {
    console.error(`[gravity] decompose: empty/degenerate query, using raw fallback`);
    return {
      fragments: [{ type: "concept", text: query.trim() || "unknown" }],
      primary_mass_index: 0,
      reasoning: "fallback — degenerate query",
      extracted: {
        entities: [],
        concepts: [],
        date_ranges: [],
        metrics: [],
        search_query: query,
      },
    };
  }

  // Try rule-based first
  const local = decomposeLocal(query);

  if (local && local.fragments.length >= 1) {
    console.error(`[gravity] decompose: rule-based (${local.fragments.length} fragments)`);
    return local;
  }

  // Fall back to Claude for ambiguous/complex queries
  try {
    console.error(`[gravity] decompose: falling back to Claude`);
    return await decomposeLLM(query, signal);
  } catch (err) {
    // If Claude fails and we have a local result, use it
    if (local) {
      console.error(`[gravity] decompose: Claude failed, using rule-based fallback`);
      return local;
    }
    // Last resort: single concept fragment from the full query
    console.error(`[gravity] decompose: all methods failed, using raw query`);
    return {
      fragments: [{ type: "concept", text: query }],
      primary_mass_index: 0,
      reasoning: "fallback — raw query as single concept",
      extracted: {
        entities: [],
        concepts: [],
        date_ranges: [],
        metrics: [],
        search_query: query,
      },
    };
  }
}

export async function embedDecomposition(
  result: DecompositionResult,
  query: string,
  signal?: AbortSignal
): Promise<DecompositionResult> {
  const texts = [...result.fragments.map((f) => f.text), query];
  const vectors = await embedTexts(texts, signal);

  result.fragments.forEach((f, i) => {
    f.embedding = vectors[i];
  });
  result.query_embedding = vectors[vectors.length - 1];

  return result;
}
