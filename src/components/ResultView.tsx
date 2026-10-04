"use client";

// Shows the result of the identify stage: Claude's answer, the source ledger,
// and a debug section. Display only. It fetches and stores nothing.

import { PRICES_SOURCE } from "@/lib/pricing";
import type { IdentifyResult, LedgerSource } from "@/lib/types";

const usd = (n: number) => `$${n.toFixed(4)}`;
const num = (n: number) => n.toLocaleString("en-AU");

/** Turn "[S3]" markers in the answer into links to the matching row in the source table. */
function AnswerWithMarkers({ text }: { text: string }) {
  const parts = text.split(/(\[S\d+\])/g);
  return (
    <div className="answer">
      {parts.map((part, i) => {
        const match = /^\[(S\d+)\]$/.exec(part);
        return match ? (
          <a key={i} className="marker" href={`#source-${match[1]}`}>
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </div>
  );
}

function readStatus(s: LedgerSource): string {
  if (s.fetched) return s.fetchKind === "pdf" ? "Read in full (PDF)" : "Read in full (page)";
  if (s.fetchError) return `Fetch failed: ${s.fetchError}`;
  return "Search result only";
}

function SourceTable({ sources }: { sources: LedgerSource[] }) {
  if (sources.length === 0) return <p className="muted">No sources were captured.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Title</th>
          <th>URL</th>
          <th>Read?</th>
          <th>Cited</th>
          <th>Page age</th>
        </tr>
      </thead>
      <tbody>
        {sources.map((s) => (
          <tr key={s.key} id={`source-${s.key}`}>
            <td>{s.key}</td>
            <td>
              {s.title ?? <span className="muted">(no title)</span>}
              {s.citedExcerpts.length > 0 && (
                <details>
                  <summary>{s.citedExcerpts.length} excerpt(s) returned by the API</summary>
                  <ul className="plain">
                    {s.citedExcerpts.map((e, i) => (
                      <li key={i}>&ldquo;{e}&rdquo;</li>
                    ))}
                  </ul>
                </details>
              )}
            </td>
            <td className="url">
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                {s.url}
              </a>
            </td>
            <td>{readStatus(s)}</td>
            <td>{s.citedCount > 0 ? `${s.citedCount}×` : "–"}</td>
            <td>{s.pageAge ?? "–"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ResultView({ result }: { result: IdentifyResult }) {
  const { usage, cost, debug } = result;
  const l = debug.ledger;

  return (
    <section>
      <h2>Result: stage 1, identify the company</h2>

      {result.warnings.map((w, i) => (
        <div key={i} className="warning">
          {w}
        </div>
      ))}

      {result.answerText ? <AnswerWithMarkers text={result.answerText} /> : <p className="muted">(no answer text)</p>}
      <p className="muted">
        [S#] markers are added by our code from the citations the API returned. They link to the source table below.
      </p>

      <h2>Sources ({result.sources.length})</h2>
      <p className="muted">
        Every row was returned by Anthropic&rsquo;s search or fetch tools. Claude cannot add rows by writing a URL.
      </p>
      <SourceTable sources={result.sources} />

      <h2>Debug</h2>
      <details open>
        <summary>Usage and estimated cost</summary>
        <dl className="kv">
          <dt>Model</dt>
          <dd>{usage.model}</dd>
          <dt>API requests</dt>
          <dd>
            {usage.apiRequests} (1 + {debug.continuations} resumed after pause_turn); stop reasons:{" "}
            {debug.stopReasons.map((s) => s ?? "null").join(", ")}
          </dd>
          <dt>Input tokens (uncached)</dt>
          <dd>{num(usage.inputTokens)}</dd>
          <dt>Output tokens (incl. thinking)</dt>
          <dd>{num(usage.outputTokens)}</dd>
          <dt>Cache write / read tokens</dt>
          <dd>
            {num(usage.cacheWriteTokens)} / {num(usage.cacheReadTokens)}
          </dd>
          <dt>Searches billed</dt>
          <dd>{usage.searchRequests}</dd>
          <dt>Fetches reported</dt>
          <dd>{usage.fetchRequests}</dd>
          <dt>Duration</dt>
          <dd>{(debug.durationMs / 1000).toFixed(1)} s</dd>
          <dt>ESTIMATED cost</dt>
          <dd>
            <strong>{usd(cost.totalUsd)}</strong> (input {usd(cost.inputUsd)} + output {usd(cost.outputUsd)} + cache
            write {usd(cost.cacheWriteUsd)} + cache read {usd(cost.cacheReadUsd)} + searches {usd(cost.searchUsd)})
          </dd>
        </dl>
        <p className="muted">
          This is an <strong>estimate</strong>, not a bill. The API reports token and search counts, not dollars. We
          multiply those by Anthropic&rsquo;s published list prices (checked {cost.pricesCheckedOn}, see {PRICES_SOURCE}
          ): tokens ÷ 1,000,000 × price per million, plus $0.01 per search. Web fetch has no fee of its own and code
          execution used for filtering is free with the web tools. Discounts or credits are not visible here. The
          authoritative figure is the Usage page in the Anthropic Console.
        </p>
      </details>

      <details>
        <summary>What the tools did (queries, fetches, errors)</summary>
        <dl className="kv">
          <dt>Search queries Claude ran</dt>
          <dd>
            {l.searchQueries.length === 0 ? (
              "none"
            ) : (
              <ul className="plain">
                {l.searchQueries.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            )}
          </dd>
          <dt>Pages Claude asked to fetch</dt>
          <dd>
            {l.fetchRequestedUrls.length === 0 ? (
              "none"
            ) : (
              <ul className="plain">
                {l.fetchRequestedUrls.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            )}
          </dd>
          <dt>Search results returned</dt>
          <dd>
            {l.searchResultsReturned} in {l.searchResultBlocks} search block(s)
          </dd>
          <dt>Fetches that succeeded / failed</dt>
          <dd>
            {l.fetchedOk} / {l.fetchErrors.length}
            {l.fetchErrors.length > 0 && (
              <ul className="plain">
                {l.fetchErrors.map((e, i) => (
                  <li key={i}>
                    {e.code}: {e.url ?? "(url unknown)"}
                  </li>
                ))}
              </ul>
            )}
          </dd>
          <dt>Search errors</dt>
          <dd>{l.searchErrors.length === 0 ? "none" : l.searchErrors.join(", ")}</dd>
        </dl>
      </details>

      <details>
        <summary>Source ledger integrity checks</summary>
        <dl className="kv">
          <dt>Citations in the answer</dt>
          <dd>{l.citationsTotal}</dd>
          <dt>Matched to a ledger source</dt>
          <dd>{l.citationsMapped}</dd>
          <dt>Could NOT be matched</dt>
          <dd>{l.citationsUnmapped}</dd>
          <dt>Cited a URL no tool returned</dt>
          <dd>{l.citedUrlNotInResults}</dd>
          <dt>Content blocks</dt>
          <dd>
            text {l.textBlocks}, thinking {l.thinkingBlocks}, tool calls {l.serverToolUseBlocks}
            {Object.keys(l.otherBlockTypes).length > 0 && `, other: ${JSON.stringify(l.otherBlockTypes)}`}
          </dd>
        </dl>
        <p className="muted">
          For the ledger to be trustworthy, the two &ldquo;could not&rdquo; counts should be 0 in normal runs.
        </p>
      </details>

      <details>
        <summary>What Claude was given and which limits applied</summary>
        <dl className="kv">
          <dt>Intelligence files sent</dt>
          <dd>
            {debug.rulesFiles.map((f) => `${f.name} (${num(f.chars)} chars)`).join(", ")}
          </dd>
          <dt>System prompt size</dt>
          <dd>{num(debug.systemPromptChars)} characters</dd>
          <dt>Tool versions</dt>
          <dd>
            {debug.toolVersions.search}, {debug.toolVersions.fetch}
          </dd>
          <dt>Runaway guards (not a budget)</dt>
          <dd>
            max {debug.caps.maxSearches} searches, {debug.caps.maxFetches} fetches, {debug.caps.maxContinuations}{" "}
            continuations, {num(debug.caps.maxTokens)} output tokens per request; effort: {debug.effort}
          </dd>
        </dl>
      </details>
    </section>
  );
}
