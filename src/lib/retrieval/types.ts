// The RETRIEVAL LAYER contract.
//
// A "retriever" is whatever goes out to the web and comes back with text that
// is backed by sources. Today the only one is Anthropic's own web search +
// fetch (anthropicWebTools.ts), where Claude decides what to search.
//
// Later we may add a retriever that uses an external search API and our own
// page fetching, with a cheap model extracting the facts. It must return the
// SAME shape, so the research stages, the parser, the gate, synthesis, the
// email stage and the UI do not change.
//
// The contract in plain words: "Given instructions, the rules and a budget,
// give me (1) the answer text in the tagged format, (2) where each part of it
// came from, (3) every source that was touched, and (4) what it cost."

import type Anthropic from "@anthropic-ai/sdk";
import type { AnswerSegment, Effort, LedgerSource, LedgerStats } from "../types";

export interface RetrievalRequest {
  model: string;
  effort: Effort;
  /** System prompt blocks: stage instructions + the intelligence files. Built by the stage, not the retriever. */
  system: Anthropic.TextBlockParam[];
  /** The user message: the compact research state and the task for this run. */
  userText: string;
  budget: { maxSearches: number; maxFetches: number };
  maxContinuations: number;
  maxTokens: number;
  searchCountry: string;
  /** Sources found by earlier stages. They keep their keys; new sources continue the numbering. */
  existingSources: LedgerSource[];
}

export interface RetrievalResult {
  retrieverId: string;
  /** The answer with [S#] markers added by our code (untrimmed). Offsets in `segments` refer to this. */
  rawAnswerText: string;
  segments: AnswerSegment[];
  /** Every source known after this run: earlier ones first, then new ones. */
  sources: LedgerSource[];
  stats: LedgerStats;
  /** One entry per API request made (a long answer can take several). */
  usages: Anthropic.Usage[];
  stopReasons: (string | null)[];
  continuations: number;
  durationMs: number;
  /** The raw provider output, kept for the debug copy only. */
  rawForDebug: unknown;
}

export interface EvidenceRetriever {
  readonly id: string;
  retrieve(request: RetrievalRequest): Promise<RetrievalResult>;
}
