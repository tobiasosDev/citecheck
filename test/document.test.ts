import { test, expect, afterEach } from "bun:test";
import { checkDocument } from "../src/document.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const watsonItem = {
  DOI: "10.1038/171737a0",
  title: ["Molecular structure of nucleic acids"],
  author: [{ family: "Watson" }, { family: "Crick" }],
  published: { "date-parts": [[1953]] },
  ISSN: ["0028-0836"],
};

test("checkDocument: real reference verifies, fabricated reference is not_found", async () => {
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes("api.crossref.org")) {
      return new Response(JSON.stringify({ message: { items: [watsonItem] } }), { status: 200 });
    }
    if (u.includes("api.openalex.org")) {
      return new Response(JSON.stringify({ cited_by_count: 9000, is_oa: false, primary_location: { source: { display_name: "Nature" } } }), { status: 200 });
    }
    if (u.includes("doaj.org")) {
      return new Response(JSON.stringify({ total: 0 }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const doc = [
    "Introduction",
    "Body text citing prior work.",
    "",
    "References",
    "[1] Watson JD, Crick FHC. Molecular structure of nucleic acids. Nature. 1953;171:737-738.",
    "[2] Phantom A. Quantum entanglement of bibliographic ghosts. J Imaginary Studies. 2021;9:1-9.",
  ].join("\n");

  const out = await checkDocument({ bytes: new TextEncoder().encode(doc), filename: "thesis.txt" });

  expect(out.extraction.format).toBe("txt");
  expect(out.extraction.sectionFound).toBe(true);
  expect(out.extraction.confidence).toBe("high");
  expect(out.extraction.referencesDetected).toBe(2);
  expect(out.result.citations[0]!.status).toBe("verified");
  expect(out.result.citations[1]!.status).toBe("not_found");
  expect(out.result.citations[0]!.sourceRef).toContain("Watson");
});

test("checkDocument throws when no text can be extracted", async () => {
  await expect(
    checkDocument({ bytes: new TextEncoder().encode("   "), filename: "empty.txt" }),
  ).rejects.toThrow(/no text/i);
});
