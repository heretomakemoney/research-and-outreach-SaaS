// MOCK stage runners: same inputs and outputs as the live stages, but they answer from the saved sample
// and never touch Anthropic. Chosen by stages/runners.ts when AI_MODE=mock.
//
// MOCK DATA ONLY. Whatever company you type, the research is the saved Upper Hunter sample.

import "server-only";
import { GATE } from "../config";
import { decideNext } from "../gate";
import { mockDelayMs } from "../mode";
import { totalCostUsd, totalSearches } from "../state";
import type { EmailRequest } from "../stages/email";
import type { ResearchStageOutput, ResearchStageRequest } from "../stages/research";
import { BadInputError } from "../stages/common";
import type { ContactChoice, EmailDraft, ResearchState, StageLog, Synthesis } from "../types";
import { discoverSnapshot, followupSnapshot, loadFixture } from "./upperHunter";

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, mockDelayMs()));

export async function mockResearchStage(req: ResearchStageRequest): Promise<ResearchStageOutput> {
  await pause();
  const state = req.kind === "discover" ? discoverSnapshot(req.input) : followupSnapshot(req.state.input);
  const log = structuredClone(state.stages[state.stages.length - 1]);
  // The real gate decides what happens next, exactly as in live mode.
  const next = decideNext(state, totalSearches(state), totalCostUsd(state), { ...GATE, now: new Date() });
  return { state, next, log };
}

export async function mockSynthesizeStage(_state: ResearchState): Promise<{ synthesis: Synthesis; log: StageLog }> {
  await pause();
  const fx = loadFixture();
  return { synthesis: fx.synthesis!, log: fx.synthesisLog! };
}

export async function mockEmailStage(req: EmailRequest): Promise<{ draft: EmailDraft; log: StageLog }> {
  await pause();
  const fx = loadFixture();
  const angle = req.synthesis.angles.find((a) => a.id === req.angleId);
  if (!angle) throw new BadInputError("The chosen angle does not exist in this research.");

  let contact: ContactChoice;
  if (req.contact.source === "researched") {
    const personId = req.contact.personId;
    const person = req.state.people.find((p) => p.id === personId);
    if (!person) throw new BadInputError("The chosen researched contact does not exist in this research.");
    contact = { source: "researched", personId: person.id, name: person.name, role: person.role };
  } else {
    const name = req.contact.name.trim().slice(0, 120);
    if (!name) throw new BadInputError("Enter the contact's name.");
    contact = { source: "manual", name, role: req.contact.role.trim().slice(0, 160) };
  }

  const sample = fx.email!;
  const firstName = contact.name.trim().split(/\s+/)[0] || "there";
  const body = sample.body.replace(/^Hi [^,\n]+,/, `Hi ${firstName},`);
  const subject = req.generation > 1 ? `${sample.subject} (mock draft ${req.generation})` : sample.subject;
  const known = new Set(req.state.cards.map((c) => c.id));
  const used = sample.usedCardIds.filter((id) => known.has(id));

  const draft: EmailDraft = {
    subject,
    body,
    originalSubject: subject,
    originalBody: body,
    usedCardIds: used.length > 0 ? used : angle.cardIds.slice(0, 2),
    angleId: angle.id,
    contact,
    relationship: req.relationship,
    generatedAt: new Date().toISOString(),
    generation: req.generation,
  };
  const log = { ...structuredClone(fx.emailLogs[0]), round: req.generation, startedAt: new Date().toISOString() };
  return { draft, log };
}
