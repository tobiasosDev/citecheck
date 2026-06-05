export interface LocatedSection {
  /** The bibliography block text (or the whole document on fallback). */
  text: string;
  /** The matched heading as it appeared (trimmed), or null on fallback. */
  heading: string | null;
  sectionFound: boolean;
  confidence: "high" | "low";
}

const HEADINGS = new Set([
  "references", "reference list", "bibliography", "works cited", "literature cited", "sources",
  "literaturverzeichnis", "quellenverzeichnis", "quellen", "bibliografie", "bibliographie", "literatur",
]);

// Back-matter sections that follow the bibliography in a thesis. The forward
// scan ends the bibliography block at the FIRST of these after the references
// heading, so the list-of-tables, list-of-figures, abbreviation glossary,
// declaration of AI tools used, and authorship declaration are NOT swept into
// the bibliography and split into phantom one-line "references" (e.g. a German
// "Abkürzungsverzeichnis" would otherwise yield entries like "SCFA", "T1D";
// a "Hilfsmittelverzeichnis" would yield "ChatGPT 5.2", "Zotero"). Keys are
// stored diacritic-folded + lowercase to match headingLabel's normalization.
//
// Newly added keys are multi-word phrases or distinctive compounds; the few
// bare-word keys are limited to ones that never appear as reference-line content
// (appendix, anhang, notes, glossar/glossary, sperrvermerk, lebenslauf, …).
// Bare COMMON words (index, declaration, contents, funding, Erklärung, annexe, …)
// are EXCLUDED on purpose: a real reference can hard-wrap (.txt/.md/PDF text) so
// one standalone <=40-char line equals exactly that word, and isHeading would
// then truncate the bibliography and DROP every reference after it — a damaging
// false alarm far worse than letting a rare bare-headed junk section leak in.
// The asymmetry is the rule: a leaked junk section is recoverable, a dropped
// real reference is not. Keep additions to phrases/distinctive compounds.
const STOP_HEADINGS = new Set([
  "appendix", "appendices", "anhang", "anhange", "acknowledgements", "acknowledgments", "danksagung",
  "notes", "endnotes", "about the author", "about the authors",
  // German back-matter "...verzeichnis" lists (distinctive compounds).
  "tabellenverzeichnis", "abbildungsverzeichnis", "abkurzungsverzeichnis",
  "hilfsmittelverzeichnis", "symbolverzeichnis", "formelverzeichnis",
  "stichwortverzeichnis", "inhaltsverzeichnis", "glossar",
  "verzeichnis der abkurzungen", "verzeichnis der abbildungen", "verzeichnis der tabellen",
  // German declarations (distinctive compounds / phrases).
  "selbststandigkeitserklarung", "selbstandigkeitserklarung", "eigenstandigkeitserklarung",
  "eidesstattliche erklarung", "ehrenwortliche erklarung", "eidesstattliche versicherung",
  "versicherung an eides statt", "sperrvermerk", "lebenslauf",
  // English back-matter lists + declarations + journal-article tail blocks.
  "list of figures", "list of tables", "list of abbreviations", "list of symbols",
  "list of illustrations", "list of equations", "table of contents", "glossary",
  "declaration of authorship", "statement of authorship", "curriculum vitae",
  "supplementary material", "supplementary materials", "supporting information",
  "author contributions", "conflict of interest",
  // French back-matter (bibliographie is in HEADINGS, so French docs reach here).
  "liste des figures", "liste des tableaux", "liste des illustrations",
  "table des matieres", "declaration sur l'honneur",
]);

/**
 * Lowercased heading label with Markdown markers, any leading section number
 * ("6.", "6)", "6") and trailing punctuation stripped, and diacritics folded.
 * Markdown ATX markers ("## References") and surrounding emphasis
 * ("**References**", "_References_") are removed first so the dominant Markdown
 * heading styles normalize to the bare label — ".md" is a first-class supported
 * input format. Diacritic folding (NFKD + combining-mark strip) lets the ASCII
 * heading keys match accented German back-matter ("Abkürzungsverzeichnis" ->
 * "abkurzungsverzeichnis") and survive umlaut-stripping exports/OCR; the
 * existing HEADINGS/STOP keys are all ASCII, so folding shifts nothing they match.
 */
function headingLabel(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s*/, "") // Markdown ATX heading marker ("## References")
    .replace(/^[*_]{1,3}\s*/, "") // leading emphasis ("**References**", "_References_")
    .replace(/\s*[*_]{1,3}$/, "") // trailing emphasis
    .replace(/^[0-9]+[.)]?\s+/, "") // "6. References", "## 6. References"
    .replace(/[.:]+$/, "")
    .normalize("NFKD") // decompose accents so combining marks split off
    .replace(/\p{M}/gu, "") // drop combining diacritical marks (ä -> a)
    .trim()
    .toLowerCase();
}

function isHeading(line: string, set: Set<string>): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > 40) return false; // headings sit roughly alone on their line
  return set.has(headingLabel(line));
}

export function locateBibliography(text: string): LocatedSection {
  const lines = text.split(/\r?\n/);

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isHeading(lines[i]!, HEADINGS)) start = i; // keep the LAST match
  }
  if (start === -1) {
    return { text, heading: null, sectionFound: false, confidence: "low" };
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isHeading(lines[i]!, STOP_HEADINGS)) { end = i; break; }
  }

  return {
    text: lines.slice(start + 1, end).join("\n").trim(),
    heading: lines[start]!.trim(),
    sectionFound: true,
    confidence: "high",
  };
}
