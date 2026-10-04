// Helpers for tests only: fake API blocks shaped like the ones Anthropic returns.
// No network, no API key. Not imported by the app.

import type Anthropic from "@anthropic-ai/sdk";
import { buildLedger } from "./ledger";
import type { EvidenceRetriever, RetrievalRequest, RetrievalResult } from "./retrieval/types";

export const searchResult = (url: string, title: string, pageAge: string | null = null) => ({
  type: "web_search_result",
  url,
  title,
  page_age: pageAge,
  encrypted_content: "x",
});

export const searchBlocks = (id: string, query: string, results: ReturnType<typeof searchResult>[]) => [
  { type: "server_tool_use", id, name: "web_search", input: { query }, caller: { type: "direct" } },
  { type: "web_search_tool_result", tool_use_id: id, caller: { type: "direct" }, content: results },
];

export const cited = (text: string, url: string, title: string, citedText: string) => ({
  type: "text",
  text,
  citations: [{ type: "web_search_result_location", url, title, cited_text: citedText, encrypted_index: "i" }],
});

export const plain = (text: string) => ({ type: "text", text, citations: null });

export const usage = (over: Partial<Anthropic.Usage> = {}) =>
  ({
    input_tokens: 183,
    output_tokens: 5158,
    cache_creation_input_tokens: 38012,
    cache_read_input_tokens: 352049,
    server_tool_use: { web_search_requests: 5, web_fetch_requests: 4 },
    ...over,
  }) as unknown as Anthropic.Usage;

/** A retriever that returns canned blocks (run through the REAL ledger) and records what it was asked. */
export function fakeRetriever(blocks: unknown[], usages: Anthropic.Usage[] = [usage()]) {
  const requests: RetrievalRequest[] = [];
  const retriever: EvidenceRetriever = {
    id: "fake-retriever",
    async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
      requests.push(request);
      const ledger = buildLedger(blocks as Anthropic.ContentBlock[], request.existingSources);
      return {
        retrieverId: "fake-retriever",
        rawAnswerText: ledger.rawAnswerText,
        segments: ledger.segments,
        sources: ledger.sources,
        stats: ledger.stats,
        usages,
        stopReasons: ["end_turn"],
        continuations: 0,
        durationMs: 1234,
        rawForDebug: blocks,
      };
    },
  };
  return { retriever, requests };
}
