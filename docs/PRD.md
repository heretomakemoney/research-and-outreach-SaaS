# Product Requirements Document (PRD)

**Product:** Account Research & Outreach Tool (working title)
**Version:** V1 draft 0.2
**Date:** 2026-10-03
**Status:** Draft for review. No technology or architecture decisions are made in this document.

## Source-of-truth rule

The detailed behaviour of the research, relevance, trigger, outreach and learning logic is defined in `docs/intelligence/`:

| File | Defines |
|---|---|
| `01_RESEARCH_RULES.md` | How to research an account, source priorities, required research output |
| `02_TELTONIKA_RELEVANCE.md` | What counts as Teltonika-relevant, and what does not |
| `03_SALES_TRIGGERS.md` | Trigger types, priority, evaluation and ranking |
| `04_OUTREACH_RULES.md` | Email methodology and Irmantas' voice |
| `05_OUTREACH_EXAMPLES.md` | Real writing examples (style references) |
| `06_LEARNING_RULES.md` | How feedback becomes reusable rules |

This PRD defines **what product we are building**. It does not restate those rules. Where AI or research behaviour is concerned, the intelligence files win. Where product scope is concerned, this PRD wins.

## Terminology

- **Outreach email:** a personalised email written to a contact at a target company. It is one of two modes:
  - **First contact:** no known relationship with the company or contact.
  - **Re-engagement / expansion:** a relationship already exists (customer, past conversation, past evaluation, existing Teltonika usage, distributor relationship), so the email builds on it instead of introducing Teltonika from scratch.
- **Company context:** lightweight private account knowledge the user keeps on a company (section 11).
- **Angle:** one conversation angle derived from research, e.g. "how is connectivity being handled across the new sites".

---

## 1. Product Overview

A web-based internal tool that turns a target company into structured, evidence-backed account intelligence, then helps the salesperson write a personalised outreach email based on the angle they choose.

```
TARGET ACCOUNT → DEEP RESEARCH → ACCOUNT INTELLIGENCE → SALES TRIGGERS
→ RELEVANT PEOPLE → CONVERSATION ANGLES → PERSONALISED OUTREACH
```

Research is the product. Email generation is downstream of it. The salesperson keeps the final sales judgement.

## 2. Problem Statement

The salesperson already knows which companies they want to prospect. Properly researching one company before outreach takes 20–60 minutes: finding recent projects, technologies, relevant people and a credible reason to make contact. That manual effort limits how many accounts can be approached well, and rushed research leads to generic outreach.

Existing "AI cold email" tools solve the wrong problem. They generate text without deep, verifiable account research, and they tend to invent relevance.

## 3. Target User

**V1: one user, the product owner (Irmantas, Teltonika Networks Australia).** The tool is an internal tool he uses personally.

- B2B sales / business development
- Commercially minded; not necessarily deeply technical in software
- Prospects named accounts, not mass lists
- Often has private knowledge of an account (existing relationship, past conversations, distributor, competitors) that public research cannot find
- Writes in a specific personal style (see `04_OUTREACH_RULES.md`)

A broader commercial audience is explicitly not a V1 target (see Principles).

## 4. Value Proposition

- **Time:** compress 20–60 minutes of manual research into a reviewable research output.
- **Depth:** multiple findings, people, technologies and angles, not one generic hook.
- **Trust:** every finding carries a source and date, and is labelled as fact or inference.
- **Honesty:** if there is no strong trigger, the tool says so rather than inventing one.
- **Context-aware:** private account knowledge and public research are combined, so the outreach fits the real relationship.
- **Voice:** emails read like Irmantas wrote them, led by research rather than sales copy.

## 5. Product Principles

1. **Research is the core value.** Email generation is downstream of it.
2. **Not a CRM.** No pipeline, deal stages, activity tracking or contact management. Company context is lightweight account knowledge, not a notes system.
3. **Do not manufacture opportunities.** Weak evidence is shown as weak, or not shown.
4. **Evidence and source transparency.** Findings are traceable to sources and dated.
5. **Private knowledge and public research complement each other.** Company context is combined with external findings.
6. **The salesperson decides** which opportunity, angle and contact to pursue. The tool recommends, never decides.
7. **Keep V1 technically manageable.**
8. **Internal tool first.** Build for one real user before generalising for a market.
9. **Teltonika-specific in V1.** Do not generalise the intelligence layer for other sales organisations yet.
10. **Never overwrite history.** Previous research runs are kept, even where V1 does not display them.

