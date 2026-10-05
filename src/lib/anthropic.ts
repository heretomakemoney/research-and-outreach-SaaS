// The Anthropic API client, and the one function for plain (no web tools) calls.
//
// Server only. The API key is read from the environment (.env.local or the
// hosting platform's environment variables) here and nowhere else, and is
// never sent to the browser.
//
// The web-tool loop used by the research stages lives in
// retrieval/anthropicWebTools.ts, because that is the part we may replace
// with a different search provider later.

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { aiMode } from "./mode";

export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local (local) or to the Vercel project's environment variables, then restart / redeploy.",
    );
  }
}

export class MockModeError extends Error {
  constructor() {
    super("AI_MODE is mock, so paid Anthropic calls are switched off. Set AI_MODE=live to make real calls.");
  }
}

export function getClient(): Anthropic {
  // Hard stop: in mock mode no client is ever created, even if a key is present.
  if (aiMode() === "mock") throw new MockModeError();
  if (!process.env.ANTHROPIC_API_KEY) throw new MissingApiKeyError();
  return new Anthropic(); // reads ANTHROPIC_API_KEY from the environment
}

export interface StructuredCall {
  model: string;
  system: Anthropic.TextBlockParam[];
  userText: string;
  maxTokens: number;
  effort: "low" | "medium" | "high";
  /** JSON schema the answer must follow (structured outputs). Every object needs additionalProperties:false. */
  schema: Record<string, unknown>;
}

export interface StructuredResult {
  text: string; // the JSON text of the answer
  usage: Anthropic.Usage;
  stopReason: string | null;
  durationMs: number;
}

/**
 * One request, no tools, answer constrained to a JSON schema.
 * Used by the synthesis and email stages, which only reason over the compact
 * research state and never touch the web.
 */
export async function runStructured(call: StructuredCall): Promise<StructuredResult> {
  const client = getClient();
  const started = Date.now();
  // Stream, then wait for the whole message: avoids request timeouts on long answers.
  const stream = client.messages.stream({
    model: call.model,
    max_tokens: call.maxTokens,
    thinking: { type: "adaptive" },
    output_config: {
      effort: call.effort,
      format: { type: "json_schema", schema: call.schema },
    },
    system: call.system,
    messages: [{ role: "user", content: call.userText }],
  });
  const message = await stream.finalMessage();
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { text, usage: message.usage, stopReason: message.stop_reason, durationMs: Date.now() - started };
}
