// The REPOSITORY: the only thing the UI uses to read and write companies, runs, contacts and emails.
//
// The UI never touches localStorage or a database. Today the implementation is an in-memory store that
// keeps a snapshot in the browser (repo/memory.ts + repo/browser.ts). In Step 3 a PostgreSQL-backed
// implementation (reached through server routes) replaces it in ONE place.
//
// Every method is async so callers already behave as they will with a network database.

import type { AccountRow, Company, ManualContact, OutreachEmail, ResearchRun } from "../domain";

export interface NewCompany {
  name: string;
  website: string;
  context: string;
}

export interface SelectionPatch {
  /** undefined = leave unchanged, null = clear. */
  runId?: string | null;
  angleKey?: string | null;
  personKey?: string | null;
  manualContactId?: string | null;
}

export interface Repository {
  /** Called after any change. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;

  // companies
  listAccounts(): Promise<AccountRow[]>;
  getCompany(id: string): Promise<Company | null>;
  findDuplicates(name: string, website: string): Promise<Company[]>;
  createCompany(input: NewCompany): Promise<Company>;
  updateCompany(id: string, patch: Partial<Pick<Company, "name" | "website" | "context">>): Promise<Company>;
  setSelection(id: string, patch: SelectionPatch): Promise<Company>;
  deleteCompany(id: string): Promise<void>;

  // research runs (never deleted except with their company)
  createRun(companyId: string, input: { topic: string; aiMode: ResearchRun["aiMode"] }): Promise<ResearchRun>;
  updateRun(runId: string, patch: Partial<Omit<ResearchRun, "id" | "companyId">>): Promise<ResearchRun>;
  getRun(runId: string): Promise<ResearchRun | null>;
  getLatestRun(companyId: string): Promise<ResearchRun | null>;
  getDefaultRun(companyId: string): Promise<ResearchRun | null>;
  /** Marks runs still "researching" that nothing is driving any more (tab closed) as partial or failed. */
  closeOrphanedRuns(activeRunIds: string[]): Promise<void>;

  // contacts
  listManualContacts(companyId: string): Promise<ManualContact[]>;
  addManualContact(companyId: string, input: { name: string; role: string }): Promise<ManualContact>;

  // the one current email
  getEmail(companyId: string): Promise<OutreachEmail | null>;
  saveEmail(email: OutreachEmail): Promise<OutreachEmail>;
}
