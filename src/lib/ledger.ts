// The SOURCE LEDGER.
//
// Claude's web tools return structured "blocks" in the API response. This file
// walks those blocks and builds a numbered list of sources (S1, S2, ...).
//
// Why this matters: every URL in the ledger comes from a block that
// ANTHROPIC'S SERVERS produced (a search result, a fetched page, or a citation).
// Claude cannot add a URL to the ledger by writing it in its answer.
//
// This file has no server-only imports on purpose, so it can be unit-tested
// with plain fake data (see ledger.test.ts).

import type Anthropic from "@anthropic-ai/sdk";
import type { AnswerSegment, LedgerSource, LedgerStats } from "./types";

const MAX_PAGE_TEXT_CHARS = 600_000;

const MAX_EXCERPTS_PER_SOURCE = 5;
const MAX_EXCERPT_CHARS = 300;

/** Make two spellings of the same URL compare equal (ignore #fragment, utm_ tracking, trailing slash). */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_")) u.searchParams.delete(key);
    }
    let out = u.toString();
    if (u.pathname !== "/" && out.endsWith("/")) out = out.slice(0, -1);
    return out;
  } catch {
    return raw.trim();
  }
}

export interface LedgerResult {
  /** All sources: the ones passed in as `existingSources` first (keys unchanged), then new ones. */
  sources: LedgerSource[];
  /** Claude's answer text with " [S3][S5]" markers added after each cited passage (trimmed). */
  answerText: string;
  /** The same text, NOT trimmed. `segments` offsets refer to this string. */
  rawAnswerText: string;
  /** For each text block: where it sits in rawAnswerText and which API excerpts back it. */
  segments: AnswerSegment[];
  /**
   * Full text of pages the API returned as text (not PDFs, not search snippets, which are encrypted),
   * by source key. Used only inside one stage to check quotes; never stored or sent to the browser.
   */
  pageTexts: Record<string, string>;
  stats: LedgerStats;
}

/** What the parser needs to check a named source and quote against what the API really returned. */
export function buildEvidenceContext(
  sources: readonly LedgerSource[],
  pageTexts: Record<string, string>,
): { resolveSource(url: string): string | null; pageText(sourceKey: string): string | null } {
  const byUrl = new Map(sources.map((s) => [canonicalUrl(s.url), s.key]));
  return {
    resolveSource: (url) => byUrl.get(canonicalUrl(url)) ?? null,
    pageText: (key) => pageTexts[key] ?? null,
  };
}

/**
 * @param existingSources sources found by EARLIER stages. They keep their keys
 *   (S1, S2, ...) so that source IDs are stable across the whole workflow, and
 *   a page found again is not added twice. Fetched-document positions
 *   (document_index) are per request, so these never take part in that mapping.
 */
