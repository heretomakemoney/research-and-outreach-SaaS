// Reads the tagged text that the research stages (discover / follow-up) produce.
//
// Why a text format and not JSON: Claude's web tools attach citations to the
// TEXT it writes, and structured-output mode cannot be combined with citations.
// So the research stages write one tagged line per item, e.g.
//
//   CARD | project | 2026-03 | The council approved a 40-site CCTV rollout.
//
// Our code then reads those lines. For every line we work out which sources
// back it, using the citations the API attached to that exact text (via the
// [S#] markers and segment offsets built in ledger.ts). Claude never tells us
// which source supports a claim; the API does.
//
// A CARD or PERSON line with no backing source is REJECTED, not kept.
//
// Pure functions, no server-only imports: unit-tested in parse.test.ts.

import type {
  AnswerSegment,
  CardKind,
  CoverageStatus,
  EntityMatch,
  LeadPriority,
  LeadStatus,
  RelevanceLevel,
} from "./types";
import { CARD_KINDS } from "./types.ts";

export interface Evidence {
  sourceKey: string;
  excerpt: string;
}

export interface ParsedCard {
  kind: CardKind;
  date: string | null;
  claim: string;
  sourceKeys: string[];
  evidence: Evidence[];
}

export interface ParsedPerson {
  name: string;
  role: string;
  organisation: string;
  whyRelevant: string;
  sourceKeys: string[];
  evidence: Evidence[];
}

export interface ParsedLead {
  priority: LeadPriority;
  question: string;
  why: string;
}

export interface ParsedLeadResult {
  leadId: string;
  status: Exclude<LeadStatus, "open">;
  note: string;
}

export interface ParsedCoverage {
  topic: string;
  status: CoverageStatus;
  note: string;
}

export interface ParsedEntity {
  match: EntityMatch;
  matchNote: string;
  name: string;
  website: string;
  tradingLegal: string;
  industry: string;
  clientType: string;
  summary: string;
  contextCheck: string;
  sourceKeys: string[];
}

export interface ParsedResearch {
  entity: ParsedEntity | null;
  cards: ParsedCard[];
  people: ParsedPerson[];
  leads: ParsedLead[];
  leadResults: ParsedLeadResult[];
  coverage: ParsedCoverage[];
  relevance: { level: RelevanceLevel; note: string } | null;
  rejected: { line: string; reason: string }[];
  /** Non-empty lines that were not in the tagged format (kept out of the state). */
  ignoredLines: number;
}

const MARKER = /\[(S\d+)\]/g;
const MAX_EVIDENCE_PER_ITEM = 3;

function stripMarkers(text: string): string {
  return text.replace(/\s*\[S\d+\]/g, "").replace(/\s+/g, " ").trim();
}

function markerKeys(text: string): string[] {
  const keys: string[] = [];
  for (const m of text.matchAll(MARKER)) if (!keys.includes(m[1])) keys.push(m[1]);
  return keys;
}

