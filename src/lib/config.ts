// Settings for the research stage. Change numbers here, not deep in the code.
// (No secrets in this file. The API key comes from .env.local.)

import type { ModelId } from "./types";

export const DEFAULT_MODEL: ModelId = "claude-opus-5-5";

/** Versions of Anthropic's web tools. Newest versions at the time of writing. */
export const TOOL_VERSIONS = {
  search: "web_search_20260318",
  fetch: "web_fetch_20260318",
} as const;

/**
 * Stage 1: identify the company.
 *
 * The caps below are RUNAWAY GUARDS, not a spending budget. They stop a
 * confused loop from searching forever. We deliberately have no cost cap yet.
 */
export const IDENTIFY_STAGE = {
  maxSearches: 6,
  maxFetches: 4,
  maxContinuations: 5, // how many times we resume a paused (pause_turn) answer
  maxTokens: 16000,
  effort: "medium" as const, // Opus 5.5 default; stated explicitly on purpose
  searchCountry: "AU", // bias search results towards Australia
  // Which intelligence files this stage receives, in docs/intelligence/
  rulesFiles: [
    "01_RESEARCH_RULES.md",
    "02_TELTONIKA_RELEVANCE.md",
    "03_SALES_TRIGGERS.md",
  ],
} as const;
