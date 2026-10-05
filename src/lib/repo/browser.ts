// The repository the browser uses today: the in-memory repository plus a snapshot kept in
// localStorage, so sample data and anything you add survive a page refresh.
//
// This is a stand-in. In Step 3 it is replaced by a repository that talks to PostgreSQL through server
// routes. Screens only ever call getRepository() and the Repository methods, so they will not change.
//
// Browser only. No API key is ever stored here.

import { MemoryRepository, emptyStore, type StoreData } from "./memory";

const KEY = "ror:v3:store";

let instance: MemoryRepository | null = null;
let persistError: string | null = null;

export function getPersistError(): string | null {
  return persistError;
}

function load(): StoreData {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as StoreData;
    if (!parsed || !Array.isArray(parsed.companies) || !Array.isArray(parsed.runs)) return emptyStore();
    return { companies: parsed.companies, runs: parsed.runs, contacts: parsed.contacts ?? [], emails: parsed.emails ?? [] };
  } catch {
    return emptyStore(); // unreadable data is treated as empty rather than crashing the page
  }
}

function persist(data: StoreData) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(data));
    persistError = null;
  } catch {
    persistError = "Browser storage is full or blocked, so your latest change is not saved. Delete a company you no longer need.";
  }
}

export function getRepository(): MemoryRepository {
  if (!instance) instance = new MemoryRepository(load(), { onChange: persist });
  return instance;
}

/** Replace everything with the sample data (Upper Hunter fixture + clearly fake accounts). Mock data only. */
export async function loadSampleData(): Promise<void> {
  const { buildSeedData } = await import("../mock/seed");
  getRepository().replaceAll(buildSeedData());
}

export function clearAllData(): void {
  getRepository().replaceAll(emptyStore());
}
