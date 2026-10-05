# V1 Technical Architecture

**Product:** Account Research & Outreach Tool (working title)
**Version:** 0.3 (reconciled with Phase 1 results and the Phase 2 plan)
**Date:** 2026-10-05
**Inputs:** `docs/PRD.md` (what), `docs/USER_FLOW.md` (how it behaves), `docs/intelligence/` (research, trigger and outreach logic)
**Companion document:** `docs/DATA_MODEL.md`

The **top section below is the current architecture.** Sections 0 to 17 are the original researched proposal; where a section is marked *superseded* the top section wins. Nothing here changes the locked PRD or USER_FLOW.

**How much to trust the numbers.**
- Anthropic prices, tool behaviour and limits were read from Anthropic's official documentation on 2026-10-03.
- Prices for every other vendor come from third-party price summaries and search snippets, because the vendors' own sites were not reachable from my environment. Treat them as approximate and re-check before paying.
- Cost and duration figures in section 8 are **estimates I have not measured**. Section 12 proposes a small test (the "spike") that replaces them with real numbers before the app is built.

---

## Current architecture and implementation phases (read this first)

### Status of the rest of this document

| Sections | Status |
|---|---|
| 0, 1, 2, 6, 9, 11, 13, 14, 16 | Still valid background and rationale |
| 3 (system), 4 (research pipeline), 5 (services), 7 (structured output) | **Superseded** by "The implemented research pipeline" below. Parallel discovery threads, a separate structuring step and 13 to 15 calls were replaced by 3 to 5 staged calls |
| 8 (cost) | **Superseded**: measured numbers below |
| 10 (security and access) | **Partly superseded**: authentication is decided at the production step (below) |
| 12 (validation spike), 15 (decisions), 17 (build order) | **Done or superseded** by the phases below |

### The phases

| Phase | Goal | What it has | Status |
|---|---|---|---|
| **1. Research prototype** | Prove the pipeline matches Claude Project research quality | Next.js app, the staged pipeline, results, angle and contact selection, email, one workflow in browser `localStorage`, deployed on Vercel | **Done.** The pipeline works end to end. The UI was too verbose |
| **2. Usable V1** | Something you open every week | Accounts table, company page (Research and Outreach), company context and per-run topic, saved companies, research runs and the one current email per company, in **PostgreSQL (Supabase)**; **one company at a time** | In progress. Step 2: UI on mock data. Step 3: PostgreSQL. Later: resume interrupted runs, authentication |
| **3. Full V1** | Everything in the PRD and USER_FLOW | Background worker, Queued status, batch of up to 5, leaving and returning during research | Not started |

Cost optimisation of the research pipeline happens after Phase 2 works. The live pipeline is frozen until then.

### The implemented research pipeline (live)

One request per stage; the browser drives the stages today.

| Stage | Model | Web tools | Intelligence files (read from disk on every run) | Output |
|---|---|---|---|---|
| Discover | Sonnet 5.5 | Anthropic web search + fetch | 01, 02 | Tagged lines: identification, evidence cards, people, open leads, coverage |
| Follow-up (only if the gate says so) | Sonnet 5.5 | web search + fetch | 01, 02 | New cards, people, lead results |
| Synthesis | Opus 5.5 | none | 01, 02, 03 | Relevance, ranked triggers (FACT / INFERENCE / POSSIBLE OPPORTUNITY), ranked people, 1 to 4 angles with one recommended, gaps |
| Email (on demand) | Sonnet 5.5 | none | 04, 05 | Subject, body, facts relied on |

- **Gate:** plain code between stages. It stops when the company is ambiguous, runs one follow-up round when there are open leads (or no people, or only a company profile), and otherwise goes to synthesis.
- **Evidence cards and sources:** facts are stored as cards (E1, E2, ...) tied to source IDs (S1, S2, ...) assigned by our code. A card or person is kept only if it has an **evidence grade**: *api_cited* (the API attached a citation), *quote_verified* (the quoted words were found in the page text the API returned) or *tool_source* (the named URL exactly matches a page the tools returned or fetched, including PDFs; wording not checked). Claude-written URLs that the tools never returned are rejected.
- **Dynamic filtering:** the web tools run in their default mode, in which Claude's own code filters results first. It is much cheaper and returns no citations, which is why `tool_source` exists. A "direct" mode costs more and still returned no citations in testing; it remains a configuration switch.
- **Compact state between stages:** cards, people, leads, coverage and a short source table, never raw pages.
- **Rules:** `01` to `05` are sent verbatim at run time. `06` is never sent. Prompts contain only a thin wrapper (unattended behaviour, output format).
- **Retrieval layer:** one interface (`EvidenceRetriever`). Anthropic web tools are the only implementation; an external search provider could be added without touching the stages.
- **Measured cost (one real run, Upper Hunter Shire Council):** discover $0.45, follow-up $0.58, synthesis $0.19, one email $0.02, total about **$1.23**, about 7 minutes. Estimates, not bills. The target after optimisation is much lower.

### Mock mode and the fixture

`AI_MODE=mock|live` (`src/lib/mode.ts`). Mock answers from a saved Upper Hunter run (`src/fixtures/`) and never creates an Anthropic client. Production builds default to live; development and tests default to mock. **The fixture is development and test data only: it never enters prompts, intelligence files, examples or live research**, and tests enforce this.

### Phase 2 architecture

| Part | Decision |
|---|---|
| Frontend | Next.js + TypeScript. Accounts table; company page with Research and Outreach tabs; panels for context, details and delete |
| Data access | A **repository interface**. The UI never touches `localStorage` or the database directly. Implementations: in-memory mock (Step 2), PostgreSQL (Step 3) |
| Database | **PostgreSQL on Supabase**, used as plain Postgres through a server-only `DATABASE_URL`. The browser never talks to the database |
| State between stages | Held in the database once it exists. Stage routes take a run ID, load state, run and save. (Today the browser holds it and sends it back, validated, on each stage) |
| Research driving | Still browser-driven in Phase 2, because one stage can take up to about 5 minutes and Vercel limits a request to 300 seconds. Closing the tab stops the run. Resuming an interrupted run comes after database persistence |
| Background jobs, queue, batch | Phase 3 |
| Authentication | **Deferred to the production step.** The prototype is protected by its host. Options to decide then: the database host's auth, or a simple password. API keys and `DATABASE_URL` are server-only secrets, never in the repository or the browser |
| Cost cap | A configurable company-level cap exists in code and is off |
| What is stored per run | The whole research result (cards, sources, people, leads, coverage, synthesis, gate log), stage logs with usage and estimated cost, warnings, the rules version (hash) and models used. Fetched page text is not stored |

---

## 0. Plain-English glossary

| Term | What it means |
|---|---|
| **Frontend** | What you see and click in the browser: the Accounts table, the Research tab, the email editor. |
| **Backend / server** | The part that runs on a computer you rent, not in your browser. It checks your password, reads and writes the database, and starts research. |
| **Database** | Where information survives after you close the browser. Companies, research results, your context, your emails. |
| **Background worker** | A program that keeps running on the server whether or not you have the page open. It does the actual research. This is how "research continues when I leave the page" works. |
| **Queue** | A waiting list. Five companies submitted at once go on the list; the worker takes them off a few at a time. "Queued" in the product is literally this. |
| **LLM API** | Claude, reached over the internet by sending it text and getting text back. You pay per token (roughly per word). |
| **Server tool** | A tool Claude can use that Anthropic runs for us. Web search and web page fetch are server tools: Claude decides to search, Anthropic's servers do it, and results come back inside the same response. |
| **Structured output** | Asking Claude to answer in a strict, machine-readable format (JSON) so the app can store it in database tables rather than showing one big blob of text. |
| **Source ledger** | A numbered list of every web page the research touched (S1, S2, S3…), built by our code, not by Claude. Findings point at these numbers. It is what keeps evidence traceable. |
| **Spike** | A quick throwaway experiment to answer a risky question before committing to building. |

