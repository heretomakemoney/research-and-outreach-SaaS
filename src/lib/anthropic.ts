// The ONLY file that talks to the Anthropic API.
//
// It runs on the server only. The API key is read from the environment
// (.env.local) here and nowhere else, and is never sent to the browser.

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { TOOL_VERSIONS } from "./config";

export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "ANTHROPIC_API_KEY is not set. Copy .env.example to .env.local, add your key, and restart `npm run dev`.",
    );
  }
}

export function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new MissingApiKeyError();
  return new Anthropic(); // reads ANTHROPIC_API_KEY from the environment
}

export interface WebToolCall {
  model: string;
  system: Anthropic.TextBlockParam[];
  userText: string;
  maxSearches: number;
  maxFetches: number;
  maxContinuations: number;
  maxTokens: number;
  effort: "low" | "medium" | "high";
  searchCountry: string;
}

export interface WebToolCallResult {
  /** Every content block from every request, in order. */
  blocks: Anthropic.ContentBlock[];
  /** The `usage` object of every request (a long answer can take several). */
  usages: Anthropic.Usage[];
  stopReasons: (string | null)[];
  continuations: number;
  durationMs: number;
}

/**
 * Ask Claude something with web search + web fetch switched on.
 *
 * Anthropic runs the searches and page reads on ITS servers, inside our one
 * request. If the turn gets long, Anthropic pauses it (stop_reason "pause_turn")
 * and we simply send the paused answer back to let it carry on.
 */
export async function runWithWebTools(call: WebToolCall): Promise<WebToolCallResult> {
  const client = getClient();
  const started = Date.now();

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: call.userText }];
  const blocks: Anthropic.ContentBlock[] = [];
  const usages: Anthropic.Usage[] = [];
  const stopReasons: (string | null)[] = [];
  let continuations = 0;

  for (;;) {
    // We stream so that a long request is not cut off by a timeout,
    // then wait for the complete message with finalMessage().
    const stream = client.messages.stream({
      model: call.model,
      max_tokens: call.maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: call.effort },
      system: call.system,
      tools: [
        {
          type: TOOL_VERSIONS.search,
          name: "web_search",
          max_uses: call.maxSearches,
          user_location: { type: "approximate", country: call.searchCountry },
        },
        {
          type: TOOL_VERSIONS.fetch,
          name: "web_fetch",
          max_uses: call.maxFetches,
          citations: { enabled: true },
        },
      ],
      messages,
    });
    const message = await stream.finalMessage();

    blocks.push(...message.content);
    usages.push(message.usage);
    stopReasons.push(message.stop_reason);

    if (message.stop_reason === "pause_turn" && continuations < call.maxContinuations) {
      continuations++;
      // Send the paused answer back unchanged. Do NOT add a "continue" message.
      messages.push({ role: "assistant", content: message.content });
      continue;
    }
    break;
  }

  return { blocks, usages, stopReasons, continuations, durationMs: Date.now() - started };
}
