import { test, expect } from "bun:test";
import { computeContainment, verdictFor } from "../src/references/match.js";
import type { CrossrefWork } from "../src/crossref.js";

const watson: CrossrefWork = {
  DOI: "10.1038/171737a0",
  title: ["Molecular structure of nucleic acids"],
  author: [{ family: "Watson" }, { family: "Crick" }],
  published: { "date-parts": [[1953]] },
};

test("computeContainment: a faithful reference contains the candidate's tokens", () => {
  const raw = "Watson JD, Crick FHC. Molecular structure of nucleic acids. Nature. 1953;171:737-738.";
  const c = computeContainment(raw, watson);
  expect(c.titleContainment).toBe(1);
  expect(c.surnameHit).toBe(true);
  expect(c.yearHit).toBe(true);
});

test("computeContainment: a fabricated reference does NOT contain the candidate's tokens", () => {
  const raw = "Phantom A. Quantum entanglement of bibliographic ghosts. J Imaginary Studies. 2021;9:1-9.";
  const c = computeContainment(raw, watson);
  expect(c.titleContainment).toBeLessThan(0.45);
  expect(c.surnameHit).toBe(false);
  expect(c.yearHit).toBe(false);
});

test("verdictFor: high containment + surname + year => verified", () => {
  expect(verdictFor({ titleContainment: 1, surnameHit: true, yearHit: true }, true)).toBe("verified");
});

test("verdictFor: strong title but missing surname => partial_match", () => {
  expect(verdictFor({ titleContainment: 0.9, surnameHit: false, yearHit: true }, true)).toBe("partial_match");
});

test("verdictFor: low containment => not_found (anti-inversion guard)", () => {
  expect(verdictFor({ titleContainment: 0.1, surnameHit: false, yearHit: false }, true)).toBe("not_found");
});

test("verdictFor: candidate without a year does not require a year hit", () => {
  expect(verdictFor({ titleContainment: 0.8, surnameHit: true, yearHit: false }, false)).toBe("verified");
});

test("computeContainment: matches a compound (multi-word) surname", () => {
  const vandenberg: CrossrefWork = {
    DOI: "10.1/v",
    title: ["A study of tulips"],
    author: [{ family: "Van Den Berg" }],
    published: { "date-parts": [[2019]] },
  };
  const present = computeContainment("Van Den Berg, J. (2019). A study of tulips. J Botany.", vandenberg);
  expect(present.surnameHit).toBe(true);
  const missingPart = computeContainment("Berg, J. (2019). A study of tulips.", vandenberg);
  expect(missingPart.surnameHit).toBe(false);
});

test("verdictFor: at the 0.7 title boundary without a year => partial_match", () => {
  expect(verdictFor({ titleContainment: 0.7, surnameHit: true, yearHit: false }, true)).toBe("partial_match");
});

test("verdictFor: just below 0.45 => not_found", () => {
  expect(verdictFor({ titleContainment: 0.44, surnameHit: true, yearHit: true }, true)).toBe("not_found");
});

test("computeContainment+verdictFor: faithful subtitle-dropping citation verifies", () => {
  // Crossref's canonical title carries a post-colon subtitle the citation drops;
  // full-title containment lands ~0.67. Surname + year corroborate => verified.
  const watsonCanonical: CrossrefWork = {
    DOI: "10.1038/171737a0",
    title: ["Molecular Structure of Nucleic Acids: A Structure for Deoxyribose Nucleic Acid"],
    author: [{ family: "Watson" }, { family: "Crick" }],
    published: { "date-parts": [[1953]] },
  };
  const raw = "Watson JD, Crick FHC. Molecular structure of nucleic acids. Nature. 1953;171:737-738.";
  const c = computeContainment(raw, watsonCanonical);
  expect(c.titleContainment).toBeLessThan(0.7); // below the high bar
  expect(c.titleContainment).toBeGreaterThanOrEqual(0.5);
  expect(c.surnameHit).toBe(true);
  expect(c.yearHit).toBe(true);
  expect(verdictFor(c, true)).toBe("verified");
});

test("verdictFor: subtitle tolerance requires a POSITIVE year hit, not just absence", () => {
  // Year mismatch (yearHit false, candidate has a year) must stay partial,
  // even with strong surname — a wrong year is real signal, not a subtitle artifact.
  expect(verdictFor({ titleContainment: 0.6, surnameHit: true, yearHit: false }, true)).toBe("partial_match");
});

test("verdictFor: subtitle tolerance does NOT verify on title overlap alone (generic-main-title guard)", () => {
  // Guards against sliding toward pre-colon-only scoring: a fabricated ref that
  // reuses a generic main title scores low full-title containment and must reject.
  expect(verdictFor({ titleContainment: 0.14, surnameHit: true, yearHit: true }, true)).toBe("not_found");
});

test("computeContainment: a pure-digit title token must not be auto-satisfied by the ref's year", () => {
  // Candidate title "Global health 2020": only the alphabetic tokens
  // {global, health} are title content; "2020" is dropped. The fabricated raw
  // shares "global" + the year 2020 but NOT "health". Without the digit filter,
  // "2020" would count as a 3rd title token satisfied by the publication year,
  // lifting containment from 1/2 (0.5) to 2/3 (0.67) — a number doubling as both
  // yearHit AND a title-content token. The fix must keep it at 0.5: the digit
  // corroborates via yearHit only, never as a free title token.
  const numericTitle: CrossrefWork = {
    DOI: "10.1/g",
    title: ["Global health 2020"],
    author: [{ family: "Smith" }],
    published: { "date-parts": [[2020]] },
  };
  const raw = "Smith J. Global frameworks for resilience. Imaginary Press 2020.";
  const withDigit = computeContainment(raw, numericTitle);
  // Control: the SAME title with the trailing digit removed. The digit must not
  // change containment at all — it is invisible to the title-token set.
  const noDigit: CrossrefWork = { ...numericTitle, title: ["Global health"] };
  const withoutDigit = computeContainment(raw, noDigit);
  expect(withDigit.titleContainment).toBe(0.5); // 1 of 2 content tokens (global), NOT 2 of 3
  expect(withDigit.titleContainment).toBe(withoutDigit.titleContainment);
});

test("computeContainment: a digit-bearing real title keeps its alphabetic identity token", () => {
  // Recall guard: punctuation is stripped before tokenizing, so digit-bearing
  // titles keep an identifying word ("Trial 2020" -> {trial, 2020} -> {trial}).
  const trial: CrossrefWork = {
    DOI: "10.1/t",
    title: ["Trial 2020"],
    author: [{ family: "Watson" }],
    published: { "date-parts": [[2020]] },
  };
  const faithful = computeContainment("Watson JD. Trial. Lancet. 2020;1:1-2.", trial);
  expect(faithful.titleContainment).toBe(1); // {trial} fully present
  expect(faithful.surnameHit).toBe(true);
  expect(faithful.yearHit).toBe(true);
  expect(verdictFor(faithful, true)).toBe("verified");
});
