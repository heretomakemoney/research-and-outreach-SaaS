// Retriever #1: Anthropic's own web search + web fetch tools.
//
// Anthropic runs the searches and page reads on ITS servers, inside our one
// request. If the turn gets long, Anthropic pauses it (stop_reason "pause_turn")
// and we simply send the paused answer back to let it carry on.
//
// This is the only file that knows about the web-tool request shape.

import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getClient } from "../anthropic";
import { TOOL_VERSIONS, WEB_TOOLS } from "../config";
import { buildLedger } from "../ledger";
import type { EvidenceRetriever, RetrievalRequest, RetrievalResult } from "./types";

/**
 * The two tool definitions. Exported so a test can check the settings that decide
 * whether the API attaches citations (see WEB_TOOLS in config.ts).
 */
export function buildWebTools(
  request: Pick<RetrievalRequest, "budget" | "searchCountry">,
  settings: typeof WEB_TOOLS = WEB_TOOLS,
): Anthropic.ToolUnion[] {
  return [
    {
      type: TOOL_VERSIONS.search,
      name: "web_search",
      max_uses: request.budget.maxSearches,
      user_location: { type: "approximate", country: request.searchCountry },
      // Omitted = the tool version's default, which is dynamic filtering through code execution.
      ...(settings.searchCaller === "direct" ? { allowed_callers: ["direct" as const] } : {}),
    },
    {
      type: TOOL_VERSIONS.fetch,
      name: "web_fetch",
      max_uses: request.budget.maxFetches,
      citations: { enabled: true },
      ...(settings.fetchMaxContentTokens !== null ? { max_content_tokens: settings.fetchMaxContentTokens } : {}),
      ...(settings.fetchCaller === "direct" ? { allowed_callers: ["direct" as const] } : {}),
    },
  ];
}

export const anthropicWebTools: EvidenceRetriever = {
  id: "anthropic-web-tools",

  async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
    const client = getClient();
    const started = Date.now();

    const messages: Anthropic.MessageParam[] = [{ role: "user", content: request.userText }];
    const blocks: Anthropic.ContentBlock[] = [];
    const usages: Anthropic.Usage[] = [];
    const stopReasons: (string | null)[] = [];
    let continuations = 0;

    for (;;) {
      // We stream so that a long request is not cut off by a timeout,
      // then wait for the complete message with finalMessage().
      const stream = client.messages.stream({
        model: request.model,
        max_tokens: request.maxTokens,
        thinking: { type: "adaptive" },
        output_config: { effort: request.effort },
        system: request.system,
        tools: buildWebTools(request),
        messages,
      });
      const message = await stream.finalMessage();

      blocks.push(...message.content);
      usages.push(message.usage);
      stopReasons.push(message.stop_reason);

      if (message.stop_reason === "pause_turn" && continuations < request.maxContinuations) {
        continuations++;
        // Send the paused answer back unchanged. Do NOT add a "continue" message.
        messages.push({ role: "assistant", content: message.content });
        continue;
      }
      break;
    }

    const ledger = buildLedger(blocks, request.existingSources);
    return {
      retrieverId: this.id,
      rawAnswerText: ledger.rawAnswerText,
      segments: ledger.segments,
      pageTexts: ledger.pageTexts,
      sources: ledger.sources,
      stats: ledger.stats,
      usages,
      stopReasons,
      continuations,
      durationMs: Date.now() - started,
      rawForDebug: blocks,
    };
  },
};