---

## 1. The problem, and the decisions that matter

### The problem in plain English

The value of this product is **deep research**: many searches, reading pages and PDFs, following leads, and producing evidence-backed findings, with the fact/inference line kept clean. A single call that says "research Company X" to an AI model does not do that. Three hard things sit underneath:

1. **Getting information.** Something has to search the web and read pages and PDFs.
2. **Doing it in steps, for minutes, without the browser.** Research takes several minutes per company and must survive you closing the tab. Five companies means five of these at once.
3. **Keeping it honest.** Every finding has to point at real evidence, and the model must not invent it.

### The decisions in one table

| # | Decision | Recommendation | Why, in one line |
|---|---|---|---|
| 1 | Who searches and reads the web | **Claude's built-in web search and web fetch tools** (Anthropic runs them) | One vendor, one key, returns URLs and citations, reads HTML and PDFs, no crawler to build |
| 2 | Who orchestrates the research | **Our own staged pipeline** (code decides the steps; Claude does each step) | We control the method, so it follows `docs/intelligence/` instead of whatever a black box does |
| 3 | How findings become data | **Claude writes research notes with citations; a second, tool-free Claude call turns them into strict JSON** | Web tools and strict JSON output cannot be reliably combined in one call (see 4.6) |
| 4 | How evidence stays traceable | **A source ledger built by our code from the API's own response blocks**, plus checks that reject unsupported claims | Claude references ledger numbers; it never invents URLs |
| 5 | How research runs without the browser | **A background worker reading a "waiting list" in the database** | No separate queue service is needed for one user |
| 6 | Where it lives | **One Next.js (TypeScript) codebase: web app + worker, on Railway, with PostgreSQL** | One language, one platform, one bill |
| 7 | Access control | **One shared password, session cookie, worker not reachable from the internet** | Enough for a private single-user tool |
| 8 | Risk control | **A spike first**, plus per-run time and cost caps | The riskiest unknowns are research quality and cost, not the UI |

---

## 2. Recommended V1 stack at a glance

| Component | Choice | Replaces / alternatives rejected |
|---|---|---|
| Frontend + web backend | **Next.js (App Router) + React + TypeScript**, Tailwind CSS | Python + templates; separate React app + API |
| Database | **PostgreSQL** (hosted next to the app) with **Drizzle ORM** for tables and migrations | SQLite, Supabase, Firebase, a document database |
| Background jobs | **Our own worker process + a queue table in Postgres** | Redis/BullMQ, Trigger.dev, Inngest, AWS SQS, Temporal |
| LLM | **Anthropic API: Claude Opus 5.5 by default**; Sonnet 5.5 is a configurable cost option | Other model families |
| Web search + page/PDF reading | **Anthropic server tools: `web_search` and `web_fetch`** (newest version available at build time) | Brave, Tavily, Exa, Firecrawl, research APIs (kept as plan B) |
| Validation of AI output | **Zod schemas** that define the JSON shape and check it | Trusting raw text |
| Hosting | **Railway**: one project, three parts (web, worker, Postgres) | Vercel + Neon + Trigger.dev; Render; Fly.io |
| Access protection | **App-level shared password** + signed session cookie | Cloudflare Access, full user accounts |
| Secrets | **Platform environment variables** | Secrets in the repo |
| Live status | **Browser polls every few seconds** | WebSockets, server-sent events |

External services needed: **Railway** (hosting) and **Anthropic** (AI + web). That is two vendors.

### MUST HAVE NOW

- Next.js app (screens from USER_FLOW) and one worker process, same repo.
- PostgreSQL with the tables in `DATA_MODEL.md`.
- A queue table with limited concurrency, heartbeats and crash recovery.
- The staged research pipeline using Claude web search and fetch.
- The source ledger and deterministic evidence checks.
- Structured output with schema validation, for both research and email.
- Per-run time and cost caps, and a monthly spend limit on the Anthropic account.
- Shared-password login.
- A `run_event` log, so progress and failures are visible.
- A saved-response test mode, so development does not cost real money.

### COULD ADD LATER

- A second search provider (Brave, Exa or Tavily) if the spike shows coverage gaps.
- A research API (such as Parallel) as the discovery engine, if the spike shows it is cheaper at similar quality.
- Direct feeds for tenders (the official AusTender API).
- Our own PDF reading and keyword excerpting for long council documents.
- An LLM "claim checker" pass for FACT findings.
- Cancel-a-run (technically easy, see section 14).
- A managed job service if the DIY worker proves flaky.
- Cloudflare Access in front of the app.
- Nightly database dumps to storage.
- Batch API (half price, slower) for "overnight" research.

---

## 3. System architecture

> **Superseded** for Phases 1 and 2 by the top section (browser-driven stages, no worker). The worker design here is the Phase 3 target.

### 3.1 The components

```
 YOU (browser)
   │  HTTPS, password login
   ▼
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ WEB APP (Next.js)            │        │ WORKER (Node, same repo)     │
│ • screens (USER_FLOW)        │        │ • takes runs off the queue   │
│ • API routes (add company,   │        │ • runs the research pipeline │
│   start research, edit,      │        │ • writes results + progress  │
│   generate email, copy)      │        │ • no public address          │
└──────────────┬───────────────┘        └───────┬──────────────┬───────┘
               │ reads / writes                 │              │
               ▼                                ▼              │ HTTPS
        ┌──────────────────────────────────────────┐           ▼
        │ POSTGRESQL                               │   ┌─────────────────────┐
        │ companies, runs (= the queue), sources,  │   │ ANTHROPIC API       │
        │ findings, people, angles, emails …       │   │ Claude + web search │
        └──────────────────────────────────────────┘   │ + web fetch         │
                                                       └─────────────────────┘
```

> **Plain English.** The web app is the front desk: it takes your request, writes a note in the database, and shows you what is in the database. The worker is the researcher in the back room: it reads the notes, does the work, and writes results back. They never talk to each other directly. They only share the database, which is why leaving the page cannot stop research.

| Component | What it does | Runs where |
|---|---|---|
| **Web app** | Shows the screens, checks your password, saves edits, creates research runs, generates emails (a short, seconds-long Claude call) | Railway service 1 |
| **Worker** | Executes research runs; sends heartbeats; recovers stuck runs | Railway service 2, always on, no public URL |
| **PostgreSQL** | The only place data lives | Railway database |
| **Anthropic API** | Claude reasoning, plus web search and page fetch run on Anthropic's side | External |

### 3.2 Flow: you submit one company

1. You press **Add and research**. The browser sends the company name, website, context and topic to the web app.
2. The web app checks your login, saves the company, and creates a **research run** row with status `queued`, including a **snapshot** of the context and the topic. It returns immediately.
3. The browser shows the row as **Queued**. It asks the web app for status every few seconds.
4. The worker, which checks the database every few seconds, sees the run and claims it. Status becomes `researching`, and a heartbeat starts.
5. The worker runs the pipeline (section 4). After each stage it saves what it found and writes a progress line to `run_event`. The Accounts table and company page show these real stage names (USER_FLOW section 8).
6. Searching and reading happen inside Claude calls: Claude decides what to search, Anthropic's servers run the search and fetch, and the response comes back with URLs, titles and citation excerpts.
7. Our code builds the **source ledger** from those response blocks, and a final tool-free Claude call turns the notes into structured findings, people, triggers and angles.
8. Our code validates the result, saves findings and sources to their tables, sets the final status (`done`, `partial` or `failed`), and updates which run is the company's default research.
9. At your next poll, the row says **Done**. If you are looking at older research, you get the "New research is ready" banner instead of an automatic swap (USER_FLOW section 8).

