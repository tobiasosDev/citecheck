import { test, expect } from "bun:test";
import { detectAndParse } from "../src/parse-bibliography.js";

test("parses by .bib extension", () => {
  const items = detectAndParse("refs.bib", "@article{a, title={Hello}, year={2020}}");
  expect(items.length).toBe(1);
  expect(items[0]?.title).toBe("Hello");
});

test("parses by .bibtex extension", () => {
  const items = detectAndParse("refs.bibtex", "@article{a, title={HelloBibtex}, year={2021}}");
  expect(items.length).toBe(1);
  expect(items[0]?.title).toBe("HelloBibtex");
});

test("sniffs CSL-JSON content when extension is unknown", () => {
  const items = detectAndParse("-", '[{"id":"x","title":"T","type":"article-journal"}]');
  expect(items.length).toBe(1);
  expect(items[0]?.title).toBe("T");
});

test("sniffs RIS content", () => {
  const items = detectAndParse("-", "TY  - JOUR\nTI  - A Title\nER  -\n");
  expect(items.length).toBe(1);
});

test("returns [] for unrecognized content", () => {
  expect(detectAndParse("-", "just some prose")).toEqual([]);
});
