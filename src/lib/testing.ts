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
        pageTexts: ledger.pageTexts,
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

/** A web_fetch call + result. `kind: "pdf"` returns base64 data (we cannot read its text). */
export const fetchBlocks = (
  id: string,
  url: string,
  data: string,
  opts: { kind?: "text" | "pdf"; caller?: unknown; title?: string } = {},
) => [
  { type: "server_tool_use", id, name: "web_fetch", input: { url }, caller: opts.caller ?? { type: "direct" } },
  {
    type: "web_fetch_tool_result",
    tool_use_id: id,
    caller: opts.caller ?? { type: "direct" },
    content: {
      type: "web_fetch_result",
      url,
      retrieved_at: "2026-10-05T00:00:00Z",
      content: {
        type: "document",
        title: opts.title ?? "Fetched page",
        citations: { enabled: true },
        source:
          opts.kind === "pdf"
            ? { type: "base64", media_type: "application/pdf", data }
            : { type: "text", media_type: "text/plain", data },
      },
    },
  },
];

export const viaCode = { type: "code_execution_20260120", tool_id: "srvtoolu_code1" };
