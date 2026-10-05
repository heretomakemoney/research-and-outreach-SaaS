// The application's own records: companies, research runs, contacts and the one current email.
//
// These are what the UI works with. They do not say WHERE data lives: that is the repository's job
// (src/lib/repo). The shapes match docs/DATA_MODEL.md "Phase 2 implementation".
//
// Shared by browser and server code: no server-only imports.

import type {
  ContactChoice,
  EvidenceGrade,
  NextStep,
  RelationshipInput,
  ResearchState,
  StageLog,
  Synthesis,
} from "./types";

export type RunStatus = "researching" | "done" | "partial" | "failed";
export type AccountStatus = "not_researched" | RunStatus;
export type TopSignal = "strong" | "medium" | "weak" | "hook" | "none";

export interface Company {
  id: string;
  name: string;
  website: string;
  /** Persistent knowledge we want remembered about this account. Reused by every run and email. */
  context: string;
  contextUpdatedAt: string;
  /** The current selection, made on the Research tab and used by the Outreach tab. */
  selectedRunId: string | null;
  selectedAngleKey: string | null; // "A1"
  selectedPersonKey: string | null; // "P1"
  selectedManualContactId: string | null;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
}

/** The few fields the Accounts table (and the company header) need from a run. */
export interface RunSummary {
  overview: string;
  industry: string | null; // one of the 01 §1 categories, or "Other"
  clientType: string | null; // Distributor / Integrator / End user / Unknown
  topSignal: TopSignal | null; // null when there is no synthesis yet (a partial run)
  verdictLine: string;
}

export interface ResearchRun {
  id: string;
  companyId: string;
  status: RunStatus;
  statusReason: string | null;
  // Snapshots of what the run was given. Editing the company later never changes these.
  companyNameSnapshot: string;
  websiteSnapshot: string;
  contextSnapshot: string;
  /** Per-run instruction only. Not remembered by the company. */
  topic: string;
  startedAt: string;
  finishedAt: string | null;
  aiMode: "live" | "mock" | "unknown";
  summary: RunSummary | null;
  // The whole research result, stored in full even though the normal screen shows little of it.
  research: ResearchState;
  next: NextStep | null;
  gateLog: { afterStage: string; action: NextStep["action"]; reason: string; at: string }[];
  synthesis: Synthesis | null;
  synthesisLog: StageLog | null;
}

export interface ManualContact {
  id: string;
  companyId: string;
  name: string;
  role: string;
  createdAt: string;
}

export interface EmailFact {
  id: string; // "E4"
  claim: string;
  date: string | null;
  grade: EvidenceGrade;
  sourceUrls: string[];
}

/** The company's one current email. Snapshots, so newer research never rewrites it. */
export interface OutreachEmail {
  id: string;
  companyId: string;
  runId: string;
  angleKey: string;
  angleTitle: string;
  angleStrength: string;
  contact: ContactChoice;
  relationship: RelationshipInput;
  subject: string;
  body: string;
  generatedSubject: string;
  generatedBody: string;
  usedCardIds: string[];
  basedOn: EmailFact[];
  limitation: "none" | "weak_hook" | "fallback_general";
  logs: StageLog[]; // every generation, so cost stays honest
  generation: number;
  generatedAt: string;
  editedAt: string | null;
  updatedAt: string;
}

/** One row of the Accounts table, worked out from the company and its runs. */
export interface AccountRow {
  id: string;
  name: string;
  website: string;
  status: AccountStatus;
  statusDetail: string; // short secondary text ("Started 2 min ago", "Company unclear")
  hasEarlierResearch: boolean;
  industry: string | null;
  clientType: string | null;
  topSignal: TopSignal | null;
  lastResearchedAt: string | null;
  lastActivityAt: string;
}
