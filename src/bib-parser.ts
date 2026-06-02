import { parse as parseBibTeX } from "@retorquere/bibtex-parser";
import type { CslItemData, CslName } from "./types.js";

interface Creator {
  lastName?: string;
  firstName?: string;
  prefix?: string;
  suffix?: string;
  name?: string;
}

interface BibEntry {
  key?: string;
  type?: string;
  fields?: Record<string, unknown>;
}

function creatorToCslName(c: Creator): CslName {
  if (c.name) return { family: c.name };
  const family = [c.prefix, c.lastName].filter(Boolean).join(" ").trim() || undefined;
  const given = c.firstName?.trim() || undefined;
  // Single-name creators (only `given`, no `lastName`) still belong in an
  // author list — store them in `family` so renderers don't put a first
  // name where a surname belongs.
  if (!family && given) return { family: given };
  return { family, given };
}

/**
 * Pull the 4-digit year and an optional biblatex disambiguation suffix
 * (`2020a`, `2020b`) off a `year`/`date` field.
 */
function yearFromFields(fields: Record<string, unknown>): { year: string; suffix?: string } | undefined {
  const date = typeof fields.date === "string" ? fields.date : undefined;
  const year = typeof fields.year === "string" ? fields.year : undefined;
  const src = date || year;
  if (!src) return undefined;
  const m = src.match(/(\d{4})([a-z])?/i);
  if (!m) return undefined;
  return { year: m[1]!, suffix: m[2]?.toLowerCase() };
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function toCsl(entry: BibEntry): CslItemData {
  const fields = entry.fields ?? {};
  const authors = Array.isArray(fields.author) ? (fields.author as Creator[]) : [];

  const yr = yearFromFields(fields);
  const csl: CslItemData = {
    id: entry.key ?? "",
    title: asString(fields.title),
    DOI: asString(fields.doi),
    URL: asString(fields.url),
    "container-title": asString(fields.booktitle) ?? asString(fields.journal) ?? asString(fields.journaltitle),
    publisher: asString(fields.publisher),
    type: entry.type,
  };
  if (authors.length) csl.author = authors.map(creatorToCslName);
  if (yr) {
    // Keep the year as a string so a disambiguation suffix ("2020a") survives.
    csl.issued = { "date-parts": [[yr.suffix ? `${yr.year}${yr.suffix}` : yr.year]] };
  }
  return csl;
}

/** Parse one or more concatenated BibTeX / BibLaTeX documents into CSL items. */
export function parseBib(text: string): CslItemData[] {
  if (!text.trim()) return [];
  const items: CslItemData[] = [];
  try {
    // `sentenceCase: false` keeps titles exactly as written.
    const result = parseBibTeX(text, { sentenceCase: false }) as { entries?: BibEntry[] };
    for (const entry of result.entries ?? []) {
      if (!entry.key) continue;
      items.push(toCsl(entry));
    }
  } catch {
    // A malformed .bib yields whatever parsed before the error.
  }
  return items;
}
