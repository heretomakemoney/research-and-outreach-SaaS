# V1 Data Model (Proposal)

**Product:** Account Research & Outreach Tool (working title)
**Version:** Proposal 0.1 for review
**Date:** 2026-10-03
**Inputs:** `docs/PRD.md`, `docs/USER_FLOW.md`, `docs/ARCHITECTURE.md`, `docs/intelligence/`

This is a conceptual design. It has no SQL, no migrations and no code. Field names and types are indicative; exact names are settled when the tables are created.

> **Phase note.** This PostgreSQL model belongs to the **target architecture (Phase 2 onward)**. **Phase 1 uses no database.** Phase 1 data is saved in the browser's `localStorage` through a storage layer, using records shaped like the objects below (sources, findings, people, angles, gaps, the email), so moving it into these tables later is an import and not a redesign. The database **host is not decided**: Railway PostgreSQL, Supabase and Neon are all options to choose between when Phase 2 starts. The model uses plain PostgreSQL, so any of them works, and it assumes no Supabase-specific features. See "Implementation phases" at the top of `docs/ARCHITECTURE.md`.

> **Plain English.** The database is a set of tables, like spreadsheets that can point at each other. A *company* has many *research runs*. A run has many *findings*, *sources* and *people*. Each finding points at the sources that prove it. Your *context* and your *email* are stored too, but they follow different rules from the research, because research is never changed after it is saved and your context and email can be edited.

---

## 1. Design principles

1. **Plain PostgreSQL.** No vendor-specific features, so the database can move host by changing a connection string.
2. **Research is immutable.** Once a run finishes, its rows are never edited. A new run creates new rows. (PRD principle 10, FR-11.)
3. **Your data is mutable.** Company name, website, context, manual contacts, selections and the email can all change.
4. **Snapshots where history matters.** A run copies the context and topic it used. An email copies the findings it relied on. Later edits cannot change the past.
5. **Status is derived, not duplicated.** A company's status is the status of its latest run. Industry, client type, last-researched date and top signal come from its default run.
6. **Structured columns for what the UI filters and shows; JSON only for odd extras.**
7. **No users table.** V1 is single-user with one shared password. Adding a user owner column later is a straightforward migration.
8. **Not a CRM.** No deals, stages, tasks, activities, notes timeline or sent-email tracking.
9. **IDs are UUIDs; times are stored in UTC** and shown in the user's timezone.

---

## 2. Overview

### 2.1 Entities

| Entity (table) | Represents | Mutable? |
|---|---|---|
| `company` | An account the user is prospecting, plus the user's private context and selections | Yes |
| `manual_contact` | A contact the user typed in (name and role) | Yes |
| `research_run` | One execution of the research pipeline for a company. Doubles as the **queue entry** | Status fields change during the run; frozen when finished |
| `run_stage` | One step of a run (identify, a discovery thread, synthesis…) with its notes and cost | During the run only |
| `run_event` | A timestamped progress/diagnostic line | Append-only |
| `source` | A web page or document touched during a run (the source ledger) | Frozen after the run |
| `source_document` | The stored text of a fetched page (optional, purgeable) | Frozen |
| `finding` | A piece of intelligence: trigger, development, project, technology, background, identity | Frozen |
| `finding_source` | Links a finding to the sources and excerpts that support it | Frozen |
| `finding_derivation` | Links an INFERENCE to the FACTs it is derived from | Frozen |
| `person` | A person discovered by research | Frozen |
| `person_source` | Links a person to supporting sources | Frozen |
| `conversation_angle` | A candidate way to open the conversation | Frozen |
| `angle_finding` | Links an angle to the findings behind it | Frozen |
| `research_gap` | Something not established, not completed, or worth watching | Frozen |
| `outreach_email` | The one current email for a company | Yes |

### 2.2 Relationships

