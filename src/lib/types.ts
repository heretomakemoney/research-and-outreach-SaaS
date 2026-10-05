// Shared types. These are used by BOTH browser code and server code,
// so this file must not import anything server-only.

// ---------------------------------------------------------------- models

/** Models the pipeline knows a price for. The model per stage is set in config.ts. */
export const KNOWN_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5"] as const;
export type ModelId = (typeof KNOWN_MODELS)[number];

export type Effort = "low" | "medium" | "high";

export type StageName = "discover" | "followup" | "synthesize" | "email";

// ---------------------------------------------------------------- ledger (unchanged from Milestone 1)

/** One entry in the source ledger: a web page Claude's tools touched. */
export interface LedgerSource {
  key: string; // "S1", "S2", ... numbered by our code, never by Claude. Stable across stages.
  url: string;
  title: string | null;
  pageAge: string | null; // the coarse "page age" from the search result
  seenInSearch: boolean; // appeared in a web_search result
  fetched: boolean; // Claude read the page itself via web_fetch
  fetchKind: "text" | "pdf" | null;
  retrievedAt: string | null;
  fetchError: string | null; // e.g. "url_not_accessible"
  citedCount: number; // how many times answers cited this source
  citedExcerpts: string[]; // excerpts returned by the API (not written by Claude)
}

/** Counts that prove (or disprove) that the ledger is reliable. */
export interface LedgerStats {
  textBlocks: number;
  thinkingBlocks: number;
  serverToolUseBlocks: number;
  searchResultBlocks: number;
  searchResultsReturned: number;
  searchQueries: string[];
  searchErrors: string[];
  fetchResultBlocks: number;
  fetchedOk: number;
  fetchRequestedUrls: string[];
  fetchErrors: { url: string | null; code: string }[];
  citationsTotal: number;
  citationsMapped: number;
  citationsUnmapped: number;
  citedUrlNotInResults: number; // a citation pointed at a URL no tool returned
  /**
   * Search/fetch results that were consumed by code execution ("dynamic filtering")
   * instead of being read directly. When this is above 0, Claude's answer is written
   * from code output and the API attaches NO citations to it.
   */
  resultsViaCodeExecution: number;
  otherBlockTypes: Record<string, number>;
}

/**
 * One piece of the answer text and the API-returned citations attached to it.
 * `start`/`end` are character offsets into the (untrimmed) answer text, so a
 * line of the answer can be traced back to the exact excerpts that support it.
 */
export interface AnswerSegment {
  start: number;
  end: number;
  citations: { sourceKey: string; excerpt: string }[];
}

// ---------------------------------------------------------------- usage and cost

/** Token and tool usage, summed over every API request of one stage. */
export interface UsageSummary {
  model: string;
  apiRequests: number; // 1 + number of pause_turn continuations
  inputTokens: number; // uncached input
  outputTokens: number; // includes thinking tokens
  cacheWriteTokens: number;
  cacheReadTokens: number;
  searchRequests: number;
  fetchRequests: number;
}

export interface CostEstimate {
  isEstimate: true;
  pricesCheckedOn: string;
  inputUsd: number;
  outputUsd: number;
  cacheWriteUsd: number;
  cacheReadUsd: number;
  searchUsd: number;
  totalUsd: number;
}

/** Everything we record about one stage run: what was asked, what it cost, how long it took. */
export interface StageLog {
  stage: StageName;
  round: number; // follow-up round number (1, 2, ...) or 1 for other stages
  model: string;
  retriever: string | null; // which retrieval layer was used (web-tool stages only)
  usage: UsageSummary;
  cost: CostEstimate;
  durationMs: number;
  stopReasons: (string | null)[];
  continuations: number;
  rulesFiles: { name: string; chars: number }[];
  systemPromptChars: number;
  userMessageChars: number;
  effort: string;
  caps: { maxSearches?: number; maxFetches?: number; maxContinuations?: number; maxTokens: number };
  ledger: LedgerStats | null;
  /** The start of the model's answer text (with [S#] markers), kept so a parsing problem can be diagnosed from the screen. */
  answerPreview: string;
  warnings: string[];
  startedAt: string;
}

