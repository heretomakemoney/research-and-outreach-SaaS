// Checks the synthesis (and email) answers against the research state.
//
// The model returns JSON that follows a schema, but a schema cannot know which
// card ids really exist. This file does. Anything that points at a card,
// person or trigger that does not exist is REMOVED and listed in
// `droppedReferences`, so the UI never shows a claim that cannot be traced to
// a real evidence card.
//
// Pure functions, unit-tested in synthesis.test.ts.

import type {
  Angle,
  AngleStrength,
  EvidenceCard,
  LeadPriority,
  RankedPerson,
  Recency,
  RelevanceLevel,
  ResearchState,
  Synthesis,
  Trigger,
  TriggerKind,
  TriggerRank,
} from "./types";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
const str = (v: unknown, max = 2000): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}
function ids(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()) : [];
}

export interface ValidatedSynthesis {
  synthesis: Synthesis;
  warnings: string[];
}

export function validateSynthesis(raw: unknown, state: ResearchState): ValidatedSynthesis {
  if (!isObject(raw)) throw new Error("The synthesis answer was not a JSON object.");
  const warnings: string[] = [];
  const dropped: string[] = [];
  const cardIds = new Set(state.cards.map((c) => c.id));
  const personIds = new Set(state.people.map((p) => p.id));

  const keepCards = (list: string[], owner: string): string[] =>
    list.filter((id) => {
      if (cardIds.has(id)) return true;
      dropped.push(`${owner} referenced evidence card ${id}, which does not exist.`);
      return false;
    });

  // Triggers
  const triggers: Trigger[] = [];
  const rawTriggers = Array.isArray(raw.triggers) ? raw.triggers : [];
  for (const [i, t] of rawTriggers.entries()) {
    if (!isObject(t)) continue;
    const id = str(t.id, 12) || `T${i + 1}`;
    const factCardIds = keepCards(ids(t.factCardIds), `Trigger ${id}`);
    if (factCardIds.length === 0) {
      dropped.push(`Trigger ${id} ("${str(t.title, 80)}") was removed because none of its evidence cards exist.`);
      continue;
    }
    triggers.push({
      id,
      rank: oneOf<TriggerRank>(t.rank, ["primary", "secondary", "hook"], "secondary"),
      kind: oneOf<TriggerKind>(t.kind, ["sales_trigger", "conversation_hook"], "conversation_hook"),
      priority: oneOf<LeadPriority>(t.priority, ["high", "medium", "low"], "medium"),
      title: str(t.title, 300),
      recency: oneOf<Recency>(t.recency, ["under_3_months", "3_to_6_months", "6_to_12_months", "over_12_months", "unknown"], "unknown"),
      scale: str(t.scale, 400),
      fact: str(t.fact, 1500),
      factCardIds,
      inference: str(t.inference, 1500),
      possibleOpportunity: str(t.possibleOpportunity, 1500),
      whyNow: str(t.whyNow, 800),
    });
  }
  // At most one PRIMARY trigger.
  let sawPrimary = false;
  for (const t of triggers) {
    if (t.rank !== "primary") continue;
    if (sawPrimary) t.rank = "secondary";
    sawPrimary = true;
  }
  const triggerIds = new Set(triggers.map((t) => t.id));

  // People: only people that exist in the research state.
  const people: RankedPerson[] = [];
  const rawPeople = Array.isArray(raw.people) ? raw.people : [];
  for (const p of rawPeople) {
    if (!isObject(p)) continue;
    const personId = str(p.personId, 12);
    if (!personIds.has(personId)) {
      dropped.push(`A ranked person referenced ${personId || "(no id)"}, which does not exist.`);
      continue;
    }
    if (people.some((x) => x.personId === personId)) continue;
    people.push({
      personId,
      rank: typeof p.rank === "number" && Number.isFinite(p.rank) ? p.rank : people.length + 1,
      whyRelevant: str(p.whyRelevant, 800),
    });
  }
  people.sort((a, b) => a.rank - b.rank);

  // Angles
  let angles: Angle[] = [];
  const rawAngles = Array.isArray(raw.angles) ? raw.angles : [];
  for (const [i, a] of rawAngles.entries()) {
    if (!isObject(a)) continue;
    const id = str(a.id, 12) || `A${i + 1}`;
    const strength = oneOf<AngleStrength>(a.strength, ["strong", "medium", "weak", "general_introduction"], "weak");
    const angleCards = keepCards(ids(a.cardIds), `Angle ${id}`);
    const angleTriggers = ids(a.triggerIds).filter((tid) => {
      if (triggerIds.has(tid)) return true;
      dropped.push(`Angle ${id} referenced trigger ${tid}, which does not exist.`);
      return false;
    });
    if (strength !== "general_introduction" && angleCards.length === 0) {
      warnings.push(`Angle ${id} ("${str(a.title, 60)}") has no valid evidence card behind it.`);
    }
    angles.push({
      id,
      title: str(a.title, 300),
      strength,
      triggerIds: angleTriggers,
      cardIds: angleCards,
      conversationQuestion: str(a.conversationQuestion, 800),
      whyItWorks: str(a.whyItWorks, 800),
      recommended: a.recommended === true,
    });
  }
  angles = angles.filter((a) => a.title && a.conversationQuestion);
  if (angles.length === 0) warnings.push("The synthesis returned no usable conversation angle.");

  // Exactly one recommended angle.
  const recommended = angles.filter((a) => a.recommended);
  if (angles.length > 0 && recommended.length !== 1) {
    warnings.push(
      recommended.length === 0
        ? "No angle was marked as recommended; the first angle was marked."
        : "More than one angle was marked as recommended; only the first stays.",
    );
    angles.forEach((a, i) => {
      a.recommended = recommended.length === 0 ? i === 0 : a.id === recommended[0].id;
    });
  }

  const synthesis: Synthesis = {
    relevance: oneOf<RelevanceLevel>(raw.relevance, ["strong", "moderate", "weak", "none"], "weak"),
    summary: str(raw.summary, 2500),
    noMeaningfulAngleNote: str(raw.noMeaningfulAngleNote, 1500),
    triggers,
    people,
    angles,
    gaps: ids(raw.gaps).map((g) => g.slice(0, 500)),
    droppedReferences: dropped,
  };
  return { synthesis, warnings };
}

// ------------------------------------------------------------------ email

export interface ValidatedEmail {
  subject: string;
  body: string;
  usedCardIds: string[];
  warnings: string[];
}

/** `allowedCards` = the cards that were actually supplied to the email stage. */
export function validateEmail(raw: unknown, allowedCards: readonly EvidenceCard[]): ValidatedEmail {
  if (!isObject(raw)) throw new Error("The email answer was not a JSON object.");
  const warnings: string[] = [];
  const subject = str(raw.subject, 300);
  const body = typeof raw.body === "string" ? raw.body.replace(/\r\n/g, "\n").trim() : "";
  if (!body) throw new Error("The email answer had no body.");
  if (!subject) warnings.push("The email has no subject line.");
  const allowed = new Set(allowedCards.map((c) => c.id));
  const usedCardIds: string[] = [];
  for (const id of ids(raw.usedCardIds)) {
    if (allowed.has(id)) {
      if (!usedCardIds.includes(id)) usedCardIds.push(id);
    } else {
      warnings.push(`The email listed evidence card ${id} as used, but it was not supplied for this email; removed.`);
    }
  }
  return { subject, body, usedCardIds, warnings };
}
