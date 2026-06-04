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
  expect(
    verdictFor({ titleContainment: 1, matchedTitleTokens: 4, surnameHit: true, yearHit: true }, true),
  ).toBe("verified");
});

test("verdictFor: strong title but missing surname => partial_match", () => {
  expect(verdictFor({ titleContainment: 0.9, surnameHit: false, yearHit: true }, true)).toBe("partial_match");
});

test("verdictFor: low containment => not_found (anti-inversion guard)", () => {
  expect(verdictFor({ titleContainment: 0.1, surnameHit: false, yearHit: false }, true)).toBe("not_found");
});

test("verdictFor: candidate without a year does not require a year hit", () => {
  expect(
    verdictFor({ titleContainment: 0.8, matchedTitleTokens: 4, surnameHit: true, yearHit: false }, false),
  ).toBe("verified");
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
  expect(faithful.matchedTitleTokens).toBe(1); // only one content token matched
  expect(faithful.surnameHit).toBe(true);
  expect(faithful.yearHit).toBe(true);
  // Deliberate conservative outcome: a one-content-word title cannot auto-verify
  // on title+surname+year alone (see the single-token floor in verdictFor), so a
  // legitimate single-word-title paper drops to partial_match. The recall cost is
  // accepted as the correct trade for a fabrication-catcher.
  expect(verdictFor(faithful, true)).toBe("partial_match");
});

test("verdictFor: a one-content-word title cannot auto-verify (single-token floor)", () => {
  // Anti-inversion regression: Crossref's abundant short-title notices
  // ("Editorial", "Preface", "An Obituary", …) saturate titleContainment to 1.0
  // on a single shared word. A fabricated reference that reuses that one generic
  // word plus a colliding surname + year must NOT earn a green checkmark — it
  // caps at partial_match because only one title content-token matched.
  expect(
    verdictFor({ titleContainment: 1, matchedTitleTokens: 1, titleTokenCount: 1, surnameHit: true, yearHit: true }, true),
  ).toBe("partial_match");
  // The 2-content-word / 0.5-branch variant is also gated: one of two tokens
  // matched (e.g. candidate "Cancer genomics", ref shares only "cancer") stays
  // below the floor and must not verify on surname+year either.
  expect(
    verdictFor({ titleContainment: 0.5, matchedTitleTokens: 1, titleTokenCount: 2, surnameHit: true, yearHit: true }, true),
  ).toBe("partial_match");
});

test("computeContainment: an ASCII-transliterated accented surname still hits (Müller cited as Muller)", () => {
  // Authors routinely cite accented names in diacritic-dropped ASCII form.
  // NFKD folding on both sides ("Müller" -> "muller", cited "Muller" -> "muller")
  // must keep surnameHit true and preserve the accented title tokens.
  const einstein: CrossrefWork = {
    DOI: "10.1/e",
    title: ["Zur Elektrodynamik bewegter Körper"],
    author: [{ family: "Müller" }],
    published: { "date-parts": [[1905]] },
  };
  const citedAscii = "Muller A. Zur Elektrodynamik bewegter Korper. Annalen der Physik. 1905.";
  const c = computeContainment(citedAscii, einstein);
  expect(c.surnameHit).toBe(true);
  expect(c.titleContainment).toBe(1); // "Korper" folds to match "Körper"
  expect(c.yearHit).toBe(true);
  expect(verdictFor(c, true)).toBe("verified");
});

test("computeContainment: a faithful Cyrillic reference verifies (non-Latin script not flagged)", () => {
  const cyrillic: CrossrefWork = {
    DOI: "10.1/c",
    title: ["Молекулярная структура нуклеиновых кислот"],
    author: [{ family: "Иванов" }],
    published: { "date-parts": [[1953]] },
  };
  const raw = "Иванов И. Молекулярная структура нуклеиновых кислот. Природа. 1953.";
  const c = computeContainment(raw, cyrillic);
  expect(c.titleContainment).toBe(1);
  expect(c.surnameHit).toBe(true);
  expect(c.yearHit).toBe(true);
  expect(verdictFor(c, true)).toBe("verified");
});

test("computeContainment: a faithful CJK reference is partial_match, never 'fabricated'", () => {
  // CJK titles have no whitespace, so they collapse to a single token: the
  // metric saturates to 1.0 but only one content token matched, so the
  // single-token floor caps it at partial_match — the conservative, correct
  // outcome. The point is it is NOT not_found / "may be fabricated".
  const cjk: CrossrefWork = {
    DOI: "10.1/j",
    title: ["量子纠缠的研究"],
    author: [{ family: "王" }],
    published: { "date-parts": [[2020]] },
  };
  const raw = "王. 量子纠缠的研究. 物理学报. 2020.";
  const c = computeContainment(raw, cjk);
  expect(c.titleContainment).toBe(1);
  expect(c.surnameHit).toBe(true);
  expect(verdictFor(c, true)).toBe("partial_match");
});

test("computeContainment+verdictFor: a fabricated CJK ref still rejects (anti-inversion holds)", () => {
  const cjk: CrossrefWork = {
    DOI: "10.1/j",
    title: ["量子纠缠的研究"],
    author: [{ family: "王" }],
    published: { "date-parts": [[2020]] },
  };
  const fabricated = "李. 完全不同的论文标题内容. 别的期刊. 2020.";
  const c = computeContainment(fabricated, cjk);
  expect(c.titleContainment).toBe(0);
  expect(verdictFor(c, true)).toBe("not_found");
});

test("computeContainment+verdictFor: fabricated single-word-title ref resolves to partial_match end-to-end", () => {
  // A real Crossref short-title notice (one content token "obituary") shares only
  // a common surname + year + that one generic word with a fabricated reference.
  // The title carries no identifying signal, so it must cap at partial_match.
  const obituary: CrossrefWork = {
    DOI: "10.1/o",
    title: ["An Obituary"],
    author: [{ family: "Pino" }],
    published: { "date-parts": [[2026]] },
  };
  const fabricated = "Pino G. An obituary for a fictional theorem. Ghost Mathematics Quarterly. 2026.";
  const c = computeContainment(fabricated, obituary);
  expect(c.titleContainment).toBe(1); // {obituary} fully present — saturated metric
  expect(c.matchedTitleTokens).toBe(1); // …but only one content token
  expect(c.surnameHit).toBe(true);
  expect(c.yearHit).toBe(true);
  expect(verdictFor(c, true)).toBe("partial_match");
});
