// Usage summing and cost ESTIMATION.
//
// The Anthropic API tells us how many tokens and searches a call used.
// It does NOT tell us dollars. We estimate dollars by multiplying those
// counts by Anthropic's published list prices. That makes the result an
// ESTIMATE: prices can change, and discounts or credits are not visible here.
// The authoritative number is on the Usage page of the Anthropic Console.

import type { CostEstimate, ModelId, StageLog, UsageSummary } from "./types";

export const PRICES_CHECKED_ON = "2026-10-03";
export const PRICES_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing";

/** Web search is billed per search, on top of tokens. Web fetch has no fee of its own. */
export const SEARCH_USD_PER_REQUEST = 0.01; // $10 per 1,000 searches

interface ModelPrice {
  inputPerMTok: number; // $ per million uncached input tokens
  outputPerMTok: number; // $ per million output tokens (thinking tokens count as output)
  cacheWritePerMTok: number; // 5-minute cache write
  cacheReadPerMTok: number; // cache hit
}

// Keep this table in step with KNOWN_MODELS in types.ts and the model per stage in config.ts.
const MODEL_PRICES: Record<ModelId, ModelPrice> = {
  "claude-opus-5-5": { inputPerMTok: 4, outputPerMTok: 20, cacheWritePerMTok: 5, cacheReadPerMTok: 0.2 },
  "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10, cacheWritePerMTok: 2.5, cacheReadPerMTok: 0.2 },
};

/** The parts of an API `usage` object we use (kept loose so tests can pass plain objects). */
export interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number } | null;
}

/** Add up the `usage` of every API request made during one stage. */
export function sumUsage(model: string, usages: UsageLike[]): UsageSummary {
  const total: UsageSummary = {
    model,
    apiRequests: usages.length,
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    searchRequests: 0,
    fetchRequests: 0,
  };
  for (const u of usages) {
    total.inputTokens += u.input_tokens ?? 0;
    total.outputTokens += u.output_tokens ?? 0;
    total.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
    total.cacheReadTokens += u.cache_read_input_tokens ?? 0;
    total.searchRequests += u.server_tool_use?.web_search_requests ?? 0;
    total.fetchRequests += u.server_tool_use?.web_fetch_requests ?? 0;
  }
  return total;
}

/** Estimate dollars from token and search counts. Returns null for an unknown model. */
export function estimateCost(usage: UsageSummary): CostEstimate | null {
  const price = MODEL_PRICES[usage.model as ModelId];
  if (!price) return null;
  const perToken = (tokens: number, perMTok: number) => (tokens / 1_000_000) * perMTok;
  const inputUsd = perToken(usage.inputTokens, price.inputPerMTok);
  const outputUsd = perToken(usage.outputTokens, price.outputPerMTok);
  const cacheWriteUsd = perToken(usage.cacheWriteTokens, price.cacheWritePerMTok);
  const cacheReadUsd = perToken(usage.cacheReadTokens, price.cacheReadPerMTok);
  const searchUsd = usage.searchRequests * SEARCH_USD_PER_REQUEST;
  return {
    isEstimate: true,
    pricesCheckedOn: PRICES_CHECKED_ON,
    inputUsd,
    outputUsd,
    cacheWriteUsd,
    cacheReadUsd,
    searchUsd,
    totalUsd: inputUsd + outputUsd + cacheWriteUsd + cacheReadUsd + searchUsd,
  };
}

/** Add up the cost of several stage logs (research stages + synthesis + every email generation). */
export function totalCost(logs: readonly StageLog[]): { totalUsd: number; searches: number; fetches: number; durationMs: number } {
  let totalUsd = 0;
  let searches = 0;
  let fetches = 0;
  let durationMs = 0;
  for (const log of logs) {
    totalUsd += log.cost.totalUsd;
    searches += log.usage.searchRequests;
    fetches += log.usage.fetchRequests;
    durationMs += log.durationMs;
  }
  return { totalUsd, searches, fetches, durationMs };
}