/** Drop leading bullets / markdown emphasis so "- **CARD | ..." is still recognised. */
function normaliseLine(line: string): string {
  return line.replace(/^[\s>*\-•#]+/, "").replace(/\*\*/g, "").trim();
}

function splitFields(rest: string, count: number): string[] {
  // First (count - 1) fields are split on "|"; the last field keeps any further "|" characters.
  const parts: string[] = [];
  let remaining = rest;
  for (let i = 0; i < count - 1; i++) {
    const idx = remaining.indexOf("|");
    if (idx === -1) {
      parts.push(remaining);
      remaining = "";
    } else {
      parts.push(remaining.slice(0, idx));
      remaining = remaining.slice(idx + 1);
    }
  }
  parts.push(remaining);
  return parts.map((p) => stripMarkers(p));
}

function normaliseKind(raw: string): CardKind {
  const k = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (CARD_KINDS as readonly string[]).includes(k) ? (k as CardKind) : "other";
}

function normalisePriority(raw: string): LeadPriority {
  const k = raw.trim().toLowerCase();
  return k === "high" || k === "low" ? k : "medium";
}

function normaliseRelevance(raw: string): RelevanceLevel | null {
  const k = raw.trim().toLowerCase();
  return k === "strong" || k === "moderate" || k === "weak" || k === "none" ? k : null;
}

function normaliseCoverage(raw: string): CoverageStatus {
  const k = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (k === "found" || k === "partial" || k === "not_found" || k === "not_applicable") return k;
  if (k === "notfound" || k === "none") return "not_found";
  return "partial";
}

function normaliseLeadStatus(raw: string): Exclude<LeadStatus, "open"> {
  const k = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (k === "resolved" || k === "dead_end") return k;
  return "unresolved";
}

function normaliseMatch(raw: string): EntityMatch {
  const k = raw.trim().toLowerCase();
  if (k.startsWith("confirmed")) return "Confirmed";
  if (k.startsWith("probable")) return "Probable";
  if (k.startsWith("ambiguous")) return "Ambiguous";
  return "Not found";
}

/** "2026-03", "March 2026", "2026" -> keep as written; "unknown" / junk -> null. */
function normaliseDate(raw: string): string | null {
  const t = raw.trim();
  if (!t || /^(unknown|n\/?a|none|undated|-)$/i.test(t)) return null;
  return approxDateToMs(t) === null ? null : t.slice(0, 40);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Best-effort conversion of the date text on a card to a time (ms). null when it cannot be read. */
export function approxDateToMs(text: string | null): number | null {
  if (!text) return null;
  const t = text.trim().toLowerCase();
  let m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(t);
  if (m) return Date.UTC(+m[1], +m[2] - 1, m[3] ? +m[3] : 1);
  m = /^(\d{4})$/.exec(t);
  if (m) return Date.UTC(+m[1], 6, 1); // mid-year: the least wrong guess for a bare year
  m = /^(?:(\d{1,2})\s+)?([a-z]{3,9})\.?,?\s+(\d{4})$/.exec(t);
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3));
    if (month >= 0) return Date.UTC(+m[3], month, m[1] ? +m[1] : 1);
  }
  return null;
}

/** Evidence the API attached to the text of one line, found through segment offsets. */
function evidenceForRange(segments: AnswerSegment[], start: number, end: number): Evidence[] {
  const out: Evidence[] = [];
  for (const seg of segments) {
    if (seg.start < end && seg.end > start) {
      for (const c of seg.citations) {
        if (!out.some((e) => e.sourceKey === c.sourceKey && e.excerpt === c.excerpt)) out.push(c);
      }
    }
  }
  return out;
}

function keysForLine(lineText: string, evidence: Evidence[]): string[] {
  const keys = markerKeys(lineText);
  for (const e of evidence) if (!keys.includes(e.sourceKey)) keys.push(e.sourceKey);
  return keys;
}

/** Keep at most a few excerpts, preferring one per distinct source. */
function pickEvidence(evidence: Evidence[]): Evidence[] {
  const picked: Evidence[] = [];
  const seen = new Set<string>();
  for (const e of evidence) {
    if (!seen.has(e.sourceKey)) {
      picked.push(e);
      seen.add(e.sourceKey);
    }
    if (picked.length >= MAX_EVIDENCE_PER_ITEM) return picked;
  }
  for (const e of evidence) {
    if (picked.length >= MAX_EVIDENCE_PER_ITEM) break;
    if (!picked.includes(e)) picked.push(e);
  }
  return picked;
}

const ENTITY_FIELDS: Record<string, keyof Omit<ParsedEntity, "match" | "matchNote" | "sourceKeys">> = {
  ENTITY_NAME: "name",
  OFFICIAL_WEBSITE: "website",
  TRADING_LEGAL: "tradingLegal",
  INDUSTRY: "industry",
  CLIENT_TYPE: "clientType",
  SUMMARY: "summary",
  CONTEXT_CHECK: "contextCheck",
};

/**
 * @param raw the answer text WITH [S#] markers (rawAnswerText from the ledger, untrimmed)
 * @param segments segment offsets into `raw` (from the ledger)
 */
