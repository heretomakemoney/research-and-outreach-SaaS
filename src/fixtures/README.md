# Fixtures (mock data only)

`upper-hunter.workflow.json` is one saved workflow from a real Upper Hunter Shire Council run (research,
synthesis, selections and one email, with the real stage costs).

**It exists only so the UI, database and persistence can be developed without paid Anthropic calls.**

- It is **not** a benchmark, and not an example of the research quality, triggers, synthesis or outreach we want.
- It must **never** be added to prompts, the intelligence files, examples or instructions, and must not
  influence live research. Live research only uses the intelligence files in `docs/intelligence/` and the
  normal pipeline. `src/lib/mock.test.ts` fails if live code, prompts or intelligence files reference it.
- Only `src/lib/mock/` reads it, and only when `AI_MODE=mock` (see `src/lib/mode.ts`).
- The staff names in it come from public council documents. If this repository is ever made public, mask them first.
