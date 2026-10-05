"use client";

// The panels that open over a screen: add a company, set up research, edit details, edit context.
// Persistent company CONTEXT (remembered about the account) is kept clearly apart from the research
// TOPIC (an instruction for the next run only).

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Modal } from "@/components/ui";
import { getManager, useServerMode } from "@/lib/client/manager";
import type { Company } from "@/lib/domain";
import { getRepository } from "@/lib/repo/browser";

const CONTEXT_HELP = "Private notes we remember about this account (relationship, products used, past conversations). Reused in every research run and email.";
const TOPIC_HELP = "Optional. A question or focus for the next research run only. It is not remembered.";

function useBusy() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }
  return { busy, error, run, setBusy, setError };
}

// ---------------------------------------------------------------------------------------- add company

export function AddCompanyPanel({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [context, setContext] = useState("");
  const [topic, setTopic] = useState("");
  const [duplicates, setDuplicates] = useState<Company[]>([]);
  const { busy, error, run } = useBusy();

  async function submit(research: boolean, force = false) {
    await run(async () => {
      const repo = getRepository();
      if (!force) {
        const dupes = await repo.findDuplicates(name, website);
        if (dupes.length > 0) {
          setDuplicates(dupes);
          throw new Error("A company with this name or website already exists.");
        }
      }
      const company = await repo.createCompany({ name, website, context });
      if (research) await getManager().start(company.id, topic);
      onCreated(company.id);
    });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit(false);
  }

  return (
    <Modal title="Add company" onClose={onClose}>
      <form onSubmit={onSubmit} className="stack">
        <label>
          Company name <span className="req">(required)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required autoComplete="off" />
        </label>
        <label>
          Website <span className="hint">(optional)</span>
          <input value={website} onChange={(e) => setWebsite(e.target.value)} maxLength={300} placeholder="https://" />
        </label>
        <label>
          Company context <span className="hint">(optional)</span>
          <textarea value={context} onChange={(e) => setContext(e.target.value)} maxLength={4000} />
          <span className="help">{CONTEXT_HELP}</span>
        </label>
        <label>
          Research topic <span className="hint">(optional, first run only)</span>
          <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={1000} />
          <span className="help">{TOPIC_HELP}</span>
        </label>

        {error && <div className="notice error">{error}</div>}
        {duplicates.length > 0 && (
          <div className="notice warn">
            {duplicates.map((d) => (
              <div key={d.id}>
                <Link href={`/companies/${d.id}`}>Open existing: {d.name}</Link>
              </div>
            ))}
            <div className="row">
              <button type="button" className="secondary" disabled={busy} onClick={() => void submit(false, true)}>
                Add anyway
              </button>
            </div>
          </div>
        )}

        <div className="row end">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="secondary" disabled={busy || !name.trim()}>
            Add
          </button>
          <button type="button" disabled={busy || !name.trim()} onClick={() => void submit(true)}>
            Add and research
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------- research setup

export function ResearchSetupPanel({ company, hasResearch, onClose, onStarted }: { company: Company; hasResearch: boolean; onClose: () => void; onStarted: () => void }) {
  const [context, setContext] = useState(company.context);
  const [topic, setTopic] = useState("");
  const mode = useServerMode();
  const { busy, error, run } = useBusy();

  async function start(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const repo = getRepository();
      if (context.trim() !== company.context.trim()) await repo.updateCompany(company.id, { context });
      await getManager().start(company.id, topic);
      onStarted();
    });
  }

  return (
    <Modal title={hasResearch ? "Research again" : "Start research"} onClose={onClose}>
      <form onSubmit={start} className="stack">
        <label>
          Company context <span className="hint">(remembered)</span>
          <textarea value={context} onChange={(e) => setContext(e.target.value)} maxLength={4000} />
          <span className="help">{CONTEXT_HELP} Edits are saved to the company when you start.</span>
        </label>
        <label>
          Research topic <span className="hint">(optional, this run only)</span>
          <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={1000} placeholder="e.g. any SCADA or telemetry upgrades planned" />
          <span className="help">{TOPIC_HELP}</span>
        </label>
        {hasResearch && <div className="notice">Your previous research stays available until the new research finishes.</div>}
        {mode === "live" && <div className="notice warn">Live mode: this makes real, paid Anthropic calls (a full run has cost about $1 to $1.50). It takes several minutes; keep this tab open.</div>}
        {mode === "mock" && <div className="notice">Mock mode: free. The result is the saved sample, whatever the company.</div>}
        {error && <div className="notice error">{error}</div>}
        <div className="row end">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={busy}>
            Start research
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------- edit details / context

export function EditDetailsPanel({ company, onClose }: { company: Company; onClose: () => void }) {
  const [name, setName] = useState(company.name);
  const [website, setWebsite] = useState(company.website);
  const { busy, error, run } = useBusy();
  return (
    <Modal title="Edit details" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await getRepository().updateCompany(company.id, { name, website });
            onClose();
          });
        }}
      >
        <label>
          Company name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required />
        </label>
        <label>
          Website
          <input value={website} onChange={(e) => setWebsite(e.target.value)} maxLength={300} placeholder="https://" />
        </label>
        <p className="help">Changing these does not change research that has already run.</p>
        {error && <div className="notice error">{error}</div>}
        <div className="row end">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !name.trim()}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function EditContextPanel({ company, onClose }: { company: Company; onClose: () => void }) {
  const [context, setContext] = useState(company.context);
  const { busy, error, run } = useBusy();
  return (
    <Modal title="Company context" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await getRepository().updateCompany(company.id, { context });
            onClose();
          });
        }}
      >
        <label>
          What we remember about this account
          <textarea value={context} onChange={(e) => setContext(e.target.value)} maxLength={4000} rows={7} />
          <span className="help">{CONTEXT_HELP} Editing it does not change past research or emails.</span>
        </label>
        {error && <div className="notice error">{error}</div>}
        <div className="row end">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
