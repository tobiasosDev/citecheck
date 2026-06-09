# Contributing to citecheck

Thanks for your interest! citecheck is a small, focused tool — bug reports, test
cases (especially real-world bibliographies that segment badly), and
improvements to the matching heuristics are all welcome.

## Development setup

citecheck is TypeScript, ships as ESM, and is built with `tsc`. Tests run under
[Bun](https://bun.sh/) (`bun:test`).

```sh
git clone https://github.com/tobiasosDev/citecheck.git
cd citecheck
bun install        # also runs `tsc` via the `prepare` script → builds dist/
bun run build      # rebuild dist/ after a change
bun test           # run the full suite
bun run smoke      # sanity-check the compiled CLI under Node
```

Run the CLI you just built:

```sh
node dist/cli.js examples/sample.bib
```

## Project layout

| Path | What lives here |
| --- | --- |
| `src/cli.ts` | Argument parsing, output formatting, exit codes. |
| `src/quick-check.ts` | Top-level orchestration: parse → match → enrich. |
| `src/{bib-parser,ris-parser,csl-json}.ts` | Bibliography format parsers. |
| `src/references/` | Free-text matching (`match.ts`), section location (`locate-section.ts`), entry segmentation (`segment.ts`). |
| `src/ingest/` | Document extraction (`.docx` via mammoth, `.txt`, `.md`). |
| `src/{crossref,openalex,doaj}.ts` | API clients. |
| `src/http.ts` | Shared fetch/retry helper. |
| `test/` | One `*.test.ts` per area. |

The library surface is re-exported from `src/index.ts`; the mammoth-free
extraction helpers (`locateBibliography`, `segmentReferences`) are also exposed
via the `citecheck/extract` subpath (`src/extract.ts`) so consumers can pull in
just the section/segment logic without the document-parsing dependency.

## Tests are fully offline

Every test mocks the network — there are **no live API calls**, so the suite is
fast and deterministic. The convention is to reassign `globalThis.fetch` and
restore it in `afterEach`:

```ts
import { test, expect, afterEach } from "bun:test";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test("...", async () => {
  globalThis.fetch = (async (url: string | URL) => {
    return new Response(JSON.stringify({ /* mocked API body */ }), { status: 200 });
  }) as typeof fetch;
  // ...assert
});
```

Please keep new tests offline and add one for any matching/segmentation change —
a real bibliography snippet that reproduces the issue is the most useful kind.

## Submitting a change

1. Fork and branch off `main`.
2. Make the change; add or update tests.
3. Make sure `bun run build`, `bun test`, and `bun run smoke` all pass — CI runs
   exactly these.
4. Open a PR with a clear description. Commit messages follow
   [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`,
   `fix:`, `chore:`, `docs:`), matching the existing history.

## Scope

citecheck checks that references are **real, current, and from sound venues**.
It deliberately does **not** verify that a source actually *supports* the claim
citing it — that's a different, harder problem and out of scope here. Changes
that keep the tool small and the matching conservative are preferred over ones
that broaden its mandate.

## License

By contributing you agree that your contributions are licensed under the
[MIT License](./LICENSE).
