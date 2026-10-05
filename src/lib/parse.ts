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
// A CARD or PERSON line must be tied to a real source in one of two ways, otherwise it is REJECTED:
//   1. api_cited      - the API attached a citation to that text (best: the API vouches for it).
//   2. quote_verified - the line names a page URL and a verbatim quote (` @@ url @@ quote`), the URL is
//                       one the web tools really returned (it is in the ledger), AND the quote is found
//                       word for word in the page text the API returned for that URL.
// Claude's own URL is never trusted by itself: it only counts when our code can check it against
// what Anthropic's tools returned.
//
// Pure functions, no server-only imports: unit-tested in parse.test.ts.

import type {
  AnswerSegment,
  CardKind,
  CoverageStatus,
  EntityMatch,
  EvidenceGrade,
  LeadPriority,
  LeadStatus,
  RelevanceLevel,
} from "./types";
import { CARD_KINDS } from "./types.ts";

export interface Evidence {
  sourceKey: string;
  excerpt: string;
}

/** What the parser may check a named source and quote against. Built from the ledger. */
export interface EvidenceContext {
  /** The ledger key (S#) for a URL the web tools returned, or null if no tool returned it. */
  resolveSource(url: string): string | null;
  /** The full page text the API returned for that source, or null (search snippet, PDF, not fetched). */
  pageText(sourceKey: string): string | null;
}

export interface ParsedCard {
  kind: CardKind;
  date: string | null;
  claim: string;
  sourceKeys: string[];
  evidence: Evidence[];
  grade: EvidenceGrade;
}

