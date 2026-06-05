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
  expect(out.extraction.referencesChecked).toBe(2);
  expect(out.extraction.truncated).toBe(false);
  expect(out.result.citations[0]!.status).toBe("verified");
  expect(out.result.citations[1]!.status).toBe("not_found");
  expect(out.result.citations[0]!.sourceRef).toContain("Watson");
});

test("checkDocument throws when no text can be extracted", async () => {
  await expect(
    checkDocument({ bytes: new TextEncoder().encode("   "), filename: "empty.txt" }),
  ).rejects.toThrow(/no text/i);
});

test("checkDocument refuses a heading-less document with too many candidate lines (no API calls)", async () => {
  // No "References" heading => whole document scanned one-line-per-reference.
  // 201 non-blank lines exceeds the cap, so it must refuse BEFORE any network call.
  let fetchCalls = 0;
  globalThis.fetch = (async () => { fetchCalls++; return new Response("{}", { status: 200 }); }) as typeof fetch;

  const lines = Array.from({ length: 201 }, (_, i) => `Some prose line number ${i + 1} that looks like a reference.`);
  await expect(
    checkDocument({ bytes: new TextEncoder().encode(lines.join("\n")), filename: "ebook.txt" }),
  ).rejects.toThrow(/no bibliography heading found.*too long/i);
  expect(fetchCalls).toBe(0);
});

test("checkDocument caps a real >MAX_REFS bibliography at 200, sets truncated, keeps the true detected count", async () => {
  // High-confidence path: a "References" heading with 201 numbered entries is a
  // legitimate (e.g. systematic-review) bibliography. It must NOT refuse; it must
  // cap CHECKED at 200, set truncated, surface the true DETECTED count (201), and
  // dispatch at most 200 Crossref searches (not 201+).
  let crossrefCalls = 0;
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes("api.crossref.org")) {
      crossrefCalls++;
      return new Response(JSON.stringify({ message: { items: [] } }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const entries = Array.from({ length: 201 }, (_, i) => `[${i + 1}] Author ${i + 1}. Some title number ${i + 1}. Journal of Things. ${1900 + (i % 120)}.`);
  const doc = ["References", ...entries].join("\n");

  const out = await checkDocument({ bytes: new TextEncoder().encode(doc), filename: "review.txt" });

  expect(out.extraction.sectionFound).toBe(true);
  expect(out.extraction.truncated).toBe(true);
  expect(out.extraction.referencesDetected).toBe(201);
  expect(out.extraction.referencesChecked).toBe(200);
  expect(out.result.citations.length).toBe(200);
  // Empty crossref items => every ref is not_found, so no OpenAlex/DOAJ follow-on:
  // the counter lands at exactly 200, proving the cap bounds outbound HTTP.
  expect(crossrefCalls).toBe(200);
});

test("checkDocument rejects an oversized input before extraction (library-level byte guard)", async () => {
  // checkDocument is a public export; the byte guard must live in it, not only in
  // the CLI. A >10 MB input is refused before any extraction/network work.
  let fetchCalls = 0;
  globalThis.fetch = (async () => { fetchCalls++; return new Response("{}", { status: 200 }); }) as typeof fetch;

  const big = new Uint8Array(10 * 1024 * 1024 + 1);
  await expect(
    checkDocument({ bytes: big, filename: "huge.txt" }),
  ).rejects.toThrow(/too large/i);
  expect(fetchCalls).toBe(0);
});

test("checkDocument rejects when extracted text exceeds the char cap (post-extraction guard)", async () => {
  // The post-extraction MAX_TEXT_CHARS guard is independent of the byte guard:
  // a ~6 MB plain-ASCII .txt passes the 10 MB byte guard (under MAX_INPUT_BYTES)
  // yet decodes to ~6M chars, exceeding the 5M-char cap. This is the
  // security-relevant guard (the documented partial mitigation for .docx
  // zip-bomb amplification), so it must fire BEFORE any network work — like the
  // byte-guard test. The /MB of text/i discriminator proves we hit the char cap
  // and not the byte guard.
  let fetchCalls = 0;
  globalThis.fetch = (async () => { fetchCalls++; return new Response("{}", { status: 200 }); }) as typeof fetch;

  const bytes = new TextEncoder().encode("a".repeat(6_000_000)); // ~6M chars, ~6 MB < 10 MB
  expect(bytes.length).toBeLessThan(10 * 1024 * 1024); // confirm the byte guard does NOT fire
  await expect(
    checkDocument({ bytes, filename: "fat.txt" }),
  ).rejects.toThrow(/too large to scan/i);
  await expect(
    checkDocument({ bytes, filename: "fat.txt" }),
  ).rejects.toThrow(/MB of text/i);
  expect(fetchCalls).toBe(0);
});
