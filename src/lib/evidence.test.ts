// Regression tests built from the REAL Upper Hunter failures.
//
// Run 1 (dynamic filtering): ONE uncited text block; identification lines unreadable; every card rejected.
// Run 2 (direct mode, $0.56): still ZERO API citations. The raw answer contained
//   "ENTITY_MATCH: Confirmed - Upper Hunter Shire Council is a NSW local government authority based in Scone."
//   but the app said the identification block was missing, because Claude's text blocks around the tool
//   calls ("Now let me read the agenda PDF.") were glued onto the same line as that first answer line.
//   All findings from the official council PDF were then rejected for lack of API citations.
//
// The fix: blocks separated by tool activity are put on separate lines; tags are found even mid-line;
// evidence is graded api_cited > quote_verified > tool_source, where tool_source accepts a URL ONLY if it
// exactly matches a source the web tools returned or fetched (PDFs included).

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEvidenceContext, buildLedger } from "./ledger.ts";
import { normaliseForMatch, parseResearchOutput } from "./parse.ts";
import { buildWebTools } from "./retrieval/anthropicWebTools.ts";
import { runEmailStage } from "./stages/email.ts";
import { runResearchStage } from "./stages/research.ts";
import { runSynthesizeStage } from "./stages/synthesize.ts";
import { serializeStateForModel } from "./state.ts";
import { validateSynthesis } from "./synthesis.ts";
import { cited, fakeRetriever, fetchBlocks, plain, searchBlocks, searchResult, usage, viaCode } from "./testing.ts";
import type { StructuredCall } from "./anthropic.ts";

const AGENDA_URL = "https://www.upperhunter.nsw.gov.au/files/sharedassets/public/v/1/council-meetings/agendas/isc_09122025_agn_at.pdf";
const TEAM_URL = "https://www.upperhunter.nsw.gov.au/council/our-team";
const NEWS_URL = "https://www.upperhunter.nsw.gov.au/news/water-upgrade";
const TEAM_PAGE =
  "Our Team. Jane Roe is the Manager Water and Sewer at Upper Hunter Shire Council. " +
  "She oversees the SCADA and telemetry systems for all water treatment plants and pump stations.";
const QUOTE_OK = "Jane Roe is the Manager Water and Sewer at Upper Hunter Shire Council";

const EXACT_LINE = "ENTITY_MATCH: Confirmed - Upper Hunter Shire Council is a NSW local government authority based in Scone.";

const ANSWER = [
  EXACT_LINE,
  "ENTITY_NAME: Upper Hunter Shire Council",
  "OFFICIAL_WEBSITE: https://www.upperhunter.nsw.gov.au",
  "INDUSTRY: Local government (council)",
  "CLIENT_TYPE: End User - operates its own water and sewer assets",
  "SUMMARY: A NSW council serving Scone and Murrurundi.",
  "RELEVANCE | strong | remote water and sewer sites with a telemetry upgrade under way",
  `CARD | governance_doc | 2025-12 | The water and sewer control and communications upgrade keeps radio as the primary link and adds 4G/5G as a secondary backup. @@ ${AGENDA_URL} @@ radio will remain the primary communications method with 4G/5G as a secondary backup`,
  `CARD | governance_doc | 2025-12 | Schneider manages the radio network and the upgrade is budgeted at about $400,000 over two years. @@ ${AGENDA_URL} @@ approximately $400,000 over two years`,
  `CARD | people_post | unknown | The Manager Water and Sewer oversees SCADA and telemetry. @@ ${TEAM_URL} @@ She oversees the SCADA and telemetry systems for all water treatment plants`,
  `PERSON | Jane Roe | Manager Water and Sewer | Upper Hunter Shire Council | Runs the SCADA systems @@ ${TEAM_URL} @@ ${QUOTE_OK}`,
  `CARD | news | 2026-01 | A made-up claim. @@ https://invented.example/page @@ this page was never returned by any tool at all`,
  "LEAD | high | Who won the SCADA upgrade tender? | Shows the connectivity approach",
].join("\n");

/**
 * The real shape: commentary text blocks between tool calls, tool results consumed by code execution
 * (dynamic filtering), a PDF fetch, and the final answer as the LAST text block with no citations.
 */
