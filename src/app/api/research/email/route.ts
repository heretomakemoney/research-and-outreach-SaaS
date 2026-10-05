// POST /api/research/email
//
// Writes one email for the chosen angle and contact, in Irmantas' voice
// (rules 04 + 05). No web access. Also used for "regenerate".

import { handleStage } from "@/lib/api";
import { STATE_LIMITS } from "@/lib/config";
import { getRunners } from "@/lib/stages/runners";
import { BadInputError } from "@/lib/stages/common";
import { sanitizeState } from "@/lib/state";
import { validateSynthesis } from "@/lib/synthesis";
import type { ContactChoice, RelationshipInput } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function readContact(v: unknown): ContactChoice {
  const o = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  if (o.source === "researched") {
    return { source: "researched", personId: text(o.personId, 12), name: text(o.name, 120), role: text(o.role, 160) };
  }
  return { source: "manual", name: text(o.name, 120), role: text(o.role, 160) };
}

function readRelationship(v: unknown): RelationshipInput {
  const o = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  return { kind: o.kind === "existing" ? "existing" : "new", note: text(o.note, 1000) };
}

export async function POST(request: Request) {
  return handleStage(request, async (body) => {
    let state;
    try {
      state = sanitizeState(body.state, STATE_LIMITS);
    } catch (e) {
      throw new BadInputError(e instanceof Error ? e.message : "Invalid research state.");
    }
    let synthesis;
    try {
      // Re-validated against the state: references to cards that do not exist are removed again.
      synthesis = validateSynthesis(body.synthesis, state).synthesis;
    } catch {
      throw new BadInputError("The synthesis is missing or invalid. Run the synthesis first.");
    }
    const generation = typeof body.generation === "number" && body.generation >= 1 ? Math.min(50, Math.floor(body.generation)) : 1;
    const runners = await getRunners();
    return runners.email({
      state,
      synthesis,
      angleId: text(body.angleId, 12),
      contact: readContact(body.contact),
      relationship: readRelationship(body.relationship),
      previousBody: text(body.previousBody, 6000) || null,
      generation,
    });
  });
}