### 3.3 Flow: you submit five companies

- Five companies are created. Five runs are written as `queued`.
- The worker runs a limited number at once. **Start with 3 concurrent runs**, configurable.
- Runs are taken oldest first. Three show **Researching**; two show **Queued**. As each finishes, the next starts.
- Each run is fully independent (own context snapshot, own sources, own result). One failing changes nothing for the others (PRD FR-25).
- Estimated waiting time (unmeasured): about 8–15 minutes per company, so the last of five finishes roughly 20–30 minutes after submission at concurrency 3.
- You can submit another batch while these run; the extra runs simply wait in the queue (FR-28).

> **Why not run all five at once?** Cost is the same either way, because you pay per search and per token. The limit is **rate limits** at Anthropic: each research thread reads a lot of text, and an account allows only so many tokens per minute. Five runs times several parallel threads can exceed it and cause 429 "slow down" errors. Starting at 3 and raising it when the logs show no rate-limit errors is the safe approach. Your account's usage tier sets the real ceiling; check it in the Anthropic Console.

### 3.4 Flow: you open a company

The web app reads from the database only. It shows the default research (the most recent `done` run, otherwise the most recent `partial` run), the company context, and the current status of the latest run, as defined in USER_FLOW sections 9 and 14.

### 3.5 Flow: you generate an email

1. You choose one angle and one contact, then press **Write email**.
2. The web app makes **one** Claude call, with no web tools. It runs during the request and takes seconds. No worker is needed.
3. Claude receives: the intelligence rules for outreach (`04`, `05`), the selected angle and its underlying findings with their source excerpts, the contact (name and role), and the company context.
4. Claude returns structured JSON: subject, body, outreach mode, the reason for that mode, which findings it used, and a limitation flag (`none`, `weak_hook` or `fallback_general`).
5. The app validates it, stores it as the company's **one current email** together with a snapshot of the findings it relied on, and shows it.
6. Editing saves automatically. **Regenerate** repeats steps 2–5 and replaces the stored email.

### 3.6 Flow: re-research

A new run is created. The old default research stays untouched and visible. When the new run finishes `done`, the company's default-research pointer moves to it and the angle selection is cleared. The current email stays, tagged with the research it was based on. Nothing is ever overwritten or deleted (PRD principle 10).

### 3.7 Responsibilities, in one place

| Concern | Handled by |
|---|---|
| Screens, forms, copy button | Web app |
| Password check, session | Web app |
| Queue, concurrency, retries, crash recovery | Worker + `research_run` table |
| Searching and reading the web | Anthropic server tools (inside Claude calls) |
| Deciding the research steps | Our pipeline code |
| Building the source ledger | Our code |
| Turning notes into findings | Claude (tool-free, structured output) |
| Rejecting unsupported claims | Our validation code |
| Remembering everything | PostgreSQL |

---

## 4. The research pipeline

> **Superseded** by "The implemented research pipeline" at the top. Read this section for the original reasoning only: the parallel discovery threads, the separate structuring step and the 13 to 15 call count were not built.

### 4.1 Design principle

> **Code decides the steps. Claude does the thinking inside each step. The database remembers every step.**

This follows the structure of `01_RESEARCH_RULES.md`: identify the entity first (§0), research broadly before ranking (§2), search many source types (§3), follow promising leads (§6), find people (§7), keep history separate from current triggers (§8), and only then rank triggers (§9) and write the required output (§12). The pipeline is that document turned into stages.

### 4.2 Stages at a glance

| # | Stage | Uses web tools? | Runs | Main output |
|---|---|---|---|---|
| 0 | **Prepare** | No | Once | Run opened, inputs snapshotted |
| 1 | **Identify and classify** | Yes | Once | Entity, trading name and evidence, website, industry, client type, or "company unclear" |
| 2 | **Broad discovery** | Yes | 4–5 threads in parallel | Research notes with citations from each angle of attack |
| 3 | **Follow-up** | Yes | Up to 4 short threads | Deeper notes on the best leads |
| 4 | **Synthesis** | No | Once | Structured findings, triggers, people, angles, gaps |
| 5 | **Validate and save** | No | Once | Checked data stored; final status set |

This is deliberately fewer than the ten stages in your brief. Stages like "lead extraction", "evidence extraction" and "trigger classification" are folded into the search threads (which produce evidence-bearing notes) and the single synthesis call (which classifies and ranks). Fewer calls means lower cost and fewer places to fail. If testing shows a merged stage is weak, it can be split.

### 4.3 Stage detail

**Stage 0. Prepare.**
- Create the run, store the context and topic snapshot, record the intelligence-rules version (a content hash of `docs/intelligence/`, so every result states which rules produced it).
- Assemble the system prompt from the intelligence files (see 4.5).

**Stage 1. Identify and classify.** One Claude call with web search and web fetch (starting caps: about 6 searches, 4 fetches, 4 minutes).
- Follows `01` §0 and §1: find the official website; check whether the supplied name is a legal entity with a different trading name (ABN/ASIC, matching addresses, domains, phone numbers); give a confidence level; classify industry (the listed categories, or Other) and client type (Distributor, Integrator, End user, Unknown).
- If the company cannot be identified, or several companies fit, the run **ends Failed with reason "company unclear"** and stores the candidates found (USER_FLOW section 15).
- All later stages research under the trading name when one is confirmed.

**Stage 2. Broad discovery.** Four parallel Claude calls, each with web search and web fetch (starting caps per thread: about 10 searches, 8 fetches, 8 minutes). Each thread has a narrow job and returns notes in a fixed template (see 4.4):

| Thread | Looks for | Maps to |
|---|---|---|
| **A. News, projects, contracts** | Company site, newsroom, case studies, project pages, customer and partner announcements, ASX releases, press, last 12 months first | `01` §3, §5, §9 |
| **B. Government and public documents** | Tender and contract-award notices, government project pages; for councils, water utilities and similar bodies: meeting agendas and minutes, committee reports, budgets, capital works schedules, asset plans, searching for SCADA, telemetry, radio vs 4G/5G, pump stations, CCTV | `01` §3 (public sector) |
| **C. Technology, vendors, partners** | Existing technology and vendors, partner and vendor case studies, job adverts revealing technologies or teams, conference and exhibitor lists, older projects for background | `01` §4, §5, §8 |
| **D. People** | Named people connected to the specific project or technology: engineering, networks, OT, operations, projects, procurement, partnerships, found through company pages, announcements, tender documents, presentations, interviews, and anything public search surfaces | `01` §7 |
| **E. Topic** (only if you gave a topic) | Your specific question | PRD UC-8 |

Notes:
- The company context is included, labelled **user-supplied, unverified**. It steers the work (for example, "known competitor X" or "already buys via a distributor") but is never treated as evidence.
- For public-sector organisations, thread B gets the governance-document instructions from `01` §3. For others it focuses on tenders and contracts.
- Search results are localised to Australia (the tool accepts a country setting).
- Domain filters are **not** used to block aggregators; the rules want them as a last resort and clearly flagged, not invisible.

