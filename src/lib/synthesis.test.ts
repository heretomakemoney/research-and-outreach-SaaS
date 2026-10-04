import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyState } from "./state.ts";
import { validateEmail, validateSynthesis } from "./synthesis.ts";
import type { EvidenceCard, ResearchState } from "./types.ts";

const card = (id: string): EvidenceCard => ({ id, kind: "project", date: "2026-08", claim: `claim ${id}`, sourceKeys: ["S1"], evidence: [], stage: "discover", round: 0 });
const state: ResearchState = {
  ...emptyState({ companyName: "X", website: "", context: "", topic: "" }),
  cards: [card("E1"), card("E2")],
  people: [{ id: "P1", name: "Jane", role: "Ops", organisation: "X", whyRelevant: "", sourceKeys: ["S1"], evidence: [], stage: "discover" }],
};

const trigger = (id: string, rank: string, cards: string[]) => ({
  id, rank, kind: "sales_trigger", priority: "high", title: `T ${id}`, recency: "under_3_months", scale: "40 sites",
  fact: "f", factCardIds: cards, inference: "i", possibleOpportunity: "o", whyNow: "w",
});
const angle = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: `Angle ${id}`, strength: "strong", triggerIds: ["T1"], cardIds: ["E1"], conversationQuestion: "How do you connect them?", whyItWorks: "w", recommended: false, ...over,
});

test("references to evidence that does not exist are removed and reported", () => {
  const { synthesis } = validateSynthesis(
    {
      relevance: "strong", summary: "s", noMeaningfulAngleNote: "",
      triggers: [trigger("T1", "primary", ["E1", "E99"]), trigger("T2", "secondary", ["E404"])],
      people: [{ personId: "P1", rank: 1, whyRelevant: "w" }, { personId: "P7", rank: 2, whyRelevant: "ghost" }],
      angles: [angle("A1", { recommended: true, cardIds: ["E1", "E55"], triggerIds: ["T1", "T2"] })],
      gaps: ["unknown carrier"],
    },
    state,
  );
  assert.deepEqual(synthesis.triggers.map((t) => t.id), ["T1"]); // T2 had no real evidence
  assert.deepEqual(synthesis.triggers[0].factCardIds, ["E1"]);
  assert.deepEqual(synthesis.people.map((p) => p.personId), ["P1"]);
  assert.deepEqual(synthesis.angles[0].cardIds, ["E1"]);
  assert.deepEqual(synthesis.angles[0].triggerIds, ["T1"]);
  assert.ok(synthesis.droppedReferences.length >= 4);
});

test("exactly one angle ends up recommended and at most one trigger is primary", () => {
  const none = validateSynthesis(
    { relevance: "moderate", summary: "", noMeaningfulAngleNote: "", triggers: [trigger("T1", "primary", ["E1"]), trigger("T3", "primary", ["E2"])], people: [], angles: [angle("A1"), angle("A2")], gaps: [] },
    state,
  );
  assert.deepEqual(none.synthesis.angles.map((a) => a.recommended), [true, false]);
  assert.deepEqual(none.synthesis.triggers.map((t) => t.rank), ["primary", "secondary"]);
  const many = validateSynthesis(
    { relevance: "moderate", summary: "", noMeaningfulAngleNote: "", triggers: [trigger("T1", "primary", ["E1"])], people: [], angles: [angle("A1", { recommended: true }), angle("A2", { recommended: true })], gaps: [] },
    state,
  );
  assert.deepEqual(many.synthesis.angles.map((a) => a.recommended), [true, false]);
  assert.ok(many.warnings.length > 0);
});

test("a general-introduction angle needs no evidence; a strong one with none is flagged", () => {
  const { synthesis, warnings } = validateSynthesis(
    {
      relevance: "none", summary: "", noMeaningfulAngleNote: "nothing relevant", triggers: [], people: [], gaps: [],
      angles: [
        angle("A1", { strength: "general_introduction", triggerIds: [], cardIds: [], recommended: true, title: "General introduction - no specific trigger found" }),
        angle("A2", { strength: "strong", cardIds: [], triggerIds: [] }),
      ],
    },
    state,
  );
  assert.equal(synthesis.angles.length, 2);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /A2/);
});

test("garbage is rejected, unknown enum values fall back safely", () => {
  assert.throws(() => validateSynthesis("nope", state));
  const { synthesis } = validateSynthesis({ relevance: "huge", summary: 5, triggers: "x", people: null, angles: [], gaps: [3, "ok"] }, state);
  assert.equal(synthesis.relevance, "weak");
  assert.equal(synthesis.summary, "");
  assert.deepEqual(synthesis.gaps, ["ok"]);
});

test("email: used evidence is limited to the cards that were supplied", () => {
  const ok = validateEmail({ subject: "Hello", body: "Hi Jane,\r\n\r\nQuick one.\r\n\r\nCheers,", usedCardIds: ["E1", "E2", "E9"] }, [card("E1")]);
  assert.deepEqual(ok.usedCardIds, ["E1"]);
  assert.equal(ok.body.includes("\r"), false);
  assert.equal(ok.warnings.length, 2); // E2 and E9 were not supplied
  assert.throws(() => validateEmail({ subject: "x", body: "  " }, []));
  assert.throws(() => validateEmail(null, []));
});
