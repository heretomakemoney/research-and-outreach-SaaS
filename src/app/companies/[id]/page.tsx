"use client";

// COMPANY PAGE: header, then two tabs: Research and Outreach.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { EditContextPanel, EditDetailsPanel, ResearchSetupPanel } from "@/components/CompanyPanels";
import { OutreachTab } from "@/components/OutreachTab";
import { ResearchTab } from "@/components/ResearchTab";
import { StatusLabel, fmtDate, fmtDuration } from "@/components/ui";
import { useActiveResearch, useElapsed, useRepoQuery } from "@/lib/client/manager";
import type { AccountStatus } from "@/lib/domain";
import { getRepository } from "@/lib/repo/browser";

type Tab = "research" | "outreach";
type Panel = null | "research" | "details" | "context";

function tabFromHash(): Tab {
  return typeof window !== "undefined" && window.location.hash === "#outreach" ? "outreach" : "research";
}

export default function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [tab, setTabState] = useState<Tab>("research");
  const [panel, setPanel] = useState<Panel>(null);
  const [menu, setMenu] = useState(false);
  const active = useActiveResearch(id);
  const elapsed = useElapsed(active ? active.startedAt : null);
  const stageElapsed = useElapsed(active ? active.stageStartedAt : null);

  useEffect(() => {
    setTabState(tabFromHash());
    const onHash = () => setTabState(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  function setTab(t: Tab) {
    setTabState(t);
    window.history.replaceState(null, "", `#${t}`);
  }

  const company = useRepoQuery((r) => r.getCompany(id), [id]);
  const latest = useRepoQuery((r) => r.getLatestRun(id), [id]);
  const shown = useRepoQuery((r) => r.getDefaultRun(id), [id]);
  const email = useRepoQuery((r) => r.getEmail(id), [id]);
  const contacts = useRepoQuery((r) => r.listManualContacts(id), [id]);

  const c = company.data;
  const loaded = company.data !== undefined && latest.data !== undefined && shown.data !== undefined;
  if (!loaded) return <main><p className="muted">Loading…</p></main>;
  if (!c) {
    return (
      <main>
        <p>
          <Link href="/">← Accounts</Link>
        </p>
        <div className="empty">
          <h2>Company not found.</h2>
          <p className="muted">It may have been deleted, or it is stored in a different browser.</p>
        </div>
      </main>
    );
  }

  const run = shown.data ?? null;
  const latestRun = latest.data ?? null;
  const status: AccountStatus = active ? "researching" : latestRun ? (latestRun.status as AccountStatus) : "not_researched";
  const hasResearch = !!run;
  const runningElsewhere = !active && latestRun?.status === "researching";
  const newerFailed = !active && latestRun && latestRun.id !== run?.id && latestRun.status !== "done";

  async function remove() {
    if (!c) return;
    if (!window.confirm(`Delete ${c.name}? This deletes all its research, contacts and emails and cannot be undone.`)) return;
    await getRepository().deleteCompany(c.id);
    router.push("/");
  }

  return (
    <main>
      <p className="crumb">
        <Link href="/">← Accounts</Link>
      </p>
      <div className="topbar">
        <div>
          <h1>{c.name}</h1>
          <div className="meta">
            <StatusLabel status={status} />
            {c.website && <span className="muted">{c.website}</span>}
            {run && <span className="muted">Researched {fmtDate(run.finishedAt ?? run.startedAt)}</span>}
            {run?.aiMode === "mock" && <span className="badge light">sample research</span>}
          </div>
        </div>
        <div className="row">
          <button type="button" disabled={!!active || runningElsewhere} onClick={() => setPanel("research")}>
            {hasResearch ? "Research again" : "Start research"}
          </button>
          <div className="menu-wrap">
            <button type="button" className="secondary" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
              More ▾
            </button>
            {menu && (
              <div className="menu" role="menu" onClick={() => setMenu(false)}>
                <button type="button" role="menuitem" onClick={() => setPanel("details")}>
                  Edit company details
                </button>
                <button type="button" role="menuitem" onClick={() => setPanel("context")}>
                  Edit company context
                </button>
                <button type="button" role="menuitem" className="danger" onClick={() => void remove()}>
                  Delete company
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {active && (
        <div className="notice progress" role="status">
          <strong>{active.stageLabel}…</strong> {fmtDuration(stageElapsed)} on this step, {fmtDuration(elapsed)} total. Keep this tab open; progress is saved after each step.
        </div>
      )}
      {runningElsewhere && (
        <div className="notice warn" role="status">
          Research for this company is in progress in another tab or on another device. If it stops, it is marked interrupted a few minutes after its last activity, and you can research again.
        </div>
      )}
      {newerFailed && latestRun && (
        <div className="notice warn">
          The latest research {latestRun.status === "failed" ? "failed" : "stopped early"}
          {latestRun.statusReason ? `: ${latestRun.statusReason}` : "."} {run ? "Showing the last finished research." : ""}
        </div>
      )}

      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "research"} className={tab === "research" ? "on" : ""} onClick={() => setTab("research")}>
          Research
        </button>
        <button type="button" role="tab" aria-selected={tab === "outreach"} className={tab === "outreach" ? "on" : ""} onClick={() => setTab("outreach")}>
          Outreach
        </button>
      </div>

      {tab === "research" &&
        (run ? (
          <ResearchTab
            company={c}
            run={run}
            onEditContext={() => setPanel("context")}
            onSelectAngle={(key) => void getRepository().setSelection(c.id, { runId: run.id, angleKey: key })}
            onSelectPerson={(key) => void getRepository().setSelection(c.id, { runId: run.id, personKey: key, manualContactId: null })}
            onWriteEmail={() => setTab("outreach")}
          />
        ) : (
          <div className="empty">
            {active ? (
              <h2>Research is running.</h2>
            ) : (
              <>
                <h2>No research yet.</h2>
                <p className="muted">Start research to see the account summary, the best opportunity, who to contact and what to say.</p>
                <button type="button" onClick={() => setPanel("research")}>
                  Start research
                </button>
              </>
            )}
            <div className="context-strip left">
              <span className="label">Company context</span>
              <span className="ctx-text">{c.context || "None yet."}</span>
              <button type="button" className="linklike" onClick={() => setPanel("context")}>
                Edit
              </button>
            </div>
          </div>
        ))}

      {tab === "outreach" && <OutreachTab company={c} run={run} email={email.data ?? null} contacts={contacts.data ?? []} />}

      {panel === "research" && <ResearchSetupPanel company={c} hasResearch={hasResearch} onClose={() => setPanel(null)} onStarted={() => { setPanel(null); setTab("research"); }} />}
      {panel === "details" && <EditDetailsPanel company={c} onClose={() => setPanel(null)} />}
      {panel === "context" && <EditContextPanel company={c} onClose={() => setPanel(null)} />}
    </main>
  );
}