**Stage 3. Follow-up.** Up to 4 short threads (starting caps: about 6 searches, 5 minutes each).
- A cheap Claude call (tool-free, structured output) reads the Stage 2 notes and lists the most promising leads: a named project, a contract, a partner, a person.
- Each lead gets a focused search following `01` §6: company + project, customer + project, partner + project, project + connectivity/IoT/4G/5G, project + tender/contract, project + deployment/update.
- **Two rounds in total (broad, then follow-up) in V1.** A third round is a later tuning option.

**Stage 4. Synthesis.** One Claude call, **no web tools**, structured output.
- Receives: the intelligence rules `01`–`03`, the context snapshot, the topic, all thread notes, and the compact source ledger.
- Returns the structured objects in section 7.
- This is where classification, ranking, FACT / INFERENCE / POSSIBLE OPPORTUNITY labelling, the recommended angle, the verdict line, context-conflict flags, and research gaps are decided, following `02` and `03`.

**Stage 5. Validate and save.** Plain code, no AI (4.7). Saves results, sets final status, moves the default-research pointer if the status is `done`.

### 4.4 What Claude receives and returns in a search thread

**Receives** (one request):
- *System:* the relevant intelligence rules (`01`, `02`, `03`) and the thread's job description.
- *User:* company name and website, the confirmed trading name and classification from Stage 1, the context snapshot labelled "user-supplied, unverified", the topic if any, and today's date.
- *Tools:* web search and web fetch, with caps on uses.

**Returns** research notes in a fixed template:

```
FINDINGS        – one block each: what happened, date (or "undated"),
                  the URL(s), and a short verbatim quote (25 words or fewer)
PEOPLE          – name, role, why connected, URL
TECHNOLOGY      – technology/vendor/partner seen, where, URL
BACKGROUND      – older but relevant, with dates
NOT FOUND       – what was searched for and not found
LEADS           – up to 3 things worth a follow-up search
```

The response also contains, as separate blocks created by Anthropic and not by Claude: the list of search results (URL, title, page age), the full text of pages Claude fetched, and **citations** attached to sentences, each carrying an excerpt (`cited_text`, up to 150 characters) taken from the real page.

### 4.5 How the intelligence documents are used at run time

- `01`–`03` go into the research and synthesis prompts verbatim, so the markdown files remain the source of truth. Editing a file changes behaviour on the next run, with no code change.
- `04` and `05` go into the email prompt verbatim.
- `06` (learning rules) is **not** sent to the model in V1. Feedback stays manual (PRD).
- The system prompt is identical across runs, so it is cached (Opus 5.5 cache reads cost $0.20 per million tokens against $4 for fresh input).
- Each run stores a hash of the rules it used.

### 4.6 Why two steps: research with tools, then structure without tools

Anthropic's structured-output feature forces the answer into a strict JSON shape. Its documentation lists limits and does not describe combining it with web search or web fetch citations; the older document-citation feature is explicitly incompatible with it. I am treating the combination as **unsupported until the spike proves otherwise**. The two-step design also has real advantages:

- The synthesis step is guaranteed to return valid JSON in our schema.
- A cheaper model can parse leads.
- The raw notes are stored, so a failed synthesis can be retried without repeating the expensive searching.

### 4.7 The source ledger and how sources stay traceable

Our code walks every response and builds a numbered ledger:

| Where it comes from in the response | What goes into the ledger |
|---|---|
| Search result entries | URL, title, "page age" |
| Fetch results | URL, retrieval time, whether it was a page or PDF, and the page text (HTML) |
| Citations on Claude's sentences | URL plus `cited_text`, an excerpt produced by Anthropic from the real page |

Rules:
1. URLs are de-duplicated by canonical form. Each gets an ID: S1, S2, S3…
2. Claude is told to **reference sources only by URL it actually saw**, and synthesis references only **ledger IDs**. A finding pointing at an ID not in the ledger is rejected.
3. **Evidence excerpts have an origin:** `api_citation` (excerpt returned by Anthropic, the strongest), `quote_verified` (a quote Claude wrote that our code found in the fetched page text), or `quote_unverified` (a quote we could not check, shown with a flag).
4. A source's type is classified by simple domain rules (government domains, the company's own domain, a short aggregator list), refined in synthesis.
5. Aggregators (Wikipedia, Crunchbase, ZoomInfo and similar) are flagged `is_aggregator` and surfaced as the *Aggregator source* flag in the UI.

> **Plain English.** Claude does the reading and the writing. Our code does the bookkeeping, and the bookkeeping is what lets you click "View evidence" and land on a real page with a real quote.

### 4.8 How hallucination is reduced

| Control | What it prevents |
|---|---|
| Sources come from the API's response blocks, not from Claude's memory | Invented URLs |
| Findings must reference ledger IDs | Claims with no source |
| FACT requires at least one evidence excerpt (code enforces it) | Unsupported "facts" |
| Any FACT without evidence is automatically downgraded to INFERENCE and flagged, or dropped | Confident-sounding guesses |
| INFERENCE must say which FACT(s) it is derived from | Floating speculation |
| Quote verification against fetched text where text exists | Misquoted evidence |
| Date required per development, otherwise stored as "undated" and the rank capped | Stale news ranked as a fresh trigger |
| Rules in the prompt: no speculative developments, they go to Research gaps (`01` §10) | "A re-tender is probably underway" |
| "No result" is a valid answer in every thread template (the NOT FOUND section) | Padding to fill the page |
| Strong rank allowed only for FACT within 12 months, enforced in code | Over-ranking |
| User context is labelled unverified and cannot create a FACT | Your private notes becoming "evidence" |
| Optional second pass by a cheap model that re-checks each FACT against its excerpt (not in the first build) | Residual errors |

### 4.9 How FACT / INFERENCE / POSSIBLE OPPORTUNITY are preserved

- Every finding has exactly one `label` in the schema (section 7).
- Triggers carry a three-step chain (`02` §4): the FACT, the INFERENCE about connectivity, the POSSIBLE OPPORTUNITY worth asking about.
- Angles are always POSSIBLE OPPORTUNITY, except the fallback "General introduction" angle, which has no label (USER_FLOW section 10).
- Context-derived content carries the flag `from_context` and can never be FACT.
- The database stores the label as an enumerated column, so the UI cannot lose it.

### 4.10 PDFs and documents

- Claude's fetch tool returns PDFs as documents the model reads directly. No text-extraction code is needed in V1.
- Fetch is limited to HTML, text and PDF. Pages that need JavaScript to display content are not rendered, and pages blocked by `robots.txt` or sites that refuse automated access come back as errors.
- **Cost warning.** A long PDF is billed as input tokens. A 500 KB research paper is roughly 125,000 tokens. A full council agenda pack can be much larger. Mitigations in V1: prefer search snippets and targeted PDFs, cap fetches per thread, and use the newest tool version, which can filter content before it enters context. A V2 option is our own PDF fetch that extracts text and keeps only passages around terms like SCADA, telemetry and 4G.

### 4.11 What happens to a page that cannot be read

Claude receives an error result (for example "URL not accessible") and carries on with other sources. The failure is recorded in `run_event`. If a whole thread produces nothing readable, it is marked as not completed, which leads to **Partial** (section 9).

### 4.12 Number of iterations and calls, per company

| Item | Typical | Cap |
|---|---|---|
| Claude calls with web tools | 6–10 | ~10 |
| Web searches in total | 35–55 | ~70 |
| Claude calls without web tools | 3 (lead parse, synthesis, later email) | 4 |
| Search/follow-up rounds | 2 | 2 |
| Wall-clock time | 8–15 min | 30 min hard cap |

