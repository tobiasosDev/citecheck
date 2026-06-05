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

test("un-numbered, indent-only: a non-terminal previous line does NOT swallow the next entry (I1)", () => {
  // The previous "previous line did not end on terminal punctuation => fold"
  // heuristic was dropped. It mis-merged a real reference whose previous entry
  // ended on a non-terminal char (e.g. a bare page count "1-10") into the
  // following entry, producing a glued string reported as fabricated — a damaging
  // false alarm. With indent-only segmentation, ref 1 ending on a non-terminal
  // page count must NOT swallow the next (real) reference: they stay separate.
  const block = [
    "Jones, P. (2018). A complete work. Nature, 555, 1-10",
    "Brown, T. (2021). Another work. Science, 99, 22-30.",
    "García, M. (2019). A third work. Cell, 12, 5-9.",
  ].join("\n");
  const refs = segmentReferences(block);
  expect(refs.length).toBe(3);
  expect(refs[0]).toBe("Jones, P. (2018). A complete work. Nature, 555, 1-10");
  expect(refs[1]).toBe("Brown, T. (2021). Another work. Science, 99, 22-30.");
  expect(refs[2]).toContain("A third work");
});

test("numbered list: prose before the first marker is discarded, not made an entry", () => {
  // A lead-in line precedes the first [1] marker. It must not become a phantom
  // reference (which would be fired at Crossref and resolve not_found).
  const block = [
    "The following references were consulted:",
    "[1] Watson JD. Molecular structure. Nature. 1953.",
    "[2] Smith J. Deep learning. 2021.",
  ].join("\n");
  const refs = segmentReferences(block);
  expect(refs.length).toBe(2);
  expect(refs[0]).toContain("Watson");
  expect(refs.some((r) => /following references were consulted/i.test(r))).toBe(false);
});

test("all-indented block: a uniformly indented entry that wraps stays whole", () => {
  // Every physical line is indented (a Word/PDF export artifact). Without
  // dedenting, the whole block collapses to one entry, fails the >= 2 guard,
  // and falls through to one-line-per-reference — shattering the wrapped entry.
  const block = [
    "    Smith, J. (2020). A short title.",
    "        Journal of Widget Science, 12(3), 45-67.",
    "    García, M. (2019). Another work. Science, 99, 22-30.",
  ].join("\n");
  const refs = segmentReferences(block);
  expect(refs.length).toBe(2);
  expect(refs[0]).toBe("Smith, J. (2020). A short title. Journal of Widget Science, 12(3), 45-67.");
  expect(refs[1]).toContain("Another work");
});

test("fallback: one line = one reference", () => {
  const block = "Ref one on a line.\nRef two on a line.\nRef three.";
  expect(segmentReferences(block).length).toBe(3);
});

test("empty block => no references", () => {
  expect(segmentReferences("   \n  ").length).toBe(0);
});

test("very large heading-less block (path 3) does not crash the call stack", () => {
  // A heading-less document with very many non-blank, non-numbered, single-spaced
  // lines reaches path 3 (un-numbered hanging-indent), where the common indent is
  // computed. The previous Math.min(...nonBlank.map(...)) spread threw
  // "RangeError: Maximum call stack size exceeded" once the argument count exceeded
  // the engine limit — ~125k on V8 (Node, the shipped target) and ~1M on JSC (Bun,
  // the test runner). 1.5M lines crosses BOTH thresholds, so this test genuinely
  // throws on the old spread under `bun test` (verified) as well as under Node.
  const block = Array.from({ length: 1_500_000 }, () => "Smith J. Title. Journal. 2020").join("\n");
  expect(() => segmentReferences(block)).not.toThrow();
});
