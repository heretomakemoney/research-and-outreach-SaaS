// Tests for MOCK MODE and the saved Upper Hunter fixture.
//
// The fixture is MOCK DATA ONLY (src/fixtures/README.md): it lets the UI, database and persistence be built
// without paid Anthropic calls. These tests also prove it cannot leak into live research.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { POST as discoverRoute } from "@/app/api/research/discover/route";
import { POST as emailRoute } from "@/app/api/research/email/route";
import { POST as followupRoute } from "@/app/api/research/followup/route";
import { POST as synthesizeRoute } from "@/app/api/research/synthesize/route";
import { GATE, STATE_LIMITS } from "./config.ts";
import { decideNext } from "./gate.ts";
import { aiMode, mockDelayMs } from "./mode.ts";
import { DISCOVER_SOURCE_COUNT, discoverSnapshot, followupSnapshot, loadFixture } from "./mock/upperHunter.ts";
import { mockEmailStage, mockResearchStage, mockSynthesizeStage } from "./mock/stages.ts";
import { getClient, MockModeError } from "./anthropic.ts";
import { getRunners } from "./stages/runners.ts";
import { sanitizeState, totalCostUsd, totalSearches } from "./state.ts";
import { validateSynthesis } from "./synthesis.ts";
import { totalCost } from "./pricing.ts";
import type { Workflow, WorkflowInput } from "./types.ts";

const input: WorkflowInput = { companyName: "Anything I Type", website: "", context: "", topic: "" };

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve(fn()).finally(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

const post = (route: (r: Request) => Promise<Response>, body: unknown) =>
  route(new Request("http://localhost/api", { method: "POST", body: JSON.stringify(body) }));

// ---------------------------------------------------------------- the fixture

test("the fixture is the saved run: counts, costs and references are intact", () => {
  const fx = loadFixture();
  assert.equal(fx.version, 2);
  assert.equal(fx.state.cards.length, 15);
  assert.equal(fx.state.sources.length, 85);
  assert.equal(fx.state.people.length, 2);
  assert.equal(fx.state.leads.length, 8);
  assert.equal(fx.synthesis!.triggers.length, 4);
  assert.equal(fx.synthesis!.angles.length, 4);
  assert.equal(fx.email!.generation, 1);
  const total = totalCost([...fx.state.stages, fx.synthesisLog!, ...fx.emailLogs]).totalUsd;
  assert.equal(total.toFixed(4), "1.2317");
  const keys = new Set(fx.state.sources.map((s) => s.key));
  for (const item of [...fx.state.cards, ...fx.state.people]) assert.ok(item.sourceKeys.every((k) => keys.has(k)));
});

test("the fixture is valid for the real app code: state passes validation, synthesis passes with nothing dropped", () => {
  const fx = loadFixture();
  const clean = sanitizeState(fx.state, STATE_LIMITS);
  assert.equal(clean.cards.length, 15);
  assert.equal(clean.sources.length, 85);
  assert.equal(clean.people.length, 2);
  assert.equal(clean.leads.length, 8);
  const v = validateSynthesis(fx.synthesis, fx.state);
  assert.deepEqual(v.synthesis.droppedReferences, []);
  assert.deepEqual(v.warnings, []);
  assert.deepEqual(v.synthesis.triggers.map((t) => [t.id, t.evidenceGrade]), fx.synthesis!.triggers.map((t) => [t.id, t.evidenceGrade]));
  assert.deepEqual(v.synthesis.angles.map((a) => [a.id, a.recommended]), fx.synthesis!.angles.map((a) => [a.id, a.recommended]));
});

test("the stage snapshots are consistent with the real gate and with the saved run", () => {
  const fx = loadFixture();
  // discovery found sources S1..S61; the follow-up's first new source is S62
  assert.equal(fx.state.sources[DISCOVER_SOURCE_COUNT].key, "S62");
  assert.equal(fx.state.sources[DISCOVER_SOURCE_COUNT].url, fx.state.stages[1].ledger!.fetchRequestedUrls[0]);
  const found = fx.state.cards.filter((c) => c.stage === "discover").flatMap((c) => c.sourceKeys);
  assert.ok(found.every((k) => Number(k.slice(1)) <= DISCOVER_SOURCE_COUNT));

  const d = discoverSnapshot(input);
  assert.equal(d.input.companyName, "Anything I Type");
  assert.deepEqual(d.cards.map((c) => c.id), ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "E9"]);
  assert.equal(d.sources.length, 61);
  assert.equal(d.stages.length, 1);
  assert.equal(d.followupRounds, 0);
  assert.deepEqual(d.leads.map((l) => [l.id, l.status]), [["L1", "open"], ["L2", "open"], ["L3", "open"], ["L4", "open"], ["L5", "open"]]);
  const afterDiscover = decideNext(d, totalSearches(d), totalCostUsd(d), { ...GATE, now: new Date("2026-10-05") });
  assert.equal(afterDiscover.action, "followup"); // the saved run's gate log says the same
  if (afterDiscover.action === "followup") assert.deepEqual(afterDiscover.leadIds, ["L1", "L2", "L3"]);

  const f = followupSnapshot(input);
  assert.equal(f.cards.length, 15);
  assert.equal(f.followupRounds, 1);
  assert.equal(f.stages.length, 2);
  assert.equal(decideNext(f, totalSearches(f), totalCostUsd(f), { ...GATE, now: new Date("2026-10-05") }).action, "synthesize");
});

