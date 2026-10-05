// How one row of the Accounts table is worked out. Shared by the in-memory and PostgreSQL repositories
// so both follow the same rules.

import type { AccountRow, RunStatus, TopSignal } from "../domain";

export function minutesAgo(then: string, now: Date): string {
  const m = Math.max(0, Math.round((now.getTime() - new Date(then).getTime()) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function shortReason(status: RunStatus, statusReason: string | null): string {
  const r = statusReason ?? "";
  if (/unclear|ambiguous|more than one company|confirm which/i.test(r)) return "Company unclear";
  if (/not found|no matching/i.test(r)) return "Company not found";
  if (status === "partial") return "Incomplete results";
  if (status === "failed") return "No usable results";
  return "";
}

export interface LatestRunInfo {
  id: string;
  status: RunStatus;
  startedAt: string;
  statusReason: string | null;
}
export interface DefaultRunInfo {
  id: string;
  industry: string | null;
  clientType: string | null;
  topSignal: TopSignal | null;
  finishedAt: string | null;
}

export function buildAccountRow(
  company: { id: string; name: string; website: string; lastActivityAt: string },
  latest: LatestRunInfo | null,
  def: DefaultRunInfo | null,
  now: Date,
): AccountRow {
  const status = latest ? latest.status : "not_researched";
  let statusDetail = "";
  if (latest?.status === "researching") {
    statusDetail = `Started ${minutesAgo(latest.startedAt, now)}${def ? ". Earlier research available" : ""}`;
  } else if (latest && latest.status !== "done") {
    statusDetail = shortReason(latest.status, latest.statusReason);
  }
  return {
    id: company.id,
    name: company.name,
    website: company.website,
    status,
    statusDetail,
    hasEarlierResearch: !!def && latest?.id !== def.id,
    industry: def?.industry ?? null,
    clientType: def?.clientType ?? null,
    topSignal: def?.topSignal ?? null,
    lastResearchedAt: def?.finishedAt ?? null,
    lastActivityAt: company.lastActivityAt,
  };
}
