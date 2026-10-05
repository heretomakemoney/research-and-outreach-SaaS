"use client";

// The single research manager for this browser tab, plus small React hooks around the repository.

import { useEffect, useState, useSyncExternalStore } from "react";
import { getPersistError, getRepository } from "../repo/browser";
import type { Repository } from "../repo/types";
import { ResearchManager, httpCall, type ActiveResearch } from "./research";

let manager: ResearchManager | null = null;

async function fetchMode(): Promise<"live" | "mock" | "unknown"> {
  const r = await fetch("/api/mode", { cache: "no-store" });
  const j = (await r.json()) as { mode?: string };
  return j.mode === "live" || j.mode === "mock" ? j.mode : "unknown";
}

export function getManager(): ResearchManager {
  if (!manager) {
    const repo = getRepository();
    manager = new ResearchManager(repo, httpCall, fetchMode);
    // A fresh page load has no research running. Close any run left "researching" by a closed tab.
    void repo.closeOrphanedRuns([]);
  }
  return manager;
}

/** Load something from the repository and reload it whenever the repository changes. */
export function useRepoQuery<T>(load: (repo: Repository) => Promise<T>, deps: unknown[] = []): { data: T | undefined; error: string | null } {
  const [state, setState] = useState<{ data: T | undefined; error: string | null }>({ data: undefined, error: null });
  useEffect(() => {
    getManager(); // make sure orphaned runs are closed before the first read
    const repo = getRepository();
    let alive = true;
    const run = () => {
      load(repo)
        .then((data) => alive && setState({ data, error: null }))
        .catch((e) => alive && setState((s) => ({ data: s.data, error: e instanceof Error ? e.message : String(e) })));
    };
    run();
    const off = repo.subscribe(run);
    return () => {
      alive = false;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

/** Re-renders when research starts, moves to a new stage or ends. Returns the active research for a company. */
export function useActiveResearch(companyId: string | null): ActiveResearch | null {
  useSyncExternalStore(
    (cb) => getManager().subscribe(cb),
    () => getManager().get(companyId ?? "")?.stageStartedAt ?? 0,
    () => 0,
  );
  return companyId ? getManager().get(companyId) : null;
}

/** "mock" or "live", as reported by the server. null until known. */
export function useServerMode(): "mock" | "live" | null {
  const [mode, setMode] = useState<"mock" | "live" | null>(null);
  useEffect(() => {
    let alive = true;
    void getManager()
      .mode()
      .then((m) => alive && setMode(m === "live" ? "live" : m === "mock" ? "mock" : null));
    return () => {
      alive = false;
    };
  }, []);
  return mode;
}

export function useStorageProblem(): string | null {
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    const repo = getRepository();
    const check = () => setProblem(getPersistError());
    check();
    return repo.subscribe(check);
  }, []);
  return problem;
}

/** Seconds since `since`, ticking once a second. */
export function useElapsed(since: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
}
