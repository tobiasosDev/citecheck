/** CSL JSON name part (Zotero / CSL 1.0). */
export interface CslName {
  family?: string;
  given?: string;
}

/** CSL JSON date object (subset; we only read `date-parts`). */
export interface CslDate {
  "date-parts"?: (string | number)[][];
}

/**
 * Subset of CSL JSON fields citecheck reads. The index signature lets
 * callers pass richer CSL items (e.g. exported straight from Zotero)
 * without stripping fields citecheck does not model.
 */
export interface CslItemData {
  DOI?: string;
  title?: string;
  author?: CslName[];
  issued?: CslDate;
  [key: string]: unknown;
}
