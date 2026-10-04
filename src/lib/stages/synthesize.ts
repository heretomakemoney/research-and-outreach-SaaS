// The SYNTHESIS stage: evidence cards in, relevance + triggers + people + angles out.
//
// Opus 5.5 by default (see config.ts). No web tools: it reads only the compact
// research state. The intelligence files 01 + 02 + 03 are loaded from disk at run time.

import "server-only";
import { PIPELINE } from "../config";
import { runStructured as defaultRunStructured } from "../anthropic";
import { saveDebugCopy } from "../debug";
import { SYNTHESIS_SCHEMA, SYNTHESIZE_INSTRUCTIONS, buildSynthesizeUserMessage } from "../prompts/synthesize";
import { buildSystemPrompt, loadRules } from "../rules";
import { validateSynthesis } from "../synthesis";
import type { ResearchState, StageLog, Synthesis } from "../types";
import { buildStageLog, stopReasonWarnings, today } from "./common";

/** `deps` exists so tests can run the whole stage with a fake model call and no network. */
export async function runSynthesizeStage(
  state: ResearchState,
  deps: { runStructured: typeof defaultRunStructured } = { runStructured: defaultRunStructured },
): Promise<{ synthesis: Synthesis; log: StageLog }> {
  const cfg = PIPELINE.synthesize;
  const startedAt = new Date().toISOString();

  const rules = await loadRules(cfg.rulesFiles);
  const system = buildSystemPrompt(SYNTHESIZE_INSTRUCTIONS, rules);
  const userText = buildSynthesizeUserMessage(state, today());

  const result = await deps.runStructured({
    model: cfg.model,
    system,
    userText,
    maxTokens: cfg.maxTokens,
    effort: cfg.effort,
    schema: SYNTHESIS_SCHEMA as unknown as Record<string, unknown>,
  });

  const warnings = stopReasonWarnings([result.stopReason]);
  let raw: unknown;
  try {
    raw = JSON.parse(result.text);
  } catch {
    throw new Error(
      `The synthesis answer was not valid JSON (stop reason: ${result.stopReason}). Run the synthesis again. Start of answer: ${result.text.slice(0, 160)}`,
    );
  }
  const validated = validateSynthesis(raw, state);
  warnings.push(...validated.warnings);
  if (validated.synthesis.droppedReferences.length > 0) {
    warnings.push(`${validated.synthesis.droppedReferences.length} reference(s) to non-existent evidence were removed.`);
  }

  const log = buildStageLog({
    stage: "synthesize",
    round: 1,
    model: cfg.model,
    retriever: null,
    usages: [result.usage],
    durationMs: result.durationMs,
    stopReasons: [result.stopReason],
    continuations: 0,
    rules,
    systemPromptChars: system.reduce((n, b) => n + b.text.length, 0),
    userMessageChars: userText.length,
    effort: cfg.effort,
    caps: { maxTokens: cfg.maxTokens },
    ledger: null,
    warnings,
    startedAt,
  });

  await saveDebugCopy("synthesize", state.input.companyName, { rawJson: result.text, synthesis: validated.synthesis, log });
  return { synthesis: validated.synthesis, log };
}
