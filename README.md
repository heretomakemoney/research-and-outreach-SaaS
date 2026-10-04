# Account Research & Outreach Tool

Phase 1 prototype ("Q1" architecture). The product is defined in `docs/PRD.md` and `docs/USER_FLOW.md`; the build plan is in `docs/ARCHITECTURE.md`.

**What it does:** you enter one company. The app researches it with Claude (web search and fetch, guided by the intelligence files in `docs/intelligence/`), shows Teltonika relevance, sales triggers, relevant people and conversation angles, every claim linked to its source. You pick an angle and a contact, and it drafts an email in your voice that you can edit, regenerate and copy.

## The pipeline (one request per stage)

| Stage | Model | Web tools | Intelligence files (read from disk on every run) |
|---|---|---|---|
| Discover | Sonnet 5.5 | search + fetch | 01, 02 |
| Follow-up (only if the gate says so) | Sonnet 5.5 | search + fetch | 01, 02 |
| Synthesis | Opus 5.5 | none | 01, 02, 03 |
| Email | Sonnet 5.5 | none | 04, 05 |

Models, limits and gate rules live in `src/lib/config.ts`. `06_LEARNING_RULES.md` is never sent. Only ONE company/workflow is kept, in the browser's `localStorage`. No database.

## Run it on your own computer

1. Node.js 20 or newer. Check with `node -v`.
2. `npm install`
3. `cp .env.example .env.local` and put your Anthropic API key after `ANTHROPIC_API_KEY=`. `.env.local` is git-ignored. Never paste the key into chat or a commit.
4. `npm run dev`, then open http://localhost:3000

Each research run makes real, paid Anthropic calls. The page shows an estimated cost per stage and in total (an estimate, not a bill; the Anthropic Console Usage page is authoritative).

## Other commands

- `npm test`: offline tests with fake API data (free, no key needed), including a full fake run of the whole pipeline
- `npm run typecheck`
- `npm run build`

## Deploying (Vercel)

Set `ANTHROPIC_API_KEY` as a Vercel environment variable (never in the repo) and keep Vercel Authentication on: there is no login of our own, so anyone who can open the site can spend your Anthropic money. Each stage is a separate request, so each stays within the 300 s function limit.