## 6. V1 Goals

1. Let the user add a company and run deep research on it with minimal input.
2. Produce structured account intelligence that follows the required output in `01_RESEARCH_RULES.md` (section 12).
3. Let the user keep lightweight company context that is reviewed before each research run and reused across runs.
4. Present several triggers and conversation angles and let the user choose one.
5. Generate an editable outreach email in the user's voice from the chosen angle, adapted to whether a relationship already exists.
6. Keep companies, context, research and emails saved so nothing is lost on refresh.
7. Be useful enough on real companies that the user prefers it to manual research.

## 7. V1 Non-Goals

Not in V1:

- Automated email sending
- Gmail or Outlook integration
- CRM integration
- LinkedIn automation
- Lusha (or any contact-data provider) integration
- Automated LinkedIn scraping
- Email sequences or follow-ups
- Automated recurring account monitoring
- Notifications
- "Who should I contact today?" recommendations
- Billing or subscriptions
- Complex user or team management, or complex authentication
- Complex analytics
- Generalising the intelligence for other vendors or sales teams
- Any CRM-like feature (pipelines, stages, tasks, activity logs, a notes system)
- A research-history UI (previous runs are stored, not browsable)
- Combining multiple angles in one email
- Email tuning controls (make shorter, change tone, friendlier, more direct)
- An in-product learning or feedback system
- Hard research time or cost limits (to be evaluated during architecture)

## 8. Core User Journey

1. **Add a company.** The user enters a company name (and optionally a website).
2. **Review company context.** When starting research, the company's saved context is shown. The user reviews it, edits it if needed, and can add an optional topic to focus on. Any edits are saved to the company.
3. **Run research.** The system runs deep external research, combining it with the company context.
4. **Review results.** The user reads structured account intelligence: overview, people, developments, triggers, angles, gaps and sources.
5. **Choose one angle and a contact.** The user selects one primary conversation angle, and a contact: either a person found in research, or one they add manually (name and role).
6. **Generate the outreach email.** The system writes a first-contact or re-engagement/expansion email, depending on the relationship in the company context.
7. **Edit, regenerate and copy.** The user edits the draft, regenerates it if needed, and copies it out.
8. **Return later.** Companies, context, research and emails are still there after a refresh. The latest research is shown by default.

## 9. Functional Requirements

### 9.1 Company management
- **FR-1** Add a company by name; optional website.
- **FR-2** View a list of saved companies, with research status.
- **FR-3** Open a company to see its context, latest research and emails.
- **FR-4** Delete a company and its related data (including stored previous runs).

### 9.2 Company context
- **FR-5** Each company has an editable company context (section 11), saved with the company.
- **FR-6** Company context can be edited at any time, not only when research starts.

### 9.3 Research
- **FR-7** Starting research shows the current company context, pre-filled and editable, plus an optional per-run topic field. Edits are saved to the company before research begins.
- **FR-8** Show research progress, since research may take several minutes. The user can leave and return.
- **FR-9** Produce structured results as described in section 10.
- **FR-10** Show sources for every finding, with dates.
- **FR-11** Re-running research creates a new run. Previous runs are kept and never overwritten or deleted. The latest run is shown by default.

### 9.4 Review and selection
- **FR-12** Show all credible triggers, ranked and labelled by type (sales trigger vs conversation hook) per `03_SALES_TRIGGERS.md`.
- **FR-13** Show several conversation angles, each linked to the findings behind it.
- **FR-14** Show a recommended angle, clearly marked as a recommendation.
- **FR-15** The user selects exactly **one** primary angle for an email. Combining angles is not supported in V1.
- **FR-16** The user selects a contact either from the people found in research, or by adding one manually with at least a name and a role/title. Manual entry is always available, including when research finds no people.

### 9.5 Outreach
- **FR-17** Generate an outreach email (section 12).
- **FR-18** The generated email is editable in the app, and edits are saved.
- **FR-19** The user can regenerate the email.
- **FR-20** One-click copy of the email.

### 9.6 Persistence
- **FR-21** Companies, company context, research runs, sources, selections and emails survive page refresh and return visits.