```
company ─┬─< manual_contact
         ├─< research_run ─┬─< run_stage
         │                 ├─< run_event
         │                 ├─< source ──── source_document (0..1)
         │                 ├─< finding ─┬─< finding_source >─ source
         │                 │            └─< finding_derivation (inference → fact)
         │                 ├─< person ──< person_source >─ source
         │                 ├─< conversation_angle ─< angle_finding >─ finding
         │                 └─< research_gap
         ├─ latest_run_id  ──────────► research_run   (drives Status)
         ├─ default_run_id ──────────► research_run   (drives what opens)
         ├─ selected_angle_id ───────► conversation_angle
         ├─ selected_person_id ──────► person
         ├─ selected_manual_contact_id ► manual_contact
         └─ 1 ── outreach_email (at most one per company)
```

`<` means "one to many". Everything under `research_run` belongs to exactly one run, so a whole run can be read, shown or (with the company) deleted as a unit.

---

## 3. Key concepts

### 3.1 Company context vs the run's context snapshot

| | `company.context` | `research_run.context_snapshot` |
|---|---|---|
| What | The user's private free-text knowledge about the account | A copy of that text taken when the run was queued |
| Changes? | Yes, any time (USER_FLOW section 7) | Never |
| Used for | Next research run; email generation | Explaining what an older run was based on; the read-only view on the progress screen |
| If the user edits context later | Updated | Unchanged (UC-9) |

The per-run **topic** lives only on the run (`research_run.topic`). It is never stored on the company (UC-8).

Emails record a `context_hash` of the context at generation time. If the company's current context hashes differently, the UI shows "Context changed since this email was written."

### 3.2 Latest run vs default run vs older runs

| Pointer | Meaning | Set when | Used for |
|---|---|---|---|
| `company.latest_run_id` | The most recently created run | A run is created | Status text in the Accounts table and header; the "newer research running" banner |
| `company.default_run_id` | The research that opens by default | A run finishes (rule below) | Everything shown on the Research tab; Industry, Client type, Last researched and Top signal columns |
| Older runs | Every other run | Never deleted | Not shown in V1 (no history UI); kept for V2 |

Rule for `default_run_id` (PRD FR-11), applied in the same transaction that sets a run's final status:
- A run finishing **Done** always becomes the default.
- A run finishing **Partial** becomes the default **only if the company has no Done run**.
- A run finishing **Failed** never becomes the default.

