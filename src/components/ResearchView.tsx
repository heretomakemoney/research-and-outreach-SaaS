"use client";

// The research result: company check, relevance, triggers, people, angles, gaps,
// and the evidence behind all of it. Display only (the angle choice is passed up).

import { CardView, GradeBadge, SourceChips, SourceTable } from "@/components/Sources";
import type { EvidenceCard, Person, Workflow } from "@/lib/types";

const RANK_LABEL = { primary: "PRIMARY TRIGGER", secondary: "Secondary trigger", hook: "Conversation hook" } as const;
const RECENCY_LABEL = {
  under_3_months: "< 3 months",
  "3_to_6_months": "3–6 months",
  "6_to_12_months": "6–12 months",
  over_12_months: "> 12 months",
  unknown: "recency unknown",
} as const;
const STRENGTH_LABEL = {
  strong: "strong",
  medium: "medium",
  weak: "weak",
  general_introduction: "general introduction",
} as const;

export default function ResearchView({
  wf,
  onSelectAngle,
}: {
  wf: Workflow;
  onSelectAngle: (angleId: string) => void;
}) {
  const { state, synthesis } = wf;
  const entity = state.entity;
  const cardById = new Map<string, EvidenceCard>(state.cards.map((c) => [c.id, c]));
  const personById = new Map<string, Person>(state.people.map((p) => [p.id, p]));
  const rankedIds = new Set(synthesis?.people.map((p) => p.personId) ?? []);
  const otherPeople = state.people.filter((p) => !rankedIds.has(p.id));

  return (
    <section>
      <h2>Company</h2>
      {entity ? (
        <div className="panel">
          <dl className="kv">
            <dt>Match</dt>
            <dd>
              <strong>{entity.match}</strong> {entity.matchNote && <span className="muted">({entity.matchNote})</span>}
            </dd>
            <dt>Name found</dt>
            <dd>{entity.name || "–"}</dd>
            <dt>Website</dt>
            <dd>{entity.website || "–"}</dd>
            <dt>Trading / legal entity</dt>
            <dd>{entity.tradingLegal || "–"}</dd>
            <dt>Industry</dt>
            <dd>{entity.industry || "–"}</dd>
            <dt>Client type</dt>
            <dd>{entity.clientType || "–"}</dd>
            <dt>What it does</dt>
            <dd>
              {entity.summary || "–"} <SourceChips keys={entity.sourceKeys} />
            </dd>
            <dt>Your context</dt>
            <dd>{entity.contextCheck || "–"}</dd>
          </dl>
        </div>
      ) : (
        <p className="muted">The identification block could not be read. See the cost and debug panel.</p>
      )}

      {synthesis && (
        <>
          <h2>Teltonika relevance</h2>
          <div className="panel">
            <p>
              <span className={`badge relevance-${synthesis.relevance}`}>{synthesis.relevance}</span> {synthesis.summary}
            </p>
            {synthesis.noMeaningfulAngleNote && (
              <div className="warning">No meaningful Teltonika angle found: {synthesis.noMeaningfulAngleNote}</div>
            )}
          </div>

          <h2>Sales triggers and hooks</h2>
          {synthesis.triggers.length === 0 && <p className="muted">No sourced trigger or hook was identified.</p>}
          {synthesis.triggers.map((t) => (
            <div key={t.id} className={`panel trigger-${t.rank}`}>
              <div>
                <span className="badge">{RANK_LABEL[t.rank]}</span>{" "}
                <span className="badge light">{t.kind === "sales_trigger" ? "sales trigger" : "conversation hook"}</span>{" "}
                <span className="badge light">{t.priority} priority</span>{" "}
                <span className="badge light">{RECENCY_LABEL[t.recency]}</span> <GradeBadge grade={t.evidenceGrade} />
              </div>
              <h3>{t.title}</h3>
              <p>
                <strong>FACT:</strong> {t.fact}
              </p>
              {t.scale && (
                <p>
                  <strong>Scale:</strong> {t.scale}
                </p>
              )}
              <p>
                <strong>INFERENCE:</strong> {t.inference || "–"}
              </p>
              <p>
                <strong>POSSIBLE OPPORTUNITY:</strong> {t.possibleOpportunity || "–"}
              </p>
              {t.whyNow && (
                <p>
                  <strong>Why now:</strong> {t.whyNow}
                </p>
              )}
              <details>
                <summary>Evidence behind the FACT ({t.factCardIds.length})</summary>
                {t.factCardIds.map((id) => {
                  const card = cardById.get(id);
                  return card ? <CardView key={id} card={card} /> : null;
                })}
              </details>
            </div>
          ))}

          <h2>Relevant people (public sources)</h2>
          {synthesis.people.length === 0 && otherPeople.length === 0 && (
            <p className="muted">No relevant people were found. You can still enter a contact manually in the email step.</p>
          )}
          {synthesis.people.map((rp) => {
            const p = personById.get(rp.personId);
            if (!p) return null;
            return (
              <div key={p.id} className="panel">
                <strong>
                  {rp.rank}. {p.name}
                </strong>{" "}
                <span className="muted">
                  {p.role}
                  {p.organisation ? `, ${p.organisation}` : ""}
                </span>{" "}
                <SourceChips keys={p.sourceKeys} /> <GradeBadge grade={p.grade} />
                <div>{rp.whyRelevant || p.whyRelevant}</div>
                {p.evidence.length > 0 && (
                  <details>
                    <summary>Excerpt(s) the API returned for this person</summary>
                    <ul className="plain">
                      {p.evidence.map((e, i) => (
                        <li key={i}>
                          <span className="muted">{e.sourceKey}:</span> &ldquo;{e.excerpt}&rdquo;
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            );
          })}
          {otherPeople.length > 0 && (
            <details>
              <summary>Other people found, not ranked ({otherPeople.length})</summary>
              {otherPeople.map((p) => (
                <div key={p.id}>
                  {p.name} <span className="muted">{p.role}</span> <SourceChips keys={p.sourceKeys} />
                </div>
              ))}
            </details>
          )}

          <h2>Conversation angles</h2>
          <p className="muted">Pick the angle the email will follow. The recommended one is selected for you.</p>
          {synthesis.angles.map((a) => (
            <div key={a.id} className={`panel angle ${wf.selectedAngleId === a.id ? "selected" : ""}`}>
              <label className="angle-head">
                <input
                  type="radio"
                  name="angle"
                  checked={wf.selectedAngleId === a.id}
                  onChange={() => onSelectAngle(a.id)}
                />
                <strong>{a.title}</strong>
                {a.recommended && <span className="badge">RECOMMENDED</span>}
                <span className="badge light">{STRENGTH_LABEL[a.strength]}</span>
                {a.evidenceGrade && <GradeBadge grade={a.evidenceGrade} />}
              </label>
              <div>
                <strong>Question to explore:</strong> {a.conversationQuestion}
              </div>
              <div className="muted">{a.whyItWorks}</div>
              {a.cardIds.length > 0 && (
                <details>
                  <summary>Evidence this angle rests on ({a.cardIds.length})</summary>
                  {a.cardIds.map((id) => {
                    const card = cardById.get(id);
                    return card ? <CardView key={id} card={card} /> : null;
                  })}
                </details>
              )}
            </div>
          ))}

          {synthesis.gaps.length > 0 && (
            <>
              <h2>Gaps: what is still unknown</h2>
              <ul>
                {synthesis.gaps.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </>
          )}
          {synthesis.droppedReferences.length > 0 && (
            <details>
              <summary>References removed because they pointed at evidence that does not exist ({synthesis.droppedReferences.length})</summary>
              <ul className="plain">
                {synthesis.droppedReferences.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <h2>What was found ({state.cards.length} findings)</h2>
      <details open>
        <summary>Every finding, with its source</summary>
        {state.cards.map((c) => (
          <CardView key={c.id} card={c} />
        ))}
      </details>

      <h2>Sources ({state.sources.length})</h2>
      <p className="muted">
        Every row was returned by Anthropic&rsquo;s search or fetch tools. Claude cannot add rows by writing a URL.
      </p>
      <SourceTable sources={state.sources} />
    </section>
  );
}
