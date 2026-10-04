"use client";

// Per-stage and total usage and ESTIMATED cost, plus what the tools did.
// Display only.

import { PRICES_SOURCE, totalCost } from "@/lib/pricing";
import { num, seconds, usd } from "@/lib/format";
import type { StageLog, Workflow } from "@/lib/types";

function label(l: StageLog): string {
  if (l.stage === "followup") return `follow-up ${l.round}`;
  if (l.stage === "email") return `email ${l.round}`;
  return l.stage;
}

export default function CostPanel({ wf }: { wf: Workflow }) {
  const logs: StageLog[] = [...wf.state.stages, ...(wf.synthesisLog ? [wf.synthesisLog] : []), ...wf.emailLogs];
  if (logs.length === 0) return null;
  const total = totalCost(logs);
  const first = logs[0];

  return (
    <section>
      <h2>Cost and usage</h2>
      <table>
        <thead>
          <tr>
            <th>Stage</th>
            <th>Model</th>
            <th>API req.</th>
            <th>Searches</th>
            <th>Fetches</th>
            <th>Input</th>
            <th>Output</th>
            <th>Cache write</th>
            <th>Cache read</th>
            <th>Time</th>
            <th>Est. cost</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l, i) => (
            <tr key={i}>
              <td>{label(l)}</td>
              <td>{l.model}</td>
              <td>{l.usage.apiRequests}</td>
              <td>{l.usage.searchRequests}</td>
              <td>{l.usage.fetchRequests}</td>
              <td>{num(l.usage.inputTokens)}</td>
              <td>{num(l.usage.outputTokens)}</td>
              <td>{num(l.usage.cacheWriteTokens)}</td>
              <td>{num(l.usage.cacheReadTokens)}</td>
              <td>{seconds(l.durationMs)}</td>
              <td>{usd(l.cost.totalUsd)}</td>
            </tr>
          ))}
          <tr>
            <th colSpan={3}>Total</th>
            <th>{total.searches}</th>
            <th>{total.fetches}</th>
            <th colSpan={4} />
            <th>{seconds(total.durationMs)}</th>
            <th>{usd(total.totalUsd)}</th>
          </tr>
        </tbody>
      </table>
      <p className="muted">
        These costs are <strong>estimates</strong>, not a bill. The API reports token and search counts, not dollars. We
        multiply them by Anthropic&rsquo;s published list prices (checked {first.cost.pricesCheckedOn}, see {PRICES_SOURCE}
        ): tokens ÷ 1,000,000 × price per million, plus $0.01 per search. Web fetch has no fee of its own. Discounts or
        credits are not visible here. The authoritative figure is the Usage page in the Anthropic Console. No cost cap is
        enforced; search and fetch limits and the follow-up rules keep spending bounded.
      </p>

      {wf.gateLog.length > 0 && (
        <details>
          <summary>Why each step ran (the adaptive gate)</summary>
          <ul className="plain">
            {wf.gateLog.map((g, i) => (
              <li key={i}>
                After <strong>{g.afterStage}</strong>: <strong>{g.action}</strong>. {g.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      {logs.map((l, i) => (
        <details key={i}>
          <summary>
            Debug: {label(l)} ({l.model}, {usd(l.cost.totalUsd)})
            {l.warnings.length > 0 ? ` – ${l.warnings.length} warning(s)` : ""}
          </summary>
          {l.warnings.map((w, j) => (
            <div key={j} className="warning">
              {w}
            </div>
          ))}
          <dl className="kv">
            <dt>Retrieval layer</dt>
            <dd>{l.retriever ?? "none (no web access in this stage)"}</dd>
            <dt>Stop reasons</dt>
            <dd>
              {l.stopReasons.map((s) => s ?? "null").join(", ")} ({l.continuations} resumed after pause_turn)
            </dd>
            <dt>Intelligence files sent</dt>
            <dd>{l.rulesFiles.map((f) => `${f.name} (${num(f.chars)} chars)`).join(", ")}</dd>
            <dt>Prompt sizes</dt>
            <dd>
              system {num(l.systemPromptChars)} chars, user message {num(l.userMessageChars)} chars
            </dd>
            <dt>Effort / limits</dt>
            <dd>
              {l.effort}; {JSON.stringify(l.caps)}
            </dd>
            <dt>Cost breakdown</dt>
            <dd>
              input {usd(l.cost.inputUsd)} + output {usd(l.cost.outputUsd)} + cache write {usd(l.cost.cacheWriteUsd)} +
              cache read {usd(l.cost.cacheReadUsd)} + searches {usd(l.cost.searchUsd)}
            </dd>
            {l.ledger && (
              <>
                <dt>Search queries Claude ran</dt>
                <dd>
                  {l.ledger.searchQueries.length === 0 ? (
                    "none"
                  ) : (
                    <ul className="plain">
                      {l.ledger.searchQueries.map((q, j) => (
                        <li key={j}>{q}</li>
                      ))}
                    </ul>
                  )}
                </dd>
                <dt>Pages Claude asked to fetch</dt>
                <dd>
                  {l.ledger.fetchRequestedUrls.length === 0 ? (
                    "none"
                  ) : (
                    <ul className="plain">
                      {l.ledger.fetchRequestedUrls.map((u, j) => (
                        <li key={j}>{u}</li>
                      ))}
                    </ul>
                  )}
                </dd>
                <dt>Search results / fetches ok / failed</dt>
                <dd>
                  {l.ledger.searchResultsReturned} results; {l.ledger.fetchedOk} ok; {l.ledger.fetchErrors.length} failed
                  {l.ledger.fetchErrors.length > 0 && ` (${l.ledger.fetchErrors.map((e) => e.code).join(", ")})`}
                </dd>
                <dt>Citation integrity</dt>
                <dd>
                  {l.ledger.citationsTotal} citations; {l.ledger.citationsMapped} matched; {l.ledger.citationsUnmapped} could
                  not be matched; {l.ledger.citedUrlNotInResults} cited a URL no tool returned
                </dd>
                <dt>Content blocks</dt>
                <dd>
                  text {l.ledger.textBlocks}, thinking {l.ledger.thinkingBlocks}, tool calls {l.ledger.serverToolUseBlocks}
                  {Object.keys(l.ledger.otherBlockTypes).length > 0 && `, other: ${JSON.stringify(l.ledger.otherBlockTypes)}`}
                </dd>
              </>
            )}
          </dl>
        </details>
      ))}
    </section>
  );
}