// ---------------------------------------------------------------- research state (the compact thing passed between stages)

export interface WorkflowInput {
  companyName: string;
  website: string;
  context: string; // your private knowledge about the company (unverified)
  topic: string; // optional question for this run only
}

export type EntityMatch = "Confirmed" | "Probable" | "Ambiguous" | "Not found";

export interface EntityInfo {
  match: EntityMatch;
  matchNote: string;
  name: string;
  website: string;
  tradingLegal: string;
  industry: string;
  clientType: string;
  summary: string;
  contextCheck: string;
  sourceKeys: string[]; // sources that back the identification lines
}

export type CardKind =
  | "company_profile"
  | "project"
  | "contract_tender"
  | "infrastructure"
  | "technology"
  | "vendor_partner"
  | "competitor"
  | "governance_doc"
  | "people_post"
  | "history"
  | "news"
  | "other";

export const CARD_KINDS: readonly CardKind[] = [
  "company_profile",
  "project",
  "contract_tender",
  "infrastructure",
  "technology",
  "vendor_partner",
  "competitor",
  "governance_doc",
  "people_post",
  "history",
  "news",
  "other",
];

/**
 * How a card or person is tied to its source(s), strongest first:
 *  - api_cited:      the API attached a citation (with an excerpt it returned) to the text.
 *  - quote_verified: no API citation, but the line named a source that IS in the ledger and
 *                    its quote was found word for word in the page text the API returned.
 *  - tool_source:    the line named a URL that exactly matches a source the web tools returned or
 *                    fetched (including PDFs, whose text we cannot read). Traceable to a real page,
 *                    but the wording itself is not independently checked. Visibly weaker.
 * A line that names no ledger source and has no citation is rejected.
 */
export type EvidenceGrade = "api_cited" | "quote_verified" | "tool_source";

export const GRADE_RANK: Record<EvidenceGrade, number> = { api_cited: 3, quote_verified: 2, tool_source: 1 };

/**
 * One sourced fact. Cards are FACTS only: a claim backed by at least one
 * source. The id (E1, E2, ...) and the source keys are assigned by our code;
 * the evidence excerpts are the `cited_text` the API returned.
 */
export interface EvidenceCard {
  id: string; // "E1"
  kind: CardKind;
  date: string | null; // when the fact happened / was published, as stated; null = unknown
  claim: string;
  sourceKeys: string[]; // always at least one
  evidence: { sourceKey: string; excerpt: string }[]; // excerpts for this claim (API-returned, or the verified quote)
  grade: EvidenceGrade;
  stage: "discover" | "followup";
  round: number;
}

export interface Person {
  id: string; // "P1"
  name: string;
  role: string;
  organisation: string;
  whyRelevant: string;
  sourceKeys: string[]; // always at least one
  evidence: { sourceKey: string; excerpt: string }[];
  grade: EvidenceGrade;
  stage: "discover" | "followup";
}

export type LeadPriority = "high" | "medium" | "low";
export type LeadStatus = "open" | "resolved" | "unresolved" | "dead_end";

export interface Lead {
  id: string; // "L1"
  priority: LeadPriority;
  question: string;
  why: string;
  status: LeadStatus;
  resolutionNote: string;
  openedInRound: number; // 0 = discovery
}

export type CoverageStatus = "found" | "partial" | "not_found" | "not_applicable";

export interface CoverageItem {
  topic: string;
  status: CoverageStatus;
  note: string;
  round: number;
}

export type RelevanceLevel = "strong" | "moderate" | "weak" | "none";

export interface PreliminaryRelevance {
  level: RelevanceLevel;
  note: string;
}

export interface ResearchState {
  input: WorkflowInput;
  entity: EntityInfo | null;
  cards: EvidenceCard[];
  people: Person[];
  leads: Lead[];
  coverage: CoverageItem[];
  relevance: PreliminaryRelevance | null;
  sources: LedgerSource[];
  followupRounds: number; // how many follow-up rounds have run
  stages: StageLog[]; // research-stage logs (discover, followups)
}

// ---------------------------------------------------------------- gate (what to do next)

