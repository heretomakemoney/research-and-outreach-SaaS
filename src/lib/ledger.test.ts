// Tests for the source ledger, using FAKE blocks shaped like the ones the
// Anthropic API returns. They cost nothing and need no API key.
// Run with: npm test

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLedger, canonicalUrl } from "./ledger.ts";

// A fake API response. `as never` because we only fill in the fields we use.
const blocks = [
  { type: "thinking", thinking: "", signature: "x" },
  { type: "text", text: "I'll search for the company.", citations: null },
  { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "Indratel Australia" }, caller: { type: "direct" } },
  {
    type: "web_search_tool_result",
    tool_use_id: "srv_1",
    caller: { type: "direct" },
    content: [
      { type: "web_search_result", url: "https://indratel.com.au/", title: "Indratel", page_age: "May 2026", encrypted_content: "e1" },
      { type: "web_search_result", url: "https://example.org/news?utm_source=x#top", title: "News item", page_age: null, encrypted_content: "e2" },
    ],
  },
  { type: "server_tool_use", id: "srv_2", name: "web_fetch", input: { url: "https://indratel.com.au/about" }, caller: { type: "direct" } },
  {
    type: "web_fetch_tool_result",
    tool_use_id: "srv_2",
    caller: { type: "direct" },
    content: {
      type: "web_fetch_result",
      url: "https://indratel.com.au/about",
      retrieved_at: "2026-10-04T01:00:00Z",
      content: { type: "document", title: "About Indratel", citations: { enabled: true }, source: { type: "text", media_type: "text/plain", data: "..." } },
    },
  },
  { type: "server_tool_use", id: "srv_3", name: "web_fetch", input: { url: "https://indratel.com.au/blocked" }, caller: { type: "direct" } },
  { type: "web_fetch_tool_result", tool_use_id: "srv_3", caller: { type: "direct" }, content: { type: "web_fetch_tool_result_error", error_code: "url_not_accessible" } },
  { type: "server_tool_use", id: "srv_4", name: "web_fetch", input: { url: "https://council.example.gov.au/agenda.pdf" }, caller: { type: "direct" } },
  {
    type: "web_fetch_tool_result",
    tool_use_id: "srv_4",
    caller: { type: "direct" },
    content: {
      type: "web_fetch_result",
      url: "https://council.example.gov.au/agenda.pdf",
      retrieved_at: null,
      content: { type: "document", title: "Agenda", citations: null, source: { type: "base64", media_type: "application/pdf", data: "AAAA" } },
    },
  },
  {
    type: "text",
    text: "Indratel is an integrator.",
    citations: [
      { type: "web_search_result_location", url: "https://indratel.com.au/", title: "Indratel", cited_text: "Indratel is a system integrator", encrypted_index: "i" },
    ],
  },
  {
    type: "text",
    text: " It was founded in 2001.",
    citations: [
      // refers to the FIRST fetched document (index 0) = the About page
      { type: "char_location", document_index: 0, document_title: "About Indratel", cited_text: "founded in 2001", start_char_index: 0, end_char_index: 5, file_id: null },
      // refers to the SECOND fetched document (index 1) = the PDF
      { type: "page_location", document_index: 1, document_title: "Agenda", cited_text: "telemetry upgrade", start_page_number: 3, end_page_number: 3, file_id: null },
    ],
  },
  {
    type: "text",
    text: " Invented claim.",
    citations: [
      // a URL that no tool returned
      { type: "web_search_result_location", url: "https://made-up.example/page", title: "Made up", cited_text: "nope", encrypted_index: "z" },
      // a fetched-document index that does not exist
      { type: "char_location", document_index: 7, document_title: null, cited_text: "x", start_char_index: 0, end_char_index: 1, file_id: null },
    ],
  },
] as never[];

test("canonicalUrl ignores fragments, utm tracking and trailing slashes", () => {
  assert.equal(canonicalUrl("https://a.com/x/?utm_source=y#z"), "https://a.com/x");
  assert.equal(canonicalUrl("https://a.com/"), "https://a.com/");
});

test("sources are numbered in order of first appearance", () => {
  const { sources } = buildLedger(blocks);
  assert.deepEqual(
    sources.map((s) => s.key),
    ["S1", "S2", "S3", "S4", "S5", "S6"],
  );
  assert.equal(sources[0].url, "https://indratel.com.au/");
});

test("search results and fetched pages are told apart", () => {
  const { sources } = buildLedger(blocks);
  const home = sources.find((s) => s.url === "https://indratel.com.au/")!;
  assert.equal(home.seenInSearch, true);
  assert.equal(home.fetched, false);
  assert.equal(home.pageAge, "May 2026");

  const about = sources.find((s) => s.url === "https://indratel.com.au/about")!;
  assert.equal(about.fetched, true);
  assert.equal(about.fetchKind, "text");

  const pdf = sources.find((s) => s.url.endsWith("agenda.pdf"))!;
  assert.equal(pdf.fetched, true);
  assert.equal(pdf.fetchKind, "pdf");
});

test("a failed fetch is attributed to the page that was requested", () => {
  const { sources, stats } = buildLedger(blocks);
  const blocked = sources.find((s) => s.url === "https://indratel.com.au/blocked")!;
  assert.equal(blocked.fetched, false);
  assert.equal(blocked.fetchError, "url_not_accessible");
  assert.deepEqual(stats.fetchErrors, [{ url: "https://indratel.com.au/blocked", code: "url_not_accessible" }]);
});

test("citations to fetched pages are matched by document position", () => {
  const { sources } = buildLedger(blocks);
  const about = sources.find((s) => s.url === "https://indratel.com.au/about")!;
  const pdf = sources.find((s) => s.url.endsWith("agenda.pdf"))!;
  assert.deepEqual(about.citedExcerpts, ["founded in 2001"]);
  assert.deepEqual(pdf.citedExcerpts, ["telemetry upgrade"]);
});

test("answer text gets [S#] markers after cited passages", () => {
  const { answerText } = buildLedger(blocks);
  assert.match(answerText, /Indratel is an integrator\. \[S1\]/);
  assert.match(answerText, /founded in 2001\./);
  assert.match(answerText, /\[S3\] \[S5\]/);
});

test("invented or unmappable citations are counted, not trusted", () => {
  const { stats } = buildLedger(blocks);
  assert.equal(stats.citationsTotal, 5);
  assert.equal(stats.citedUrlNotInResults, 1); // made-up.example
  assert.equal(stats.citationsUnmapped, 1); // document_index 7
  assert.equal(stats.citationsMapped, 4);
});

test("tool activity is recorded", () => {
  const { stats } = buildLedger(blocks);
  assert.deepEqual(stats.searchQueries, ["Indratel Australia"]);
  assert.equal(stats.searchResultsReturned, 2);
  assert.equal(stats.fetchedOk, 2);
  assert.equal(stats.thinkingBlocks, 1);
});
