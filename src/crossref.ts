import { userAgent, fetchRetry } from "./http.js";

const BASE_URL = "https://api.crossref.org";
const MAX_CONCURRENT = 15;
const REQUEST_SPACING_MS = 100;

export interface CrossrefAuthor {
  given?: string;
  family?: string;
}

export interface CrossrefUpdate {
  type: string;
  DOI: string;
  label?: string;
}

export interface CrossrefWork {
  DOI: string;
  title: string[];
  author?: CrossrefAuthor[];
  "container-title"?: string[];
  published?: { "date-parts"?: number[][] };
  type?: string;
  ISSN?: string[];
  "is-referenced-by-count"?: number;
  /** Present on a retraction/correction *notice*, pointing back at the original. */
  "update-to"?: CrossrefUpdate[];
  /** Present on the *original* work, pointing forward at its retraction/correction. */
  "updated-by"?: CrossrefUpdate[];
}

let inFlight = 0;

async function throttle(): Promise<void> {
  while (inFlight >= MAX_CONCURRENT) {
    await new Promise((r) => setTimeout(r, REQUEST_SPACING_MS));
  }
}

// Throws on a transient failure (429 / 5xx / network / timeout) so callers can
// distinguish "couldn't reach Crossref" from a definitive 404.
async function crossrefFetch(url: string): Promise<Response> {
  await throttle();
  inFlight++;
  try {
    return await fetchRetry(url, {
      headers: { "User-Agent": userAgent(), Accept: "application/json" },
      timeoutMs: 10_000,
    });
  } finally {
    inFlight--;
  }
}

/** Returns the work, `null` for a definitive miss (404), and THROWS if Crossref was unreachable. */
export async function checkDoi(doi: string): Promise<CrossrefWork | null> {
  const encoded = encodeURIComponent(doi.replace(/^https?:\/\/doi\.org\//, ""));
  const res = await crossrefFetch(`${BASE_URL}/works/${encoded}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { message?: CrossrefWork };
  return body.message ?? null;
}

/** Returns matches, `[]` for a definitive empty result, and THROWS if Crossref was unreachable. */
export async function searchByTitle(title: string, rows = 3): Promise<CrossrefWork[]> {
  const q = encodeURIComponent(title.slice(0, 200));
  const res = await crossrefFetch(`${BASE_URL}/works?query.bibliographic=${q}&rows=${rows}`);
  if (!res.ok) return [];
  const body = (await res.json()) as { message?: { items?: CrossrefWork[] } };
  return body.message?.items ?? [];
}

export function extractYear(work: CrossrefWork): number | undefined {
  return work.published?.["date-parts"]?.[0]?.[0];
}

export function isRetracted(work: CrossrefWork): boolean {
  // Crossref marks a retracted original under `updated-by`; a retraction
  // *notice* carries `update-to`. Check both so either record flags it.
  const links = [...(work["update-to"] ?? []), ...(work["updated-by"] ?? [])];
  if (links.some((u) => u.type === "retraction" || u.label?.toLowerCase().includes("retract"))) {
    return true;
  }
  // Crossref also prefixes retracted titles, e.g. "RETRACTED: …" /
  // "RETRACTED ARTICLE: …". The colon keeps this from matching papers that
  // merely study retractions.
  return (work.title ?? []).some((t) => /^\s*retracted(\s+article)?\s*:/i.test(t));
}
