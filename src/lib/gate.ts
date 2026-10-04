// The ADAPTIVE GATE: decides what happens after each research stage.
//
// Plain code, no model call, so it costs nothing and can be unit-tested.
// It reads the structured fields the research stage produced (entity match,
// open leads, people found, evidence cards) and the budget used so far.
//
// Possible outcomes:
//   stop_entity - we are not sure which company this is. Stop and ask the human.
//   followup    - run one more targeted research round on specific leads.
//   synthesize  - enough evidence (or nothing more worth chasing): move on.
//
// Pure functions, no server-only imports: unit-tested in gate.test.ts.

import { approxDateToMs } from "./parse";
import type { CardKind, Lead, NextStep, ResearchState } from "./types";

export interface GateOptions {
  maxFollowupRounds: number;
  maxLeadsPerRound: number;
  strongSignalMonths: number;
  maxTotalSearches: number;
  costCapUsd: number | null; // null = not enforced
  now: Date;
}

const STRONG_SIGNAL_KINDS: readonly CardKind[] = ["project", "contract_tender", "infrastructure", "technology", "competitor"];
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

export function hasStrongSignalCard(state: ResearchState, opts: Pick<GateOptions, "strongSignalMonths" | "now">): boolean {
  const cutoff = opts.now.getTime() - opts.strongSignalMonths * 30.44 * 24 * 3600 * 1000;
  return state.cards.some((c) => {
    if (!STRONG_SIGNAL_KINDS.includes(c.kind)) return false;
    const t = approxDateToMs(c.date);
    return t !== null && t >= cutoff;
  });
}

function openLeads(state: ResearchState): Lead[] {
  return state.leads
    .filter((l) => l.status === "open" && l.priority !== "low")
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.id.localeCompare(b.id, "en", { numeric: true }));
}

export function decideNext(state: ResearchState, searchesUsed: number, costUsedUsd: number, opts: GateOptions): NextStep {
  const entity = state.entity;

  // 1. Who is this? If we cannot tell, stop before spending more.
  if (entity && (entity.match === "Ambiguous" || entity.match === "Not found")) {
    return {
      action: "stop_entity",
      reason:
        entity.match === "Ambiguous"
          ? "More than one company could match this name. Please confirm which one (add the website or more context) and run again."
          : "No matching company was found. Check the name and website and run again.",
    };
  }
  if (!entity && state.cards.length === 0) {
    return {
      action: "stop_entity",
      reason: "The research answer contained no readable company identification and no sourced facts. Open the debug panel and run again.",
    };
  }

  // 2. Budget guards (the dollar cap is OFF unless config sets it).
  if (opts.costCapUsd !== null && costUsedUsd >= opts.costCapUsd) {
    return { action: "synthesize", reason: `Cost cap of $${opts.costCapUsd.toFixed(2)} reached; no more research rounds.` };
  }
  if (searchesUsed >= opts.maxTotalSearches) {
    return { action: "synthesize", reason: `Search budget used (${searchesUsed} of ${opts.maxTotalSearches}); moving on.` };
  }
  if (state.followupRounds >= opts.maxFollowupRounds) {
    return { action: "synthesize", reason: "The maximum number of follow-up rounds has been used." };
  }

  const round = state.followupRounds; // 0 before the first follow-up
  const leads = openLeads(state);
  const relevance = state.relevance?.level ?? null;

  // 3. A second round (when allowed) needs a real reason: a new high-priority lead and still no strong dated signal.
  if (round >= 1) {
    const newHigh = leads.filter((l) => l.priority === "high" && l.openedInRound >= round);
    if (newHigh.length > 0 && !hasStrongSignalCard(state, opts)) {
      return {
        action: "followup",
        focus: "leads",
        leadIds: newHigh.slice(0, opts.maxLeadsPerRound).map((l) => l.id),
        reason: "The last round found a new high-priority lead and there is still no recent, strong signal.",
      };
    }
    return { action: "synthesize", reason: "Nothing new and important enough to justify another round." };
  }

  // 4. First follow-up round.
  if (leads.length > 0) {
    return {
      action: "followup",
      focus: "leads",
      leadIds: leads.slice(0, opts.maxLeadsPerRound).map((l) => l.id),
      reason: `${leads.length} open lead(s) worth checking; following the top ${Math.min(leads.length, opts.maxLeadsPerRound)}.`,
    };
  }
  if (relevance !== "none" && state.people.length === 0) {
    return {
      action: "followup",
      focus: "people",
      leadIds: [],
      reason: "The company looks relevant but no relevant people were found yet; one short people-focused round.",
    };
  }
  const substantive = state.cards.filter((c) => c.kind !== "company_profile");
  if (substantive.length === 0) {
    return {
      action: "followup",
      focus: "hook",
      leadIds: [],
      reason: "Only a basic company profile was found; one short round to find a genuine recent conversation hook.",
    };
  }
  return { action: "synthesize", reason: "No open leads worth chasing; the evidence gathered is enough to evaluate." };
}
