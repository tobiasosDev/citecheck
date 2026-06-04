# citecheck — Document Upload & Reference Extraction

**Status:** Approved design / ready for implementation plan
**Date:** 2026-06-04
**Audience:** citecheck OSS maintainers (MIT) — shared core later reused by the Acurio web app

**One line:** Let citecheck accept a *whole document* (`.docx`, `.txt`/`.md` in v1) instead of only a
structured bibliography export, pull the references out, and run the existing existence check on each one.

---

## 1. Problem

citecheck's existence check (`quickCheck()` in `src/quick-check.ts`) already works and produces verdicts
`verified | partial_match | not_found | suspicious | check_failed` plus `retracted` and a DOAJ note. The gap
is **input format**: citecheck only accepts structured exports (`.bib`, `.ris`, CSL-JSON), so it requires the
user to already own a reference manager. The people with the sharpest pain do not:

- a student whose finished paper is a `.docx`,
- a teacher grading a student's document who wants the fake references flagged in seconds,
- a school evaluating "drop the document in, get the fakes flagged."

The detection engine is ready; the ingestion is missing. **This project builds the ingestion front door.**

---

## 2. Pipeline

```
document (.docx / .txt / .md)
  → [1] EXTRACT TEXT        plain text of the whole document
  → [2] LOCATE BIBLIOGRAPHY the "References / Literaturverzeichnis / …" block
  → [3] SEGMENT REFERENCES  list of individual reference strings
  → [4] MATCH + VERDICT     query.bibliographic → candidate → ASYMMETRIC CONTAINMENT verdict
  → CLI table + JSON (same QuickCheckResult shape, + sourceRef + extraction block)
```

Stages 1–4 are new. The existing structured-input engine (`quickCheck`/`checkSingle`) is **not modified** and
its `.bib`/`.ris`/`.json` path is untouched.

---

## 3. Resolved design decisions

These four decisions were settled during brainstorming and are binding for v1:

1. **Matching/verdict — asymmetric containment.** A free-text reference is verified by measuring how much of
   the *candidate's* identifying tokens are contained in the raw reference string — strong enough to **reject**
   Crossref's weak best-guesses. (See §5. This avoids the product-inverting bug described in §4.)
2. **Dependencies — direct, bundled.** `mammoth` is added as a normal dependency so `npx citecheck thesis.docx`
   works with zero friction. (`pdf-parse` arrives the same way in v2.) Both are pure-JS, no native build.
3. **Segmentation — heuristic-only + honest count.** Ship the heuristic splitters; never silently drop or
   merge; always print "detected N references — verify this matches your paper." anystyle/GROBID optional
   backend is deferred to v2.
