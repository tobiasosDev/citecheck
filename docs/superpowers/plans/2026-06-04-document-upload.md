# Document Upload & Reference Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let citecheck accept a whole document (`.docx`, `.txt`/`.md`), extract its bibliography, and run the existence check on each reference.

**Architecture:** Four new stages — extract text → locate the bibliography block → segment into reference strings → match each free-text reference to Crossref and decide a verdict by **asymmetric containment** (how much of the candidate's identifying tokens appear in the raw reference). The free-text path produces the existing `CitationCheckResult` shape but does **not** reuse `checkSingle` (which self-verifies a candidate's own DOI and would stamp every reference, including fakes, as `verified`). The structured `.bib`/`.ris`/`.json` engine is untouched.

**Tech Stack:** TypeScript (NodeNext ESM, `strict`, `verbatimModuleSyntax`), `bun:test`, `mammoth` (new dep, `.docx` → text), Crossref/OpenAlex/DOAJ public APIs (no key).

**Spec:** `docs/superpowers/specs/2026-06-04-document-upload-design.md`
**Branch:** `add-document-upload` (already created)

**Conventions (read once):**
- ESM imports use the `.js` extension even for `.ts` files (NodeNext). Tests import from `../src/x.js`.
- `verbatimModuleSyntax` is on → import types with `import type { ... }`, values with `import { ... }`.
- `noUncheckedIndexedAccess` is on → array indexing yields `T | undefined`; use `!` only where a length check guarantees presence (existing code does this).
- Tests: `import { test, expect } from "bun:test";` — see `test/quick-check.test.ts` for style.

---

## File Structure

```
src/
  ingest/
    types.ts            Ingester interface
    text.ts             textIngester — .txt/.md passthrough (utf8)
    docx.ts             docxIngester — mammoth.extractRawText
    index.ts            extractDocumentText() + formatOf() registry/dispatch
  references/
    locate-section.ts   locateBibliography() — EN+DE headings, last-match, whole-doc fallback
    segment.ts          segmentReferences() — numbered → blank-line → one-line
    match.ts            computeContainment(), verdictFor(), checkFreeTextRef()
  crossref.ts           + searchByBibliographic()        [MODIFY]
  quick-check.ts        + sourceRef on CitationCheckResult [MODIFY]
  document.ts           checkDocument() orchestrator
  index.ts              export checkDocument             [MODIFY]
  cli.ts                dispatch documents → checkDocument [MODIFY]
test/
  crossref.test.ts      searchByBibliographic
  match.test.ts         containment + verdict (incl. anti-inversion guard)
  match-network.test.ts checkFreeTextRef (mocked fetch)
  locate-section.test.ts
  segment.test.ts
  ingest.test.ts        text + docx (mocked mammoth) + registry
  document.test.ts      checkDocument integration (mocked fetch, .txt)
package.json            + dependency: mammoth            [MODIFY]
README.md               document-upload usage + privacy  [MODIFY]
```

---

## Task 1: `searchByBibliographic` in crossref.ts

Crossref's `query.bibliographic` already powers `searchByTitle`, but that helper truncates to 200 chars (fine for a title, too short for a full reference). Add a sibling that takes the whole reference string.

**Files:**
- Modify: `src/crossref.ts` (add after `searchByTitle`, around line 72)
- Test: `test/crossref.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// test/crossref.test.ts
import { test, expect, afterEach } from "bun:test";
import { searchByBibliographic } from "../src/crossref.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test("searchByBibliographic queries query.bibliographic with the full string (no 200-char cap)", async () => {
  let captured = "";
  globalThis.fetch = (async (url: string | URL) => {
    captured = String(url);
    return new Response(
      JSON.stringify({ message: { items: [{ DOI: "10.1/x", title: ["Hit"] }] } }),
      { status: 200 },
    );
  }) as typeof fetch;

  const longRef = "Author A. " + "lorem ipsum dolor ".repeat(20) + "(2020)."; // > 200 chars
  const items = await searchByBibliographic(longRef, 5);

  expect(items.length).toBe(1);
  expect(items[0]!.DOI).toBe("10.1/x");
  expect(captured).toContain("query.bibliographic=");
  expect(captured).toContain("rows=5");
  const sent = decodeURIComponent(captured.split("query.bibliographic=")[1]!.split("&")[0]!);
  expect(sent.length).toBeGreaterThan(200); // proves it was not truncated to 200
});

test("searchByBibliographic returns [] on a definitive non-OK response", async () => {
  globalThis.fetch = (async () => new Response("nope", { status: 404 })) as typeof fetch;
  expect(await searchByBibliographic("anything")).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/crossref.test.ts`
Expected: FAIL — `searchByBibliographic` is not exported.

- [ ] **Step 3: Add the function**

In `src/crossref.ts`, add immediately after `searchByTitle` (after line 72):

```ts
/**
 * Match a full free-text reference string via Crossref's fuzzy bibliographic
 * search. Unlike `searchByTitle`, it does NOT cap at 200 chars (a whole
 * reference is longer than a title). Returns matches, `[]` for a definitive
 * empty result, and THROWS if Crossref was unreachable.
 */
export async function searchByBibliographic(reference: string, rows = 5): Promise<CrossrefWork[]> {
  const q = encodeURIComponent(reference.replace(/\s+/g, " ").trim().slice(0, 500));
  const res = await crossrefFetch(`${BASE_URL}/works?query.bibliographic=${q}&rows=${rows}`);
  if (!res.ok) return [];
  const body = (await res.json()) as { message?: { items?: CrossrefWork[] } };
  return body.message?.items ?? [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/crossref.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/crossref.ts test/crossref.test.ts
git commit -m "feat(crossref): add searchByBibliographic for full free-text references"
```

