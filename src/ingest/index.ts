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