4. **Languages — EN + DE in v1.** Section-heading detection recognizes English and German labels from the
   start (German is Acurio's home market; it is just a word list).

---

## 4. The bug this design must avoid (rationale for §5)

The naive plan — "take the top `query.bibliographic` candidate, wrap it (title/author/year/**DOI**) as a CSL
item, run `checkSingle`" — **inverts the product**:

- `checkSingle` sees `item.DOI` → `crossref.checkDoi(doi)` → returns the same record → titleSim = 1.0,
  authorOverlap = 1.0, yearMatch = true → **always `verified`.**
- `query.bibliographic` returns a ranked best guess for *any* string, including a hallucinated one.
- Net effect: a fabricated reference gets matched to Crossref's nearest real paper and stamped green — exactly
  the failure citecheck exists to catch.

Routing the raw string through `checkSingle` as `title` (no DOI) is not fatal but under-scores: `jaccardSimilarity`
is symmetric, and the raw string carries authors/year/journal/pages as noise tokens, diluting a real reference
below the `0.7` verified threshold (those thresholds are tuned for clean-title-vs-clean-title).

Therefore the free-text path needs its **own** verdict logic, evaluated independently — §5.

---

## 5. Matching + verdict core — `src/references/match.ts`

A dedicated free-text path. It reuses the low-level building blocks (`searchByBibliographic`,
`crossref.isRetracted`, OpenAlex/DOAJ lookups, and the exported scoring helpers) and produces the **same**
`CitationCheckResult` shape — but does **not** call `checkSingle`.

For each reference string `raw`:

1. `searchByBibliographic(raw, rows = 5)` → candidate `CrossrefWork[]`.
   - Empty result → verdict **`not_found`**.
   - Throws (Crossref unreachable) → verdict **`check_failed`** (re-run; does not affect exit code).
2. Take the top candidate. Normalize `raw` with the existing `normalizeTitle` tokenizer and compute the
   **containment of the candidate's identifying tokens inside `raw`**:
   - `titleContainment` = fraction of the candidate's title content-words (stopwords dropped) that appear in
     the normalized `raw` token set.
   - `surnameHit` = candidate's first-author family name appears in `raw` (lowercased).
   - `yearHit` = candidate's publication year (`crossref.extractYear`) appears in `raw`.
3. Map to a verdict. **Starting thresholds — to be calibrated against the test fixtures during implementation;
   the principle (containment must be high enough to reject weak guesses) is binding, the exact numbers are not:**
   - **`verified`**: `titleContainment ≥ 0.7` AND `surnameHit` AND (`yearHit` OR candidate has no year).
   - **`partial_match`**: `titleContainment ≥ 0.45` (weaker signal — e.g. title differs, year off, or surname
     missing). Attach a warning explaining which signal was weak.
   - **`not_found`**: below `0.45` → Crossref's best guess does not actually correspond to what the user wrote
     ⇒ treat as not found (likely fabricated or absent from Crossref).
   - `suspicious` is reserved for the gray zone where a candidate exists with conflicting signals; implementation
     may fold this into `partial_match` if calibration shows it adds noise.
4. Independent of containment, on the matched candidate: set `retracted` from `crossref.isRetracted`, and enrich
   `journalStatus` / `openalexMatch` via the candidate's DOI using the existing OpenAlex + DOAJ functions.
   (These describe the matched *real* work, so they are only meaningful when a candidate was matched.)
5. Populate `crossrefMatch` with the candidate's DOI/title and the computed scores for transparency in `--json`.

**Regression guard (mandatory test):** a plausible-but-fabricated reference string MUST resolve to `not_found`,
never `verified`. This is the anti-inversion test and is the single most important test in the suite.

`CitationCheckResult` gains one optional field: **`sourceRef?: string`** — the raw reference string the verdict
came from. No other changes to the existing result types.

---

## 6. Extraction — `src/ingest/`

```ts
interface Ingester {
  canHandle(filename: string, bytes: Uint8Array): boolean;
  extractText(bytes: Uint8Array): Promise<string>; // whole-document plain text
}
```

- `docx.ts` — `mammoth.extractRawText({ buffer })`. (v1)
- `text.ts` — `.txt`/`.md` passthrough, utf8 decode. Also the "paste raw text" target. (v1)
- `index.ts` — registry; dispatch by file extension, with a ZIP magic-byte sniff (`PK\x03\x04`) to confirm
  `.docx`. Unknown/unsupported format → throws a clear "unsupported format" error.
- v2 (out of scope here): `pdf.ts` (`pdf-parse`, best-effort, warn on 2-column/scanned), `tex.ts`.

---

## 7. Locate section — `src/references/locate-section.ts`

Heuristic, language-aware:

- Split the extracted text into lines. A line is a candidate heading if, case-insensitively and ignoring an
  optional leading number/punctuation prefix ("6.", "6 ", "6) "), it equals one of the known labels and is
  roughly alone on its line (short).
- Labels — **EN:** References, Bibliography, Works Cited, Literature Cited, Sources, Reference List.
  **DE:** Literaturverzeichnis, Quellenverzeichnis, Quellen, Bibliografie, Bibliographie, Literatur.
- Prefer the **last** matching heading (avoids in-text "references to prior work" false hits).
- Take everything from after that heading to the next heading-like line or EOF.
- **Fallback:** no heading found → treat the whole document as candidate text, set `sectionFound = false` and
  `confidence = "low"`. Otherwise `sectionFound = true`, `confidence = "high"`.

---

## 8. Segment — `src/references/segment.ts`

Turn the bibliography block into one-string-per-entry, trying in order of signal strength:

1. **Numbered lists** — `[1]`, `1.`, `(1)` at line start → split on the markers.
2. **Blank-line / hanging-indent** — entries separated by blank lines or a consistent indent.
3. **Last resort** — one line = one reference (and lower the confidence note).

Rules: never silently drop or merge. Always return the detected **count** so the CLI can print
"detected N references — verify this matches your paper." Segmentation accuracy is the known weak point; the
honest count is the mitigation.

---

## 9. Orchestrator + public API — `src/document.ts`, `src/index.ts`

```ts
export async function checkDocument(
  input: { bytes: Uint8Array; filename: string },
): Promise<{
  extraction: {
    format: string;            // "docx" | "txt" | "md"
    sectionFound: boolean;     // was a bibliography heading located?
    referencesDetected: number;
    confidence: "high" | "low";
  };
  result: QuickCheckResult;    // existing shape; each citation carries sourceRef
}>;
```

Flow: `ingest.extractText` → `locate-section` → `segment` → `match.ts` per reference (batched the same way
`quickCheck` batches, to respect Crossref throttling) → assemble `QuickCheckResult` + `extraction`.

Exported from `index.ts` so the web app (Acurio) can `import { checkDocument } from "citecheck"`.

---

## 10. CLI — `src/cli.ts`

- Dispatch by extension: `.bib`/`.bibtex`/`.ris`/`.json` → existing structured path (unchanged).
  `.docx`/`.txt`/`.md` → `checkDocument` path. stdin `-` keeps today's structured-format sniff (raw-text-stdin
  mode can come later).
