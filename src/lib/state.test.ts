import assert from "node:assert/strict";
import { test } from "node:test";
import { STATE_LIMITS } from "./config.ts";
import { emptyState, mergeResearch, sanitizeState, serializeStateForModel } from "./state.ts";
import type { ParsedResearch } from "./parse.ts";
import type { LedgerSource, ResearchState } from "./types.ts";

const source = (n: number): LedgerSource => ({
  key: `S${n}`,
  url: `https://site${n}.example/page`,
  title: `Page ${n}`,
  pageAge: null,
  seenInSearch: true,
  fetched: n % 2 === 0,
  fetchKind: n % 2 === 0 ? "text" : null,
  retrievedAt: null,
  fetchError: null,
  citedCount: 0,
  citedExcerpts: [],
});

const input = { companyName: "Indratel", website: "", context: "private note", topic: "" };

function parsed(over: Partial<ParsedResearch> = {}): ParsedResearch {
  return { entity: null, cards: [], people: [], leads: [], leadResults: [], coverage: [], relevance: null, rejected: [], notes: [], ignoredLines: 0, ...over };
}

const card = (claim: string, keys: string[] = ["S1"]) => ({
  kind: "project" as const,
  date: "2026-03",
  claim,
  sourceKeys: keys,
  evidence: [{ sourceKey: keys[0], excerpt: "exc" }],
  grade: "api_cited" as const,
});

function merge(prior: ResearchState, p: ParsedResearch, over: Partial<Parameters<typeof mergeResearch>[2]> = {}) {
  return mergeResearch(prior, p, {
    stage: "discover",
    round: 0,
    sources: [source(1), source(2)],
    focusLeadIds: [],
    limits: STATE_LIMITS,
    ...over,
  });
}

test("cards, people and leads get stable ids assigned by code", () => {
  const { state } = merge(
    emptyState(input),
    parsed({
      cards: [card("Fact one"), card("Fact two")],
      people: [{ name: "Jane Roe", role: "Ops", organisation: "Indratel", whyRelevant: "x", sourceKeys: ["S1"], evidence: [], grade: "api_cited" as const }],
      leads: [{ priority: "high", question: "Which carrier?", why: "w" }],
    }),
  );
  assert.deepEqual(state.cards.map((c) => c.id), ["E1", "E2"]);
  assert.equal(state.people[0].id, "P1");
  assert.equal(state.leads[0].id, "L1");
  assert.equal(state.leads[0].status, "open");
});

test("a second stage continues numbering and skips duplicates", () => {
  const first = merge(emptyState(input), parsed({ cards: [card("Fact one")] })).state;
  const second = merge(first, parsed({ cards: [card("fact one."), card("Fact three")] }), { stage: "followup", round: 1 }).state;
  assert.deepEqual(second.cards.map((c) => c.id), ["E1", "E2"]);
  assert.equal(second.cards[1].claim, "Fact three");
  assert.equal(second.cards[1].stage, "followup");
  assert.equal(second.followupRounds, 1);
});

test("cards pointing at sources that do not exist are dropped", () => {
  const { state, warnings } = merge(emptyState(input), parsed({ cards: [card("Ghost", ["S99"])] }));
  assert.equal(state.cards.length, 0);
  assert.ok(warnings.some((w) => /dropped/.test(w)));
});

test("lead results close leads, and a lead the round was asked about but did not report is closed too", () => {
  const first = merge(
    emptyState(input),
    parsed({ leads: [
      { priority: "high", question: "Q one", why: "" },
      { priority: "high", question: "Q two", why: "" },
      { priority: "medium", question: "Q three", why: "" },
    ] }),
  ).state;
  const second = merge(
    first,
    parsed({ leadResults: [{ leadId: "L1", status: "resolved", note: "found it" }] }),
    { stage: "followup", round: 1, focusLeadIds: ["L1", "L2"] },
  ).state;
  const byId = Object.fromEntries(second.leads.map((l) => [l.id, l]));
  assert.equal(byId.L1.status, "resolved");
  assert.equal(byId.L1.resolutionNote, "found it");
  assert.equal(byId.L2.status, "unresolved"); // asked about, no result reported
  assert.equal(byId.L3.status, "open"); // not part of this round
});

test("only discovery sets the entity", () => {
  const entity = { match: "Confirmed" as const, matchNote: "ok", name: "Indratel", website: "", tradingLegal: "", industry: "", clientType: "", summary: "", contextCheck: "", sourceKeys: ["S1", "S77"] };
  const first = merge(emptyState(input), parsed({ entity })).state;
  assert.equal(first.entity?.name, "Indratel");
  assert.deepEqual(first.entity?.sourceKeys, ["S1"]); // S77 does not exist
  const second = merge(first, parsed({ entity: { ...entity, name: "Changed" } }), { stage: "followup", round: 1 }).state;
  assert.equal(second.entity?.name, "Indratel");
});

test("the compact state for the model carries ids and source ids but no raw excerpts", () => {
  const { state } = merge(emptyState(input), parsed({ cards: [card("Fact one")], leads: [{ priority: "high", question: "Q?", why: "w" }] }));
  const text = serializeStateForModel(state, { includeSources: true });
  assert.match(text, /E1 \| project \| 2026-03 \| Fact one \| S1/);
  assert.match(text, /L1 \| high \| open \| Q\?/);
  assert.match(text, /S1 \| site1\.example/);
  assert.ok(!text.includes("exc"), "excerpts stay out of the prompt");
  assert.ok(!text.includes("private note"), "private context is added by the prompt, not by the state");
});

test("state coming back from the browser is validated and capped", () => {
  const good = merge(emptyState(input), parsed({ cards: [card("Fact one")] })).state;
  const roundTrip = sanitizeState(JSON.parse(JSON.stringify(good)), STATE_LIMITS);
  assert.equal(roundTrip.cards.length, 1);

  assert.throws(() => sanitizeState(null, STATE_LIMITS));
  assert.throws(() => sanitizeState({ input: { companyName: "" } }, STATE_LIMITS));

  const hostile = JSON.parse(JSON.stringify(good));
  hostile.cards.push({ id: "E9", kind: "project", claim: "no sources", sourceKeys: ["S404"], evidence: [] });
  hostile.cards.push({ id: "bad id", kind: "project", claim: "bad id", sourceKeys: ["S1"], evidence: [] });
  hostile.sources.push({ key: "S50", url: "javascript:alert(1)" });
  hostile.cards[0].claim = "x".repeat(10_000);
  const cleaned = sanitizeState(hostile, STATE_LIMITS);
  assert.equal(cleaned.cards.length, 1);
  assert.equal(cleaned.cards[0].claim.length, STATE_LIMITS.maxClaimChars);
  assert.ok(!cleaned.sources.some((s) => s.key === "S50"));
});
