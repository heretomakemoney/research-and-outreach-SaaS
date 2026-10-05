// Regression tests for the first live failure (Upper Hunter Shire Council):
//   - Claude's web tools ran with dynamic filtering (results read through code execution),
//     so the answer was ONE text block with NO citations;
//   - the identification lines were not in the exact "KEY: value" shape;
//   - result: ENTITY_MATCH unreadable, every card and person rejected, gate = stop_entity.
// These tests rebuild that response shape and check the fix, and that source integrity is NOT weakened.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEvidenceContext, buildLedger } from "./ledger.ts";
import { normaliseForMatch, parseResearchOutput } from "./parse.ts";
import { buildWebTools } from "./retrieval/anthropicWebTools.ts";
import { runResearchStage } from "./stages/research.ts";
import { cited, fakeRetriever, fetchBlocks, plain, searchBlocks, searchResult, usage, viaCode } from "./testing.ts";

const AGENDA_URL = "https://www.upperhunter.nsw.gov.au/files/sharedassets/public/v/1/council-meetings/agendas/isc_09122025_agn_at.pdf";
const TEAM_URL = "https://www.upperhunter.nsw.gov.au/council/our-team";
const NEWS_URL = "https://www.upperhunter.nsw.gov.au/news/water-upgrade";
const TEAM_PAGE =
  "Our Team. Jane Roe is the Manager Water and Sewer at Upper Hunter Shire Council. " +
  "She oversees the SCADA and telemetry systems for all water treatment plants and pump stations.";

const QUOTE_OK = "Jane Roe is the Manager Water and Sewer at Upper Hunter Shire Council";

/** What the live response looked like: tool results consumed by code execution, ONE uncited text block. */
function dynamicFilteringBlocks(answer: string) {
  return [
    { type: "thinking", thinking: "", signature: "x" },
    { type: "server_tool_use", id: "srvtoolu_code1", name: "code_execution", input: { code: "print(results)" }, caller: { type: "direct" } },
    ...searchBlocks("s1", "Upper Hunter Shire Council SCADA", [searchResult(NEWS_URL, "Water upgrade"), searchResult(TEAM_URL, "Our team")]).map((b) => ({ ...b, caller: viaCode })),
    ...fetchBlocks("f1", AGENDA_URL, "JVBERi0xLjQ=", { kind: "pdf", caller: viaCode, title: "Agenda" }),
    ...fetchBlocks("f2", TEAM_URL, TEAM_PAGE, { caller: viaCode, title: "Our team" }),
    { type: "code_execution_tool_result", tool_use_id: "srvtoolu_code1", content: { type: "encrypted_code_execution_result", encrypted_stdout: "zzz", stderr: "", return_code: 0, content: [] } },
    plain(answer),
  ];
}

const ANSWER_PIPE_STYLE = [
  "ENTITY_MATCH | Confirmed | the council website and ABN agree",
  "ENTITY_NAME | Upper Hunter Shire Council",
  "OFFICIAL_WEBSITE | https://www.upperhunter.nsw.gov.au",
  "INDUSTRY | Local government (council)",
  "CLIENT_TYPE | End User | operates its own water and sewer assets",
  "SUMMARY | A NSW council serving Scone and Murrurundi.",
  `CARD | people_post | unknown | The Manager Water and Sewer oversees SCADA and telemetry. @@ ${TEAM_URL} @@ She oversees the SCADA and telemetry systems for all water treatment plants`,
  `PERSON | Jane Roe | Manager Water and Sewer | Upper Hunter Shire Council | Runs the SCADA systems @@ ${TEAM_URL} @@ ${QUOTE_OK}`,
  `CARD | governance_doc | 2025-12 | The December agenda lists a SCADA upgrade item. @@ ${AGENDA_URL} @@ item 9.3 SCADA upgrade for the water treatment plants is recommended for approval`,
  `CARD | news | 2026-01 | A made-up claim. @@ https://invented.example/page @@ this page was never returned by any tool at all`,
  "LEAD | high | Who won the SCADA upgrade tender? | Shows the connectivity approach",
].join("\n");

function parse(answer: string) {
  const ledger = buildLedger(dynamicFilteringBlocks(answer) as never);
  const parsed = parseResearchOutput(ledger.rawAnswerText, ledger.segments, buildEvidenceContext(ledger.sources, ledger.pageTexts));
  return { ledger, parsed };
}

test("the live response shape is recognised: results read via code execution, no citations at all", () => {
  const { ledger } = parse(ANSWER_PIPE_STYLE);
  assert.equal(ledger.stats.citationsTotal, 0);
  assert.equal(ledger.stats.textBlocks, 1);
  assert.equal(ledger.stats.resultsViaCodeExecution, 3); // 1 search result block + 2 fetch result blocks
  assert.ok(ledger.stats.resultsViaCodeExecution > 0);
});

