// End-to-end test of the whole pipeline with FAKE model and web calls:
// discover -> gate -> follow-up -> gate -> synthesis -> email.
// It runs our real prompts, rules loading, ledger, parser, state, gate, validation
// and cost code. Nothing touches the network and no API key is needed.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { cited, fakeRetriever, plain, searchBlocks, searchResult, usage } from "../testing.ts";
import { runEmailStage } from "./email.ts";
import { runResearchStage } from "./research.ts";
import { runSynthesizeStage } from "./synthesize.ts";
import type { StructuredCall } from "../anthropic.ts";
import type { ResearchState, Synthesis } from "../types.ts";

const rule = (name: string) => fs.readFileSync(path.join(process.cwd(), "docs", "intelligence", name), "utf-8");
const input = { companyName: "Indratel", website: "https://indratel.com.au", context: "I think they use Teltonika competitor gear", topic: "" };

const URL_HOME = "https://indratel.com.au/";
const URL_NEWS = "https://news.example/indratel-contract";
const URL_STAFF = "https://indratel.com.au/team";

const discoverBlocks = () => [
  ...searchBlocks("s1", "Indratel Australia", [searchResult(URL_HOME, "Indratel"), searchResult(URL_NEWS, "Contract news", "March 2026")]),
  cited("ENTITY_MATCH: Confirmed - website and ABN agree\nENTITY_NAME: Indratel Pty Ltd", URL_HOME, "Indratel", "Indratel Pty Ltd"),
  plain("\nOFFICIAL_WEBSITE: https://indratel.com.au\nINDUSTRY: Utilities - telemetry integrator\nCLIENT_TYPE: Integrator / System Integrator - delivers SCADA\nSUMMARY: Indratel integrates telemetry.\nCONTEXT_CHECK: not verifiable"),
  plain("\nRELEVANCE | strong | many remote sites"),
  cited("\nCARD | contract_tender | 2026-03 | Indratel won a telemetry upgrade for 40 water sites.", URL_NEWS, "Contract news", "won the telemetry upgrade for 40 sites"),
  plain("\nLEAD | high | Which carrier connects the 40 sites? | Shows how connectivity is handled"),
  plain("\nLEAD | low | Any awards? | minor"),
  plain("\nCOVERAGE | people | not_found | no staff page checked yet"),
];

const followupBlocks = () => [
  ...searchBlocks("s2", "Indratel team operations manager", [searchResult(URL_STAFF, "Team"), searchResult(URL_HOME, "Indratel")]),
  cited("LEAD_RESULT | L1 | resolved | Carrier is a cellular provider\nCARD | technology | 2026-02 | The 40 sites use cellular modems for telemetry.", URL_STAFF, "Team", "cellular modems at each site"),
  cited("\nPERSON | Jane Roe | Operations Manager | Indratel | Owns field telemetry", URL_STAFF, "Team", "Jane Roe, Operations Manager"),
];

const synthesisJson = (cards: string[], personId: string) =>
  JSON.stringify({
    relevance: "strong",
    summary: "Telemetry integrator with a 40-site rollout.",
    noMeaningfulAngleNote: "",
    triggers: [
      {
        id: "T1", rank: "primary", kind: "sales_trigger", priority: "high", title: "40-site telemetry upgrade", recency: "6_to_12_months", scale: "40 sites",
        fact: "Indratel won a telemetry upgrade for 40 water sites.", factCardIds: [cards[0], "E404"],
        inference: "Remote sites need connectivity.", possibleOpportunity: "Ask how the sites are connected.", whyNow: "Rollout under way.",
      },
    ],
    people: [{ personId, rank: 1, whyRelevant: "Owns field telemetry" }],
    angles: [
      { id: "A1", title: "Connectivity across the 40-site rollout", strength: "strong", triggerIds: ["T1"], cardIds: cards, conversationQuestion: "How are you connecting the 40 sites?", whyItWorks: "Specific and answerable.", recommended: true },
    ],
    gaps: ["Carrier not confirmed"],
  });

