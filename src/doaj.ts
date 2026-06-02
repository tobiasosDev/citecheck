import { userAgent, fetchRetry } from "./http.js";

const BASE_URL = "https://doaj.org/api";

export type DoajStatus = "doaj_listed" | "not_listed" | "unknown";

interface DoajJournal {
  id: string;
  bibjson: {
    title?: string;
    publisher?: { name?: string };
    identifier?: { type: string; id: string }[];
  };
}

const cache = new Map<string, { result: DoajStatus; at: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function cached(key: string): DoajStatus | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return entry.result;
}

function store(key: string, result: DoajStatus): void {
  if (cache.size > 5_000) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { result, at: Date.now() });
}

async function doajFetch(url: string): Promise<Response> {
  return fetchRetry(url, {
    headers: { "User-Agent": userAgent(), Accept: "application/json" },
    timeoutMs: 8_000,
  });
}

export async function checkByIssn(issn: string): Promise<DoajStatus> {
  const clean = issn.trim().toUpperCase();
  if (!clean) return "unknown";

  const hit = cached(`issn:${clean}`);
  if (hit) return hit;

  try {
    const res = await doajFetch(`${BASE_URL}/search/journals/issn:${encodeURIComponent(clean)}`);
    if (!res.ok) {
      store(`issn:${clean}`, "unknown");
      return "unknown";
    }
    const body = (await res.json()) as { total?: number; results?: DoajJournal[] };
    const status: DoajStatus = (body.total ?? 0) > 0 ? "doaj_listed" : "not_listed";
    store(`issn:${clean}`, status);
    return status;
  } catch {
    return "unknown";
  }
}

export async function checkByTitle(title: string): Promise<DoajStatus> {
  const clean = title.trim();
  if (!clean) return "unknown";

  const cacheKey = `title:${clean.toLowerCase().slice(0, 100)}`;
  const hit = cached(cacheKey);
  if (hit) return hit;

  try {
    const res = await doajFetch(`${BASE_URL}/search/journals/${encodeURIComponent(clean.slice(0, 200))}`);
    if (!res.ok) {
      store(cacheKey, "unknown");
      return "unknown";
    }
    const body = (await res.json()) as { total?: number };
    const status: DoajStatus = (body.total ?? 0) > 0 ? "doaj_listed" : "not_listed";
    store(cacheKey, status);
    return status;
  } catch {
    return "unknown";
  }
}