## 10. Research / Intelligence Requirements

Detailed behaviour lives in `01`–`03`. At product level, a research result must contain:

| Section | Reference |
|---|---|
| Company overview, including trading-name check where relevant | `01` §0, §12 |
| Classification (industry and client type; industries outside the listed categories are shown as **Other**) | `01` §1 |
| Relevant people, with role, why relevant and profile source | `01` §7 |
| Multiple recent developments (date, evidence, source, relevance, confidence) | `01` §2, §3, §12 |
| Relevant projects, contracts and tenders | `01` §3, §6 |
| Technologies, vendors and existing solutions | `01` §12 |
| Historical account intelligence, separated from current triggers | `01` §8 |
| Potential sales triggers, ranked Strong / Medium / Weak | `01` §9, `03` §6 |
| Conversation hooks where no stronger trigger exists | `03` §1, §4, §9 |
| Multiple conversation angles | `01` §12, `03` §7 |
| Recommended strongest angle (advisory only) | `01` §12 |
| Research gaps and uncertainty | `01` §10, §12 |
| Sources | `01` §10 |

Product-level requirements that apply across all of them:

- **RR-1 Evidence over brevity.** Quality and evidence matter more than a short answer. Fewer strong findings beat many weak ones (`01` §2).
- **RR-2 Labelling.** Every finding is labelled as **FACT**, **INFERENCE** or **POSSIBLE OPPORTUNITY**, and the labels stay visible in the UI (`02` §4).
- **RR-3 Sources.** Every finding links to a source with a date. Aggregator sources are flagged (`01` §10).
- **RR-4 No speculation.** Likely-but-unconfirmed developments appear only under Research Gaps (`01` §10).
- **RR-5 No manufactured relevance.** "No meaningful Teltonika angle found" is an acceptable and visible outcome (`02` §6).
- **RR-6 No product selection.** Research does not recommend specific Teltonika products (`01` §11).
- **RR-7 People.** Only publicly discoverable people connected to the project, technology or application, not a list of senior executives (`01` §7). No responsibilities are inferred from a title alone.
- **RR-8 Judgement stays with the user.** The recommended angle is one option among several (`01` §12).

## 11. User Context Requirements

Company context is lightweight private account knowledge that public research cannot discover. It belongs to the **company**, is **editable**, and is **reused in every future research run and email** for that company.

Typical content: existing relationship, products already used, distributor relationship, competitors, previous conversations, previous evaluations, known projects, relevant internal notes.

- **UC-1** Context is a single free-text field per company. It is not a structured notes system, a log or a timeline.
- **UC-2** When research starts, the current company context is shown, pre-filled and editable, so the user can review or update it first (FR-7). No extra confirmation step is required beyond starting the run.
- **UC-3** Research combines the context with external findings, so what is surfaced reflects both. Example: if the company already buys through a distributor and a new remote-monitoring project is found, the angle is *expanding into that project*, not *introducing Teltonika as a new vendor*.
- **UC-4** Context is shown to the user as **user-supplied**. It is never presented as externally verified fact or given a public source.
- **UC-5** If context contradicts public findings, show both and flag the conflict. Do not silently pick one.
- **UC-6** Context determines the outreach mode (section 12) and is used in email generation.
- **UC-7** Each research run stores a copy of the context as it was when the run started, so older runs remain understandable.
- **UC-8** A per-run **topic** (what the user wants researched this time) is separate from company context. It applies to that run only.
- **UC-9** Context is editable at any time (FR-6). Editing it does not change past runs or emails.

## 12. Outreach Requirements

Method and voice are defined in `04_OUTREACH_RULES.md` and `05_OUTREACH_EXAMPLES.md`.

- **OR-1** An email is generated only after the user selects **one** primary angle and a contact. It uses the research findings, that angle, the contact, and the company context.
- **OR-2** The aim is to **start or continue a relevant business conversation**, not to sell a product (`04` Purpose).
- **OR-3** The email follows the voice and style rules in `04` and `05`. Examples are style references and are not to be copied.
- **OR-4** The email is grounded in the findings and the company context. It must not state anything neither supports (no invented projects, vendors, relationships or requirements).
- **OR-5** Output includes a subject line and body. It is plain text, editable in the app and easy to copy.
- **OR-6** The user can see which finding(s) the email relies on, so they can verify before sending.
- **OR-7** V1 does not send email. The user copies it into their own email client.
- **OR-8** Editing, regenerating and copying are the only email controls in V1. There are no dedicated tone or length controls.

