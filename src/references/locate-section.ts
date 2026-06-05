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

/**
 * Lowercased heading label with Markdown markers, any leading section number
 * ("6.", "6)", "6") and trailing punctuation stripped. Markdown ATX markers
 * ("## References") and surrounding emphasis ("**References**", "_References_")
 * are removed first so the dominant Markdown heading styles normalize to the
 * bare label — ".md" is a first-class supported input format.
 */
function headingLabel(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s*/, "") // Markdown ATX heading marker ("## References")
    .replace(/^[*_]{1,3}\s*/, "") // leading emphasis ("**References**", "_References_")
    .replace(/\s*[*_]{1,3}$/, "") // trailing emphasis
    .replace(/^[0-9]+[.)]?\s+/, "") // "6. References", "## 6. References"
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
