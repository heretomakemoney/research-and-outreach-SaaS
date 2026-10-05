// The Repository contract: the same tests run against the in-memory repository (always) and against
// PostgreSQL (when TEST_DATABASE_URL points at a database; otherwise those tests are reported as skipped).
//
// Also covers the research manager and emails on top of each repository, driven through the real
// (mock-mode) API routes. No Anthropic calls.
//
// To run the PostgreSQL half locally:  TEST_DATABASE_URL=postgres://... npm test
// It creates a throwaway schema, runs db/migrations/001_init.sql in it, and drops it afterwards.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { POST as discoverRoute } from "@/app/api/research/discover/route";
import { POST as emailRoute } from "@/app/api/research/email/route";
import { POST as followupRoute } from "@/app/api/research/followup/route";
import { POST as synthesizeRoute } from "@/app/api/research/synthesize/route";
import { ResearchManager, writeEmail, type Call } from "../client/research.ts";
import type { Repository } from "./types.ts";
import { buildSeedData } from "../mock/seed.ts";
import { MemoryRepository, emptyStore } from "./memory.ts";
import { connect, PostgresRepository } from "./postgres.ts";
import { pickDefaultRun } from "../summary.ts";

process.env.AI_MODE = "mock";
process.env.MOCK_DELAY_MS = "0";

const routes: Record<string, (r: Request) => Promise<Response>> = {
  "/api/research/discover": discoverRoute,
  "/api/research/followup": followupRoute,
  "/api/research/synthesize": synthesizeRoute,
  "/api/research/email": emailRoute,
};
const call: Call = async (p, body) => {
  const res = await routes[p](new Request(`http://x${p}`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));
  const json = await res.json();
  if (!res.ok || json.ok !== true) throw new Error(json.error ?? "failed");
  return json;
};

interface Harness {
  repo: Repository;
  /** Adds the sample accounts (all five states). */
  samples(): Promise<void>;
  /** Finds a company by name (ids differ between repositories). */
  byName(name: string): Promise<string>;
}

