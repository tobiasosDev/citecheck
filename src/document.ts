import { extractDocumentText, formatOf } from "./ingest/index.js";
import { locateBibliography } from "./references/locate-section.js";
import { segmentReferences } from "./references/segment.js";
import { checkFreeTextRef } from "./references/match.js";
import type { QuickCheckResult, CitationCheckResult } from "./quick-check.js";

export interface DocumentExtraction {
  format: string;
  sectionFound: boolean;
  referencesDetected: number;
  confidence: "high" | "low";
}

export interface CheckDocumentResult {
  extraction: DocumentExtraction;
  result: QuickCheckResult;
}

/**
 * Extract references from a whole document and run the existence check on each.
 * Extraction (text → locate → segment) is local; only reference strings leave
 * the machine (Crossref/OpenAlex/DOAJ). The document body is never sent or stored.
 */
export async function checkDocument(
  input: { bytes: Uint8Array; filename: string },
): Promise<CheckDocumentResult> {
  const format = formatOf(input.filename) ?? "unknown";
  const text = await extractDocumentText(input);
  if (text.trim().length === 0) {
    throw new Error(`No text could be extracted from ${input.filename}`);
  }

  const located = locateBibliography(text);
  const refs = segmentReferences(located.text);

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
    },
    result: { citations, checkedAt: new Date().toISOString() },
  };
}
