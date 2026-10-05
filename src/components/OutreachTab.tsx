"use client";

// The Outreach tab: choose an angle, choose or enter a contact, say whether it is a first or existing
// contact, then write the one current email. The email is editable (saved automatically), can be
// regenerated (with a confirmation if it was edited) and copied.

import { useEffect, useRef, useState } from "react";
import { GradeBadge } from "@/components/Sources";
import { httpCall, writeEmail } from "@/lib/client/research";
import type { Company, ManualContact, OutreachEmail, ResearchRun } from "@/lib/domain";
import { usd } from "@/lib/format";
import { getRepository } from "@/lib/repo/browser";
import { totalCost } from "@/lib/pricing";
import type { ContactChoice, RelationshipKind } from "@/lib/types";

type ContactMode = string; // "p:P1" (researched), "m:<id>" (saved manual contact), "new"

function initialContactMode(company: Company, run: ResearchRun): ContactMode {
  if (company.selectedRunId === run.id && company.selectedPersonKey && run.research.people.some((p) => p.id === company.selectedPersonKey)) return `p:${company.selectedPersonKey}`;
  if (company.selectedManualContactId) return `m:${company.selectedManualContactId}`;
  const first = run.synthesis?.people[0]?.personId ?? run.research.people[0]?.id;
  return first ? `p:${first}` : "new";
}

