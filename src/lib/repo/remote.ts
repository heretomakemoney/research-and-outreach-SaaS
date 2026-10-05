// The repository the browser uses: every call goes to the server (/api/repo), which talks to PostgreSQL.
// The browser never holds a connection string or a password.
//
// Browser only. subscribe() lets screens refresh after any change made in this tab, and again when the
// tab becomes visible (so changes made on another device show up).

import type { AccountRow, Company, ManualContact, OutreachEmail, ResearchRun } from "../domain";
import type { NewCompany, Repository, SelectionPatch } from "./types";

type CallFn = (method: string, args: unknown[]) => Promise<unknown>;

const httpRepoCall: CallFn = async (method, args) => {
  let response: Response;
  try {
    response = await fetch("/api/repo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method, args }) });
  } catch {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  const data = (await response.json().catch(() => null)) as { ok?: boolean; result?: unknown; error?: string } | null;
  if (!data || data.ok !== true) throw new Error(data?.error ?? `The server did not return a usable answer (HTTP ${response.status}).`);
  return data.result;
};

export class RemoteRepository implements Repository {
  private listeners = new Set<() => void>();
  private call: CallFn;

  constructor(call: CallFn = httpRepoCall) {
    this.call = call;
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && this.notify());
    }
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private notify() {
    for (const l of [...this.listeners]) l();
  }
  private async read<T>(method: string, ...args: unknown[]): Promise<T> {
    return (await this.call(method, args)) as T;
  }
  private async write<T>(method: string, ...args: unknown[]): Promise<T> {
    try {
      return (await this.call(method, args)) as T;
    } finally {
      this.notify(); // also after a failure: the screen may be out of date
    }
  }

  listAccounts() { return this.read<AccountRow[]>("listAccounts"); }
  getCompany(id: string) { return this.read<Company | null>("getCompany", id); }
  findDuplicates(name: string, website: string) { return this.read<Company[]>("findDuplicates", name, website); }
  createCompany(input: NewCompany) { return this.write<Company>("createCompany", input); }
  updateCompany(id: string, patch: Partial<Pick<Company, "name" | "website" | "context">>) { return this.write<Company>("updateCompany", id, patch); }
  setSelection(id: string, patch: SelectionPatch) { return this.write<Company>("setSelection", id, patch); }
  deleteCompany(id: string) { return this.write<void>("deleteCompany", id); }
  createRun(companyId: string, input: { topic: string; aiMode: ResearchRun["aiMode"] }) { return this.write<ResearchRun>("createRun", companyId, input); }
  updateRun(runId: string, patch: Partial<Omit<ResearchRun, "id" | "companyId">>) { return this.write<ResearchRun>("updateRun", runId, patch); }
  getRun(runId: string) { return this.read<ResearchRun | null>("getRun", runId); }
  getLatestRun(companyId: string) { return this.read<ResearchRun | null>("getLatestRun", companyId); }
  getDefaultRun(companyId: string) { return this.read<ResearchRun | null>("getDefaultRun", companyId); }
  closeOrphanedRuns(activeRunIds: string[]) { return this.write<void>("closeOrphanedRuns", activeRunIds); }
  listManualContacts(companyId: string) { return this.read<ManualContact[]>("listManualContacts", companyId); }
  addManualContact(companyId: string, input: { name: string; role: string }) { return this.write<ManualContact>("addManualContact", companyId, input); }
  getEmail(companyId: string) { return this.read<OutreachEmail | null>("getEmail", companyId); }
  saveEmail(email: OutreachEmail) { return this.write<OutreachEmail>("saveEmail", email); }

  /** Mock mode only (the server refuses otherwise). Returns how many accounts were added. */
  addSampleAccounts() { return this.write<number>("addSampleAccounts"); }
}
