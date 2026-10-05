// POST /api/research/followup
//
// Runs one targeted follow-up research round. The browser sends back the
// research state it holds. The SERVER re-runs the gate on that state and only
// proceeds if the gate itself says a follow-up is justified, and it uses the
// gate's choice of leads, not anything the browser asked for.

import { handleStage } from "@/lib/api";
import { GATE, STATE_LIMITS } from "@/lib/config";
import { decideNext } from "@/lib/gate";
import { getRunners } from "@/lib/stages/runners";
import { BadInputError } from "@/lib/stages/common";
import { sanitizeState, totalCostUsd, totalSearches } from "@/lib/state";

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
    const next = decideNext(state, totalSearches(state), totalCostUsd(state), { ...GATE, now: new Date() });
    if (next.action !== "followup") {
      throw new BadInputError(`No follow-up is justified for this research (${next.reason})`);
    }
    const runners = await getRunners();
    return runners.research({ kind: "followup", state, focus: next.focus, leadIds: next.leadIds });
  });
}