function liveShape(answer: string) {
  return [
    { type: "thinking", thinking: "", signature: "x" },
    plain("Let me start by searching for the council's water and sewer plans."),
    { type: "server_tool_use", id: "srvtoolu_code1", name: "code_execution", input: { code: "print(results)" }, caller: { type: "direct" } },
    ...searchBlocks("s1", "Upper Hunter Shire Council SCADA", [searchResult(NEWS_URL, "Water upgrade"), searchResult(TEAM_URL, "Our team")]).map((b) => ({ ...b, caller: viaCode })),
    plain("Now let me read the agenda PDF."),
    ...fetchBlocks("f1", AGENDA_URL, "JVBERi0xLjQ=", { kind: "pdf", caller: viaCode, title: "Agenda" }),
    ...fetchBlocks("f2", TEAM_URL, TEAM_PAGE, { caller: viaCode, title: "Our team" }),
    { type: "code_execution_tool_result", tool_use_id: "srvtoolu_code1", content: { type: "encrypted_code_execution_result", encrypted_stdout: "zzz", stderr: "", return_code: 0, content: [] } },
    plain(answer),
  ];
}

function parse(blocks: unknown[]) {
  const ledger = buildLedger(blocks as never);
  const parsed = parseResearchOutput(ledger.rawAnswerText, ledger.segments, buildEvidenceContext(ledger.sources, ledger.pageTexts));
  return { ledger, parsed };
}

// ---------------------------------------------------------------- 1. entity parsing

test("the EXACT Upper Hunter line is parsed: status separate from the description", () => {
  const { parsed } = parse([plain(EXACT_LINE)]);
  assert.equal(parsed.entity?.match, "Confirmed");
  assert.equal(parsed.entity?.matchNote, "Confirmed - Upper Hunter Shire Council is a NSW local government authority based in Scone.");
});

test("THE LIVE BUG: the line is still read when it is glued onto Claude's earlier commentary", () => {
  const { ledger, parsed } = parse(liveShape(ANSWER));
  // the ledger now keeps writing turns on separate lines
  assert.ok(ledger.rawAnswerText.includes("plans.\nNow let me read the agenda PDF.\nENTITY_MATCH: Confirmed"));
  assert.equal(parsed.entity?.match, "Confirmed");
  assert.equal(parsed.entity?.name, "Upper Hunter Shire Council");
  assert.equal(parsed.entity?.industry, "Local government (council)");
});

test("even with the old glued text, a tag in the middle of a line starts a new line", () => {
  const glued = `Now let me read the agenda PDF.${EXACT_LINE}ENTITY_NAME: Upper Hunter Shire Council`;
  const parsedGlued = parseResearchOutput(glued, []);
  assert.equal(parsedGlued.entity?.match, "Confirmed");
  assert.equal(parsedGlued.entity?.name, "Upper Hunter Shire Council");
});

test("text blocks split only by a citation stay on one line; blocks separated by tool calls do not", () => {
  const { ledger } = parse([
    plain("Part one"),
    plain(" and part two."),
    ...searchBlocks("s1", "q", [searchResult(NEWS_URL, "N")]),
    plain("Next turn."),
  ]);
  assert.equal(ledger.rawAnswerText, "Part one and part two.\nNext turn.");
});

test("offsets stay exact after the line breaks, so API citations still attach to the right line", () => {
  const blocks = [
    ...searchBlocks("s1", "q", [searchResult(NEWS_URL, "N")]),
    plain("Working on it."),
    ...searchBlocks("s2", "q2", [searchResult(TEAM_URL, "T")]),
    cited("CARD | project | 2026-02 | A cited claim.", NEWS_URL, "N", "approved the water upgrade"),
  ];
  const { parsed, ledger } = parse(blocks);
  assert.equal(parsed.cards.length, 1);
  assert.equal(parsed.cards[0].grade, "api_cited");
  assert.deepEqual(parsed.cards[0].evidence, [{ sourceKey: ledger.sources.find((s) => s.url === NEWS_URL)!.key, excerpt: "approved the water upgrade" }]);
});

test("identification lines are read in every common shape", () => {
  const shapes: [string, string][] = [
    ["ENTITY_MATCH: Confirmed - reason", "Confirmed"],
    ["ENTITY_MATCH: Probable - reason", "Probable"],
    ["ENTITY_MATCH: Ambiguous - two councils share this name", "Ambiguous"],
    ["ENTITY_MATCH: Not found - no such company", "Not found"],
    ["ENTITY_MATCH: Confirmed", "Confirmed"],
    ["ENTITY_MATCH | Probable | reason", "Probable"],
    ["| ENTITY_MATCH | Ambiguous | reason |", "Ambiguous"],
    ["**ENTITY_MATCH:** Confirmed", "Confirmed"],
    ["**Entity match:** Probable – reason", "Probable"],
    ["ENTITY MATCH - Not found", "Not found"],
    ["1. `ENTITY_MATCH`: Confirmed", "Confirmed"],
    ["## ENTITY_MATCH: Confirmed", "Confirmed"],
    ["- COMPANY MATCH: Confirmed", "Confirmed"],
  ];
  for (const [line, expected] of shapes) assert.equal(parse([plain(line)]).parsed.entity?.match, expected, `shape: ${line}`);
});