### Outreach mode

- **OR-9** The mode adapts to the company context:
  - No relationship indicated → **first contact**. Do not pretend familiarity (`04` §5).
  - Context indicates an existing customer, previous relationship, previous conversation, previous evaluation or existing Teltonika usage → **re-engagement / expansion**. Do not force first-contact language; apply the existing-contact principles in `04` §5 and the style patterns in `05`.
- **OR-10** Personal familiarity ("How are you?", "As discussed…") must only be used where the context supports a relationship with that contact or conversation. If the context shows a relationship with the company but not with this person, acknowledge the company relationship without implying a personal history.
- **OR-11** The UI shows which mode was used and why (e.g. "Written as re-engagement: company context mentions existing Teltonika usage via a distributor"), so the user can correct the context and regenerate.

### Weak triggers

- **OR-12** If only a weak trigger or conversation hook exists, the email is still generated. There is **no additional confirmation step**.
- **OR-13** The email screen clearly states that **no strong Teltonika-relevant sales trigger was found**, and that the email relies on a conversation hook.
- **OR-14** The email must not pretend Teltonika relevance that the research does not support (`03` §4, §9; `02` §6).

## 13. Data That Needs To Be Stored

Conceptual only. No schema or storage technology is chosen here.

| Data | Contents |
|---|---|
| **Company** | Name, optional website, trading name (if found), created/updated dates |
| **Company context** | Free-text context, last updated |
| **Research run** | Company link, snapshot of company context at run start, optional per-run topic, status, start/finish time, which version of `docs/intelligence/` was used. Runs are never overwritten or deleted (except when the company is deleted) |
| **Research result** | Overview, trading-name evidence and confidence, classification (including "Other"), people, developments, other account intelligence, triggers, conversation angles, recommended angle, research gaps |
| **Finding** | Text, label (FACT / INFERENCE / POSSIBLE OPPORTUNITY), date, confidence, trigger rank, link to sources |
| **Source** | URL, title, publisher/type, publication date, aggregator flag |
| **Person (from research)** | Name, role, why relevant, relevant public activity, profile link, source |
| **Manual contact** | Name, role/title (minimum); linked to the company |
| **Selection** | One chosen angle, one chosen contact (researched or manual) |
| **Email draft** | Selection link, outreach mode used and reason, weak-trigger flag, subject, generated text, user-edited text, timestamps |

## 14. Error / Empty / Low-Confidence States

| Situation | Required behaviour |
|---|---|
| Company cannot be identified or is ambiguous | Ask the user to clarify (website, location) rather than guess |
| Legal entity vs trading name cannot be confirmed | State this with a confidence level, and do not merge the names (`01` §0) |
| Little public information exists | Say so; show what was found and list research gaps |
| No strong recent trigger | Say so plainly. Show best available hooks, ranked per `03` §9 |
| No Teltonika-relevant angle | Show "No meaningful Teltonika angle found" with reasons |
| No people found | Show an empty state; the user can add a contact manually (name and role) |
| Findings rely on weak/aggregator sources | Flag them visibly |
| Company context conflicts with public findings | Show both, flag the conflict |
| Company context is empty | Research proceeds; email defaults to first contact |
| Company context indicates a relationship | Email uses re-engagement/expansion mode; the mode is shown (OR-11) |
| Context supports a relationship with the company but not the contact | Acknowledge the company relationship without implying personal familiarity (OR-10) |
| Research fails or times out | Show a clear error, keep the company and context, allow retry. Partial results are kept and labelled as partial |
| Research is slow | Show progress; the user can leave and return |
| Email requested from a weak/hook-only angle | Generate it, with a visible notice that no strong Teltonika-relevant sales trigger was found. No confirmation step |
| Page refresh mid-research | The run continues or is recoverable; nothing is lost |
| Company industry outside listed categories | Classified as **Other** |

## 15. V1 Acceptance Criteria

V1 is acceptable when all of the following are true:

1. A user can add a company, review and edit its company context, and start research.
2. Company context is saved with the company, shown pre-filled when research starts, and reused in later runs.
3. The research result contains every section listed in section 10 (or states explicitly why a section is empty).
4. Every finding has at least one source and a date, or is explicitly marked as lacking one.
5. Findings are visibly labelled FACT, INFERENCE or POSSIBLE OPPORTUNITY.
6. Company context is visibly distinguished from externally sourced findings.
7. Re-running research creates a new run; previous runs remain stored and the latest is shown by default.
8. Several triggers/angles are shown, with one marked as recommended, and the user can choose a different one. Exactly one angle is selected per email.
9. The user can choose a contact found in research, or add one manually with a name and role. This works even when research finds nobody.
10. For a company with no strong trigger, the tool says so rather than inventing one.
11. An email can be generated from a chosen angle and contact, edited in the app, regenerated and copied in one action. No other email controls exist.
12. When only a weak hook exists, the email is generated without an extra confirmation, with a clear notice that no strong Teltonika-relevant trigger was found.
13. When company context indicates an existing relationship, the email is written in re-engagement/expansion mode, does not use first-contact language, and shows which mode was used.
14. Generated emails follow `04_OUTREACH_RULES.md` (reviewed by the user) and contain no unsupported claims.
15. Companies, context, research, selections and emails persist after page refresh.
16. None of the V1 non-goals (section 7) are implemented.
17. **Real-world check (proposed):** run on at least five companies the user has already researched manually. The user judges the output at least as useful as the manual research for most of them, and the emails need only light editing.

## 16. Future / V2 Direction

Possibilities only. None are V1 requirements, and none should shape V1 scope beyond not blocking them.

1. **Research history UI and "what's new".** V1 already stores previous runs. V2 adds the interface to browse them, and compares new research against earlier research to surface genuinely new developments and new reasons to make contact.
2. **Richer account context.** V1 has a lightweight company context field. V2 may add structure or history to it (previous conversations, products, distributor relationships, competitors, known projects, evaluations), while still avoiding a CRM.
3. **Outreach history.** Record which contacts were approached, with which angle and what email.
4. **Email sequences / follow-ups.** Context-aware follow-ups using original research, previous outreach, company context and newly found developments.
5. **"Who should I contact today?"** A longer-term direction using saved accounts, research history, new triggers and outreach history to surface accounts with a timely reason for contact.
6. **Email tuning controls.** Shorter, friendlier, more direct, etc., if hand-editing and regeneration prove insufficient.
7. **Combining angles** in one email, if real use shows a need.
8. **In-product learning loop.** A way to capture feedback and propose updates to the intelligence rules, per `06_LEARNING_RULES.md`.

## 17. Decisions and Open Questions

### Decisions recorded for V1

| Topic | Decision |
|---|---|
| Research history | Keep all runs; show the latest by default; no history UI; never overwrite or delete |
| Company context | Belongs to the company; editable; reused; shown and editable when research starts; lightweight, not a CRM |
| Contacts | Pick from research or add manually (name and role minimum) |
| Weak triggers | Generate the email; clearly state no strong Teltonika-relevant trigger was found; no confirmation step |
| Existing relationships | Outreach adapts to company context; no forced first-contact language |
| Angle selection | Exactly one primary angle per email |
| Email iteration | Edit, regenerate, copy only |
| Access | Single user; no complex authentication |
| Learning / feedback | Manual; no in-product learning system |
| Research time / cost limits | Not defined now; evaluated during architecture and API decisions |
| Unlisted industries | Classified as "Other" |

### Remaining open questions (none blocks USER_FLOW.md)

1. **Access protection.** No complex authentication is assumed. Whether any minimal protection is needed once hosted is an architecture-stage question.
2. **Intelligence gap: mixed relationships.** `04` §5 only distinguishes cold first contact from an existing contact. It does not define how to write to a new person at an existing customer, or an expansion email about a newly found project. OR-10 sets a safe product rule, but the wording guidance may later need an update to `04_OUTREACH_RULES.md`, to be proposed and approved separately, not edited here.
3. **Previous runs.** They are stored but not viewable in V1. Whether a minimal way to open an older run is needed will be revisited if it proves necessary in use.
4. **Research time and cost.** To be set once architecture and APIs are chosen.