export function parseResearchOutput(raw: string, segments: AnswerSegment[]): ParsedResearch {
  const result: ParsedResearch = {
    entity: null,
    cards: [],
    people: [],
    leads: [],
    leadResults: [],
    coverage: [],
    relevance: null,
    rejected: [],
    ignoredLines: 0,
  };
  const entity: ParsedEntity = {
    match: "Not found",
    matchNote: "",
    name: "",
    website: "",
    tradingLegal: "",
    industry: "",
    clientType: "",
    summary: "",
    contextCheck: "",
    sourceKeys: [],
  };
  let sawEntityMatch = false;

  let offset = 0;
  for (const rawLine of raw.split("\n")) {
    const lineStart = offset;
    const lineEnd = offset + rawLine.length;
    offset = lineEnd + 1;
    if (!rawLine.trim()) continue;

    const line = normaliseLine(rawLine);

    // ---- "KEY: value" identification lines
    const kv = /^(ENTITY_MATCH|ENTITY_NAME|OFFICIAL_WEBSITE|TRADING_LEGAL|INDUSTRY|CLIENT_TYPE|SUMMARY|CONTEXT_CHECK)\s*:\s*(.*)$/i.exec(
      line,
    );
    if (kv) {
      const key = kv[1].toUpperCase();
      const evidence = evidenceForRange(segments, lineStart, lineEnd);
      for (const k of keysForLine(line, evidence)) if (!entity.sourceKeys.includes(k)) entity.sourceKeys.push(k);
      const value = stripMarkers(kv[2]);
      if (key === "ENTITY_MATCH") {
        sawEntityMatch = true;
        entity.match = normaliseMatch(value);
        entity.matchNote = value;
      } else {
        entity[ENTITY_FIELDS[key]] = value;
      }
      continue;
    }

    // ---- "TAG | field | field" lines
    const tag = /^(CARD|PERSON|LEAD_RESULT|LEAD|COVERAGE|RELEVANCE)\s*\|\s*(.*)$/i.exec(line);
    if (!tag) {
      result.ignoredLines++;
      continue;
    }
    const type = tag[1].toUpperCase();
    const rest = tag[2];
    const evidence = evidenceForRange(segments, lineStart, lineEnd);
    const sourceKeys = keysForLine(line, evidence);

    if (type === "CARD") {
      const [kind, date, claim] = splitFields(rest, 3);
      if (!claim) {
        result.rejected.push({ line: line.slice(0, 200), reason: "card has no claim text" });
      } else if (sourceKeys.length === 0) {
        result.rejected.push({ line: line.slice(0, 200), reason: "card has no source (the API attached no citation)" });
      } else {
        result.cards.push({
          kind: normaliseKind(kind),
          date: normaliseDate(date),
          claim,
          sourceKeys,
          evidence: pickEvidence(evidence),
        });
      }
    } else if (type === "PERSON") {
      const [name, role, organisation, whyRelevant] = splitFields(rest, 4);
      if (!name) {
        result.rejected.push({ line: line.slice(0, 200), reason: "person has no name" });
      } else if (sourceKeys.length === 0) {
        result.rejected.push({ line: line.slice(0, 200), reason: "person has no source (the API attached no citation)" });
      } else {
        result.people.push({ name, role, organisation, whyRelevant, sourceKeys, evidence: pickEvidence(evidence) });
      }
    } else if (type === "LEAD") {
      const [priority, question, why] = splitFields(rest, 3);
      if (question) result.leads.push({ priority: normalisePriority(priority), question, why });
    } else if (type === "LEAD_RESULT") {
      const [leadId, status, note] = splitFields(rest, 3);
      if (/^L\d+$/i.test(leadId)) {
        result.leadResults.push({ leadId: leadId.toUpperCase(), status: normaliseLeadStatus(status), note });
      }
    } else if (type === "COVERAGE") {
      const [topic, status, note] = splitFields(rest, 3);
      if (topic) result.coverage.push({ topic, status: normaliseCoverage(status), note });
    } else if (type === "RELEVANCE") {
      const [level, note] = splitFields(rest, 2);
      const lvl = normaliseRelevance(level);
      if (lvl) result.relevance = { level: lvl, note };
    }
  }

  if (sawEntityMatch) result.entity = entity;
  return result;
}
