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
  /** Absolute count of candidate title content-words present in the raw reference. */
  matchedTitleTokens: number;
  /** Total count of candidate title content-words (after stopword/digit filtering). */
  titleTokenCount: number;
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
      normalizeTitle(candidate.title?.[0])
        .split(" ")
        // Drop stopwords AND pure-digit tokens: a number in a candidate title
        // (e.g. a year in "Global health 2020") would otherwise count as a
        // title-content token and be auto-satisfied by the reference's own
        // publication year/volume/page — inflating containment and letting a
        // fabricated ref clear the anti-inversion guard. A number must
        // corroborate via yearHit only, not double as a title-content token.
        .filter((w) => w && !STOPWORDS.has(w) && !/^\d+$/.test(w)),
    ),
  ];
  let hit = 0;
  for (const t of titleTokens) if (rawTokens.has(t)) hit++;
  const titleContainment = titleTokens.length === 0 ? 0 : hit / titleTokens.length;

  // Fold the surname through the SAME normalizer as the raw reference (rawTokens
  // also comes from normalizeTitle), so a diacritic-dropped citation ("Muller")
  // matches the candidate's accented form ("Müller"): NFKD folds ü -> u on both
  // sides. The old [^a-z0-9] strip DELETED accented letters ("Müller" -> "mller")
  // and broke the match, demoting faithful non-English citations.
  const surnameParts = normalizeTitle(candidate.author?.[0]?.family ?? "")
    .split(" ")
    .filter(Boolean);
  const surnameHit = surnameParts.length > 0 && surnameParts.every((p) => rawTokens.has(p));

  const year = crossref.extractYear(candidate);
  // Accept the candidate year only as a STANDALONE 4-digit run, never as the
  // endpoint of a numeric range. The lookbehind/lookahead exclude an adjacent
  // digit AND the dash family (ASCII hyphen plus U+2012–U+2015: figure/en/em
  // dash, horizontal bar — the en dash is the typographically standard range
  // separator in real bibliographies). Without this, a page range
  // (`pp. 2015–2019`, `1949-1953`) or a volume:page span (`171:1953-1960`)
  // would manufacture a spurious yearHit from a coincidental 4-digit run,
  // corroborating a weak title overlap and flipping a fabricated reference from
  // partial_match to "verified". Real date forms — `(2019).`, `1953;171:`,
  // `1905.`, ` 1953 ` — are unaffected. Residual (accepted, see review): a year
  // inside a DOI/URL like `10.1/2019.x` can still match.
  const yearHit =
    year != null && new RegExp(`(?<![\\d\\-\\u2012-\\u2015])${year}(?![\\d\\-\\u2012-\\u2015])`).test(raw);

  return {
    titleContainment: Math.round(titleContainment * 100) / 100,
    matchedTitleTokens: hit,
    titleTokenCount: titleTokens.length,
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
  // Absolute floor on matched title content-words. A single shared word
  // saturates titleContainment to 1.0 when the candidate's title has only one
  // content token (e.g. Crossref's abundant "Editorial", "Preface", "An
  // Obituary" notices) — so a fabricated ref reusing that one generic word plus
  // a colliding surname + year would clear ANY containment threshold. Requiring
  // at least two matched title content-words makes the title carry real
  // identifying signal before surname+year can corroborate it to "verified".
  // A faithful single-content-word title correctly drops to partial_match — the
  // conservative outcome for a fabrication-catcher.
  const enoughTitleTokens = c.matchedTitleTokens >= 2;
  if (enoughTitleTokens && c.titleContainment >= 0.7 && c.surnameHit && yearOk) return "verified";
  // Subtitle-drop tolerance: citations routinely omit a candidate's post-colon
  // subtitle, which drags titleContainment below 0.7 even for faithful refs
  // (e.g. Watson 1953 lands at ~0.67). Accept a lower bar ONLY when BOTH the
  // surname AND an explicit year hit independently corroborate — that double
  // signal is what keeps a fabricated ref's weak title overlap from verifying.
  if (enoughTitleTokens && c.titleContainment >= 0.5 && c.surnameHit && c.yearHit) return "verified";
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

  // A rejected best-guess is not the user's reference — do not enrich it, and
  // do not surface the rejected paper's title/match (the CLI would otherwise
  // headline a fabricated ref with a real paper's title). Show only sourceRef.
  if (result.status === "not_found") {
    result.title = "";
    result.crossrefMatch = null;
    // Suppress the fabrication warning when the candidate title yielded zero
    // extractable tokens (titleTokenCount === 0). That is a tokenizer limitation
    // — e.g. a script the normalizer cannot segment — NOT evidence of
    // fabrication, so asserting "may be fabricated" would falsely accuse a real
    // non-English citation.
    if (cont.titleTokenCount > 0) {
      result.warnings.push("Closest Crossref record does not match this reference — it may be fabricated.");
    } else {
      result.warnings.push("Could not verify this reference automatically — please check it manually.");
    }
    return result;
  }

  if (result.status === "partial_match") {
    // Reached when containment cleared 0.45 but the verified bar (high title
    // overlap, or moderate overlap with surname+year) was not met — so the
    // title genuinely only partially matches the closest record.
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
