"use client";

// Small shared pieces: a modal panel, status and signal labels, date formatting.

import { useEffect, useRef, type ReactNode } from "react";
import type { AccountStatus, TopSignal } from "@/lib/domain";
import { SIGNAL_LABEL } from "@/lib/summary";

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export function fmtDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const STATUS_LABEL: Record<AccountStatus, string> = {
  not_researched: "Not researched",
  researching: "Researching",
  done: "Done",
  partial: "Partial",
  failed: "Failed",
};

/** Text label with a dot. Never colour alone. */
export function StatusLabel({ status }: { status: AccountStatus }) {
  return (
    <span className={`status status-${status}`}>
      <span className="dot" aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function SignalLabel({ signal }: { signal: TopSignal | null }) {
  if (!signal) return <span className="muted">–</span>;
  return <span className={`signal signal-${signal}`}>{SIGNAL_LABEL[signal]}</span>;
}

/** A panel over the page. Closes with Escape, the close button or a click outside. */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input, textarea, button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
