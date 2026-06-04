// List markers cap at 3 digits so a wrapped continuation line that starts with
// a 4-digit year (e.g. "1905. 17:891-921.") is not mistaken for a new entry.
const NUM_MARKER = /^\s*(?:\[\d{1,3}\]|\(\d{1,3}\)|\d{1,3}[.)])\s+/;

// A line that does NOT end in terminal punctuation is mid-sentence and almost
// certainly continues onto the next physical line.
const ENDS_OPEN = /[^.!?)\]"'’”]\s*$/;

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Split a bibliography block into one string per reference. */
export function segmentReferences(block: string): string[] {
  const lines = block.split(/\r?\n/);

  // 1. Numbered list ([1] / 1. / (1) at line start).
  const markerLines = lines.filter((l) => NUM_MARKER.test(l)).length;
  if (markerLines >= 2) {
    const entries: string[] = [];
    let cur: string[] = [];
    let seenMarker = false;
    for (const line of lines) {
      if (NUM_MARKER.test(line)) {
        if (cur.length) entries.push(collapse(cur.join(" ")));
        cur = [line.replace(NUM_MARKER, "")];
        seenMarker = true;
      } else if (seenMarker && line.trim()) {
        // Only accumulate continuation lines AFTER the first marker. Any prose
        // before the first marker (e.g. a lead-in like "The following references
        // were consulted:") is discarded so it never becomes a phantom entry.
        cur.push(line);
      }
    }
    if (cur.length) entries.push(collapse(cur.join(" ")));
    return entries.filter(Boolean);
  }

  // 2. Blank-line separated.
  const byBlank = block.split(/\r?\n\s*\r?\n/).map(collapse).filter(Boolean);
  if (byBlank.length >= 2) return byBlank;

  // 3. Un-numbered, single-spaced, no blank line between entries (APA/Harvard
  // hanging indent). A continuation line either is INDENTED (the hanging-indent
  // signal) or follows a previous line that did not close on terminal
  // punctuation (a mid-clause wrap). Either way it folds into the current entry
  // rather than splitting off as its own fragment — otherwise every wrapped
  // entry shatters into per-line fragments, each firing a doomed Crossref query.
  const nonBlank = lines.filter((l) => l.trim());
  // Strip the common leading whitespace shared by EVERY non-blank line. A
  // Word/PDF export sometimes indents the whole block uniformly; without this,
  // every line reads as "indented", so each one folds into entry 0 and the
  // block collapses to a single entry — failing the >= 2 guard and falling
  // through to path 4 (one physical line = one reference), which shatters any
  // wrapped entry into per-line fragments. Dedenting uniformly preserves the
  // hanging-indent signal (continuation lines stay indented RELATIVE to the
  // flush-left entry starts).
  const commonIndent =
    nonBlank.length === 0
      ? 0
      : Math.min(...nonBlank.map((l) => (l.match(/^[ \t]*/)?.[0].length ?? 0)));
  const dedented = nonBlank.map((l) => l.slice(commonIndent));
  const entries: string[] = [];
  let prevOpen = false;
  for (const line of dedented) {
    const indented = /^\s/.test(line);
    if (entries.length > 0 && (indented || prevOpen)) {
      entries[entries.length - 1] += " " + line;
    } else {
      entries.push(line);
    }
    prevOpen = ENDS_OPEN.test(line);
  }
  if (entries.length >= 2) return entries.map(collapse).filter(Boolean);

  // 4. Last resort: one line = one reference.
  return lines.map(collapse).filter(Boolean);
}
