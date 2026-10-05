// Runs research and writes emails FROM THE BROWSER, saving through the repository after every step.
//
// The live research stays exactly as it was (one request per stage; the open tab drives them). Nothing
// here changes the prompts or the pipeline. A run is saved after each stage, so finished stages are kept.
//
// Not built yet (after database persistence): resuming an interrupted run. If the tab is closed mid-run,
// the run is closed as Partial or Failed when the app next opens, and research is simply started again.

import type { OutreachEmail, ResearchRun } from "../domain";
import type { Repository } from "../repo/types";
import { deriveSummary } from "../summary";
import type {
  ApiError,
  ContactChoice,
  EmailResponse,
  RelationshipInput,
  ResearchStageResponse,
  SynthesizeResponse,
} from "../types";

export type Call = (path: string, body: unknown) => Promise<unknown>;

/** The real network call. Tests pass a different one. */
export const httpCall: Call = async (path, body) => {
  let response: Response;
  try {
    response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  const data = (await response.json().catch(() => null)) as { ok?: boolean } | ApiError | null;
  if (!response.ok || !data || data.ok !== true) {
    throw new Error(
      data && data.ok === false && "error" in data
        ? data.error
        : `The server did not return a usable answer (HTTP ${response.status}). If this was a long stage it may have hit the time limit.`,
    );
  }
  return data;
};

export type PendingStage = "discover" | "followup" | "synthesize";

export const STAGE_LABEL: Record<PendingStage, string> = {
  discover: "Researching the company",
  followup: "Following up on open questions",
  synthesize: "Evaluating opportunities, people and angles",
};

export function pendingStage(run: ResearchRun): PendingStage | null {
  if (run.research.stages.length === 0) return "discover";
  if (!run.next) return null;
  if (run.next.action === "followup") return "followup";
  if (run.next.action === "synthesize" && !run.synthesis) return "synthesize";
  return null;
}

export interface ActiveResearch {
  runId: string;
  companyId: string;
  stage: PendingStage;
  stageLabel: string;
  startedAt: number;
  stageStartedAt: number;
}

export class ResearchManager {
  private active = new Map<string, ActiveResearch>();
  private listeners = new Set<() => void>();
  private cachedMode: Promise<ResearchRun["aiMode"]> | null = null;

  private repo: Repository;
  private call: Call;
  private getMode: () => Promise<ResearchRun["aiMode"]>;

  constructor(repo: Repository, call: Call, getMode: () => Promise<ResearchRun["aiMode"]> = async () => "unknown") {
    this.repo = repo;
    this.call = call;
    this.getMode = getMode;
  }

  subscribe(l: () => void) {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }
  private notify() {
    for (const l of [...this.listeners]) l();
  }
  isActive(companyId: string) {
    return this.active.has(companyId);
  }
  get(companyId: string) {
    return this.active.get(companyId) ?? null;
  }
  activeRunIds() {
    return [...this.active.values()].map((a) => a.runId);
  }
  mode() {
    if (!this.cachedMode) this.cachedMode = this.getMode().catch(() => "unknown" as const);
    return this.cachedMode;
  }

  /** Create the run and start driving it. Returns at once; `finished` resolves when the run ends. */
  async start(companyId: string, topic: string): Promise<{ runId: string; finished: Promise<ResearchRun> }> {
    if (this.active.has(companyId)) throw new Error("Research is already running for this company.");
    const run = await this.repo.createRun(companyId, { topic, aiMode: await this.mode() });
    const info: ActiveResearch = { runId: run.id, companyId, stage: "discover", stageLabel: STAGE_LABEL.discover, startedAt: Date.now(), stageStartedAt: Date.now() };
    this.active.set(companyId, info);
    this.notify();
    const finished = this.drive(run, info).finally(() => {
      this.active.delete(companyId);
      this.notify();
    });
    return { runId: run.id, finished };
  }

  private async drive(start: ResearchRun, info: ActiveResearch): Promise<ResearchRun> {
    let run = start;
    try {
      for (;;) {
        const stage = pendingStage(run);
        if (!stage) break;
        info.stage = stage;
        info.stageLabel = STAGE_LABEL[stage];
        info.stageStartedAt = Date.now();
        this.notify();
        run = await this.runStage(run, stage);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const hasResults = run.research.cards.length > 0 || !!run.research.entity;
      return this.finish(run, hasResults ? "partial" : "failed", message);
    }
    if (run.next?.action === "stop_entity") return this.finish(run, "failed", run.next.reason);
    if (run.synthesis) return this.finish(run, "done", null);
    return this.finish(run, "partial", "The research did not reach the evaluation step.");
  }

  private async runStage(run: ResearchRun, stage: PendingStage): Promise<ResearchRun> {
    const at = new Date().toISOString();
    if (stage === "synthesize") {
      const r = (await this.call("/api/research/synthesize", { state: run.research })) as SynthesizeResponse;
      return this.repo.updateRun(run.id, { synthesis: r.synthesis, synthesisLog: r.log });
    }
    const r =
      stage === "discover"
        ? ((await this.call("/api/research/discover", { input: run.research.input })) as ResearchStageResponse)
        : ((await this.call("/api/research/followup", { state: run.research })) as ResearchStageResponse);
    return this.repo.updateRun(run.id, {
      research: r.state,
      next: r.next,
      gateLog: [...run.gateLog, { afterStage: stage === "discover" ? "discover" : `followup ${r.log.round}`, action: r.next.action, reason: r.next.reason, at }],
    });
  }

  private async finish(run: ResearchRun, status: "done" | "partial" | "failed", reason: string | null): Promise<ResearchRun> {
    const done = await this.repo.updateRun(run.id, {
      status,
      statusReason: reason,
      finishedAt: new Date().toISOString(),
      summary: deriveSummary(run.research, run.synthesis),
    });
    if (status === "done") {
      const recommended = done.synthesis?.angles.find((a) => a.recommended) ?? done.synthesis?.angles[0] ?? null;
      await this.repo.setSelection(done.companyId, { runId: done.id, angleKey: recommended?.id ?? null, personKey: null });
    }
    return done;
  }
}

// ---------------------------------------------------------------------------------------------- email

export interface EmailRequest {
  companyId: string;
  angleKey: string;
  contact: ContactChoice;
  relationship: RelationshipInput;
  regenerate: boolean;
}

/** Write (or rewrite) the company's one current email from its default research. */
export async function writeEmail(repo: Repository, call: Call, req: EmailRequest): Promise<OutreachEmail> {
  const run = await repo.getDefaultRun(req.companyId);
  if (!run || !run.synthesis) throw new Error("Research this company first.");
  const angle = run.synthesis.angles.find((a) => a.id === req.angleKey);
  if (!angle) throw new Error("Choose a conversation angle first.");
  const existing = await repo.getEmail(req.companyId);
  const generation = (existing?.generation ?? 0) + 1;

  const response = (await call("/api/research/email", {
    state: run.research,
    synthesis: run.synthesis,
    angleId: req.angleKey,
    contact: req.contact,
    relationship: req.relationship,
    previousBody: req.regenerate && existing ? existing.body : null,
    generation,
  })) as EmailResponse;

  const urls = (keys: string[]) => keys.map((k) => run.research.sources.find((s) => s.key === k)?.url ?? "").filter(Boolean);
  const now = new Date().toISOString();
  const draft = response.draft;
  const saved = await repo.saveEmail({
    id: existing?.id ?? crypto.randomUUID(),
    companyId: req.companyId,
    runId: run.id,
    angleKey: angle.id,
    angleTitle: angle.title,
    angleStrength: angle.strength,
    contact: draft.contact,
    relationship: draft.relationship,
    subject: draft.subject,
    body: draft.body,
    generatedSubject: draft.originalSubject,
    generatedBody: draft.originalBody,
    usedCardIds: draft.usedCardIds,
    basedOn: draft.usedCardIds
      .map((id) => run.research.cards.find((c) => c.id === id))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .map((c) => ({ id: c.id, claim: c.claim, date: c.date, grade: c.grade, sourceUrls: urls(c.sourceKeys) })),
    limitation: angle.strength === "general_introduction" ? "fallback_general" : angle.strength === "weak" ? "weak_hook" : "none",
    logs: [...(existing?.logs ?? []), response.log],
    generation,
    generatedAt: now,
    editedAt: null,
    updatedAt: now,
  });

  // Remember the choices on the company (and keep a typed-in contact for next time).
  if (draft.contact.source === "manual") {
    const m = await repo.addManualContact(req.companyId, { name: draft.contact.name, role: draft.contact.role });
    await repo.setSelection(req.companyId, { angleKey: angle.id, manualContactId: m.id });
  } else {
    await repo.setSelection(req.companyId, { angleKey: angle.id, personKey: draft.contact.personId });
  }
  return saved;
}
