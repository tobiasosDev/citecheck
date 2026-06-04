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

/** Publication-TYPE words that are almost never distinctive on their own. A
 * candidate title made entirely of these ("Original research article", "Case
 * report") carries no identifying signal, so matching them must NOT count toward
 * the anti-inversion distinctiveness floor. These are post-normalizeTitle,
 * lowercase forms. Deliberately TYPE words only — content-bearing words (study,
 * analysis, effects, results, role, impact, survey) are excluded because they
 * can legitimately distinguish a real title. */
const GENERIC_TITLE_TERMS = new Set(
  "case report reports original research article articles review reviews editorial editorials letter letters correspondence communication communications commentary comment comments erratum corrigendum retraction introduction preface foreword abstract note notes reply response addendum proceedings supplement chapter book poster news overview".split(
    " ",
  ),
);

export interface Containment {
  /** Fraction of the candidate's title content-words present in the raw reference. */
  titleContainment: number;
  /** Absolute count of candidate title content-words present in the raw reference. */
  matchedTitleTokens: number;
  /** Count of matched title content-words that are NOT generic publication-TYPE
   * words. A count-only floor can't tell a distinctive short title from a generic
   * one ("Original research article" = 3 generic tokens); this counts only the
   * tokens that actually carry identifying signal. */
  distinctiveMatchedTokens: number;
  /** Total count of candidate title content-words (after stopword/digit filtering). */
  titleTokenCount: number;
  /** Candidate's first-author surname present in the raw reference. */
  surnameHit: boolean;
  /** Candidate's publication year present in the raw reference. */
  yearHit: boolean;
  /** A DOI in the raw reference exactly matches the candidate's DOI. */
  doiHit: boolean;
}

/** Matches a DOI anywhere in free text. The path component runs until whitespace
 * or a quote/angle-bracket so a trailing `.`/`,`/`)` stays attached and is
 * stripped separately (DOIs may legitimately contain `.` and `)`). */
const DOI_RE = /10\.\d{4,9}\/[^\s"'<>]+/i;

/** Lowercase a DOI and strip a trailing run of sentence punctuation. */
function normDoi(doi: string): string {
  return doi.toLowerCase().replace(/[.,;:)\]]+$/, "");
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
  let distinctiveHit = 0;
  for (const t of titleTokens) {
    if (rawTokens.has(t)) {
      hit++;
      if (!GENERIC_TITLE_TERMS.has(t)) distinctiveHit++;
    }
  }
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
  // Blank out any DOI substring BEFORE the year test. A DOI's path component can
  // contain a 4-digit run that coincides with the candidate year (e.g.
  // `doi:10.1234/2019.x`), which the standalone-date regex below would otherwise
  // accept as a spurious yearHit — manufacturing a corroborating signal from an
  // identifier, not a date. Replacing the DOI with a space leaves real date forms
  // (`(2019).`, `1953;171:`, ` 1953 `) untouched.
  const rawForYear = raw.replace(/10\.\d{4,9}\/[^\s]+/gi, " ");
  // Accept the candidate year only as a STANDALONE 4-digit run, never as the
  // endpoint of a numeric range. The lookbehind/lookahead exclude an adjacent
  // digit AND the dash family (ASCII hyphen plus U+2012–U+2015: figure/en/em
  // dash, horizontal bar — the en dash is the typographically standard range
  // separator in real bibliographies). Without this, a page range
  // (`pp. 2015–2019`, `1949-1953`) or a volume:page span (`171:1953-1960`)
  // would manufacture a spurious yearHit from a coincidental 4-digit run,
  // corroborating a weak title overlap and flipping a fabricated reference from
  // partial_match to "verified". Real date forms — `(2019).`, `1953;171:`,
  // `1905.`, ` 1953 ` — are unaffected.
  const yearHit =
    year != null &&
    new RegExp(`(?<![\\d\\-\\u2012-\\u2015])${year}(?![\\d\\-\\u2012-\\u2015])`).test(rawForYear);

  // An exact DOI match is the strongest identity signal a free-text reference can
  // carry: it points at one specific record. Extract the first DOI from the raw
  // reference, normalize both sides (lowercase, strip a `https?://(dx.)?doi.org/`
  // prefix off the candidate, strip trailing sentence punctuation off the raw),
  // and set doiHit on an exact match.
  const rawDoiMatch = raw.match(DOI_RE);
  const candidateDoi = candidate.DOI
    ? normDoi(candidate.DOI.replace(/^https?:\/\/(dx\.)?doi\.org\//i, ""))
    : "";
  const doiHit = rawDoiMatch != null && candidateDoi !== "" && normDoi(rawDoiMatch[0]) === candidateDoi;

  return {
    titleContainment: Math.round(titleContainment * 100) / 100,
    matchedTitleTokens: hit,
    distinctiveMatchedTokens: distinctiveHit,
    titleTokenCount: titleTokens.length,
    surnameHit,
    yearHit,
    doiHit,
  };
}

/**
 * Map containment to a verdict. Thresholds are a calibrated starting point; the
 * binding principle is that containment must be high enough to REJECT Crossref's
 * weak best-guesses (so a fabricated reference resolves to not_found).
 */
export function verdictFor(c: Containment, candidateHasYear: boolean): CheckVerdict {
  const yearOk = c.yearHit || !candidateHasYear;
  // An exact DOI match to the record Crossref returned is conclusive: a DOI names
  // one specific work, so a surname hit on top of it leaves no plausible room for
  // a coincidental collision. This short-circuits ahead of the title checks.
  if (c.doiHit && c.surnameHit) return "verified";
  // Title-only path. A short/generic candidate title ("Case report", "Original
  // research article", "Book review") saturates titleContainment to 1.0 on a few
  // shared publication-TYPE words that any fabricated reference might
  // coincidentally include — so surname + year is NOT enough to verify against
  // such a candidate. A bare matched-token COUNT can't tell a distinctive short
  // title from a generic one: "Original research article" is 3 matched tokens but
  // zero identifying signal. The floor is therefore on DISTINCTIVE matched tokens
  // (those NOT in GENERIC_TITLE_TERMS). Requiring at least TWO distinctive tokens
  // keeps genuine short titles verified — "Zur Elektrodynamik bewegter Körper"
  // has 3 distinctive tokens (zur is a stopword), Vaswani/Watson have 4 — while
  // rejecting all-generic fabrications ("Case report", "Original research
  // article" both have 0 distinctive tokens, so they cap at partial_match).
  const enoughTitleTokens = c.distinctiveMatchedTokens >= 2;
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