### 4.13 A pluggable discovery step

Each discovery thread is written as "given a job, return notes plus ledger entries". That keeps the door open to swap a thread, or all of Stage 2, for a different engine (a research API or a search API with our own page reading) without touching storage, synthesis or the UI. This is the main way the architecture stays able to change after the spike.

---

## 5. External services and options

> **Decided:** Anthropic only for AI and web access; PostgreSQL on **Supabase**; Vercel hosting. Background jobs (5.4) are Phase 3.

### 5.1 A. LLM

| Option | Role | Strengths | Weaknesses | Price (per million tokens) | Verdict |
|---|---|---|---|---|---|
| **Claude Opus 5.5** | Search threads, synthesis, email | Strongest Claude for multi-step tool use; same family as the Claude Project prototype; prompt caching at $0.20 per million cache reads | Most expensive Claude tier we would use | $4 in / $20 out | **Default** |
| **Claude Sonnet 5.5** | Optional for search threads and parsing | About half the price of Opus; strong at everyday agent work | Slightly lower reasoning depth, to be measured | $2 in / $10 out | **Configurable cost lever; measure in the spike** |
| **Claude Haiku 4.5** | Lead parsing, optional claim checking | Cheapest | Too light for synthesis | $1 in / $5 out | Small helper roles only |
| Google Gemini | Alternative engine, with Google Search grounding | Strong search coverage | Different model family from the validated prototype; the intelligence prompts would need re-tuning; search grounding about $14 per 1,000 queries beyond a free allowance | Varies | Rejected for V1. A fallback if Anthropic's search coverage is weak |
| OpenAI | Alternative | Has a deep-research API | Same re-tuning issue; $10/$40 per million tokens for the deep-research model, plus $10 per 1,000 searches | $10 in / $40 out | Rejected for V1 |

Model choice per stage is a **setting**, not a code change. Your decision: see section 15.

Claude-specific handling the pipeline must include: stream long requests; continue when a turn is paused (`pause_turn`) up to a capped number of times; handle the `refusal` stop reason and enable the API's server-side fallback option for Opus 5.5; thinking set to adaptive; effort set explicitly (Opus 5.5 defaults to a lower level than earlier Opus, so research threads start at medium and synthesis at high).

### 5.2 B. Web search, page reading and research

| Option | What it actually does | Role in our architecture | Strengths | Weaknesses | Approximate price | Returns URLs/sources | Pages/PDFs | Fit for deep multi-step research |
|---|---|---|---|---|---|---|---|---|
| **Anthropic web search + web fetch** | Claude searches and reads pages inside the API call. Anthropic runs it. | **Search + reading engine for every research thread** | One key, no crawler; citations with excerpts built in; PDFs supported; free code-execution filtering; domain filters; location setting; works in batch mode; fetch has no extra fee | Search index is a black box; no JavaScript rendering; obeys `robots.txt`; account-level rate limits; each search result is billed as input tokens; web search needs to be enabled for the organisation | **$10 per 1,000 searches**; fetch free; plus tokens (verified in Anthropic docs) | Yes (URLs, titles, page age, cited excerpts) | HTML, text, PDF | **Good.** Claude can search and fetch repeatedly in one turn |
| **Brave Search API** | Plain web search from Brave's own index | Plan B search source, if Claude's search misses things | Independent index; "LLM context" mode; cheap | We would have to read pages ourselves; no free tier now, only a monthly credit | About $5 per 1,000 requests | Yes | No (search only) | Needs our own reading layer |
| **Tavily** | Search, URL extract, crawl, and a research endpoint, built for AI agents | Plan B for search and extract | Easy; extract is cheap; has a "research" mode | Credits model; research mode is a black box | $0.008 per credit; search 1–2 credits; extract 1 credit per 5 URLs; research 4–250 credits | Yes | HTML mostly | Moderate |
| **Exa** | "Neural" semantic search plus contents and deeper search/agent endpoints | Plan B for semantic discovery | Good for "find pages like this"; company and people style searches | Pricing grows with results and contents; people search relies on indexed professional-network data (see the policy note below) | About $7 per 1,000 searches; contents $1 per 1,000 pages; deep search $12–15 per 1,000 | Yes | Yes | Moderate |
| **Firecrawl** | Fetches and cleans pages, including JavaScript sites and PDFs, plus search | Plan B for pages Claude's fetch cannot read | Handles JavaScript pages; PDF parsing | Subscription only; PDF pages cost credits | From $19 per month (5,000 credits); about 1 credit per page; PDFs 1 credit per page | Yes | Yes (JS, PDF) | Reading layer only |
| **Research APIs** (Parallel Task API, Perplexity Sonar Deep Research, Gemini Deep Research, OpenAI deep research, Tavily Research) | You ask one question; a vendor's own agent researches and returns a report, often with citations | Possible replacement for Stage 2 | Very cheap per run for some (Parallel Pro quoted at about $0.10 per run; Perplexity roughly $0.3–1.5; Gemini roughly $1–3); minimal code; some return structured fields with per-field citations | **Black-box method**, so we cannot make it follow `01_RESEARCH_RULES.md` step by step; quality on Australian council and tender sources unknown; another vendor and key; vendor-quoted accuracy figures are marketing | $0.10 – $3+ per run, varies | Yes | Yes | Good at breadth, weak at rule-following |
| **AusTender official API** | Government contract notices (OCDS data) | V2 direct source for supplier contract history | Free and authoritative | No server-side filtering by supplier name; we would download and filter ourselves; federal contracts only | Free | Yes | Structured data | Narrow |

**Recommendation.** Use Anthropic's tools only in V1. Make the discovery step pluggable (4.13). The spike (section 12) should also try **one research API** against the same companies, because the price gap could be large.

> **A policy point on people research.** `01` §7 asks for public LinkedIn profiles and posts "where accessible". LinkedIn blocks automated access, Claude's fetch tool will not read it, and the PRD forbids automated LinkedIn scraping. Some search APIs sell access to indexed profile data. Whether that is acceptable is your decision, not an engineering default. V1 people discovery will therefore rely on company pages, announcements, tender and council documents, event speaker lists, interviews and whatever public search surfaces. Expect **fewer people than your Claude Project prototype found**; I flag this as the main quality gap (section 13).

### 5.3 C. Database and backend services

| Option | What it is | Strengths | Weaknesses | Price | Verdict |
|---|---|---|---|---|---|
| **PostgreSQL on Railway** | A standard database next to the app and worker | Same platform and private network as the app; always on (no cold starts); plain Postgres, easy to move | Backups on the Hobby plan are not included (only on Pro); you manage restores | Included in Railway usage | **Recommended** |
| Neon (serverless Postgres) | Hosted Postgres that sleeps when idle | Generous free plan; branching; managed | The worker polling the database would stop it ever sleeping, and free compute hours (100 per month) may run out | Free tier, then paid | Good alternative; same code |
| Supabase | Postgres plus login, storage and realtime | Rich features | Free projects pause after 7 days of inactivity; Pro is $25 per month; we would use almost none of the extras | Free / $25 | Rejected: pays for features we do not need |
| SQLite (file) | A database in one file | Simplest possible | The web app and the worker run as two separate programs, and a file on one disk cannot be shared safely between two services | Free | Rejected |
| Firebase / document database | Hosted document store | Easy start | Our data is relational (company → runs → findings → sources); lose integrity | Varies | Rejected |

The design uses **only plain PostgreSQL features**, so moving between hosts later is a connection-string change.