function fakeStructured(texts: string[]) {
  const calls: StructuredCall[] = [];
  const runStructured = async (call: StructuredCall) => {
    calls.push(call);
    return { text: texts.shift() ?? "{}", usage: usage({ input_tokens: 15000, output_tokens: 4000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null }), stopReason: "end_turn", durationMs: 50 };
  };
  return { runStructured: runStructured as never, calls };
}

test("the whole Q1 pipeline runs offline and keeps every claim traceable", async () => {
  // ---- stage 1: discover
  const d = fakeRetriever(discoverBlocks());
  const discovered = await runResearchStage({ kind: "discover", input }, { retriever: d.retriever });

  // intelligence files: 01 + 02 only, loaded from disk, verbatim
  const sys1 = d.requests[0].system.map((b) => b.text).join("\n");
  assert.ok(sys1.includes(rule("01_RESEARCH_RULES.md")));
  assert.ok(sys1.includes(rule("02_TELTONIKA_RELEVANCE.md")));
  assert.ok(!sys1.includes("BEGIN 03_SALES_TRIGGERS.md"));
  assert.ok(!sys1.includes("BEGIN 04_OUTREACH_RULES.md"));
  assert.equal(d.requests[0].model, "claude-sonnet-5-5");
  assert.deepEqual(d.requests[0].budget, { maxSearches: 8, maxFetches: 5 });
  assert.ok(d.requests[0].userText.includes("I think they use Teltonika competitor gear"), "private context is passed as a hint");

  assert.equal(discovered.state.entity?.match, "Confirmed");
  assert.equal(discovered.state.cards.length, 1);
  assert.equal(discovered.state.cards[0].id, "E1");
  assert.deepEqual(discovered.state.cards[0].sourceKeys, ["S2"]); // news page = second search result
  assert.equal(discovered.state.cards[0].evidence[0].excerpt, "won the telemetry upgrade for 40 sites");
  assert.ok(!discovered.state.cards.some((c) => c.claim.includes("competitor gear")), "context never becomes evidence");
  assert.equal(discovered.log.model, "claude-sonnet-5-5");
  assert.equal(discovered.log.cost.totalUsd.toFixed(4), "0.2674"); // NTT tokens priced on Sonnet
  assert.equal(discovered.next.action, "followup");
  if (discovered.next.action === "followup") assert.deepEqual(discovered.next.leadIds, ["L1"]);

  // ---- stage 2: follow-up
  const f = fakeRetriever(followupBlocks(), [usage({ server_tool_use: { web_search_requests: 3, web_fetch_requests: 2 }, output_tokens: 2500 })]);
  const followed = await runResearchStage(
    { kind: "followup", state: discovered.state, focus: "leads", leadIds: ["L1"] },
    { retriever: f.retriever },
  );
  assert.equal(f.requests[0].existingSources.length, 2, "earlier sources are passed on");
  assert.ok(f.requests[0].userText.includes("E1 | contract_tender"), "the compact state is passed");
  assert.ok(!f.requests[0].userText.includes("won the telemetry upgrade for 40 sites"), "excerpts are not repeated in the prompt");
  assert.deepEqual(followed.state.sources.map((s) => s.key), ["S1", "S2", "S3"]); // S3 new; S1 reused
  assert.equal(followed.state.cards.length, 2);
  assert.equal(followed.state.cards[1].id, "E2");
  assert.equal(followed.state.people[0].id, "P1");
  assert.equal(followed.state.leads.find((l) => l.id === "L1")?.status, "resolved");
  assert.equal(followed.state.followupRounds, 1);
  assert.equal(followed.state.stages.length, 2);
  assert.equal(followed.next.action, "synthesize");

  // ---- stage 3: synthesis (Opus, no tools, 01 + 02 + 03)
  const synthFake = fakeStructured([synthesisJson(["E1", "E2"], "P1")]);
  const synthesised = await runSynthesizeStage(followed.state, { runStructured: synthFake.runStructured });
  const sys3 = synthFake.calls[0].system.map((b) => b.text).join("\n");
  for (const n of ["01_RESEARCH_RULES.md", "02_TELTONIKA_RELEVANCE.md", "03_SALES_TRIGGERS.md"]) assert.ok(sys3.includes(rule(n)));
  assert.ok(!sys3.includes("BEGIN 04_OUTREACH_RULES.md"));
  assert.equal(synthFake.calls[0].model, "claude-opus-5-5");
  assert.ok(synthFake.calls[0].userText.includes("E2 | technology"), "synthesis sees the compact state");
  assert.ok(!synthFake.calls[0].userText.includes("cellular modems at each site"), "and not the raw excerpts");
  assert.deepEqual(synthesised.synthesis.triggers[0].factCardIds, ["E1"]); // E404 removed
  assert.ok(synthesised.synthesis.droppedReferences.some((r) => r.includes("E404")));
  assert.equal(synthesised.synthesis.angles[0].recommended, true);
  assert.equal(synthesised.log.model, "claude-opus-5-5");
  assert.equal(synthesised.log.cost.totalUsd.toFixed(4), "0.1400"); // 15k in x $4 + 4k out x $20 per M

  // ---- stage 4: email (Sonnet, no tools, 04 + 05)
  const emailFake = fakeStructured([
    JSON.stringify({ subject: "Your 40-site rollout", body: "Hi Jane,\n\nI saw you won the 40-site upgrade.\n\nHow are you connecting them?\n\nCheers,", usedCardIds: ["E1", "E2"] }),
  ]);
  const emailed = await runEmailStage(
    {
      state: followed.state,
      synthesis: synthesised.synthesis as Synthesis,
      angleId: "A1",
      contact: { source: "researched", personId: "P1", name: "TAMPERED NAME", role: "TAMPERED" },
      relationship: { kind: "new", note: "" },
      previousBody: null,
      generation: 1,
    },
    { runStructured: emailFake.runStructured },
  );
  const sys4 = emailFake.calls[0].system.map((b) => b.text).join("\n");
  assert.ok(sys4.includes(rule("04_OUTREACH_RULES.md")));
  assert.ok(sys4.includes(rule("05_OUTREACH_EXAMPLES.md")));
  assert.ok(!sys4.includes("BEGIN 01_RESEARCH_RULES.md"));
  assert.equal(emailFake.calls[0].model, "claude-sonnet-5-5");
  assert.equal(emailed.draft.contact.name, "Jane Roe", "a researched contact's details come from the research, not from the browser");
  assert.ok(emailFake.calls[0].userText.includes("Name: Jane Roe"));
  assert.ok(emailFake.calls[0].userText.includes("E1 | contract_tender"));
  assert.deepEqual(emailed.draft.usedCardIds, ["E1", "E2"]);
  assert.equal(emailed.draft.originalBody, emailed.draft.body);

  // ---- totals
  const all = [...followed.state.stages, synthesised.log, emailed.log];
  const total = all.reduce((n, l) => n + l.cost.totalUsd, 0);
  assert.ok(total > 0.4 && total < 1.0, `total ${total}`);
});

