# Account Research & Outreach Tool

Phase 1 prototype (Milestone 1). The product is defined in `docs/PRD.md` and `docs/USER_FLOW.md`; the build plan is in `docs/ARCHITECTURE.md`.

**Milestone 1 does one thing:** you enter a company, and Claude (with web search and web fetch, guided by our intelligence files in `docs/intelligence/`) identifies it, classifies it, and shows the result with its sources and usage.

## Run it (on your own computer)

1. Install Node.js 20 or newer (https://nodejs.org). Check with `node -v`.
2. In this folder, install the packages:
   ```
   npm install
   ```
3. Create your private settings file and add your key:
   ```
   cp .env.example .env.local
   ```
   Open `.env.local` and put your Anthropic API key after `ANTHROPIC_API_KEY=`.
   `.env.local` is git-ignored. Never paste the key into chat, an issue, or a commit.
4. Start the app:
   ```
   npm run dev
   ```
5. Open http://localhost:3000, type a company name, click **Research**.

Each click makes real, paid Anthropic API calls (typically cents to a couple of dollars; the page shows usage and an estimate). In the Anthropic Console, set a monthly spend limit and make sure web search is enabled for your organisation.

## Other commands

- `npm test`: unit tests for the source ledger and cost estimate (fake data, free, no key needed)
- `npm run typecheck`: TypeScript check
- `npm run build`: production build check

## Do not deploy this yet

There is no login. Anyone who could open a deployed copy could spend your Anthropic money. Run it locally. Add an access gate before any deployment.