---

## Task 2: Add `sourceRef` to `CitationCheckResult`

The free-text path needs to carry the raw reference string each verdict came from. One optional field; no behavior change for the structured engine.

**Files:**
- Modify: `src/quick-check.ts:13-32` (the `CitationCheckResult` interface)

- [ ] **Step 1: Add the field**

In `src/quick-check.ts`, inside `interface CitationCheckResult`, add after `warnings: string[];`:

```ts
  warnings: string[];
  /** Set on the document/free-text path: the raw reference string this verdict came from. */
  sourceRef?: string;
```

- [ ] **Step 2: Verify the build still compiles**

Run: `bun run build`
Expected: PASS (no errors). Existing tests unaffected: `bun test` → all green.

- [ ] **Step 3: Commit**

```bash
git add src/quick-check.ts
git commit -m "feat(types): add optional sourceRef to CitationCheckResult"
```

---

## Task 3: Asymmetric-containment scoring (pure) — `references/match.ts`

The verdict core, as **pure functions** so the make-or-break logic is tested hermetically (no network). `computeContainment` measures how much of the candidate's identifying tokens appear in the raw reference; `verdictFor` maps that to a verdict.

**Files:**
- Create: `src/references/match.ts`
- Test: `test/match.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// test/match.test.ts
import { test, expect } from "bun:test";
import { computeContainment, verdictFor } from "../src/references/match.js";
import type { CrossrefWork } from "../src/crossref.js";

const watson: CrossrefWork = {
  DOI: "10.1038/171737a0",
  title: ["Molecular structure of nucleic acids"],
  author: [{ family: "Watson" }, { family: "Crick" }],
  published: { "date-parts": [[1953]] },
};

test("computeContainment: a faithful reference contains the candidate's tokens", () => {
  const raw = "Watson JD, Crick FHC. Molecular structure of nucleic acids. Nature. 1953;171:737-738.";
  const c = computeContainment(raw, watson);
  expect(c.titleContainment).toBe(1);
  expect(c.surnameHit).toBe(true);
  expect(c.yearHit).toBe(true);
});

test("computeContainment: a fabricated reference does NOT contain the candidate's tokens", () => {
  const raw = "Phantom A. Quantum entanglement of bibliographic ghosts. J Imaginary Studies. 2021;9:1-9.";
  const c = computeContainment(raw, watson);
  expect(c.titleContainment).toBeLessThan(0.45);
  expect(c.surnameHit).toBe(false);
  expect(c.yearHit).toBe(false);
});

test("verdictFor: high containment + surname + year => verified", () => {
  expect(verdictFor({ titleContainment: 1, surnameHit: true, yearHit: true }, true)).toBe("verified");
});

test("verdictFor: strong title but missing surname => partial_match", () => {
  expect(verdictFor({ titleContainment: 0.9, surnameHit: false, yearHit: true }, true)).toBe("partial_match");
});

test("verdictFor: low containment => not_found (anti-inversion guard)", () => {
  expect(verdictFor({ titleContainment: 0.1, surnameHit: false, yearHit: false }, true)).toBe("not_found");
});

test("verdictFor: candidate without a year does not require a year hit", () => {
  expect(verdictFor({ titleContainment: 0.8, surnameHit: true, yearHit: false }, false)).toBe("verified");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/match.test.ts`
Expected: FAIL — module/exports not found.

- [ ] **Step 3: Write `src/references/match.ts` (pure parts only)**

```ts
import type { CrossrefWork } from "../crossref.js";
import { extractYear } from "../crossref.js";
import type { CheckVerdict } from "../quick-check.js";
import { normalizeTitle } from "../quick-check.js";

/** Common low-signal words (EN + a few DE) dropped before measuring title containment. */
const STOPWORDS = new Set(
  "a an the of and or in on for to with from by as at is are be this that into via using its their de der die das und von zur zum".split(
    " ",
  ),
);

export interface Containment {
  /** Fraction of the candidate's title content-words present in the raw reference. */
  titleContainment: number;
  /** Candidate's first-author surname present in the raw reference. */
  surnameHit: boolean;
  /** Candidate's publication year present in the raw reference. */
  yearHit: boolean;
}

/** Measure how much of the candidate's identifying tokens appear in `raw`. Pure. */
export function computeContainment(raw: string, candidate: CrossrefWork): Containment {
  const rawNorm = normalizeTitle(raw);
  const rawTokens = new Set(rawNorm.split(" ").filter(Boolean));

  const titleTokens = [
    ...new Set(
      normalizeTitle(candidate.title?.[0]).split(" ").filter((w) => w && !STOPWORDS.has(w)),
    ),
  ];
  let hit = 0;
  for (const t of titleTokens) if (rawTokens.has(t)) hit++;
  const titleContainment = titleTokens.length === 0 ? 0 : hit / titleTokens.length;

  const surname = (candidate.author?.[0]?.family ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const surnameHit = surname.length > 0 && rawTokens.has(surname);

  const year = extractYear(candidate);
  const yearHit = year != null && new RegExp(`(?<!\\d)${year}(?!\\d)`).test(raw);

  return {
    titleContainment: Math.round(titleContainment * 100) / 100,
    surnameHit,
    yearHit,
  };
}

/**
 * Map containment to a verdict. Thresholds are a calibrated starting point; the
 * binding principle is that containment must be high enough to REJECT Crossref's
 * weak best-guesses (so a fabricated reference resolves to not_found).
 */
export function verdictFor(c: Containment, candidateHasYear: boolean): CheckVerdict {
  const yearOk = c.yearHit || !candidateHasYear;
  if (c.titleContainment >= 0.7 && c.surnameHit && yearOk) return "verified";
  if (c.titleContainment >= 0.45) return "partial_match";
  return "not_found";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/match.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/references/match.ts test/match.test.ts
git commit -m "feat(match): asymmetric-containment scoring and verdict (pure)"
```

