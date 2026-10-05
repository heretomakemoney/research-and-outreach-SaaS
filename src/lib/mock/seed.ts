// SAMPLE DATA for developing the UI without paid calls (mock mode only).
//
//  - "Upper Hunter Shire Council" is the saved real run (src/fixtures). MOCK DATA ONLY: it never enters
//    prompts, intelligence files, examples or live research.
//  - The other accounts are clearly fake ("Sample: ...") and exist to show useful UI states:
//    not researched, company unclear (failed), partial research, and a weak signal.
//
// Only the repository's "load sample data" action imports this file (a test enforces it).

import type { Company, OutreachEmail, ResearchRun } from "../domain";
import type { StoreData } from "../repo/memory";
import { deriveSummary } from "../summary";
import type { EvidenceCard, LedgerSource, ResearchState, Synthesis } from "../types";
import { loadFixture } from "./upperHunter";

const ago = (now: Date, minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

function company(id: string, name: string, website: string, context: string, at: string): Company {
  return {
    id,
    name,
    website,
    context,
    contextUpdatedAt: at,
    selectedRunId: null,
    selectedAngleKey: null,
    selectedPersonKey: null,
    selectedManualContactId: null,
    lastActivityAt: at,
    createdAt: at,
    updatedAt: at,
  };
}

const sampleSource = (n: number, title: string): LedgerSource => ({
  key: `S${n}`,
  url: `https://example.com/sample-${n}`,
  title,
  pageAge: null,
  seenInSearch: true,
  fetched: false,
  fetchKind: null,
  retrievedAt: null,
  fetchError: null,
  citedCount: 0,
  citedExcerpts: [],
});

const sampleCard = (n: number, kind: EvidenceCard["kind"], claim: string): EvidenceCard => ({
  id: `E${n}`,
  kind,
  date: "2026-08",
  claim,
  sourceKeys: [`S${n}`],
  evidence: [{ sourceKey: `S${n}`, excerpt: "Sample excerpt (fake data)." }],
  grade: "tool_source",
  stage: "discover",
  round: 0,
});

function emptyResearch(name: string, website: string, context: string): ResearchState {
  return {
    input: { companyName: name, website, context, topic: "" },
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

function baseRun(c: Company, id: string, status: ResearchRun["status"], startedAt: string, finishedAt: string | null): ResearchRun {
  return {
    id,
    companyId: c.id,
    status,
    statusReason: null,
    companyNameSnapshot: c.name,
    websiteSnapshot: c.website,
    contextSnapshot: c.context,
    topic: "",
    startedAt,
    finishedAt,
    aiMode: "mock",
    summary: null,
    research: emptyResearch(c.name, c.website, c.context),
    next: null,
    gateLog: [],
    synthesis: null,
    synthesisLog: null,
  };
}

export function buildSeedData(now: Date = new Date()): StoreData {
  const data: StoreData = { companies: [], runs: [], contacts: [], emails: [] };

  // ---- 1. The saved real run (fixture), as a finished account with a selection and an email
  const fx = loadFixture();
  const uh = company("sample-upper-hunter", "Upper Hunter Shire Council", "https://www.upperhunter.nsw.gov.au", "", fx.createdAt);
  const synthLog = fx.synthesisLog!;
  const uhRun: ResearchRun = {
    ...baseRun(uh, "sample-run-upper-hunter", "done", fx.createdAt, new Date(new Date(synthLog.startedAt).getTime() + synthLog.durationMs).toISOString()),
    aiMode: "live", // the real run behind the fixture
    research: fx.state,
    next: fx.next,
    gateLog: fx.gateLog,
    synthesis: fx.synthesis,
    synthesisLog: synthLog,
  };
  uhRun.summary = deriveSummary(uhRun.research, uhRun.synthesis);
  uh.selectedRunId = uhRun.id;
  uh.selectedAngleKey = fx.selectedAngleId;
  uh.selectedPersonKey = fx.contact?.source === "researched" ? fx.contact.personId : null;
  uh.lastActivityAt = fx.email!.generatedAt;
  const sample = fx.email!;
  const angle = fx.synthesis!.angles.find((a) => a.id === sample.angleId)!;
  const email: OutreachEmail = {
    id: "sample-email-upper-hunter",
    companyId: uh.id,
    runId: uhRun.id,
    angleKey: angle.id,
    angleTitle: angle.title,
    angleStrength: angle.strength,
    contact: sample.contact,
    relationship: sample.relationship,
    subject: sample.subject,
    body: sample.body,
    generatedSubject: sample.originalSubject,
    generatedBody: sample.originalBody,
    usedCardIds: sample.usedCardIds,
    basedOn: sample.usedCardIds
      .map((id) => fx.state.cards.find((c) => c.id === id))
      .filter((c): c is EvidenceCard => !!c)
      .map((c) => ({ id: c.id, claim: c.claim, date: c.date, grade: c.grade, sourceUrls: c.sourceKeys.map((k) => fx.state.sources.find((s) => s.key === k)?.url ?? "").filter(Boolean) })),
    limitation: angle.strength === "weak" || angle.strength === "general_introduction" ? "weak_hook" : "none",
    logs: fx.emailLogs,
    generation: sample.generation,
    generatedAt: sample.generatedAt,
    editedAt: null,
    updatedAt: sample.generatedAt,
  };
  data.companies.push(uh);
  data.runs.push(uhRun);
  data.emails.push(email);

  // ---- 2. Sample: not researched (with context)
  data.companies.push(
    company("sample-unresearched", "Sample: Unresearched Pty Ltd", "https://example.com", "Sample context (fake): met their operations manager at a trade show last year.", ago(now, 60 * 5)),
  );

  // ---- 3. Sample: company unclear (failed)
  const unclear = company("sample-unclear", "Sample: Unclear Name Co", "", "", ago(now, 60 * 30));
  const unclearRun = baseRun(unclear, "sample-run-unclear", "failed", ago(now, 60 * 30), ago(now, 60 * 30 - 2));
  unclearRun.statusReason = "More than one company could match this name. Please confirm which one (add the website or more context) and run again.";
  unclearRun.research.entity = {
    match: "Ambiguous",
    matchNote: "Ambiguous - two companies share this name (sample, fake data)",
    name: "Sample: Unclear Name Co",
    website: "",
    tradingLegal: "",
    industry: "",
    clientType: "",
    summary: "",
    contextCheck: "none supplied",
    sourceKeys: [],
  };
  unclearRun.next = { action: "stop_entity", reason: unclearRun.statusReason };
  unclearRun.summary = deriveSummary(unclearRun.research, null);
  data.companies.push(unclear);
  data.runs.push(unclearRun);

  // ---- 4. Sample: partial research (stopped after discovery, no synthesis)
  const partial = company("sample-partial", "Sample: Partial Research Co", "https://example.com/partial", "", ago(now, 60 * 50));
  const partialRun = baseRun(partial, "sample-run-partial", "partial", ago(now, 60 * 50), ago(now, 60 * 50 - 3));
  partialRun.statusReason = "Research was interrupted before it finished (sample, fake data).";
  partialRun.research = {
    ...partialRun.research,
    entity: {
      match: "Probable",
      matchNote: "Probable - sample, fake data",
      name: "Sample: Partial Research Co",
      website: "https://example.com/partial",
      tradingLegal: "not applicable",
      industry: "Energy & Utilities - a fake water utility used for the demo",
      clientType: "End User - a fake client type",
      summary: "A fake water utility used to show how an incomplete research result looks. Nothing here is real.",
      contextCheck: "none supplied",
      sourceKeys: [],
    },
    cards: [sampleCard(1, "company_profile", "Sample finding (fake): the company runs a few remote pump stations."), sampleCard(2, "project", "Sample finding (fake): a telemetry upgrade was announced in August.")],
    sources: [sampleSource(1, "Sample page one"), sampleSource(2, "Sample page two")],
  };
  partialRun.summary = deriveSummary(partialRun.research, null);
  data.companies.push(partial);
  data.runs.push(partialRun);

  // ---- 5. Sample: done, but only a weak signal (a conversation hook and the general introduction)
  const weak = company("sample-weak", "Sample: Weak Signal Pty Ltd", "https://example.com/weak", "Sample context (fake): existing customer through a distributor.", ago(now, 60 * 70));
  const weakRun = baseRun(weak, "sample-run-weak", "done", ago(now, 60 * 70), ago(now, 60 * 70 - 6));
  weakRun.research = {
    ...weakRun.research,
    entity: {
      match: "Confirmed",
      matchNote: "Confirmed - sample, fake data",
      name: "Sample: Weak Signal Pty Ltd",
      website: "https://example.com/weak",
      tradingLegal: "not applicable",
      industry: "Retail - a fake retailer used for the demo",
      clientType: "End User - a fake client type",
      summary: "A fake retailer used to show how a result with only a weak signal looks. Nothing here is real.",
      contextCheck: "consistent",
      sourceKeys: [],
    },
    cards: [sampleCard(1, "news", "Sample finding (fake): the company opened a new head office in August.")],
    sources: [sampleSource(1, "Sample news page")],
    leads: [{ id: "L1", priority: "low", question: "Sample question (fake): any store rollout planned?", why: "Sample", status: "unresolved", resolutionNote: "Nothing found (sample).", openedInRound: 0 }],
    relevance: { level: "weak", note: "Sample, fake data" },
  };
  const weakSynthesis: Synthesis = {
    relevance: "weak",
    summary: "Sample (fake): a retailer with no confirmed connectivity project. Only a conversation hook was found.",
    noMeaningfulAngleNote: "",
    triggers: [
      {
        id: "T1",
        rank: "primary",
        kind: "conversation_hook",
        priority: "low",
        title: "New head office opened (sample)",
        recency: "3_to_6_months",
        scale: "",
        fact: "Sample (fake): the company opened a new head office in August.",
        factCardIds: ["E1"],
        evidenceGrade: "tool_source",
        inference: "A new office may mean new networking, but nothing in the evidence says so.",
        possibleOpportunity: "A natural, low-pressure opener.",
        whyNow: "Recent, but not a Teltonika-specific trigger.",
      },
    ],
    people: [],
    angles: [
      { id: "A1", title: "New head office (hook)", strength: "weak", triggerIds: ["T1"], cardIds: ["E1"], evidenceGrade: "tool_source", conversationQuestion: "How is the move to the new head office going?", whyItWorks: "Genuine and recent, but not a sales trigger.", recommended: true },
      { id: "A2", title: "General introduction - no specific trigger found", strength: "general_introduction", triggerIds: [], cardIds: [], evidenceGrade: null, conversationQuestion: "Is connectivity for your sites something on your radar this year?", whyItWorks: "Starts a general conversation; makes no claim about relevance.", recommended: false },
    ],
    gaps: ["No connectivity or rollout project found (sample, fake data)."],
    droppedReferences: [],
  };
  weakRun.synthesis = weakSynthesis;
  weakRun.next = { action: "synthesize", reason: "Sample." };
  weakRun.summary = deriveSummary(weakRun.research, weakSynthesis);
  weak.selectedRunId = weakRun.id;
  weak.selectedAngleKey = "A1";
  data.companies.push(weak);
  data.runs.push(weakRun);

  return data;
}
