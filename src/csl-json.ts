import type { CslItemData } from "./types.js";

/**
 * Parse CSL-JSON, the format Zotero exports via "Better CSL JSON" and the
 * format most reference managers can emit. Accepts either a bare array of
 * items or an object with an `items` array.
 */
export function parseCslJson(text: string): CslItemData[] {
  if (!text.trim()) return [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const arr = Array.isArray(data)
    ? data
    : Array.isArray((data as { items?: unknown }).items)
      ? (data as { items: unknown[] }).items
      : [];
  return arr.filter((x): x is CslItemData => typeof x === "object" && x !== null);
}
