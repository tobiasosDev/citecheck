import { extname } from "node:path";
import { parseBib } from "./bib-parser.js";
import { parseRis } from "./ris-parser.js";
import { parseCslJson } from "./csl-json.js";
import type { CslItemData } from "./types.js";

/**
 * Pick a parser by file extension, falling back to content sniffing when the
 * name carries no usable extension (e.g. stdin "-", or inline content with a
 * synthetic label). Shared by the CLI and the MCP server so format detection
 * has a single source of truth. Returns [] when nothing recognizable parses.
 */
export function detectAndParse(file: string, text: string): CslItemData[] {
  const ext = extname(file).toLowerCase();
  if (ext === ".bib" || ext === ".bibtex") return parseBib(text);
  if (ext === ".ris") return parseRis(text);
  if (ext === ".json") return parseCslJson(text);

  // No usable extension: sniff the content.
  const t = text.trimStart();
  if (t.startsWith("[") || t.startsWith("{")) return parseCslJson(text);
  if (/^TY {2}- /m.test(t)) return parseRis(text);
  if (t.startsWith("@")) return parseBib(text);
  return [];
}
