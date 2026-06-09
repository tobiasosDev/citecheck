import { readFile, stat } from "node:fs/promises";
import { checkFreeTextRef } from "../references/match.js";
import { quickCheck } from "../quick-check.js";
import { detectAndParse } from "../parse-bibliography.js";
import { checkDocument, MAX_INPUT_BYTES, MAX_REFS, tooLargeMessage } from "../document.js";
import { shapeVerify, shapeReport, mapExtraction } from "./shape.js";
import type { VerifyShape, ReportShape } from "./shape.js";

// The polite-pool address (faster, kinder Crossref/OpenAlex rate limits) is read
// by the engine from the CITECHECK_MAILTO env var (see src/http.ts). It is SERVER
// configuration — set it once in the server's environment (e.g. the `env` block
// of your .mcp.json), not a per-call argument. Keeping it out of the request
// avoids mutating shared process state across overlapping tool calls.

function syntheticLabel(format?: string): string {
  if (format === "ris") return "x.ris";
  if (format === "csljson") return "x.json";
  if (format === "bib") return "x.bib";
  return "-"; // no hint → detectAndParse sniffs the content
}

// Read a file from disk, rejecting anything over the engine's input cap before
// loading it into memory. Returns raw bytes; callers decode as needed.
async function readWithLimit(path: string): Promise<Buffer> {
  const info = await stat(path);
  if (info.size > MAX_INPUT_BYTES) throw new Error(tooLargeMessage(info.size));
  return readFile(path);
}

/** Verify one free-text reference / DOI / title and shape it for an LLM. */
export async function runVerifyReference(input: { ref: string }): Promise<VerifyShape> {
  return shapeVerify(await checkFreeTextRef(input.ref));
}

/**
 * Verify a whole .bib/.ris/CSL-JSON bibliography. Exactly one of `path` (a file
 * on disk) or `content` (inline text) must be given. Caps outbound checks at
 * MAX_REFS while still reporting the true detected total.
 */
export async function runCheckBibliography(
  input: { path?: string; content?: string; format?: string },
): Promise<ReportShape> {
  const hasPath = input.path != null;
  const hasContent = input.content != null;
  if (hasPath === hasContent) {
    throw new Error("Provide exactly one of `path` (a file on disk) or `content` (the bibliography text).");
  }

  let text: string;
  let label: string;
  if (input.path != null) {
    text = (await readWithLimit(input.path)).toString("utf8");
    label = input.path;
  } else {
    text = input.content as string;
    const size = Buffer.byteLength(text, "utf8");
    if (size > MAX_INPUT_BYTES) throw new Error(tooLargeMessage(size));
    label = syntheticLabel(input.format);
  }

  const items = detectAndParse(label, text);
  if (items.length === 0) {
    throw new Error("No references could be parsed — expected a .bib/.ris/CSL-JSON bibliography.");
  }

  const detected = items.length;
  const truncated = detected > MAX_REFS;
  const checked = truncated ? items.slice(0, MAX_REFS) : items;
  const result = await quickCheck(checked);
  return shapeReport(result, { truncated, detectedTotal: detected });
}

/** Extract a .docx/.txt/.md document's bibliography and verify each reference. */
export async function runCheckDocument(input: { path: string }): Promise<ReportShape> {
  const bytes = await readWithLimit(input.path);
  const { extraction, result } = await checkDocument({ bytes, filename: input.path });
  return shapeReport(result, { extraction: mapExtraction(extraction) });
}
