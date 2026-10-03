# V1 User Flow

**Product:** Account Research & Outreach Tool (working title)
**Version:** Draft 0.2 for approval
**Date:** 2026-10-03
**Inputs:** `docs/PRD.md` (locked V1 scope, what the product does) and `docs/intelligence/` (how research, triggers and outreach behave)

This is a functional UX document. It defines screens, content, actions and transitions. It does not define colours, fonts, branding, spacing, component styling, architecture or APIs. Where it names a control ("button", "panel", "tag") it describes behaviour, not appearance.

Terms (company context, research topic, angle, batch, research status, outreach mode) are used as defined in the PRD terminology section.

---

## 1. V1 Navigation Model

The product is a **focused research workspace** with two levels and a few lightweight panels. There is no sidebar, settings area, dashboard or CRM structure.

```
Accounts (home)
 ├─ panel: Add companies
 ├─ panel: Research setup   (for selected / single company)
 └─ Company page
     ├─ tab: Research   (default)
     ├─ tab: Outreach
     └─ panels: Edit context · Edit details · Contact picker
```

Rules:

- The product name in the top bar always returns to **Accounts**. The company page has a **← Accounts** link.
- A company page opens on the **Research** tab. The second tab is labelled simply **Outreach**, with no counts.
- Panels open over the current screen and close back to it. They never replace the screen.
- Refreshing the page keeps the user on the same company and tab. Nothing is lost on refresh (FR-21).
- The user can leave any screen while research runs. Research does not depend on a screen being open.
- There is no history-browsing screen. Previous runs are stored and not shown (PRD non-goals).

## 2. Screen / View Inventory

| # | Screen / view | Type | Purpose |
|---|---|---|---|
| 1 | **Accounts** | Screen (home) | See all companies and their research status; start every workflow from here |
| 2 | **Add companies** | Panel | Add 1–5 new companies, optionally starting research |
| 3 | **Research setup** | Panel | Review company context, add an optional topic, and start research for 1–5 existing companies |
| 4 | **Company page: Research** | Screen / tab | Read the account intelligence; choose an angle and a contact |
| 5 | **Company page: Outreach** | Screen / tab | Generate, edit, regenerate and copy outreach emails |
| 6 | **Edit context** | Panel | Edit the company-level context at any time |
| 7 | **Edit details** | Panel | Correct company name or website |
| 8 | **Contact picker** | Panel / popover | Choose a researched person or add a contact manually |
| 9 | **Confirmations** | Small dialogs | Delete company; regenerate over edited text; duplicate company |

## 3. End-to-End Happy Path

An example with three new companies. Names are illustrative.

1. The user opens **Accounts**. The table is empty, with an "Add companies" button.
2. They choose **Add companies** and type three company names. They expand one row to paste a line of context ("Buys RUT241s through a distributor") and a topic ("remote monitoring projects"). They choose **Add and research**.
3. The panel closes. Three rows appear at the top of the table. Two show **Researching**, one **Queued**.
4. The user goes to other work. Later they return to Accounts. Two rows read **Done**, one **Partial**. The **Top signal** column shows Strong for one company and Weak / Hook for another.
5. They open the company with the **Strong** signal. The **Research** tab shows a summary, then the ranked triggers, then the conversation angles with one marked "Recommended".
6. They expand the top trigger to check the evidence, source and date. They are satisfied.
7. They choose **Select** on the recommended angle. The setup bar at the bottom of the page now shows "Angle: …".
8. They open the People section, see the engineer connected to the project, and choose **Select as recipient**. The setup bar enables **Write email**.
9. They choose **Write email**. The **Outreach** tab opens with the generated email. A line above it says "Written as re-engagement, because your context mentions existing Teltonika usage via a distributor."
10. They edit two sentences. The edits save automatically. They choose **Copy** and paste the email into their own email client.
11. Days later they come back, open the company, and everything is still there: research, selection and email.

---

## 4. Accounts / Home Flow

**PURPOSE**
See every company at a glance, see which research has finished, and start any workflow.

**WHAT THE USER SEES**

A compact table. One row per company. No cards.

| Column | Content | Shown before research |
|---|---|---|
| Select | Checkbox (disabled for Queued / Researching rows) | Yes |
| **Company** | Company name (opens the company) | Yes |
| **Industry** | One of the `01` §1 categories, or "Other" | Blank |
| **Client type** | Distributor / Integrator / End user / Unknown | Blank |
| **Status** | Text label, plus short secondary text (below) | "Not researched" |
| **Last researched** | Date the default research finished | Blank |
| **Top signal** | Strongest trigger rank: Strong, Medium, Weak / Hook, or None found | Blank |

Blank cells stay blank. Nothing is guessed (PRD section 14).

Status text and secondary text:

| Status | Secondary text | Selectable for "Research selected" |
|---|---|---|
| Not researched | none | Yes |
| Queued | "Waiting to start" | No |
| Researching | "Started 8 min ago"; on a re-run also "Earlier research available" | No |
| Done | none | Yes (re-research) |
| Partial | "Incomplete results" | Yes (retry) |
| Failed | Short reason, e.g. "No usable results" or "Company unclear" | Yes (retry) |

Other elements:

- A **name filter** (type to narrow the list) above the table.
- Column-header click sorts Company, Last researched and Top signal. The default order is **recent activity** (newest creation or status change first), so freshly finished research rises to the top.
- When at least one row is ticked, a selection bar appears: "2 selected · **Research selected** · Clear".
- Empty state with no companies: "No companies yet." and an **Add companies** button.
- Statuses update on screen as research progresses, with no reload (FR-33).

The table shows no pipeline stages, tasks, activity feeds or analytics.

**PRIMARY ACTION**
Open a company (click the row), or **Add companies**.

**SECONDARY ACTIONS**
- Tick up to 5 eligible rows and choose **Research selected** (section 6).
- Filter by name, sort by a column.
- Clear the selection.

**WHAT HAPPENS NEXT**
- Opening a row goes to the company page (section 9, or section 14 for a returning user).
- **Add companies** opens the panel in section 5.
- **Research selected** opens the Research setup panel in section 6.

---

## 5. Add Companies Flow

**PURPOSE**
Add one company, or up to five, with as little typing as possible.

**WHAT THE USER SEES**

An **Add companies** panel that opens with **one empty row**.

Each row, collapsed:
- **Company name** (required)
- A "**+ Details**" control

Expanding "+ Details" on a row reveals, for that company only:
- **Website** (optional)
- **Company context** (optional, free text)
- **Research topic** (optional, free text, applies to this run only)

Other elements:
- **+ Add another company** (up to 5 rows). At 5, the control is disabled with the message "Maximum 5 companies at once."
- A small marker on a collapsed row when its details are filled in ("Details added"), so hidden content is never forgotten.
- A remove control per row (when more than one row exists).
- Two submit actions: **Add and research** (primary) and **Add without researching** (secondary).

Behaviour:
- Untouched empty rows are ignored on submit.
- A row with details but no name is highlighted: "Company name is required." It is not submitted.
- When a name or website matches an existing company, the row shows: "A company with this name already exists." with **Open existing** and **Add anyway** (FR-27).
- This panel only adds new companies. Existing companies are researched through **Research selected** (section 6). The two are not mixed in one submission.

**PRIMARY ACTION**
**Add and research.**

**SECONDARY ACTIONS**
- **Add without researching.** The companies are saved with status **Not researched**.
- Cancel / close the panel. Anything typed is discarded after a confirmation only if at least one row has content.

**WHAT HAPPENS NEXT**
- The panel closes and the user lands on **Accounts**, which is where all submissions end, including a single company.
- New rows appear at the top. With **Add and research**, each starts as **Queued** or **Researching**. With **Add without researching**, each shows **Not researched**.
- A short confirmation line appears above the table, e.g. "3 companies added. Research started." It disappears after a moment and is not a notification.
- Each company is its own account with its own independent run. No batch object is shown afterwards.

---

## 6. Existing Company Batch Research Flow

**PURPOSE**
Start research, or re-research, for up to five existing companies together, with no other bulk actions.

**WHAT THE USER SEES**

On **Accounts**:
- Ticking a row's checkbox (eligible rows only) shows the selection bar.
- A sixth tick is refused with the message "You can research up to 5 companies at once." The sixth stays unticked.
- Queued and Researching rows have disabled checkboxes with the hint "Research in progress".

After **Research selected**, the **Research setup** panel opens (shared with the single-company flow in section 7):
- One compact row per selected company: name, status line (e.g. "Last researched 12 Sep" or "Not researched"), a **context preview** (first two lines, or "No context yet"), and an **Edit** control.
- A "**+ Topic**" control per row to add the optional research topic.
- A footer: **Start research (3)** and **Cancel**.

**PRIMARY ACTION**
**Start research (N).**

**SECONDARY ACTIONS**
- Edit context in a row (saved to the company, section 7).
- Add a topic to a row.
- Remove a company from the set before starting.
- Cancel (nothing starts, selection is kept).

**WHAT HAPPENS NEXT**
- The panel closes. The selection clears. The user is on **Accounts**.
- Each company gets its own independent run. Rows move to **Queued** or **Researching**. Companies that already had completed research show "Earlier research available" and keep their old values in the Industry, Client type, Last researched and Top signal columns until the new run finishes.
- Companies are never combined. One failing does not affect the others (section 15).
- The user may select more companies and submit **another** batch while these are still running. If the system cannot start everything at once, the extra runs show **Queued** (FR-28). Concurrency limits are an architecture decision.

---

## 7. Company Context + Research Topic Flow

**PURPOSE**
Let the user review and update what they privately know about a company before research, and optionally point a single run at a specific question.

**WHAT THE USER SEES**

Two different things, kept apart:

