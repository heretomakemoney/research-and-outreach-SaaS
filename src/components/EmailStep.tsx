"use client";

// Contact choice, relationship, email generation, editing, copy and
// transparency. Calls the server through generateEmail() and hands the
// updated workflow back to the page, which saves it.

import { useEffect, useState } from "react";
import { SourceChips } from "@/components/Sources";
import { generateEmail } from "@/lib/client/pipeline";
import type { ContactChoice, EvidenceCard, RelationshipKind, Workflow } from "@/lib/types";

type ContactMode = string; // "manual" or the id of a researched person

export default function EmailStep({ wf, onChange }: { wf: Workflow; onChange: (next: Workflow) => void }) {
  const synthesis = wf.synthesis;
  const people = wf.state.people;
  const rankedIds = synthesis?.people.map((p) => p.personId) ?? [];
  const orderedPeople = [
    ...rankedIds.map((id) => people.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p),
    ...people.filter((p) => !rankedIds.includes(p.id)),
  ];

  const [mode, setMode] = useState<ContactMode>("manual");
  const [manualName, setManualName] = useState("");
  const [manualRole, setManualRole] = useState("");
  const [relKind, setRelKind] = useState<RelationshipKind>(wf.relationship.kind);
  const [relNote, setRelNote] = useState(wf.relationship.note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Start from the saved choice if there is one, else the top researched person, else manual.
  useEffect(() => {
    if (wf.contact?.source === "researched") setMode(wf.contact.personId);
    else if (wf.contact?.source === "manual") {
      setMode("manual");
      setManualName(wf.contact.name);
      setManualRole(wf.contact.role);
    } else if (orderedPeople[0]) setMode(orderedPeople[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!synthesis) return null;
  const angle = synthesis.angles.find((a) => a.id === wf.selectedAngleId) ?? null;
  const weak = angle ? angle.strength === "weak" || angle.strength === "general_introduction" : false;
  const weakRelevance = synthesis.relevance === "weak" || synthesis.relevance === "none";

  function currentContact(): ContactChoice | null {
    if (mode === "manual") {
      return manualName.trim() ? { source: "manual", name: manualName.trim(), role: manualRole.trim() } : null;
    }
    const p = people.find((x) => x.id === mode);
    return p ? { source: "researched", personId: p.id, name: p.name, role: p.role } : null;
  }

  const contact = currentContact();
  const email = wf.email;
  const edited = !!email && (email.subject !== email.originalSubject || email.body !== email.originalBody);
  const selectionChanged =
    !!email &&
    (email.angleId !== wf.selectedAngleId ||
      (contact !== null &&
        (email.contact.name !== contact.name || email.contact.source !== contact.source)) ||
      email.relationship.kind !== relKind ||
      email.relationship.note !== relNote.trim());

  async function run(regenerate: boolean) {
    if (!contact) return;
    if (regenerate && edited && !window.confirm("You have edited this email. Regenerating will replace your edits. Continue?")) return;
    setBusy(true);
    setError(null);
    try {
      const next = await generateEmail(wf, contact, { kind: relKind, note: relNote.trim() }, regenerate);
      onChange(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy(what: "email" | "body") {
    if (!email) return;
    const text = what === "email" ? `Subject: ${email.subject}\n\n${email.body}` : email.body;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Could not copy automatically. Select the text and copy it by hand.");
    }
  }

  const draftAngle = email ? synthesis.angles.find((a) => a.id === email.angleId) : null;
  const draftSupplied: EvidenceCard[] = [];
  if (draftAngle) {
    const ids = new Set<string>(draftAngle.cardIds);
    for (const t of synthesis.triggers) if (draftAngle.triggerIds.includes(t.id)) t.factCardIds.forEach((id) => ids.add(id));
    for (const c of wf.state.cards) if (ids.has(c.id)) draftSupplied.push(c);
  }
  const lastLog = wf.emailLogs[wf.emailLogs.length - 1];

  return (
    <section>
      <h2>Email</h2>

      {!angle && <p className="muted">Choose an angle above first.</p>}
      {angle && (
        <>
          <p>
            Angle: <strong>{angle.title}</strong>
          </p>
          {(weak || weakRelevance) && (
            <div className="warning">
              {angle.strength === "general_introduction"
                ? "No specific trigger was found. This email will be a general introduction, written without pretending there is a strong reason to contact them."
                : "The evidence behind this angle is weak. The email will stay modest and will not pretend there is a strong trigger."}
            </div>
          )}

          <div className="panel">
            <strong>Who is the email to?</strong>
            {orderedPeople.map((p) => (
              <label key={p.id} className="inline">
                <input type="radio" name="contact" checked={mode === p.id} onChange={() => setMode(p.id)} />
                <span>
                  {p.name} <span className="muted">{p.role}</span> <SourceChips keys={p.sourceKeys} />
                </span>
              </label>
            ))}
            <label className="inline">
              <input type="radio" name="contact" checked={mode === "manual"} onChange={() => setMode("manual")} />
              <span>Enter a contact manually</span>
            </label>
            {mode === "manual" && (
              <div className="row">
                <label>
                  Name
                  <input value={manualName} onChange={(e) => setManualName(e.target.value)} maxLength={120} />
                </label>
                <label>
                  Role <span className="hint">(optional)</span>
                  <input value={manualRole} onChange={(e) => setManualRole(e.target.value)} maxLength={160} />
                </label>
              </div>
            )}

            <strong>Relationship</strong>
            <div className="row">
              <label>
                <select value={relKind} onChange={(e) => setRelKind(e.target.value as RelationshipKind)}>
                  <option value="new">First contact (never spoken)</option>
                  <option value="existing">Existing contact</option>
                </select>
              </label>
              <label className="grow">
                Note <span className="hint">(optional: anything the email should know)</span>
                <input value={relNote} onChange={(e) => setRelNote(e.target.value)} maxLength={1000} />
              </label>
            </div>

            <button type="button" disabled={busy || !contact} onClick={() => run(false)}>
              {busy ? "Writing…" : email ? "Generate again from scratch" : "Generate email"}
            </button>
          </div>
        </>
      )}

      {error && <div className="error">{error}</div>}

      {email && (
        <div className="panel">
          {selectionChanged && (
            <div className="warning">The angle, contact or relationship has changed since this draft. Regenerate to update it.</div>
          )}
          <label>
            Subject
            <input
              value={email.subject}
              onChange={(e) => onChange({ ...wf, email: { ...email, subject: e.target.value } })}
            />
          </label>
          <label>
            Body
            <textarea
              className="email-body"
              value={email.body}
              onChange={(e) => onChange({ ...wf, email: { ...email, body: e.target.value } })}
            />
          </label>
          <div className="row">
            <button type="button" onClick={() => copy("email")}>
              {copied === "email" ? "Copied" : "Copy email"}
            </button>
            <button type="button" className="secondary" onClick={() => copy("body")}>
              {copied === "body" ? "Copied" : "Copy body only"}
            </button>
            <button type="button" className="secondary" disabled={busy || !contact} onClick={() => run(true)}>
              {busy ? "Writing…" : "Regenerate"}
            </button>
            <span className="muted">
              Draft {email.generation}
              {edited ? ", edited by you" : ""}
            </span>
          </div>

          <details>
            <summary>How this email was made (transparency)</summary>
            <dl className="kv">
              <dt>Angle</dt>
              <dd>{draftAngle ? `${draftAngle.title} (${draftAngle.strength})` : email.angleId}</dd>
              <dt>Recipient</dt>
              <dd>
                {email.contact.name}
                {email.contact.role ? `, ${email.contact.role}` : ""} (
                {email.contact.source === "researched" ? "found in public research" : "entered by you"})
                {email.contact.source === "researched" && (
                  <>
                    {" "}
                    <SourceChips keys={people.find((p) => p.id === (email.contact as { personId: string }).personId)?.sourceKeys ?? []} />
                  </>
                )}
              </dd>
              <dt>Relationship</dt>
              <dd>
                {email.relationship.kind === "existing" ? "Existing contact" : "First contact"}
                {email.relationship.note ? `: ${email.relationship.note}` : ""}
              </dd>
              <dt>Facts the email relies on</dt>
              <dd>
                {email.usedCardIds.length === 0 && "none listed"}
                {email.usedCardIds.map((id) => {
                  const c = wf.state.cards.find((x) => x.id === id);
                  return c ? (
                    <div key={id}>
                      <span className="badge">{id}</span> {c.claim} <SourceChips keys={c.sourceKeys} />
                    </div>
                  ) : null;
                })}
              </dd>
              <dt>Evidence supplied but not relied on</dt>
              <dd>
                {draftSupplied.filter((c) => !email.usedCardIds.includes(c.id)).length === 0
                  ? "none"
                  : draftSupplied
                      .filter((c) => !email.usedCardIds.includes(c.id))
                      .map((c) => (
                        <div key={c.id}>
                          <span className="badge light">{c.id}</span> {c.claim}
                        </div>
                      ))}
              </dd>
              <dt>Writing rules used</dt>
              <dd>{lastLog ? lastLog.rulesFiles.map((f) => f.name).join(", ") : "–"}</dd>
              <dt>Model</dt>
              <dd>{lastLog ? `${lastLog.model} (effort ${lastLog.effort})` : "–"}</dd>
            </dl>
            <p className="muted">
              Private context you entered shapes the tone and relevance but is never listed as researched evidence.
            </p>
          </details>
        </div>
      )}
    </section>
  );
}
