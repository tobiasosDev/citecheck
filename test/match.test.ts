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
    verdictFor({ titleContainment: 1, matchedTitleTokens: 4, distinctiveMatchedTokens: 4, titleTokenCount: 4, surnameHit: true, yearHit: true, doiHit: false }, true),
  ).toBe("verified");
});

test("verdictFor: strong title but missing surname => partial_match", () => {
  // matchedTitleTokens: 4 clears the single-token floor so the input actually
  // reaches the verified branches; surnameHit: false is then the ONLY blocker —
  // this is what makes the test exercise the surname guard rather than passing
  // because the (silently omitted) title-token floor was not met.
  expect(
    verdictFor({ titleContainment: 0.9, matchedTitleTokens: 4, distinctiveMatchedTokens: 4, titleTokenCount: 4, surnameHit: false, yearHit: true, doiHit: false }, true),
  ).toBe("partial_match");
});

test("verdictFor: strong title WITH surname => verified (surname guard, positive side)", () => {
  // Pairs the negative case above: the same strong-title input verifies once the
  // surname hits, pinning the surname guard from both sides.
  expect(
    verdictFor({ titleContainment: 0.9, matchedTitleTokens: 4, distinctiveMatchedTokens: 4, titleTokenCount: 4, surnameHit: true, yearHit: true, doiHit: false }, true),
  ).toBe("verified");
});

test("verdictFor: low containment => not_found (anti-inversion guard)", () => {
  expect(
    verdictFor({ titleContainment: 0.1, matchedTitleTokens: 0, distinctiveMatchedTokens: 0, titleTokenCount: 4, surnameHit: false, yearHit: false, doiHit: false }, true),
  ).toBe("not_found");
});

