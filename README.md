# citecheck

[![npm](https://img.shields.io/npm/v/citecheck)](https://www.npmjs.com/package/citecheck)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

**Sanity-check the references in your bibliography before you submit.** Point
citecheck at a `.bib`, `.ris`, or CSL-JSON export and it tells you which
references:

- **don't exist** — no matching record in Crossref or OpenAlex (a wrong DOI, a
  hallucinated reference, a typo in the title), or
- **have been retracted** — flagged via Crossref's retraction metadata.

It also notes which of your sources sit in **[DOAJ](https://doaj.org/)-listed
open-access journals** — a positive signal, shown inline when present.

No API key. No signup. No account. It only sends each reference's DOI/title to
public scholarly APIs (Crossref, OpenAlex, DOAJ) and prints the result — nothing
is uploaded or stored.

```console
$ npx citecheck references.bib

  ✓  verified     watson1953      Molecular Structure of Nucleic Acids: A Structure for Deoxy…
  ✓  verified     ioannidis2005   Why Most Published Research Findings Are False
       ↳ journal listed in DOAJ (open access)
  ~  partial      wakefield1998   Ileal-lymphoid-nodular hyperplasia, non-specific colitis, a… ⚠ RETRACTED
       ↳ This work has been retracted.
  ✗  not found    fabricated2099  Quantum Entanglement of Bibliographic Phantoms in Non-Exist…

Summary: 2 verified · 1 partial · 1 not found · 0 suspicious · 1 retracted
         1 in DOAJ (open access)
```

(`examples/sample.bib` ships in this repo — clone it and run `npx citecheck
examples/sample.bib`, or just point citecheck at your own Zotero export.)

## Install

Run it once with no install:

```sh
npx citecheck references.bib
```

Or install it globally:

```sh
npm install -g citecheck
citecheck references.bib
```

Requires Node.js 18 or newer.

> Installing from source (`npm install github:tobiasosDev/citecheck`) builds with
> TypeScript on install, so don't pass `--omit=dev` / `NODE_ENV=production`. The
> published npm package ships prebuilt — no build step needed.

## Usage

```sh
citecheck <file> [options]
```

`<file>` is a `.bib` / `.bibtex`, `.ris`, or CSL-JSON (`.json`) bibliography —
the kind you get from **Zotero → Export**, Mendeley, EndNote, or any reference
manager. Pass `-` to read from stdin (the format is auto-detected):

```sh
# Zotero: right-click a collection → Export Collection → Better CSL JSON
citecheck my-library.json

# pipe from anywhere
cat refs.bib | citecheck -
```

### Options

| Option | What it does |
| --- | --- |
| `--json` | Print the full result as JSON (for scripts / CI). |
| `--only-issues` | Hide references that checked out clean. |
| `--mailto <email>` | Use the Crossref/OpenAlex "polite pool" — faster, kinder rate limits. Also settable via the `CITECHECK_MAILTO` env var. |
| `--no-color` | Disable ANSI colors (also respects `NO_COLOR`). |
| `-h, --help` | Show help. |
| `-v, --version` | Show the version. |

### Exit codes

citecheck exits non-zero when it finds a problem, so you can wire it into CI or a
pre-submission script:

| Code | Meaning |
| --- | --- |
| `0` | every reference verified, nothing retracted |
| `1` | at least one reference is **not found**, **suspicious**, or **retracted** |
| `2` | usage or file-read error |

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

## What the verdicts mean

| Verdict | Meaning |
| --- | --- |
| **verified** | A Crossref record matches on title, authors, and year. |
| **partial** | A record exists but the metadata only partly matches (title or year off) — worth a look, often just a sloppy entry. |
| **not found** | No matching record in Crossref or OpenAlex. Check the DOI/title. |
| **suspicious** | A record was found, but it matches so poorly it's probably the wrong source. |
| **check failed** | citecheck couldn't reach Crossref for this one (network/rate-limit). It retried; re-run later. This does **not** count as a problem and doesn't affect the exit code. |
| **⚠ RETRACTED** | The work has been retracted (shown on top of any verdict). |

A reference can be **verified** and **retracted** at the same time — it's a real,
findable paper that has since been pulled. When a source's journal is in DOAJ,
citecheck adds an inline *"journal listed in DOAJ (open access)"* note — an
open-access signal, never a warning (most subscription journals, e.g. Nature,
are simply not in DOAJ).

## Programmatic use

citecheck is also a small library:

```ts
import { quickCheck, parseBib } from "citecheck";

const items = parseBib(await Bun.file("references.bib").text());
const { citations } = await quickCheck(items);

for (const c of citations) {
  if (c.status !== "verified" || c.retracted) {
    console.log(c.key, c.status, c.retracted ? "RETRACTED" : "");
  }
}
```

Exports: `quickCheck`, `parseBib`, `parseRis`, `parseCslJson`, and the
`CslItemData` / `QuickCheckResult` / `CitationCheckResult` types.

## What citecheck does *not* do

citecheck checks that your sources are **real, current, and from sound venues**.
It does **not** read the source and check whether your sentence is actually
*supported* by it — i.e. whether "Smith (2020) found X" is something Smith (2020)
really found. That's a separate, harder problem, and citecheck deliberately
stays out of it.

It's also intentionally conservative: "not found" means citecheck couldn't match
the reference, not that the work definitely doesn't exist (preprints, books,
grey literature, and non-English sources are under-represented in Crossref). Use
it as a fast first pass, not a final verdict.

## Privacy

citecheck runs entirely on your machine. For each reference it sends the DOI or
title to Crossref, OpenAlex, and DOAJ to look it up. It writes nothing to disk,
keeps no history, and has no telemetry.

## Acknowledgements

Built on the open scholarly infrastructure that makes this possible:
[Crossref](https://www.crossref.org/), [OpenAlex](https://openalex.org/), and
the [Directory of Open Access Journals](https://doaj.org/). Retraction data is
surfaced via Crossref (sourced from [Retraction Watch](https://retractionwatch.com/)).

## License

MIT © Tobias Lüscher

---

<sub>Made by the team behind [Acurio](https://acurio.ch), a related hosted tool that also checks whether each cited source actually supports the claim citing it.</sub>
