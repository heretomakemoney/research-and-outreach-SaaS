"use client";

// The one screen of Milestone 1. This code runs in YOUR BROWSER.
// It sends the form to our server route, shows the result, and saves it
// through the storage layer (src/lib/storage.ts).

import { useEffect, useState, type FormEvent } from "react";
import ResultView from "@/components/ResultView";
import { DEFAULT_MODEL } from "@/lib/config";
import { clearAll, findCompanyByName, listResearch, saveCompany, saveResearch } from "@/lib/storage";
import {
  MODEL_OPTIONS,
  isModelId,
  type ApiError,
  type IdentifyInput,
  type IdentifyResult,
  type StoredCompany,
  type StoredResearch,
} from "@/lib/types";

export default function Home() {
  const [companyName, setCompanyName] = useState("");
  const [website, setWebsite] = useState("");
  const [context, setContext] = useState("");
  const [topic, setTopic] = useState("");
  const [model, setModel] = useState<string>(DEFAULT_MODEL);

  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<StoredResearch | null>(null);
  const [saved, setSaved] = useState<StoredResearch[]>([]);

  // On first load: bring back what was saved in this browser.
  useEffect(() => {
    (async () => {
      const list = await listResearch();
      setSaved(list);
      if (list[0]) show(list[0]);
    })().catch((e) => setError(String(e)));
  }, []);

  // Count seconds while a request is running.
  useEffect(() => {
    if (!running) return;
    setElapsed(0);
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);

  function show(research: StoredResearch) {
    setCurrent(research);
    setCompanyName(research.input.companyName);
    setWebsite(research.input.website);
    setContext(research.input.context);
    setTopic(research.input.topic);
    setModel(research.input.model);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!companyName.trim()) return;
    setError(null);
    setRunning(true);
    try {
      const input: IdentifyInput = {
        companyName: companyName.trim(),
        website: website.trim(),
        context: context.trim(),
        topic: topic.trim(),
        model: isModelId(model) ? model : DEFAULT_MODEL,
      };

      // Save the company (and its context) BEFORE researching, so nothing typed is lost.
      const now = new Date().toISOString();
      const existing = await findCompanyByName(input.companyName);
      const company: StoredCompany = {
        id: existing?.id ?? crypto.randomUUID(),
        name: input.companyName,
        website: input.website,
        context: input.context,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await saveCompany(company);

      // Ask our server to run the research stage. This can take a minute or two.
      const response = await fetch("/api/research/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = (await response.json().catch(() => null)) as IdentifyResult | ApiError | null;
      if (!response.ok || !data || data.ok !== true) {
        throw new Error(data && data.ok === false ? data.error : `Request failed (HTTP ${response.status}).`);
      }

      const research: StoredResearch = {
        id: crypto.randomUUID(),
        companyId: company.id,
        stage: "identify",
        createdAt: data.createdAt,
        input,
        result: data,
      };
      await saveResearch(research);
      setSaved(await listResearch());
      setCurrent(research);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  async function onClear() {
    if (!window.confirm("Delete all saved companies and research from this browser?")) return;
    await clearAll();
    setSaved([]);
    setCurrent(null);
  }

  return (
    <main>
      <h1>Account research: Milestone 1</h1>
      <p className="muted">
        Stage 1 only: identify the company and do an initial look, using Claude with web search and fetch. Each click
        makes real, paid Anthropic API calls.
      </p>

      <form onSubmit={onSubmit}>
        <label>
          Company name (required)
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} required maxLength={200} />
        </label>
        <label>
          Website <span className="hint">(optional)</span>
          <input value={website} onChange={(e) => setWebsite(e.target.value)} maxLength={300} placeholder="https://" />
        </label>
        <label>
          Company context <span className="hint">(optional: what you privately know; treated as unverified)</span>
          <textarea value={context} onChange={(e) => setContext(e.target.value)} maxLength={4000} />
        </label>
        <label>
          Research topic <span className="hint">(optional: a question for this run only)</span>
          <textarea value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={1000} />
        </label>
        <div className="row">
          <label>
            Model <span className="hint">(for comparing cost and quality)</span>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {MODEL_OPTIONS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={running || !companyName.trim()}>
            {running ? `Researching… ${elapsed}s` : "Research"}
          </button>
        </div>
        {running && (
          <p className="muted">Keep this tab open. Claude is searching and reading pages; this usually takes 1–3 minutes.</p>
        )}
      </form>

      {error && <div className="error">{error}</div>}

      {saved.length > 0 && (
        <>
          <h2>Saved in this browser</h2>
          <div className="saved">
            {saved.map((r) => (
              <button key={r.id} type="button" onClick={() => show(r)}>
                {r.input.companyName} · {new Date(r.createdAt).toLocaleString("en-AU")}
              </button>
            ))}
          </div>
        </>
      )}

      {current && <ResultView result={current.result} />}

      {saved.length > 0 && (
        <p>
          <button type="button" className="secondary" onClick={onClear}>
            Clear saved data
          </button>
        </p>
      )}
    </main>
  );
}
