import { readFile, stat } from "node:fs/promises";
import { checkFreeTextRef } from "../references/match.js";
import { quickCheck } from "../quick-check.js";
import { detectAndParse } from "../parse-bibliography.js";
import { checkDocument, MAX_INPUT_BYTES, MAX_REFS, tooLargeMessage } from "../document.js";
import { shapeVerify, shapeReport, mapExtraction } from "./shape.js";
import type { VerifyShape, ReportShape } from "./shape.js";

/**
 * The engine reads the polite-pool address from the CITECHECK_MAILTO env var
 * (see src/http.ts). The CLI sets it the same way (cli.ts). A per-call mailto
 * overrides the env for this process.
 */
// The polite-pool address the server was LAUNCHED with (env), captured once so a
// per-call `mailto` never leaks into a later call that omits it.
const ENV_MAILTO = process.env.CITECHECK_MAILTO;

function applyMailto(mailto?: string): void {
  const resolved = mailto ?? ENV_MAILTO;
  if (resolved) process.env.CITECHECK_MAILTO = resolved;
  else delete process.env.CITECHECK_MAILTO;
}

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

export async function runVerifyReference(input: { ref: string; mailto?: string }): Promise<VerifyShape> {
  applyMailto(input.mailto);
  return shapeVerify(await checkFreeTextRef(input.ref));
}

export async function runCheckBibliography(
  input: { path?: string; content?: string; format?: string; mailto?: string },
): Promise<ReportShape> {
  applyMailto(input.mailto);
  if (!input.path && input.content == null) {
    throw new Error("Provide either `path` (a file on disk) or `content` (the bibliography text).");
  }

  let text: string;
  let label: string;
  if (input.path) {
    text = (await readWithLimit(input.path)).toString("utf8");
    label = input.path;
  } else {
    text = input.content as string;
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

export async function runCheckDocument(input: { path: string; mailto?: string }): Promise<ReportShape> {
  applyMailto(input.mailto);
  const bytes = await readWithLimit(input.path);
  const { extraction, result } = await checkDocument({ bytes, filename: input.path });
  return shapeReport(result, { extraction: mapExtraction(extraction) });
}
