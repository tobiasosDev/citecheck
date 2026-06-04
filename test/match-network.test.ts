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

test("a retracted matched work is flagged", async () => {
  route((u) => {
    if (u.includes("crossref")) return { message: { items: [{ ...watsonItem, title: ["RETRACTED: Molecular structure of nucleic acids"] }] } };
    if (u.includes("doaj")) return { total: 0 };
    return {};
  });
  const r = await checkFreeTextRef("Watson JD, Crick FHC. Molecular structure of nucleic acids. Nature. 1953;171:737-738.");
  expect(r.retracted).toBe(true);
});
