// The two web-research stages: DISCOVER and FOLLOW-UP.
//
// Both do the same thing, differently aimed:
//   1. load the intelligence files (01 + 02) from disk, at run time
//   2. build the prompt (instructions + rules + compact state)
//   3. hand it to the retriever (Anthropic web search + fetch today)
//   4. read the tagged answer into evidence cards / people / leads (parse.ts)
//   5. merge into the research state with stable source IDs (state.ts)
//   6. log usage and cost, then ask the gate what to do next (gate.ts)
//
// Takes plain input, returns plain output, stores nothing.

import "server-only";
import { GATE, PIPELINE, STATE_LIMITS } from "../config";
import { saveDebugCopy } from "../debug";
import { decideNext } from "../gate";
import { parseResearchOutput } from "../parse";
import {
  DISCOVER_INSTRUCTIONS,
  FOLLOWUP_INSTRUCTIONS,
  buildDiscoverUserMessage,
  buildFollowupUserMessage,
} from "../prompts/research";
import { getRetriever } from "../retrieval";
import type { EvidenceRetriever } from "../retrieval/types";
import { buildSystemPrompt, loadRules } from "../rules";
import { emptyState, mergeResearch, totalCostUsd, totalSearches } from "../state";
import type { NextStep, ResearchState, StageLog, WorkflowInput } from "../types";
import { BadInputError, buildStageLog, ledgerWarnings, stopReasonWarnings, today } from "./common";

export interface ResearchStageOutput {
  state: ResearchState;
  next: NextStep;
  log: StageLog;
}

export type ResearchStageRequest =
  | { kind: "discover"; input: WorkflowInput }
  | { kind: "followup"; state: ResearchState; focus: "leads" | "people" | "hook"; leadIds: string[] };

/** `deps` exists so tests can run the whole stage with a fake retriever and no network. */
export async function runResearchStage(
  req: ResearchStageRequest,
  deps: { retriever: EvidenceRetriever } = { retriever: getRetriever() },
): Promise<ResearchStageOutput> {
  const cfg = req.kind === "discover" ? PIPELINE.discover : PIPELINE.followup;
  const prior: ResearchState = req.kind === "discover" ? emptyState(req.input) : req.state;
  const round = req.kind === "discover" ? 0 : prior.followupRounds + 1;
  const startedAt = new Date().toISOString();

  // 1. Load OUR intelligence files from docs/intelligence/ on the server, every run.
  const rules = await loadRules(cfg.rulesFiles);
  const instructions = req.kind === "discover" ? DISCOVER_INSTRUCTIONS : FOLLOWUP_INSTRUCTIONS;
  const system = buildSystemPrompt(instructions, rules);

  // 2. The part of the prompt that changes on every call.
  let userText: string;
  let focusLeadIds: string[] = [];
  if (req.kind === "discover") {
    userText = buildDiscoverUserMessage(req.input, today(), cfg);
  } else {
    const leads = prior.leads.filter((l) => req.leadIds.includes(l.id) && l.status === "open");
    if (req.focus === "leads" && leads.length === 0) {
      throw new BadInputError("This follow-up round needs at least one open lead, and none of the requested leads is open.");
    }
    focusLeadIds = leads.map((l) => l.id);
    userText = buildFollowupUserMessage(prior, req.focus, leads, today(), cfg);
  }

  // 3. Ask the retriever (Anthropic web search + fetch).
  const retrieval = await deps.retriever.retrieve({
    model: cfg.model,
    effort: cfg.effort,
    system,
    userText,
    budget: { maxSearches: cfg.maxSearches, maxFetches: cfg.maxFetches },
    maxContinuations: cfg.maxContinuations,
    maxTokens: cfg.maxTokens,
    searchCountry: cfg.searchCountry,
    existingSources: prior.sources,
  });

  // 4 + 5. Read the tagged answer and merge it into the state.
  const parsed = parseResearchOutput(retrieval.rawAnswerText, retrieval.segments);
  const merged = mergeResearch(prior, parsed, {
    stage: req.kind,
    round,
    sources: retrieval.sources,
    focusLeadIds,
    limits: STATE_LIMITS,
  });

  // 6. Warnings, log, gate.
  const warnings = [
    ...stopReasonWarnings(retrieval.stopReasons),
    ...ledgerWarnings(retrieval.stats),
    ...merged.warnings,
  ];
  if (!retrieval.rawAnswerText.trim()) warnings.push("Claude returned no answer text.");
  if (parsed.cards.length === 0 && parsed.people.length === 0) warnings.push("The answer contained no usable evidence cards or people.");
  if (parsed.ignoredLines > 0) warnings.push(`${parsed.ignoredLines} line(s) of the answer were not in the tagged format and were ignored.`);

  const log = buildStageLog({
    stage: req.kind,
    round: Math.max(1, round),
    model: cfg.model,
    retriever: retrieval.retrieverId,
    usages: retrieval.usages,
    durationMs: retrieval.durationMs,
    stopReasons: retrieval.stopReasons,
    continuations: retrieval.continuations,
    rules,
    systemPromptChars: system.reduce((n, b) => n + b.text.length, 0),
    userMessageChars: userText.length,
    effort: cfg.effort,
    caps: {
      maxSearches: cfg.maxSearches,
      maxFetches: cfg.maxFetches,
      maxContinuations: cfg.maxContinuations,
      maxTokens: cfg.maxTokens,
    },
    ledger: retrieval.stats,
    warnings,
    startedAt,
  });

  const state: ResearchState = { ...merged.state, stages: [...prior.stages, log] };
  const next = decideNext(state, totalSearches(state), totalCostUsd(state), { ...GATE, now: new Date() });

  await saveDebugCopy(req.kind, prior.input.companyName, {
    request: req.kind === "discover" ? req.input : { focus: req.focus, leadIds: req.leadIds },
    rawProviderOutput: retrieval.rawForDebug,
    answerText: retrieval.rawAnswerText,
    parsed,
    next,
    log,
  });

  return { state, next, log };
}
