"use client";

// Everything that is NOT in the main Research view but stays one click away:
// other developments, technology, background, gaps, all findings, sources, and the research details
// (evidence grades, usage and estimated cost, warnings, diagnostics). Nothing is removed from storage.

import { CardView, SourceTable } from "@/components/Sources";
import type { ResearchRun } from "@/lib/domain";
import { groupFindings, researchGaps } from "@/lib/summary";
import { totalCost } from "@/lib/pricing";
import { seconds, usd, num } from "@/lib/format";
import type { EvidenceCard, StageLog } from "@/lib/types";

function CardGroup({ title, cards }: { title: string; cards: EvidenceCard[] }) {
  return (
    <details className="sub-details">
      <summary>
        {title} <span className="count">{cards.length}</span>
      </summary>
      {cards.length === 0 ? <p className="muted">None.</p> : cards.map((c) => <CardView key={c.id} card={c} />)}
    </details>
  );
}

function stageName(l: StageLog): string {
  if (l.stage === "followup") return `follow-up ${l.round}`;
  if (l.stage === "email") return `email ${l.round}`;
  return l.stage;
}

export function MoreResearch({ run }: { run: ResearchRun }) {
  const g = groupFindings(run.research, run.synthesis);
  const gaps = researchGaps(run.research, run.synthesis);
  const logs: StageLog[] = [...run.research.stages, ...(run.synthesisLog ? [run.synthesisLog] : [])];
  const total = totalCost(logs);

  return (
    <div className="more">
      <details className="group">
        <summary>More research</summary>
        <CardGroup title="Other developments & projects" cards={g.developments} />
        <CardGroup title="Technology & vendors" cards={g.technology} />
        <CardGroup title="Background" cards={g.background} />
        <details className="sub-details">
          <summary>
            Research gaps <span className="count">{gaps.length}</span>
          </summary>
          {gaps.length === 0 ? (
            <p className="muted">None recorded.</p>
          ) : (
            <ul className="plain">
              {gaps.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          )}
        </details>
        <CardGroup title="All findings" cards={run.research.cards} />
        <details className="sub-details">
          <summary>
            Sources <span className="count">{run.research.sources.length}</span>
          </summary>
          <p className="muted">Every row was returned by Anthropic&rsquo;s search or fetch tools. Claude cannot add rows by writing a URL.</p>
          <SourceTable sources={run.research.sources} />
        </details>
      </details>

      <details className="group">
        <summary>Research details</summary>
        <div className="details-body">
          <p className="muted">
            Evidence grades: <strong>API citation</strong> (the search tool attached a citation), <strong>verified quote</strong> (the quoted words were found in the page the tool returned), <strong>tool source</strong> (the page is one the tools really returned or fetched, such as an official PDF, but its wording was not independently checked).
          </p>
          {logs.length > 0 && (
            <table className="mini">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Model</th>
                  <th>Searches</th>
                  <th>Fetches</th>
                  <th>Time</th>
                  <th>Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l, i) => (
                  <tr key={i}>
                    <td>{stageName(l)}</td>
                    <td>{l.model}</td>
                    <td>{l.usage.searchRequests}</td>
                    <td>{l.usage.fetchRequests}</td>
                    <td>{seconds(l.durationMs)}</td>
                    <td>{usd(l.cost.totalUsd)}</td>
                  </tr>
                ))}
                <tr>
                  <th colSpan={2}>Research total</th>
                  <th>{total.searches}</th>
                  <th>{total.fetches}</th>
                  <th>{seconds(total.durationMs)}</th>
                  <th>{usd(total.totalUsd)}</th>
                </tr>
              </tbody>
            </table>
          )}
          <p className="muted">Costs are estimates from token and search counts at list prices, not a bill. The Anthropic Console is authoritative.</p>
          <dl className="kv">
            <dt>Run</dt>
            <dd>
              {run.aiMode === "mock" ? "mock data" : run.aiMode === "live" ? "live" : "unknown mode"}; started {new Date(run.startedAt).toLocaleString("en-AU")}
              {run.topic ? `; topic: ${run.topic}` : ""}
            </dd>
            {run.gateLog.length > 0 && (
              <>
                <dt>Why each step ran</dt>
                <dd>
                  {run.gateLog.map((x, i) => (
                    <div key={i}>
                      After {x.afterStage}: <strong>{x.action}</strong>. {x.reason}
                    </div>
                  ))}
                </dd>
              </>
            )}
          </dl>
          {logs.map((l, i) => (
            <details key={i} className="sub-details">
              <summary>
                Debug: {stageName(l)} ({l.model}, {usd(l.cost.totalUsd)}){l.warnings.length > 0 ? `, ${l.warnings.length} warning(s)` : ""}
              </summary>
              {l.warnings.map((w, j) => (
                <div key={j} className="notice warn">
                  {w}
                </div>
              ))}
              <dl className="kv">
                <dt>Tokens (in / out / cache write / cache read)</dt>
                <dd>
                  {num(l.usage.inputTokens)} / {num(l.usage.outputTokens)} / {num(l.usage.cacheWriteTokens)} / {num(l.usage.cacheReadTokens)}
                </dd>
                <dt>Rules sent</dt>
                <dd>{l.rulesFiles.map((f) => f.name).join(", ")}</dd>
                <dt>Stop reasons</dt>
                <dd>{l.stopReasons.map((s) => s ?? "null").join(", ")}</dd>
                {l.ledger && (
                  <>
                    <dt>Search queries</dt>
                    <dd>
                      <ul className="plain">
                        {l.ledger.searchQueries.map((q, k) => (
                          <li key={k}>{q}</li>
                        ))}
                      </ul>
                    </dd>
                    <dt>Citations from the API</dt>
                    <dd>
                      {l.ledger.citationsTotal} ({l.ledger.resultsViaCodeExecution} results read through code execution)
                    </dd>
                  </>
                )}
              </dl>
              {l.answerPreview && (
                <details className="sub-details">
                  <summary>Raw answer text (start)</summary>
                  <pre className="raw">{l.answerPreview}</pre>
                </details>
              )}
            </details>
          ))}
        </div>
      </details>
    </div>
  );
}
