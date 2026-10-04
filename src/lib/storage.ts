// The STORAGE LAYER (browser).
//
// Screens call the functions at the bottom of this file and never touch
// localStorage themselves. Only this file knows where data actually lives.
// Later we can write a second implementation that talks to a real database
// (through server routes) and switch to it in ONE place. Screens won't change.
//
// Every function is async (returns a promise) even though localStorage is
// instant. That way, callers already work the way they will with a database.
//
// Browser only. Never put the API key here. It never reaches the browser.

import type { StoredCompany, StoredResearch } from "./types";

/** What any storage implementation must be able to do. */
export interface Storage {
  saveCompany(company: StoredCompany): Promise<void>;
  getCompany(id: string): Promise<StoredCompany | null>;
  findCompanyByName(name: string): Promise<StoredCompany | null>;
  listCompanies(): Promise<StoredCompany[]>;
  saveResearch(research: StoredResearch): Promise<void>;
  getResearch(id: string): Promise<StoredResearch | null>;
  listResearch(): Promise<StoredResearch[]>; // newest first
  clearAll(): Promise<void>;
}

export class StorageFullError extends Error {
  constructor() {
    super("Browser storage is full. Clear some saved data (button at the bottom of the page) and try again.");
  }
}

const KEY_COMPANIES = "ror:v1:companies";
const KEY_RESEARCH = "ror:v1:research";
const MAX_SAVED_RESEARCH = 30; // keep the newest 30 so we stay under the browser limit

function readList<T>(key: string): T[] {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return []; // unreadable data is treated as empty rather than crashing the page
  }
}

function writeList<T>(key: string, list: T[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    throw new StorageFullError();
  }
}

const localStorageImplementation: Storage = {
  async saveCompany(company) {
    const list = readList<StoredCompany>(KEY_COMPANIES).filter((c) => c.id !== company.id);
    list.push(company);
    writeList(KEY_COMPANIES, list);
  },
  async getCompany(id) {
    return readList<StoredCompany>(KEY_COMPANIES).find((c) => c.id === id) ?? null;
  },
  async findCompanyByName(name) {
    const wanted = name.trim().toLowerCase();
    return readList<StoredCompany>(KEY_COMPANIES).find((c) => c.name.trim().toLowerCase() === wanted) ?? null;
  },
  async listCompanies() {
    return readList<StoredCompany>(KEY_COMPANIES);
  },
  async saveResearch(research) {
    const list = readList<StoredResearch>(KEY_RESEARCH).filter((r) => r.id !== research.id);
    list.push(research);
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    writeList(KEY_RESEARCH, list.slice(0, MAX_SAVED_RESEARCH));
  },
  async getResearch(id) {
    return readList<StoredResearch>(KEY_RESEARCH).find((r) => r.id === id) ?? null;
  },
  async listResearch() {
    return readList<StoredResearch>(KEY_RESEARCH).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async clearAll() {
    window.localStorage.removeItem(KEY_COMPANIES);
    window.localStorage.removeItem(KEY_RESEARCH);
  },
};

// The one place that chooses the implementation. Swap it here in Phase 2.
const active: Storage = localStorageImplementation;

export const saveCompany = (c: StoredCompany) => active.saveCompany(c);
export const getCompany = (id: string) => active.getCompany(id);
export const findCompanyByName = (name: string) => active.findCompanyByName(name);
export const listCompanies = () => active.listCompanies();
export const saveResearch = (r: StoredResearch) => active.saveResearch(r);
export const getResearch = (id: string) => active.getResearch(id);
export const listResearch = () => active.listResearch();
export const clearAll = () => active.clearAll();
