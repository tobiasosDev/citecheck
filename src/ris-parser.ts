import type { CslItemData, CslName } from "./types.js";

const RIS_TYPE_MAP: Record<string, string> = {
  JOUR: "article-journal",
  BOOK: "book",
  CHAP: "chapter",
  CONF: "paper-conference",
  THES: "thesis",
  RPRT: "report",
  UNPB: "manuscript",
  ELEC: "webpage",
  NEWS: "article-newspaper",
  MGZN: "article-magazine",
  GEN: "article",
};

function parseAuthor(value: string): CslName {
  const comma = value.indexOf(",");
  if (comma === -1) return { family: value.trim() };
  const family = value.slice(0, comma).trim() || undefined;
  const given = value.slice(comma + 1).trim() || undefined;
  return { family, given };
}

function parseYear(value: string): string | undefined {
  const m = value.match(/(\d{4})/);
  return m ? m[1] : undefined;
}

function generateId(item: CslItemData): string {
  const family = item.author?.[0]?.family?.toLowerCase().replace(/\s+/g, "") ?? "unknown";
  const yr = item.issued?.["date-parts"]?.[0]?.[0] ?? "";
  return `${family}${yr}`;
}

function first(tags: Record<string, string[]>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = tags[k]?.[0]?.trim();
    if (v) return v;
  }
  return undefined;
}

function buildItem(tags: Record<string, string[]>): CslItemData {
  const tyRaw = first(tags, "TY") ?? "GEN";
  const item: CslItemData = {
    id: first(tags, "ID") ?? "",
    type: RIS_TYPE_MAP[tyRaw] ?? tyRaw.toLowerCase(),
    title: first(tags, "TI", "T1"),
    DOI: first(tags, "DO"),
    URL: first(tags, "UR"),
    "container-title": first(tags, "JO", "JF", "T2"),
    publisher: first(tags, "PB"),
    volume: first(tags, "VL"),
    issue: first(tags, "IS"),
    abstract: first(tags, "AB"),
    ISSN: first(tags, "SN"),
  };

  const authors = [...(tags["AU"] ?? []), ...(tags["A1"] ?? [])];
  if (authors.length) item.author = authors.map(parseAuthor);

  const yearStr = first(tags, "PY", "Y1");
  if (yearStr) {
    const yr = parseYear(yearStr);
    if (yr) item.issued = { "date-parts": [[yr]] };
  }

  const sp = first(tags, "SP");
  const ep = first(tags, "EP");
  if (sp) item.page = ep ? `${sp}-${ep}` : sp;

  const kws = tags["KW"];
  if (kws?.length) item.keyword = kws.join(", ");

  if (!item.id) item.id = generateId(item);
  return item;
}

/** Parse an RIS bibliography export into CSL items. */
export function parseRis(text: string): CslItemData[] {
  const items: CslItemData[] = [];
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  let current: Record<string, string[]> | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const match = line.match(/^([A-Z][A-Z0-9])\s\s-\s(.*)$/);
    if (!match) continue;

    const tag = match[1]!;
    const value = match[2]!.trim();

    if (tag === "TY") {
      current = { TY: [value] };
      continue;
    }
    if (tag === "ER") {
      if (current) {
        items.push(buildItem(current));
        current = null;
      }
      continue;
    }
    if (!current) continue;
    if (!current[tag]) current[tag] = [];
    current[tag]!.push(value);
  }

  // Records without a trailing ER tag still count.
  if (current) items.push(buildItem(current));

  return items;
}
