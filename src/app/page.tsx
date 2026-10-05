"use client";

// ACCOUNTS: the home screen. A simple table of companies: Company, Status, Industry, Client type,
// Top signal, Last researched. Click a row to open the company.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AddCompanyPanel } from "@/components/CompanyPanels";
import { SignalLabel, StatusLabel, fmtDate } from "@/components/ui";
import { useRepoQuery, useServerMode } from "@/lib/client/manager";
import type { AccountRow, TopSignal } from "@/lib/domain";
import { getRepository } from "@/lib/repo/browser";

type SortKey = "name" | "status" | "signal" | "researched" | "recent";

const STATUS_ORDER = { researching: 0, done: 1, partial: 2, failed: 3, not_researched: 4 } as const;
const SIGNAL_ORDER: Record<TopSignal, number> = { strong: 0, medium: 1, weak: 2, hook: 3, none: 4 };

function compare(a: AccountRow, b: AccountRow, key: SortKey): number {
  switch (key) {
    case "name":
      return a.name.localeCompare(b.name);
    case "status":
      return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    case "signal":
      return (a.topSignal ? SIGNAL_ORDER[a.topSignal] : 9) - (b.topSignal ? SIGNAL_ORDER[b.topSignal] : 9);
    case "researched":
      return (b.lastResearchedAt ?? "").localeCompare(a.lastResearchedAt ?? "");
    default:
      return b.lastActivityAt.localeCompare(a.lastActivityAt);
  }
}

export default function AccountsPage() {
  const router = useRouter();
  const { data: rows, error } = useRepoQuery((repo) => repo.listAccounts(), []);
  const mode = useServerMode();
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "recent", dir: 1 });
  const [adding, setAdding] = useState(false);

  async function addSamples() {
    setSampleError(null);
    try {
      await getRepository().addSampleAccounts();
    } catch (e) {
      setSampleError(e instanceof Error ? e.message : String(e));
    }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = (rows ?? []).filter((r) => !q || [r.name, r.website, r.industry ?? "", r.clientType ?? ""].some((v) => v.toLowerCase().includes(q)));
    return filtered.sort((a, b) => sort.dir * compare(a, b, sort.key) || a.name.localeCompare(b.name));
  }, [rows, query, sort]);

  function header(label: string, key: SortKey) {
    const active = sort.key === key;
    return (
      <th aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
        <button type="button" className="th-button" onClick={() => setSort({ key, dir: active ? (sort.dir === 1 ? -1 : 1) : 1 })}>
          {label}
          <span aria-hidden="true">{active ? (sort.dir === 1 ? " ↑" : " ↓") : ""}</span>
        </button>
      </th>
    );
  }

  const empty = rows !== undefined && rows.length === 0;

  return (
    <main>
      <div className="topbar">
        <h1>Accounts</h1>
        <button type="button" onClick={() => setAdding(true)}>
          Add company
        </button>
      </div>

      {sampleError && <div className="notice error">{sampleError}</div>}
      {error && <div className="notice error">{error}</div>}

      {empty ? (
        <div className="empty">
          <h2>No companies yet.</h2>
          <p className="muted">Add a company to research it, see who to contact and what to say.</p>
          <div className="row center">
            <button type="button" onClick={() => setAdding(true)}>
              Add company
            </button>
            {mode === "mock" && (
              <button type="button" className="secondary" onClick={() => void addSamples()}>
                Add sample accounts
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="toolbar">
            <input type="search" placeholder="Filter companies" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter companies" />
            <span className="muted">{rows === undefined ? "Loading…" : `${visible.length} of ${rows.length}`}</span>
          </div>
          <div className="table-wrap">
            <table className="accounts">
              <thead>
                <tr>
                  {header("Company", "name")}
                  {header("Status", "status")}
                  <th>Industry</th>
                  <th>Client type</th>
                  {header("Top signal", "signal")}
                  {header("Last researched", "researched")}
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => router.push(`/companies/${r.id}`)}>
                    <td>
                      <Link href={`/companies/${r.id}`} onClick={(e) => e.stopPropagation()} className="company-link">
                        {r.name}
                      </Link>
                    </td>
                    <td>
                      <StatusLabel status={r.status} />
                      {r.statusDetail && <div className="sub">{r.statusDetail}</div>}
                    </td>
                    <td>{r.industry ?? ""}</td>
                    <td>{r.clientType ?? ""}</td>
                    <td>{r.status === "not_researched" ? "" : <SignalLabel signal={r.topSignal} />}</td>
                    <td>{fmtDate(r.lastResearchedAt)}</td>
                  </tr>
                ))}
                {visible.length === 0 && rows && rows.length > 0 && (
                  <tr>
                    <td colSpan={6} className="muted center">
                      No companies match &ldquo;{query}&rdquo;.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {mode === "mock" && rows && rows.length > 0 && (
        <p className="footnote">
          Mock mode.{" "}
          <button type="button" className="linklike" onClick={() => void addSamples()}>
            Add sample accounts
          </button>{" "}
          (accounts that already exist are skipped). Delete any account from its own page.
        </p>
      )}

      {adding && (
        <AddCompanyPanel
          onClose={() => setAdding(false)}
          onCreated={(id) => {
            setAdding(false);
            router.push(`/companies/${id}`);
          }}
        />
      )}
    </main>
  );
}
