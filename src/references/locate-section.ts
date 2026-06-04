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

const STOP_HEADINGS = new Set([
  "appendix", "appendices", "anhang", "acknowledgements", "acknowledgments", "danksagung",
  "notes", "endnotes", "about the author", "about the authors",
]);

/** Lowercased label with any leading section number ("6.", "6)", "6") and trailing punctuation stripped. */
function headingLabel(line: string): string {
  return line
    .trim()
    .replace(/^[0-9]+[.)]?\s+/, "")
    .replace(/[.:]+$/, "")
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