**Backup posture (a decision for you, section 15).** Most data is **re-creatable** by re-running research, at a cost. What cannot be recreated is small: your company context, manual contacts and edited emails. V1 can accept the host's defaults and take an occasional manual export; a nightly automatic dump to storage is a cheap addition when the data starts to matter.

### 5.4 D. Background jobs and queues

**Is a dedicated queue service needed in V1? No.**

For one user and at most a few runs at once, the database can be the queue. The `research_run` table already holds exactly the states the product shows (`queued`, `researching`, `done`, `partial`, `failed`). The worker:
1. Looks for `queued` runs, oldest first, up to the concurrency limit.
2. Claims one in a way that two workers cannot grab the same row (a standard Postgres technique called `SKIP LOCKED`).
3. Writes a heartbeat every ~30 seconds while working.
4. On start-up and every minute, finds runs marked `researching` whose heartbeat is stale and re-queues them (or fails them after repeated attempts).

| Option | Strengths | Weaknesses | Verdict |
|---|---|---|---|
| **Database table + worker (ours)** | No extra service; statuses are the product's own; easy to read in the database | We write ~100–150 lines including recovery; must test crash recovery | **Recommended** |
| pg-boss (library) | Same idea, packaged: retries, expiry, concurrency | Adds its own tables and states that duplicate ours | Reasonable substitute |
| Trigger.dev | Managed durable jobs, no timeouts, good dashboard, free tier ($5 credit, 10 concurrent runs), TypeScript | Extra vendor, extra deploy step, another place for secrets | The upgrade path if the DIY worker proves unreliable |
| Inngest | Managed step functions | Steps run inside serverless functions with time limits (Vercel: 300 s on Hobby, up to 800 s on Pro) that long research calls can hit | Rejected |
| Redis + BullMQ | Industry standard | Adds Redis to run and pay for | Rejected: more infrastructure than the problem needs |
| AWS SQS / Temporal | Enterprise grade | Heavy | Rejected |

### 5.5 E. Hosting and deployment

| Option | Fit | Cost (approx.) | Verdict |
|---|---|---|---|
| **Railway** | Runs web service, always-on worker and Postgres in one project; deploys from GitHub; private network between services | $5 per month plan with usage-based billing; a web + worker + Postgres project realistically about $10–20 per month | **Recommended** |
| Render | Same shape (web, background worker, Postgres) with flat prices | About $7 per web service, $7 per worker, $6+ per database, roughly $20 per month; database backups/PITR only on higher tiers | Equivalent alternative |
| Fly.io | Flexible, more hands-on | Usage-based | More operations work for a beginner |
| Vercel (+ Neon + Trigger.dev) | Excellent for Next.js | Hobby is for **non-commercial** use; a work tool probably counts as commercial, so Pro at about $20 per month; plus two more vendors | Rejected: more vendors and a licence trap |

Deployment shape: one Git repository; Railway builds two services from it (web and worker) with different start commands; the database is a third resource; schema changes run automatically on deploy.

---

## 6. Why this stack (against your five criteria)

| Criterion | How the recommended stack meets it |
|---|---|
| **This product** | Long, multi-step, evidence-bearing research needs a worker, a ledger and strict output. All of that is plain code plus Claude's own web tools. |
| **A beginner developer** | One language (TypeScript) everywhere; two vendors; the "queue" is a table you can read with your own eyes; progress is a log table you can read when something fails. |
| **Low initial usage** | One user, three concurrent runs, polling every few seconds. Nothing here needs scaling machinery. Fixed cost of roughly $10–20 per month plus Anthropic usage. |
| **Deep research quality** | Method lives in `docs/intelligence/` and is applied by our pipeline, not hidden in a vendor's agent. The spike proves it before the app is built. |
| **Future evolution** | Postgres is portable; discovery is pluggable; the worker can be swapped for Trigger.dev; per-stage outputs are stored, so resume-from-stage, history comparison and "what's new" (V2) need no redesign. |

---

## 7. Structured AI output

> **Partly superseded:** structured (JSON schema) output is used for synthesis and email only. The research stages use tagged text, because structured output cannot be combined with the web tools' citations.

Claude's research result becomes **application data**, not a block of text. The synthesis call returns one JSON document of these objects. A schema (Zod) defines and validates it.

> Conceptual shape only, not final field names.

| Object | Key contents |
|---|---|
| **company_profile** | `overview`; `industry` (listed category or Other); `client_type`; `trading_name` with `relationship_confidence` and the source IDs that prove it; confirmed `website` |
| **findings[]** | `key`; `kind` (trigger candidate, development, project/contract, technology/vendor, background); `headline`; `explanation`; **`label`** (FACT, INFERENCE, POSSIBLE_OPPORTUNITY); `date` and `date_precision` (or undated); `confidence` and `confidence_reason`; `relevance_chain` (`fact`, `inference`, `opportunity`) for trigger candidates; `derived_from[]` (finding keys, required for INFERENCE); `evidence[]` (`source_id` + `excerpt`); `context_flag` (none, `from_context`, `conflicts_with_context`) with `conflict_note` |
| **triggers[]** | `finding_key`; `rank` (Strong, Medium, Weak/Hook); `group` (primary, secondary, hook); `why` |
| **people[]** | `name`; `role`; `organisation`; `why_relevant`; `public_activity`; `profile_url`; `evidence[]`; `confidence`. No responsibility is stated that is not evidenced (RR-7) |
| **angles[]** | `key`; `statement`; `kind` (research_backed, context_derived, fallback_general); `finding_keys[]`; `recommended` (at most one); `recommendation_reason`; `what_we_would_learn` |
| **gaps[]** | `kind` (not_found, not_completed, watch_item); `text`. Unconfirmed "worth watching" items live here and nowhere else |
| **verdict** | `top_signal_rank` (Strong, Medium, Weak/Hook, None found); `line` (for example "No strong sales trigger found") |

**How source IDs and evidence connect.**
- **Sources are not in the JSON Claude writes.** They come from the ledger (4.7).
- Each `evidence` entry names a ledger ID and an excerpt. Validation (4.8) checks the ID exists and the excerpt origin.
- Findings link to sources through a join table, so a source can support many findings and a finding can cite many sources (see `DATA_MODEL.md`).

**Rules enforced after the model answers**
1. Every referenced source ID exists in the ledger.
2. Every FACT has at least one evidence excerpt; otherwise it is downgraded or dropped.
3. Every INFERENCE lists at least one `derived_from` FACT.
4. Strong rank requires FACT, dated, within the last 12 months.
5. At most one angle is `recommended`, and the fallback angle is never recommended.
6. The fallback angle exists only if there is no research-backed angle.
7. Context-derived items cannot be FACT.
8. No Teltonika product names appear as recommendations (RR-6).

**Email output** is a smaller object: `subject`, `body`, `mode` (`first_contact` or `re_engagement`), `mode_reason`, `used_finding_keys[]`, `limitation` (`none`, `weak_hook`, `fallback_general`).

**Prompts.** The production prompts are written in the build stage. They are assembled from the intelligence files plus short stage-specific instructions.

---

## 8. Cost model

> **Superseded** by the measured costs at the top (about $1.23 for one real run). The estimates below were made before anything was built.

> **Every number in this section is an estimate. None has been measured.** The spike replaces them.

### 8.1 What drives cost

