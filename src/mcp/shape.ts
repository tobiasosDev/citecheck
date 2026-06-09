import type { CitationCheckResult, QuickCheckResult, CheckVerdict } from "../quick-check.js";
import type { DocumentExtraction } from "../document.js";

export const CAVEAT_NOT_FOUND =
  '"not found" means citecheck could not MATCH this reference — it is NOT proof the work is fabricated. ' +
  "Preprints, books, grey literature and non-English sources are under-represented in Crossref/OpenAlex. " +
  "Treat it as a prompt to look, not a verdict.";

export const CAVEAT_CHECK_FAILED =
  "citecheck could not reach Crossref for this one (network/rate-limit). " +
  "This is NOT a problem with the reference — retry later.";

export const CAVEAT_DOCUMENT =
  "Confirm the detected reference count matches your bibliography — segmentation of messy formatting is " +
  "best-effort. Only each reference string was sent to Crossref/OpenAlex/DOAJ; the document body was never uploaded. " +
  CAVEAT_NOT_FOUND;

export function interpret(status: CheckVerdict, retracted: boolean): string {
  if (retracted) return "This work has been RETRACTED.";
  switch (status) {
    case "verified": return "A matching record exists in Crossref/OpenAlex.";
    case "partial_match": return "A record exists but the metadata only partly matches — often just a sloppy entry.";
    case "suspicious": return "A record was found but it matches poorly — possibly the wrong source.";
    case "not_found": return "No matching record in Crossref or OpenAlex.";
    case "check_failed": return "Could not reach Crossref (network/rate-limit).";
  }
}

function isOpenAccess(r: CitationCheckResult): boolean {
  return r.journalStatus === "doaj_listed" || r.openalexMatch?.isOa === true;
}

export interface VerifyShape {
  status: CheckVerdict;
  retracted: boolean;
  matchedTitle: string | null;
  doi: string | null;
  openAccess: boolean;
  interpretation: string;
  caveat?: string;
}

export function shapeVerify(r: CitationCheckResult): VerifyShape {
  const out: VerifyShape = {
    status: r.status,
    retracted: r.retracted,
    matchedTitle: r.title || null,
    doi: r.crossrefMatch?.doi ?? null,
    openAccess: isOpenAccess(r),
    interpretation: interpret(r.status, r.retracted),
  };
  if (r.status === "not_found" || r.status === "suspicious") out.caveat = CAVEAT_NOT_FOUND;
  else if (r.status === "check_failed") out.caveat = CAVEAT_CHECK_FAILED;
  return out;
}

export interface Summary {
  total: number;
  verified: number;
  partial: number;
  not_found: number;
  suspicious: number;
  check_failed: number;
  retracted: number;
  open_access: number;
}

export function summarize(cits: CitationCheckResult[]): Summary {
  const s: Summary = {
    total: cits.length, verified: 0, partial: 0, not_found: 0,
    suspicious: 0, check_failed: 0, retracted: 0, open_access: 0,
  };
  for (const c of cits) {
    if (c.status === "verified") s.verified++;
    else if (c.status === "partial_match") s.partial++;
    else if (c.status === "not_found") s.not_found++;
    else if (c.status === "suspicious") s.suspicious++;
    else if (c.status === "check_failed") s.check_failed++;
    if (c.retracted) s.retracted++;
    if (isOpenAccess(c)) s.open_access++;
  }
  return s;
}

export interface Issue {
  key?: string;
  sourceRef?: string;
  title: string;
  status: CheckVerdict;
  retracted: boolean;
  note: string;
}

/**
 * An item is an "issue" the agent must see when it is a problem: not_found,
 * suspicious, partial_match, OR retracted (even a verified-and-retracted work).
 * check_failed is deliberately NOT an issue — it mirrors the CLI exit-code logic
 * (a transient network failure is not a problem with the reference).
 */
export function isIssue(c: CitationCheckResult): boolean {
  if (c.retracted) return true;
  return c.status === "not_found" || c.status === "suspicious" || c.status === "partial_match";
}

function issueNote(c: CitationCheckResult): string {
  if (c.retracted) return "RETRACTED";
  const base = c.warnings[0] ?? interpret(c.status, false);
  if (c.status === "partial_match") return base + " — often just a sloppy entry.";
  return base;
}

export function toIssues(cits: CitationCheckResult[]): Issue[] {
  return cits.filter(isIssue).map((c) => {
    const issue: Issue = {
      title: c.title,
      status: c.status,
      retracted: c.retracted,
      note: issueNote(c),
    };
    if (c.key) issue.key = c.key;
    if (c.sourceRef) issue.sourceRef = c.sourceRef;
    return issue;
  });
}

export interface ExtractionInfo {
  format: "docx" | "txt" | "md";
  detected: number;
  checked: number;
  confidence: "high" | "low";
  truncated: boolean;
}

export function mapExtraction(e: DocumentExtraction): ExtractionInfo {
  return {
    format: e.format,
    detected: e.referencesDetected,
    checked: e.referencesChecked,
    confidence: e.confidence,
    truncated: e.truncated,
  };
}

export interface ReportShape {
  summary: Summary;
  truncated: boolean;
  issues: Issue[];
  caveat: string;
  extraction?: ExtractionInfo;
}

export function shapeReport(
  result: QuickCheckResult,
  opts?: { truncated?: boolean; detectedTotal?: number; extraction?: ExtractionInfo },
): ReportShape {
  const summary = summarize(result.citations);
  const detectedTotal = opts?.detectedTotal ?? opts?.extraction?.detected;
  if (detectedTotal != null) summary.total = detectedTotal;
  const out: ReportShape = {
    summary,
    truncated: opts?.truncated ?? opts?.extraction?.truncated ?? false,
    issues: toIssues(result.citations),
    caveat: opts?.extraction ? CAVEAT_DOCUMENT : CAVEAT_NOT_FOUND,
  };
  if (opts?.extraction) out.extraction = opts.extraction;
  return out;
}
