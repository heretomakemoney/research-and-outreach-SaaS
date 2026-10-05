// Works out the short, table-friendly facts about a research run from its full result:
// industry, client type, top signal, verdict line.
//
// This reads the OUTPUT of the research. It does not change the research prompts.
// Pure functions, unit-tested in summary.test.ts.

import type { ResearchRun, RunSummary, TopSignal } from "./domain";
import type { ResearchState, Synthesis, Trigger } from "./types";

/** The categories in docs/intelligence/01_RESEARCH_RULES.md section 1. */
export const INDUSTRIES = [
  "Industrial & Automation",
  "Mining",
  "Energy & Utilities",
  "Retail",
  "Enterprise",
  "Smart City",
  "Transportation",
  "Telco / MSP",
] as const;

const squash = (t: string) =>
  t
    .toLowerCase()
    .replace(/\band\b/g, "&")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();

/** "Smart City - a regional NSW council..." -> "Smart City". Anything not recognised -> "Other". */
export function industryCategory(text: string | null | undefined): string | null {
  if (!text || !text.trim()) return null;
  const head = squash(text.split(/\s[-–—]\s|:|\(/)[0]);
  for (const c of INDUSTRIES) {
    const key = squash(c);
    if (head === key || head.startsWith(key)) return c;
  }
  return "Other";
}

/** "End User - the council operates..." -> "End user". */
export function clientTypeLabel(text: string | null | undefined): string | null {
  if (!text || !text.trim()) return null;
  const head = text.split(/\s[-–—]\s|:|\(/)[0].toLowerCase();
  if (head.includes("distributor")) return "Distributor";
  if (head.includes("integrator")) return "Integrator";
  if (head.includes("end user") || head.includes("end-user")) return "End user";
  return "Unknown";
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;
const SIGNAL_BY_PRIORITY = { high: "strong", medium: "medium", low: "weak" } as const;

/** The primary trigger's priority (PRD FR-34); hooks only = hook; nothing = none. */
export function topSignal(synthesis: Synthesis): TopSignal {
  if (synthesis.relevance === "none") return "none";
  const sales = synthesis.triggers.filter((t) => t.kind === "sales_trigger");
  if (sales.length === 0) return synthesis.triggers.length > 0 ? "hook" : "none";
  const primary = sales.find((t) => t.rank === "primary");
  const best = primary ?? [...sales].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])[0];
  return SIGNAL_BY_PRIORITY[best.priority];
}

/** The best opportunity (the primary trigger) and the other useful ones, in display order. */
export function splitOpportunities(synthesis: Synthesis): { best: Trigger | null; others: Trigger[] } {
  const order = { primary: 0, secondary: 1, hook: 2 } as const;
  const sorted = [...synthesis.triggers].sort((a, b) => order[a.rank] - order[b.rank]);
  const best = sorted.find((t) => t.rank === "primary") ?? sorted[0] ?? null;
  return { best, others: sorted.filter((t) => t !== best) };
}

export const SIGNAL_LABEL: Record<TopSignal, string> = {
  strong: "Strong",
  medium: "Medium",
  weak: "Weak",
  hook: "Hook",
  none: "None found",
};

function verdict(signal: TopSignal, synthesis: Synthesis): string {
  const best = splitOpportunities(synthesis).best;
  if (signal === "none") return "No meaningful Teltonika angle found";
  if (signal === "hook" || signal === "weak") {
    return `No strong sales trigger found${best ? `. Best available: ${best.title}` : ""}`;
  }
  return `Strongest signal: ${SIGNAL_LABEL[signal]}${best ? `. ${best.title}` : ""}`;
}

/** Summary of a run. `synthesis` is null for a partial run, which then has no top signal. */
export function deriveSummary(research: ResearchState, synthesis: Synthesis | null): RunSummary {
  const entity = research.entity;
  const signal = synthesis ? topSignal(synthesis) : null;
  return {
    overview: entity?.summary ?? "",
    industry: industryCategory(entity?.industry),
    clientType: clientTypeLabel(entity?.clientType),
    topSignal: signal,
    verdictLine: synthesis && signal ? verdict(signal, synthesis) : "Research incomplete",
  };
}

/** Most recent first. */
export function newestFirst(runs: ResearchRun[]): ResearchRun[] {
  // Equal timestamps: the one added later is newer.
  return runs
    .map((run, i) => ({ run, i }))
    .sort((a, b) => b.run.startedAt.localeCompare(a.run.startedAt) || b.i - a.i)
    .map((x) => x.run);
}

/** PRD FR-11: the most recent Done run, else the most recent Partial run. A Failed run is never the default. */
export function pickDefaultRun(runs: ResearchRun[]): ResearchRun | null {
  const sorted = newestFirst(runs);
  return sorted.find((r) => r.status === "done") ?? sorted.find((r) => r.status === "partial") ?? null;
}

/** How the "More research" group sorts the evidence cards. Presentation only: nothing is dropped. */
export function groupFindings(research: ResearchState, synthesis: Synthesis | null) {
  const usedAsOpportunity = new Set(synthesis ? synthesis.triggers.flatMap((t) => t.factCardIds) : []);
  const tech = new Set(["technology", "vendor_partner", "competitor"]);
  const background = new Set(["history", "company_profile", "other"]);
  const cards = research.cards;
  return {
    developments: cards.filter((c) => !tech.has(c.kind) && !background.has(c.kind) && !usedAsOpportunity.has(c.id)),
    technology: cards.filter((c) => tech.has(c.kind)),
    background: cards.filter((c) => background.has(c.kind)),
  };
}

/** What could not be established: the synthesis' gaps plus the research questions left open. */
export function researchGaps(research: ResearchState, synthesis: Synthesis | null): string[] {
  const out = [...(synthesis?.gaps ?? [])];
  for (const l of research.leads) {
    if (l.status === "open" || l.status === "unresolved") out.push(l.status === "unresolved" && l.resolutionNote ? `${l.question} (${l.resolutionNote})` : l.question);
  }
  return out;
}
