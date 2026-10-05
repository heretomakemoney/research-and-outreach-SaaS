"use client";

// The Research tab. In order: account summary, best opportunity, other useful opportunities,
// relevant people, conversation angles. Everything else is inside the collapsed "More research"
// and "Research details" groups.

import { MoreResearch } from "@/components/MoreResearch";
import { CardView, GradeBadge, GradeChip, SourceChips } from "@/components/Sources";
import type { Company, ResearchRun } from "@/lib/domain";
import { splitOpportunities } from "@/lib/summary";
import type { Angle, EvidenceCard, Person, RankedPerson, Trigger } from "@/lib/types";

const RECENCY: Record<Trigger["recency"], string> = {
  under_3_months: "under 3 months",
  "3_to_6_months": "3 to 6 months",
  "6_to_12_months": "6 to 12 months",
  over_12_months: "over 12 months old",
  unknown: "date unknown",
};
const RANK: Record<Trigger["rank"], string> = { primary: "Best", secondary: "Secondary", hook: "Conversation hook" };
const STRENGTH: Record<Angle["strength"], string> = { strong: "strong", medium: "medium", weak: "weak", general_introduction: "general introduction" };

function Evidence({ ids, cards }: { ids: string[]; cards: Map<string, EvidenceCard> }) {
  const found = ids.map((id) => cards.get(id)).filter((c): c is EvidenceCard => !!c);
  if (found.length === 0) return null;
  return (
    <details className="evidence">
      <summary>View evidence ({found.length})</summary>
      {found.map((c) => (
        <CardView key={c.id} card={c} />
      ))}
    </details>
  );
}

function TriggerBody({ t, cards }: { t: Trigger; cards: Map<string, EvidenceCard> }) {
  return (
    <div className="trigger-body">
      <p>
        <strong>FACT</strong> {t.fact}
      </p>
      {t.inference && (
        <p>
          <strong>INFERENCE</strong> {t.inference}
        </p>
      )}
      {t.possibleOpportunity && (
        <p>
          <strong>POSSIBLE OPPORTUNITY</strong> {t.possibleOpportunity}
        </p>
      )}
      {t.whyNow && (
        <p>
          <strong>Why now</strong> {t.whyNow}
        </p>
      )}
      {t.scale && (
        <p className="muted">
          <strong>Scale</strong> {t.scale}
        </p>
      )}
      <Evidence ids={t.factCardIds} cards={cards} />
    </div>
  );
}

function Chips({ t }: { t: Trigger }) {
  return (
    <span className="chips">
      <span className="badge light">{t.priority} priority</span>
      <span className="badge light">{RECENCY[t.recency]}</span>
      <GradeChip grade={t.evidenceGrade} />
    </span>
  );
}

