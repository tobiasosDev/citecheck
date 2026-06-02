import { test, expect } from "bun:test";
import { parseBib } from "../src/bib-parser.js";
import { parseRis } from "../src/ris-parser.js";
import { parseCslJson } from "../src/csl-json.js";

test("parseBib reads title, doi, authors and year", () => {
  const items = parseBib(`@article{smith2020,
    title = {On the Origin of Tests},
    author = {Smith, Jane and Doe, John},
    journal = {Journal of Examples},
    year = {2020},
    doi = {10.1000/abcd}
  }`);
  expect(items.length).toBe(1);
  const it = items[0]!;
  expect(it.title).toBe("On the Origin of Tests");
  expect(it.DOI).toBe("10.1000/abcd");
  expect(it.author?.[0]?.family).toBe("Smith");
  expect(it.issued?.["date-parts"]?.[0]?.[0]).toBe("2020");
});

test("parseBib keeps a biblatex disambiguation suffix", () => {
  const items = parseBib(`@book{k2020a, title={A}, author={K, A}, year={2020a}}`);
  expect(items[0]!.issued?.["date-parts"]?.[0]?.[0]).toBe("2020a");
});

test("parseBib returns [] for empty / junk input", () => {
  expect(parseBib("")).toEqual([]);
  expect(parseBib("   \n  ")).toEqual([]);
});

test("parseRis reads a journal record", () => {
  const items = parseRis(`TY  - JOUR
TI  - Sample Article
AU  - Smith, Jane
PY  - 2019
DO  - 10.1/x
JO  - Some Journal
ER  - `);
  expect(items.length).toBe(1);
  const it = items[0]!;
  expect(it.title).toBe("Sample Article");
  expect(it.type).toBe("article-journal");
  expect(it.DOI).toBe("10.1/x");
  expect(it.author?.[0]?.family).toBe("Smith");
  expect(it.issued?.["date-parts"]?.[0]?.[0]).toBe("2019");
});

test("parseRis handles a record with no trailing ER", () => {
  const items = parseRis(`TY  - BOOK\nTI  - No Ender\nPY  - 2001`);
  expect(items.length).toBe(1);
  expect(items[0]!.title).toBe("No Ender");
});

test("parseCslJson accepts a bare array and an {items} wrapper", () => {
  const arr = parseCslJson(`[{"title":"T","DOI":"10.1/y"}]`);
  expect(arr.length).toBe(1);
  expect(arr[0]!.DOI).toBe("10.1/y");

  const wrapped = parseCslJson(`{"items":[{"title":"A"},{"title":"B"}]}`);
  expect(wrapped.length).toBe(2);

  expect(parseCslJson("not json")).toEqual([]);
});
