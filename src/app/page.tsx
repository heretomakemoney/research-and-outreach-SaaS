"use client";

// The one screen of the prototype. This code runs in YOUR BROWSER.
//
// Flow: company form -> research stages (discover, optional follow-up,
// synthesis; each a separate server request) -> results (triggers, people,
// angles) -> choose angle -> choose contact -> email -> edit / regenerate / copy.
//
// The whole workflow is saved through the storage layer after every step.
// Only ONE current workflow exists; there is no history.

import { useEffect, useRef, useState, type FormEvent } from "react";
import CostPanel from "@/components/CostPanel";
import EmailStep from "@/components/EmailStep";
import ResearchView from "@/components/ResearchView";
import { newWorkflow, pendingStage, runPendingStage, STAGE_LABEL } from "@/lib/client/pipeline";
import { seconds, usd } from "@/lib/format";
import { totalCost } from "@/lib/pricing";
import { clearAll, getWorkflow, saveWorkflow } from "@/lib/storage";
import type { StageLog, Workflow } from "@/lib/types";

function stageName(l: StageLog): string {
  if (l.stage === "followup") return `Follow-up round ${l.round}`;
  if (l.stage === "discover") return "Discover";
  if (l.stage === "synthesize") return "Synthesis";
  return `Email ${l.round}`;
}

export default function Home() {
  const [wf, setWf] = useState<Workflow | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [website, setWebsite] = useState("");
  const [context, setContext] = useState("");
  const [topic, setTopic] = useState("");

  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  // On first load: bring back what was saved in this browser.
  useEffect(() => {
    (async () => {
      const saved = await getWorkflow();
      if (saved) {
        setWf(saved);
        fillForm(saved);
      }
    })().catch((e) => setError(String(e)));
  }, []);

  // Count seconds while a stage is running.
  useEffect(() => {
    if (!busyLabel) return;
    setElapsed(0);
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [busyLabel]);

  function fillForm(w: Workflow) {
    setCompanyName(w.state.input.companyName);
    setWebsite(w.state.input.website);
    setContext(w.state.input.context);
    setTopic(w.state.input.topic);
  }

  /** Update the screen and save. Saving can fail (storage full); that is reported, not swallowed. */
  async function persist(next: Workflow) {
    setWf(next);
    try {
      await saveWorkflow(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Run every pending research stage in order, saving after each. Safe to call again to resume. */
  async function runPipeline(start: Workflow) {
    if (running.current) return;
    running.current = true;
    setError(null);
    let current = start;
    try {
      for (;;) {
        const stage = pendingStage(current);
        if (!stage) break;
        setBusyLabel(STAGE_LABEL[stage]);
        current = await runPendingStage(current, stage);
        await persist(current);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyLabel(null);
      running.current = false;
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!companyName.trim() || running.current) return;
    if (wf && (wf.synthesis || wf.email)) {
      const ok = window.confirm(
        "This replaces the current research and email with a new run. (Only one company is kept at a time.) Continue?",
      );
      if (!ok) return;
    }
    const fresh = newWorkflow({
      companyName: companyName.trim(),
      website: website.trim(),
      context: context.trim(),
      topic: topic.trim(),
    });
    await persist(fresh);
    await runPipeline(fresh);
  }

  async function onClear() {
    if (!window.confirm("Delete the saved research and email from this browser?")) return;
    await clearAll();
    setWf(null);
    setError(null);
  }

  const pending = wf ? pendingStage(wf) : null;
  const logs: StageLog[] = wf ? [...wf.state.stages, ...(wf.synthesisLog ? [wf.synthesisLog] : []), ...wf.emailLogs] : [];
  const total = totalCost(logs);
  const stopped = wf?.next?.action === "stop_entity" ? wf.next : null;

  return (
    <main>
      <h1>Account research and outreach</h1>
      <p className="muted">
        Company → Teltonika-specific research → triggers, people and angles → choose an angle and a contact → email.
        Every research run makes real, paid Anthropic API calls (typically a few tens of cents; the cost panel shows the
        estimate per stage).
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
          <button type="submit" disabled={!!busyLabel || !companyName.trim()}>
            {busyLabel ? "Researching…" : wf ? "Start new research" : "Research"}
          </button>
          {wf && !busyLabel && pending && (
            <button type="button" className="secondary" onClick={() => runPipeline(wf)}>
              Continue research (next: {STAGE_LABEL[pending].split(":")[0].toLowerCase()})
            </button>
          )}
        </div>
      </form>

      {busyLabel && (
        <div className="panel progress">
          <strong>{busyLabel}</strong> · {elapsed}s
          <div className="muted">Keep this tab open. Research stages usually take 1–2 minutes each.</div>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {wf && logs.length > 0 && (
        <div className="panel">
          <strong>Progress</strong>
          <ul className="plain">
            {logs
              .filter((l) => l.stage !== "email")
              .map((l, i) => (
                <li key={i}>
                  ✓ {stageName(l)} · {seconds(l.durationMs)} · {usd(l.cost.totalUsd)}
                  {l.usage.searchRequests > 0 ? ` · ${l.usage.searchRequests} searches` : ""}
                </li>
              ))}
          </ul>
          <div className="muted">
            Total so far: {usd(total.totalUsd)} (estimate), {total.searches} searches, {total.fetches} fetches.
          </div>
          {wf.next && !wf.synthesis && (
            <div className="muted">
              Gate decision: <strong>{wf.next.action}</strong>. {wf.next.reason}
            </div>
          )}
        </div>
      )}

      {stopped && (
        <div className="warning">
          <strong>Research stopped before spending more.</strong> {stopped.reason}
          {wf?.state.entity?.matchNote && <div>What was found: {wf.state.entity.matchNote}</div>}
        </div>
      )}

      {wf && (wf.state.cards.length > 0 || wf.state.entity) && (
        <ResearchView
          wf={wf}
          onSelectAngle={(id) => persist({ ...wf, selectedAngleId: id, updatedAt: new Date().toISOString() })}
        />
      )}

      {wf && wf.synthesis && <EmailStep wf={wf} onChange={persist} />}

      {wf && <CostPanel wf={wf} />}

      {wf && (
        <p>
          <button type="button" className="secondary" onClick={onClear}>
            Clear saved data
          </button>
        </p>
      )}
    </main>
  );
}
