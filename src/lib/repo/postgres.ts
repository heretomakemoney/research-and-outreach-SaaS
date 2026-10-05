// PostgreSQL implementation of the Repository (Supabase, used as plain PostgreSQL).
//
// SERVER ONLY. It needs DATABASE_URL, which holds the database password, so it is only ever imported by
// server code (the /api/repo route). The browser reaches it through repo/remote.ts.
//
// It follows the same rules as the in-memory repository (repo/memory.ts); repo/repository.test.ts runs
// the same tests against both.

import "server-only";
import postgres, { type JSONValue, type Sql, type TransactionSql } from "postgres";
import type { AccountRow, Company, ManualContact, OutreachEmail, ResearchRun, RunSummary, TopSignal } from "../domain";
import { totalCostUsd, totalSearches } from "../state";
import { deriveSummary } from "../summary";
import type { ContactChoice, StageLog } from "../types";
import { buildAccountRow } from "./accounts";
import type { StoreData } from "./memory";
import type { NewCompany, Repository, SelectionPatch } from "./types";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A run nobody has written to for this long is treated as abandoned (a stage takes at most ~5 minutes). */
export const ORPHAN_AFTER_MS = 8 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));
const json = (v: unknown) => v as JSONValue;

/** The table-not-created and cannot-connect cases get a plain-English message; nothing else is leaked. */
export function friendlyDbError(e: unknown): Error {
  const code = (e as { code?: string })?.code;
  if (code === "42P01") return new Error("The database tables are not set up yet. Run db/migrations/001_init.sql in the Supabase SQL Editor.");
  if (code === "28P01" || code === "28000") return new Error("The database rejected the login. Check DATABASE_URL (the password may be wrong).");
  if (code && /^(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|CONNECT_TIMEOUT|ECONNRESET|CONNECTION_)/.test(code)) {
    return new Error("Could not connect to the database. Check DATABASE_URL and that the Supabase project is running.");
  }
  return e instanceof Error ? e : new Error(String(e));
}

