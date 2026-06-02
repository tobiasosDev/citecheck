import { test, expect } from "bun:test";
import {
  normalizeTitle,
  jaccardSimilarity,
  authorOverlapScore,
} from "../src/quick-check.js";
import { isRetracted } from "../src/crossref.js";

test("normalizeTitle lowercases and strips punctuation", () => {
  expect(normalizeTitle("On the Origin of Species!")).toBe("on the origin of species");
  expect(normalizeTitle("  A  B ")).toBe("a b");
  expect(normalizeTitle(undefined)).toBe("");
});

test("jaccardSimilarity: identical = 1, disjoint = 0", () => {
  expect(jaccardSimilarity("a b c", "a b c")).toBe(1);
  expect(jaccardSimilarity("a b c", "x y z")).toBe(0);
  // two of three words shared -> 2 / (3 + 3 - 2) = 0.5
  expect(jaccardSimilarity("a b c", "a b z")).toBeCloseTo(0.5, 5);
  expect(jaccardSimilarity("", "")).toBe(1);
  expect(jaccardSimilarity("a", "")).toBe(0);
});

test("authorOverlapScore matches on family name, case-insensitively", () => {
  expect(
    authorOverlapScore([{ family: "Watson" }, { family: "Crick" }], [
      { family: "WATSON" },
      { family: "CRICK" },
    ]),
  ).toBe(1);
  expect(
    authorOverlapScore([{ family: "Smith" }], [{ family: "Jones" }]),
  ).toBe(0);
  // one of two source authors matches -> 1 / max(2,1) = 0.5
  expect(
    authorOverlapScore([{ family: "Smith" }, { family: "Doe" }], [{ family: "smith" }]),
  ).toBe(0.5);
});

test("isRetracted detects updated-by, update-to and the RETRACTED: title marker", () => {
  // original paper -> retraction recorded under `updated-by`
  expect(
    isRetracted({
      DOI: "10.x/orig",
      title: ["A study"],
      "updated-by": [{ DOI: "10.x/notice", type: "retraction", label: "Retraction" }],
    }),
  ).toBe(true);
  // retraction notice -> `update-to`
  expect(
    isRetracted({
      DOI: "10.x/notice",
      title: ["Retraction notice"],
      "update-to": [{ DOI: "10.x/orig", type: "retraction" }],
    }),
  ).toBe(true);
  // title marker only
  expect(isRetracted({ DOI: "10.x/z", title: ["RETRACTED: Something"] })).toBe(true);
  // a correction is not a retraction; a paper *about* retractions is not retracted
  expect(
    isRetracted({
      DOI: "10.x/c",
      title: ["Retractions in science: a review"],
      "updated-by": [{ DOI: "10.x/corr", type: "correction", label: "Correction" }],
    }),
  ).toBe(false);
  expect(isRetracted({ DOI: "10.x/ok", title: ["A normal paper"] })).toBe(false);
});
