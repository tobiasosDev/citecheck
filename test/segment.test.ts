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

test("hanging-indent APA: indented continuations fold into the entry above", () => {
  // Single-spaced, author-year, NO numeric markers, NO blank lines between
  // entries — only a hanging indent marks the wraps. Each entry must stay whole,
  // not shatter into per-line fragments.
  const block = [
    "Smith, J. (2020). A short title.",
    "    Journal of Widget Science, 12(3), 45-67.",
    "García, M., & Lee, K. (2019). Deep learning for citation",
    "    verification. Proceedings of the ACL, 100-110.",
  ].join("\n");
  const refs = segmentReferences(block);
  expect(refs.length).toBe(2);
  expect(refs[0]).toBe("Smith, J. (2020). A short title. Journal of Widget Science, 12(3), 45-67.");
  expect(refs[1]).toContain("Deep learning for citation verification");
});

test("un-numbered wrap: a first line ending mid-clause folds the next line in", () => {
  // No indentation, but the first physical line does not close on terminal
  // punctuation, so the following line is a continuation, not a new entry.
  const block = [
    "Jones, P. (2018). The very long title that spills onto the next",
    "line. Nature, 555, 1-10.",
    "Brown, T. (2021). Another work. Science, 99, 22-30.",
  ].join("\n");
  const refs = segmentReferences(block);
  expect(refs.length).toBe(2);
  expect(refs[0]).toBe("Jones, P. (2018). The very long title that spills onto the next line. Nature, 555, 1-10.");
});

test("fallback: one line = one reference", () => {
  const block = "Ref one on a line.\nRef two on a line.\nRef three.";
  expect(segmentReferences(block).length).toBe(3);
});

test("empty block => no references", () => {
  expect(segmentReferences("   \n  ").length).toBe(0);
});
