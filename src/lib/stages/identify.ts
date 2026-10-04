// Stage 1 of the research pipeline: identify the company.
//
// Takes plain input, returns plain output, stores nothing. Keeping stages
// like this means the later background worker can reuse them unchanged.

import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { runWithWebTools } from "../anthropic";
import { IDENTIFY_STAGE, TOOL_VERSIONS } from "../config";
import { buildLedger } from "../ledger";
import { estimateCost, sumUsage } from "../pricing";
import { IDENTIFY_INSTRUCTIONS, buildIdentifyUserMessage } from "../prompts/identify";
import { buildSystemPrompt, loadRules } from "../rules";
import type { IdentifyInput, IdentifyResult } from "../types";

export async function runIdentifyStage(input: IdentifyInput): Promise<IdentifyResult> {
  // 1. Load our real intelligence files and build what Claude will receive.
  const rules = await loadRules(IDENTIFY_STAGE.rulesFiles);
  const system = buildSystemPrompt(IDENTIFY_INSTRUCTIONS, rules);
  const today = new Date().toISOString().slice(0, 10);

  // 2. Ask Claude, with web search + web fetch switched on.
  const call = await runWithWebTools({
    model: input.model,
    system,
    userText: buildIdentifyUserMessage(input, today),
    maxSearches: IDENTIFY_STAGE.maxSearches,
    maxFetches: IDENTIFY_STAGE.maxFetches,
    maxContinuations: IDENTIFY_STAGE.maxContinuations,
    maxTokens: IDENTIFY_STAGE.maxTokens,
    effort: IDENTIFY_STAGE.effort,
    searchCountry: IDENTIFY_STAGE.searchCountry,
  });

  // 3. Build the source ledger from the blocks Anthropic's tools returned.
  const { sources, answerText, stats } = buildLedger(call.blocks);

  // 4. Add up usage and estimate cost.
  const usage = sumUsage(input.model, call.usages);
  const cost = estimateCost(usage);
  if (!cost) throw new Error(`No price table for model ${input.model}`);

  // 5. Say plainly if anything looks wrong.
  const warnings: string[] = [];
  const lastStop = call.stopReasons[call.stopReasons.length - 1];
  if (lastStop === "refusal") warnings.push("Claude refused this request (stop_reason: refusal).");
  else if (lastStop === "max_tokens") warnings.push("The answer was cut off at the token limit (max_tokens).");
  else if (lastStop === "pause_turn") warnings.push("Still paused after the maximum number of continuations; the answer may be incomplete.");
  if (!answerText) warnings.push("Claude returned no answer text.");
  if (stats.citationsUnmapped > 0) warnings.push(`${stats.citationsUnmapped} citation(s) could not be matched to a source.`);
  if (stats.citedUrlNotInResults > 0) warnings.push(`${stats.citedUrlNotInResults} citation(s) pointed at a URL that no search or fetch returned.`);

  const result: IdentifyResult = {
    ok: true,
    stage: "identify",
    answerText,
    sources,
    usage,
    cost,
    warnings,
    debug: {
      stopReasons: call.stopReasons,
      continuations: call.continuations,
      durationMs: call.durationMs,
      ledger: stats,
      rulesFiles: rules.map((r) => ({ name: r.name, chars: r.text.length })),
      systemPromptChars: system.reduce((n, b) => n + b.text.length, 0),
      toolVersions: { search: TOOL_VERSIONS.search, fetch: TOOL_VERSIONS.fetch },
      caps: {
        maxSearches: IDENTIFY_STAGE.maxSearches,
        maxFetches: IDENTIFY_STAGE.maxFetches,
        maxContinuations: IDENTIFY_STAGE.maxContinuations,
        maxTokens: IDENTIFY_STAGE.maxTokens,
      },
      effort: IDENTIFY_STAGE.effort,
    },
    createdAt: new Date().toISOString(),
  };

  await saveDebugCopy(input, call.blocks, result);
  return result;
}

/**
 * Development helper: keep the raw API blocks in ./debug/ (git-ignored) so we
 * can inspect exactly what Claude returned and turn real responses into test
 * fixtures later. The product never reads these files. The API key is not
 * part of any response, so it is never written here.
 */
async function saveDebugCopy(input: IdentifyInput, blocks: unknown, result: IdentifyResult) {
  if (process.env.SAVE_DEBUG_RUNS !== "true") return;
  try {
    const dir = path.join(process.cwd(), "debug");
    await fs.mkdir(dir, { recursive: true });
    const slug = input.companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.writeFile(
      path.join(dir, `${stamp}-identify-${slug}.json`),
      JSON.stringify({ input, rawBlocks: blocks, result }, null, 2),
    );
  } catch (error) {
    console.warn("Could not write debug copy:", error);
  }
}