| | Company context | Research topic |
|---|---|---|
| Belongs to | The company | One research run only |
| Persists | Yes, reused every run and email | No, only stored with that run |
| Editable | Any time, in three places (below) | Only when starting research |
| Content | Existing relationship, products used, distributor, competitors, previous conversations or evaluations, known projects, internal notes | "What I want researched this time" |

Context is a **single free-text field** per company. It has no fields, timeline, tags or history. It is labelled as **your** information wherever it is shown.

Where context can be viewed or edited:
1. **Add companies** (new company, under "+ Details").
2. **Research setup** (every start of research, FR-7 and FR-43).
3. **Edit context** panel on the company page, any time (FR-6), also reached from the "Your context" strip on the Research tab.

Research setup behaviour:
- **Several companies:** each row shows a short context preview with **Edit**. Topic is revealed by "+ Topic". This keeps the panel compact while context stays visible, as the PRD requires.
- **One company** (from the company page "Research again" / "Start research" / "Retry"): the context field and the topic field are **expanded by default**, since there is room.
- There is **no extra confirmation step**. Starting research is the confirmation (UC-2).

**PRIMARY ACTION**
Edit the text and start research.

**SECONDARY ACTIONS**
- Leave context unchanged and start.
- Leave the topic empty (normal case).

**WHAT HAPPENS NEXT**
- Edits to context are saved to the company when the user starts research (in Research setup) or saves (in Edit context).
- The run keeps a **snapshot** of the context as it was when it started (UC-7). The snapshot is shown, read-only, on the progress view (section 8) so the user can see what the research was based on.
- Editing context later never changes past runs or past emails (UC-9). If the user edits context after an email was written, the Outreach tab shows "Context changed since this email was written. Regenerate to apply."

---

## 8. Research-in-Progress Flow

**PURPOSE**
Make a multi-minute wait understandable, safe to walk away from, and honest.

**WHAT THE USER SEES**

On **Accounts**:
- The status text and secondary text from section 4, updating live.
- Nothing else. There are no notifications and no batch dashboard.

On the **company page** when the company has **no earlier research** and the run is Queued or Researching:
- The Research tab shows a progress view instead of results:
  - Status: **Queued** ("Waiting to start") or **Researching** ("Started 8 min ago").
  - A plain-language line: "Deep research can take several minutes. You can leave this page. Research continues and the results will be here when you return."
  - Real stage information only if the system has it (e.g. "Checking company identity", "Searching recent projects"). No percentage bars or invented progress.
  - The context snapshot and topic used for this run, read-only.
- The header buttons for research are disabled while the run is in progress.
- No results are shown until they exist (PRD section 14).

On the company page when the company is being **re-researched** and earlier research exists:
- The earlier default research stays fully visible and usable.
- A banner at the top: "Newer research is running (started 8 min ago). Showing research from 12 Sep."
- **Research again** is disabled while the run is Queued or Researching.

When the run finishes:
- **On Accounts:** the status changes to **Done**, **Partial** or **Failed** and the columns update.
- **On the company page, if the user is not viewing it:** it opens on the new results.
- **On the company page, if the user is looking at earlier research:** the page is **not** swapped underneath them. The banner changes to "New research is ready. **View new research**." Choosing it loads the new default (a **Done** run becomes the default, FR-11).

**PRIMARY ACTION**
Wait, or leave and come back. Open any other company in the meantime, including a finished one from the same batch (FR-25).

**SECONDARY ACTIONS**
- Edit company context (does not affect the running run).
- Navigate to Accounts or another company.

**WHAT HAPPENS NEXT**
- On return, the company is in whatever state it reached. Refreshing or closing the page has no effect on the run.
- There is **no cancel** in V1. Queued and Researching runs complete normally.
- If the run ended Partial or Failed, see section 15.

---

## 9. Company / Research Results Flow

**PURPOSE**
Let the user understand the account quickly, check evidence only where they need to, and move toward a conversation angle. This is the most important screen in V1.

**WHAT THE USER SEES**

The page is built from **dense, scannable rows with evidence on demand**, not a single report and not a wall of cards. The page has four layers from top to bottom:

1. **Header** (always visible)
   - ← Accounts, company name, website link.
   - Industry · Client type (blank until known), plus trading name when found ("Trading as …").
   - Status text with secondary text, and "Researched 3 Oct 2026" for the default research.
   - Buttons: **Start research** / **Research again** / **Retry research** (label depends on state), and an overflow menu with **Edit details** and **Delete company**.
   - Tabs: **Research** | **Outreach**.
2. **State banners** (only when relevant): newer research running, research incomplete, earlier attempt failed, very little public information, company unclear, context conflict (section 15).
3. **Results sections** in the order set out in section 10, with a **jump bar** (Triggers · Angles · People · Developments · Technology · Background · Gaps · Sources).
4. **Outreach setup bar** pinned at the bottom of the Research tab: "Angle: *none selected* · To: *none selected* · **Write email**".