test("an ambiguous company stops the pipeline after discovery", async () => {
  const blocks = [
    ...searchBlocks("s1", "Acme", [searchResult("https://acme1.example/", "Acme 1"), searchResult("https://acme2.example/", "Acme 2")]),
    cited("ENTITY_MATCH: Ambiguous - Acme Pty Ltd (NSW) and Acme Industries (VIC) both match", "https://acme1.example/", "Acme 1", "Acme Pty Ltd"),
    plain("\nENTITY_NAME: Acme"),
  ];
  const r = fakeRetriever(blocks);
  const out = await runResearchStage({ kind: "discover", input: { ...input, companyName: "Acme" } }, { retriever: r.retriever });
  assert.equal(out.next.action, "stop_entity");
});

test("a follow-up with no open lead is refused rather than spending money", async () => {
  const r = fakeRetriever(followupBlocks());
  const empty = { ...(await runResearchStage({ kind: "discover", input }, { retriever: fakeRetriever(discoverBlocks()).retriever })).state, leads: [] } as ResearchState;
  await assert.rejects(runResearchStage({ kind: "followup", state: empty, focus: "leads", leadIds: ["L1"] }, { retriever: r.retriever }), /open lead/);
  assert.equal(r.requests.length, 0);
});

test("the Anthropic type import is only a type", () => {
  const u = usage() as Anthropic.Usage;
  assert.equal(u.output_tokens, 5158);
});