| Category | Pricing | Share of a run (my estimate) |
|---|---|---|
| **LLM tokens** (reading search results and pages, writing notes, synthesis) | Opus 5.5 $4 in / $20 out per million; Sonnet 5.5 $2 / $10; cache reads cheap | **85–90%** |
| **Web search** | $10 per 1,000 searches ($0.01 each); failed searches are not billed | 5–10% |
| **Web fetch** | No extra charge. You pay tokens for whatever it returns | Inside tokens |
| **Code execution used for filtering** | Free when used with web search/fetch | 0 |
| **Hosting** (web, worker, Postgres) | About $10–20 per month, fixed | Not per run |
| **Database storage** | Negligible at this scale | Not per run |

Why tokens dominate: during a search turn, every search result and every fetched page is added to what Claude reads, and each new step re-reads the growing conversation. Ten searches and a few fetches in one thread easily means hundreds of thousands of input tokens in total. PDFs are the extreme case.

### 8.2 Per-company estimate

> Measured instead of estimated: see the top section.

Assumptions: 35–60 searches; total billed input of 0.6–1.8 million tokens across threads; 40–80 thousand output tokens; synthesis with 60–120 thousand input and 15–30 thousand output; one email afterwards.

| Configuration | Lean case | Heavy case |
|---|---|---|
| Opus 5.5 for everything | about $4 | about $10+ |
| Sonnet 5.5 for search threads, Opus 5.5 for synthesis and email | about $2.50 | about $6 |
| Sonnet 5.5 for everything | about $2 | about $5.50 |
| Research API for discovery (vendor-quoted prices) + Claude synthesis | about $1 | about $2 |

**Answer to your question.** One deep run is most likely in the **$2–$5** band, which sits between your "$2" and "$10+" buckets. It is unlikely to be $0.05 or $0.50. It can reach **$10 or more** for a large company, a PDF-heavy public body, or an uncapped loop, which is why the caps below exist. Uncertainty is about a factor of three either way.

### 8.3 Batch and monthly

| Scenario | Estimate |
|---|---|
| One company | $2–$10, centred around $3–$5 |
| Batch of five | $10–$50, centred around $15–$25 |
| 30 companies a month | roughly $60–$150 plus $10–$20 hosting |
| The spike itself (5 companies, 2–3 configurations) | roughly $40–$100 |

### 8.4 Cost controls built into the design

1. **Per-run cap** (start at about $6 estimated, configurable). After every call, the worker adds up the `usage` returned by the API plus search count × $0.01. Over the cap, it skips remaining threads and finishes as **Partial** with a gap note.
2. **Per-call limits:** `max_uses` for searches and fetches, `max_tokens`, and a time limit.
3. **Per-run time cap** of about 30 minutes.
4. **Prompt caching** for the shared rules text.
5. **Monthly spend limit** set in the Anthropic Console, as a hard backstop against bugs.
6. **Saved-response test mode** so that development does not burn money.
7. **Model tier per stage** as a setting.

Levers if cost is too high: Sonnet for threads; fewer threads or searches; lower effort; the Batch API for non-urgent runs (50% off tokens, results later; not a V1 default); a research API for discovery; our own PDF excerpting.

---

## 9. Failures and partial research

### 9.1 What the five statuses mean technically

| Status | Technical meaning | Who sets it |
|---|---|---|
| **Queued** | A `research_run` row exists, no worker has claimed it | Web app on creation |
| **Researching** | A worker claimed it and is sending heartbeats | Worker |
| **Done** | Company identified, every planned thread finished (an empty result counts as finished), synthesis valid, validation passed | Worker |
| **Partial** | Company identified and synthesis valid, but at least one thread failed, timed out or was skipped by a cap, or the run hit the time/cost cap | Worker |
| **Failed** | No usable result: company unclear, identification failed, every thread failed, synthesis failed after retry, or the run was lost repeatedly | Worker |

Each Failed or Partial run stores a **reason** and detail, shown as the short reason in the Accounts table.

### 9.2 Causes and outcomes

| What goes wrong | Typical result | Handling |
|---|---|---|
| Company name ambiguous or not found | **Failed**, reason "company unclear"; candidates saved | No retry; you add website or context and retry |
| Search tool error or rate limit inside a call (`too_many_requests`, `unavailable`) | The call goes on; Claude works with fewer results | Logged; if a thread ends with nothing useful it counts as not completed → Partial |
| One page inaccessible, blocked by `robots.txt`, or needs JavaScript | Claude tries other sources | Logged; shows up in Research gaps as "not completed" or "not found" |
| PDF too big or unreadable | Thread continues without it | Same as above; large-PDF cost is capped by `max_uses` |
| `max_uses_exceeded` | Thread wraps up with what it has | Normal; not a failure |
| Anthropic API outage, 5xx, connection reset | The SDK retries automatically (twice) | Then one stage-level retry after 30 seconds; then the thread is marked failed |
| Rate limit (429) | SDK honours the wait time | If it persists, lower concurrency and retry once |
| Request timeout | Stage retry once | Then thread failed |
| Model refusal (`stop_reason: refusal`) | Retried once on the fallback model through the API's server-side fallback | If still refused, thread failed |
| Output cut off (`max_tokens`) or malformed structured output | Retried once with a higher token limit | Then synthesis failed → **Failed**, notes kept for a future "retry synthesis only" |
| Synthesis succeeds but validation drops findings | Run continues | Dropped items logged; if more than half the findings are rejected, status **Partial** with a gap note |
| Time cap or cost cap reached | Remaining threads skipped | **Partial** |
| Worker crashes or the container restarts mid-run | Heartbeat goes stale | Re-queued and resumed from the last completed stage (up to 3 attempts), then **Failed** "worker lost" |
| Database unavailable | The worker waits and retries connecting | Run continues once it returns |

### 9.3 Retry behaviour, without overengineering

1. **Automatic** (no user action): SDK retries for transient errors; one stage-level retry; crash recovery up to 3 attempts. Each stage's output is saved as it finishes, so a retry resumes at the failed stage and does not repeat paid work.
2. **Manual**: you press **Retry research**. This creates a **new** run, as the product defines (FR-11). A later optimisation can copy still-valid stage outputs into the new run.
3. **Never automatic**: whole-run reruns, retries of "company unclear", and anything that would silently double the spend.
4. **Idempotent saves**: sources are stored once per (run, URL); a repeated stage replaces its own output rather than duplicating it.

---

## 10. Security and access

> **Authentication is deferred** to the production step; the shared-password design below is one option, not a decision. API keys, `DATABASE_URL` and server-only access remain firm rules.

### 10.1 Keeping strangers out

The simplest reasonable approach for a private single-user tool:

- **One shared password** stored as a hash in an environment variable. A login page checks it and sets a signed, HTTP-only, secure session cookie.
- **Every page and every API route** requires that cookie. There are no public pages other than the login page.
- A long random passphrase (not a dictionary word), a small delay and a lockout after repeated failures, and a "do not index" header.
- The **worker has no public address**. It only reaches the database and Anthropic.
- The **database is not exposed** to the internet; it is reachable only from the app and the worker through the platform's private network.
- HTTPS is provided by the platform.

Stronger option for later: Cloudflare Access in front of the app, with a one-time email code restricted to your address. It needs your own domain and adds a vendor, so it is a "could add later".

### 10.2 API keys

- The Anthropic key lives only in platform environment variables on the web and worker services. It is never in the repository, never sent to the browser, never logged.
- Set a **monthly spend limit** in the Anthropic Console.
- Use a key dedicated to this project so it can be revoked on its own.

### 10.3 Private company context