function memoryHarness(): Harness {
  const repo = new MemoryRepository(emptyStore());
  return {
    repo,
    samples: async () => repo.replaceAll(buildSeedData()),
    byName: async (name) => (await repo.listAccounts()).find((a) => a.name === name)!.id,
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function contract(label: string, makeHarness: () => Promise<Harness>, skip: string | false = false) {
  describe(label, { skip }, () => {
    test("create, find duplicates, edit, delete cascades", async () => {
      const { repo } = await makeHarness();
      const c = await repo.createCompany({ name: "Acme Pty Ltd", website: "https://www.acme.example/about", context: "met at a show" });
      assert.equal((await repo.findDuplicates("ACME pty ltd", "")).length, 1);
      assert.equal((await repo.findDuplicates("Other", "http://acme.example")).length, 1);
      assert.equal((await repo.findDuplicates("Other", "")).length, 0);
      const edited = await repo.updateCompany(c.id, { context: "new context" });
      assert.equal(edited.context, "new context");
      assert.equal(edited.name, "Acme Pty Ltd");
      await assert.rejects(() => repo.updateCompany(c.id, { name: "  " }), /required/);
      await repo.addManualContact(c.id, { name: "Jo Bloggs", role: "Ops" });
      await repo.deleteCompany(c.id);
      assert.equal(await repo.getCompany(c.id), null);
      assert.equal((await repo.listAccounts()).length, 0);
      assert.equal((await repo.listManualContacts(c.id)).length, 0);
    });

    test("unknown ids are 'not found', not crashes", async () => {
      const { repo } = await makeHarness();
      for (const id of ["nope", "00000000-0000-4000-8000-000000000000"]) {
        assert.equal(await repo.getCompany(id), null);
        assert.equal(await repo.getRun(id), null);
        assert.equal(await repo.getLatestRun(id), null);
        assert.equal(await repo.getEmail(id), null);
        assert.deepEqual(await repo.listManualContacts(id), []);
        await assert.rejects(() => repo.updateCompany(id, { context: "x" }), /no longer exists/);
        await assert.rejects(() => repo.createRun(id, { topic: "", aiMode: "mock" }), /no longer exists/);
      }
    });

    test("manual contacts are not duplicated", async () => {
      const { repo } = await makeHarness();
      const c = await repo.createCompany({ name: "Contacts Co", website: "", context: "" });
      const a = await repo.addManualContact(c.id, { name: "Jo Bloggs", role: "Ops" });
      const b = await repo.addManualContact(c.id, { name: "jo bloggs", role: "ops" });
      assert.equal(a.id, b.id);
      assert.equal((await repo.listManualContacts(c.id)).length, 1);
      await assert.rejects(() => repo.addManualContact(c.id, { name: " ", role: "" }), /name/);
    });

    test("selection keeps at most one contact; null clears", async () => {
      const { repo } = await makeHarness();
      const c = await repo.createCompany({ name: "Select Co", website: "", context: "" });
      const m = await repo.addManualContact(c.id, { name: "Sam", role: "" });
      let s = await repo.setSelection(c.id, { angleKey: "A2", personKey: "P1" });
      assert.deepEqual([s.selectedAngleKey, s.selectedPersonKey, s.selectedManualContactId], ["A2", "P1", null]);
      s = await repo.setSelection(c.id, { manualContactId: m.id });
      assert.deepEqual([s.selectedPersonKey, s.selectedManualContactId], [null, m.id]);
      s = await repo.setSelection(c.id, { personKey: "P2" });
      assert.deepEqual([s.selectedPersonKey, s.selectedManualContactId], ["P2", null]);
      s = await repo.setSelection(c.id, { angleKey: null });
      assert.equal(s.selectedAngleKey, null);
      assert.equal(s.selectedPersonKey, "P2"); // untouched
    });

    test("context is remembered by the company; the topic stays on the run only", async () => {
      const { repo } = await makeHarness();
      const c = await repo.createCompany({ name: "Topic Co", website: "", context: "remembered" });
      const run = await repo.createRun(c.id, { topic: "only this run", aiMode: "mock" });
      assert.equal(run.topic, "only this run");
      assert.equal(run.contextSnapshot, "remembered");
      await repo.updateRun(run.id, { status: "failed", statusReason: "x", finishedAt: new Date().toISOString() });
      await repo.updateCompany(c.id, { context: "changed later" });
      assert.equal((await repo.getRun(run.id))?.contextSnapshot, "remembered");
      assert.equal((await repo.getCompany(c.id))?.context, "changed later");
      assert.ok(!("topic" in (await repo.getCompany(c.id))!));
    });

    test("one run at a time per company; a finished run cannot be changed; no delete while researching", async () => {
      const { repo } = await makeHarness();
      const c = await repo.createCompany({ name: "Busy Co", website: "", context: "" });
      const run = await repo.createRun(c.id, { topic: "", aiMode: "mock" });
      await assert.rejects(() => repo.createRun(c.id, { topic: "", aiMode: "mock" }), /already running/);
      await assert.rejects(() => repo.deleteCompany(c.id), /being researched/);
      const done = await repo.updateRun(run.id, { status: "failed", statusReason: "stopped", finishedAt: new Date().toISOString() });
      assert.equal(done.status, "failed");
      assert.ok(done.summary, "a summary is derived when a run ends");
      await assert.rejects(() => repo.updateRun(run.id, { research: done.research }), /cannot be changed/);
      await repo.deleteCompany(c.id);
    });

    test("runs left researching are closed as partial or failed", async () => {
      const { repo } = await makeHarness();
      const c = await repo.createCompany({ name: "Orphan Co", website: "", context: "" });
      const run = await repo.createRun(c.id, { topic: "", aiMode: "mock" });
      await wait(10);
      await repo.closeOrphanedRuns([run.id]); // a run that is being driven is left alone
      assert.equal((await repo.getRun(run.id))?.status, "researching");
      await repo.closeOrphanedRuns([]);
      const closed = (await repo.getRun(run.id))!;
      assert.equal(closed.status, "failed");
      assert.match(closed.statusReason ?? "", /interrupted/);
      assert.ok(closed.finishedAt);
    });

    test("sample accounts: five accounts in the intended states and a sensible default run", async () => {
      const h = await makeHarness();
      await h.samples();
      const rows = await h.repo.listAccounts();
      assert.equal(rows.length, 5);
      const by = new Map(rows.map((r) => [r.name, r]));
      assert.equal(by.get("Upper Hunter Shire Council")?.status, "done");
      assert.equal(by.get("Sample: Unresearched Pty Ltd")?.status, "not_researched");
      assert.equal(by.get("Sample: Unclear Name Co")?.status, "failed");
      assert.equal(by.get("Sample: Unclear Name Co")?.statusDetail, "Company unclear");
      assert.equal(by.get("Sample: Partial Research Co")?.status, "partial");
      assert.equal(by.get("Sample: Weak Signal Pty Ltd")?.status, "done");
      const uh = (await h.repo.getCompany(await h.byName("Upper Hunter Shire Council")))!;
      assert.ok(uh.selectedRunId && uh.selectedAngleKey);
      assert.equal((await h.repo.getDefaultRun(uh.id))?.id, uh.selectedRunId);
      const email = await h.repo.getEmail(uh.id);
      assert.ok(email && email.logs.length > 0 && email.runId === uh.selectedRunId);
      assert.ok(by.get("Upper Hunter Shire Council")?.industry);
      assert.ok(by.get("Upper Hunter Shire Council")?.topSignal);
    });

    test("a newer failed run does not replace the default (Done) run", async () => {
      const h = await makeHarness();
      await h.samples();
      const uhId = await h.byName("Upper Hunter Shire Council");
      const doneRun = (await h.repo.getDefaultRun(uhId))!;
      const failed = await h.repo.createRun(uhId, { topic: "", aiMode: "mock" });
      await h.repo.updateRun(failed.id, { status: "failed", finishedAt: new Date().toISOString() });
      assert.equal((await h.repo.getDefaultRun(uhId))?.id, doneRun.id);
      assert.equal((await h.repo.getLatestRun(uhId))?.id, failed.id);
      const row = (await h.repo.listAccounts()).find((r) => r.id === uhId)!;
      assert.equal(row.status, "failed");
      assert.equal(row.hasEarlierResearch, true);
      assert.equal(row.topSignal, doneRun.summary?.topSignal);
      assert.equal(pickDefaultRun([failed, doneRun])?.id, doneRun.id);
    });

    test("research manager: a mock run is saved stage by stage and selects the recommended angle", async () => {
      const { repo } = await makeHarness();
      const c = await repo.createCompany({ name: "Anything Pty Ltd", website: "", context: "ctx" });
      const manager = new ResearchManager(repo, call, async () => "mock");
      const { finished } = await manager.start(c.id, "a topic");
      assert.ok(manager.isActive(c.id));
      await assert.rejects(() => manager.start(c.id, ""), /already running/);
      const run = await finished;
      assert.equal(run.status, "done");
      assert.equal(run.topic, "a topic");
      const stored = (await repo.getRun(run.id))!;
      assert.ok(stored.synthesis && stored.research.cards.length > 0 && stored.summary && stored.research.stages.length > 0);
      assert.deepEqual(stored.synthesis, run.synthesis);
      const company = (await repo.getCompany(c.id))!;
      assert.equal(company.selectedRunId, run.id);
      assert.ok(company.selectedAngleKey);
      assert.equal((await repo.listAccounts())[0].status, "done");
    });

    test("research manager: a failing first stage marks the run failed and keeps the reason", async () => {
      const { repo } = await makeHarness();
      const c = await repo.createCompany({ name: "Broken Co", website: "", context: "" });
      const manager = new ResearchManager(repo, async () => { throw new Error("network down"); }, async () => "mock");
      const run = await (await manager.start(c.id, "")).finished;
      assert.equal(run.status, "failed");
      assert.match(run.statusReason ?? "", /network down/);
      assert.equal((await repo.getLatestRun(c.id))?.status, "failed");
    });

    test("email: generate, edit, regenerate keeps ONE current email and every generation's log", async () => {
      const { repo } = await makeHarness();
      const c = await repo.createCompany({ name: "Mail Co", website: "", context: "" });
      const manager = new ResearchManager(repo, call, async () => "mock");
      const run = await (await manager.start(c.id, "")).finished;
      const angle = run.synthesis!.angles[0].id;
      const person = run.research.people[0];
      const first = await writeEmail(repo, call, { companyId: c.id, angleKey: angle, contact: { source: "researched", personId: person.id, name: person.name, role: person.role }, relationship: { kind: "new", note: "" }, regenerate: false });
      assert.equal(first.generation, 1);
      assert.equal(first.contact.source, "researched");
      assert.equal(first.logs.length, 1);
      const edited = await repo.saveEmail({ ...first, body: first.body + "\nEDITED", editedAt: new Date().toISOString() });
      assert.ok(edited.body.endsWith("EDITED"));
      assert.equal(edited.logs.length, 1, "saving an edit does not duplicate logs");
      const second = await writeEmail(repo, call, { companyId: c.id, angleKey: angle, contact: { source: "manual", name: "Sam Smith", role: "Manager" }, relationship: { kind: "existing", note: "met in May" }, regenerate: true });
      assert.equal(second.generation, 2);
      assert.equal(second.logs.length, 2);
      const current = (await repo.getEmail(c.id))!;
      assert.equal(current.id, second.id);
      assert.equal(current.contact.source, "manual");
      assert.equal(current.relationship.note, "met in May");
      assert.equal(current.generatedBody, second.generatedBody);
      assert.equal(current.runId, run.id);
      assert.ok(current.basedOn.length >= 0 && Array.isArray(current.usedCardIds));
    });
  });
}

contract("MemoryRepository", async () => memoryHarness());

// ---------------------------------------------------------------------------------------------- PostgreSQL

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const schema = `t_${Math.random().toString(36).slice(2, 10)}`;
let pgSql: ReturnType<typeof connect> | null = null;

async function pgHarness(): Promise<Harness> {
  if (!pgSql) {
    const admin = connect(TEST_URL!, { max: 1 });
    await admin.unsafe(`create schema ${schema}`);
    await admin.end();
    pgSql = connect(TEST_URL!, { max: 4, connection: { search_path: schema } });
    await pgSql.unsafe(fs.readFileSync(path.join(process.cwd(), "db", "migrations", "001_init.sql"), "utf-8"));
  }
  await pgSql.unsafe("truncate stage_logs, outreach_emails, manual_contacts, research_runs, companies cascade");
  const repo = new PostgresRepository(pgSql, { orphanAfterMs: 0 });
  return {
    repo,
    samples: async () => {
      await repo.importSample(buildSeedData());
    },
    byName: async (name) => (await repo.listAccounts()).find((a) => a.name === name)!.id,
  };
}

contract("PostgresRepository", pgHarness, TEST_URL ? false : "set TEST_DATABASE_URL to run the PostgreSQL tests");

describe("PostgresRepository specifics", { skip: TEST_URL ? false : "set TEST_DATABASE_URL to run the PostgreSQL tests" }, () => {
  test("a fresh run is not treated as abandoned (default 8 minute threshold)", async () => {
    const { repo: _ } = await pgHarness();
    const repo = new PostgresRepository(pgSql!);
    const c = await repo.createCompany({ name: "Fresh Co", website: "", context: "" });
    const run = await repo.createRun(c.id, { topic: "", aiMode: "mock" });
    await repo.closeOrphanedRuns([]);
    assert.equal((await repo.getRun(run.id))?.status, "researching");
    const later = new PostgresRepository(pgSql!, { now: () => new Date(Date.now() + 9 * 60 * 1000) });
    await later.closeOrphanedRuns([]);
    assert.equal((await repo.getRun(run.id))?.status, "failed");
  });

  test("stage logs are copied once and cost totals are stored on the run", async () => {
    const h = await pgHarness();
    await h.samples();
    const uh = await h.byName("Upper Hunter Shire Council");
    const [{ n }] = await pgSql!`select count(*)::int as n from stage_logs where company_id = ${uh}`;
    assert.ok(n >= 3);
    const run = (await h.repo.getDefaultRun(uh))!;
    await (h.repo as PostgresRepository).importSample(buildSeedData()); // names already exist: skipped
    const [{ n: n2 }] = await pgSql!`select count(*)::int as n from stage_logs where company_id = ${uh}`;
    assert.equal(n2, n);
    const [{ cost }] = await pgSql!`select total_cost_usd::float as cost from research_runs where id = ${run.id}`;
    assert.ok(cost > 0);
    assert.equal((await h.repo.listAccounts()).length, 5);
  });

  test("deleting a company deletes its runs, contacts, email and logs; row-level security is on", async () => {
    const h = await pgHarness();
    await h.samples();
    const uh = await h.byName("Upper Hunter Shire Council");
    await h.repo.deleteCompany(uh);
    for (const t of ["research_runs", "manual_contacts", "outreach_emails", "stage_logs"]) {
      const [{ n }] = await pgSql!.unsafe(`select count(*)::int as n from ${t} where company_id = '${uh}'`);
      assert.equal(n, 0, t);
    }
    const rls = await pgSql!`select relname, relrowsecurity from pg_class where relnamespace = ${schema}::regnamespace and relkind = 'r'`;
    assert.equal(rls.length, 5);
    assert.ok(rls.every((r) => r.relrowsecurity));
  });
});

after(async () => {
  if (pgSql && TEST_URL) {
    await pgSql.unsafe(`drop schema ${schema} cascade`);
    await pgSql.end();
  }
});
