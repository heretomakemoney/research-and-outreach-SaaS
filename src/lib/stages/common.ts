// Small helpers shared by the stage runners. Server only.

import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { estimateCost, sumUsage } from "../pricing";
import type { RuleFile } from "../rules";
import type { LedgerStats, StageLog, StageName } from "../types";

/** Turn the stop reasons of a stage into plain-language warnings. */
export function stopReasonWarnings(stopReasons: (string | null)[]): string[] {
  const warnings: string[] = [];
  const last = stopReasons[stopReasons.length - 1];
  if (last === "refusal") warnings.push("Claude refused this request (stop_reason: refusal).");
  else if (last === "max_tokens") warnings.push("The answer was cut off at the token limit (max_tokens).");
  else if (last === "pause_turn") warnings.push("Still paused after the maximum number of continuations; the answer may be incomplete.");
  return warnings;
}

export function ledgerWarnings(stats: LedgerStats): string[] {
  const warnings: string[] = [];
  if (stats.citationsUnmapped > 0) warnings.push(`${stats.citationsUnmapped} citation(s) could not be matched to a source.`);
  if (stats.citedUrlNotInResults > 0) warnings.push(`${stats.citedUrlNotInResults} citation(s) pointed at a URL that no search or fetch returned.`);
  return warnings;
}

/** How much of the model's answer text is kept in the stage log for diagnosing parsing problems. */
export const ANSWER_PREVIEW_CHARS = 5000;

export interface LogInput {
  stage: StageName;
  round: number;
  model: string;
  retriever: string | null;
  usages: Anthropic.Usage[];
  durationMs: number;
  stopReasons: (string | null)[];
  continuations: number;
  rules: RuleFile[];
  systemPromptChars: number;
  userMessageChars: number;
  effort: string;
  caps: StageLog["caps"];
  ledger: LedgerStats | null;
  answerPreview?: string;
  warnings: string[];
  startedAt: string;
}

export function buildStageLog(i: LogInput): StageLog {
  const usage = sumUsage(i.model, i.usages);
  const cost = estimateCost(usage);
  if (!cost) throw new Error(`No price table for model ${i.model}`);
  return {
    stage: i.stage,
    round: i.round,
    model: i.model,
    retriever: i.retriever,
    usage,
    cost,
    durationMs: i.durationMs,
    stopReasons: i.stopReasons,
    continuations: i.continuations,
    rulesFiles: i.rules.map((r) => ({ name: r.name, chars: r.text.length })),
    systemPromptChars: i.systemPromptChars,
    userMessageChars: i.userMessageChars,
    effort: i.effort,
    caps: i.caps,
    ledger: i.ledger,
    answerPreview: (i.answerPreview ?? "").slice(0, ANSWER_PREVIEW_CHARS),
    warnings: i.warnings,
    startedAt: i.startedAt,
  };
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Thrown for problems with what the browser sent. The route turns it into a 400. */
export class BadInputError extends Error {}