test("the first identification line wins", () => {
  const { parsed } = parse([plain("ENTITY_MATCH: Confirmed - ok\nENTITY_NAME: Real Name\nENTITY_MATCH: Not found\nENTITY_NAME: Other")]);
  assert.equal(parsed.entity?.match, "Confirmed");
  assert.equal(parsed.entity?.name, "Real Name");
});

// ---------------------------------------------------------------- 2. evidence hierarchy

test("A PDF finding with no API citation is now kept as TOOL_SOURCE; an invented URL is still rejected", () => {
  const { parsed, ledger } = parse(liveShape(ANSWER));
  const pdfKey = ledger.sources.find((s) => s.url === AGENDA_URL)!.key;
  const teamKey = ledger.sources.find((s) => s.url === TEAM_URL)!.key;

  const pdfCards = parsed.cards.filter((c) => c.grade === "tool_source");
  assert.equal(pdfCards.length, 2);
  assert.ok(pdfCards.every((c) => c.sourceKeys.length === 1 && c.sourceKeys[0] === pdfKey));
  assert.match(pdfCards[0].claim, /radio as the primary link and adds 4G\/5G/);
  assert.match(pdfCards[1].claim, /Schneider manages the radio network/);

  const verified = parsed.cards.filter((c) => c.grade === "quote_verified");
  assert.equal(verified.length, 1);
  assert.deepEqual(verified[0].sourceKeys, [teamKey]);
  assert.equal(parsed.people[0].grade, "quote_verified");

  assert.equal(parsed.cards.length, 3);
  assert.equal(parsed.rejected.length, 1);
  assert.match(parsed.rejected[0].reason, /named URL was not returned by any search or fetch/);
});

test("source integrity: nothing is accepted unless it is an API citation or a URL the tools really returned", () => {
  const lines = [
    `CARD | news | 2026 | Invented URL. @@ https://invented.example/x @@ some quote that is long enough to check`,
    `CARD | news | 2026 | Look-alike URL on the right site but never returned. @@ https://www.upperhunter.nsw.gov.au/council/secret-page @@ some quote that is long enough`,
    "CARD | news | 2026 | No source given at all.",
    "CARD | news | 2026 | Self-cited marker [S1]. @@ https://invented.example/x @@ nothing real here at all, really nothing",
    `PERSON | John Invented | CEO | Nowhere | made up @@ https://invented.example/team @@ John Invented is the CEO of Nowhere`,
  ].join("\n");
  const { parsed } = parse(liveShape(lines));
  assert.equal(parsed.cards.length, 0);
  assert.equal(parsed.people.length, 0);
  assert.equal(parsed.rejected.length, 5);
});

test("a source that was only a search result (snippet) is accepted as TOOL_SOURCE, not as verified", () => {
  const { parsed } = parse(liveShape(`CARD | project | 2026 | The water upgrade was approved. @@ ${NEWS_URL} @@ approved the water upgrade in full`));
  assert.equal(parsed.cards.length, 1);
  assert.equal(parsed.cards[0].grade, "tool_source");
});

test("a quote that is NOT in a page we can read is flagged, and the card is not graded as verified", () => {
  const { parsed } = parse(liveShape(`CARD | people_post | unknown | Fabricated detail. @@ ${TEAM_URL} @@ Jane Roe also leads the entire regional broadband rollout programme`));
  assert.equal(parsed.cards[0].grade, "tool_source");
  assert.match(parsed.notes.join(" "), /quote was not found/);
});

test("a verbatim quote from a fetched text page is quote_verified, matching despite case, quotes and dashes", () => {
  assert.equal(normaliseForMatch("Jane  Roe’s “team” – SCADA"), "jane roe s team scada");
  const line = `CARD | people_post | unknown | Fuzzy. @@ ${TEAM_URL} @@ "she OVERSEES the SCADA and telemetry  systems for all water treatment plants"`;
  assert.equal(parse(liveShape(line)).parsed.cards[0].grade, "quote_verified");
});

