import type { CrossrefWork } from "../crossref.js";
import { extractYear } from "../crossref.js";
import type { CheckVerdict } from "../quick-check.js";
import { normalizeTitle } from "../quick-check.js";

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
export function computeContainment(raw: string, candidate: CrossrefWork): Containment {
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

  const year = extractYear(candidate);
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
