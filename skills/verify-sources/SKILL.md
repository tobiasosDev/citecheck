---
name: verify-sources
description: Use to verify that citations/references are real, current, and not retracted — via citecheck (Crossref/OpenAlex/DOAJ). Trigger BOTH (a) when the user explicitly asks to check references ("are these real?", "check the refs in X", "is this retracted?"), AND (b) proactively, right after you have produced or edited content that contains citations or a bibliography, before you call that work done.
---

# Verify sources with citecheck

You have a `citecheck` MCP server with three tools. Use them to catch fabricated, mismatched, or retracted references — especially ones **you** wrote.

## When to reach for it

- **Reactive:** the user asks whether sources are real / retracted, or to check a `.bib`/document.
- **Proactive (best-effort):** immediately after you draft or edit a literature review, related-work section, reference list, or any text with inline citations, run a verification pass before presenting it as finished. This guidance is advisory — there is no hard gate — so make it a habit.

## Which tool

- `verify_reference` — ONE reference. Pass a free-text reference string, a DOI, or a title. Use this for inline cites you just wrote.
- `check_bibliography` — a `.bib` / `.ris` / CSL-JSON export. Pass `path` (file on disk) or `content` (the text). Capped at 200 references.
- `check_document` — a `.docx` / `.txt` / `.md` document on disk (pass `path`). citecheck finds the bibliography section itself.

## How to read the verdicts — DO NOT over-claim

citecheck is deliberately conservative. Report results in the same spirit:

- **not_found / suspicious** → citecheck could not MATCH the reference. This is **not** proof it is fabricated: preprints, books, grey literature, theses and non-English sources are under-represented in Crossref/OpenAlex. Surface it as "I could not verify this — please double-check," not "this is fake."
- **check_failed** → a transient network/rate-limit miss. **Not a problem with the reference.** Do not report it as an issue; offer to retry.
- **partial_match** → a record exists but the metadata only partly matches — usually just a sloppy entry (wrong year, dropped subtitle).
- **retracted** → the one hard alarm. Flag it clearly even when the work is otherwise "verified."
- **Known limitation:** the single-reference matcher has known false positives (explicit DOIs in the string, corporate/organizational authors). Treat a lone "not found" as a prompt to look, never a final verdict.

## Privacy

Only the reference string leaves the machine (sent to Crossref/OpenAlex/DOAJ). The document or bibliography body is never uploaded or stored. Say so if the user asks.
