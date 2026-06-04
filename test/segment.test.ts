// test/segment.test.ts
import { test, expect } from "bun:test";
import { segmentReferences } from "../src/references/segment.js";

test("numbered list: splits on [n], strips the marker, joins wrapped lines", () => {
  const block = [
    "[1] Watson JD, Crick FHC. Molecular structure of",
    "    nucleic acids. Nature. 1953.",
    "[2] Smith J. Deep learning. 2021.",
    "[3] García M. Hallucinated refs. 2023.",
  ].join("\n");
  const refs = segmentReferences(block);
  expect(refs.length).toBe(3);
  expect(refs[0]).toBe("Watson JD, Crick FHC. Molecular structure of nucleic acids. Nature. 1953.");
  expect(refs[1]).toContain("Deep learning");
});

test("also handles '1.' and '(1)' markers", () => {
  expect(segmentReferences("1. First ref.\n2. Second ref.").length).toBe(2);
  expect(segmentReferences("(1) First ref.\n(2) Second ref.").length).toBe(2);
});

test("blank-line separated entries", () => {
  const block = "Müller, K. (2020). Titel eins.\n\nJones, P. (2019). Title two.";
  const refs = segmentReferences(block);
  expect(refs.length).toBe(2);
  expect(refs[0]).toContain("Titel eins");
});

test("numbered list: a wrapped continuation line starting with a year is not a new entry", () => {
  const block = [
    "[1] Watson JD. Molecular structure. Nature. 1953.",
    "[2] Einstein A. Zur Elektrodynamik bewegter Körper. Annalen der Physik",
    "1905. 17:891-921.",
    "[3] García M. Hallucinated refs. 2023.",
  ].join("\n");
  const refs = segmentReferences(block);
  expect(refs.length).toBe(3);
  // The continuation must fold into entry 2, not split off as "17:891-921.".
  expect(refs[1]).toBe("Einstein A. Zur Elektrodynamik bewegter Körper. Annalen der Physik 1905. 17:891-921.");
});

test("fallback: one line = one reference", () => {
  const block = "Ref one on a line.\nRef two on a line.\nRef three.";
  expect(segmentReferences(block).length).toBe(3);
});

test("empty block => no references", () => {
  expect(segmentReferences("   \n  ").length).toBe(0);
});
