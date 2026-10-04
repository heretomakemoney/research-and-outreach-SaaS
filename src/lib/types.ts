// Shared types. These are used by BOTH browser code and server code,
// so this file must not import anything server-only.

/** The models you can pick in the page. Add more here when needed. */
export const MODEL_OPTIONS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (default)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (cheaper)" },
] as const;

export type ModelId = (typeof MODEL_OPTIONS)[number]["id"];

export function isModelId(value: unknown): value is ModelId {
  return MODEL_OPTIONS.some((m) => m.id === value);
}

/** What you type into the form. */
export interface IdentifyInput {
  companyName: string;
  website: string;
  context: string; // your private knowledge about the company (unverified)
  topic: string; // optional question for this run only
  model: ModelId;
}

/** One entry in the source ledger: a web page Claude's tools touched. */
export interface LedgerSource {
  key: string; // "S1", "S2", ... numbered by our code, never by Claude
  url: string;
  title: string | null;
  pageAge: string | null; // the coarse "page age" from the search result
  seenInSearch: boolean; // appeared in a web_search result
  fetched: boolean; // Claude read the page itself via web_fetch
  fetchKind: "text" | "pdf" | null;
  retrievedAt: string | null;
  fetchError: string | null; // e.g. "url_not_accessible"
  citedCount: number; // how many times the answer cited this source
  citedExcerpts: string[]; // excerpts returned by the API (not written by Claude)
}

/** Counts that prove (or disprove) that the ledger is reliable. */
export interface LedgerStats {
  textBlocks: number;
  thinkingBlocks: number;
  serverToolUseBlocks: number;
  searchResultBlocks: number;
  searchResultsReturned: number;
  searchQueries: string[];
  searchErrors: string[];
  fetchResultBlocks: number;
  fetchedOk: number;
  fetchRequestedUrls: string[];
  fetchErrors: { url: string | null; code: string }[];
  citationsTotal: number;
  citationsMapped: number;
  citationsUnmapped: number;
  citedUrlNotInResults: number; // a citation pointed at a URL no tool returned
  otherBlockTypes: Record<string, number>;
}

/** Token and tool usage, summed over every API request of the stage. */
export interface UsageSummary {
  model: string;
  apiRequests: number; // 1 + number of pause_turn continuations
  inputTokens: number; // uncached input
  outputTokens: number; // includes thinking tokens
  cacheWriteTokens: number;
  cacheReadTokens: number;
  searchRequests: number;
  fetchRequests: number;
}

export interface CostEstimate {
  isEstimate: true;
  pricesCheckedOn: string;
  inputUsd: number;
  outputUsd: number;
  cacheWriteUsd: number;
  cacheReadUsd: number;
  searchUsd: number;
  totalUsd: number;
}

export interface IdentifyDebug {
  stopReasons: (string | null)[];
  continuations: number;
  durationMs: number;
  ledger: LedgerStats;
  rulesFiles: { name: string; chars: number }[];
  systemPromptChars: number;
  toolVersions: { search: string; fetch: string };
  caps: { maxSearches: number; maxFetches: number; maxContinuations: number; maxTokens: number };
  effort: string;
}

export interface IdentifyResult {
  ok: true;
  stage: "identify";
  answerText: string; // Claude's answer, with [S#] markers added by our code
  sources: LedgerSource[];
  usage: UsageSummary;
  cost: CostEstimate;
  warnings: string[];
  debug: IdentifyDebug;
  createdAt: string;
}

export interface ApiError {
  ok: false;
  error: string;
}

// ---- What the browser storage keeps (see src/lib/storage.ts) ----

export interface StoredCompany {
  id: string;
  name: string;
  website: string;
  context: string; // company-level private context (persists between runs)
  createdAt: string;
  updatedAt: string;
}

export interface StoredResearch {
  id: string;
  companyId: string;
  stage: "identify";
  createdAt: string;
  input: IdentifyInput; // includes the topic and a snapshot of the context used
  result: IdentifyResult;
}