- Stored only in your database. Not sent anywhere except to Anthropic as part of research and email prompts.
- Anthropic receives it as API input. Check the data-retention terms for your account and be comfortable with that before putting sensitive notes in context.
- **Prompt injection.** Web pages Claude reads can contain text that tries to give it instructions. Controls: all fetched content is treated as untrusted data; the model has no tools that act on the world (read-only search and fetch); Anthropic's fetch tool only allows URLs that already appeared in the conversation and refuses URLs that look like they carry secrets; output goes through schema validation; the only text that reaches you is rendered as plain text. Keep secrets, passwords and customer-confidential details out of the context field.
- Search queries are visible to search infrastructure. The prompt tells Claude to use context to focus, not to paste it into queries.

---

## 11. Observability and testing

- **`run_event` table:** a timestamped line per stage start, finish, retry, error and cap, with token and search counts. It feeds the progress view and is what you read when a run misbehaves.
- **Per-run totals:** tokens, searches and estimated cost stored on the run.
- **Saved-response tests:** save real Claude responses once; later tests replay them for free. Used for ledger-building, validation rules and the UI.
- **Unit tests** for the rules in section 7, since they are plain code and cheap to test.
- **Evaluation set:** the spike's companies become a standing set that every prompt change is re-run against.

---

## 12. Validation spike: do this before building the app

> **Done.** Replaced by the Phase 1 prototype and live runs.

> **Phase note.** Superseded by the Phase 1 prototype and benchmark (see "Implementation phases" at the top). The measurements listed here are still the right things to measure.

The biggest question is not the UI. It is whether this pipeline reaches the quality of your Claude Project at an acceptable price.

**Spike scope (a script, no app, no database):**
- Take 5 companies you have already researched by hand, ideally a mix: a large company, a small integrator, a council or water utility, a mining or energy company, and one with little public information.
- Run configuration A: the pipeline with Claude web tools, Opus 5.5.
- Run configuration B: the same with Sonnet 5.5 for the search threads.
- Optionally run configuration C: one research API for discovery and Claude for synthesis.

**Measure**
- Cost per run (from API `usage` and search counts), and wall-clock time.
- Did it find your known top trigger? Your known people? What did it miss that your manual work found?
- Unsupported claims: how many FACTs fail the evidence check?
- Source mix: primary vs aggregator, any council or tender documents?
- Which sites failed to load?
- Rate-limit errors at concurrency 1, 3, 5.
- Whether the search tools work alongside structured output in one call (a short test).

**Decision it produces:** go as designed; change the model tier; add a second search/reading provider; or swap discovery for a research API.

---

## 13. Risks, ranked

| # | Risk | Why it matters | Mitigation |
|---|---|---|---|
| 1 | **Research quality or coverage falls short of the Claude Project** (niche sources, council PDFs, people) | It is the whole product | The spike; pluggable discovery; second provider as plan B |
| 2 | **Cost per run higher than expected**, especially PDFs and large companies | Five-company batches multiply it | Caps; model tier; spike measurement; monthly limit |
| 3 | **People discovery is weaker than the prototype** because LinkedIn is not accessible | `01` §7 and the People section lean on it | Honest empty states (already in USER_FLOW); policy decision on people-search data; manual contacts |
| 4 | **Rate limits at your Anthropic usage tier** | Parallel threads read a lot of text | Start at concurrency 3; check the tier; the retry logic |
| 5 | **Self-built queue bugs** (stuck runs, duplicate processing) | Trust in "Researching" | Heartbeats, sweeper, tests of crash recovery; fall back to Trigger.dev |
| 6 | **Evidence is only as strong as the API gives us** | Search-only sources provide only short excerpts; `page_age` is coarse | Excerpt origin flags; prefer pages Claude fetched in full |
| 7 | **Sites that Claude cannot read** (JavaScript, `robots.txt`, bot blocking) | Silent gaps | Surface as gaps; plan B reading layer (Firecrawl) |
| 8 | **Prompt injection from web pages** | Hostile text on a page | Section 10.3 |
| 9 | **Backups** | Loss of context, contacts, emails | Accept for V1 or add nightly dump |

---

## 14. Where the architecture makes PRD / USER_FLOW harder

None of these contradicts the locked scope; they are friction to be aware of.

1. **People research (PRD RR-7, `01` §7)** will be thinner than the prototype's if it relied on LinkedIn.
2. **Evidence excerpts are short for search-only sources** (up to 150 characters). Longer quotes exist only where Claude fetched the whole page.
3. **"Date for every finding" (PRD RR-3):** many pages carry only a coarse "page age". Undated findings will be common and are labelled as such, and they cannot be ranked Strong.
4. **Real stage names on the progress view (USER_FLOW 8):** supported, but only the stages we define (identify, discovery threads, follow-up, synthesis). There will be no finer progress than that.
5. **No cancel (USER_FLOW 18).** With runs costing a few dollars, a mistaken batch of five cannot be stopped. Technically a cancel is cheap: a flag checked between stages, plus aborting the in-flight request. It remains out of scope until you decide; this is the cost context you wanted before revisiting it.
6. **Time and cost limits (PRD section 17).** The PRD deferred hard limits to this stage. This proposal adds default caps (section 8.4). They create "Partial" outcomes the PRD already defines, but you should set the numbers.
7. **Live status without reloads (FR-33)** is done by polling every few seconds. That is instant enough for a minutes-long task, but not push.
8. **Context conflict flags (UC-5)** depend on the synthesis model noticing a conflict. It is a prompt-quality matter and will be tested in the spike, not guaranteed by code.
9. **Mixed-relationship email wording (`04` §5)** remains a prompt-quality question, as already recorded.

---

## 15. Decisions that need your input

> **Mostly resolved:** models per stage (Sonnet for research and email, Opus for synthesis), no run caps for now, public-source people research, database host (Supabase). Authentication and backups remain open.

1. **Model tier per stage.** Default is Opus 5.5 everywhere. The spike measures Sonnet 5.5 for the search threads. You decide the quality-vs-cost balance after seeing the results.
2. **Run caps.** Proposed starting values: about $6 estimated spend and 30 minutes per run. Are those right?
3. **Approve the spike** (and a budget of roughly $40–$100 of Anthropic usage) before any app code is written. I strongly recommend it.
4. **People-search policy.** Stay with publicly browsable sources only (my recommendation), or allow paid people-search data later?
5. **Backups.** Accept host defaults and manual exports for V1, or add a nightly dump now?
6. **Accounts and setup you will need to do yourself:** an Anthropic API account with a spend limit (and a look at your usage tier), a Railway account, and a GitHub repository.

---

## 16. Deliberately deferred to V2 (or later in V1 if the spike demands it)

- Research history browsing and "what's new" comparison (data already stored).
- A second search/reading provider; research APIs as the discovery engine.
- Direct AusTender and other structured tender feeds.
- Our own PDF excerpting.
- LLM claim-checker pass.
- Cancel research.
- Resume-from-stage on manual retry.
- Overnight Batch API mode.
- Managed job service (Trigger.dev or similar).
- Cloudflare Access or real user accounts.
- Automated backups.
- Anything in PRD section 16 (V2 direction).

---

## 17. Suggested build order (for the next planning stage)

> **Superseded** by the phases at the top.

> **Phase note.** Superseded by the three implementation phases at the top of this document. Kept for reference when Phases 2 and 3 are planned.

1. **Spike** (section 12). Decide go / adjust.
2. Repository skeleton, database tables, login, deploy to Railway with an empty Accounts screen.
3. Company CRUD, context editing, Add companies, Research setup.
4. Worker, queue, statuses, progress log (with a fake pipeline).
5. The real pipeline, stage by stage, with saved-response tests.
6. Research results screen.
7. Angles, contact selection, email generation.
8. Hardening: caps, crash recovery, error states from USER_FLOW section 15.
