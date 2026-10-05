// Settings for the research pipeline. Change numbers here, not deep in the code.
// (No secrets in this file. The API key comes from .env.local.)
//
// This is the "Q1" prototype architecture:
//   Discover   -> Sonnet 5.5, Anthropic web search + fetch
//   Follow-up  -> Sonnet 5.5, Anthropic web search + fetch (only when the gate says so)
//   Synthesize -> Opus 5.5, no tools (small input, judgement-heavy)
//   Email      -> Sonnet 5.5, no tools
//
// Every stage has its own model, effort and limits, so later experiments
// (for example Sonnet synthesis, or a cheaper email model) are one-line changes.

import type { Effort, ModelId } from "./types";

/** Versions of Anthropic's web tools. */
export const TOOL_VERSIONS = {
  search: "web_search_20260318",
  fetch: "web_fetch_20260318",
} as const;

const SONNET: ModelId = "claude-sonnet-5-5";
const OPUS: ModelId = "claude-opus-5-5";

/**
 * HOW Claude reads web results. This decides whether the API can vouch for the facts.
 *
 *  "direct"    - Claude reads each search result / fetched page itself. The API then attaches
 *                citations (with the exact excerpt) to the text Claude writes. This is what
 *                traceable evidence needs.
 *  "dynamic"   - "Dynamic filtering": Claude's own code filters the results first and Claude writes
 *                its answer from that code's output (which comes back encrypted). Cheaper on tokens,
 *                but the answer then carries NO citations, so no fact can be tied to a source.
 *
 * The first live run (Upper Hunter) used the default of these tool versions, "dynamic":
 * 0 citations, so every card was rejected. Keep "direct" unless citations are not needed.
 *
 * Cost note: "direct" puts the full search results and fetched pages into the model's context.
 * `fetchMaxContentTokens` bounds web PAGES but the API does NOT apply it to PDFs, so a long
 * council-agenda PDF can be large. Watch the cost table on PDF-heavy councils.
 */
export const WEB_TOOLS = {
  searchCaller: "direct" as "direct" | "dynamic",
  fetchCaller: "direct" as "direct" | "dynamic",
  fetchMaxContentTokens: 30000,
};

interface WebStageConfig {
  model: ModelId;
  effort: Effort;
  /** Files from docs/intelligence/ loaded by the SERVER at runtime for this stage. */
  rulesFiles: readonly string[];
  /** Runaway guards for the web tools. Not a spending budget, but they bound spending. */
  maxSearches: number;
  maxFetches: number;
  maxContinuations: number; // how many times a paused (pause_turn) answer is resumed
  maxTokens: number;
  searchCountry: string; // bias search results towards Australia
}

interface PlainStageConfig {
  model: ModelId;
  effort: Effort;
  rulesFiles: readonly string[];
  maxTokens: number;
}

export const PIPELINE = {
  discover: {
    model: SONNET,
    effort: "medium",
    rulesFiles: ["01_RESEARCH_RULES.md", "02_TELTONIKA_RELEVANCE.md"],
    maxSearches: 8,
    maxFetches: 5,
    maxContinuations: 5,
    maxTokens: 16000,
    searchCountry: "AU",
  } satisfies WebStageConfig,

  followup: {
    model: SONNET,
    effort: "medium",
    rulesFiles: ["01_RESEARCH_RULES.md", "02_TELTONIKA_RELEVANCE.md"],
    maxSearches: 6,
    maxFetches: 4,
    maxContinuations: 5,
    maxTokens: 12000,
    searchCountry: "AU",
  } satisfies WebStageConfig,

  synthesize: {
    model: OPUS,
    effort: "medium",
    rulesFiles: ["01_RESEARCH_RULES.md", "02_TELTONIKA_RELEVANCE.md", "03_SALES_TRIGGERS.md"],
    maxTokens: 16000,
  } satisfies PlainStageConfig,

  email: {
    model: SONNET,
    effort: "low",
    rulesFiles: ["04_OUTREACH_RULES.md", "05_OUTREACH_EXAMPLES.md"],
    maxTokens: 4000,
  } satisfies PlainStageConfig,
} as const;

/** The adaptive follow-up logic (see gate.ts). */
export const GATE = {
  maxFollowupRounds: 1, // set to 2 to allow a second round when the first one finds a new high-priority lead
  maxLeadsPerRound: 3,
  /** A card of a "strong signal" kind newer than this counts as already having a good trigger candidate. */
  strongSignalMonths: 12,
  /** Hard cap on total searches across all research stages for one company. */
  maxTotalSearches: 14,
  /**
   * Company-level dollar cap. null = NOT enforced (initial benchmark runs).
   * Costs are still logged and shown either way. When set, it is checked
   * between stages; a stage that is already running cannot be interrupted.
   */
  costCapUsd: null as number | null,
};

/** Limits on what the server accepts from the browser (the state is sent back to us each stage). */
export const STATE_LIMITS = {
  maxCards: 80,
  maxPeople: 20,
  maxLeads: 30,
  maxCoverage: 40,
  maxSources: 150,
  maxClaimChars: 600,
  maxExcerptChars: 300,
  maxShortChars: 400,
};
