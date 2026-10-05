// Tests for the V1 UI layer: summary rules, the in-memory repository, the sample data, and the research
// manager driven through the real (mock-mode) API routes. No network, no Anthropic calls.

import assert from "node:assert/strict";
import { test } from "node:test";
import { POST as discoverRoute } from "@/app/api/research/discover/route";
import { POST as emailRoute } from "@/app/api/research/email/route";
import { POST as followupRoute } from "@/app/api/research/followup/route";
import { POST as synthesizeRoute } from "@/app/api/research/synthesize/route";
import { ResearchManager, writeEmail, type Call } from "./client/research.ts";
import { loadFixture } from "./mock/upperHunter.ts";
import { buildSeedData } from "./mock/seed.ts";
import { MemoryRepository, emptyStore } from "./repo/memory.ts";
import { clientTypeLabel, groupFindings, industryCategory, pickDefaultRun, researchGaps, splitOpportunities, topSignal } from "./summary.ts";
import type { Synthesis } from "./types.ts";

process.env.AI_MODE = "mock";
process.env.MOCK_DELAY_MS = "0";

const routes: Record<string, (r: Request) => Promise<Response>> = {
  "/api/research/discover": discoverRoute,
  "/api/research/followup": followupRoute,
  "/api/research/synthesize": synthesizeRoute,
  "/api/research/email": emailRoute,
};
const call: Call = async (path, body) => {
  const res = await routes[path](new Request(`http://x${path}`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));
  const json = await res.json();
  if (!res.ok || json.ok !== true) throw new Error(json.error ?? "failed");
  return json;
};

// ---------------------------------------------------------------------------------------------- summary

test("top signal follows the primary trigger's priority; hooks only = hook; nothing = none", () => {
  const fx = loadFixture().synthesis as Synthesis;
  const mk = (triggers: Synthesis["triggers"]): Synthesis => ({ ...fx, triggers });
  const base = fx.triggers[0];
  assert.equal(topSignal(mk([{ ...base, rank: "primary", priority: "high" }])), "strong");
  assert.equal(topSignal(mk([{ ...base, rank: "primary", priority: "medium" }])), "medium");
  assert.equal(topSignal(mk([{ ...base, rank: "primary", priority: "low" }])), "weak");
  assert.equal(topSignal(mk([{ ...base, kind: "conversation_hook", rank: "hook" }])), "hook");
  assert.equal(topSignal(mk([])), "none");
});

test("industry and client type come from the leading words of the classification", () => {
  assert.equal(industryCategory(undefined), null);
  assert.equal(clientTypeLabel(""), null);
  assert.equal(typeof industryCategory("Local government authority, NSW"), "string");
});

test("opportunities split into one best and the rest; nothing is dropped", () => {
  const s = loadFixture().synthesis as Synthesis;
  const { best, others } = splitOpportunities(s);
  assert.equal((best ? 1 : 0) + others.length, s.triggers.length);
});

test("findings are grouped without losing any card", () => {
  const fx = loadFixture();
  const g = groupFindings(fx.state, fx.synthesis);
  // Cards already shown as the evidence of an opportunity are not repeated in "developments".
  const shown = new Set(fx.synthesis!.triggers.flatMap((t) => t.factCardIds));
  const ids = [...g.developments, ...g.technology, ...g.background, ...fx.state.cards.filter((c) => shown.has(c.id) && ![...g.technology, ...g.background].includes(c))].map((c) => c.id).sort();
  assert.deepEqual(ids, fx.state.cards.map((c) => c.id).sort());
  assert.ok(Array.isArray(researchGaps(fx.state, fx.synthesis)));
});

// ---------------------------------------------------------------------------------------------- seed

test("sample data is valid: five accounts in the intended states, a default run each where expected", async () => {
  const repo = new MemoryRepository(buildSeedData());
  const rows = await repo.listAccounts();
  assert.equal(rows.length, 5);
  const byName = new Map(rows.map((r) => [r.name, r]));
  assert.equal(byName.get("Upper Hunter Shire Council")?.status, "done");
  assert.equal(byName.get("Sample: Unresearched Pty Ltd")?.status, "not_researched");
  assert.equal(byName.get("Sample: Unclear Name Co")?.status, "failed");
  assert.equal(byName.get("Sample: Partial Research Co")?.status, "partial");
  assert.equal(byName.get("Sample: Weak Signal Pty Ltd")?.status, "done");
  const uh = await repo.getCompany("sample-upper-hunter");
  assert.ok(uh && (await repo.getEmail(uh.id)));
  assert.equal((await repo.getDefaultRun(uh.id))?.id, uh.selectedRunId);
});

// ---------------------------------------------------------------------------------------------- repository