// ---------------------------------------------------------------- mock stages

test("mock stages return the same shapes as the live ones, and the real gate drives the flow", async () => {
  await withEnv({ MOCK_DELAY_MS: "0" }, async () => {
    const d = await mockResearchStage({ kind: "discover", input });
    assert.equal(d.state.entity?.match, "Confirmed");
    assert.equal(d.next.action, "followup");
    const f = await mockResearchStage({ kind: "followup", state: d.state, focus: "leads", leadIds: ["L1", "L2", "L3"] });
    assert.equal(f.state.cards.length, 15);
    assert.equal(f.next.action, "synthesize");
    const s = await mockSynthesizeStage(f.state);
    assert.equal(s.synthesis.angles.filter((a) => a.recommended).length, 1);
    assert.equal(s.log.model, "claude-opus-5-5");

    const researched = await mockEmailStage({ state: f.state, synthesis: s.synthesis, angleId: "A1", contact: { source: "researched", personId: "P2", name: "", role: "" }, relationship: { kind: "new", note: "" }, previousBody: null, generation: 1 });
    assert.match(researched.draft.body, /^Hi Grahame,/);
    assert.equal(researched.draft.contact.name, "Grahame Wilson");
    const manual = await mockEmailStage({ state: f.state, synthesis: s.synthesis, angleId: "A2", contact: { source: "manual", name: "Sam Smith", role: "IT lead" }, relationship: { kind: "existing", note: "met at expo" }, previousBody: "x", generation: 2 });
    assert.match(manual.draft.body, /^Hi Sam,/);
    assert.match(manual.draft.subject, /\(mock draft 2\)$/);
    assert.equal(manual.log.round, 2);
    await assert.rejects(mockEmailStage({ state: f.state, synthesis: s.synthesis, angleId: "A9", contact: { source: "manual", name: "x", role: "" }, relationship: { kind: "new", note: "" }, previousBody: null, generation: 1 }), /angle/);
    await assert.rejects(mockEmailStage({ state: f.state, synthesis: s.synthesis, angleId: "A1", contact: { source: "manual", name: " ", role: "" }, relationship: { kind: "new", note: "" }, previousBody: null, generation: 1 }), /name/);
  });
});

test("the REAL API routes serve the whole flow in mock mode, with no API key and no Anthropic client", async () => {
  await withEnv({ AI_MODE: "mock", MOCK_DELAY_MS: "0", ANTHROPIC_API_KEY: undefined }, async () => {
    const d = (await (await post(discoverRoute, { input })).json()) as { ok: boolean; state: Workflow["state"]; next: { action: string } };
    assert.equal(d.ok, true);
    assert.equal(d.next.action, "followup");
    const f = (await (await post(followupRoute, { state: d.state })).json()) as { ok: boolean; state: Workflow["state"]; next: { action: string } };
    assert.equal(f.ok, true);
    assert.equal(f.state.followupRounds, 1);
    assert.equal(f.next.action, "synthesize");
    const s = (await (await post(synthesizeRoute, { state: f.state })).json()) as { ok: boolean; synthesis: Workflow["synthesis"] };
    assert.equal(s.ok, true);
    const e = (await (await post(emailRoute, { state: f.state, synthesis: s.synthesis, angleId: "A1", contact: { source: "researched", personId: "P1" }, relationship: { kind: "new", note: "" }, generation: 1 })).json()) as { ok: boolean; draft: { body: string; contact: { name: string } } };
    assert.equal(e.ok, true);
    assert.match(e.draft.body, /^Hi Stephen,/);
    // routes still validate input
    const bad = await post(emailRoute, { state: f.state, synthesis: s.synthesis, angleId: "A9", contact: { source: "manual", name: "x" }, generation: 1 });
    assert.equal(bad.status, 400);
    const noFollowup = await post(followupRoute, { state: f.state });
    assert.equal(noFollowup.status, 400); // the gate says synthesize, so a follow-up is refused
  });
});