Behaviour:
- Every finding is a **row**. Opening a row (click or "View evidence") expands it **in place**. Several rows can be open at once.
- Sections can be collapsed. Their header always shows a count.
- Opening a source link opens the source in a new tab.
- Nothing is removed to achieve compactness. All findings and all evidence remain (FR-40).

**PRIMARY ACTION**
Scan triggers and angles, then **Select** an angle (section 11).

**SECONDARY ACTIONS**
- Expand rows to inspect evidence, sources, dates, confidence.
- Select a person as recipient (section 12).
- Edit context, start new research, open Outreach tab.

**WHAT HAPPENS NEXT**
- With an angle and a contact chosen, **Write email** moves the user to the Outreach tab (section 13).
- The user may also just read and leave. Reading research is a complete use of the product.

---

## 10. Research Results Information Hierarchy

The order below is by usefulness for deciding **whether and how to make contact**. Sections map to the required output in PRD section 10 and `01_RESEARCH_RULES.md` §12.

| # | Section | Default state | What it contains |
|---|---|---|---|
| 1 | **Summary** | Open | What the company does (2–3 lines); classification; trading-name result with confidence and evidence on demand (`01` §0); one **verdict line**: e.g. "Strongest signal: Strong. Remote water telemetry upgrade" or "No strong sales trigger found" or "No meaningful Teltonika angle found" |
| 2 | **Your context** strip | Open, one or two lines | The company context, labelled as **yours**. Shows "Conflicts with public information" when flagged. **Edit** control |
| 3 | **Triggers & hooks** | Open | Ranked findings: Primary, then Secondary, then Conversation hooks (`03` §6). Each tagged Strong / Medium / Weak / Hook |
| 4 | **Conversation angles** | Open | Selectable angles, each pointing to its trigger. One marked **Recommended** |
| 5 | **People** | Open | Researched people connected to the project or technology, each with role and why relevant |
| 6 | **Other developments & projects** | Open | Dated findings and projects/contracts that are **not already shown as triggers**, newest first |
| 7 | **Technology & vendors** | Collapsed (count shown) | Existing technology, vendors, partners, solutions seen |
| 8 | **Background** | Collapsed (count shown) | Older projects and history, kept apart from current triggers (`01` §8) |
| 9 | **Research gaps** | Open | What could not be established, plus watch items that are unconfirmed (never shown as triggers, `01` §10) |
| 10 | **Sources** | Collapsed (count shown) | Every source: title, publisher type, date, aggregator flag, and the findings that cite it |

**One finding, different groupings.** Triggers, developments, technology and background items are the same kind of record, grouped by what they are for. A development appears once. If it is a ranked trigger it appears under Triggers & hooks and not again under Other developments.

### Row anatomy (compact)

Every finding row shows enough to judge relevance without opening it (FR-39):

```
[Rank]  Short summary                              LABEL  · Date   [flags]   [View evidence]
```

- **Rank** only on triggers: Strong, Medium, Weak / Hook.
- **Summary**: one line.
- **LABEL**: exactly one of **FACT**, **INFERENCE**, **POSSIBLE OPPORTUNITY**.
- **Date** of the underlying development, where one exists.
- **Flags**, shown only when true: *Low confidence*, *Aggregator source*, *Conflicts with your context*, *From your context*.

Label rules:
- A trigger or development row carries the label of its headline claim, usually **FACT**; **INFERENCE** if the claim itself is inferred (e.g. a technology implied by a job advert).
- A conversation angle is always **POSSIBLE OPPORTUNITY**.
- Anything user-supplied is marked *From your context* and is never labelled FACT.

### Expanded row (evidence on demand)

Opening a row shows, in this order:

1. **Explanation**: what happened and why it matters, in plain language.
2. **Evidence**: what the sources actually say.
3. **Sources**: each with link, publisher type, date; aggregator sources flagged.
4. **Confidence** and the reason for it.
5. **Teltonika relevance as a chain**, with each step labelled (`02` §4):
   - FACT: what is known
   - INFERENCE: what that may imply for connectivity
   - POSSIBLE OPPORTUNITY: what is worth asking
6. **Conflict note**, if flagged: "Your context says … / Public sources say …".
7. **Used by**: the angles that rely on this finding.

### People rows

```
Name · Role · Why relevant (one line)           [View evidence]   [Select as recipient]
```

Expanded: the public activity, post or project that connects them, and the profile link. No responsibility is stated that is not evidenced (RR-7).

### Angle rows

```
[Recommended]  Angle statement                    POSSIBLE OPPORTUNITY    [Select]
               Based on: <trigger title> (Strong)
```

Expanded: why this angle, the underlying findings, and what the email would try to learn.

**Fallback angle row** (only when no research-backed angle exists, section 11):

```
General introduction — no specific trigger found      Not based on a research trigger    [Select]
```

