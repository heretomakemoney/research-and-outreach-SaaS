// POST /api/repo   { method, args }
//
// The browser's only door to the database. It runs on the SERVER, where DATABASE_URL lives; the browser
// never sees the connection string. Only the Repository methods listed below can be called.
//
// No sign-in yet (authentication is a later step): the deployment's own protection (for example Vercel
// Deployment Protection) is what keeps strangers out for now.

import { NextResponse } from "next/server";
import { friendlyDbError } from "@/lib/repo/postgres";
import { addSampleAccounts } from "@/lib/repo/sample";
import { getServerRepository } from "@/lib/repo/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY_BYTES = 8 * 1024 * 1024;

const METHODS = [
  "listAccounts", "getCompany", "findDuplicates", "createCompany", "updateCompany", "setSelection", "deleteCompany",
  "createRun", "updateRun", "getRun", "getLatestRun", "getDefaultRun", "closeOrphanedRuns",
  "listManualContacts", "addManualContact", "getEmail", "saveEmail", "addSampleAccounts",
] as const;
type Method = (typeof METHODS)[number];

export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return NextResponse.json({ ok: false, error: "That request is too large." }, { status: 413 });
  let body: { method?: unknown; args?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "The request was not valid JSON." }, { status: 400 });
  }
  const method = body.method as Method;
  const args = Array.isArray(body.args) ? body.args : [];
  if (!METHODS.includes(method)) return NextResponse.json({ ok: false, error: "Unknown repository method." }, { status: 400 });

  try {
    const repo = getServerRepository();
    if (method === "addSampleAccounts") return NextResponse.json({ ok: true, result: await addSampleAccounts(repo) });
    const fn = repo[method] as (...a: unknown[]) => Promise<unknown>;
    const result = await fn.apply(repo, args);
    return NextResponse.json({ ok: true, result: result === undefined ? null : result });
  } catch (e) {
    const err = friendlyDbError(e);
    // A raw database error (anything with a SQLSTATE code) is logged by code only and not shown.
    const raw = (e as { code?: string }).code;
    if (err === e && typeof raw === "string") {
      console.error(`[repo] ${method} failed with database error ${raw}`);
      return NextResponse.json({ ok: false, error: "The database could not complete that request." }, { status: 500 });
    }
    return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
  }
}