export function ResearchTab({
  company,
  run,
  onEditContext,
  onSelectAngle,
  onSelectPerson,
  onWriteEmail,
}: {
  company: Company;
  run: ResearchRun;
  onEditContext: () => void;
  onSelectAngle: (key: string) => void;
  onSelectPerson: (key: string) => void;
  onWriteEmail: () => void;
}) {
  const research = run.research;
  const synthesis = run.synthesis;
  const entity = research.entity;
  const cards = new Map(research.cards.map((c) => [c.id, c]));
  const people = new Map(research.people.map((p) => [p.id, p]));
  const selectionIsCurrent = company.selectedRunId === run.id;
  const selectedAngle = selectionIsCurrent ? company.selectedAngleKey : null;
  const selectedPerson = selectionIsCurrent ? company.selectedPersonKey : null;

  // ---- partial run: no evaluation yet
  if (!synthesis) {
    return (
      <div className="stack-lg">
        <section className="card">
          <h2>Summary</h2>
          <p>{entity?.summary || "No summary was produced."}</p>
          <div className="notice warn">Research incomplete. Only what was found before it stopped is shown: no opportunities, people or angles were evaluated. Use Research again.</div>
        </section>
        <MoreResearch run={run} />
      </div>
    );
  }

  const { best, others } = splitOpportunities(synthesis);
  const ranked: { rp: RankedPerson; p: Person }[] = synthesis.people.map((rp) => ({ rp, p: people.get(rp.personId)! })).filter((x) => !!x.p);
  const unranked = research.people.filter((p) => !synthesis.people.some((rp) => rp.personId === p.id));
  const selectedAngleObj = synthesis.angles.find((a) => a.id === selectedAngle) ?? null;
  const selectedPersonObj = research.people.find((p) => p.id === selectedPerson) ?? null;

  return (
    <div className="stack-lg">
      {/* A. SUMMARY */}
      <section className="card" id="summary">
        <div className="verdict">{run.summary?.verdictLine}</div>
        <p className="overview">{entity?.summary}</p>
        <div className="chips">
          <span className={`badge relevance-${synthesis.relevance}`}>Teltonika relevance: {synthesis.relevance}</span>
          {run.summary?.industry && <span className="badge light">{run.summary.industry}</span>}
          {run.summary?.clientType && <span className="badge light">{run.summary.clientType}</span>}
        </div>
        <details className="why">
          <summary>Why it may be relevant</summary>
          <p>{synthesis.summary}</p>
          {entity?.tradingLegal && <p className="muted">Trading name: {entity.tradingLegal}</p>}
        </details>
        {synthesis.noMeaningfulAngleNote && <div className="notice warn">No meaningful Teltonika angle found: {synthesis.noMeaningfulAngleNote}</div>}
        <div className="context-strip">
          <span className="label">Your context</span>
          <span className="ctx-text">{company.context ? company.context : "None yet."}</span>
          <button type="button" className="linklike" onClick={onEditContext}>
            Edit
          </button>
        </div>
      </section>

      {/* B. BEST OPPORTUNITY */}
      <section className="card best" id="opportunities">
        <h2>Best opportunity</h2>
        {best ? (
          <>
            <div className="opp-head">
              <h3>{best.title}</h3>
              <Chips t={best} />
            </div>
            <TriggerBody t={best} cards={cards} />
          </>
        ) : (
          <p className="muted">No opportunity was identified.</p>
        )}
      </section>

      {/* C. OTHER USEFUL OPPORTUNITIES */}
      <section className="card">
        <h2>
          Other useful opportunities <span className="count">{others.length}</span>
        </h2>
        {others.length === 0 && <p className="muted">None.</p>}
        {others.map((t) => (
          <details key={t.id} className="row-details">
            <summary>
              <span className="badge light">{RANK[t.rank]}</span>
              <span className="row-title">{t.title}</span>
              <Chips t={t} />
            </summary>
            <TriggerBody t={t} cards={cards} />
          </details>
        ))}
      </section>

      {/* D. PEOPLE */}
      <section className="card" id="people">
        <h2>
          Relevant people <span className="count">{research.people.length}</span>
        </h2>
        {research.people.length === 0 && <p className="muted">No relevant people found in public sources. You can add a contact manually on the Outreach tab.</p>}
        {[...ranked.map((x) => x.p), ...unranked].map((p) => {
          const why = ranked.find((x) => x.p.id === p.id)?.rp.whyRelevant || p.whyRelevant;
          const isSel = selectedPerson === p.id;
          return (
            <div key={p.id} className="person">
              <div className="person-main">
                <div>
                  <strong>{p.name}</strong> <span className="muted">{p.role}</span> <GradeChip grade={p.grade} />
                </div>
                <div className="why-line">{why}</div>
                <details className="evidence">
                  <summary>View evidence</summary>
                  <p className="muted">
                    Source: <SourceChips keys={p.sourceKeys} /> <GradeBadge grade={p.grade} />
                  </p>
                  {p.evidence.map((e, i) => (
                    <p key={i} className="muted">
                      &ldquo;{e.excerpt}&rdquo;
                    </p>
                  ))}
                </details>
              </div>
              <button type="button" className={isSel ? "" : "secondary"} onClick={() => onSelectPerson(p.id)} aria-pressed={isSel}>
                {isSel ? "Selected" : "Select as recipient"}
              </button>
            </div>
          );
        })}
      </section>

      {/* E. ANGLES */}
      <section className="card" id="angles">
        <h2>
          Conversation angles <span className="count">{synthesis.angles.length}</span>
        </h2>
        {synthesis.angles.map((a) => {
          const isSel = selectedAngle === a.id;
          const basedOn = synthesis.triggers.filter((t) => a.triggerIds.includes(t.id)).map((t) => t.title);
          return (
            <div key={a.id} className={`angle ${isSel ? "selected" : ""}`}>
              <div className="angle-main">
                <div>
                  {a.recommended && <span className="badge accent">Recommended</span>} <strong>{a.title}</strong> <span className="badge light">{STRENGTH[a.strength]}</span> <GradeChip grade={a.evidenceGrade} />
                </div>
                <div className="question">{a.conversationQuestion}</div>
                {basedOn.length > 0 && <div className="muted">Based on: {basedOn.join("; ")}</div>}
                {a.strength === "general_introduction" && <div className="muted">Not based on a research finding. Makes no claim about Teltonika relevance.</div>}
                <Evidence ids={a.cardIds} cards={cards} />
              </div>
              <button type="button" className={isSel ? "" : "secondary"} onClick={() => onSelectAngle(a.id)} aria-pressed={isSel}>
                {isSel ? "Selected" : "Select"}
              </button>
            </div>
          );
        })}
      </section>

      {/* F. EVERYTHING ELSE */}
      <MoreResearch run={run} />

      {/* OUTREACH BAR */}
      <div className="outreach-bar">
        <span>
          Angle: <strong>{selectedAngleObj ? selectedAngleObj.title : "none selected"}</strong>
        </span>
        <span>
          To: <strong>{selectedPersonObj ? selectedPersonObj.name : "choose on the Outreach tab"}</strong>
        </span>
        <button type="button" disabled={!selectedAngleObj} onClick={onWriteEmail}>
          Write email
        </button>
      </div>
    </div>
  );
}
