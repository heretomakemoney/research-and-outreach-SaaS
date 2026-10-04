// Tests for reading the tagged research answer. Fake blocks run through the REAL ledger.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLedger } from "./ledger.ts";
import { approxDateToMs, parseResearchOutput } from "./parse.ts";
import { cited, plain, searchBlocks, searchResult } from "./testing.ts";

const URL_A = "https://indratel.com.au/projects";
const URL_B = "https://news.example/indratel-contract";

function parseBlocks(blocks: unknown[]) {
  const ledger = buildLedger(blocks as never);
  return { ledger, parsed: parseResearchOutput(ledger.rawAnswerText, ledger.segments) };
}

const baseBlocks = () => [
  ...searchBlocks("s1", "indratel projects", [searchResult(URL_A, "Projects"), searchResult(URL_B, "News")]),
  cited("ENTITY_MATCH: Confirmed - the website and ABN agree\nENTITY_NAME: Indratel Pty Ltd", URL_A, "Projects", "Indratel Pty Ltd, ABN 12 345"),
  plain("\nOFFICIAL_WEBSITE: https://indratel.com.au"),
  plain("\nINDUSTRY: Utilities - telemetry integrator"),
  plain("\nCLIENT_TYPE: Integrator / System Integrator - delivers SCADA"),
  plain("\nSUMMARY: Indratel integrates telemetry for water utilities."),
  plain("\nRELEVANCE | strong | many remote telemetry sites"),
  cited("\nCARD | project | 2026-03 | Indratel won a telemetry upgrade covering 40 sites.", URL_B, "News", "won the telemetry upgrade for 40 sites"),
  plain("\nCARD | news | unknown | An unsupported claim with no citation."),
  cited("\nPERSON | Jane Roe | Operations Manager | Indratel | Runs field operations", URL_A, "Projects", "Jane Roe, Operations Manager"),
  plain("\nLEAD | high | Which carrier is used on the 40 sites? | Shows how connectivity is handled"),
  plain("\nCOVERAGE | projects_and_contracts | found | contract found"),
  plain("\nCOVERAGE | government_and_governance_documents | not_applicable | not a council"),
  plain("\nSome stray commentary the model should not have written."),
];

test("tagged lines become entity, cards, people, leads and coverage", () => {
  const { parsed } = parseBlocks(baseBlocks());
  assert.equal(parsed.entity?.match, "Confirmed");
  assert.equal(parsed.entity?.name, "Indratel Pty Ltd");
  assert.equal(parsed.entity?.industry, "Utilities - telemetry integrator");
  assert.equal(parsed.cards.length, 1);
  assert.equal(parsed.cards[0].kind, "project");
  assert.equal(parsed.cards[0].date, "2026-03");
  assert.equal(parsed.cards[0].claim, "Indratel won a telemetry upgrade covering 40 sites.");
  assert.equal(parsed.people.length, 1);
  assert.equal(parsed.people[0].name, "Jane Roe");
  assert.equal(parsed.leads[0].priority, "high");
  assert.equal(parsed.coverage.length, 2);
  assert.deepEqual(parsed.relevance, { level: "strong", note: "many remote telemetry sites" });
  assert.equal(parsed.ignoredLines, 1);
});

test("a card's sources and excerpts come from the API citations, not from Claude", () => {
  const { parsed, ledger } = parseBlocks(baseBlocks());
  const card = parsed.cards[0];
  const keyForB = ledger.sources.find((s) => s.url === URL_B)!.key;
  assert.deepEqual(card.sourceKeys, [keyForB]);
  assert.deepEqual(card.evidence, [{ sourceKey: keyForB, excerpt: "won the telemetry upgrade for 40 sites" }]);
});

test("a card with no supporting citation is rejected, not kept", () => {
  const { parsed } = parseBlocks(baseBlocks());
  assert.ok(!parsed.cards.some((c) => c.claim.includes("unsupported")));
  assert.equal(parsed.rejected.length, 1);
  assert.match(parsed.rejected[0].reason, /no source/);
});

test("a person with no supporting citation is rejected", () => {
  const { parsed } = parseBlocks([
    ...searchBlocks("s1", "q", [searchResult(URL_A, "A")]),
    plain("ENTITY_MATCH: Probable - ok"),
    plain("\nPERSON | John Invented | CEO | Nowhere | made up"),
  ]);
  assert.equal(parsed.people.length, 0);
  assert.equal(parsed.rejected.length, 1);
});

test("markers typed by Claude cannot create a source", () => {
  const { parsed } = parseBlocks([
    plain("ENTITY_MATCH: Probable - ok"),
    plain("\nCARD | project | 2026 | A claim that tries to cite itself [S1]."),
  ]);
  assert.equal(parsed.cards.length, 0);
  assert.equal(parsed.rejected.length, 1);
});

test("bullets, bold and a pipe inside the claim are handled", () => {
  const { parsed } = parseBlocks([
    ...searchBlocks("s1", "q", [searchResult(URL_A, "A")]),
    cited("- **CARD | technology | 2025-11 | Uses cellular | radio hybrid telemetry.**", URL_A, "A", "cellular and radio"),
  ]);
  assert.equal(parsed.cards.length, 1);
  assert.equal(parsed.cards[0].claim, "Uses cellular | radio hybrid telemetry.");
  assert.equal(parsed.cards[0].kind, "technology");
});

test("lead results, unknown kinds and bad dates are normalised", () => {
  const { parsed } = parseBlocks([
    ...searchBlocks("s1", "q", [searchResult(URL_A, "A")]),
    plain("LEAD_RESULT | l2 | Resolved | found the carrier"),
    plain("\nLEAD_RESULT | L3 | whatever | nothing"),
    cited("\nCARD | spaceship | next tuesday | Odd kind and date.", URL_A, "A", "odd"),
  ]);
  assert.deepEqual(parsed.leadResults.map((r) => [r.leadId, r.status]), [["L2", "resolved"], ["L3", "unresolved"]]);
  assert.equal(parsed.cards[0].kind, "other");
  assert.equal(parsed.cards[0].date, null);
});

test("approximate dates", () => {
  assert.equal(approxDateToMs("2026-03"), Date.UTC(2026, 2, 1));
  assert.equal(approxDateToMs("March 2026"), Date.UTC(2026, 2, 1));
  assert.equal(approxDateToMs("14 Mar 2026"), Date.UTC(2026, 2, 14));
  assert.equal(approxDateToMs("2025"), Date.UTC(2025, 6, 1));
  assert.equal(approxDateToMs("sometime"), null);
  assert.equal(approxDateToMs(null), null);
});

test("no ENTITY_MATCH line means no entity", () => {
  const { parsed } = parseBlocks([plain("CARD | news | 2026 | x")]);
  assert.equal(parsed.entity, null);
});
