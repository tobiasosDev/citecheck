import type { CslItemData } from "./types.js";
import * as crossref from "./crossref.js";
import * as openalex from "./openalex.js";
import { checkByIssn, type DoajStatus } from "./doaj.js";

export type CheckVerdict =
  | "verified"
  | "partial_match"
  | "not_found"
  | "suspicious"
  | "check_failed";

export interface CitationCheckResult {
  key: string;
  title: string;
  status: CheckVerdict;
  crossrefMatch: {
    doi?: string;
    title?: string;
    titleSimilarity: number;
    authorOverlap: number;
    yearMatch: boolean;
  } | null;
  openalexMatch: {
    citedByCount?: number;
    isOa?: boolean;
    journalName?: string;
  } | null;
  journalStatus: DoajStatus;
  retracted: boolean;
  warnings: string[];
  /** Set on the document/free-text path: the raw reference string this verdict came from. */
  sourceRef?: string;
}

export interface QuickCheckResult {
  citations: CitationCheckResult[];
  checkedAt: string;
}

export function normalizeTitle(t: string | undefined): string {
  if (!t) return "";
  // NFKD decomposes accented letters into base + combining mark (ü -> u + ̈);
  // the Unicode-aware class then drops the combining marks (they are \p{M}, not
  // \p{L}/\p{N}) — folding diacritics for free while KEEPING non-Latin letters
  // (Cyrillic/Greek/CJK/Arabic). The ASCII-only /[^a-z0-9\s]/ this replaces
  // stripped every non-Latin character, leaving non-English titles with zero
  // tokens and wrongly flagged as fabricated. (Diacritic-DROPPED citation forms
  // like "Muller"/"Korper" now match "Müller"/"Körper"; digraph-EXPANDED forms
  // like "Mueller"/"Koerper" and non-decomposable letters like ß/Ł/Ø are out of
  // scope for this fold.)
  return t
    .normalize("NFKD")
    .toLowerCase()
    // Fold Latin/general diacritics (Combining Diacritical Marks block U+0300–U+036F
    // that NFKD split off) so "Müller" -> "muller". Targeted range, NOT a blanket
    // \p{M} strip, so combining marks that are semantic letters in their script
    // (Devanagari/Thai vowel signs, Arabic harakat) are preserved, not corrupted.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, "")  // keep letters, numbers, remaining marks; drop punctuation/symbols
    .replace(/\s+/g, " ")
    .trim();
}

export function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(" ").filter(Boolean));
  const setB = new Set(b.split(" ").filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  return intersection / (setA.size + setB.size - intersection);
}

function extractFamilyNames(authors: { family?: string; given?: string }[] | undefined): string[] {
  if (!authors) return [];
  return authors.map((a) => (a.family ?? "").toLowerCase()).filter(Boolean);
}

export function authorOverlapScore(
  sourceAuthors: { family?: string; given?: string }[] | undefined,
  crossrefAuthors: crossref.CrossrefAuthor[] | undefined,
): number {
  const src = extractFamilyNames(sourceAuthors);
  const cr = (crossrefAuthors ?? []).map((a) => (a.family ?? "").toLowerCase()).filter(Boolean);
  if (src.length === 0 && cr.length === 0) return 1;
  if (src.length === 0 || cr.length === 0) return 0;
  let matches = 0;
  for (const name of src) if (cr.includes(name)) matches++;
  return matches / Math.max(src.length, cr.length);
}

function getCitationYear(item: CslItemData): number | undefined {
  const parts = item.issued?.["date-parts"]?.[0];
  if (!parts?.[0]) return undefined;
  return typeof parts[0] === "number" ? parts[0] : parseInt(String(parts[0]), 10) || undefined;
}

async function checkSingle(item: CslItemData): Promise<CitationCheckResult> {
  const result: CitationCheckResult = {
    key: (item.id as string) ?? "",
    title: item.title ?? "",
    status: "not_found",
    crossrefMatch: null,
    openalexMatch: null,
    journalStatus: "unknown",
    retracted: false,
    warnings: [],
  };

  const srcTitle = normalizeTitle(item.title);
  const srcYear = getCitationYear(item);
  let crWork: crossref.CrossrefWork | null = null;
  let crossrefUnreachable = false;

  if (item.DOI) {
    try {
      crWork = await crossref.checkDoi(item.DOI);
    } catch {
      crossrefUnreachable = true;
    }
  }

  if (!crWork && !crossrefUnreachable && item.title) {
    try {
      const candidates = await crossref.searchByTitle(item.title);
      if (candidates.length > 0) {
        let bestSim = 0;
        for (const c of candidates) {
          const sim = jaccardSimilarity(srcTitle, normalizeTitle(c.title?.[0]));
          if (sim > bestSim) {
            bestSim = sim;
            crWork = c;
          }
        }
        if (bestSim < 0.3) crWork = null;
      }
    } catch {
      crossrefUnreachable = true;
    }
  }

  // Couldn't reach Crossref at all — say so instead of mislabelling a real
  // reference as "not found".
  if (!crWork && crossrefUnreachable) {
    result.status = "check_failed";
    result.warnings.push("Could not reach Crossref — re-run to check this reference.");
    return result;
  }

  if (crWork) {
    const crTitle = normalizeTitle(crWork.title?.[0]);
    const titleSim = jaccardSimilarity(srcTitle, crTitle);
    const authOverlap = authorOverlapScore(item.author, crWork.author);
    const crYear = crossref.extractYear(crWork);
    const yearMatch = srcYear != null && crYear != null ? srcYear === crYear : true;

    result.crossrefMatch = {
      doi: crWork.DOI,
      title: crWork.title?.[0],
      titleSimilarity: Math.round(titleSim * 100) / 100,
      authorOverlap: Math.round(authOverlap * 100) / 100,
      yearMatch,
    };

    if (crossref.isRetracted(crWork)) {
      result.retracted = true;
      result.warnings.push("This work has been retracted.");
    }

    if (titleSim >= 0.7 && authOverlap >= 0.5 && yearMatch) {
      result.status = "verified";
    } else if (titleSim >= 0.4 || authOverlap >= 0.3) {
      result.status = "partial_match";
      if (titleSim < 0.7) result.warnings.push("Title differs from Crossref record.");
      if (!yearMatch) result.warnings.push("Publication year mismatch.");
    } else {
      result.status = "suspicious";
      result.warnings.push("Found a Crossref record but metadata does not match well.");
    }

    const issns = crWork.ISSN ?? [];
    if (issns.length > 0) {
      result.journalStatus = await checkByIssn(issns[0]!);
    }
  }

  // Enrich with OpenAlex (citation count, open-access + DOAJ signal).
  let oaWork: openalex.OpenAlexWork | null = null;
  if (item.DOI) {
    oaWork = await openalex.lookupByDoi(item.DOI);
  } else if (crWork?.DOI) {
    oaWork = await openalex.lookupByDoi(crWork.DOI);
  }

  if (oaWork) {
    result.openalexMatch = {
      citedByCount: oaWork.cited_by_count,
      isOa: oaWork.is_oa,
      journalName: oaWork.primary_location?.source?.display_name,
    };
    if (oaWork.primary_location?.source?.is_in_doaj === true) {
      result.journalStatus = "doaj_listed";
    }
  }

  return result;
}

/** Check every reference against Crossref, OpenAlex and DOAJ. No API key needed. */
export async function quickCheck(items: CslItemData[]): Promise<QuickCheckResult> {
  const batchSize = 10;
  const results: CitationCheckResult[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(checkSingle));
    results.push(...batchResults);
  }

  return { citations: results, checkedAt: new Date().toISOString() };
}
