// POST /api/research/identify
//
// This runs on the SERVER. The browser sends the form values; this route
// validates them, runs the identify stage, and returns the result as JSON.
// It never returns the API key.

import Anthropic from "@anthropic-ai/sdk";
import { MissingApiKeyError } from "@/lib/anthropic";
import { runIdentifyStage } from "@/lib/stages/identify";
import { DEFAULT_MODEL } from "@/lib/config";
import { isModelId, type ApiError, type IdentifyInput } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // only matters if this is hosted on a platform with time limits

function fail(error: string, status: number) {
  const body: ApiError = { ok: false, error };
  return Response.json(body, { status });
}

/** Take a value from the request, make sure it is a string, trim it and cap its length. */
function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return fail("The request body must be JSON.", 400);
  }

  const input: IdentifyInput = {
    companyName: text(body.companyName, 200),
    website: text(body.website, 300),
    context: text(body.context, 4000),
    topic: text(body.topic, 1000),
    model: isModelId(body.model) ? body.model : DEFAULT_MODEL,
  };
  if (!input.companyName) return fail("Company name is required.", 400);

  try {
    const result = await runIdentifyStage(input);
    return Response.json(result);
  } catch (error) {
    if (error instanceof MissingApiKeyError) return fail(error.message, 500);
    if (error instanceof Anthropic.AuthenticationError)
      return fail("Anthropic rejected the API key. Check ANTHROPIC_API_KEY in .env.local.", 401);
    if (error instanceof Anthropic.RateLimitError)
      return fail("Anthropic rate limit reached. Wait a minute and try again.", 429);
    if (error instanceof Anthropic.BadRequestError)
      return fail(`Anthropic rejected the request: ${error.message}`, 400);
    if (error instanceof Anthropic.APIConnectionError)
      return fail("Could not reach the Anthropic API (network problem).", 502);
    if (error instanceof Anthropic.APIError)
      return fail(`Anthropic API error ${error.status}: ${error.message}`, 502);
    console.error("Unexpected error in identify stage:", error);
    return fail("Unexpected server error. Check the terminal running `npm run dev`.", 500);
  }
}