export interface ParsedPerson {
  name: string;
  role: string;
  organisation: string;
  whyRelevant: string;
  sourceKeys: string[];
  evidence: Evidence[];
  grade: EvidenceGrade;
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

/**
 * Make a line easy to recognise: drop bullets, numbering, headings, bold, backticks and table borders,
 * so "- **CARD | ..." , "1. `ENTITY_MATCH: ...`" and "| ENTITY_MATCH | Confirmed |" all work.
 */
function normaliseLine(line: string): string {
  return line
    .replace(/\*\*|__|`/g, "")
    .replace(/^[\s>*\-\u2022#|]+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/\s*\|\s*$/, "")
    .trim();
}

/** Lower-case letters and digits only, single spaces: lets a quote match despite quotes, dashes and spacing. */
export function normaliseForMatch(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const MIN_QUOTE_CHARS = 20;

function cleanUrl(raw: string): string {
  return raw.trim().replace(/^[<(\[\s"']+/, "").replace(/[>)\],.;\s"']+$/, "");
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

// Other spellings Claude has used or might use for the identification lines.
const KEY_ALIASES: Record<string, string> = {
  COMPANY_MATCH: "ENTITY_MATCH",
  COMPANY_NAME: "ENTITY_NAME",
  OFFICIAL_SITE: "OFFICIAL_WEBSITE",
  TRADING_NAME: "TRADING_LEGAL",
  TRADING_NAME_LEGAL_ENTITY: "TRADING_LEGAL",
  LEGAL_ENTITY: "TRADING_LEGAL",
};

/**
 * Recognise an identification line in any of the shapes Claude tends to produce:
 *   ENTITY_MATCH: Confirmed - reason      ENTITY_MATCH | Confirmed | reason
 *   Entity match: Confirmed               ENTITY MATCH - Confirmed
 * Returns the canonical key and the rest of the line, or null.
 */
function matchIdentificationLine(line: string): { key: string; value: string } | null {
  const m = /^([A-Za-z][A-Za-z _/]{2,40}?)\s*(?::|\||=|\u2013|\u2014|\s-\s)\s*(.*)$/.exec(line);
  if (!m) return null;
  let key = m[1].trim().toUpperCase().replace(/[\s/]+/g, "_");
  key = KEY_ALIASES[key] ?? key;
  if (key !== "ENTITY_MATCH" && !(key in ENTITY_FIELDS)) return null;
  return { key, value: m[2] };
}

/** Split " @@ url @@ quote" off the end of a CARD / PERSON line. */
function splitSourceTail(rest: string): { main: string; url: string; quote: string } {
  const parts = rest.split(/\s*@@\s*/);
  return {
    main: parts[0],
    url: cleanUrl(stripMarkers(parts[1] ?? "")),
    quote: stripMarkers(parts.slice(2).join(" ")).replace(/^["\u201c\u2018']+|["\u201d\u2019']+$/g, "").trim(),
  };
}

type Tie =
  | { ok: true; sourceKeys: string[]; evidence: Evidence[]; grade: EvidenceGrade }
  | { ok: false; reason: string };

/**
 * Decide how (if at all) a CARD / PERSON line is tied to a real source.
 * 1) API citations on the line's text. 2) A named ledger URL plus a quote found in the page text the API returned.
 */
function tieToSource(
  lineText: string,
  apiEvidence: Evidence[],
  url: string,
  quote: string,
  ctx: EvidenceContext | undefined,
): Tie {
  const apiKeys = keysForLine(lineText, apiEvidence);
  if (apiKeys.length > 0) return { ok: true, sourceKeys: apiKeys, evidence: pickEvidence(apiEvidence), grade: "api_cited" };

  if (!ctx || !url || !quote) {
    return { ok: false, reason: "no source: the API attached no citation and the line named no checkable source and quote" };
  }
  const key = ctx.resolveSource(url);
  if (!key) return { ok: false, reason: `no source: the named URL was not returned by any search or fetch (${url.slice(0, 80)})` };
  const text = ctx.pageText(key);
  if (!text) {
    return { ok: false, reason: `no source: ${key} was not read as page text (search snippet or PDF), so the quote cannot be checked and the API attached no citation` };
  }
  const wanted = normaliseForMatch(quote);
  if (wanted.length < MIN_QUOTE_CHARS) return { ok: false, reason: `no source: the quote for ${key} is too short to check` };
  if (!normaliseForMatch(text).includes(wanted)) return { ok: false, reason: `no source: the quote was not found in the text of ${key}` };
  return { ok: true, sourceKeys: [key], evidence: [{ sourceKey: key, excerpt: quote.slice(0, 300) }], grade: "quote_verified" };
}

/**
 * @param raw the answer text WITH [S#] markers (rawAnswerText from the ledger, untrimmed)
 * @param segments segment offsets into `raw` (from the ledger)
 * @param ctx lets the parser check a named source URL and quote against what the web tools returned
 */
export function parseResearchOutput(
  raw: string,
  segments: AnswerSegment[],
  ctx?: EvidenceContext,
): ParsedResearch {
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

    // ---- identification lines (ENTITY_MATCH: ..., ENTITY_MATCH | ..., Entity match - ...)
    const kv = matchIdentificationLine(line);
    if (kv) {
      const evidence = evidenceForRange(segments, lineStart, lineEnd);
      for (const k of keysForLine(line, evidence)) if (!entity.sourceKeys.includes(k)) entity.sourceKeys.push(k);
      const value = stripMarkers(kv.value);
      // First occurrence wins, so a later stray line cannot overwrite the identification.
      if (kv.key === "ENTITY_MATCH") {
        if (!sawEntityMatch) {
          sawEntityMatch = true;
          entity.match = normaliseMatch(value);
          entity.matchNote = value;
        }
      } else if (!entity[ENTITY_FIELDS[kv.key]]) {
        entity[ENTITY_FIELDS[kv.key]] = value;
      }
      continue;
    }

    // ---- "TAG | field | field" lines
    const tag = /^(CARD|PERSON|LEAD_RESULT|LEAD|COVERAGE|RELEVANCE)\s*[|:]\s*(.*)$/i.exec(line);
    if (!tag) {
      result.ignoredLines++;
      continue;
    }
    const type = tag[1].toUpperCase();
    const rest = tag[2];
    const evidence = evidenceForRange(segments, lineStart, lineEnd);

    if (type === "CARD" || type === "PERSON") {
      const tail = splitSourceTail(rest);
      if (type === "CARD") {
        const [kind, date, claim] = splitFields(tail.main, 3);
        const tie = tieToSource(line, evidence, tail.url, tail.quote, ctx);
        if (!claim) {
          result.rejected.push({ line: line.slice(0, 200), reason: "card has no claim text" });
        } else if (!tie.ok) {
          result.rejected.push({ line: line.slice(0, 200), reason: `card has ${tie.reason}` });
        } else {
          result.cards.push({
            kind: normaliseKind(kind),
            date: normaliseDate(date),
            claim,
            sourceKeys: tie.sourceKeys,
            evidence: tie.evidence,
            grade: tie.grade,
          });
        }
      } else {
        const [name, role, organisation, whyRelevant] = splitFields(tail.main, 4);
        const tie = tieToSource(line, evidence, tail.url, tail.quote, ctx);
        if (!name) {
          result.rejected.push({ line: line.slice(0, 200), reason: "person has no name" });
        } else if (!tie.ok) {
          result.rejected.push({ line: line.slice(0, 200), reason: `person has ${tie.reason}` });
        } else {
          result.people.push({ name, role, organisation, whyRelevant, sourceKeys: tie.sourceKeys, evidence: tie.evidence, grade: tie.grade });
        }
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