// ---------------------------------------------------------------- no paid calls

test("mode rules: explicit setting wins, production is live, everything else (dev, tests) is mock", () => {
  assert.equal(aiMode({ AI_MODE: "live" }), "live");
  assert.equal(aiMode({ AI_MODE: "MOCK", NODE_ENV: "production" }), "mock");
  assert.equal(aiMode({ NODE_ENV: "production" }), "live");
  assert.equal(aiMode({ NODE_ENV: "production", VERCEL_ENV: "preview" }), "mock");
  assert.equal(aiMode({ NODE_ENV: "production", VERCEL_ENV: "production" }), "live");
  assert.equal(aiMode({ NODE_ENV: "production", VERCEL_ENV: "preview", AI_MODE: "live" }), "live");
  assert.equal(aiMode({ NODE_ENV: "development" }), "mock");
  assert.equal(aiMode({}), "mock");
  assert.equal(aiMode({ AI_MODE: "yes please", NODE_ENV: "production" }), "mock", "an unrecognised value is the safe choice");
  assert.equal(mockDelayMs({}), 700);
  assert.equal(mockDelayMs({ MOCK_DELAY_MS: "0" }), 0);
  assert.equal(mockDelayMs({ MOCK_DELAY_MS: "999999" }), 10_000);
  assert.equal(mockDelayMs({ MOCK_DELAY_MS: "abc" }), 700);
});

test("in mock mode an Anthropic client can never be created, even with a key present", async () => {
  await withEnv({ AI_MODE: "mock", ANTHROPIC_API_KEY: "placeholder-not-a-real-key" }, () => {
    assert.throws(() => getClient(), MockModeError);
  });
  await withEnv({ AI_MODE: "live", ANTHROPIC_API_KEY: "placeholder-not-a-real-key" }, () => {
    assert.doesNotThrow(() => getClient()); // constructing a client makes no network call
  });
});

test("the runner switch picks mock or live by mode", async () => {
  assert.equal((await withEnv({ AI_MODE: "mock" }, () => getRunners())).mode, "mock");
  assert.equal((await withEnv({ AI_MODE: "live" }, () => getRunners())).mode, "live");
});

// ---------------------------------------------------------------- the fixture cannot leak into live research

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const root = process.cwd();
const rel = (f: string) => path.relative(root, f).split(path.sep).join("/");

test("only the mock code and the runner switch import the fixture or the mock modules", () => {
  const allowed = (f: string) => f.startsWith("src/lib/mock/") || f === "src/lib/mock.test.ts" || f === "src/lib/v1.test.ts" || f === "src/lib/stages/runners.ts" || f === "src/lib/repo/browser.ts";
  const offenders: string[] = [];
  for (const file of walk(path.join(root, "src")).filter((f) => /\.(ts|tsx)$/.test(f))) {
    const name = rel(file);
    if (allowed(name)) continue;
    const text = fs.readFileSync(file, "utf-8");
    if (/(?:from\s+|import\s*\(\s*)["'][^"']*(?:fixtures|\/mock\/|\/mock["'])/.test(text)) offenders.push(name);
  }
  assert.deepEqual(offenders, []);
});

test("prompts, intelligence files and the live research code contain nothing from the fixture", () => {
  const markers = ["Hitchens", "Atturra", "Grahame Wilson", "Brushy Hill", "Glenbawn", "Abergeldie", "Merriwa", "Murrurundi"];
  const files = [
    ...walk(path.join(root, "docs", "intelligence")),
    ...walk(path.join(root, "src", "lib", "prompts")),
    ...walk(path.join(root, "src", "lib", "retrieval")),
    ...["stages/research.ts", "stages/synthesize.ts", "stages/email.ts", "stages/common.ts", "parse.ts", "state.ts", "gate.ts", "synthesis.ts", "config.ts", "rules.ts", "ledger.ts"].map((f) => path.join(root, "src", "lib", f)),
  ];
  assert.ok(files.length > 15);
  for (const file of files) {
    const text = fs.readFileSync(file, "utf-8");
    for (const m of markers) assert.ok(!text.includes(m), `${rel(file)} mentions "${m}" from the mock fixture`);
  }
});
