// List markers cap at 3 digits so a wrapped continuation line that starts with
// a 4-digit year (e.g. "1905. 17:891-921.") is not mistaken for a new entry.
const NUM_MARKER = /^\s*(?:\[\d{1,3}\]|\(\d{1,3}\)|\d{1,3}[.)])\s+/;

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
  // hanging indent). A continuation line is recognised ONLY by being INDENTED
  // relative to the dedented entry starts (the hanging-indent signal); it then
  // folds into the current entry instead of splitting off as its own fragment.
  // The earlier "previous line did not end on terminal punctuation" heuristic was
  // dropped: it merged any entry whose previous line ended on a non-terminal char
  // (e.g. ref 1 ending in a bare page count) into the next, gluing a following
  // REAL reference onto it and reporting the conjoined string as fabricated — a
  // damaging false alarm. Indent-only is the conservative signal.
  const nonBlank = lines.filter((l) => l.trim());
  // Strip the common leading whitespace shared by EVERY non-blank line. A
  // Word/PDF export sometimes indents the whole block uniformly; without this,
  // every line reads as "indented", so each one folds into entry 0 and the
  // block collapses to a single entry — failing the >= 2 guard and falling
  // through to path 4 (one physical line = one reference), which shatters any
  // wrapped entry into per-line fragments. Dedenting uniformly preserves the
  // hanging-indent signal (continuation lines stay indented RELATIVE to the
  // flush-left entry starts).
  // Use a reduce (not Math.min(...spread)): spreading a large array passes every
  // element as a separate function argument, which throws RangeError ("Maximum
  // call stack size exceeded") on engines like V8 once the count exceeds the
  // argument limit (~125k). A heading-less document with that many non-blank,
  // non-numbered, single-spaced lines reaches this path under the existing size
  // guards, so the spread would crash segmentation before document.ts can refuse.
  const commonIndent =
    nonBlank.length === 0
      ? 0
      : nonBlank.reduce((m, l) => Math.min(m, l.match(/^[ \t]*/)?.[0].length ?? 0), Infinity);
  const dedented = nonBlank.map((l) => l.slice(commonIndent));
  const entries: string[] = [];
  for (const line of dedented) {
    const indented = /^\s/.test(line);
    if (entries.length > 0 && indented) {
      entries[entries.length - 1] += " " + line;
    } else {
      entries.push(line);
    }
  }
  if (entries.length >= 2) return entries.map(collapse).filter(Boolean);

  // 4. Last resort: one line = one reference.
  return lines.map(collapse).filter(Boolean);
}