export function OutreachTab({ company, run, email, contacts }: { company: Company; run: ResearchRun | null; email: OutreachEmail | null; contacts: ManualContact[] }) {
  const repo = getRepository();
  const synthesis = run?.synthesis ?? null;

  const [angleKey, setAngleKey] = useState<string>("");
  const [mode, setMode] = useState<ContactMode>("new");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("");
  const [relKind, setRelKind] = useState<RelationshipKind>("new");
  const [relNote, setRelNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [subject, setSubject] = useState(email?.subject ?? "");
  const [body, setBody] = useState(email?.body ?? "");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Set the form up once per research run / company.
  useEffect(() => {
    if (!run || !synthesis) return;
    const current = company.selectedRunId === run.id ? company.selectedAngleKey : null;
    const rec = synthesis.angles.find((a) => a.recommended) ?? synthesis.angles[0];
    setAngleKey(current && synthesis.angles.some((a) => a.id === current) ? current : (rec?.id ?? ""));
    setMode(initialContactMode(company, run));
    if (email) {
      setRelKind(email.relationship.kind);
      setRelNote(email.relationship.note);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, company.id]);

  // When a new draft arrives (generate / regenerate), show its text.
  useEffect(() => {
    setSubject(email?.subject ?? "");
    setBody(email?.body ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email?.id, email?.generation, email?.generatedAt]);

  if (!run || !synthesis) {
    return (
      <section className="card">
        <h2>Outreach</h2>
        <p className="muted">Research this company first. An email is written from an angle and a contact found in the research.</p>
      </section>
    );
  }

  const people = run.research.people;
  const ordered = [...(synthesis.people.map((rp) => people.find((p) => p.id === rp.personId)).filter((p): p is NonNullable<typeof p> => !!p)), ...people.filter((p) => !synthesis.people.some((rp) => rp.personId === p.id))];
  const angle = synthesis.angles.find((a) => a.id === angleKey) ?? null;

  function currentContact(): ContactChoice | null {
    if (mode.startsWith("p:")) {
      const p = people.find((x) => x.id === mode.slice(2));
      return p ? { source: "researched", personId: p.id, name: p.name, role: p.role } : null;
    }
    if (mode.startsWith("m:")) {
      const m = contacts.find((x) => x.id === mode.slice(2));
      return m ? { source: "manual", name: m.name, role: m.role } : null;
    }
    return newName.trim() ? { source: "manual", name: newName.trim(), role: newRole.trim() } : null;
  }
  const contact = currentContact();
  const edited = !!email && (email.subject !== email.generatedSubject || email.body !== email.generatedBody);
  const changedSinceDraft =
    !!email &&
    (email.angleKey !== angleKey ||
      email.relationship.kind !== relKind ||
      email.relationship.note !== relNote.trim() ||
      (contact !== null && (email.contact.name !== contact.name || email.contact.source !== contact.source)));

  async function generate(regenerate: boolean) {
    if (!angle || !contact) return;
    if (regenerate && edited && !window.confirm("This replaces the current email, including your edits. Continue?")) return;
    if (!regenerate && email && edited && !window.confirm("This replaces the current email, including your edits. Continue?")) return;
    setBusy(true);
    setError(null);
    try {
      await writeEmail(repo, httpCall, { companyId: company.id, angleKey: angle.id, contact, relationship: { kind: relKind, note: relNote.trim() }, regenerate });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function scheduleSave(nextSubject: string, nextBody: string) {
    if (!email) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void repo.saveEmail({ ...email, subject: nextSubject, body: nextBody, editedAt: new Date().toISOString() });
    }, 500);
  }

  async function copy(what: "email" | "subject") {
    const text = what === "email" ? body : subject;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setError("Could not copy automatically. Select the text and copy it by hand.");
    }
  }

  async function remember(patch: { angleKey?: string; personKey?: string | null; manualContactId?: string | null }) {
    await repo.setSelection(company.id, { runId: run!.id, ...patch });
  }

  const weak = angle && (angle.strength === "weak" || angle.strength === "general_introduction");
  const logsCost = email ? totalCost(email.logs).totalUsd : 0;

  return (
    <div className="stack-lg">
      <section className="card">
        <h2>Email setup</h2>
        <div className="form-grid">
          <label>
            Conversation angle
            <select
              value={angleKey}
              onChange={(e) => {
                setAngleKey(e.target.value);
                void remember({ angleKey: e.target.value });
              }}
            >
              {synthesis.angles.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.recommended ? "Recommended: " : ""}
                  {a.title}
                </option>
              ))}
            </select>
          </label>

          <fieldset>
            <legend>Who is the email to?</legend>
            {ordered.map((p) => (
              <label key={p.id} className="radio">
                <input
                  type="radio"
                  name="contact"
                  checked={mode === `p:${p.id}`}
                  onChange={() => {
                    setMode(`p:${p.id}`);
                    void remember({ personKey: p.id });
                  }}
                />
                <span>
                  {p.name} <span className="muted">{p.role}</span> <span className="badge light">from research</span>
                </span>
              </label>
            ))}
            {contacts.map((m) => (
              <label key={m.id} className="radio">
                <input
                  type="radio"
                  name="contact"
                  checked={mode === `m:${m.id}`}
                  onChange={() => {
                    setMode(`m:${m.id}`);
                    void remember({ manualContactId: m.id });
                  }}
                />
                <span>
                  {m.name} <span className="muted">{m.role}</span> <span className="badge light">entered by you</span>
                </span>
              </label>
            ))}
            <label className="radio">
              <input type="radio" name="contact" checked={mode === "new"} onChange={() => setMode("new")} />
              <span>Enter a contact manually</span>
            </label>
            {mode === "new" && (
              <div className="row">
                <label>
                  Name
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={120} />
                </label>
                <label>
                  Role
                  <input value={newRole} onChange={(e) => setNewRole(e.target.value)} maxLength={160} />
                </label>
              </div>
            )}
          </fieldset>

          <fieldset>
            <legend>Relationship</legend>
            <label className="radio">
              <input type="radio" name="rel" checked={relKind === "new"} onChange={() => setRelKind("new")} />
              <span>First contact</span>
            </label>
            <label className="radio">
              <input type="radio" name="rel" checked={relKind === "existing"} onChange={() => setRelKind("existing")} />
              <span>Existing contact</span>
            </label>
            <label>
              Relationship note <span className="hint">(optional)</span>
              <input value={relNote} onChange={(e) => setRelNote(e.target.value)} maxLength={1000} placeholder="e.g. met at the expo last year, talked about RUTX50" />
            </label>
          </fieldset>
        </div>

        {weak && (
          <div className="notice warn">
            {angle?.strength === "general_introduction"
              ? "No specific trigger was found for this company. This is a general introduction and is not based on a research finding. It makes no claim about Teltonika relevance."
              : "No strong Teltonika-relevant sales trigger was found. This email will rely on a conversation hook."}
          </div>
        )}
        {error && <div className="notice error">{error}</div>}
        <div className="row">
          <button type="button" disabled={busy || !angle || !contact} onClick={() => void generate(false)}>
            {busy ? "Writing…" : email ? "Write a new email" : "Generate email"}
          </button>
          {!angle && <span className="muted">Select an angle.</span>}
          {angle && !contact && <span className="muted">Choose or enter a contact.</span>}
        </div>
      </section>

      {email && (
        <section className="card">
          <h2>Email</h2>
          <p className="muted">
            Written as <strong>{email.relationship.kind === "existing" ? "existing contact" : "first contact"}</strong>
            {email.relationship.note ? ` (${email.relationship.note})` : ""} to <strong>{email.contact.name}</strong>
            {email.contact.role ? `, ${email.contact.role}` : ""}. Angle: {email.angleTitle}.
            {email.runId !== run.id && " Based on earlier research."}
          </p>
          {changedSinceDraft && <div className="notice warn">The angle, contact or relationship has changed since this draft. Regenerate to update it.</div>}
          {email.limitation === "weak_hook" && <div className="notice">No strong Teltonika-relevant sales trigger was found. This email is based on a conversation hook.</div>}
          {email.limitation === "fallback_general" && <div className="notice">No specific trigger was found for this company. This is a general introduction and is not based on a research finding.</div>}
          <label>
            Subject
            <input
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value);
                scheduleSave(e.target.value, body);
              }}
            />
          </label>
          <label>
            Body
            <textarea
              className="email-body"
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                scheduleSave(subject, e.target.value);
              }}
            />
          </label>
          <div className="row">
            <button type="button" onClick={() => void copy("email")}>
              {copied === "email" ? "Copied" : "Copy email"}
            </button>
            <button type="button" className="secondary" onClick={() => void copy("subject")}>
              {copied === "subject" ? "Copied" : "Copy subject"}
            </button>
            <button type="button" className="secondary" disabled={busy || !angle || !contact} onClick={() => void generate(true)}>
              {busy ? "Writing…" : "Regenerate"}
            </button>
            <span className="muted">
              Draft {email.generation}
              {edited ? ", edited by you" : ""}
            </span>
          </div>

          <details className="sub-details">
            <summary>Based on ({email.basedOn.length})</summary>
            {email.basedOn.length === 0 && <p className="muted">No research findings used.</p>}
            {email.basedOn.map((f) => (
              <div key={f.id} className="card-lite">
                <span className="badge">{f.id}</span> <GradeBadge grade={f.grade} /> {f.date && <span className="muted">{f.date}</span>}
                <div>{f.claim}</div>
                {f.sourceUrls.map((u) => (
                  <div key={u} className="muted url">
                    <a href={u} target="_blank" rel="noopener noreferrer">
                      {u}
                    </a>
                  </div>
                ))}
              </div>
            ))}
            <p className="muted">Private company context shapes tone and relevance but is never listed as researched evidence.</p>
          </details>
          <details className="sub-details">
            <summary>Email details</summary>
            <p className="muted">
              {email.logs.length} generation(s), estimated cost {usd(logsCost)}. Model: {email.logs[email.logs.length - 1]?.model}. Rules: {email.logs[email.logs.length - 1]?.rulesFiles.map((f) => f.name).join(", ")}.
            </p>
          </details>
        </section>
      )}
    </div>
  );
}
