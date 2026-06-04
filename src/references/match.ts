import * as crossref from "../crossref.js";
import * as openalex from "../openalex.js";
import { checkByIssn } from "../doaj.js";
import { normalizeTitle, type CheckVerdict, type CitationCheckResult } from "../quick-check.js";

/** Common low-signal words (EN + a few DE) dropped before measuring title containment. */
const STOPWORDS = new Set(
  "a an the of and or in on for to with from by as at is are be this that into via using its their de der die das und von zur zum".split(
    " ",
  ),
);

export interface Containment {
  /** Fraction of the candidate's title content-words present in the raw reference. */
  titleContainment: number;
  /** Candidate's first-author surname present in the raw reference. */
  surnameHit: boolean;
  /** Candidate's publication year present in the raw reference. */
  yearHit: boolean;
}

/** Measure how much of the candidate's identifying tokens appear in `raw`. Pure. */
export function computeContainment(raw: string, candidate: crossref.CrossrefWork): Containment {
  const rawNorm = normalizeTitle(raw);
  const rawTokens = new Set(rawNorm.split(" ").filter(Boolean));

  const titleTokens = [
    ...new Set(
      normalizeTitle(candidate.title?.[0]).split(" ").filter((w) => w && !STOPWORDS.has(w)),
    ),
  ];
  let hit = 0;
  for (const t of titleTokens) if (rawTokens.has(t)) hit++;
  const titleContainment = titleTokens.length === 0 ? 0 : hit / titleTokens.length;

  const surnameParts = (candidate.author?.[0]?.family ?? "")
    .toLowerCase()
    .split(/\s+/)
    .map((p) => p.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);
  const surnameHit = surnameParts.length > 0 && surnameParts.every((p) => rawTokens.has(p));

  const year = crossref.extractYear(candidate);
  const yearHit = year != null && new RegExp(`(?<!\\d)${year}(?!\\d)`).test(raw);

  return {
    titleContainment: Math.round(titleContainment * 100) / 100,
    surnameHit,
    yearHit,
  };
}

/**
 * Map containment to a verdict. Thresholds are a calibrated starting point; the
 * binding principle is that containment must be high enough to REJECT Crossref's
 * weak best-guesses (so a fabricated reference resolves to not_found).
 */
export function verdictFor(c: Containment, candidateHasYear: boolean): CheckVerdict {
  const yearOk = c.yearHit || !candidateHasYear;
  if (c.titleContainment >= 0.7 && c.surnameHit && yearOk) return "verified";
  if (c.titleContainment >= 0.45) return "partial_match";
  return "not_found";
}

/** Check a single free-text reference string. Produces a CitationCheckResult. */
export async function checkFreeTextRef(raw: string): Promise<CitationCheckResult> {
  const result: CitationCheckResult = {
    key: "",
    title: "",
    status: "not_found",
    crossrefMatch: null,
    openalexMatch: null,
    journalStatus: "unknown",
    retracted: false,
    warnings: [],
    sourceRef: raw,
  };

  let candidates: crossref.CrossrefWork[];
  try {
    candidates = await crossref.searchByBibliographic(raw, 5);
  } catch {
    result.status = "check_failed";
    result.warnings.push("Could not reach Crossref — re-run to check this reference.");
    return result;
  }

  if (candidates.length === 0) {
    result.warnings.push("No matching record in Crossref — this reference may be fabricated.");
    return result;
  }

  const candidate = candidates[0]!;
  const cont = computeContainment(raw, candidate);
  const candidateHasYear = crossref.extractYear(candidate) != null;
  result.status = verdictFor(cont, candidateHasYear);
  result.title = candidate.title?.[0] ?? "";
  result.crossrefMatch = {
    doi: candidate.DOI,
    title: candidate.title?.[0],
    titleSimilarity: cont.titleContainment,
    authorOverlap: cont.surnameHit ? 1 : 0,
    yearMatch: cont.yearHit,
  };

  // A rejected best-guess is not the user's reference — do not enrich it.
  if (result.status === "not_found") {
    result.warnings.push("Closest Crossref record does not match this reference — it may be fabricated.");
    return result;
  }

  if (result.status === "partial_match") {
    // verdictFor returns partial_match only for 0.45 <= titleContainment < 0.7,
    // so the title always partially matches here.
    result.warnings.push("Reference text only partially matches the closest Crossref record.");
    if (!cont.yearHit && candidateHasYear) {
      result.warnings.push("Publication year not found in the reference text.");
    }
  }

  if (crossref.isRetracted(candidate)) {
    result.retracted = true;
    result.warnings.push("This work has been retracted.");
  }

  const issns = candidate.ISSN ?? [];
  if (issns.length > 0) {
    result.journalStatus = await checkByIssn(issns[0]!);
  }

  if (candidate.DOI) {
    const oa = await openalex.lookupByDoi(candidate.DOI);
    if (oa) {
      result.openalexMatch = {
        citedByCount: oa.cited_by_count,
        isOa: oa.is_oa,
        journalName: oa.primary_location?.source?.display_name,
      };
      if (oa.primary_location?.source?.is_in_doaj === true) {
        result.journalStatus = "doaj_listed";
      }
    }
  }

  return result;
}