It has no FACT / INFERENCE / POSSIBLE OPPORTUNITY label because it asserts nothing about the company. It is never marked Recommended. Expanded, it says: "No specific trigger was found for this company. This starts a general conversation because the company is already a target account. It makes no claim about Teltonika relevance."

---

## 11. Trigger / Conversation Angle Selection Flow

**PURPOSE**
Let the user choose the single reason they will use to start the conversation.

**WHAT THE USER SEES**

- **Triggers & hooks** first, so the user sees what happened and how strong it is. Sales triggers and conversation hooks are visibly different groups, per `03` §1.
- **Conversation angles** next. Each angle names the trigger it comes from.
- One angle is marked **Recommended**, with a one-line reason. The wording makes clear it is advice: "Suggested starting point".
- No angle is pre-selected. The user must choose (principle 6).
- Angles can also come from the company context, labelled *From your context* (for example, following up a previous evaluation). They combine with external findings (UC-3).

**PRIMARY ACTION**
**Select** on one angle.

**SECONDARY ACTIONS**
- Expand angles and triggers to check evidence first.
- Choose a different angle later; selecting another replaces the first. Only one angle can be selected at a time (FR-15).
- Clear the selection (× in the setup bar).

**WHAT HAPPENS NEXT**
- The setup bar shows "Angle: <angle statement>".
- The selection is saved with the company and survives refresh.
- If a contact is also chosen, **Write email** becomes available.

Special cases:
- **No strong trigger.** The Triggers section opens with "No strong sales trigger found." followed by whatever Medium, Weak or Hook items exist. A hook can be selected like any other angle.
- **Only a weak hook selected.** No extra confirmation (OR-12). The notice appears on the email (section 13).
- **No research-backed angle at all.** The Angles section shows one fallback angle, **"General introduction — no specific trigger found"**:
  - It is offered only when research finds no usable research-backed angle. Angles from the company context do not count as research-backed, so the fallback still appears beside them.
  - It is **never marked Recommended**.
  - It is clearly labelled **"Not based on a research trigger"** and carries no FACT / INFERENCE / POSSIBLE OPPORTUNITY label.
  - It does not manufacture relevance. It exists because the researched companies are already prospect targets.
  - It is selected like any other angle, and the Outreach screen states the limitation (section 13).

---

## 12. Contact Selection Flow

**PURPOSE**
Choose who the email is addressed to, whether or not research found anyone.

**WHAT THE USER SEES**

People appear in two places that edit the same choice:
- The **People** section: each researched person has **Select as recipient**.
- The **To:** control in the setup bar (and at the top of the Outreach tab) which opens the **Contact picker**.

The **Contact picker** lists:
1. **Researched people**: name, role, a one-line "why relevant".
2. **Contacts you added** for this company (reused next time).
3. **+ Add contact manually**, always present, even when research found nobody.

Manual contact form:
- **Name** (required)
- **Role / title** (required)

That is all. There are no contact notes. Internal relationship information belongs in the company context.

**PRIMARY ACTION**
Pick a person, or save a manual contact, then it becomes the recipient.

**SECONDARY ACTIONS**
- Change the recipient later.
- Remove a manually added contact.

**WHAT HAPPENS NEXT**
- The setup bar shows "To: Name (Role)".
- The choice is saved.
- Whether the email can use personal familiarity depends on the company context alone (OR-10). If the context mentions this person or conversation, it can; otherwise the email acknowledges only the company-level relationship.

If **no people were found**: the People section reads "No relevant people found in public sources." with an **Add contact manually** control. Researchers do not fill the gap with a list of senior executives (RR-7). The flow continues normally.

Relevant-person research stays valuable on its own. The People section is useful to read even when the user never writes an email.

---

## 13. Outreach Email Flow

**PURPOSE**
Turn the chosen angle and recipient into an email in the user's voice, which the user can edit and copy.

**WHAT THE USER SEES**

V1 keeps **one current email per company**. It persists so it is not lost on refresh. There is no drafts list, outreach history or draft count.

On the **Outreach** tab:

1. **Setup summary**: "Angle: … · To: Name (Role)", each with a **Change** control. Also shows "Based on research from 3 Oct 2026."
2. **Mode line** (OR-11): "Written as **first contact**" or "Written as **re-engagement / expansion**", with the reason taken from the company context, and an **Edit context** link. When the context shows a relationship with the company but not with this person: "Your context mentions a relationship with the company, not with Dan. The email avoids personal history."
3. **Limitation notice**, when applicable, above the email:
   - *Weak hook* (OR-13): "No strong Teltonika-relevant sales trigger was found. This email is based on a conversation hook: <hook>."
   - *Fallback angle*: "No specific trigger was found for this company. This is a general introduction and is not based on a research finding. It makes no claim about Teltonika relevance." The **Based on** list reads "No research findings used."
