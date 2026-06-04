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
    for (const line of lines) {
      if (NUM_MARKER.test(line)) {
        if (cur.length) entries.push(collapse(cur.join(" ")));
        cur = [line.replace(NUM_MARKER, "")];
      } else if (line.trim()) {
        cur.push(line);
      }
    }
    if (cur.length) entries.push(collapse(cur.join(" ")));
    return entries.filter(Boolean);
  }

  // 2. Blank-line separated.
  const byBlank = block.split(/\r?\n\s*\r?\n/).map(collapse).filter(Boolean);
  if (byBlank.length >= 2) return byBlank;

  // 3. Last resort: one line = one reference.
  return lines.map(collapse).filter(Boolean);
}
