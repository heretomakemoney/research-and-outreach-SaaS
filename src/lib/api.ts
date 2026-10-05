// Shared plumbing for the API routes: read the JSON body, run the stage,
// and turn errors into short, human-readable messages. Server only.
//
// Never returns the API key.

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { MissingApiKeyError, MockModeError } from "./anthropic";
import { BadInputError } from "./stages/common";
import type { ApiError } from "./types";

export function fail(error: string, status: number) {
  const body: ApiError = { ok: false, error };
  return Response.json(body, { status });
}

export async function handleStage(request: Request, run: (body: Record<string, unknown>) => Promise<unknown>) {
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return fail("The request body must be a JSON object.", 400);
  }

  try {
    const result = await run(body);
    return Response.json({ ok: true, ...(result as object) });
  } catch (error) {
    if (error instanceof BadInputError) return fail(error.message, 400);
    if (error instanceof MissingApiKeyError || error instanceof MockModeError) return fail(error.message, 500);
    if (error instanceof Anthropic.AuthenticationError)
      return fail("Anthropic rejected the API key. Check ANTHROPIC_API_KEY.", 401);
    if (error instanceof Anthropic.RateLimitError)
      return fail("Anthropic rate limit reached. Wait a minute and try again.", 429);
    if (error instanceof Anthropic.BadRequestError)
      return fail(`Anthropic rejected the request: ${error.message}`, 400);
    if (error instanceof Anthropic.APIConnectionError)
      return fail("Could not reach the Anthropic API (network problem).", 502);
    if (error instanceof Anthropic.APIError)
      return fail(`Anthropic API error ${error.status}: ${error.message}`, 502);
    if (error instanceof Error && /valid JSON|not a JSON object|no body/.test(error.message)) return fail(error.message, 502);
    console.error("Unexpected error in research stage:", error);
    return fail("Unexpected server error. Check the server logs.", 500);
  }
}