export function buildLedger(
  blocks: Anthropic.ContentBlock[],
  existingSources: readonly LedgerSource[] = [],
): LedgerResult {
  const sources: LedgerSource[] = [];
  const byUrl = new Map<string, LedgerSource>();
  for (const prior of existingSources) {
    const copy: LedgerSource = { ...prior, citedExcerpts: [...prior.citedExcerpts] };
    sources.push(copy);
    byUrl.set(canonicalUrl(copy.url), copy);
  }
  // Fetched documents in the order they were returned. A citation of a fetched
  // page refers to it by position ("document_index"), not by URL.
  const fetchedInOrder: LedgerSource[] = [];
  // Remember which URL each web_fetch call asked for, so a failed fetch
  // (which comes back without a URL) can still be attributed to a page.
  const requestedUrlByToolUseId = new Map<string, string>();

  const stats: LedgerStats = {
    textBlocks: 0,
    thinkingBlocks: 0,
    serverToolUseBlocks: 0,
    searchResultBlocks: 0,
    searchResultsReturned: 0,
    searchQueries: [],
    searchErrors: [],
    fetchResultBlocks: 0,
    fetchedOk: 0,
    fetchRequestedUrls: [],
    fetchErrors: [],
    citationsTotal: 0,
    citationsMapped: 0,
    citationsUnmapped: 0,
    citedUrlNotInResults: 0,
    resultsViaCodeExecution: 0,
    otherBlockTypes: {},
  };
  const pageTexts: Record<string, string> = {};

  function upsert(url: string): LedgerSource {
    const canon = canonicalUrl(url);
    const existing = byUrl.get(canon);
    if (existing) return existing;
    const source: LedgerSource = {
      key: `S${sources.length + 1}`,
      url,
      title: null,
      pageAge: null,
      seenInSearch: false,
      fetched: false,
      fetchKind: null,
      retrievedAt: null,
      fetchError: null,
      citedCount: 0,
      citedExcerpts: [],
    };
    sources.push(source);
    byUrl.set(canon, source);
    return source;
  }

  function addExcerpt(source: LedgerSource, text: string | null | undefined) {
    const clean = (text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_EXCERPT_CHARS);
    if (!clean) return;
    if (source.citedExcerpts.includes(clean)) return;
    if (source.citedExcerpts.length >= MAX_EXCERPTS_PER_SOURCE) return;
    source.citedExcerpts.push(clean);
  }

  const answerParts: string[] = [];
  const segments: AnswerSegment[] = [];
  let rawLength = 0;
  // Text blocks that are separated by tool calls / thinking are different "turns" of Claude's writing
  // ("Now let me read the PDF." ... then the final answer). They must not be glued onto one line.
  // Text blocks that follow each other directly are one passage split at a citation: those stay joined.
  let sawNonTextSinceText = false;

  for (const block of blocks) {
    if (block.type !== "text") sawNonTextSinceText = true;
    switch (block.type) {
      case "server_tool_use": {
        stats.serverToolUseBlocks++;
        const input = (block.input ?? {}) as { query?: unknown; url?: unknown };
        if (block.name === "web_search" && typeof input.query === "string") {
          stats.searchQueries.push(input.query);
        }
        if (block.name === "web_fetch" && typeof input.url === "string") {
          stats.fetchRequestedUrls.push(input.url);
          requestedUrlByToolUseId.set(block.id, input.url);
        }
        break;
      }

      case "web_search_tool_result": {
        stats.searchResultBlocks++;
        if (block.caller && block.caller.type !== "direct") stats.resultsViaCodeExecution++;
        if (Array.isArray(block.content)) {
          for (const result of block.content) {
            stats.searchResultsReturned++;
            const source = upsert(result.url);
            source.seenInSearch = true;
            source.title = source.title ?? result.title ?? null;
            source.pageAge = source.pageAge ?? result.page_age ?? null;
          }
        } else {
          stats.searchErrors.push(block.content.error_code);
        }
        break;
      }

      case "web_fetch_tool_result": {
        stats.fetchResultBlocks++;
        if (block.caller && block.caller.type !== "direct") stats.resultsViaCodeExecution++;
        const content = block.content;
        if (content.type === "web_fetch_result") {
          stats.fetchedOk++;
          const source = upsert(content.url);
          source.fetched = true;
          source.fetchKind = content.content.source.type === "base64" ? "pdf" : "text";
          source.retrievedAt = content.retrieved_at;
          source.title = source.title ?? content.content.title ?? null;
          if (content.content.source.type === "text") {
            pageTexts[source.key] = content.content.source.data.slice(0, MAX_PAGE_TEXT_CHARS);
          }
          fetchedInOrder.push(source);
        } else {
          const url = requestedUrlByToolUseId.get(block.tool_use_id) ?? null;
          stats.fetchErrors.push({ url, code: content.error_code });
          if (url) upsert(url).fetchError = content.error_code;
        }
        break;
      }

      case "text": {
        stats.textBlocks++;
        const keys: string[] = [];
        const segmentCitations: { sourceKey: string; excerpt: string }[] = [];
        for (const citation of block.citations ?? []) {
          stats.citationsTotal++;
          let source: LedgerSource | undefined;
          if (citation.type === "web_search_result_location") {
            const known = byUrl.has(canonicalUrl(citation.url));
            if (!known) stats.citedUrlNotInResults++;
            source = upsert(citation.url);
            source.title = source.title ?? citation.title ?? null;
          } else if (citation.type === "search_result_location") {
            // Not expected from web search/fetch. Counted as unmapped below.
            source = undefined;
          } else {
            // char_location / page_location / content_block_location:
            // these point at a fetched document by its position.
            source = fetchedInOrder[citation.document_index];
          }
          if (!source) {
            stats.citationsUnmapped++;
            continue;
          }
          stats.citationsMapped++;
          source.citedCount++;
          addExcerpt(source, citation.cited_text);
          if (!keys.includes(source.key)) keys.push(source.key);
          const excerpt = (citation.cited_text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_EXCERPT_CHARS);
          if (
            excerpt &&
            !segmentCitations.some((c) => c.sourceKey === source.key && c.excerpt === excerpt)
          ) {
            segmentCitations.push({ sourceKey: source.key, excerpt });
          }
        }
        // Only OUR code may write [S#] markers. If Claude typed one itself, neutralise it
        // so it can never pass for a real citation.
        const safeText = block.text.replace(/\[(S\d+)\]/g, "($1)");
        if (sawNonTextSinceText && rawLength > 0 && !answerParts[answerParts.length - 1].endsWith("\n")) {
          answerParts.push("\n");
          rawLength += 1;
        }
        sawNonTextSinceText = false;
        const piece = safeText + keys.map((k) => ` [${k}]`).join("");
        segments.push({ start: rawLength, end: rawLength + piece.length, citations: segmentCitations });
        rawLength += piece.length;
        answerParts.push(piece);
        break;
      }

      case "thinking":
      case "redacted_thinking":
        stats.thinkingBlocks++;
        break;

      default:
        stats.otherBlockTypes[block.type] = (stats.otherBlockTypes[block.type] ?? 0) + 1;
    }
  }

  const rawAnswerText = answerParts.join("");
  return { sources, answerText: rawAnswerText.trim(), rawAnswerText, segments, pageTexts, stats };
}
