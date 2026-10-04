// The EMAIL stage: chosen angle + chosen contact + evidence in, one email out.
//
// Sonnet 5.5 by default (see config.ts). No web tools. The intelligence files
// 04 + 05 are loaded from disk at run time. The writing style comes from those
// files, not from this code.

import "server-only";
import { PIPELINE } from "../config";
import { runStructured as defaultRunStructured } from "../anthropic";
import { saveDebugCopy } from "../debug";
import { EMAIL_INSTRUCTIONS, EMAIL_SCHEMA, buildEmailUserMessage } from "../prompts/email";
import { buildSystemPrompt, loadRules } from "../rules";
import { validateEmail } from "../synthesis";
import type { ContactChoice, EmailDraft, EvidenceCard, RelationshipInput, ResearchState, StageLog, Synthesis } from "../types";
import { BadInputError, buildStageLog, stopReasonWarnings, today } from "./common";

export interface EmailRequest {
  state: ResearchState;
  synthesis: Synthesis;
  angleId: string;
  contact: ContactChoice;
  relationship: RelationshipInput;
  previousBody: string | null;
  generation: number;
}

/** `deps` exists so tests can run the whole stage with a fake model call and no network. */
export async function runEmailStage(
  req: EmailRequest,
  deps: { runStructured: typeof defaultRunStructured } = { runStructured: defaultRunStructured },
): Promise<{ draft: EmailDraft; log: StageLog }> {
  const cfg = PIPELINE.email;
  const startedAt = new Date().toISOString();

  const angle = req.synthesis.angles.find((a) => a.id === req.angleId);
  if (!angle) throw new BadInputError("The chosen angle does not exist in this research.");

  // The contact: a researched person is looked up in the research state, so the name and role
  // the model sees are the ones we hold, not whatever the browser typed.
  let contact: ContactChoice;
  if (req.contact.source === "researched") {
    const person = req.state.people.find((p) => p.id === (req.contact as { personId: string }).personId);
    if (!person) throw new BadInputError("The chosen researched contact does not exist in this research.");
    contact = { source: "researched", personId: person.id, name: person.name, role: person.role };
  } else {
    const name = req.contact.name.trim().slice(0, 120);
    if (!name) throw new BadInputError("Enter the contact's name.");
    contact = { source: "manual", name, role: req.contact.role.trim().slice(0, 160) };
  }

  // Evidence for this email: the cards behind the chosen angle and its triggers. Nothing else.
  const wanted = new Set<string>(angle.cardIds);
  for (const t of req.synthesis.triggers) if (angle.triggerIds.includes(t.id)) t.factCardIds.forEach((id) => wanted.add(id));
  const evidence: EvidenceCard[] = req.state.cards.filter((c) => wanted.has(c.id));

  const rules = await loadRules(cfg.rulesFiles);
  const system = buildSystemPrompt(EMAIL_INSTRUCTIONS, rules);
  const userText = buildEmailUserMessage({
    state: req.state,
    synthesis: req.synthesis,
    angle,
    evidence,
    contact,
    relationship: req.relationship,
    previousBody: req.previousBody,
    today: today(),
  });

  const result = await deps.runStructured({
    model: cfg.model,
    system,
    userText,
    maxTokens: cfg.maxTokens,
    effort: cfg.effort,
    schema: EMAIL_SCHEMA as unknown as Record<string, unknown>,
  });

  const warnings = stopReasonWarnings([result.stopReason]);
  let raw: unknown;
  try {
    raw = JSON.parse(result.text);
  } catch {
    throw new Error(`The email answer was not valid JSON (stop reason: ${result.stopReason}). Try generating again.`);
  }
  const email = validateEmail(raw, evidence);
  warnings.push(...email.warnings);

  const log = buildStageLog({
    stage: "email",
    round: req.generation,
    model: cfg.model,
    retriever: null,
    usages: [result.usage],
    durationMs: result.durationMs,
    stopReasons: [result.stopReason],
    continuations: 0,
    rules,
    systemPromptChars: system.reduce((n, b) => n + b.text.length, 0),
    userMessageChars: userText.length,
    effort: cfg.effort,
    caps: { maxTokens: cfg.maxTokens },
    ledger: null,
    warnings,
    startedAt,
  });

  const draft: EmailDraft = {
    subject: email.subject,
    body: email.body,
    originalSubject: email.subject,
    originalBody: email.body,
    usedCardIds: email.usedCardIds,
    angleId: angle.id,
    contact,
    relationship: req.relationship,
    generatedAt: new Date().toISOString(),
    generation: req.generation,
  };

  await saveDebugCopy("email", req.state.input.companyName, { rawJson: result.text, draft, log });
  return { draft, log };
}