test("verdictFor: candidate without a year does not require a year hit", () => {
  expect(
    verdictFor({ titleContainment: 0.8, matchedTitleTokens: 4, distinctiveMatchedTokens: 4, titleTokenCount: 4, surnameHit: true, yearHit: false, doiHit: false }, false),
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
  expect(
    verdictFor({ titleContainment: 0.7, matchedTitleTokens: 4, distinctiveMatchedTokens: 4, titleTokenCount: 4, surnameHit: true, yearHit: false, doiHit: false }, true),
  ).toBe("partial_match");
});

test("verdictFor: just below 0.45 => not_found", () => {
  expect(
    verdictFor({ titleContainment: 0.44, matchedTitleTokens: 2, distinctiveMatchedTokens: 2, titleTokenCount: 4, surnameHit: true, yearHit: true, doiHit: false }, true),
  ).toBe("not_found");
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
  expect(
    verdictFor({ titleContainment: 0.6, matchedTitleTokens: 4, distinctiveMatchedTokens: 4, titleTokenCount: 4, surnameHit: true, yearHit: false, doiHit: false }, true),
  ).toBe("partial_match");
});

test("verdictFor: subtitle tolerance does NOT verify on title overlap alone (generic-main-title guard)", () => {
  // Guards against sliding toward pre-colon-only scoring: a fabricated ref that
  // reuses a generic main title scores low full-title containment and must reject.
  expect(
    verdictFor({ titleContainment: 0.14, matchedTitleTokens: 1, distinctiveMatchedTokens: 1, titleTokenCount: 7, surnameHit: true, yearHit: true, doiHit: false }, true),
  ).toBe("not_found");
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
    verdictFor({ titleContainment: 1, matchedTitleTokens: 1, distinctiveMatchedTokens: 1, titleTokenCount: 1, surnameHit: true, yearHit: true, doiHit: false }, true),
  ).toBe("partial_match");
  // The 2-content-word / 0.5-branch variant is also gated: one of two tokens
  // matched (e.g. candidate "Cancer genomics", ref shares only "cancer") stays
  // below the floor and must not verify on surname+year either.
  expect(
    verdictFor({ titleContainment: 0.5, matchedTitleTokens: 1, distinctiveMatchedTokens: 1, titleTokenCount: 2, surnameHit: true, yearHit: true, doiHit: false }, true),
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

test("computeContainment: yearHit ignores a numeric-range endpoint, but real date forms still hit", () => {
  // The candidate year must only count as a STANDALONE date, never as the end
  // (or start) of a numeric range, or a coincidental 4-digit run manufactures a
  // spurious corroborating signal. Pin BOTH directions: range endpoints reject,
  // real date forms still match (so future over-tightening can't silently kill
  // legitimate years).
  const work1953: CrossrefWork = {
    DOI: "10.1/r",
    title: ["Some paper title"],
    author: [{ family: "Author" }],
    published: { "date-parts": [[1953]] },
  };
  const work2019: CrossrefWork = { ...work1953, published: { "date-parts": [[2019]] } };

  // Range endpoints must NOT count as a year hit:
  expect(computeContainment("Author. Some paper title. pp. 2015-2019.", work2019).yearHit).toBe(false); // ASCII range end
  expect(computeContainment("Author. Some paper title. pp. 2015–2019.", work2019).yearHit).toBe(false); // en-dash range end
  expect(computeContainment("Author. Some paper title. 1953-1960.", work1953).yearHit).toBe(false); // span start (ASCII)
  expect(computeContainment("Author. Some paper title. 171:1953-1960.", work1953).yearHit).toBe(false); // vol:page span start

  // Real date forms must still hit:
  expect(computeContainment("Author. Some paper title (2019). J Things.", work2019).yearHit).toBe(true); // (2019).
  expect(computeContainment("Author. Some paper title. 1953;171:737-738.", work1953).yearHit).toBe(true); // 1953;171:
  expect(computeContainment("Author. Some paper title. 1953 .", work1953).yearHit).toBe(true); // spaced year
});

test("computeContainment+verdictFor: a page-range year coincidence must NOT flip a fabrication to verified", () => {
  // DECISIVE/CONTROL pair from the review. Candidate is a real generic paper
  // (Watson 1953) sharing only "molecular structure" (0.5 containment) + surname
  // with a fabricated ref whose ACTUAL publication year is 2008. In the DECISIVE
  // raw, the page range ends on 1953 — under the old regex that coincidence
  // produced yearHit=true and verified a fabrication via the 0.5/surname+year
  // branch. The narrowed regex must keep yearHit=false here so the verdict stays
  // partial_match (anti-inversion). The CONTROL raw (benign page range) is the
  // same input minus the year coincidence and must also stay partial_match.
  const watsonGeneric: CrossrefWork = {
    DOI: "10.1038/171737a0",
    title: ["Molecular structure of nucleic acids"],
    author: [{ family: "Watson" }],
    published: { "date-parts": [[1953]] },
  };
  const decisive = "Watson R. Molecular structure of imaginary lattices. Ghost J. 2008;3:1949-1953.";
  const control = "Watson R. Molecular structure of imaginary lattices. Ghost J. 2008;3:11-19.";

  const dc = computeContainment(decisive, watsonGeneric);
  const cc = computeContainment(control, watsonGeneric);
  // Same weak title overlap (0.5) and surname hit in both; only the spurious
  // year coincidence differs — and it must NOT register.
  expect(dc.titleContainment).toBe(0.5);
  expect(dc.surnameHit).toBe(true);
  expect(dc.yearHit).toBe(false); // page-range endpoint 1953 must not count
  expect(cc.yearHit).toBe(false);
  expect(verdictFor(dc, true)).toBe("partial_match"); // NOT verified
  expect(verdictFor(cc, true)).toBe("partial_match");
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

test("verdictFor: a 2-token generic title + surname + year must NOT verify (anti-inversion floor)", () => {
  // The C1 hole: a candidate generic short title ("Case report") saturates
  // titleContainment to 1.0 on just 2 shared content words — but BOTH are generic
  // publication-TYPE words, so distinctiveMatchedTokens is 0. A fabricated ref
  // that happens to contain those 2 generic words plus a colliding surname + year
  // must NOT earn a green checkmark — the distinctive-token floor (>= 2) holds it
  // at partial_match (1.0 >= 0.45, so never not_found via the title-only path).
  expect(
    verdictFor(
      { titleContainment: 1, matchedTitleTokens: 2, distinctiveMatchedTokens: 0, titleTokenCount: 2, surnameHit: true, yearHit: true, doiHit: false },
      true,
    ),
  ).toBe("partial_match");
});

test("verdictFor: an all-generic matched title + surname + year must NOT verify (distinctiveness floor)", () => {
  // The residual the count-only floor could not close: a candidate title made
  // entirely of generic publication-TYPE words ("Original research article" = 3
  // matched tokens) clears any matched-COUNT floor, but every matched token is
  // generic so distinctiveMatchedTokens is 0. With surname + year and no DOI it
  // must stay partial_match — three generic matched words carry zero identifying
  // signal, so the matched COUNT alone (3) must NOT verify.
  expect(
    verdictFor(
      { titleContainment: 1, matchedTitleTokens: 3, distinctiveMatchedTokens: 0, titleTokenCount: 3, surnameHit: true, yearHit: true, doiHit: false },
      true,
    ),
  ).toBe("partial_match");
});

test("verdictFor: two distinctive matched tokens + surname + year => verified (positive side of the floor)", () => {
  // Pins the floor from the other side: as soon as TWO matched tokens are
  // distinctive (not generic publication-TYPE words), surname + year verifies.
  // This is the minimum a genuine short distinctive title needs to clear.
  expect(
    verdictFor(
      { titleContainment: 0.8, matchedTitleTokens: 2, distinctiveMatchedTokens: 2, titleTokenCount: 2, surnameHit: true, yearHit: true, doiHit: false },
      true,
    ),
  ).toBe("verified");
});

test("computeContainment: distinctiveMatchedTokens excludes generic publication-TYPE words", () => {
  // "Original research article" is 3 matched content tokens, all generic, so
  // distinctiveMatchedTokens must be 0 — that is what closes the residual.
  const generic: CrossrefWork = {
    DOI: "10.1/ora",
    title: ["Original research article"],
    author: [{ family: "Jones" }],
    published: { "date-parts": [[2022]] },
  };
  const c = computeContainment(
    "Jones B. Original research article describing a fictional reaction. Imaginary Chem. 2022;8:1-9.",
    generic,
  );
  expect(c.matchedTitleTokens).toBe(3);
  expect(c.distinctiveMatchedTokens).toBe(0);
  expect(verdictFor(c, true)).toBe("partial_match");
  // A real distinctive title counts its matched tokens as distinctive.
  const real: CrossrefWork = {
    DOI: "10.1/x",
    title: ["Attention Is All You Need"],
    author: [{ family: "Vaswani" }],
    published: { "date-parts": [[2017]] },
  };
  const rc = computeContainment("Vaswani A. Attention is all you need. NeurIPS. 2017.", real);
  expect(rc.distinctiveMatchedTokens).toBe(4);
});

test("verdictFor: an exact DOI match + surname is conclusive (verified) even with a weak/short title", () => {
  // A DOI names one specific record, so a surname hit on top of an exact DOI match
  // leaves no plausible coincidental collision — it verifies regardless of how few
  // title tokens overlap or whether the year hits.
  expect(
    verdictFor(
      { titleContainment: 0.1, matchedTitleTokens: 0, distinctiveMatchedTokens: 0, titleTokenCount: 5, surnameHit: true, yearHit: false, doiHit: true },
      true,
    ),
  ).toBe("verified");
  // But a DOI hit WITHOUT a surname is not enough on its own (a stray DOI pasted
  // into an otherwise unrelated/fabricated reference shouldn't auto-verify).
  expect(
    verdictFor(
      { titleContainment: 0.1, matchedTitleTokens: 0, distinctiveMatchedTokens: 0, titleTokenCount: 5, surnameHit: false, yearHit: false, doiHit: true },
      true,
    ),
  ).toBe("not_found");
});

test("computeContainment: doiHit is set on an exact DOI match and ignores a URL prefix / trailing punctuation", () => {
  const work: CrossrefWork = {
    DOI: "10.1038/171737a0",
    title: ["Molecular structure of nucleic acids"],
    author: [{ family: "Watson" }],
    published: { "date-parts": [[1953]] },
  };
  // Bare DOI with a trailing period (sentence punctuation must be stripped).
  expect(computeContainment("Watson JD. Some title. doi:10.1038/171737a0.", work).doiHit).toBe(true);
  // doi.org URL form in the raw, matched against the bare candidate DOI.
  expect(computeContainment("Watson JD. Some title. https://doi.org/10.1038/171737a0", work).doiHit).toBe(true);
  // Candidate carries a URL prefix; raw has the bare DOI — both normalize equal.
  const urlWork: CrossrefWork = { ...work, DOI: "https://doi.org/10.1038/171737a0" };
  expect(computeContainment("Watson JD. Some title. 10.1038/171737a0", urlWork).doiHit).toBe(true);
  // A different DOI does NOT hit.
  expect(computeContainment("Watson JD. Some title. doi:10.9999/other.x", work).doiHit).toBe(false);
  // No DOI in the raw => no hit.
  expect(computeContainment("Watson JD. Some title. 1953.", work).doiHit).toBe(false);
});

test("computeContainment: a year appearing ONLY inside a DOI does not register as a yearHit (M1)", () => {
  // The DOI's path component carries the 4-digit run "2019"; with the candidate
  // year 2019, the standalone-date regex would spuriously fire without the
  // DOI-stripping pre-pass. There is no real date elsewhere, so yearHit must be
  // false.
  const work2019: CrossrefWork = {
    DOI: "10.1234/2019.abc",
    title: ["Some paper title here"],
    author: [{ family: "Author" }],
    published: { "date-parts": [[2019]] },
  };
  expect(computeContainment("Author A. Some paper title here. doi:10.1234/2019.abc", work2019).yearHit).toBe(false);
  // Control: the SAME ref with a real standalone year present still hits.
  expect(
    computeContainment("Author A. Some paper title here (2019). doi:10.1234/2019.abc", work2019).yearHit,
  ).toBe(true);
});

test("computeContainment+verdictFor: canonical real references (3- and 4-token titles) still verify", () => {
  // Recall guard for the C1 fix: lowering the matched-token floor to 3 (from the
  // safest 4) is what keeps genuine but short distinctive titles green.
  // Watson (4 content tokens), Vaswani (4), Einstein (3 — "zur" is a stopword).
  const watsonFull: CrossrefWork = {
    DOI: "10.1038/171737a0",
    title: ["Molecular Structure of Nucleic Acids: A Structure for Deoxyribose Nucleic Acid"],
    author: [{ family: "Watson" }, { family: "Crick" }],
    published: { "date-parts": [[1953]] },
  };
  const watsonRaw = "Watson JD, Crick FHC. Molecular structure of nucleic acids. Nature. 1953;171:737-738.";
  expect(verdictFor(computeContainment(watsonRaw, watsonFull), true)).toBe("verified");

  const vaswani: CrossrefWork = {
    DOI: "10.5555/3295222.3295349",
    title: ["Attention Is All You Need"],
    author: [{ family: "Vaswani" }],
    published: { "date-parts": [[2017]] },
  };
  const vaswaniRaw = "Vaswani A, Shazeer N, et al. Attention is all you need. NeurIPS. 2017.";
  const vc = computeContainment(vaswaniRaw, vaswani);
  expect(vc.matchedTitleTokens).toBe(4);
  expect(verdictFor(vc, true)).toBe("verified");

  const einstein: CrossrefWork = {
    DOI: "10.1002/andp.19053221004",
    title: ["Zur Elektrodynamik bewegter Körper"],
    author: [{ family: "Einstein" }],
    published: { "date-parts": [[1905]] },
  };
  const einsteinRaw = "Einstein A. Zur Elektrodynamik bewegter Körper. Annalen der Physik. 1905;17:891-921.";
  const ec = computeContainment(einsteinRaw, einstein);
  expect(ec.matchedTitleTokens).toBe(3); // distinctive 3-token title (zur is a stopword)
  expect(verdictFor(ec, true)).toBe("verified");
});