4. **Conflict warning**, when the angle relies on a finding that conflicts with the context.
5. **Subject** (editable single line) and **Body** (editable text).
6. **Based on**: a collapsed list of the findings the email relies on, with their sources, so the user can verify before sending (OR-6). It is captured when the email is generated and stays with the email.
7. Actions: **Copy** (body), **Copy subject**, **Regenerate**.

Before any email exists, the tab shows the setup summary and a **Generate email** button. The button is disabled, with the reason ("Select an angle and a contact"), until both are chosen.

How it works:
- **Write email** (Research tab setup bar) or **Generate email** (Outreach tab) generates the email and shows "Writing…" until it is ready.
- The text is **plain text**. Edits save automatically. Nothing is sent. There is no Gmail, Outlook, sequence, tone or length control (OR-7, OR-8).
- **Regenerate** replaces the current email with a new one, using the **current** angle and recipient. Changing the angle or recipient and then regenerating also replaces it. If the user has edited the text, a small confirmation appears: "This replaces the current email." The same applies to **Write email** when an email already exists.

**PRIMARY ACTION**
**Copy.**

**SECONDARY ACTIONS**
- Edit the text by hand.
- Regenerate.
- Change the angle or recipient, then regenerate.
- Go back to the Research tab to check evidence.

**WHAT HAPPENS NEXT**
- Copy places the text on the clipboard with a brief "Copied" acknowledgement. The user pastes it into their own email client.
- The product does not track whether the email was sent (not a CRM).

---

## 14. Returning User / Existing Company Flow

**PURPOSE**
Pick up exactly where the user left off, with the latest research as the default.

**WHAT THE USER SEES**

Clicking a company on **Accounts** opens its company page on the **Research** tab, in a state that depends on its status:

| Company state | What the Research tab shows |
|---|---|
| Not researched | Empty state: "Not researched yet." The context strip and a **Start research** button |
| Queued / Researching, no earlier research | Progress view (section 8) |
| Done | The results (sections 9–10) |
| Partial | The results found so far, with a banner and **Research again** (section 15) |
| Failed, no earlier research | The failure reason, the context strip, and **Retry research** |
| Any state with a re-run in progress | The earlier default research plus the "newer research running" banner |
| Failed re-run, earlier research exists | The earlier research plus "Latest attempt failed on 3 Oct. Showing research from 12 Sep." and **Retry** |

The user can:
- **See the latest completed research.** The default is the most recent **Done** run, or the most recent **Partial** run if there is no Done run (FR-11). A Failed run never replaces the research shown.
- **See and edit the company context** (strip, or Edit context).
- **See the current research status** in the header.
- **Start a new research run** with the header button, which opens Research setup for one company.
- **Generate a new email from existing research.** It replaces the current email. Their earlier angle and contact selection are still set, if still valid; otherwise they choose again.

When newer research replaces the default:
- The **current email stays** and is tagged "Based on earlier research (12 Sep)". Its "Based on" list still shows the findings that existed then.
- The **angle selection is cleared**, because the new run's angles may differ. The recipient stays selected.
- Earlier research runs are stored but not shown anywhere (no history UI).

Other actions on the company page:
- **Edit details** (name, website). Needed to resolve ambiguity and correct typos.
- **Delete company**: a confirmation states that all research, contacts and the saved email for the company are removed. Deleting is blocked while the company is Queued or Researching ("Research is still running").

**PRIMARY ACTION**
Continue reading or writing from where they left off.

**SECONDARY ACTIONS**
Research again, edit context, edit details, delete.

**WHAT HAPPENS NEXT**
Whatever the user chooses; no state is lost between visits.

---

## 15. Empty / Weak / Error States

The product states what it found and did not find. It never fills a gap with impressive-looking filler.