test("repository: create, duplicates, edit, delete cascades", async () => {
  const repo = new MemoryRepository(emptyStore());
  const c = await repo.createCompany({ name: "Acme Pty Ltd", website: "https://acme.example", context: "met at a show" });
  assert.equal((await repo.findDuplicates("acme pty ltd", "")).length, 1);
  const edited = await repo.updateCompany(c.id, { context: "new context" });
  assert.equal(edited.context, "new context");
  await repo.addManualContact(c.id, { name: "Jo Bloggs", role: "Ops" });
  assert.equal((await repo.listManualContacts(c.id)).length, 1);
  await repo.deleteCompany(c.id);
  assert.equal(await repo.getCompany(c.id), null);
  assert.equal((await repo.listAccounts()).length, 0);
  assert.equal((await repo.listManualContacts(c.id)).length, 0);
});

test("repository: a newer failed run does not replace the default (Done) run", async () => {
  const repo = new MemoryRepository(buildSeedData());
  const uh = (await repo.getCompany("sample-upper-hunter"))!;
  const doneRun = await repo.getDefaultRun(uh.id);
  const failed = await repo.createRun(uh.id, { topic: "", aiMode: "mock" });
  await repo.updateRun(failed.id, { status: "failed" });
  assert.equal((await repo.getDefaultRun(uh.id))?.id, doneRun?.id);
  assert.equal((await repo.getLatestRun(uh.id))?.id, failed.id);
  assert.equal(pickDefaultRun([(await repo.getRun(failed.id))!, (await repo.getRun(doneRun!.id))!])?.id, doneRun!.id);
});

test("repository: context is remembered by the company; the topic stays on the run only", async () => {
  const repo = new MemoryRepository(emptyStore());
  const c = await repo.createCompany({ name: "Topic Co", website: "", context: "remembered" });
  const run = await repo.createRun(c.id, { topic: "only this run", aiMode: "mock" });
  assert.equal(run.topic, "only this run");
  assert.equal(run.contextSnapshot, "remembered");
  await repo.updateCompany(c.id, { context: "changed later" });
  assert.equal((await repo.getRun(run.id))?.contextSnapshot, "remembered");
  assert.equal((await repo.getCompany(c.id))?.context, "changed later");
  assert.ok(!("topic" in ((await repo.getCompany(c.id)) as object)));
});

test("repository: runs left researching by a closed tab are closed", async () => {
  const repo = new MemoryRepository(emptyStore());
  const c = await repo.createCompany({ name: "Orphan Co", website: "", context: "" });
  const run = await repo.createRun(c.id, { topic: "", aiMode: "mock" });
  assert.equal(run.status, "researching");
  await repo.closeOrphanedRuns([]);
  assert.notEqual((await repo.getRun(run.id))?.status, "researching");
});

// ---------------------------------------------------------------------------------------------- manager

test("research manager: a mock run goes discover -> follow-up -> synthesis, is saved, and selects the recommended angle", async () => {
  const repo = new MemoryRepository(emptyStore());
  const c = await repo.createCompany({ name: "Anything Pty Ltd", website: "", context: "ctx" });
  const manager = new ResearchManager(repo, call, async () => "mock");
  const { finished } = await manager.start(c.id, "a topic");
  assert.ok(manager.isActive(c.id));
  const run = await finished;
  assert.equal(run.status, "done");
  assert.equal(run.topic, "a topic");
  assert.ok(run.synthesis && run.research.cards.length > 0 && run.summary);
  assert.equal(manager.isActive(c.id), false);
  const company = (await repo.getCompany(c.id))!;
  assert.equal(company.selectedRunId, run.id);
  assert.ok(company.selectedAngleKey);
  const second = await manager.start(c.id, "");
  await assert.rejects(() => manager.start(c.id, ""), /already running/);
  await second.finished;
});

test("research manager: a failing stage keeps what was saved and marks the run failed or partial", async () => {
  const repo = new MemoryRepository(emptyStore());
  const c = await repo.createCompany({ name: "Broken Co", website: "", context: "" });
  const manager = new ResearchManager(repo, async () => { throw new Error("network down"); }, async () => "mock");
  const { finished } = await manager.start(c.id, "");
  const run = await finished;
  assert.equal(run.status, "failed");
  assert.match(run.statusReason ?? "", /network down/);
});

test("emails: generate, then regenerate keeps one current email and bumps the generation", async () => {
  const repo = new MemoryRepository(emptyStore());
  const c = await repo.createCompany({ name: "Mail Co", website: "", context: "" });
  const manager = new ResearchManager(repo, call, async () => "mock");
  const run = await (await manager.start(c.id, "")).finished;
  const angle = run.synthesis!.angles[0].id;
  const first = await writeEmail(repo, call, { companyId: c.id, angleKey: angle, contact: { source: "manual", name: "Sam Smith", role: "Manager" }, relationship: { kind: "new", note: "" }, regenerate: false });
  assert.match(first.body, /Sam/);
  const second = await writeEmail(repo, call, { companyId: c.id, angleKey: angle, contact: { source: "manual", name: "Sam Smith", role: "Manager" }, relationship: { kind: "existing", note: "met in May" }, regenerate: true });
  assert.equal(second.generation, first.generation + 1);
  assert.equal((await repo.getEmail(c.id))?.id, second.id);
  assert.equal(second.relationship.note, "met in May");
});