test("an API citation, when present, wins and is graded api_cited", () => {
  const blocks = [
    ...searchBlocks("s1", "q", [searchResult(NEWS_URL, "Water upgrade")]),
    cited(`CARD | project | 2026-02 | Water upgrade approved. @@ ${NEWS_URL} @@ garbage quote`, NEWS_URL, "Water upgrade", "approved the water upgrade"),
  ];
  const { parsed } = parse(blocks);
  assert.equal(parsed.cards[0].grade, "api_cited");
  assert.equal(parsed.cards[0].evidence[0].excerpt, "approved the water upgrade");
});

test("fetched text pages are kept for quote checks; PDFs are not", () => {
  const { ledger } = parse(liveShape("x"));
  assert.equal(ledger.pageTexts[ledger.sources.find((s) => s.url === AGENDA_URL)!.key], undefined);
  assert.equal(ledger.pageTexts[ledger.sources.find((s) => s.url === TEAM_URL)!.key], TEAM_PAGE);
});

// ---------------------------------------------------------------- 3. cheaper web behaviour restored

test("web tools are back to the cheaper dynamic-filtering defaults (no direct calls, no page-size override)", () => {
  const tools = buildWebTools({ budget: { maxSearches: 8, maxFetches: 5 }, searchCountry: "AU" }) as unknown as Record<string, unknown>[];
  for (const t of tools) {
    assert.equal("allowed_callers" in t, false, "the tool version's default (code execution / dynamic filtering) is used");
    assert.equal("max_content_tokens" in t, false);
  }
  assert.equal(tools[0].max_uses, 8);
  assert.equal(tools[1].max_uses, 5);
  assert.deepEqual(tools[1].citations, { enabled: true });
  assert.deepEqual(tools[0].user_location, { type: "approximate", country: "AU" });

  const direct = buildWebTools(
    { budget: { maxSearches: 8, maxFetches: 5 }, searchCountry: "AU" },
    { searchCaller: "direct", fetchCaller: "direct", fetchMaxContentTokens: 30000 },
  ) as unknown as Record<string, unknown>[];
  assert.deepEqual(direct[0].allowed_callers, ["direct"]);
  assert.equal(direct[1].max_content_tokens, 30000);
});

// ---------------------------------------------------------------- 4. grades reach synthesis; the product continues

test("evidence grades are passed to synthesis and the weakest grade is worked out by code", async () => {
  const r = fakeRetriever(liveShape(ANSWER));
  const out = await runResearchStage(
    { kind: "discover", input: { companyName: "Upper Hunter Shire Council", website: "", context: "", topic: "" } },
    { retriever: r.retriever },
  );
  const text = serializeStateForModel(out.state, { includeSources: true });
  assert.match(text, /E1 \| governance_doc \| 2025-12 \| The water and sewer control and communications upgrade.*\| tool_source/);
  assert.match(text, /\| quote_verified/);
  assert.match(text, /P1 \| Jane Roe .*\| quote_verified/);

  const v = validateSynthesis(
    {
      relevance: "strong", summary: "s", noMeaningfulAngleNote: "", gaps: [], people: [],
      triggers: [
        { id: "T1", rank: "primary", kind: "sales_trigger", priority: "high", title: "t", recency: "6_to_12_months", scale: "", fact: "f", factCardIds: ["E1", "E3"], inference: "i", possibleOpportunity: "o", whyNow: "w" },
        { id: "T2", rank: "secondary", kind: "conversation_hook", priority: "low", title: "t2", recency: "unknown", scale: "", fact: "f", factCardIds: ["E3"], inference: "i", possibleOpportunity: "o", whyNow: "w" },
      ],
      angles: [
        { id: "A1", title: "a", strength: "strong", triggerIds: ["T1"], cardIds: ["E1", "E3"], conversationQuestion: "q?", whyItWorks: "w", recommended: true },
        { id: "A2", title: "General introduction - no specific trigger found", strength: "general_introduction", triggerIds: [], cardIds: [], conversationQuestion: "q?", whyItWorks: "w", recommended: false },
      ],
    },
    out.state,
  );
  assert.equal(v.synthesis.triggers[0].evidenceGrade, "tool_source"); // E1 tool_source, E3 quote_verified -> weakest
  assert.equal(v.synthesis.triggers[1].evidenceGrade, "quote_verified");
  assert.equal(v.synthesis.angles[0].evidenceGrade, "tool_source");
  assert.equal(v.synthesis.angles[1].evidenceGrade, null);
});

