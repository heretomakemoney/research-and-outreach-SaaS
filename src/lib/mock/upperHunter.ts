// The saved Upper Hunter workflow, cut into the states the real pipeline passes through.
//
// MOCK DATA ONLY. See src/fixtures/README.md. Nothing outside src/lib/mock may import this file
// (except stages/runners.ts, which loads it only in mock mode); mock.test.ts enforces that.
//
// The fixture is the FINAL workflow. To mimic stage-by-stage progress we rebuild the earlier states from
// it: cards, people and leads carry the stage/round they were found in, and the first 61 sources were
// found by discovery (the follow-up's first new source is S62; a test checks this).

import fixtureJson from "../../fixtures/upper-hunter.workflow.json" with { type: "json" };
import type { ResearchState, Workflow, WorkflowInput } from "../types";

export const DISCOVER_SOURCE_COUNT = 61;

export function loadFixture(): Workflow {
  return structuredClone(fixtureJson) as unknown as Workflow;
}

/** The research state as it was right after the discovery stage. */
export function discoverSnapshot(input: WorkflowInput): ResearchState {
  const fx = loadFixture().state;
  return {
    ...fx,
    input,
    cards: fx.cards.filter((c) => c.stage === "discover"),
    people: fx.people.filter((p) => p.stage === "discover"),
    // Leads found by discovery, before the follow-up reported on them.
    leads: fx.leads.filter((l) => l.openedInRound === 0).map((l) => ({ ...l, status: "open" as const, resolutionNote: "" })),
    coverage: [], // not recorded per stage in the saved run
    sources: fx.sources.slice(0, DISCOVER_SOURCE_COUNT),
    followupRounds: 0,
    stages: fx.stages.slice(0, 1),
  };
}

/** The research state after the follow-up round (the saved final state, with the caller's input). */
export function followupSnapshot(input: WorkflowInput): ResearchState {
  const fx = loadFixture().state;
  return { ...fx, input };
}
