import { test, expect, afterEach } from "bun:test";
import { searchByBibliographic } from "../src/crossref.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test("searchByBibliographic queries query.bibliographic with the full string (no 200-char cap)", async () => {
  let captured = "";
  globalThis.fetch = (async (url: string | URL) => {
    captured = String(url);
    return new Response(
      JSON.stringify({ message: { items: [{ DOI: "10.1/x", title: ["Hit"] }] } }),
      { status: 200 },
    );
  }) as typeof fetch;

  const longRef = "Author A. " + "lorem ipsum dolor ".repeat(20) + "(2020)."; // > 200 chars
  const items = await searchByBibliographic(longRef, 5);

  expect(items.length).toBe(1);
  expect(items[0]!.DOI).toBe("10.1/x");
  expect(captured).toContain("query.bibliographic=");
  expect(captured).toContain("rows=5");
  const sent = decodeURIComponent(captured.split("query.bibliographic=")[1]!.split("&")[0]!);
  expect(sent.length).toBeGreaterThan(200); // proves it was not truncated to 200
});

test("searchByBibliographic returns [] on a definitive non-OK response", async () => {
  globalThis.fetch = (async () => new Response("nope", { status: 404 })) as typeof fetch;
  expect(await searchByBibliographic("anything")).toEqual([]);
});
