// POST /api/research/discover
//
// Runs on the SERVER. The browser sends the form values; this route validates
// them, runs the discovery stage (identify the company + first research
// round) and returns the research state plus what the gate says to do next.

import { handleStage } from "@/lib/api";
import { getRunners } from "@/lib/stages/runners";
import { BadInputError } from "@/lib/stages/common";
import { sanitizeInput } from "@/lib/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  return handleStage(request, async (body) => {
    const input = sanitizeInput(body.input);
    if (!input.companyName) throw new BadInputError("Company name is required.");
    const runners = await getRunners();
    return runners.research({ kind: "discover", input });
  });
}