test("THE WHOLE PRODUCT on the real Upper Hunter shape: discover -> follow-up -> synthesis -> angle -> contact -> email", async () => {
  // ---- Discover: nothing is rejected for lack of API citations, the entity is read, the pipeline does NOT stop
  const d = fakeRetriever(liveShape(ANSWER));
  const discovered = await runResearchStage(
    { kind: "discover", input: { companyName: "Upper Hunter Shire Council", website: "", context: "", topic: "" } },
    { retriever: d.retriever },
  );
  assert.equal(discovered.state.entity?.match, "Confirmed");
  assert.equal(discovered.state.cards.length, 3);
  assert.equal(discovered.state.people.length, 1);
  assert.equal(discovered.next.action, "followup", "the open high-priority lead justifies one follow-up round");
  const warnings = discovered.log.warnings.join("\n");
  assert.match(warnings, /no citations/);
  assert.match(warnings, /Evidence accepted: 0 API-cited, 2 quote-verified, 2 tool-source/);
  assert.match(warnings, /Rejected a line/); // the invented URL
  assert.ok(discovered.log.answerPreview.includes("ENTITY_MATCH: Confirmed"));

  // ---- Follow-up
  const followBlocks = [
    ...searchBlocks("s2", "tender", [searchResult("https://tenders.example/scada", "Tender")]),
    plain("LEAD_RESULT | L1 | resolved | tender awarded"),
    plain(`\nCARD | contract_tender | 2026-02 | The SCADA upgrade tender was awarded. @@ https://tenders.example/scada @@ awarded the SCADA upgrade contract`),
  ];
  const f = fakeRetriever(followBlocks);
  const followed = await runResearchStage({ kind: "followup", state: discovered.state, focus: "leads", leadIds: ["L1"] }, { retriever: f.retriever });
  assert.equal(followed.state.cards.length, 4);
  assert.equal(followed.next.action, "synthesize");

  // ---- Synthesis (Opus): sees the grades
  const synthJson = JSON.stringify({
    relevance: "strong",
    summary: "Water and sewer SCADA upgrade: radio stays primary with 4G/5G backup.",
    noMeaningfulAngleNote: "",
    triggers: [{ id: "T1", rank: "primary", kind: "sales_trigger", priority: "high", title: "Control and comms upgrade with 4G/5G backup", recency: "6_to_12_months", scale: "~$400,000 over two years", fact: "The agenda keeps radio as primary and adds 4G/5G as a secondary backup.", factCardIds: ["E1", "E2"], inference: "Remote sites will need cellular failover.", possibleOpportunity: "Ask how the cellular side will be handled.", whyNow: "Upgrade under way; rests on an official PDF (tool_source)." }],
    people: [{ personId: "P1", rank: 1, whyRelevant: "Runs SCADA" }],
    angles: [{ id: "A1", title: "Cellular backup design", strength: "strong", triggerIds: ["T1"], cardIds: ["E1", "E2"], conversationQuestion: "How are you planning failover and remote access on the cellular side?", whyItWorks: "Specific and answerable.", recommended: true }],
    gaps: [],
  });
  const calls: StructuredCall[] = [];
  const texts = [synthJson, JSON.stringify({ subject: "Water and sewer comms upgrade", body: "Hi Jane,\n\nI read the water and sewer update about the control and comms upgrade.\n\nHow are you planning the cellular side?\n\nCheers,", usedCardIds: ["E1", "E2"] })];
  const fake = async (call: StructuredCall) => {
    calls.push(call);
    return { text: texts.shift()!, usage: usage({ server_tool_use: null, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }), stopReason: "end_turn", durationMs: 10 };
  };
  const synthesised = await runSynthesizeStage(followed.state, { runStructured: fake as never });
  assert.match(calls[0].userText, /E1 \| governance_doc.*\| tool_source/);
  assert.match(calls[0].system.map((b) => b.text).join("\n"), /api_cited.*quote_verified.*tool_source/s);
  assert.equal(synthesised.synthesis.triggers[0].evidenceGrade, "tool_source");
  assert.equal(synthesised.synthesis.angles[0].recommended, true);

  // ---- Email: researched contact, the angle's evidence incl. grades
  const emailed = await runEmailStage(
    { state: followed.state, synthesis: synthesised.synthesis, angleId: "A1", contact: { source: "researched", personId: "P1", name: "", role: "" }, relationship: { kind: "new", note: "" }, previousBody: null, generation: 1 },
    { runStructured: fake as never },
  );
  assert.match(calls[1].userText, /E1 \| governance_doc.*\| tool_source/);
  assert.match(calls[1].userText, /Name: Jane Roe/);
  assert.equal(emailed.draft.contact.name, "Jane Roe");
  assert.deepEqual(emailed.draft.usedCardIds, ["E1", "E2"]);
  assert.match(emailed.draft.body, /^Hi Jane,/);
});