| Situation | What the user sees | What they can do |
|---|---|---|
| **No strong sales trigger found** | Verdict line "No strong sales trigger found." Triggers section lists only Medium, Weak or Hook items, labelled as such. Top signal column shows Medium or Weak / Hook | Select a hook as the angle; add context and research again |
| **No Teltonika-relevant opportunity found** | Verdict line "No meaningful Teltonika angle found," with a short, expandable "Why". Any remaining items are shown as hooks, not sales triggers. Top signal column shows None found | Read the intelligence; add context; research again later |
| **No relevant people found** | People section: "No relevant people found in public sources." | **Add contact manually**; the flow is unchanged |
| **Very little public information** | Banner: "Very little public information was found." Only real findings are shown. Research gaps lists what could not be established | Add website or context, then research again |
| **Partial research result** | Status **Partial**. Banner: "Research incomplete. Showing what was found." Sections that did not finish read "Not completed", which is different from "None found" | Use what exists; **Research again** |
| **Failed research** | Status **Failed** with a short reason. Context and topic are kept. If earlier research exists it stays visible with "Latest attempt failed on …" | **Retry research** (from the page or via Research selected) |
| **Company identification ambiguous** | Run ends **Failed** with reason "Company unclear". The page shows: "We could not tell which company this is." plus any candidate matches found | Edit website or add identifying details to context (e.g. "Sydney-based water utility"), then **Retry** |
| **Legal entity vs trading name unconfirmed** | Summary says "Trading name not confirmed. Researched under the supplied name." with the confidence level. Names are not merged (`01` §0) | Expand the evidence |
| **Company context conflicts with public information** | "Your context" strip flagged. The affected finding shows *Conflicts with your context* and, expanded, both statements side by side. A banner links to it | Correct the context (Edit context) or ignore; the user decides |
| **Weak conversation hook selected** | On the Outreach tab, the weak-trigger notice. The email is generated with no confirmation step | Proceed, or choose a different angle |
| **Research still running after the user leaves** | Accounts shows the live status when they return. The company page shows progress or the finished results | Nothing needed |
| **One company in a batch fails while others succeed** | The failed row shows **Failed** with a reason. The others continue and finish normally. There is no batch-level result screen | Open the failed company, or tick it and **Research selected** to retry |
| **Findings rely on weak or aggregator sources** | *Aggregator source* flag on the row; the source is marked in Sources | Judge for themselves |
| **Low-confidence finding** | *Low confidence* flag on the row; reason in the expanded view | Judge for themselves |
| **Sixth company in a batch** | "Maximum 5 companies at once." | Remove one, or submit a second batch |
| **Duplicate company** | "A company with this name already exists." | **Open existing** or **Add anyway** |
| **No research-backed angle at all** | Angles section shows only the fallback "General introduction — no specific trigger found", labelled "Not based on a research trigger" and never Recommended. The Outreach screen states the limitation | Select the fallback, or add context and research again |
| **Email from Partial research** | Allowed. The Outreach tab notes "Based on incomplete research." | Proceed or research again |
| **Page refreshed mid-research** | Same view, same status | Nothing needed |

---

## 16. Important Actions Available on Each Screen

| Screen | Actions |
|---|---|
| **Accounts** | Add companies · Open company · Tick up to 5 eligible rows · Research selected · Clear selection · Filter by name · Sort by column |
| **Add companies** | Type name · + Details (website, context, topic) · Add another (max 5) · Remove row · Open existing / Add anyway (duplicate) · **Add and research** · Add without researching · Cancel |
| **Research setup** | Review / edit context · + Topic · Remove company · **Start research (N)** · Cancel |
| **Company page: header** | ← Accounts · Start research / Research again / Retry · Edit details · Delete company · switch tab |
| **Company page: Research** | Expand / collapse sections and rows · View evidence · Open source · Select angle · Select as recipient · Edit context · Write email · Clear angle / recipient · View new research (when ready) |
| **Company page: Outreach** | Change angle · Change recipient · Generate email · Edit subject / body · Copy · Copy subject · Regenerate · Edit context |
| **Edit context** | Edit text · Save · Cancel |
| **Edit details** | Edit name / website · Save · Cancel |
| **Contact picker** | Choose researched person · Choose saved contact · Add contact manually (name, role) · Remove added contact |
| **Confirmations** | Confirm / cancel for: delete company, regenerate over edited text, discard unsaved panel content |

Deliberately absent from every screen: send email, sequences, tone controls, tasks, reminders, stages, notifications, analytics, history browsing, CSV import, chat assistant, batches above 5.

---

## 17. Simple Text-Based Flow Diagram

```
                           ┌─────────────────────────────┐
                           │         ACCOUNTS            │
                           │  compact table, status text │
                           └──────┬───────────┬──────────┘
          Add companies           │           │         Tick up to 5 rows
                  │               │ open row  │               │
                  ▼               │           │               ▼
        ┌──────────────────┐      │           │      ┌──────────────────┐
        │  ADD COMPANIES   │      │           │      │ RESEARCH SETUP   │
        │ name (+ details) │      │           │      │ review context   │
        │ up to 5 new rows │      │           │      │ optional topic   │
        └───┬──────────┬───┘      │           │      └────────┬─────────┘
  Add w/o   │          │ Add and  │           │               │ Start research
  research  │          │ research │           │               │
            ▼          ▼          ▼           │               ▼
        Not researched   Queued / Researching  ◄──────────────┘
                              │   (one independent run per company)
                              │ finishes
                              ▼
              Done / Partial / Failed ──────► back on ACCOUNTS (table updates)
                              │
                              │ open company
                              ▼
        ┌───────────────────────────────────────────────┐
        │ COMPANY PAGE · RESEARCH TAB                   │
        │ Summary → Your context → Triggers → Angles    │
        │ → People → Developments → Tech → Background   │
        │ → Gaps → Sources                              │
        │ rows: summary · LABEL · date · [View evidence]│
        └──────────────┬────────────────┬───────────────┘
              Select ONE angle     Select / add contact
                       └───────┬────────┘
                               ▼
                       [ Write email ]
                               ▼
        ┌───────────────────────────────────────────────┐
        │ COMPANY PAGE · OUTREACH TAB                   │
        │ mode line · weak-trigger notice · subject/body│
        │ Edit · Regenerate · Copy                      │
        └───────────────────────────────────────────────┘
                               │
                    paste into own email client

Re-research (from company page or Research selected):
 earlier research stays visible ─► banner "newer research running"
 ─► run finishes Done ─► "View new research" ─► new default (angle cleared, current email kept)
```