export function connect(url: string, options: postgres.Options<Record<string, never>> = {}): Sql {
  const local = /@(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/.test(url);
  return postgres(url, {
    prepare: false, // required by Supabase's transaction pooler
    ssl: local ? false : "require",
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
    ...options,
  });
}

// ------------------------------------------------------------------------------------------ row mapping

function companyFrom(r: Row): Company {
  return {
    id: r.id,
    name: r.name,
    website: r.website,
    context: r.context,
    contextUpdatedAt: iso(r.context_updated_at),
    selectedRunId: r.selected_run_id,
    selectedAngleKey: r.selected_angle_key,
    selectedPersonKey: r.selected_person_key,
    selectedManualContactId: r.selected_manual_contact_id,
    lastActivityAt: iso(r.last_activity_at),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function runFrom(r: Row): ResearchRun {
  const summary: RunSummary | null =
    r.verdict_line === null
      ? null
      : { overview: r.overview ?? "", industry: r.industry, clientType: r.client_type, topSignal: r.top_signal as TopSignal | null, verdictLine: r.verdict_line };
  return {
    id: r.id,
    companyId: r.company_id,
    status: r.status,
    statusReason: r.status_reason,
    companyNameSnapshot: r.company_name_snapshot,
    websiteSnapshot: r.website_snapshot,
    contextSnapshot: r.context_snapshot,
    topic: r.topic,
    startedAt: iso(r.started_at),
    finishedAt: isoOrNull(r.finished_at),
    aiMode: r.ai_mode,
    summary,
    research: r.research,
    next: r.next_step,
    gateLog: r.gate_log,
    synthesis: r.synthesis,
    synthesisLog: r.synthesis_log,
  };
}

function manualFrom(r: Row): ManualContact {
  return { id: r.id, companyId: r.company_id, name: r.name, role: r.role, createdAt: iso(r.created_at) };
}

function emailFrom(r: Row, logs: StageLog[]): OutreachEmail {
  const contact: ContactChoice =
    r.contact_origin === "researched"
      ? { source: "researched", personId: r.contact_person_key ?? "", name: r.contact_name, role: r.contact_role }
      : { source: "manual", name: r.contact_name, role: r.contact_role };
  return {
    id: r.id,
    companyId: r.company_id,
    runId: r.run_id ?? "",
    angleKey: r.angle_key,
    angleTitle: r.angle_title,
    angleStrength: r.angle_strength,
    contact,
    relationship: { kind: r.relationship_kind, note: r.relationship_note },
    subject: r.subject,
    body: r.body,
    generatedSubject: r.generated_subject,
    generatedBody: r.generated_body,
    usedCardIds: r.used_card_ids,
    basedOn: r.based_on,
    limitation: r.limitation,
    logs,
    generation: r.generation,
    generatedAt: iso(r.generated_at),
    editedAt: isoOrNull(r.edited_at),
    updatedAt: iso(r.updated_at),
  };
}

/** Columns of a run row from a ResearchRun (everything except id, company_id, seq). */
function runColumns(run: ResearchRun, updatedAt: string) {
  const synthCost = run.synthesisLog?.cost?.totalUsd ?? 0;
  return {
    status: run.status,
    status_reason: run.statusReason,
    company_name_snapshot: run.companyNameSnapshot,
    website_snapshot: run.websiteSnapshot,
    context_snapshot: run.contextSnapshot,
    topic: run.topic,
    started_at: run.startedAt,
    finished_at: run.finishedAt,
    updated_at: updatedAt,
    ai_mode: run.aiMode,
    overview: run.summary?.overview ?? null,
    industry: run.summary?.industry ?? null,
    client_type: run.summary?.clientType ?? null,
    top_signal: run.summary?.topSignal ?? null,
    verdict_line: run.summary?.verdictLine ?? null,
    total_cost_usd: Math.round((totalCostUsd(run.research) + synthCost) * 10000) / 10000,
    total_searches: totalSearches(run.research),
    research: json(run.research),
    synthesis: run.synthesis ? json(run.synthesis) : null,
    synthesis_log: run.synthesisLog ? json(run.synthesisLog) : null,
    gate_log: json(run.gateLog),
    next_step: run.next ? json(run.next) : null,
  };
}

/** The run keys a caller may change through updateRun. */
const RUN_PATCH_KEYS = [
  "status", "statusReason", "finishedAt", "summary", "research", "next", "gateLog", "synthesis", "synthesisLog",
] as const;

// ------------------------------------------------------------------------------------------ repository

export interface PostgresOptions {
  now?: () => Date;
  orphanAfterMs?: number;
}

export class PostgresRepository implements Repository {
  private sql: Sql;
  private now: () => Date;
  private orphanAfterMs: number;

  constructor(sql: Sql, options: PostgresOptions = {}) {
    this.sql = sql;
    this.now = options.now ?? (() => new Date());
    this.orphanAfterMs = options.orphanAfterMs ?? ORPHAN_AFTER_MS;
  }

  /** Changes are announced by the browser-side RemoteRepository; the server has nobody to notify. */
  subscribe(): () => void {
    return () => {};
  }

  private async guard<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (e) {
      throw friendlyDbError(e);
    }
  }

  private at() {
    return this.now().toISOString();
  }

  // ------------------------------------------------------------ companies

  async listAccounts(): Promise<AccountRow[]> {
    return this.guard(async () => {
      const rows = await this.sql<Row[]>`
        select c.id, c.name, c.website, c.last_activity_at,
               l.id as l_id, l.status as l_status, l.started_at as l_started, l.status_reason as l_reason,
               d.id as d_id, d.industry as d_industry, d.client_type as d_client, d.top_signal as d_signal, d.finished_at as d_finished
        from companies c
        left join lateral (
          select id, status, started_at, status_reason from research_runs r
          where r.company_id = c.id order by r.started_at desc, r.seq desc limit 1
        ) l on true
        left join lateral (
          select id, industry, client_type, top_signal, finished_at from research_runs r
          where r.company_id = c.id and r.status in ('done', 'partial')
          order by (r.status = 'done') desc, r.started_at desc, r.seq desc limit 1
        ) d on true
        order by c.last_activity_at desc`;
      const now = this.now();
      return rows.map((r) =>
        buildAccountRow(
          { id: r.id, name: r.name, website: r.website, lastActivityAt: iso(r.last_activity_at) },
          r.l_id ? { id: r.l_id, status: r.l_status, startedAt: iso(r.l_started), statusReason: r.l_reason } : null,
          r.d_id ? { id: r.d_id, industry: r.d_industry, clientType: r.d_client, topSignal: r.d_signal, finishedAt: isoOrNull(r.d_finished) } : null,
          now,
        ),
      );
    });
  }

  async getCompany(id: string): Promise<Company | null> {
    if (!isUuid(id)) return null;
    return this.guard(async () => {
      const [r] = await this.sql<Row[]>`select * from companies where id = ${id}`;
      return r ? companyFrom(r) : null;
    });
  }

  async findDuplicates(name: string, website: string): Promise<Company[]> {
    const n = name.trim().toLowerCase();
    const host = (u: string) => u.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    const w = host(website);
    return this.guard(async () => {
      const rows = await this.sql<Row[]>`select * from companies`;
      return rows.map(companyFrom).filter((c) => (n && c.name.trim().toLowerCase() === n) || (w && host(c.website) === w));
    });
  }

  async createCompany(input: NewCompany): Promise<Company> {
    const name = input.name.trim();
    if (!name) throw new Error("Company name is required.");
    return this.guard(async () => {
      const at = this.at();
      const [r] = await this.sql<Row[]>`
        insert into companies (name, website, context, context_updated_at, last_activity_at, created_at, updated_at)
        values (${name.slice(0, 200)}, ${input.website.trim().slice(0, 300)}, ${input.context.trim().slice(0, 4000)}, ${at}, ${at}, ${at}, ${at})
        returning *`;
      return companyFrom(r);
    });
  }

  async updateCompany(id: string, patch: Partial<Pick<Company, "name" | "website" | "context">>): Promise<Company> {
    return this.guard(async () => {
      const current = await this.mustCompany(id);
      const at = this.at();
      const name = patch.name !== undefined ? patch.name.trim().slice(0, 200) : current.name;
      if (!name) throw new Error("Company name is required.");
      const website = patch.website !== undefined ? patch.website.trim().slice(0, 300) : current.website;
      const context = patch.context !== undefined ? patch.context.trim().slice(0, 4000) : current.context;
      const contextAt = patch.context !== undefined ? at : current.contextUpdatedAt;
      const [r] = await this.sql<Row[]>`
        update companies set name = ${name}, website = ${website}, context = ${context},
          context_updated_at = ${contextAt}, updated_at = ${at}
        where id = ${id} returning *`;
      return companyFrom(r);
    });
  }

  async setSelection(id: string, patch: SelectionPatch): Promise<Company> {
    return this.guard(async () => {
      const c = await this.mustCompany(id);
      let { selectedRunId, selectedAngleKey, selectedPersonKey, selectedManualContactId } = c;
      if (patch.runId !== undefined) selectedRunId = patch.runId;
      if (patch.angleKey !== undefined) selectedAngleKey = patch.angleKey;
      if (patch.personKey !== undefined) {
        selectedPersonKey = patch.personKey;
        if (patch.personKey) selectedManualContactId = null; // at most one contact
      }
      if (patch.manualContactId !== undefined) {
        selectedManualContactId = patch.manualContactId;
        if (patch.manualContactId) selectedPersonKey = null;
      }
      if (selectedRunId !== null && !isUuid(selectedRunId)) selectedRunId = null;
      if (selectedManualContactId !== null && !isUuid(selectedManualContactId)) selectedManualContactId = null;
      const [r] = await this.sql<Row[]>`
        update companies set selected_run_id = ${selectedRunId}, selected_angle_key = ${selectedAngleKey},
          selected_person_key = ${selectedPersonKey}, selected_manual_contact_id = ${selectedManualContactId}, updated_at = ${this.at()}
        where id = ${id} returning *`;
      return companyFrom(r);
    });
  }

  async deleteCompany(id: string): Promise<void> {
    if (!isUuid(id)) return;
    await this.guard(async () => {
      const [running] = await this.sql<Row[]>`select 1 from research_runs where company_id = ${id} and status = 'researching' limit 1`;
      if (running) throw new Error("This company is being researched right now. Wait for it to finish.");
      await this.sql`delete from companies where id = ${id}`; // runs, contacts, email and logs go with it
    });
  }

  private async mustCompany(id: string): Promise<Company> {
    const c = isUuid(id) ? await this.getCompanyRaw(id) : null;
    if (!c) throw new Error("That company no longer exists.");
    return c;
  }
  private async getCompanyRaw(id: string): Promise<Company | null> {
    const [r] = await this.sql<Row[]>`select * from companies where id = ${id}`;
    return r ? companyFrom(r) : null;
  }

  // ------------------------------------------------------------ runs

  async createRun(companyId: string, input: { topic: string; aiMode: ResearchRun["aiMode"] }): Promise<ResearchRun> {
    return this.guard(async () => {
      const c = await this.mustCompany(companyId);
      const topic = input.topic.trim().slice(0, 1000);
      const at = this.at();
      const run: ResearchRun = {
        id: "",
        companyId,
        status: "researching",
        statusReason: null,
        companyNameSnapshot: c.name,
        websiteSnapshot: c.website,
        contextSnapshot: c.context,
        topic,
        startedAt: at,
        finishedAt: null,
        aiMode: input.aiMode,
        summary: null,
        research: {
          input: { companyName: c.name, website: c.website, context: c.context, topic },
          entity: null, cards: [], people: [], leads: [], coverage: [], relevance: null, sources: [], followupRounds: 0, stages: [],
        },
        next: null,
        gateLog: [],
        synthesis: null,
        synthesisLog: null,
      };
      return this.sql.begin(async (tx) => {
        const [running] = await tx<Row[]>`select 1 from research_runs where company_id = ${companyId} and status = 'researching' limit 1 for update`;
        if (running) throw new Error("Research is already running for this company.");
        const cols = runColumns(run, at);
        const [r] = await tx<Row[]>`insert into research_runs ${tx({ company_id: companyId, ...cols })} returning *`;
        await tx`update companies set last_activity_at = ${at} where id = ${companyId}`;
        return runFrom(r);
      });
    });
  }

  async updateRun(runId: string, patch: Partial<Omit<ResearchRun, "id" | "companyId">>): Promise<ResearchRun> {
    return this.guard(async () => {
      if (!isUuid(runId)) throw new Error("That research run no longer exists.");
      return this.sql.begin(async (tx) => {
        const [row] = await tx<Row[]>`select * from research_runs where id = ${runId} for update`;
        if (!row) throw new Error("That research run no longer exists.");
        const run = runFrom(row);
        if (run.status !== "researching" && patch.research !== undefined) throw new Error("A finished research run cannot be changed.");
        const at = this.at();
        const allowed: Record<string, unknown> = {};
        for (const k of RUN_PATCH_KEYS) if (k in patch) allowed[k] = (patch as Record<string, unknown>)[k];
        Object.assign(run, allowed);
        const finishing = patch.status !== undefined && patch.status !== "researching";
        if (finishing && !run.summary) run.summary = deriveSummary(run.research, run.synthesis);
        const [r] = await tx<Row[]>`update research_runs set ${tx(runColumns(run, at))} where id = ${runId} returning *`;
        if (finishing) await tx`update companies set last_activity_at = ${at} where id = ${run.companyId}`;
        await this.recordLogs(tx, run.companyId, run.id, [...run.research.stages, ...(run.synthesisLog ? [run.synthesisLog] : [])]);
        return runFrom(r);
      });
    });
  }

  /** Copies each stage log into stage_logs once (append-only). */
  private async recordLogs(tx: TransactionSql, companyId: string, runId: string | null, logs: StageLog[]) {
    for (const l of logs) {
      await tx`
        insert into stage_logs (company_id, run_id, stage, round, model, cost_usd, duration_ms, started_at, log)
        values (${companyId}, ${runId}, ${l.stage}, ${l.round}, ${l.model}, ${l.cost?.totalUsd ?? 0}, ${Math.round(l.durationMs ?? 0)}, ${l.startedAt}, ${tx.json(json(l))})
        on conflict (company_id, stage, round, started_at) do nothing`;
    }
  }

  async getRun(runId: string): Promise<ResearchRun | null> {
    if (!isUuid(runId)) return null;
    return this.guard(async () => {
      const [r] = await this.sql<Row[]>`select * from research_runs where id = ${runId}`;
      return r ? runFrom(r) : null;
    });
  }

  async getLatestRun(companyId: string): Promise<ResearchRun | null> {
    if (!isUuid(companyId)) return null;
    return this.guard(async () => {
      const [r] = await this.sql<Row[]>`select * from research_runs where company_id = ${companyId} order by started_at desc, seq desc limit 1`;
      return r ? runFrom(r) : null;
    });
  }

  async getDefaultRun(companyId: string): Promise<ResearchRun | null> {
    if (!isUuid(companyId)) return null;
    return this.guard(async () => {
      const [r] = await this.sql<Row[]>`
        select * from research_runs where company_id = ${companyId} and status in ('done', 'partial')
        order by (status = 'done') desc, started_at desc, seq desc limit 1`;
      return r ? runFrom(r) : null;
    });
  }

  async closeOrphanedRuns(activeRunIds: string[]): Promise<void> {
    await this.guard(async () => {
      const cutoff = new Date(this.now().getTime() - this.orphanAfterMs).toISOString();
      const rows = await this.sql<Row[]>`select id from research_runs where status = 'researching' and updated_at < ${cutoff}`;
      for (const { id } of rows) {
        if (activeRunIds.includes(id)) continue;
        await this.sql.begin(async (tx) => {
          const [row] = await tx<Row[]>`select * from research_runs where id = ${id} and status = 'researching' for update`;
          if (!row) return;
          const run = runFrom(row);
          const hasResults = run.research.cards.length > 0 || !!run.research.entity;
          const at = this.at();
          run.status = hasResults ? "partial" : "failed";
          run.statusReason = "Research was interrupted before it finished (the page was closed or refreshed).";
          run.finishedAt = at;
          run.summary = deriveSummary(run.research, run.synthesis);
          await tx`update research_runs set ${tx(runColumns(run, at))} where id = ${id}`;
          await tx`update companies set last_activity_at = ${at} where id = ${run.companyId}`;
        });
      }
    });
  }

  // ------------------------------------------------------------ contacts and email

  async listManualContacts(companyId: string): Promise<ManualContact[]> {
    if (!isUuid(companyId)) return [];
    return this.guard(async () => {
      const rows = await this.sql<Row[]>`select * from manual_contacts where company_id = ${companyId} order by created_at, id`;
      return rows.map(manualFrom);
    });
  }

  async addManualContact(companyId: string, input: { name: string; role: string }): Promise<ManualContact> {
    return this.guard(async () => {
      await this.mustCompany(companyId);
      const name = input.name.trim();
      if (!name) throw new Error("Enter the contact's name.");
      const role = input.role.trim().slice(0, 160);
      const [created] = await this.sql<Row[]>`
        insert into manual_contacts (company_id, name, role, created_at) values (${companyId}, ${name.slice(0, 120)}, ${role}, ${this.at()})
        on conflict do nothing returning *`;
      if (created) return manualFrom(created);
      const [existing] = await this.sql<Row[]>`
        select * from manual_contacts where company_id = ${companyId} and lower(name) = lower(${name.slice(0, 120)}) and lower(role) = lower(${role})`;
      return manualFrom(existing);
    });
  }

  async getEmail(companyId: string): Promise<OutreachEmail | null> {
    if (!isUuid(companyId)) return null;
    return this.guard(async () => {
      const [r] = await this.sql<Row[]>`select * from outreach_emails where company_id = ${companyId}`;
      if (!r) return null;
      const logs = await this.sql<Row[]>`select log from stage_logs where company_id = ${companyId} and stage = 'email' order by started_at, round`;
      return emailFrom(r, logs.map((l) => l.log as StageLog));
    });
  }

  async saveEmail(email: OutreachEmail): Promise<OutreachEmail> {
    return this.guard(async () => {
      await this.mustCompany(email.companyId);
      const at = this.at();
      const runId = isUuid(email.runId) ? email.runId : null;
      const contactPersonKey = email.contact.source === "researched" ? email.contact.personId : null;
      const cols = {
        company_id: email.companyId,
        run_id: runId,
        angle_key: email.angleKey,
        angle_title: email.angleTitle,
        angle_strength: email.angleStrength,
        contact_origin: email.contact.source,
        contact_name: email.contact.name,
        contact_role: email.contact.role,
        contact_person_key: contactPersonKey,
        relationship_kind: email.relationship.kind,
        relationship_note: email.relationship.note,
        subject: email.subject,
        body: email.body,
        generated_subject: email.generatedSubject,
        generated_body: email.generatedBody,
        used_card_ids: json(email.usedCardIds),
        based_on: json(email.basedOn),
        limitation: email.limitation,
        generation: email.generation,
        generated_at: email.generatedAt,
        edited_at: email.editedAt,
        updated_at: at,
      };
      return this.sql.begin(async (tx) => {
        const [r] = await tx<Row[]>`
          insert into outreach_emails ${tx(cols)}
          on conflict (company_id) do update set ${tx(cols, ...(Object.keys(cols).filter((k) => k !== "company_id") as (keyof typeof cols)[]))}
          returning *`;
        await tx`update companies set last_activity_at = ${at} where id = ${email.companyId}`;
        await this.recordLogs(tx, email.companyId, null, email.logs);
        const logs = await tx<Row[]>`select log from stage_logs where company_id = ${email.companyId} and stage = 'email' order by started_at, round`;
        return emailFrom(r, logs.map((l) => l.log as StageLog));
      });
    });
  }

  // ------------------------------------------------------------ sample data

  /**
   * Adds sample accounts (mock data only). Companies whose name already exists are skipped. Every id is
   * replaced with a new UUID, because the sample ids are readable words. Returns how many were added.
   */
  async importSample(data: StoreData): Promise<number> {
    return this.guard(async () => {
      const existing = new Set((await this.sql<Row[]>`select lower(name) as n from companies`).map((r) => r.n as string));
      const fresh = data.companies.filter((c) => !existing.has(c.name.trim().toLowerCase()));
      if (fresh.length === 0) return 0;
      const ids = new Map<string, string>();
      const newId = (old: string) => {
        if (!ids.has(old)) ids.set(old, crypto.randomUUID());
        return ids.get(old)!;
      };
      await this.sql.begin(async (tx) => {
        for (const c of fresh) {
          const runs = data.runs.filter((r) => r.companyId === c.id);
          const contacts = data.contacts.filter((m) => m.companyId === c.id);
          const email = data.emails.find((e) => e.companyId === c.id) ?? null;
          await tx`insert into companies (id, name, website, context, context_updated_at, last_activity_at, created_at, updated_at)
            values (${newId(c.id)}, ${c.name}, ${c.website}, ${c.context}, ${c.contextUpdatedAt}, ${c.lastActivityAt}, ${c.createdAt}, ${c.updatedAt})`;
          for (const r of runs) {
            const run = { ...r, id: newId(r.id), companyId: newId(c.id) };
            await tx`insert into research_runs ${tx({ id: run.id, company_id: run.companyId, ...runColumns(run, run.finishedAt ?? run.startedAt) })}`;
            await this.recordLogs(tx, run.companyId, run.id, [...run.research.stages, ...(run.synthesisLog ? [run.synthesisLog] : [])]);
          }
          for (const m of contacts) {
            await tx`insert into manual_contacts (id, company_id, name, role, created_at) values (${newId(m.id)}, ${newId(c.id)}, ${m.name}, ${m.role}, ${m.createdAt})`;
          }
          await tx`update companies set selected_run_id = ${c.selectedRunId ? newId(c.selectedRunId) : null}, selected_angle_key = ${c.selectedAngleKey},
            selected_person_key = ${c.selectedPersonKey}, selected_manual_contact_id = ${c.selectedManualContactId ? newId(c.selectedManualContactId) : null}
            where id = ${newId(c.id)}`;
          if (email) {
            const saved = { ...email, id: newId(email.id), companyId: newId(c.id), runId: newId(email.runId) };
            const cols = {
              id: saved.id, company_id: saved.companyId, run_id: saved.runId, angle_key: saved.angleKey, angle_title: saved.angleTitle,
              angle_strength: saved.angleStrength, contact_origin: saved.contact.source, contact_name: saved.contact.name, contact_role: saved.contact.role,
              contact_person_key: saved.contact.source === "researched" ? saved.contact.personId : null,
              relationship_kind: saved.relationship.kind, relationship_note: saved.relationship.note, subject: saved.subject, body: saved.body,
              generated_subject: saved.generatedSubject, generated_body: saved.generatedBody, used_card_ids: json(saved.usedCardIds), based_on: json(saved.basedOn),
              limitation: saved.limitation, generation: saved.generation, generated_at: saved.generatedAt, edited_at: saved.editedAt, updated_at: saved.updatedAt,
            };
            await tx`insert into outreach_emails ${tx(cols)}`;
            await this.recordLogs(tx, saved.companyId, null, saved.logs);
          }
        }
      });
      return fresh.length;
    });
  }
}