When `default_run_id` changes, `selected_angle_id` is cleared (the new run's angles may differ). The selected contact stays (USER_FLOW section 14).

This is also how the data model keeps the PRD's FR-34 resolution: the Accounts table reads Industry, Client type, Last researched and Top signal from the **default run**, so the table always matches what opens.

### 3.3 One current outreach email per company

`outreach_email.company_id` is **unique**. Generating or regenerating **replaces** the row's content. There is no draft list and no email history in V1. The row is self-contained (it snapshots what it relied on), so it stays valid and verifiable after newer research becomes the default.

---

## 4. Table definitions

Types in brackets are indicative: *uuid*, *text*, *bool*, *int*, *date*, *timestamp*, *jsonb*, *enum*.

### 4.1 `company`

**Represents** a prospect account. **Persistent**, mutable, one row per company.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `name` | text | As entered; editable via Edit details. The trading name found by research lives on the run, not here |
| `website` | text, nullable | Editable |
| `context` | text, default empty | Free text; the single context field (UC-1) |
| `context_updated_at` | timestamp | |
| `latest_run_id` | uuid, nullable | Points to `research_run`. Null means **Not researched** |
| `default_run_id` | uuid, nullable | Points to `research_run` |
| `selected_angle_id` | uuid, nullable | Points to `conversation_angle` (one angle at most) |
| `selected_person_id` | uuid, nullable | Points to `person` |
| `selected_manual_contact_id` | uuid, nullable | Points to `manual_contact`. At most one of person / manual contact is set |
| `last_activity_at` | timestamp | Bumped on creation and on every run status change; drives the default Accounts ordering |
| `created_at`, `updated_at` | timestamp | |

**Derived, not stored:** the Accounts-table row (name, status from the latest run, Industry, Client type, Last researched and Top signal from the default run).

**Deletion:** deleting a company removes everything beneath it (runs, stages, events, sources, findings, people, angles, gaps, contacts, email). The app refuses to delete while the latest run is Queued or Researching.

### 4.2 `manual_contact`

**Represents** a contact the user added. **Persistent**, mutable.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `company_id` | uuid | Owner |
| `name` | text | Required |
| `role` | text | Required |
| `created_at` | timestamp | |

No notes field (USER_FLOW section 12). Relationship information belongs in `company.context`.

### 4.3 `research_run`

**Represents** one research execution. This row **is** the queue entry: its `status` is what the worker looks at. Inputs are **snapshots**; results are **frozen** once finished.

| Group | Field | Type | Notes |
|---|---|---|---|
| Identity | `id`, `company_id` | uuid | |
| Status | `status` | enum | `queued`, `researching`, `done`, `partial`, `failed` |
| | `status_reason` | enum, nullable | See section 5 |
| | `status_detail` | jsonb, nullable | For example the candidate companies when the company is unclear |
| Inputs (snapshot) | `company_name_snapshot`, `website_snapshot` | text | As they were at queue time |
| | `context_snapshot` | text | Copy of `company.context` |
| | `topic` | text, nullable | Per-run only |
| Timing | `queued_at`, `started_at`, `finished_at` | timestamp | |
| | `heartbeat_at` | timestamp, nullable | Updated by the worker; stale means the worker died |
| | `attempt_count` | int | Crash-recovery counter |
| | `current_stage` | text, nullable | Drives the progress text |
| Reproducibility | `intelligence_version` | text | Hash of `docs/intelligence/` used (PRD section 13) |
| | `config_snapshot` | jsonb | Model per stage, caps, tool versions |
| Cost | `usage` | jsonb | Tokens by model, search count, fetch count |
| | `estimated_cost_usd` | decimal | |
| Result summary (set when finished) | `overview` | text | What the company does |
| | `industry` | enum | The `01` §1 categories or `other` |
| | `industry_other_label` | text, nullable | When `other` |
| | `client_type` | enum | `distributor`, `integrator`, `end_user`, `unknown` |
| | `trading_name` | text, nullable | |
| | `trading_name_confidence` | enum | `high`, `medium`, `low`, `unconfirmed` |
| | `verdict_line` | text | For example "No strong sales trigger found" |
| | `top_signal_rank` | enum | `strong`, `medium`, `weak_hook`, `none` |
| Audit | `synthesis_json` | jsonb | The validated structured output, kept for audit and debugging |

**Relationships:** belongs to one company; has many stages, events, sources, findings, people, angles and gaps.
**Persistent / changes:** status and progress fields change until the run finishes. After that, the row never changes.
**Never deleted** except when its company is deleted.

**Indexes needed for the worker:** by (`status`, `queued_at`) to find the next queued run; by (`company_id`, `queued_at`) to find a company's runs.

### 4.4 `run_stage`

**Represents** one pipeline step within a run. Stores the paid work so a retry can resume.

| Field | Type | Notes |
|---|---|---|
| `id`, `run_id` | uuid | |
| `stage_key` | text | `identify`, `discovery_news`, `discovery_government`, `discovery_technology`, `discovery_people`, `discovery_topic`, `lead_parse`, `followup_1`…, `synthesis`, `validate`. Unique per run |
| `status` | enum | `pending`, `running`, `done`, `failed`, `skipped` |
| `attempt` | int | |
| `started_at`, `finished_at` | timestamp | |
| `output_text` | text, nullable | The research notes from a search thread |
| `output_json` | jsonb, nullable | Parsed leads, or synthesis output |
| `usage` | jsonb | Tokens, searches, fetches, model |
| `error` | text, nullable | |

A stage whose `status` is `failed` or `skipped` is what produces a **not completed** research gap and a Partial result.

### 4.5 `run_event`

**Represents** a progress or diagnostic line. **Append-only.**

| Field | Type | Notes |
|---|---|---|
| `id`, `run_id` | uuid | |
| `at` | timestamp | |
| `stage_key` | text, nullable | |
| `level` | enum | `info`, `warn`, `error` |
| `message` | text | For example "Searching recent projects", "Fetch failed: robots.txt" |
| `data` | jsonb, nullable | Counts, error codes |

Feeds the progress view (real stage names only, USER_FLOW section 8) and is the main debugging tool.

### 4.6 `source`

**Represents** one web page or document the run touched (a row of the **source ledger**). **Frozen** after the run.

| Field | Type | Notes |
|---|---|---|
| `id`, `run_id` | uuid | |
| `ledger_key` | text | `S1`, `S2`… unique within the run |
| `url`, `canonical_url` | text | De-duplication is on `canonical_url` within a run |
| `title` | text, nullable | |
| `publisher` | text | Domain |
| `source_type` | enum | `company_site`, `newsroom`, `government`, `tender_or_contract`, `council_document`, `industry_press`, `partner_or_customer`, `job_ad`, `profile_or_social`, `aggregator`, `other` |
| `is_aggregator` | bool | Drives the *Aggregator source* flag |
| `published_at` | date, nullable | Publication date if known |
| `page_age_text` | text, nullable | The coarse "page age" from the search result |
| `retrieved_at` | timestamp, nullable | |
| `was_fetched` | bool | True if the page was read in full, not only seen in search results |
| `content_kind` | enum | `html`, `pdf`, `text`, `none` |
| `access_status` | enum | `ok`, `failed` |
| `access_error` | text, nullable | For example `url_not_accessible`, `robots_blocked` |
| `content_hash` | text, nullable | |

Failed fetches are stored too, because "could not read X" is useful when explaining a gap.

### 4.7 `source_document` (optional in V1)

**Represents** the stored text of a fetched page, so excerpts can be verified later.

| Field | Type | Notes |
|---|---|---|
| `source_id` | uuid | Primary key and link to `source` |
| `text` | text (compressed) | Page text |
| `char_count` | int | |
| `truncated` | bool | |

Separate from `source` so the main tables stay small and this table can be purged. PDFs: V1 does **not** store PDF bytes; the source row, the URL and the model's cited excerpts are kept.

### 4.8 `finding`

**Represents** a unit of intelligence. **Frozen.** One record type covers triggers, developments, technology, projects and background (USER_FLOW section 10: "one finding, different groupings").

| Field | Type | Notes |
|---|---|---|
| `id`, `run_id` | uuid | |
| `key` | text | `F1`, `F2`… unique within the run; used by angles and derivations |
| `kind` | enum | `identity`, `development`, `project_contract`, `technology_vendor`, `background` |
| `headline` | text | One line shown in the compact row |
| `explanation` | text | Expanded view |
| `label` | enum | **`FACT`, `INFERENCE`, `POSSIBLE_OPPORTUNITY`** (RR-2). Never null |
| `occurred_on` | date, nullable | |
| `date_precision` | enum | `day`, `month`, `year`, `unknown` |
| `confidence` | enum | `high`, `medium`, `low` |
| `confidence_reason` | text | |
| `relevance_chain` | jsonb, nullable | `{fact, inference, opportunity}` text, for trigger candidates (`02` §4) |
| `trigger_rank` | enum, nullable | `strong`, `medium`, `weak_hook`. Non-null means it appears under **Triggers & hooks** |
| `trigger_group` | enum, nullable | `primary`, `secondary`, `hook` (`03` §6) |
| `trigger_why` | text, nullable | Short reason for the rank |
| `context_flag` | enum | `none`, `from_context`, `conflicts_with_context` |
| `conflict_note` | text, nullable | "Your context says … / Public sources say …" |
| `attributes` | jsonb, nullable | Kind-specific extras (vendor, product, customer, partner, stage, value) |
| `sort_order` | int | |

**Where it shows:** if `trigger_rank` is set → Triggers & hooks. Else by `kind`: Other developments & projects (`development`, `project_contract`), Technology & vendors, Background. `identity` backs the Summary's trading-name evidence.
**Compact-row flags** are derived: *Low confidence* from `confidence`; *Aggregator source* if every supporting source is an aggregator; *From your context* / *Conflicts with your context* from `context_flag`.

### 4.9 `finding_source`

**Represents** "this source supports this finding, and here is the excerpt." Many-to-many.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `finding_id`, `source_id` | uuid | A pair can have several excerpts |
| `excerpt` | text | The evidence text |
| `excerpt_origin` | enum | `api_citation` (returned by the API from the real page), `quote_verified` (quote found in the fetched text), `quote_unverified` (could not be checked; shown flagged) |

Rule: every `FACT` finding has at least one row here. `INFERENCE` findings may have none but must have a derivation. User-context findings have none.

### 4.10 `finding_derivation`

**Represents** "this INFERENCE comes from that FACT."

| Field | Type |
|---|---|
| `finding_id` | uuid (the inference) |
| `derived_from_finding_id` | uuid (the fact) |

Powers the FACT → INFERENCE → POSSIBLE OPPORTUNITY chain in the expanded row.

### 4.11 `person`

**Represents** a person discovered by research. **Frozen.**

| Field | Type | Notes |
|---|---|---|
| `id`, `run_id` | uuid | |
| `name`, `role`, `organisation` | text | |
| `why_relevant` | text | One line in the row |
| `public_activity` | text, nullable | The post, project or document that connects them |
| `profile_url` | text, nullable | |
| `confidence` | enum | |
| `sort_order` | int | |

### 4.12 `person_source`

Same shape as `finding_source`: `person_id`, `source_id`, `excerpt`, `excerpt_origin`.

### 4.13 `conversation_angle`

**Represents** a candidate way to start the conversation. **Frozen.**

| Field | Type | Notes |
|---|---|---|
| `id`, `run_id` | uuid | |
| `key` | text | `A1`, `A2`… |
| `statement` | text | For example "Ask how connectivity is being handled across the new telemetry sites" |
| `kind` | enum | `research_backed`, `context_derived`, `fallback_general` |
| `label` | enum, nullable | `POSSIBLE_OPPORTUNITY` for research-backed and context-derived; **null for the fallback** (it asserts nothing) |
| `is_recommended` | bool | At most one per run; never the fallback |
| `recommendation_reason` | text, nullable | |
| `what_we_would_learn` | text | The question the email would aim to answer |
| `sort_order` | int | |

Rule: a `fallback_general` angle exists only when the run has no `research_backed` angle (USER_FLOW section 11).

### 4.14 `angle_finding`

Links an angle to the findings behind it: `angle_id`, `finding_id`, `is_primary` (bool). The fallback angle has no rows.

### 4.15 `research_gap`

**Represents** something not established. **Frozen.**

| Field | Type | Notes |
|---|---|---|
| `id`, `run_id` | uuid | |
| `kind` | enum | `not_found` (searched, nothing), `not_completed` (a stage failed or was capped), `watch_item` (worth watching, unconfirmed, never a trigger) |
| `text` | text | |
| `stage_key` | text, nullable | Which stage it relates to |
| `sort_order` | int | |

This table is the only home for speculative or unconfirmed items (`01` §10).

### 4.16 `outreach_email`

**Represents** the company's one current email. **Persistent**, mutable, **at most one per company**.

| Group | Field | Type | Notes |
|---|---|---|---|
| Identity | `id` | uuid | |
| | `company_id` | uuid, **unique** | |
| Based on | `run_id` | uuid | The research run it was generated from |
| | `angle_id` | uuid, nullable | Kept for reference |
| | `angle_statement` | text | **Snapshot** of the angle |
| | `angle_kind` | enum | `research_backed`, `context_derived`, `fallback_general` |
| Recipient | `contact_name`, `contact_role` | text | **Snapshot** |
| | `contact_origin` | enum | `researched`, `manual` |
| | `contact_person_id`, `contact_manual_id` | uuid, nullable | At most one |
| How it was written | `mode` | enum | `first_contact`, `re_engagement` |
| | `mode_reason` | text | Shown to the user (OR-11) |
| | `limitation` | enum | `none`, `weak_hook`, `fallback_general` |
| Content | `subject`, `body` | text | The current, user-editable text |
| | `generated_subject`, `generated_body` | text | As generated; used to detect edits before **Regenerate** warns |
| Evidence | `based_on` | jsonb | **Snapshot** of the findings relied on: headline, label, date, and sources with excerpts |
| | `context_hash` | text | Hash of `company.context` when generated |
| Audit | `model`, `usage` | text, jsonb | |
| | `generated_at`, `edited_at`, `updated_at` | timestamp | |

**Why snapshots:** when newer research becomes the default, the email stays valid. It still says which research it came from, and the "Based on" list still shows what it relied on (USER_FLOW sections 13 and 14).
**Regenerate** overwrites the content fields of the same row.

---

## 5. Enumerations

| Name | Values |
|---|---|
| `run_status` | queued, researching, done, partial, failed |
| `status_reason` | company_unclear, no_usable_results, api_unavailable, rate_limited, timeout, budget_cap, time_cap, synthesis_invalid, worker_lost, refusal, thread_failed, validation_dropped_majority |
| `industry` | industrial_automation, mining, energy_utilities, retail, enterprise, smart_city, transportation, telco_msp, other |
| `client_type` | distributor, integrator, end_user, unknown |
| `finding_label` | FACT, INFERENCE, POSSIBLE_OPPORTUNITY |
| `finding_kind` | identity, development, project_contract, technology_vendor, background |
| `trigger_rank` | strong, medium, weak_hook |
| `trigger_group` | primary, secondary, hook |
| `top_signal_rank` | strong, medium, weak_hook, none |
| `confidence` | high, medium, low |
| `context_flag` | none, from_context, conflicts_with_context |
| `excerpt_origin` | api_citation, quote_verified, quote_unverified |
| `angle_kind` | research_backed, context_derived, fallback_general |
| `gap_kind` | not_found, not_completed, watch_item |
| `email_mode` | first_contact, re_engagement |
| `email_limitation` | none, weak_hook, fallback_general |

---

## 6. State transitions for a run

```
 (created by web app)            (claimed by worker)            (final, set by worker)
      queued  ───────────────►  researching  ──────────────►  done
         ▲                           │   │                     partial
         │      stale heartbeat      │   └────────────────►    failed
         └───────────────────────────┘
        (attempt_count + 1, up to 3, then failed: worker_lost)
```

- `done` and `partial` and `failed` are final. A retry is a **new** run.
- The final status, `finished_at`, the result-summary fields and (where applicable) the company's `default_run_id` are written together in one transaction.
- `company.latest_run_id` is set when the run is created. It always points at the newest run, whatever its state.

**Company status shown to the user** is: `Not researched` if `latest_run_id` is null; otherwise the status of the latest run, as the product defines.

---

## 7. How the structured AI output maps to tables

| AI output object (`ARCHITECTURE.md` section 7) | Stored in |
|---|---|
| Source ledger (built by code, not by Claude) | `source`, optionally `source_document` |
| `company_profile` | `research_run` summary fields; the trading-name evidence as an `identity` `finding` with `finding_source` rows |
| `findings[]` | `finding`, `finding_source`, `finding_derivation` |
| `triggers[]` | `trigger_rank`, `trigger_group`, `trigger_why` on the matching `finding` |
| `people[]` | `person`, `person_source` |
| `angles[]` | `conversation_angle`, `angle_finding` |
| `gaps[]` | `research_gap` |
| `verdict` | `research_run.verdict_line`, `research_run.top_signal_rank` |
| Raw notes from search threads | `run_stage.output_text` |
| The validated synthesis JSON | `research_run.synthesis_json` |
| Email output | `outreach_email` |

**How a finding reaches its evidence:** `finding` → `finding_source` (excerpt and origin) → `source` (URL, title, date, type, whether it was fetched in full) → optionally `source_document` (page text). The UI's "View evidence" panel is this chain.

---

## 8. Integrity rules

Enforced partly by the database (foreign keys, uniqueness) and partly by the pipeline's validation step (ARCHITECTURE section 7):

1. `outreach_email.company_id` is unique.
2. `research_run.status` and `company.latest_run_id` change only through the app and worker code paths.
3. A company has at most one of `selected_person_id` and `selected_manual_contact_id` set.
4. A run has at most one recommended angle; the fallback angle is never recommended and exists only if no research-backed angle exists.
5. Every `FACT` finding has at least one `finding_source`.
6. Every `INFERENCE` finding has at least one `finding_derivation`.
7. `Strong` rank only for `FACT` findings dated within the last 12 months.
8. Findings with `context_flag = from_context` are never `FACT`.
9. `source.ledger_key`, `finding.key` and `conversation_angle.key` are unique within a run.
10. Deleting a company deletes everything beneath it; deleting is refused while its latest run is Queued or Researching.
11. Rows beneath a finished run are never updated.

---

## 9. Example

Illustrative only. A water utility, researched twice.

| Table | Rows |
|---|---|
| `company` | "Northern Water Authority"; context "Buys RUT241s via a distributor"; `latest_run_id` = run 2 (Researching); `default_run_id` = run 1; selected angle cleared; selected manual contact "Dan, Network Lead" |
| `research_run` run 1 | Done, 3 Aug; context snapshot as then; top signal Strong; `industry` energy_utilities, `client_type` end_user |
| `research_run` run 2 | Researching, started 8 minutes ago; context snapshot now includes a new note; topic "SCADA upgrade" |
| Run 1 `finding` F3 | "Council approved telemetry upgrade for 12 pump stations" — FACT, Aug 2026, Strong, primary trigger |
| Run 1 `finding_source` | F3 → S4 (council agenda PDF), excerpt returned by the API |
| Run 1 `finding` F4 | "Likely to need remote connectivity at the pump stations" — INFERENCE, derived from F3 |
| Run 1 `conversation_angle` A1 | "Ask how connectivity is being handled across the 12 pump stations", research-backed, recommended, linked to F3 |
| `outreach_email` | Based on run 1, angle A1 snapshot, contact "Dan, Network Lead (manual)", mode re_engagement ("context mentions existing Teltonika usage via a distributor"), limitation none, `based_on` snapshot of F3 and its source |

What the Accounts table shows for this company: Status **Researching** (run 2, "Earlier research available"); Industry, Client type, Last researched and Top signal from run 1. When run 2 finishes Done, `default_run_id` moves to run 2, the selected angle clears, the email stays tagged "Based on earlier research".

---

## 10. Deliberately not modelled in V1

- Users, teams, roles, organisations.
- Deals, pipeline stages, tasks, reminders, activity feeds, notes timelines.
- Email send history, outreach history, multiple emails or drafts per company (V2).
- Research-history comparison tables or "what's new" diffs (V2). Everything needed is already stored as separate runs.
- Contact notes, tags, labels, custom fields.
- Stored PDF files.
- Cost budgets per company or per month (the Anthropic Console limit does this).

---

## 11. Size and housekeeping

- A finished run is likely to have 30–80 sources, 15–40 findings, 3–10 people, 3–8 angles and a few gaps, plus the notes. That is small.
- The heavy part is `source_document` text (megabytes per run). If it is stored, compress it and allow it to be purged for old runs without touching findings.
- Frequent reads: the Accounts table (one row per company plus two run lookups) and the company page (one run's rows). Indexes on the foreign keys and on (`status`, `queued_at`) are enough.

---

## 12. Open data-model questions

1. **Store fetched page text (`source_document`)?** It enables verifying quotes and showing longer evidence, and costs storage. Recommendation: store it in the first build and purge later if size matters.
2. **Keep a full copy of the intelligence files per run, or only a hash?** Recommendation: the hash, with the git history as the record.
3. **Add a nightly backup of the small human-authored tables** (company, context, manual contacts, email)? Tied to the backup decision in `ARCHITECTURE.md` section 15.
