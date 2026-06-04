import { extractDocumentText, formatOf } from "./ingest/index.js";
import { locateBibliography } from "./references/locate-section.js";
import { segmentReferences } from "./references/segment.js";
import { checkFreeTextRef } from "./references/match.js";
import type { QuickCheckResult, CitationCheckResult } from "./quick-check.js";

export interface DocumentExtraction {
  format: "docx" | "txt" | "md";
  sectionFound: boolean;
  referencesDetected: number;
  confidence: "high" | "low";
  /** True when more than MAX_REFS candidates were found and only the first MAX_REFS were checked. */
  truncated: boolean;
}

export interface CheckDocumentResult {
  extraction: DocumentExtraction;
  result: QuickCheckResult;
}

/**
 * Upper bound on candidate references actually checked, to cap outbound HTTP.
 * Each reference fires a Crossref search plus (on a match) OpenAlex + DOAJ
 * lookups, so an unbounded count is a hang / self-rate-limit / abuse vector.
 */
const MAX_REFS = 200;

/** Reject inputs whose extracted text exceeds this (also caps .docx zip-bomb amplification). */
const MAX_TEXT_CHARS = 5_000_000;

/**
 * Extract references from a whole document and run the existence check on each.
 * Extraction (text → locate → segment) is local; only reference strings leave
 * the machine (Crossref/OpenAlex/DOAJ). The document body is never sent or stored.
 */
export async function checkDocument(
  input: { bytes: Uint8Array; filename: string },
): Promise<CheckDocumentResult> {
  const format = formatOf(input.filename);
  if (format === null) {
    throw new Error(`Unsupported document format: ${input.filename}`);
  }
  const text = await extractDocumentText(input);
  if (text.trim().length === 0) {
    throw new Error(`No text could be extracted from ${input.filename}`);
  }
  if (text.length > MAX_TEXT_CHARS) {
    throw new Error(
      `Document too large to scan (${Math.round(text.length / 1_000_000)} MB of text) — extract the bibliography to a .bib/.ris/CSL-JSON file instead.`,
    );
  }

  const located = locateBibliography(text);
  const allRefs = segmentReferences(located.text);

  // On the low-confidence path (no recognized heading) the "block" is the whole
  // document, segmented one-line-per-reference. A high count there means we
  // scanned prose, not a real bibliography — refuse rather than fire thousands
  // of API calls line by line.
  if (!located.sectionFound && allRefs.length > MAX_REFS) {
    throw new Error(
      `No bibliography heading found and the document is too long to scan line-by-line (${allRefs.length} candidate references). Add a "References" heading, or extract the bibliography to a .bib/.ris/CSL-JSON file.`,
    );
  }

  // On the high-confidence path a long bibliography (e.g. a systematic review)
  // is legitimate — cap and warn rather than refuse.
  const truncated = allRefs.length > MAX_REFS;
  const refs = truncated ? allRefs.slice(0, MAX_REFS) : allRefs;

  const citations: CitationCheckResult[] = [];
  const batchSize = 10;
  for (let i = 0; i < refs.length; i += batchSize) {
    const batch = refs.slice(i, i + batchSize);
    citations.push(...(await Promise.all(batch.map(checkFreeTextRef))));
  }

  return {
    extraction: {
      format,
      sectionFound: located.sectionFound,
      referencesDetected: refs.length,
      confidence: located.confidence,
      truncated,
    },
    result: { citations, checkedAt: new Date().toISOString() },
  };
}
