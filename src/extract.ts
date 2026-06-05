/**
 * Pure bibliography-extraction primitives, with ZERO heavy dependencies.
 *
 * This entry point exists so consumers (e.g. a web app) can locate and segment a
 * bibliography from text they already have — sharing citecheck's heading
 * vocabulary, back-matter stop logic and segmentation — WITHOUT pulling in the
 * Node-only `mammoth` .docx reader that the main `.` entry reaches through
 * `checkDocument`. `locate-section` and `segment` import nothing, so importing
 * from `citecheck/extract` keeps a browser/edge bundle free of `mammoth`.
 */
export { locateBibliography } from "./references/locate-section.js";
export type { LocatedSection } from "./references/locate-section.js";
export { segmentReferences } from "./references/segment.js";
