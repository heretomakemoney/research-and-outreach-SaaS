// POST /api/research/synthesize
//
// Turns the research state (evidence cards, people, leads) into relevance,
// ranked triggers, ranked people and conversation angles. No web access.

import { handleStage } from "@/lib/api";
import { STATE_LIMITS } from "@/lib/config";
import { getRunners } from "@/lib/stages/runners";
import { BadInputError } from "@/lib/stages/common";
import { sanitizeState } from "@/lib/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  return handleStage(request, async (body) => {
    let state;
    try {
      state = sanitizeState(body.state, STATE_LIMITS);
    } catch (e) {
      throw new BadInputError(e instanceof Error ? e.message : "Invalid research state.");
    }
    if (state.cards.length === 0 && state.people.length === 0) {
      throw new BadInputError("There is no evidence to evaluate yet. Run the research first.");
    }
    if (state.entity && (state.entity.match === "Ambiguous" || state.entity.match === "Not found")) {
      throw new BadInputError("The company has not been confirmed, so synthesis is not run.");
    }
    const runners = await getRunners();
    return runners.synthesize(state);
  });
}