---

## Task 4: `checkFreeTextRef` — the network path in `references/match.ts`

Wraps the pure scoring with the Crossref search and the retraction/DOAJ/OpenAlex enrichment, producing a `CitationCheckResult`. Critically: it routes through `searchByBibliographic` + containment, **never** through `checkSingle` — and it does **not** enrich a `not_found` (a rejected guess is not the user's reference).

**Files:**
- Modify: `src/references/match.ts` (append)
- Test: `test/match-network.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// test/match-network.test.ts
import { test, expect, afterEach } from "bun:test";
import { checkFreeTextRef } from "../src/references/match.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function route(handler: (u: string) => unknown) {
  globalThis.fetch = (async (url: string | URL) => {
    const body = handler(String(url));
    return new Response(JSON.stringify(body ?? {}), { status: 200 });
  }) as typeof fetch;
}

const watsonItem = {
  DOI: "10.1038/171737a0",
  title: ["Molecular structure of nucleic acids"],
  author: [{ family: "Watson" }, { family: "Crick" }],
  published: { "date-parts": [[1953]] },
  ISSN: ["0028-0836"],
};

test("a faithful reference verifies", async () => {
  route((u) => {
    if (u.includes("crossref")) return { message: { items: [watsonItem] } };
    if (u.includes("openalex")) return { cited_by_count: 9000, is_oa: false, primary_location: { source: { display_name: "Nature" } } };
    if (u.includes("doaj")) return { total: 0 };
    return {};
  });
  const r = await checkFreeTextRef("Watson JD, Crick FHC. Molecular structure of nucleic acids. Nature. 1953;171:737-738.");
  expect(r.status).toBe("verified");
  expect(r.sourceRef).toContain("Watson");
  expect(r.crossrefMatch?.doi).toBe("10.1038/171737a0");
});

test("a fabricated reference whose nearest Crossref guess is a real paper => not_found", async () => {
  route((u) => {
    // Crossref returns its nearest guess (a real, unrelated paper) for the fake string.
    if (u.includes("crossref")) return { message: { items: [watsonItem] } };
    return {};
  });
  const r = await checkFreeTextRef("Phantom A. Quantum entanglement of bibliographic ghosts. J Imaginary Studies. 2021;9:1-9.");
  expect(r.status).toBe("not_found");
  expect(r.openalexMatch).toBeNull(); // a rejected guess is NOT enriched
});

test("no Crossref candidates => not_found", async () => {
  route((u) => (u.includes("crossref") ? { message: { items: [] } } : {}));
  const r = await checkFreeTextRef("Anything at all 2020");
  expect(r.status).toBe("not_found");
});

test("Crossref unreachable => check_failed", async () => {
  globalThis.fetch = (async () => { throw new Error("network down"); }) as typeof fetch;
  const r = await checkFreeTextRef("Watson JD. Molecular structure of nucleic acids. 1953.");
  expect(r.status).toBe("check_failed");
});

test("a retracted matched work is flagged", async () => {
  route((u) => {
    if (u.includes("crossref")) return { message: { items: [{ ...watsonItem, title: ["RETRACTED: Molecular structure of nucleic acids"] }] } };
    if (u.includes("doaj")) return { total: 0 };
    return {};
  });
  const r = await checkFreeTextRef("Watson JD, Crick FHC. Molecular structure of nucleic acids. Nature. 1953;171:737-738.");
  expect(r.retracted).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/match-network.test.ts`
Expected: FAIL — `checkFreeTextRef` not exported.

- [ ] **Step 3: Append the network path to `src/references/match.ts`**

Add these imports at the top (alongside the existing ones):

```ts
import type { CitationCheckResult } from "../quick-check.js";
import * as crossref from "../crossref.js";
import * as openalex from "../openalex.js";
import { checkByIssn } from "../doaj.js";
```

Append at the end of the file:

```ts
/** Check a single free-text reference string. Produces a CitationCheckResult. */
export async function checkFreeTextRef(raw: string): Promise<CitationCheckResult> {
  const result: CitationCheckResult = {
    key: "",
    title: "",
    status: "not_found",
    crossrefMatch: null,
    openalexMatch: null,
    journalStatus: "unknown",
    retracted: false,
    warnings: [],
    sourceRef: raw,
  };

  let candidates: CrossrefWork[];
  try {
    candidates = await crossref.searchByBibliographic(raw, 5);
  } catch {
    result.status = "check_failed";
    result.warnings.push("Could not reach Crossref — re-run to check this reference.");
    return result;
  }

  if (candidates.length === 0) {
    result.warnings.push("No matching record in Crossref — this reference may be fabricated.");
    return result;
  }

  const candidate = candidates[0]!;
  const cont = computeContainment(raw, candidate);
  const candidateHasYear = extractYear(candidate) != null;
  result.status = verdictFor(cont, candidateHasYear);
  result.title = candidate.title?.[0] ?? "";
  result.crossrefMatch = {
    doi: candidate.DOI,
    title: candidate.title?.[0],
    titleSimilarity: cont.titleContainment,
    authorOverlap: cont.surnameHit ? 1 : 0,
    yearMatch: cont.yearHit,
  };

  // A rejected best-guess is not the user's reference — do not enrich it.
  if (result.status === "not_found") {
    result.warnings.push("Closest Crossref record does not match this reference — it may be fabricated.");
    return result;
  }

  if (result.status === "partial_match") {
    if (cont.titleContainment < 0.7) {
      result.warnings.push("Reference text only partially matches the closest Crossref record.");
    }
    if (!cont.yearHit && candidateHasYear) {
      result.warnings.push("Publication year not found in the reference text.");
    }
  }

  if (crossref.isRetracted(candidate)) {
    result.retracted = true;
    result.warnings.push("This work has been retracted.");
  }

  const issns = candidate.ISSN ?? [];
  if (issns.length > 0) {
    result.journalStatus = await checkByIssn(issns[0]!);
  }

  if (candidate.DOI) {
    const oa = await openalex.lookupByDoi(candidate.DOI);
    if (oa) {
      result.openalexMatch = {
        citedByCount: oa.cited_by_count,
        isOa: oa.is_oa,
        journalName: oa.primary_location?.source?.display_name,
      };
      if (oa.primary_location?.source?.is_in_doaj === true) {
        result.journalStatus = "doaj_listed";
      }
    }
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/match-network.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/references/match.ts test/match-network.test.ts
git commit -m "feat(match): checkFreeTextRef — free-text reference verdict via Crossref"
```

---

## Task 5: Locate the bibliography section — `references/locate-section.ts`

Find the references block by heading (EN + DE), preferring the **last** match, stopping at a known following section (Appendix/Acknowledgements/etc.), with a whole-document low-confidence fallback.

**Files:**
- Create: `src/references/locate-section.ts`
- Test: `test/locate-section.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// test/locate-section.test.ts
import { test, expect } from "bun:test";
import { locateBibliography } from "../src/references/locate-section.js";

test("finds an English References heading and returns the block after it", () => {
  const doc = ["Intro text", "more body", "", "References", "[1] A", "[2] B"].join("\n");
  const s = locateBibliography(doc);
  expect(s.sectionFound).toBe(true);
  expect(s.confidence).toBe("high");
  expect(s.heading).toBe("References");
  expect(s.text).toContain("[1] A");
  expect(s.text).not.toContain("Intro text");
});

test("finds a German Literaturverzeichnis heading", () => {
  const doc = ["Einleitung", "", "Literaturverzeichnis", "Müller, K. (2020). Titel."].join("\n");
  const s = locateBibliography(doc);
  expect(s.heading).toBe("Literaturverzeichnis");
  expect(s.text).toContain("Müller");
});

test("prefers the LAST matching heading", () => {
  const doc = ["see references below", "References", "early false hit", "body", "References", "[1] Real"].join("\n");
  const s = locateBibliography(doc);
  expect(s.text).toContain("[1] Real");
  expect(s.text).not.toContain("early false hit");
});

test("matches a numbered heading like '6. References'", () => {
  const doc = ["body", "6. References", "[1] X"].join("\n");
  const s = locateBibliography(doc);
  expect(s.sectionFound).toBe(true);
  expect(s.text).toContain("[1] X");
});

test("stops at a following section heading (Appendix)", () => {
  const doc = ["References", "[1] Real ref", "Appendix", "raw appendix prose"].join("\n");
  const s = locateBibliography(doc);
  expect(s.text).toContain("[1] Real ref");
  expect(s.text).not.toContain("appendix prose");
});

test("no heading => whole document, low confidence", () => {
  const doc = "just some text with no bibliography heading at all";
  const s = locateBibliography(doc);
  expect(s.sectionFound).toBe(false);
  expect(s.confidence).toBe("low");
  expect(s.heading).toBeNull();
  expect(s.text).toBe(doc);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/locate-section.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/references/locate-section.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/locate-section.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/references/locate-section.ts test/locate-section.test.ts
git commit -m "feat(references): locate bibliography section (EN+DE, last-match, fallback)"
```

---

## Task 6: Segment the block into references — `references/segment.ts`

Split the bibliography block into one string per reference: numbered markers first, then blank-line separation, then one-line-per-reference as a last resort.

**Files:**
- Create: `src/references/segment.ts`
- Test: `test/segment.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// test/segment.test.ts
import { test, expect } from "bun:test";
import { segmentReferences } from "../src/references/segment.js";

test("numbered list: splits on [n], strips the marker, joins wrapped lines", () => {
  const block = [
    "[1] Watson JD, Crick FHC. Molecular structure of",
    "    nucleic acids. Nature. 1953.",
    "[2] Smith J. Deep learning. 2021.",
    "[3] García M. Hallucinated refs. 2023.",
  ].join("\n");
  const refs = segmentReferences(block);
  expect(refs.length).toBe(3);
  expect(refs[0]).toBe("Watson JD, Crick FHC. Molecular structure of nucleic acids. Nature. 1953.");
  expect(refs[1]).toContain("Deep learning");
});

test("also handles '1.' and '(1)' markers", () => {
  expect(segmentReferences("1. First ref.\n2. Second ref.").length).toBe(2);
  expect(segmentReferences("(1) First ref.\n(2) Second ref.").length).toBe(2);
});

test("blank-line separated entries", () => {
  const block = "Müller, K. (2020). Titel eins.\n\nJones, P. (2019). Title two.";
  const refs = segmentReferences(block);
  expect(refs.length).toBe(2);
  expect(refs[0]).toContain("Titel eins");
});

test("fallback: one line = one reference", () => {
  const block = "Ref one on a line.\nRef two on a line.\nRef three.";
  expect(segmentReferences(block).length).toBe(3);
});

test("empty block => no references", () => {
  expect(segmentReferences("   \n  ").length).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/segment.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/references/segment.ts`**

```ts
const NUM_MARKER = /^\s*(?:\[\d+\]|\(\d+\)|\d+[.)])\s+/;

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/segment.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/references/segment.ts test/segment.test.ts
git commit -m "feat(references): segment a bibliography block into reference strings"
```

---

## Task 7: Ingester interface + text ingester — `ingest/types.ts`, `ingest/text.ts`

**Files:**
- Create: `src/ingest/types.ts`, `src/ingest/text.ts`
- Test: `test/ingest.test.ts` (create — this file grows in Tasks 8 & 9)

- [ ] **Step 1: Write the failing test**

```ts
// test/ingest.test.ts
import { test, expect } from "bun:test";
import { textIngester } from "../src/ingest/text.js";

test("textIngester handles .txt and .md, not .docx", () => {
  expect(textIngester.canHandle("a.txt", new Uint8Array())).toBe(true);
  expect(textIngester.canHandle("a.md", new Uint8Array())).toBe(true);
  expect(textIngester.canHandle("a.docx", new Uint8Array())).toBe(false);
});

test("textIngester decodes utf8 bytes", async () => {
  const bytes = new TextEncoder().encode("Grüße — héllo");
  expect(await textIngester.extractText(bytes)).toBe("Grüße — héllo");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/ingest.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the files**

```ts
// src/ingest/types.ts
export interface Ingester {
  canHandle(filename: string, bytes: Uint8Array): boolean;
  /** Whole-document plain text. */
  extractText(bytes: Uint8Array): Promise<string>;
}
```

```ts
// src/ingest/text.ts
import type { Ingester } from "./types.js";

export const textIngester: Ingester = {
  canHandle(filename: string): boolean {
    return /\.(txt|md|markdown)$/i.test(filename);
  },
  async extractText(bytes: Uint8Array): Promise<string> {
    return new TextDecoder("utf-8").decode(bytes);
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/ingest.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ingest/types.ts src/ingest/text.ts test/ingest.test.ts
git commit -m "feat(ingest): Ingester interface and text (.txt/.md) ingester"
```

---

## Task 8: docx ingester + `mammoth` dependency — `ingest/docx.ts`

**Files:**
- Modify: `package.json` (add `mammoth`)
- Create: `src/ingest/docx.ts`
- Modify: `test/ingest.test.ts` (append docx tests)

- [ ] **Step 1: Add the dependency**

Run: `bun add mammoth`
Expected: `mammoth` appears under `dependencies` in `package.json` and installs cleanly.

- [ ] **Step 2: Write the failing test (append to `test/ingest.test.ts`)**

```ts
import { mock } from "bun:test";

test("docxIngester.canHandle requires .docx extension AND zip magic bytes", async () => {
  const { docxIngester } = await import("../src/ingest/docx.js");
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  expect(docxIngester.canHandle("a.docx", zip)).toBe(true);
  expect(docxIngester.canHandle("a.docx", new Uint8Array([0, 0, 0, 0]))).toBe(false);
  expect(docxIngester.canHandle("a.txt", zip)).toBe(false);
});

test("docxIngester extracts raw text via mammoth", async () => {
  mock.module("mammoth", () => ({
    extractRawText: async (_input: unknown) => ({ value: "Hello from docx", messages: [] }),
  }));
  const { docxIngester } = await import("../src/ingest/docx.js");
  const out = await docxIngester.extractText(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
  expect(out).toBe("Hello from docx");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test test/ingest.test.ts`
Expected: FAIL — `../src/ingest/docx.js` not found.

- [ ] **Step 4: Write `src/ingest/docx.ts`**

```ts
import * as mammoth from "mammoth";
import type { Ingester } from "./types.js";

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04" — a .docx is a ZIP container

export const docxIngester: Ingester = {
  canHandle(filename: string, bytes: Uint8Array): boolean {
    if (!/\.docx$/i.test(filename)) return false;
    return ZIP_MAGIC.every((b, i) => bytes[i] === b);
  },
  async extractText(bytes: Uint8Array): Promise<string> {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return value;
  },
};
```

- [ ] **Step 5: Verify the build, then the tests**

Run: `bun run build`
Expected: PASS. If (and only if) it errors with *"Could not find a declaration file for module 'mammoth'"*, create `src/mammoth.d.ts` with:

```ts
declare module "mammoth" {
  export function extractRawText(input: { buffer: Buffer }): Promise<{ value: string; messages: unknown[] }>;
}
```
…then re-run `bun run build`.

Run: `bun test test/ingest.test.ts`
Expected: PASS (4 tests total in the file).

- [ ] **Step 6: Commit**

`bun add` updates the lockfile (`bun.lockb`, or `package-lock.json` if that is what the repo tracks) — stage whichever one changed, shown by `git status --short`:

```bash
git add package.json src/ingest/docx.ts test/ingest.test.ts
git add src/mammoth.d.ts            # only if Step 5 required creating it
git add bun.lockb package-lock.json # stage whichever lockfile git status shows as changed
git commit -m "feat(ingest): docx ingester via mammoth"
```

---

## Task 9: Ingester registry + dispatch — `ingest/index.ts`

**Files:**
- Create: `src/ingest/index.ts`
- Modify: `test/ingest.test.ts` (append)

- [ ] **Step 1: Write the failing test (append to `test/ingest.test.ts`)**

```ts
import { extractDocumentText, formatOf } from "../src/ingest/index.js";

test("formatOf maps extensions", () => {
  expect(formatOf("a.docx")).toBe("docx");
  expect(formatOf("a.md")).toBe("md");
  expect(formatOf("a.markdown")).toBe("md");
  expect(formatOf("a.txt")).toBe("txt");
  expect(formatOf("a.pdf")).toBeNull();
});

test("extractDocumentText routes a .txt through the text ingester", async () => {
  const bytes = new TextEncoder().encode("hello doc");
  expect(await extractDocumentText({ bytes, filename: "x.txt" })).toBe("hello doc");
});

test("extractDocumentText throws on an unsupported format", async () => {
  await expect(
    extractDocumentText({ bytes: new Uint8Array(), filename: "x.pdf" }),
  ).rejects.toThrow(/unsupported/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/ingest.test.ts`
Expected: FAIL — `../src/ingest/index.js` not found.

- [ ] **Step 3: Write `src/ingest/index.ts`**

```ts
import type { Ingester } from "./types.js";
import { textIngester } from "./text.js";
import { docxIngester } from "./docx.js";

const INGESTERS: Ingester[] = [docxIngester, textIngester];

export function formatOf(filename: string): "docx" | "txt" | "md" | null {
  if (/\.docx$/i.test(filename)) return "docx";
  if (/\.(md|markdown)$/i.test(filename)) return "md";
  if (/\.txt$/i.test(filename)) return "txt";
  return null;
}

export async function extractDocumentText(
  input: { bytes: Uint8Array; filename: string },
): Promise<string> {
  const ingester = INGESTERS.find((ing) => ing.canHandle(input.filename, input.bytes));
  if (!ingester) {
    throw new Error(`Unsupported document format: ${input.filename}`);
  }
  return ingester.extractText(input.bytes);
}

export type { Ingester } from "./types.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/ingest.test.ts`
Expected: PASS (7 tests total in the file).

- [ ] **Step 5: Commit**

```bash
git add src/ingest/index.ts test/ingest.test.ts
git commit -m "feat(ingest): format registry and dispatch (extractDocumentText)"
```

---

## Task 10: Orchestrator — `document.ts` + integration test

Tie the stages together: extract → locate → segment → check each reference (batched like `quickCheck`). The integration test exercises the full pipeline with a `.txt` fixture and a **mocked fetch**, asserting the anti-inversion guard end-to-end.

**Files:**
- Create: `src/document.ts`
- Test: `test/document.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// test/document.test.ts
import { test, expect, afterEach } from "bun:test";
import { checkDocument } from "../src/document.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const watsonItem = {
  DOI: "10.1038/171737a0",
  title: ["Molecular structure of nucleic acids"],
  author: [{ family: "Watson" }, { family: "Crick" }],
  published: { "date-parts": [[1953]] },
  ISSN: ["0028-0836"],
};

test("checkDocument: real reference verifies, fabricated reference is not_found", async () => {
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes("api.crossref.org")) {
      // Crossref returns the same real paper as nearest guess for BOTH refs.
      return new Response(JSON.stringify({ message: { items: [watsonItem] } }), { status: 200 });
    }
    if (u.includes("api.openalex.org")) {
      return new Response(JSON.stringify({ cited_by_count: 9000, is_oa: false, primary_location: { source: { display_name: "Nature" } } }), { status: 200 });
    }
    if (u.includes("doaj.org")) {
      return new Response(JSON.stringify({ total: 0 }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const doc = [
    "Introduction",
    "Body text citing prior work.",
    "",
    "References",
    "[1] Watson JD, Crick FHC. Molecular structure of nucleic acids. Nature. 1953;171:737-738.",
    "[2] Phantom A. Quantum entanglement of bibliographic ghosts. J Imaginary Studies. 2021;9:1-9.",
  ].join("\n");

  const out = await checkDocument({ bytes: new TextEncoder().encode(doc), filename: "thesis.txt" });

  expect(out.extraction.format).toBe("txt");
  expect(out.extraction.sectionFound).toBe(true);
  expect(out.extraction.confidence).toBe("high");
  expect(out.extraction.referencesDetected).toBe(2);
  expect(out.result.citations[0]!.status).toBe("verified");
  expect(out.result.citations[1]!.status).toBe("not_found");
  expect(out.result.citations[0]!.sourceRef).toContain("Watson");
});

test("checkDocument throws when no text can be extracted", async () => {
  await expect(
    checkDocument({ bytes: new TextEncoder().encode("   "), filename: "empty.txt" }),
  ).rejects.toThrow(/no text/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/document.test.ts`
Expected: FAIL — `../src/document.js` not found.

- [ ] **Step 3: Write `src/document.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/document.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/document.ts test/document.test.ts
git commit -m "feat: checkDocument orchestrator (extract → locate → segment → check)"
```

---

## Task 11: Export the public API — `index.ts`

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add exports**

Append to `src/index.ts`:

```ts
export { checkDocument } from "./document.js";
export type { CheckDocumentResult, DocumentExtraction } from "./document.js";
```

- [ ] **Step 2: Verify build**

Run: `bun run build`
Expected: PASS. Confirm `dist/index.d.ts` now declares `checkDocument`.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: export checkDocument from the package entrypoint"
```

---

## Task 12: CLI — accept documents

Dispatch `.docx`/`.txt`/`.md` files (not stdin `-`) to `checkDocument`; print the extraction summary (honest count + privacy note), the per-reference rows (numbered `#1…#N`, showing the candidate title or the raw `sourceRef`), and reuse the existing Summary line + exit codes. The structured `.bib`/`.ris`/`.json` path and stdin behavior are preserved by factoring today's `main` body into `runStructured`.

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add imports**

At the top of `src/cli.ts`, alongside the existing imports, add:

```ts
import { readFile } from "node:fs/promises";          // already imported — do not duplicate
import { checkDocument } from "./document.js";
```
(`readFile` is already imported at line 2; only add the `checkDocument` import.)

- [ ] **Step 2: Add the document row renderer**

Add after the existing `renderRow` function:

```ts
function renderDocRow(r: CitationCheckResult, index: number): string {
  const v = VERDICT[r.status];
  const num = `#${index}`.padEnd(5);
  const shown = r.title?.trim() ? truncate(r.title, 60) : dim(truncate(r.sourceRef ?? "", 60));
  const flag = r.retracted ? " " + red(bold("⚠ RETRACTED")) : "";
  const head = `  ${v.paint(v.sym)}  ${v.paint(v.label.padEnd(12))} ${dim(num)} ${shown}${flag}`;
  const src = r.sourceRef ? "\n" + dim("       ↳ " + truncate(r.sourceRef, 80)) : "";
  const notes = r.warnings.length ? "\n" + r.warnings.map((w) => dim("       ↳ " + w)).join("\n") : "";
  const doaj = r.journalStatus === "doaj_listed" ? "\n" + dim("       ↳ journal listed in DOAJ (open access)") : "";
  return head + src + notes + doaj;
}
```

- [ ] **Step 3: Factor the shared summary out of `main`**

Add this helper (it contains the exact counting/printing logic currently inlined in `main`, lines ~168-198, plus the exit-code computation):

```ts
function writeSummaryAndExitCode(citations: CitationCheckResult[], json: boolean): number {
  const counts = {
    verified: 0, partial_match: 0, not_found: 0, suspicious: 0, check_failed: 0,
    retracted: 0, doajListed: 0,
  };
  for (const r of citations) {
    counts[r.status]++;
    if (r.retracted) counts.retracted++;
    if (r.journalStatus === "doaj_listed") counts.doajListed++;
  }
  if (!json) {
    const segments = [
      green(`${counts.verified} verified`),
      yellow(`${counts.partial_match} partial`),
      red(`${counts.not_found} not found`),
      magenta(`${counts.suspicious} suspicious`),
      counts.retracted ? red(bold(`${counts.retracted} retracted`)) : dim(`0 retracted`),
    ];
    if (counts.check_failed) segments.push(dim(`${counts.check_failed} check failed`));
    process.stdout.write("\n" + bold("Summary: ") + segments.join(dim(" · ")) + "\n");
    if (counts.doajListed) process.stdout.write(dim(`         ${counts.doajListed} in DOAJ (open access)\n`));
    if (counts.check_failed) process.stdout.write(dim(`         ${counts.check_failed} could not be checked (network) — re-run\n`));
  }
  return counts.not_found > 0 || counts.suspicious > 0 || counts.retracted > 0 ? 1 : 0;
}
```

- [ ] **Step 4: Rename today's `main` body to `runStructured` and use the helper**

Take the current `main()` body **from the `let text: string;` line through the end of the summary block** and move it into a new function `async function runStructured(args: Args): Promise<number>`. Replace its inlined counts/summary block (the part you just copied into `writeSummaryAndExitCode`) with:

```ts
  return writeSummaryAndExitCode(result.citations, args.json);
```

So `runStructured` reads: read input → `detectAndParse` → (empty guard) → `quickCheck` → render rows (unchanged) → `return writeSummaryAndExitCode(result.citations, args.json);`

**Important (type narrowing):** the `if (!args.file)` guard stays in `main`, so across the function boundary `args.file` is `string | undefined` inside `runStructured`. Change the moved `readInput(args.file)` call to `readInput(args.file!)` (mirroring `runDocument`'s `readFile(args.file!)`), or `bun run build` at Step 8 fails with TS2345.

- [ ] **Step 5: Add `runDocument`**

```ts
const DOC_EXT = /\.(docx|txt|md|markdown)$/i;

async function runDocument(args: Args): Promise<number> {
  let bytes: Uint8Array;
  try {
    bytes = await readFile(args.file!);
  } catch (err) {
    process.stderr.write(red(`Could not read ${args.file}: ${(err as Error).message}\n`));
    return 2;
  }

  let doc;
  try {
    process.stderr.write(dim(`Extracting references from ${args.file}…\n`));
    doc = await checkDocument({ bytes, filename: args.file! });
  } catch (err) {
    process.stderr.write(red(`${(err as Error).message}\n`));
    return 2;
  }

  const { extraction, result } = doc;
  if (result.citations.length === 0) {
    process.stderr.write(red("No references detected in the document.\n"));
    return 2;
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(doc, null, 2) + "\n");
    return writeSummaryAndExitCode(result.citations, true);
  }

  const n = result.citations.length;
  if (extraction.sectionFound) {
    process.stdout.write("\n" + dim(`Detected ${n} reference${n === 1 ? "" : "s"} in the bibliography — verify this matches your paper.\n`));
  } else {
    process.stdout.write("\n" + yellow(`No bibliography heading found — scanned the whole document (low confidence). Detected ${n} candidate reference${n === 1 ? "" : "s"} — verify this matches your paper.\n`));
  }
  process.stdout.write(dim("Only the reference text is sent to Crossref/OpenAlex/DOAJ — your document is never uploaded or stored.\n\n"));

  const visible = result.citations
    .map((r, i) => ({ r, i: i + 1 }))
    .filter(({ r }) => !args.onlyIssues || r.status !== "verified" || r.retracted);

  if (visible.length === 0) {
    process.stdout.write(dim("  (no issues — every reference checked out)\n"));
  } else {
    for (const { r, i } of visible) process.stdout.write(renderDocRow(r, i) + "\n");
  }

  return writeSummaryAndExitCode(result.citations, false);
}
```

- [ ] **Step 6: Add the dispatch in `main`**

`main()` keeps the help/version/no-file/mailto handling, then dispatches:

```ts
  if (args.mailto) process.env.CITECHECK_MAILTO = args.mailto;

  if (args.file !== "-" && DOC_EXT.test(args.file)) {
    return runDocument(args);
  }
  return runStructured(args);
```

- [ ] **Step 7: Update the HELP text**

In the `HELP` string, change the `<file>` description and add a line so documents are documented:

```text
  <file>   A .bib / .bibtex, .ris, or CSL-JSON (.json) bibliography export,
           OR a document to extract references from: .docx, .txt, .md.
           Pass "-" to read a bibliography export from stdin (auto-detects format).
```

- [ ] **Step 8: Build + smoke**

Run: `bun run build`
Expected: PASS.

Run: `node dist/cli.js --help`
Expected: help text shows the new `.docx/.txt/.md` line.

Create a throwaway fixture and run it (this hits the network — expect [1] verified, [2] not found):

```bash
printf 'References\n[1] Watson JD, Crick FHC. Molecular structure of nucleic acids. Nature. 1953;171:737-738.\n[2] Phantom A. Quantum entanglement of bibliographic ghosts. J Imaginary Studies. 2021.\n' > /tmp/cc-smoke.txt
node dist/cli.js /tmp/cc-smoke.txt
```
Expected: "Detected 2 references…", `#1` verified, `#2` not found; exit code 1.

- [ ] **Step 9: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): accept .docx/.txt/.md documents and print extraction summary"
```

---

## Task 13: README — usage + privacy

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a "Check a document" section**

Add a section to `README.md` (place it after the existing usage examples). Use this exact content, adjusting surrounding headings to match the file's style:

```markdown
## Check a whole document (no .bib needed)

Don't have a reference manager export? Point citecheck at the document itself:

```console
$ npx citecheck thesis.docx
  Detected 24 references in the bibliography — verify this matches your paper.
  Only the reference text is sent to Crossref/OpenAlex/DOAJ — your document is never uploaded or stored.

  ✓  verified     #1   Watson & Crick (1953) Molecular Structure of Nucleic Acids…
  ✗  not found    #12  Quantum Entanglement of Bibliographic Phantoms…   ← likely fabricated
  ⚠  retracted    #18  Wakefield et al. (1998) …
```

Supported formats: **`.docx`**, **`.txt`**, **`.md`** (PDF and LaTeX are planned). citecheck locates the
bibliography section (English and German headings), splits it into individual references, and runs the same
existence check used for `.bib`/`.ris`/CSL-JSON. It always prints the **detected count** so you can confirm it
matched your bibliography — segmentation of messy formatting is best-effort.

### Privacy

Text extraction, section location, and segmentation all happen **locally**. Only each **reference string** is
sent to the public scholarly APIs (Crossref, OpenAlex, DOAJ). Your document — often unpublished work — is
**never uploaded and never stored**.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document the document-upload feature and its privacy model"
```

---

## Task 14: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `bun test`
Expected: ALL tests pass (existing `parsers`/`quick-check` + new `crossref`, `match`, `match-network`, `locate-section`, `segment`, `ingest`, `document`).

- [ ] **Step 2: Build + smoke script**

Run: `bun run build && bun run smoke`
Expected: PASS (`--version` and `--help` both succeed).

- [ ] **Step 3: Confirm the structured path is unchanged**

Run: `node dist/cli.js examples/sample.bib`
Expected: behaves exactly as before this branch (a normal bibliography check).

- [ ] **Step 4: Final commit (only if anything is uncommitted)**

```bash
git status --short
# If clean, nothing to do. Otherwise stage the remaining files and commit.
```

---

## Self-Review

**Spec coverage (each spec section → task):**
- §3.1 asymmetric containment → Tasks 3, 4 ✓
- §3.2 mammoth direct dep → Task 8 ✓
- §3.3 heuristic segmentation + honest count → Task 6 (segment) + Task 12 (printed count) ✓
- §3.4 EN+DE headings → Task 5 ✓
- §5 match/verdict core (search → containment → verdict → enrich; not_found not enriched; regression guard) → Tasks 1, 3, 4 ✓
- §6 ingest (Ingester, docx, text, registry, zip sniff, unsupported error) → Tasks 7, 8, 9 ✓
- §7 locate-section (labels, last-match, fallback, confidence) → Task 5 ✓
- §8 segment (numbered → blank-line → one-line, count) → Task 6 ✓
- §9 checkDocument signature + batching → Task 10; public export → Task 11 ✓
- §10 CLI dispatch, extraction summary, sourceRef rows, --json, exit codes → Task 12 ✓
- §11 privacy (local extraction, only strings sent, printed + README) → Task 12 (printed note) + Task 13 ✓
- §12 error handling (unreadable/unsupported/zero-text/zero-refs/unreachable/low-confidence) → Tasks 9, 10, 12 ✓
- §13 testing (locate, segment, containment+regression guard, searchByBibliographic URL, ingest, integration) → Tasks 1, 3, 4, 5, 6, 7–9, 10 ✓
- §14 file plan → matches the File Structure section ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; the one conditional step (mammoth `.d.ts`) is concrete and gated on an exact error string. ✓

**Type/name consistency:** `searchByBibliographic(reference, rows)`, `computeContainment(raw, candidate) → Containment{titleContainment, surnameHit, yearHit}`, `verdictFor(c, candidateHasYear)`, `checkFreeTextRef(raw) → CitationCheckResult` (with `sourceRef`), `locateBibliography(text) → LocatedSection{text, heading, sectionFound, confidence}`, `segmentReferences(block) → string[]`, `Ingester{canHandle, extractText}`, `extractDocumentText(input)`, `formatOf(filename)`, `checkDocument(input) → {extraction, result}`. Names are consistent across all tasks. ✓

**Note for the implementer (calibration):** the containment thresholds in `verdictFor` (0.7 / 0.45) are a starting point. If Task 12's network smoke or real `.docx` testing shows a real reference landing in `partial_match` or a fake landing in `partial_match`/`verified`, tune the thresholds — but keep the regression-guard tests in `match.test.ts` green (fabricated → `not_found`).
