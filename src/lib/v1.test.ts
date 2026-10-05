// Tests for the V1 UI layer: summary rules and the sample data. (Repository behaviour, the research
// manager and emails are in repo/repository.test.ts, which runs them against every repository.)

import assert from "node:assert/strict";
import { test } from "node:test";
import { loadFixture } from "./mock/upperHunter.ts";
import { buildSeedData } from "./mock/seed.ts";
import { MemoryRepository } from "./repo/memory.ts";
import { clientTypeLabel, groupFindings, industryCategory, researchGaps, splitOpportunities, topSignal } from "./summary.ts";
import type { Synthesis } from "./types.ts";

// ---------------------------------------------------------------------------------------------- summary

test("top signal follows the primary trigger's priority; hooks only = hook; nothing = none", () => {
  const fx = loadFixture().synthesis as Synthesis;
  const mk = (triggers: Synthesis["triggers"]): Synthesis => ({ ...fx, triggers });
  const base = fx.triggers[0];
  assert.equal(topSignal(mk([{ ...base, rank: "primary", priority: "high" }])), "strong");
  assert.equal(topSignal(mk([{ ...base, rank: "primary", priority: "medium" }])), "medium");
  assert.equal(topSignal(mk([{ ...base, rank: "primary", priority: "low" }])), "weak");
  assert.equal(topSignal(mk([{ ...base, kind: "conversation_hook", rank: "hook" }])), "hook");
  assert.equal(topSignal(mk([])), "none");
});

test("industry and client type come from the leading words of the classification", () => {
  assert.equal(industryCategory(undefined), null);
  assert.equal(clientTypeLabel(""), null);
  assert.equal(typeof industryCategory("Local government authority, NSW"), "string");
});

test("opportunities split into one best and the rest; nothing is dropped", () => {
  const s = loadFixture().synthesis as Synthesis;
  const { best, others } = splitOpportunities(s);
  assert.equal((best ? 1 : 0) + others.length, s.triggers.length);
});

test("findings are grouped without losing any card", () => {
  const fx = loadFixture();
  const g = groupFindings(fx.state, fx.synthesis);
  // Cards already shown as the evidence of an opportunity are not repeated in "developments".
  const shown = new Set(fx.synthesis!.triggers.flatMap((t) => t.factCardIds));
  const ids = [...g.developments, ...g.technology, ...g.background, ...fx.state.cards.filter((c) => shown.has(c.id) && ![...g.technology, ...g.background].includes(c))].map((c) => c.id).sort();
  assert.deepEqual(ids, fx.state.cards.map((c) => c.id).sort());
  assert.ok(Array.isArray(researchGaps(fx.state, fx.synthesis)));
});

// ---------------------------------------------------------------------------------------------- seed

test("sample data is valid: five accounts in the intended states, a default run each where expected", async () => {
  const repo = new MemoryRepository(buildSeedData());
  const rows = await repo.listAccounts();
  assert.equal(rows.length, 5);
  const byName = new Map(rows.map((r) => [r.name, r]));
  assert.equal(byName.get("Upper Hunter Shire Council")?.status, "done");
  assert.equal(byName.get("Sample: Unresearched Pty Ltd")?.status, "not_researched");
  assert.equal(byName.get("Sample: Unclear Name Co")?.status, "failed");
  assert.equal(byName.get("Sample: Partial Research Co")?.status, "partial");
  assert.equal(byName.get("Sample: Weak Signal Pty Ltd")?.status, "done");
  const uh = await repo.getCompany("sample-upper-hunter");
  assert.ok(uh && (await repo.getEmail(uh.id)));
  assert.equal((await repo.getDefaultRun(uh.id))?.id, uh.selectedRunId);
});

