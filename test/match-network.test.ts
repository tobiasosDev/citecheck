import { test, expect, afterEach } from "bun:test";
import { checkFreeTextRef } from "../src/references/match.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function route(handler: (u: string) => unknown) {
  globalThis.fetch = (async (url: string | URL) => {
    const body = handler(String(url));
    return new Response(JSON.stringify(body ?? {}), { status: 200 });
  }) as typeof fetch;
}

const watsonItem = {
  DOI: "10.1038/171737a0",
  title: ["Molecular structure of nucleic acids"],
  author: [{ family: "Watson" }, { family: "Crick" }],
  published: { "date-parts": [[1953]] },
  ISSN: ["0028-0836"],
};

test("a faithful reference verifies", async () => {
  route((u) => {
    if (u.includes("crossref")) return { message: { items: [watsonItem] } };
    if (u.includes("openalex")) return { cited_by_count: 9000, is_oa: false, primary_location: { source: { display_name: "Nature" } } };
    if (u.includes("doaj")) return { total: 0 };
    return {};
  });
  const r = await checkFreeTextRef("Watson JD, Crick FHC. Molecular structure of nucleic acids. Nature. 1953;171:737-738.");
  expect(r.status).toBe("verified");
  expect(r.sourceRef).toContain("Watson");
  expect(r.crossrefMatch?.doi).toBe("10.1038/171737a0");
  expect(r.openalexMatch?.journalName).toBe("Nature");
  expect(r.journalStatus).toBe("not_listed");
});

test("a fabricated reference whose nearest Crossref guess is a real paper => not_found", async () => {
  route((u) => {
    if (u.includes("crossref")) return { message: { items: [watsonItem] } };
    return {};
  });
  const r = await checkFreeTextRef("Phantom A. Quantum entanglement of bibliographic ghosts. J Imaginary Studies. 2021;9:1-9.");
  expect(r.status).toBe("not_found");
  expect(r.openalexMatch).toBeNull();
});

test("a not_found ref does NOT leak the rejected candidate's title or match", async () => {
  // The nearest Crossref guess is a real paper, but the ref does not match it.
  // The result must not surface that paper's title/match, or the CLI would
  // headline a fabricated reference with a legitimate paper's title.
  route((u) => (u.includes("crossref") ? { message: { items: [watsonItem] } } : {}));
  const r = await checkFreeTextRef("Phantom A. Quantum entanglement of bibliographic ghosts. J Imaginary Studies. 2021;9:1-9.");
  expect(r.status).toBe("not_found");
  expect(r.title).toBe("");
  expect(r.crossrefMatch).toBeNull();
});

test("not_found with a zero-token candidate title suppresses the 'may be fabricated' warning", async () => {
  // The nearest Crossref guess has a title that yields no extractable tokens
  // (e.g. all punctuation/digits). That is a tokenizer limitation, not evidence
  // of fabrication, so the harsh "may be fabricated" claim must be suppressed.
  const untokenizable = { DOI: "10.1/x", title: ["2020 —"], author: [{ family: "Smith" }], published: { "date-parts": [[2020]] } };
  route((u) => (u.includes("crossref") ? { message: { items: [untokenizable] } } : {}));
  const r = await checkFreeTextRef("Smith J. Some reference text. 2020.");
  expect(r.status).toBe("not_found");
  expect(r.warnings.some((w) => /may be fabricated/i.test(w))).toBe(false);
  expect(r.warnings.some((w) => /could not verify this reference automatically/i.test(w))).toBe(true);
});

test("no Crossref candidates => not_found", async () => {
  route((u) => (u.includes("crossref") ? { message: { items: [] } } : {}));
  const r = await checkFreeTextRef("Anything at all 2020");
  expect(r.status).toBe("not_found");
});

test("Crossref unreachable => check_failed", async () => {
  globalThis.fetch = (async () => { throw new Error("network down"); }) as typeof fetch;
  const r = await checkFreeTextRef("Watson JD. Molecular structure of nucleic acids. 1953.");
  expect(r.status).toBe("check_failed");
});

test("partial_match: retains title/match, warns, and still enriches via OpenAlex/DOAJ", async () => {
  // Raw ref overlaps the candidate title at ~0.5 (molecular, structure of
  // {molecular, structure, nucleic, acids}), surname present, year absent —
  // lands in the partial_match band (0.45–0.69, no verified double-signal).
  route((u) => {
    if (u.includes("crossref")) return { message: { items: [watsonItem] } };
    if (u.includes("openalex")) return { cited_by_count: 9000, is_oa: false, primary_location: { source: { display_name: "Nature" } } };
    if (u.includes("doaj")) return { total: 0 };
    return {};
  });
  const r = await checkFreeTextRef("Watson JD. Molecular structure observations in cells.");
  expect(r.status).toBe("partial_match");
  // Unlike not_found, partial_match must RETAIN the candidate's title/match.
  expect(r.title).toBe("Molecular structure of nucleic acids");
  expect(r.crossrefMatch?.doi).toBe("10.1038/171737a0");
  expect(r.warnings.some((w) => /partially matches/i.test(w))).toBe(true);
  expect(r.warnings.some((w) => /publication year not found/i.test(w))).toBe(true);
  // Enrichment must still run on a partial_match.
  expect(r.openalexMatch?.journalName).toBe("Nature");
});

test("doaj_listed override fires when OpenAlex reports is_in_doaj even if ISSN lookup said not_listed", async () => {
  route((u) => {
    if (u.includes("crossref")) return { message: { items: [watsonItem] } };
    if (u.includes("openalex")) return { cited_by_count: 9000, is_oa: true, primary_location: { source: { display_name: "Nature", is_in_doaj: true } } };
    if (u.includes("doaj")) return { total: 0 }; // ISSN lookup => not_listed
    return {};
  });
  const r = await checkFreeTextRef("Watson JD, Crick FHC. Molecular structure of nucleic acids. Nature. 1953;171:737-738.");
  expect(r.status).toBe("verified");
  expect(r.journalStatus).toBe("doaj_listed");
});

test("a retracted matched work is flagged", async () => {
  route((u) => {
    if (u.includes("crossref")) return { message: { items: [{ ...watsonItem, title: ["RETRACTED: Molecular structure of nucleic acids"] }] } };
    if (u.includes("doaj")) return { total: 0 };
    return {};
  });
  const r = await checkFreeTextRef("Watson JD, Crick FHC. Molecular structure of nucleic acids. Nature. 1953;171:737-738.");
  expect(r.retracted).toBe(true);
});