export type NextStep =
  | { action: "stop_entity"; reason: string }
  | { action: "followup"; leadIds: string[]; focus: "leads" | "people" | "hook"; reason: string }
  | { action: "synthesize"; reason: string };

// ---------------------------------------------------------------- synthesis

export type TriggerRank = "primary" | "secondary" | "hook";
export type TriggerKind = "sales_trigger" | "conversation_hook";
export type Recency = "under_3_months" | "3_to_6_months" | "6_to_12_months" | "over_12_months" | "unknown";
export type AngleStrength = "strong" | "medium" | "weak" | "general_introduction";

export interface Trigger {
  id: string; // "T1"
  rank: TriggerRank;
  kind: TriggerKind;
  priority: LeadPriority;
  title: string;
  recency: Recency;
  scale: string; // numbers of sites / vehicles / value etc. or ""
  fact: string; // FACT: what the evidence says
  factCardIds: string[]; // evidence cards supporting the FACT
  evidenceGrade: EvidenceGrade; // the WEAKEST grade among those cards (worked out by code, not by the model)
  inference: string; // INFERENCE: reasoning, clearly separate
  possibleOpportunity: string; // POSSIBLE OPPORTUNITY (a question to explore, not a pitch)
  whyNow: string;
}

export interface RankedPerson {
  personId: string; // refers to a Person in the research state
  rank: number;
  whyRelevant: string; // synthesis view; the evidence stays on the Person
}

export interface Angle {
  id: string; // "A1"
  title: string;
  strength: AngleStrength;
  triggerIds: string[];
  cardIds: string[]; // the evidence this angle rests on
  evidenceGrade: EvidenceGrade | null; // weakest grade among those cards; null when the angle cites none
  conversationQuestion: string; // the simple question the email will ask
  whyItWorks: string;
  recommended: boolean;
}

export interface Synthesis {
  relevance: RelevanceLevel;
  summary: string;
  noMeaningfulAngleNote: string; // "" unless the honest answer is "no meaningful Teltonika angle found"
  triggers: Trigger[];
  people: RankedPerson[];
  angles: Angle[];
  gaps: string[];
  droppedReferences: string[]; // IDs the model referenced that do not exist (removed by code)
}

// ---------------------------------------------------------------- email

export type ContactChoice =
  | { source: "researched"; personId: string; name: string; role: string }
  | { source: "manual"; name: string; role: string };

export type RelationshipKind = "new" | "existing";

export interface RelationshipInput {
  kind: RelationshipKind;
  note: string; // e.g. "met at the CCW expo, spoke about RUTX50 last year"
}

export interface EmailDraft {
  subject: string;
  body: string;
  originalSubject: string; // as generated; used to detect edits
  originalBody: string;
  usedCardIds: string[]; // evidence the email says it used (validated by code)
  angleId: string;
  contact: ContactChoice;
  relationship: RelationshipInput;
  generatedAt: string;
  generation: number; // 1 for the first draft, 2 after one regeneration, ...
}

// ---------------------------------------------------------------- the one current workflow (localStorage)

export interface Workflow {
  version: 2;
  id: string;
  createdAt: string;
  updatedAt: string;
  state: ResearchState;
  next: NextStep | null;
  gateLog: { afterStage: string; action: NextStep["action"]; reason: string; at: string }[]; // why each step ran or did not
  synthesis: Synthesis | null;
  synthesisLog: StageLog | null;
  selectedAngleId: string | null;
  contact: ContactChoice | null;
  relationship: RelationshipInput;
  email: EmailDraft | null;
  emailLogs: StageLog[]; // every email generation, so total cost stays honest
}

// ---------------------------------------------------------------- API shapes

export interface ApiError {
  ok: false;
  error: string;
}

export interface ResearchStageResponse {
  ok: true;
  state: ResearchState;
  next: NextStep;
  log: StageLog;
}

export interface SynthesizeResponse {
  ok: true;
  synthesis: Synthesis;
  log: StageLog;
}

export interface EmailResponse {
  ok: true;
  draft: EmailDraft;
  log: StageLog;
}