- Before the verdict rows, print the extraction summary:
  - section found: `detected N references in "<heading>" — verify this matches your paper`
  - fallback: `no references heading found — scanned the whole document (low confidence). detected N references — verify this matches your paper`
- Reuse the existing row renderer; key column becomes `#1 … #N`; show the candidate title plus a truncated
  `sourceRef` snippet. Retraction / DOAJ / warnings render exactly as today.
- `--json` adds the top-level `extraction` block; per-citation `sourceRef` is included.
- Exit codes unchanged (0 = all clean; 1 = any not_found/suspicious/retracted; 2 = usage/read error).

---

## 11. Privacy (preserve exactly — it is a feature)

- Stages 1–3 (extraction, locate, segment) run **locally** (CLI on the user's machine; server-side and not
  persisted in the web app).
- Only the **reference strings** (stage 4) leave the machine, to Crossref / OpenAlex / DOAJ.
- The document body (often unpublished student work) is **never** sent anywhere or stored.
- State this in the CLI output and README — it is why a teacher can drop a student's paper in without an
  FERPA / data-protection problem.

---

## 12. Error handling

| Condition | Behavior |
|---|---|
| File unreadable | stderr message, exit 2 |
| Unsupported format | "unsupported format" message, exit 2 |
| Zero text extracted | "no text extracted from <file>" message, exit 2 |
| Zero references detected | message, exit 2 |
| Crossref unreachable for a reference | that reference → `check_failed` (does not change exit code) |
| Low-confidence extraction (whole-doc fallback) | run anyway; print the low-confidence warning prominently |

---

## 13. Testing (TDD)

**Unit**
- `locate-section`: finds EN heading; finds DE `Literaturverzeichnis`; prefers the **last** heading; handles a
  numbered heading ("6. References"); no-heading → whole-doc fallback with `confidence:"low"`.
- `segment`: numbered list; blank-line separated; one-line fallback; returns correct count in each.
- `match` containment verdict:
  - a real reference string → `verified`;
  - **a plausible-but-fabricated reference string → `not_found` (the anti-inversion regression guard)**;
  - a real-but-slightly-wrong reference (mistyped title/year) → `partial_match`;
  - empty Crossref result → `not_found`; Crossref throw → `check_failed`.
- `searchByBibliographic`: builds the correct URL and does not truncate at 200 chars.

**Ingest**
- `docx` fixture → expected text; `txt`/`md` passthrough.

**Integration**
- `checkDocument` on small `.docx` and `.txt` fixtures with known references, **http layer mocked** (no network
  in tests), asserting the `extraction` block and per-reference verdicts (including a fabricated entry that must
  come back `not_found`).

---

## 14. File-level plan

New / changed under `src/`:

```
src/
  ingest/
    types.ts            Ingester interface
    index.ts            registry + dispatch (extension + zip magic-byte sniff)
    docx.ts             mammoth.extractRawText
    text.ts             txt/md passthrough
  references/
    locate-section.ts   [2] locate bibliography block (EN + DE)
    segment.ts          [3] split block into individual reference strings
    match.ts            [4+5] free-text ref → candidate → asymmetric-containment verdict
  crossref.ts           + searchByBibliographic(raw)  (no 200-char truncation; rows=5)
  quick-check.ts        UNCHANGED engine; export helpers (normalizeTitle, jaccardSimilarity,
                        authorOverlapScore) for match.ts; add optional sourceRef to CitationCheckResult
  document.ts           checkDocument() orchestrator
  cli.ts                accept .docx/.txt/.md; print extraction summary + per-ref rows
  index.ts              export checkDocument
package.json            + dependency: mammoth
README.md               document-upload usage + privacy note
```

---

## 15. MVP cut (this spec) vs v2

**MVP (this spec):** `.docx` + `.txt`/`.md`; heading-based section location (EN + DE) with whole-doc fallback;
numbered + blank-line segmentation; `query.bibliographic` matching with asymmetric-containment verdict; CLI
prints detected count + per-reference verdict + extraction block; `mammoth` bundled.

**v2 (out of scope):** PDF (`pdf-parse`, best-effort warning), `.tex`, author-year segmentation heuristic,
optional anystyle/GROBID backend, additional language packs.

---

## 16. How the Acurio web app reuses this later

Web already has `mammoth`/`pdf-parse` and its own `docx-parser.ts`/`pdf-parser.ts`, so the *extraction* half
exists there. The genuinely new shared piece is **section-location + segmentation + asymmetric-containment
matching**. Keep that core in citecheck (MIT, tested in the open) and have web depend on the `citecheck`
package, calling `checkDocument()` from the free quick-check route. The paid Belegtreue (claim-support)
analysis flow is untouched — document upload widens the top of the funnel for the **free** existence check
without cannibalizing the paid moat.
