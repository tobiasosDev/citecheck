import { userAgent, politeMailto, fetchRetry } from "./http.js";

const BASE_URL = "https://api.openalex.org";

export interface OpenAlexWork {
  id: string;
  doi?: string;
  title?: string;
  display_name?: string;
  publication_year?: number;
  cited_by_count?: number;
  is_oa?: boolean;
  primary_location?: {
    source?: {
      display_name?: string;
      issn_l?: string;
      is_in_doaj?: boolean;
    };
  };
  authorships?: { author: { display_name?: string } }[];
}

function mailtoParam(): string {
  const m = politeMailto();
  return m ? `&mailto=${encodeURIComponent(m)}` : "";
}

async function oaFetch(url: string): Promise<Response> {
  return fetchRetry(url, {
    headers: { "User-Agent": userAgent(), Accept: "application/json" },
    timeoutMs: 10_000,
  });
}

export async function lookupByDoi(doi: string): Promise<OpenAlexWork | null> {
  const clean = doi.replace(/^https?:\/\/doi\.org\//, "");
  try {
    const res = await oaFetch(`${BASE_URL}/works/doi:${encodeURIComponent(clean)}?select=id,doi,title,display_name,publication_year,cited_by_count,is_oa,primary_location${mailtoParam()}`);
    if (!res.ok) return null;
    return (await res.json()) as OpenAlexWork;
  } catch {
    return null;
  }
}

export async function searchByTitle(title: string, perPage = 3): Promise<OpenAlexWork[]> {
  const q = encodeURIComponent(title.slice(0, 200));
  try {
    const res = await oaFetch(`${BASE_URL}/works?filter=title.search:${q}&per_page=${perPage}${mailtoParam()}`);
    if (!res.ok) return [];
    const body = (await res.json()) as { results?: OpenAlexWork[] };
    return body.results ?? [];
  } catch {
    return [];
  }
}
