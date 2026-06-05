export { quickCheck } from "./quick-check.js";
export type {
  QuickCheckResult,
  CitationCheckResult,
  CheckVerdict,
} from "./quick-check.js";
export { parseBib } from "./bib-parser.js";
export { parseRis } from "./ris-parser.js";
export { parseCslJson } from "./csl-json.js";
export type { CslItemData, CslName, CslDate } from "./types.js";
export type { DoajStatus } from "./doaj.js";
export { checkDocument } from "./document.js";
export type { CheckDocumentResult, DocumentExtraction } from "./document.js";
// Pure extraction primitives. Also available mammoth-free via the
// "citecheck/extract" subpath for browser/edge bundles.
export { locateBibliography } from "./references/locate-section.js";
export type { LocatedSection } from "./references/locate-section.js";
export { segmentReferences } from "./references/segment.js";
