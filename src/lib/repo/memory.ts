// In-memory implementation of the Repository. All the rules live here (default run, account rows,
// cascade delete, selection handling), so the same behaviour can be re-implemented for PostgreSQL and
// checked against the same tests.
//
// It keeps its data in plain objects. `onChange` lets a wrapper persist a snapshot (repo/browser.ts).
// No browser or server APIs are used, so it is unit-tested directly (memory.test.ts).

import type { AccountRow, Company, ManualContact, OutreachEmail, ResearchRun } from "../domain";
import { newestFirst, pickDefaultRun } from "../summary";
import { deriveSummary } from "../summary";
import type { NewCompany, Repository, SelectionPatch } from "./types";

export interface StoreData {
  companies: Company[];
  runs: ResearchRun[];
  contacts: ManualContact[];
  emails: OutreachEmail[];
}

export const emptyStore = (): StoreData => ({ companies: [], runs: [], contacts: [], emails: [] });

export interface MemoryOptions {
  now?: () => Date;
  newId?: () => string;
  onChange?: (data: StoreData) => void;
}

export function minutesAgo(then: string, now: Date): string {
  const m = Math.max(0, Math.round((now.getTime() - new Date(then).getTime()) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function shortReason(run: ResearchRun): string {
  const r = run.statusReason ?? "";
  if (/unclear|ambiguous/i.test(r)) return "Company unclear";
  if (/not found|no matching/i.test(r)) return "Company not found";
  if (run.status === "partial") return "Incomplete results";
  if (run.status === "failed") return "No usable results";
  return "";
}

export class MemoryRepository implements Repository {
  private data: StoreData;
  private listeners = new Set<() => void>();
  private now: () => Date;
  private newId: () => string;
  private onChange?: (data: StoreData) => void;

  constructor(initial: StoreData = emptyStore(), options: MemoryOptions = {}) {
    this.data = structuredClone(initial);
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.onChange = options.onChange;
  }

  /** Replace everything (used to load a saved snapshot or sample data). */
  replaceAll(data: StoreData) {
    this.data = structuredClone(data);
    this.changed();
  }

  /** A copy of everything, for saving. */
  snapshot(): StoreData {
    return structuredClone(this.data);
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private changed() {
    this.onChange?.(this.data);
    for (const l of [...this.listeners]) l();
  }

  private iso() {
    return this.now().toISOString();
  }

  private runsOf(companyId: string) {
    return this.data.runs.filter((r) => r.companyId === companyId);
  }

  private mustCompany(id: string): Company {
    const c = this.data.companies.find((x) => x.id === id);
    if (!c) throw new Error("That company no longer exists.");
    return c;
  }

  // ------------------------------------------------------------ companies

  async listAccounts(): Promise<AccountRow[]> {
    const now = this.now();
    return this.data.companies.map((c) => {
      const runs = this.runsOf(c.id);
      const latest = newestFirst(runs)[0] ?? null;
      const def = pickDefaultRun(runs);
      const status = latest ? latest.status : "not_researched";
      let statusDetail = "";
      if (latest?.status === "researching") {
        statusDetail = `Started ${minutesAgo(latest.startedAt, now)}${def ? ". Earlier research available" : ""}`;
      } else if (latest && latest.status !== "done") {
        statusDetail = shortReason(latest);
      }
      return {
        id: c.id,
        name: c.name,
        website: c.website,
        status,
        statusDetail,
        hasEarlierResearch: !!def && latest?.id !== def.id,
        industry: def?.summary?.industry ?? null,
        clientType: def?.summary?.clientType ?? null,
        topSignal: def?.summary?.topSignal ?? null,
        lastResearchedAt: def?.finishedAt ?? null,
        lastActivityAt: c.lastActivityAt,
      };
    });
  }

  async getCompany(id: string) {
    const c = this.data.companies.find((x) => x.id === id);
    return c ? structuredClone(c) : null;
  }

  async findDuplicates(name: string, website: string) {
    const n = name.trim().toLowerCase();
    const host = (u: string) => u.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    const w = host(website);
    return this.data.companies
      .filter((c) => (n && c.name.trim().toLowerCase() === n) || (w && host(c.website) === w))
      .map((c) => structuredClone(c));
  }

  async createCompany(input: NewCompany) {
    const name = input.name.trim();
    if (!name) throw new Error("Company name is required.");
    const at = this.iso();
    const company: Company = {
      id: this.newId(),
      name: name.slice(0, 200),
      website: input.website.trim().slice(0, 300),
      context: input.context.trim().slice(0, 4000),
      contextUpdatedAt: at,
      selectedRunId: null,
      selectedAngleKey: null,
      selectedPersonKey: null,
      selectedManualContactId: null,
      lastActivityAt: at,
      createdAt: at,
      updatedAt: at,
    };
    this.data.companies.push(company);
    this.changed();
    return structuredClone(company);
  }

  async updateCompany(id: string, patch: Partial<Pick<Company, "name" | "website" | "context">>) {
    const c = this.mustCompany(id);
    const at = this.iso();
    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new Error("Company name is required.");
      c.name = patch.name.trim().slice(0, 200);
    }
    if (patch.website !== undefined) c.website = patch.website.trim().slice(0, 300);
    if (patch.context !== undefined) {
      c.context = patch.context.trim().slice(0, 4000);
      c.contextUpdatedAt = at;
    }
    c.updatedAt = at;
    this.changed();
    return structuredClone(c);
  }

  async setSelection(id: string, patch: SelectionPatch) {
    const c = this.mustCompany(id);
    if (patch.runId !== undefined) c.selectedRunId = patch.runId;
    if (patch.angleKey !== undefined) c.selectedAngleKey = patch.angleKey;
    if (patch.personKey !== undefined) {
      c.selectedPersonKey = patch.personKey;
      if (patch.personKey) c.selectedManualContactId = null; // at most one contact
    }
    if (patch.manualContactId !== undefined) {
      c.selectedManualContactId = patch.manualContactId;
      if (patch.manualContactId) c.selectedPersonKey = null;
    }
    c.updatedAt = this.iso();
    this.changed();
    return structuredClone(c);
  }

  async deleteCompany(id: string) {
    const running = this.runsOf(id).some((r) => r.status === "researching");
    if (running) throw new Error("This company is being researched right now. Wait for it to finish.");
    this.data.companies = this.data.companies.filter((c) => c.id !== id);
    this.data.runs = this.data.runs.filter((r) => r.companyId !== id);
    this.data.contacts = this.data.contacts.filter((m) => m.companyId !== id);
    this.data.emails = this.data.emails.filter((e) => e.companyId !== id);
    this.changed();
  }

  // ------------------------------------------------------------ runs

  async createRun(companyId: string, input: { topic: string; aiMode: ResearchRun["aiMode"] }) {
    const c = this.mustCompany(companyId);
    if (this.runsOf(companyId).some((r) => r.status === "researching")) {
      throw new Error("Research is already running for this company.");
    }
    const at = this.iso();
    const topic = input.topic.trim().slice(0, 1000);
    const run: ResearchRun = {
      id: this.newId(),
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
        entity: null,
        cards: [],
        people: [],
        leads: [],
        coverage: [],
        relevance: null,
        sources: [],
        followupRounds: 0,
        stages: [],
      },
      next: null,
      gateLog: [],
      synthesis: null,
      synthesisLog: null,
    };
    this.data.runs.push(run);
    c.lastActivityAt = at;
    this.changed();
    return structuredClone(run);
  }

  async updateRun(runId: string, patch: Partial<Omit<ResearchRun, "id" | "companyId">>) {
    const r = this.data.runs.find((x) => x.id === runId);
    if (!r) throw new Error("That research run no longer exists.");
    if (r.status !== "researching" && patch.research !== undefined) {
      throw new Error("A finished research run cannot be changed.");
    }
    Object.assign(r, structuredClone(patch));
    if (patch.status && patch.status !== "researching") {
      const c = this.data.companies.find((x) => x.id === r.companyId);
      if (c) c.lastActivityAt = this.iso();
      if (!r.summary) r.summary = deriveSummary(r.research, r.synthesis);
    }
    this.changed();
    return structuredClone(r);
  }

  async getRun(runId: string) {
    const r = this.data.runs.find((x) => x.id === runId);
    return r ? structuredClone(r) : null;
  }

  async getLatestRun(companyId: string) {
    const r = newestFirst(this.runsOf(companyId))[0];
    return r ? structuredClone(r) : null;
  }

  async getDefaultRun(companyId: string) {
    const r = pickDefaultRun(this.runsOf(companyId));
    return r ? structuredClone(r) : null;
  }

  async closeOrphanedRuns(activeRunIds: string[]) {
    let touched = false;
    for (const r of this.data.runs) {
      if (r.status !== "researching" || activeRunIds.includes(r.id)) continue;
      const hasResults = r.research.cards.length > 0 || !!r.research.entity;
      r.status = hasResults ? "partial" : "failed";
      r.statusReason = "Research was interrupted before it finished (the page was closed or refreshed).";
      r.finishedAt = this.iso();
      r.summary = deriveSummary(r.research, r.synthesis);
      touched = true;
    }
    if (touched) this.changed();
  }

  // ------------------------------------------------------------ contacts and email

  async listManualContacts(companyId: string) {
    return this.data.contacts.filter((m) => m.companyId === companyId).map((m) => structuredClone(m));
  }

  async addManualContact(companyId: string, input: { name: string; role: string }) {
    this.mustCompany(companyId);
    const name = input.name.trim();
    if (!name) throw new Error("Enter the contact's name.");
    const existing = this.data.contacts.find(
      (m) => m.companyId === companyId && m.name.toLowerCase() === name.toLowerCase() && m.role.toLowerCase() === input.role.trim().toLowerCase(),
    );
    if (existing) return structuredClone(existing);
    const m: ManualContact = { id: this.newId(), companyId, name: name.slice(0, 120), role: input.role.trim().slice(0, 160), createdAt: this.iso() };
    this.data.contacts.push(m);
    this.changed();
    return structuredClone(m);
  }

  async getEmail(companyId: string) {
    const e = this.data.emails.find((x) => x.companyId === companyId);
    return e ? structuredClone(e) : null;
  }

  async saveEmail(email: OutreachEmail) {
    this.mustCompany(email.companyId);
    const copy = structuredClone(email);
    copy.updatedAt = this.iso();
    const i = this.data.emails.findIndex((x) => x.companyId === email.companyId);
    if (i >= 0) this.data.emails[i] = copy;
    else this.data.emails.push(copy);
    const c = this.data.companies.find((x) => x.id === email.companyId);
    if (c) c.lastActivityAt = copy.updatedAt;
    this.changed();
    return structuredClone(copy);
  }
}
