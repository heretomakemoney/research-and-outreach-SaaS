// The compact RESEARCH STATE passed between stages.
//
// Between stages Claude never sees raw pages, search results, thinking or its
// own earlier prose. It sees a small, structured summary: evidence cards with
// source IDs, people, open/closed leads, coverage, and a short source table.
//
// The browser keeps this state (localStorage) and sends it back to the server
// for each stage, so the server has no memory. That means everything coming
// IN from the browser is validated and size-capped here (sanitizeState).
//
// Pure functions, no server-only imports: unit-tested in state.test.ts.

import type { ParsedResearch } from "./parse";
import type {
  CardKind,
  CoverageItem,
  CoverageStatus,
  EntityInfo,
  EntityMatch,
  EvidenceCard,
  Lead,
  LeadPriority,
  LeadStatus,
  LedgerSource,
  Person,
  RelevanceLevel,
  ResearchState,
  StageLog,
  WorkflowInput,
} from "./types";
import { CARD_KINDS } from "./types.ts";

export interface StateLimits {
  maxCards: number;
  maxPeople: number;
  maxLeads: number;
  maxCoverage: number;
  maxSources: number;
  maxClaimChars: number;
  maxExcerptChars: number;
  maxShortChars: number;
}

export function emptyState(input: WorkflowInput): ResearchState {
  return {
    input,
    entity: null,
    cards: [],
    people: [],
    leads: [],
    coverage: [],
    relevance: null,
    sources: [],
    followupRounds: 0,
    stages: [],
  };
}

// ------------------------------------------------------------------ merging a stage's parsed output into the state

export interface MergeOptions {
  stage: "discover" | "followup";
  round: number; // 0 for discovery, 1.. for follow-up rounds
  /** All sources after this stage (earlier ones keep their keys). */
  sources: LedgerSource[];
  /** Leads this follow-up round was asked to look into. */
  focusLeadIds: string[];
  limits: StateLimits;
}