test("ENTITY_MATCH is read when written with pipes instead of colons (the likely cause of 'missing or unreadable')", () => {
  const { parsed } = parse(ANSWER_PIPE_STYLE);
  assert.equal(parsed.entity?.match, "Confirmed");
  assert.equal(parsed.entity?.name, "Upper Hunter Shire Council");
  assert.equal(parsed.entity?.industry, "Local government (council)");
  assert.equal(parsed.entity?.clientType, "End User | operates its own water and sewer assets");
});

test("identification lines are read in every common shape", () => {
  const shapes: [string, string][] = [
    ["ENTITY_MATCH: Confirmed - reason", "Confirmed"],
    ["ENTITY_MATCH | Probable | reason", "Probable"],
    ["| ENTITY_MATCH | Ambiguous | reason |", "Ambiguous"],
    ["**ENTITY_MATCH:** Confirmed", "Confirmed"],
    ["**Entity match:** Probable – reason", "Probable"],
    ["ENTITY MATCH - Not found", "Not found"],
    ["1. `ENTITY_MATCH`: Confirmed", "Confirmed"],
    ["## ENTITY_MATCH: Confirmed", "Confirmed"],
    ["- COMPANY MATCH: Confirmed", "Confirmed"],
    ["entity_match = Probable", "Probable"],
  ];
  for (const [line, expected] of shapes) {
    const { parsed } = parse(line);
    assert.equal(parsed.entity?.match, expected, `shape: ${line}`);
  }
});

test("the first identification line wins; a later stray line cannot overwrite it", () => {
  const { parsed } = parse("ENTITY_MATCH: Confirmed - ok\nENTITY_NAME: Real Name\nENTITY_MATCH: Not found\nENTITY_NAME: Other");
  assert.equal(parsed.entity?.match, "Confirmed");
  assert.equal(parsed.entity?.name, "Real Name");
});

test("with no API citations, a card is accepted ONLY if its URL was returned by the tools AND its quote is in the returned page text", () => {
  const { parsed, ledger } = parse(ANSWER_PIPE_STYLE);
  const teamKey = ledger.sources.find((s) => s.url === TEAM_URL)!.key;

  // accepted: real fetched text page + verbatim quote
  const accepted = parsed.cards.filter((c) => c.grade === "quote_verified");
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].claim, "The Manager Water and Sewer oversees SCADA and telemetry.");
  assert.deepEqual(accepted[0].sourceKeys, [teamKey]);
  assert.match(accepted[0].evidence[0].excerpt, /SCADA and telemetry systems/);
  assert.equal(parsed.people.length, 1);
  assert.equal(parsed.people[0].grade, "quote_verified");

  // rejected: the PDF (cannot check the quote) and the invented URL
  assert.equal(parsed.cards.length, 1);
  const reasons = parsed.rejected.map((r) => r.reason).join(" | ");
  assert.match(reasons, /was not read as page text \(search snippet or PDF\)/);
  assert.match(reasons, /named URL was not returned by any search or fetch/);
});

test("a quote that is not in the page, a too-short quote, or a search-snippet-only source are all rejected", () => {
  const lines = [
    `CARD | news | 2026 | Fabricated detail. @@ ${TEAM_URL} @@ Jane Roe also leads the entire regional broadband rollout programme`,
    `CARD | news | 2026 | Too short. @@ ${TEAM_URL} @@ Jane Roe`,
    `CARD | news | 2026 | Search snippet only. @@ ${NEWS_URL} @@ the council approved the water upgrade in full yesterday`,
    "CARD | news | 2026 | No source given at all.",
  ].join("\n");
  const { parsed } = parse(lines);
  assert.equal(parsed.cards.length, 0);
  assert.equal(parsed.rejected.length, 4);
  assert.match(parsed.rejected[0].reason, /quote was not found in the text/);
  assert.match(parsed.rejected[1].reason, /too short/);
  assert.match(parsed.rejected[2].reason, /search snippet or PDF/);
  assert.match(parsed.rejected[3].reason, /no source/);
});

test("quote matching ignores case, quotes, dashes and spacing but nothing else", () => {
  assert.equal(normaliseForMatch("Jane  Roe’s “team” – SCADA"), "jane roe s team scada");
  const fuzzy = `CARD | people_post | unknown | Fuzzy quote. @@ ${TEAM_URL} @@ "she OVERSEES the SCADA and telemetry  systems for all water treatment plants"`;
  assert.equal(parse(fuzzy).parsed.cards.length, 1);
});

