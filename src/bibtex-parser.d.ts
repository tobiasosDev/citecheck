// @retorquere/bibtex-parser ships no published type declarations (the `types`
// path in its package.json points at files that aren't in the tarball). Declare
// just the slice of its API that citecheck uses.
declare module "@retorquere/bibtex-parser" {
  export interface ParsedBibEntry {
    key?: string;
    type?: string;
    fields?: Record<string, unknown>;
  }
  export interface ParseResult {
    entries?: ParsedBibEntry[];
    errors?: { error: string }[];
  }
  export function parse(input: string, options?: { sentenceCase?: boolean }): ParseResult;
}
