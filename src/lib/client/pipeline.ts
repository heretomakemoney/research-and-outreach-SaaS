// Browser-side pipeline driver.
//
// The browser calls the server one stage at a time (each stage is its own
// request, so each stays well inside the hosting time limit) and saves the
// workflow after EVERY stage. If something fails halfway, the finished stages
// are kept and "Continue" resumes at the stage that failed.
//
// Browser code only. It never sees the API key.

import type {
  ApiError,
  ContactChoice,
  EmailResponse,
  RelationshipInput,
  ResearchStageResponse,
  SynthesizeResponse,
  Workflow,
  WorkflowInput,
} from "../types";
import { emptyState } from "../state";

async function post<T extends { ok: true }>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  const data = (await response.json().catch(() => null)) as T | ApiError | null;
  if (!response.ok || !data || data.ok !== true) {
    // A timeout on the hosting platform returns HTML or plain text, not our JSON.
    throw new Error(
      data && data.ok === false
        ? data.error
        : `The server did not return a usable answer (HTTP ${response.status}). If this was a long stage it may have hit the time limit.`,
    );
  }
  return data;
}

export function newWorkflow(input: WorkflowInput): Workflow {
  const now = new Date().toISOString();
  return {
    version: 2,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    state: emptyState(input),
    next: null,
    gateLog: [],
    synthesis: null,
    synthesisLog: null,
    selectedAngleId: null,
    contact: null,
    relationship: { kind: "new", note: "" },
    email: null,
    emailLogs: [],
  };
}

/** What stage runs next for this workflow? null = the research part is finished (or needs the human). */
export type PendingStage = "discover" | "followup" | "synthesize";

export function pendingStage(w: Workflow): PendingStage | null {
  if (w.state.stages.length === 0) return "discover";
  if (!w.next) return null;
  if (w.next.action === "followup") return "followup";
  if (w.next.action === "synthesize" && !w.synthesis) return "synthesize";
  return null;
}

export const STAGE_LABEL: Record<PendingStage, string> = {
  discover: "Discovering: identifying the company and researching it",
  followup: "Following up on open leads",
  synthesize: "Evaluating triggers, people and angles",
};

/** Run exactly one pending stage and return the updated workflow. */
export async function runPendingStage(w: Workflow, stage: PendingStage): Promise<Workflow> {
  const now = new Date().toISOString();
  if (stage === "discover") {
    const r = await post<ResearchStageResponse>("/api/research/discover", { input: w.state.input });
    return {
      ...w,
      updatedAt: now,
      state: r.state,
      next: r.next,
      gateLog: [...w.gateLog, { afterStage: "discover", action: r.next.action, reason: r.next.reason, at: now }],
    };
  }
  if (stage === "followup") {
    const r = await post<ResearchStageResponse>("/api/research/followup", { state: w.state });
    return {
      ...w,
      updatedAt: now,
      state: r.state,
      next: r.next,
      gateLog: [...w.gateLog, { afterStage: `followup ${r.log.round}`, action: r.next.action, reason: r.next.reason, at: now }],
    };
  }
  const r = await post<SynthesizeResponse>("/api/research/synthesize", { state: w.state });
  const recommended = r.synthesis.angles.find((a) => a.recommended) ?? r.synthesis.angles[0] ?? null;
  return {
    ...w,
    updatedAt: now,
    synthesis: r.synthesis,
    synthesisLog: r.log,
    selectedAngleId: recommended ? recommended.id : null,
  };
}

export async function generateEmail(
  w: Workflow,
  contact: ContactChoice,
  relationship: RelationshipInput,
  regenerate: boolean,
): Promise<Workflow> {
  if (!w.synthesis || !w.selectedAngleId) throw new Error("Choose an angle first.");
  const generation = (w.email?.generation ?? 0) + 1;
  const r = await post<EmailResponse>("/api/research/email", {
    state: w.state,
    synthesis: w.synthesis,
    angleId: w.selectedAngleId,
    contact,
    relationship,
    previousBody: regenerate && w.email ? w.email.body : null,
    generation,
  });
  return {
    ...w,
    updatedAt: new Date().toISOString(),
    contact,
    relationship,
    email: r.draft,
    emailLogs: [...w.emailLogs, r.log],
  };
}