test("a source marker typed by Claude still cannot create a source", () => {
  const { parsed } = parse("CARD | news | 2026 | Self-cited claim [S1]. @@ https://invented.example/x @@ nothing real here at all, really nothing");
  assert.equal(parsed.cards.length, 0);
});

test("when the API DID attach a citation, that takes precedence and is graded api_cited", () => {
  const blocks = [
    ...searchBlocks("s1", "q", [searchResult(NEWS_URL, "Water upgrade")]),
    cited(`CARD | project | 2026-02 | Water upgrade approved. @@ ${NEWS_URL} @@ garbage quote that would never verify`, NEWS_URL, "Water upgrade", "approved the water upgrade"),
  ];
  const ledger = buildLedger(blocks as never);
  const parsed = parseResearchOutput(ledger.rawAnswerText, ledger.segments, buildEvidenceContext(ledger.sources, ledger.pageTexts));
  assert.equal(parsed.cards.length, 1);
  assert.equal(parsed.cards[0].grade, "api_cited");
  assert.equal(parsed.cards[0].evidence[0].excerpt, "approved the water upgrade");
});

test("fetched page text is kept for quote checks only for text pages, never PDFs", () => {
  const { ledger } = parse("x");
  const pdfKey = ledger.sources.find((s) => s.url === AGENDA_URL)!.key;
  const teamKey = ledger.sources.find((s) => s.url === TEAM_URL)!.key;
  assert.equal(ledger.pageTexts[pdfKey], undefined);
  assert.equal(ledger.pageTexts[teamKey], TEAM_PAGE);
});

test("web tools are configured so the API can cite: direct calls, page-size limit", () => {
  const tools = buildWebTools({ budget: { maxSearches: 8, maxFetches: 5 }, searchCountry: "AU" }) as unknown as Record<string, unknown>[];
  assert.deepEqual(tools[0].allowed_callers, ["direct"]);
  assert.deepEqual(tools[1].allowed_callers, ["direct"]);
  assert.deepEqual(tools[1].citations, { enabled: true });
  assert.equal(tools[1].max_content_tokens, 30000);
  assert.equal(tools[0].max_uses, 8);
  assert.equal(tools[1].max_uses, 5);

  const dynamic = buildWebTools(
    { budget: { maxSearches: 8, maxFetches: 5 }, searchCountry: "AU" },
    { searchCaller: "dynamic", fetchCaller: "dynamic", fetchMaxContentTokens: 1000 },
  ) as unknown as Record<string, unknown>[];
  assert.equal("allowed_callers" in dynamic[0], false, "dynamic = leave the tool version's default (code execution)");
  assert.equal("allowed_callers" in dynamic[1], false);
});

test("whole stage, live failure shape: entity is read, quotes verify, nothing is invented, and the cause is named in a warning", async () => {
  const r = fakeRetriever(dynamicFilteringBlocks(ANSWER_PIPE_STYLE));
  const out = await runResearchStage(
    { kind: "discover", input: { companyName: "Upper Hunter Shire Council", website: "", context: "", topic: "" } },
    { retriever: r.retriever },
  );
  assert.equal(out.state.entity?.match, "Confirmed");
  assert.equal(out.state.cards.length, 1);
  assert.equal(out.state.cards[0].grade, "quote_verified");
  assert.equal(out.state.people.length, 1);
  assert.notEqual(out.next.action, "stop_entity", "a confirmed company with evidence must not stop the pipeline");
  assert.ok(out.log.answerPreview.startsWith("ENTITY_MATCH | Confirmed"));
  const warnings = out.log.warnings.join("\n");
  assert.match(warnings, /dynamic filtering/);
  assert.match(warnings, /accepted through a verified quote/);
  assert.match(warnings, /Rejected a line/);
});

test("whole stage, strict case: no citations and no verifiable quotes means zero cards (integrity is not weakened)", async () => {
  const answer = ["ENTITY_MATCH: Confirmed - ok", "CARD | project | 2026 | Looks plausible but unsupported.", "LEAD | high | Anything? | why"].join("\n");
  const r = fakeRetriever(dynamicFilteringBlocks(answer));
  const out = await runResearchStage(
    { kind: "discover", input: { companyName: "Upper Hunter Shire Council", website: "", context: "", topic: "" } },
    { retriever: r.retriever },
  );
  assert.equal(out.state.cards.length, 0);
  assert.equal(out.state.entity?.match, "Confirmed");
  assert.ok(out.log.warnings.some((w) => /no usable evidence/.test(w)));
});

test("the usage object from the live-style response still prices correctly", () => {
  assert.equal(usage().output_tokens, 5158);
});
