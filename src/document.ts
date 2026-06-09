import { extractDocumentText, formatOf } from "./ingest/index.js";
import { locateBibliography } from "./references/locate-section.js";
import { segmentReferences } from "./references/segment.js";
import { checkFreeTextRef } from "./references/match.js";
import type { QuickCheckResult, CitationCheckResult } from "./quick-check.js";

export interface DocumentExtraction {
  format: "docx" | "txt" | "md";
  sectionFound: boolean;
  /** How many candidate references were FOUND (the true detected count, never capped). */
  referencesDetected: number;
  /** How many were actually CHECKED — equals referencesDetected unless truncated, then MAX_REFS. */
  referencesChecked: number;
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
export const MAX_REFS = 200;

/**
 * Reject inputs whose RAW (on-disk) byte size exceeds this, before any
 * extraction. checkDocument is a public library export, so this guard must live
 * here — not only in the CLI — or a direct caller has no input-size protection.
 *
 * Exported as the SINGLE source of truth for the byte limit: the CLI's pre-read
 * stat guard (cli.ts) imports this same constant so bumping the limit can never
 * leave the two guards out of sync.
 */
export const MAX_INPUT_BYTES = 10 * 1024 * 1024;

/**
 * Build the user-facing "file too large" message for the byte guard. Exported so
 * the CLI's pre-read guard and this library-level guard share one wording.
 * Returns PLAIN text (no color, no trailing newline) — callers add their own.
 */
export function tooLargeMessage(bytes: number): string {
  return `File too large to scan (${Math.round(bytes / (1024 * 1024))} MB) — extract the bibliography to a .bib/.ris/CSL-JSON file instead.`;
}

/**
 * Reject inputs whose extracted text exceeds this.
 *
 * NOTE: this is a post-extraction cap. The .docx ingester also has a
 * pre-extraction decompression-amplification guard (rejectIfZipBomb in
 * src/ingest/docx.ts) that inspects the ZIP central directory without
 * inflating data, bounding the uncompressed payload before mammoth runs.
 */
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
  if (input.bytes.length > MAX_INPUT_BYTES) {
    throw new Error(tooLargeMessage(input.bytes.length));
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
      referencesDetected: allRefs.length,
      referencesChecked: refs.length,
      confidence: located.confidence,
      truncated,
    },
    result: { citations, checkedAt: new Date().toISOString() },
  };
}
