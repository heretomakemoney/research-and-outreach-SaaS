"use client";

// Shared display pieces for sources and evidence. Display only.

import type { EvidenceCard, EvidenceGrade, LedgerSource } from "@/lib/types";

const GRADE_LABEL: Record<EvidenceGrade, string> = {
  api_cited: "API citation",
  quote_verified: "verified quote",
  tool_source: "tool source (wording not checked)",
};
const GRADE_HELP: Record<EvidenceGrade, string> = {
  api_cited: "The API attached a citation (with the excerpt it returned) to this claim.",
  quote_verified:
    "No API citation. The source is one the web tools returned, and the quote was found word for word in the page text the API returned.",
  tool_source:
    "The source is a page the web tools really returned or fetched (for example an official PDF), but its wording was not independently checked. Weaker evidence.",
};

export function GradeBadge({ grade }: { grade: EvidenceGrade }) {
  return (
    <span className="badge light" title={GRADE_HELP[grade]}>
      {GRADE_LABEL[grade]}
    </span>
  );
}

/** Open every collapsed <details> around an element, then scroll to it. */
export function openAndScroll(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    if (node instanceof HTMLDetailsElement) node.open = true;
    node = node.parentElement;
  }
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 1600);
}

/** [S3] chips that jump to the matching row of the source table (opening it if it is collapsed). */
export function SourceChips({ keys }: { keys: string[] }) {
  return (
    <>
      {keys.map((k) => (
        <a
          key={k}
          className="marker"
          href={`#source-${k}`}
          onClick={(e) => {
            e.preventDefault();
            openAndScroll(`source-${k}`);
          }}
        >
          [{k}]
        </a>
      ))}
    </>
  );
}

/** Shown on compact rows only when the evidence is the weakest grade. */
export function GradeChip({ grade }: { grade: EvidenceGrade | null }) {
  if (grade !== "tool_source") return null;
  return (
    <span className="badge light" title={GRADE_HELP.tool_source}>
      source named, wording unchecked
    </span>
  );
}

function readStatus(s: LedgerSource): string {
  if (s.fetched) return s.fetchKind === "pdf" ? "Read in full (PDF)" : "Read in full (page)";
  if (s.fetchError) return `Fetch failed: ${s.fetchError}`;
  return "Search result only";
}

export function SourceTable({ sources }: { sources: LedgerSource[] }) {
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

/** One evidence card: the fact, its source chips, and the exact excerpts the API returned. */
export function CardView({ card }: { card: EvidenceCard }) {
  return (
    <div className="card" id={`card-${card.id}`}>
      <div>
        <span className="badge">{card.id}</span> <span className="badge light">{card.kind.replace(/_/g, " ")}</span>{" "}
        <GradeBadge grade={card.grade} /> <span className="muted">{card.date ?? "undated"}</span>
      </div>
      <div>
        {card.claim} <SourceChips keys={card.sourceKeys} />
      </div>
      {card.evidence.length > 0 && (
        <details>
          <summary>{card.grade === "quote_verified" ? "Verified quote" : card.grade === "tool_source" ? "Claude\u2019s quote (not independently checked)" : "Excerpt(s) the API returned for this claim"}</summary>
          <ul className="plain">
            {card.evidence.map((e, i) => (
              <li key={i}>
                <span className="muted">{e.sourceKey}:</span> &ldquo;{e.excerpt}&rdquo;
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
