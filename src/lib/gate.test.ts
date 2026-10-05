import assert from "node:assert/strict";
import { test } from "node:test";
import { decideNext, hasStrongSignalCard, type GateOptions } from "./gate.ts";
import { emptyState } from "./state.ts";
import type { EntityInfo, EvidenceCard, Lead, ResearchState } from "./types.ts";

const NOW = new Date("2026-10-04T00:00:00Z");
const opts: GateOptions = { maxFollowupRounds: 1, maxLeadsPerRound: 3, strongSignalMonths: 12, maxTotalSearches: 14, costCapUsd: null, now: NOW };

const entity = (match: EntityInfo["match"]): EntityInfo => ({ match, matchNote: "n", name: "X", website: "", tradingLegal: "", industry: "", clientType: "", summary: "", contextCheck: "", sourceKeys: [] });
const card = (id: string, kind: EvidenceCard["kind"], date: string | null): EvidenceCard => ({ id, kind, date, claim: "c" + id, sourceKeys: ["S1"], evidence: [], grade: "api_cited", stage: "discover", round: 0 });
const lead = (id: string, priority: Lead["priority"], status: Lead["status"] = "open", openedInRound = 0): Lead => ({ id, priority, question: "q" + id, why: "", status, resolutionNote: "", openedInRound });

function state(over: Partial<ResearchState> = {}): ResearchState {
  return { ...emptyState({ companyName: "X", website: "", context: "", topic: "" }), entity: entity("Confirmed"), cards: [card("E1", "project", "2026-08")], people: [{ id: "P1", name: "A", role: "", organisation: "", whyRelevant: "", sourceKeys: ["S1"], evidence: [], grade: "api_cited", stage: "discover" }], ...over };
}

test("an ambiguous or unknown company stops the pipeline before more spending", () => {
  assert.equal(decideNext(state({ entity: entity("Ambiguous") }), 5, 0.3, opts).action, "stop_entity");
  assert.equal(decideNext(state({ entity: entity("Not found") }), 5, 0.3, opts).action, "stop_entity");
});

test("nothing readable at all stops", () => {
  assert.equal(decideNext(state({ entity: null, cards: [], people: [] }), 5, 0.3, opts).action, "stop_entity");
});

test("open medium/high leads trigger a follow-up on the top three, highest priority first", () => {
  const s = state({ leads: [lead("L1", "medium"), lead("L2", "high"), lead("L3", "high"), lead("L4", "medium"), lead("L5", "low")] });
  const n = decideNext(s, 5, 0.3, opts);
  assert.equal(n.action, "followup");
  if (n.action === "followup") {
    assert.deepEqual(n.leadIds, ["L2", "L3", "L1"]);
    assert.equal(n.focus, "leads");
  }
});

test("low-priority leads alone do not justify a follow-up", () => {
  assert.equal(decideNext(state({ leads: [lead("L1", "low")] }), 5, 0.3, opts).action, "synthesize");
});

test("a relevant company with no people gets one people-focused round", () => {
  const n = decideNext(state({ people: [], relevance: { level: "moderate", note: "" } }), 5, 0.3, opts);
  assert.equal(n.action, "followup");
  if (n.action === "followup") assert.equal(n.focus, "people");
});

test("an irrelevant company with no people does not get a people round", () => {
  assert.equal(decideNext(state({ people: [], relevance: { level: "none", note: "" } }), 5, 0.3, opts).action, "synthesize");
});

test("only a company profile found: one hook round", () => {
  const n = decideNext(state({ cards: [card("E1", "company_profile", null)], relevance: { level: "none", note: "" } }), 5, 0.3, opts);
  assert.equal(n.action, "followup");
  if (n.action === "followup") assert.equal(n.focus, "hook");
});

test("enough evidence and nothing worth chasing goes straight to synthesis", () => {
  assert.equal(decideNext(state(), 5, 0.3, opts).action, "synthesize");
});

test("after the allowed number of rounds it always moves on", () => {
  const s = state({ followupRounds: 1, leads: [lead("L9", "high", "open", 1)], cards: [card("E1", "company_profile", null)] });
  assert.equal(decideNext(s, 5, 0.3, opts).action, "synthesize");
});

test("a second round (when allowed) needs a new high lead AND no recent strong signal", () => {
  const two = { ...opts, maxFollowupRounds: 2 };
  const withNewHigh = state({ followupRounds: 1, cards: [card("E1", "company_profile", null)], leads: [lead("L9", "high", "open", 1)] });
  assert.equal(decideNext(withNewHigh, 8, 0.4, two).action, "followup");
  const haveSignal = state({ followupRounds: 1, leads: [lead("L9", "high", "open", 1)] }); // E1 is a recent project
  assert.equal(decideNext(haveSignal, 8, 0.4, two).action, "synthesize");
  const onlyOld = state({ followupRounds: 1, leads: [lead("L9", "high", "open", 0)], cards: [card("E1", "company_profile", null)] });
  assert.equal(decideNext(onlyOld, 8, 0.4, two).action, "synthesize");
});

test("search budget and (optional) dollar cap stop further rounds", () => {
  const s = state({ leads: [lead("L1", "high")] });
  assert.equal(decideNext(s, 14, 0.3, opts).action, "synthesize");
  assert.equal(decideNext(s, 5, 0.3, { ...opts, costCapUsd: 0.25 }).action, "synthesize");
  assert.equal(decideNext(s, 5, 99, opts).action, "followup"); // cap is off by default
});

test("strong-signal check uses card kind and date", () => {
  assert.equal(hasStrongSignalCard(state({ cards: [card("E1", "project", "2026-08")] }), opts), true);
  assert.equal(hasStrongSignalCard(state({ cards: [card("E1", "project", "2024-01")] }), opts), false);
  assert.equal(hasStrongSignalCard(state({ cards: [card("E1", "news", "2026-08")] }), opts), false);
  assert.equal(hasStrongSignalCard(state({ cards: [card("E1", "project", null)] }), opts), false);
});
