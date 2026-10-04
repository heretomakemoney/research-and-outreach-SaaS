// The STORAGE LAYER (browser).
//
// For this prototype there is exactly ONE current workflow: the company being
// researched right now, with its research, selections and email. Starting new
// research replaces it. No history, no database.
//
// Screens call the functions at the bottom of this file and never touch
// localStorage themselves. Only this file knows where data actually lives, so
// a database-backed implementation can replace it in ONE place later.
//
// Every function is async even though localStorage is instant, so callers
// already work the way they will with a database.
//
// Browser only. The Anthropic API key is never stored here and never reaches the browser.

import type { Workflow } from "./types";

/** What any storage implementation must be able to do. */
export interface Storage {
  getWorkflow(): Promise<Workflow | null>;
  saveWorkflow(workflow: Workflow): Promise<void>;
  clearAll(): Promise<void>;
}

export class StorageFullError extends Error {
  constructor() {
    super("Browser storage is full or blocked, so this step could not be saved. Copy anything you need and use Clear saved data.");
  }
}

const KEY_WORKFLOW = "ror:v2:workflow";
const OLD_KEYS = ["ror:v1:companies", "ror:v1:research"]; // Milestone 1 data; removed by clearAll

const localStorageImplementation: Storage = {
  async getWorkflow() {
    try {
      const raw = window.localStorage.getItem(KEY_WORKFLOW);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Workflow;
      return parsed && parsed.version === 2 && parsed.state ? parsed : null;
    } catch {
      return null; // unreadable data is treated as empty rather than crashing the page
    }
  },
  async saveWorkflow(workflow) {
    try {
      window.localStorage.setItem(KEY_WORKFLOW, JSON.stringify(workflow));
    } catch {
      throw new StorageFullError();
    }
  },
  async clearAll() {
    try {
      window.localStorage.removeItem(KEY_WORKFLOW);
      for (const key of OLD_KEYS) window.localStorage.removeItem(key);
    } catch {
      /* nothing to clear */
    }
  },
};

// The one place that chooses the implementation. Swap it here in Phase 2.
const active: Storage = localStorageImplementation;

export const getWorkflow = () => active.getWorkflow();
export const saveWorkflow = (w: Workflow) => active.saveWorkflow(w);
export const clearAll = () => active.clearAll();