---

## 18. UX Decisions and Assumptions

### Decisions made here that the PRD did not specify

**Navigation and structure**
1. Two levels (Accounts, Company page) with Research and Outreach tabs, plus panels.
2. Every submission, including a single company, returns the user to Accounts.
3. Adding new companies and researching existing ones are separate entry points. A single submission is not a mix.
4. **Add without researching** exists, because the PRD defines a **Not researched** status that otherwise could not occur.
5. The Research setup panel is the single place where context and topic are reviewed before a run. One company shows both fields expanded; several show compact rows.

**Accounts table**
6. Rank labels in the table and results are **Strong, Medium, Weak / Hook, None found**, following the three tiers in `01` §12 and `03`.
7. Table values (Industry, Client type, Last researched, Top signal) come from the **default research** (FR-11), not simply the latest Done or Partial run. See the PRD inconsistency below.
8. Default order is recent activity. Column-header sorting on three columns and a name filter are included as the minimum needed to find a company in a growing list. These are the only additions that could be considered new features, and they can be removed without affecting the flow.
9. Status has short secondary text (e.g. "Started 8 min ago"), which stays as text.

**Research in progress**
10. Progress shows only real information. No percentages or invented stages.
11. New results arriving while the user reads earlier research are offered through a banner and are not swapped in automatically.
12. Deleting a company is blocked while it is Queued or Researching.
13. "Company unclear" is shown as a **Failed** run with a reason, rather than a seventh status.

**Results**
14. Findings are one record type shown in groupings. A development appears once, either as a trigger or under Other developments.
15. Triggers and Angles are two lists. Angles are the selectable items and cite their triggers.
16. Label rules: trigger rows carry their headline claim's label, angle rows are always POSSIBLE OPPORTUNITY, user-supplied content is never FACT.
17. *Low confidence*, *Aggregator source*, *Conflicts with your context* and *From your context* are shown in the compact row, since hiding them would undermine trust.
18. Angles can be derived from the company context (labelled *From your context*), consistent with UC-3.
19. No angle is pre-selected. The recommendation is advice only.
20. Technology & vendors, Background and Sources (sections 7, 8 and 10 in the hierarchy table) start collapsed; the rest start open.

**Contacts and email**
21. Manually added contacts (name and role only, no notes) are saved to the company and reused.
22. Two copy actions (body, subject) so the subject does not end up in the email body.
23. One current email per company. **Regenerate** replaces it using the current angle and recipient. A one-line confirmation appears only when the text was edited.
24. The email keeps a snapshot of the findings it used, so it stays verifiable after newer research replaces the default, and is tagged "Based on earlier research".
25. When newer research becomes the default, the angle selection resets, the recipient stays and the current email stays.
26. Email can be generated from Partial research, with a note.
27. The fallback angle "General introduction — no specific trigger found" appears only when no research-backed angle exists. It is never Recommended, carries no FACT / INFERENCE / POSSIBLE OPPORTUNITY label because it asserts nothing about the company, and the Outreach screen states the limitation.

**Company management**
28. **Edit details** (name, website) exists because the ambiguity flow needs it.

### Excluded from V1 by decision

- **Cancel research.** Queued and Researching runs complete normally. To be reconsidered after architecture and testing, once research duration, cost and whether the pipeline can be interrupted cleanly are known. Deleting a company stays blocked while it is running.
- **Multiple saved emails, drafts list, outreach history and draft counts.** V2 consideration.
- **Contact notes.** Relationship information lives in the company context.

### PRD inconsistency found and resolved

- FR-34 said table columns come from the "latest Done or Partial run", while FR-11 defines the default research as the most recent Done run (or Partial only if no Done exists). A newer Partial run after an older Done run would have made the table describe research that does not open. FR-34 in `docs/PRD.md` has been updated to say the columns come from the **default research (FR-11)**, so the table always matches what opens when the company is clicked.

### Assumptions

- The product always produces at least a company overview and a verdict line, even when little is found.
- Status updates in the browser without refreshing; how is an architecture matter.
- One user, no sign-in screens in V1.

---

## 19. Remaining Questions

No open product question blocks locking this document.

Deferred, with where they will be revisited:

1. **Cancel research.** Reconsidered after architecture and testing (see "Excluded from V1 by decision").
2. **Outreach history and multiple saved emails.** V2.
3. **Cost, load and access protection.** Architecture stage, as recorded in PRD section 17.
4. **Wording for mixed relationships** (a new person at an existing customer). `04_OUTREACH_RULES.md` §5 does not cover it. OR-10 sets a safe product rule, and any change to the intelligence file would be proposed and approved separately.