export interface MergeResult {
  state: ResearchState;
  warnings: string[];
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function nextNumber(ids: string[], prefix: string): number {
  let max = 0;
  for (const id of ids) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

export function mergeResearch(prior: ResearchState, parsed: ParsedResearch, opts: MergeOptions): MergeResult {
  const warnings: string[] = [];
  const knownSourceKeys = new Set(opts.sources.map((s) => s.key));
  const stageLabel = opts.stage;
  const round = Math.max(1, opts.round);

  // Entity: only discovery sets it.
  let entity = prior.entity;
  if (opts.stage === "discover") {
    if (parsed.entity) {
      const e = parsed.entity;
      entity = {
        match: e.match,
        matchNote: e.matchNote,
        name: e.name,
        website: e.website,
        tradingLegal: e.tradingLegal,
        industry: e.industry,
        clientType: e.clientType,
        summary: e.summary,
        contextCheck: e.contextCheck,
        sourceKeys: e.sourceKeys.filter((k) => knownSourceKeys.has(k)),
      };
    } else {
      warnings.push("The identification block (ENTITY_MATCH ...) was missing or unreadable in the discovery answer.");
    }
  }

  // Cards
  const cards = [...prior.cards];
  let cardNo = nextNumber(cards.map((c) => c.id), "E");
  const seenClaims = new Set(cards.map((c) => normalise(c.claim)));
  let droppedCards = 0;
  for (const c of parsed.cards) {
    const keys = c.sourceKeys.filter((k) => knownSourceKeys.has(k));
    if (keys.length === 0) {
      warnings.push(`A card was dropped: none of its source keys exist in the ledger (${c.claim.slice(0, 60)}...).`);
      continue;
    }
    const norm = normalise(c.claim);
    if (seenClaims.has(norm)) continue;
    if (cards.length >= opts.limits.maxCards) {
      droppedCards++;
      continue;
    }
    seenClaims.add(norm);
    cards.push({
      id: `E${cardNo++}`,
      kind: c.kind,
      date: c.date,
      claim: c.claim.slice(0, opts.limits.maxClaimChars),
      sourceKeys: keys,
      evidence: c.evidence
        .filter((e) => knownSourceKeys.has(e.sourceKey))
        .map((e) => ({ sourceKey: e.sourceKey, excerpt: e.excerpt.slice(0, opts.limits.maxExcerptChars) })),
      grade: c.grade,
      stage: stageLabel,
      round: opts.round,
    });
  }
  if (droppedCards > 0) warnings.push(`${droppedCards} card(s) were not kept because the state is limited to ${opts.limits.maxCards} cards.`);
  for (const r of parsed.rejected) warnings.push(`Rejected a line: ${r.reason}.`);

  // People
  const people = [...prior.people];
  let personNo = nextNumber(people.map((p) => p.id), "P");
  for (const p of parsed.people) {
    const keys = p.sourceKeys.filter((k) => knownSourceKeys.has(k));
    if (keys.length === 0) continue;
    const dupe = people.find((x) => normalise(x.name) === normalise(p.name));
    if (dupe) continue;
    if (people.length >= opts.limits.maxPeople) break;
    people.push({
      id: `P${personNo++}`,
      name: p.name.slice(0, opts.limits.maxShortChars),
      role: p.role.slice(0, opts.limits.maxShortChars),
      organisation: p.organisation.slice(0, opts.limits.maxShortChars),
      whyRelevant: p.whyRelevant.slice(0, opts.limits.maxClaimChars),
      sourceKeys: keys,
      evidence: p.evidence
        .filter((e) => knownSourceKeys.has(e.sourceKey))
        .map((e) => ({ sourceKey: e.sourceKey, excerpt: e.excerpt.slice(0, opts.limits.maxExcerptChars) })),
      grade: p.grade,
      stage: stageLabel,
    });
  }

  // Leads: update the ones this round was asked about, then add new ones.
  let leads: Lead[] = prior.leads.map((l) => ({ ...l }));
  for (const r of parsed.leadResults) {
    const lead = leads.find((l) => l.id === r.leadId);
    if (!lead) {
      warnings.push(`A lead result named ${r.leadId}, which does not exist; ignored.`);
      continue;
    }
    lead.status = r.status;
    lead.resolutionNote = r.note;
  }
  for (const id of opts.focusLeadIds) {
    const lead = leads.find((l) => l.id === id);
    if (lead && lead.status === "open") {
      // The model was asked about this lead but did not report on it. Close it so the gate cannot loop on it.
      lead.status = "unresolved";
      lead.resolutionNote = "No result was reported for this lead.";
    }
  }
  let leadNo = nextNumber(leads.map((l) => l.id), "L");
  const seenQuestions = new Set(leads.map((l) => normalise(l.question)));
  for (const l of parsed.leads) {
    if (leads.length >= opts.limits.maxLeads) break;
    const norm = normalise(l.question);
    if (seenQuestions.has(norm)) continue;
    seenQuestions.add(norm);
    leads.push({
      id: `L${leadNo++}`,
      priority: l.priority,
      question: l.question.slice(0, opts.limits.maxClaimChars),
      why: l.why.slice(0, opts.limits.maxClaimChars),
      status: "open",
      resolutionNote: "",
      openedInRound: opts.round,
    });
  }
  leads = leads.slice(0, opts.limits.maxLeads);

  // Coverage: the latest report per topic wins.
  const coverage: CoverageItem[] = [...prior.coverage];
  for (const c of parsed.coverage) {
    const idx = coverage.findIndex((x) => normalise(x.topic) === normalise(c.topic));
    const item: CoverageItem = {
      topic: c.topic.slice(0, opts.limits.maxShortChars),
      status: c.status,
      note: c.note.slice(0, opts.limits.maxShortChars),
      round: opts.round,
    };
    if (idx >= 0) coverage[idx] = item;
    else if (coverage.length < opts.limits.maxCoverage) coverage.push(item);
  }

  return {
    state: {
      ...prior,
      entity,
      cards,
      people,
      leads,
      coverage,
      relevance: parsed.relevance ?? prior.relevance,
      sources: opts.sources,
      followupRounds: opts.stage === "followup" ? Math.max(prior.followupRounds, opts.round) : prior.followupRounds,
    },
    warnings,
  };
}

export function totalSearches(state: ResearchState): number {
  return state.stages.reduce((n, s) => n + (s.usage?.searchRequests ?? 0), 0);
}

export function totalCostUsd(state: ResearchState): number {
  return state.stages.reduce((n, s) => n + (s.cost?.totalUsd ?? 0), 0);
}

// ------------------------------------------------------------------ what the next model sees

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The compact text version of the state that goes into the follow-up,
 * synthesis and email prompts. Facts are DATA: the prompts tell the model so.
 */
export function serializeStateForModel(state: ResearchState, opts: { includeSources: boolean }): string {
  const out: string[] = [];
  const e = state.entity;
  if (e) {
    out.push("COMPANY IDENTIFICATION");
    out.push(`match: ${e.match} (${oneLine(e.matchNote)})`);
    out.push(`name: ${oneLine(e.name)}`);
    out.push(`website: ${oneLine(e.website)}`);
    out.push(`trading/legal entity: ${oneLine(e.tradingLegal)}`);
    out.push(`industry: ${oneLine(e.industry)}`);
    out.push(`client type: ${oneLine(e.clientType)}`);
    out.push(`summary: ${oneLine(e.summary)}`);
    out.push(`context check: ${oneLine(e.contextCheck)}`);
    out.push("");
  }

  out.push(`EVIDENCE CARDS (${state.cards.length}). Each is a sourced fact: id | kind | date | claim | source ids`);
  for (const c of state.cards) {
    out.push(`${c.id} | ${c.kind} | ${c.date ?? "undated"} | ${oneLine(c.claim)} | ${c.sourceKeys.join(",")}`);
  }
  out.push("");

  out.push(`PEOPLE FOUND (${state.people.length}). id | name | role | organisation | why relevant | source ids`);
  for (const p of state.people) {
    out.push(
      `${p.id} | ${oneLine(p.name)} | ${oneLine(p.role)} | ${oneLine(p.organisation)} | ${oneLine(p.whyRelevant)} | ${p.sourceKeys.join(",")}`,
    );
  }
  out.push("");

  out.push("LEADS. id | priority | status | question | why | resolution");
  for (const l of state.leads) {
    out.push(`${l.id} | ${l.priority} | ${l.status} | ${oneLine(l.question)} | ${oneLine(l.why)} | ${oneLine(l.resolutionNote)}`);
  }
  out.push("");

  out.push("RESEARCH COVERAGE. topic | status | note");
  for (const c of state.coverage) out.push(`${c.topic} | ${c.status} | ${oneLine(c.note)}`);
  out.push("");

  if (state.relevance) {
    out.push(`PRELIMINARY RELEVANCE (research stage's view, not final): ${state.relevance.level} - ${oneLine(state.relevance.note)}`);
    out.push("");
  }

  if (opts.includeSources) {
    out.push("SOURCES. id | site | title | page age | how it was read");
    for (const s of state.sources) {
      const how = s.fetched ? "read in full" : "search result only";
      out.push(`${s.key} | ${domainOf(s.url)} | ${oneLine(s.title ?? "(no title)")} | ${s.pageAge ?? "unknown"} | ${how}`);
    }
  }
  return out.join("\n");
}

// ------------------------------------------------------------------ validating state that comes back from the browser

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function arr(v: unknown, max: number): unknown[] {
  return Array.isArray(v) ? v.slice(0, max) : [];
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function strList(v: unknown, maxItems: number, maxChars: number): string[] {
  return arr(v, maxItems).filter((x): x is string => typeof x === "string").map((x) => x.slice(0, maxChars));
}

function evidenceList(v: unknown, limits: StateLimits) {
  return arr(v, 6)
    .filter(isObject)
    .map((e) => ({ sourceKey: str(e.sourceKey, 12), excerpt: str(e.excerpt, limits.maxExcerptChars) }))
    .filter((e) => /^S\d+$/.test(e.sourceKey));
}

export function sanitizeInput(v: unknown): WorkflowInput {
  const o = isObject(v) ? v : {};
  return {
    companyName: str(o.companyName, 200).trim(),
    website: str(o.website, 300).trim(),
    context: str(o.context, 4000).trim(),
    topic: str(o.topic, 1000).trim(),
  };
}

function sanitizeLog(v: unknown): StageLog | null {
  if (!isObject(v) || !isObject(v.usage) || !isObject(v.cost)) return null;
  // Logs are only used for totals on the server. Keep the object, but make the numbers we read safe.
  const log = v as unknown as StageLog;
  log.usage.searchRequests = num(log.usage.searchRequests);
  log.cost.totalUsd = num(log.cost.totalUsd);
  return log;
}

/** Turn whatever the browser sent into a ResearchState we can trust the SHAPE of. Throws if it is hopeless. */
export function sanitizeState(v: unknown, limits: StateLimits): ResearchState {
  if (!isObject(v)) throw new Error("The research state is missing or not an object.");
  const input = sanitizeInput(v.input);
  if (!input.companyName) throw new Error("The research state has no company name.");

  const sources: LedgerSource[] = arr(v.sources, limits.maxSources)
    .filter(isObject)
    .map((s) => ({
      key: str(s.key, 12),
      url: str(s.url, 600),
      title: typeof s.title === "string" ? s.title.slice(0, 300) : null,
      pageAge: typeof s.pageAge === "string" ? s.pageAge.slice(0, 60) : null,
      seenInSearch: s.seenInSearch === true,
      fetched: s.fetched === true,
      fetchKind: s.fetchKind === "pdf" ? ("pdf" as const) : s.fetchKind === "text" ? ("text" as const) : null,
      retrievedAt: typeof s.retrievedAt === "string" ? s.retrievedAt.slice(0, 40) : null,
      fetchError: typeof s.fetchError === "string" ? s.fetchError.slice(0, 80) : null,
      citedCount: num(s.citedCount),
      citedExcerpts: strList(s.citedExcerpts, 5, limits.maxExcerptChars),
    }))
    .filter((s) => /^S\d+$/.test(s.key) && /^https?:\/\//i.test(s.url));
  const sourceKeys = new Set(sources.map((s) => s.key));

  const cards: EvidenceCard[] = arr(v.cards, limits.maxCards)
    .filter(isObject)
    .map((c) => ({
      id: str(c.id, 12),
      kind: oneOf<CardKind>(c.kind, CARD_KINDS, "other"),
      date: typeof c.date === "string" && c.date ? c.date.slice(0, 40) : null,
      claim: str(c.claim, limits.maxClaimChars),
      sourceKeys: strList(c.sourceKeys, 8, 12).filter((k) => sourceKeys.has(k)),
      evidence: evidenceList(c.evidence, limits).filter((e) => sourceKeys.has(e.sourceKey)),
      grade: c.grade === "quote_verified" ? ("quote_verified" as const) : ("api_cited" as const),
      stage: c.stage === "followup" ? ("followup" as const) : ("discover" as const),
      round: Math.max(0, Math.floor(num(c.round))),
    }))
    .filter((c) => /^E\d+$/.test(c.id) && c.claim && c.sourceKeys.length > 0);

  const people: Person[] = arr(v.people, limits.maxPeople)
    .filter(isObject)
    .map((p) => ({
      id: str(p.id, 12),
      name: str(p.name, limits.maxShortChars),
      role: str(p.role, limits.maxShortChars),
      organisation: str(p.organisation, limits.maxShortChars),
      whyRelevant: str(p.whyRelevant, limits.maxClaimChars),
      sourceKeys: strList(p.sourceKeys, 8, 12).filter((k) => sourceKeys.has(k)),
      evidence: evidenceList(p.evidence, limits).filter((e) => sourceKeys.has(e.sourceKey)),
      grade: p.grade === "quote_verified" ? ("quote_verified" as const) : ("api_cited" as const),
      stage: p.stage === "followup" ? ("followup" as const) : ("discover" as const),
    }))
    .filter((p) => /^P\d+$/.test(p.id) && p.name && p.sourceKeys.length > 0);

  const leads: Lead[] = arr(v.leads, limits.maxLeads)
    .filter(isObject)
    .map((l) => ({
      id: str(l.id, 12),
      priority: oneOf<LeadPriority>(l.priority, ["high", "medium", "low"], "medium"),
      question: str(l.question, limits.maxClaimChars),
      why: str(l.why, limits.maxClaimChars),
      status: oneOf<LeadStatus>(l.status, ["open", "resolved", "unresolved", "dead_end"], "open"),
      resolutionNote: str(l.resolutionNote, limits.maxClaimChars),
      openedInRound: Math.max(0, Math.floor(num(l.openedInRound))),
    }))
    .filter((l) => /^L\d+$/.test(l.id) && l.question);

  const coverage: CoverageItem[] = arr(v.coverage, limits.maxCoverage)
    .filter(isObject)
    .map((c) => ({
      topic: str(c.topic, limits.maxShortChars),
      status: oneOf<CoverageStatus>(c.status, ["found", "partial", "not_found", "not_applicable"], "partial"),
      note: str(c.note, limits.maxShortChars),
      round: Math.max(0, Math.floor(num(c.round))),
    }))
    .filter((c) => c.topic);

  let entity: EntityInfo | null = null;
  if (isObject(v.entity)) {
    const e = v.entity;
    entity = {
      match: oneOf<EntityMatch>(e.match, ["Confirmed", "Probable", "Ambiguous", "Not found"], "Not found"),
      matchNote: str(e.matchNote, limits.maxShortChars),
      name: str(e.name, limits.maxShortChars),
      website: str(e.website, limits.maxShortChars),
      tradingLegal: str(e.tradingLegal, limits.maxClaimChars),
      industry: str(e.industry, limits.maxShortChars),
      clientType: str(e.clientType, limits.maxShortChars),
      summary: str(e.summary, limits.maxClaimChars * 2),
      contextCheck: str(e.contextCheck, limits.maxClaimChars),
      sourceKeys: strList(e.sourceKeys, 12, 12).filter((k) => sourceKeys.has(k)),
    };
  }

  let relevance: ResearchState["relevance"] = null;
  if (isObject(v.relevance)) {
    relevance = {
      level: oneOf<RelevanceLevel>(v.relevance.level, ["strong", "moderate", "weak", "none"], "weak"),
      note: str(v.relevance.note, limits.maxShortChars),
    };
  }

  const stages = arr(v.stages, 12).map(sanitizeLog).filter((l): l is StageLog => l !== null);

  return {
    input,
    entity,
    cards,
    people,
    leads,
    coverage,
    relevance,
    sources,
    followupRounds: Math.min(5, Math.max(0, Math.floor(num(v.followupRounds)))),
    stages,
  };
}
