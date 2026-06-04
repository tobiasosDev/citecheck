// test/locate-section.test.ts
import { test, expect } from "bun:test";
import { locateBibliography } from "../src/references/locate-section.js";

test("finds an English References heading and returns the block after it", () => {
  const doc = ["Intro text", "more body", "", "References", "[1] A", "[2] B"].join("\n");
  const s = locateBibliography(doc);
  expect(s.sectionFound).toBe(true);
  expect(s.confidence).toBe("high");
  expect(s.heading).toBe("References");
  expect(s.text).toContain("[1] A");
  expect(s.text).not.toContain("Intro text");
});

test("finds a German Literaturverzeichnis heading", () => {
  const doc = ["Einleitung", "", "Literaturverzeichnis", "Müller, K. (2020). Titel."].join("\n");
  const s = locateBibliography(doc);
  expect(s.heading).toBe("Literaturverzeichnis");
  expect(s.text).toContain("Müller");
});

test("prefers the LAST matching heading", () => {
  const doc = ["see references below", "References", "early false hit", "body", "References", "[1] Real"].join("\n");
  const s = locateBibliography(doc);
  expect(s.text).toContain("[1] Real");
  expect(s.text).not.toContain("early false hit");
});

test("matches a numbered heading like '6. References'", () => {
  const doc = ["body", "6. References", "[1] X"].join("\n");
  const s = locateBibliography(doc);
  expect(s.sectionFound).toBe(true);
  expect(s.text).toContain("[1] X");
});

test("stops at a following section heading (Appendix)", () => {
  const doc = ["References", "[1] Real ref", "Appendix", "raw appendix prose"].join("\n");
  const s = locateBibliography(doc);
  expect(s.text).toContain("[1] Real ref");
  expect(s.text).not.toContain("appendix prose");
});

test("matches a Markdown ATX heading '## References'", () => {
  const doc = ["Intro text", "", "## References", "[1] A", "[2] B"].join("\n");
  const s = locateBibliography(doc);
  expect(s.sectionFound).toBe(true);
  expect(s.confidence).toBe("high");
  expect(s.heading).toBe("## References");
  expect(s.text).toContain("[1] A");
  expect(s.text).not.toContain("Intro text");
});

test("matches a Markdown ATX heading '# Bibliography'", () => {
  const doc = ["body prose", "", "# Bibliography", "Smith, J. (2020). A title."].join("\n");
  const s = locateBibliography(doc);
  expect(s.sectionFound).toBe(true);
  expect(s.confidence).toBe("high");
  expect(s.heading).toBe("# Bibliography");
  expect(s.text).toContain("Smith");
});

test("matches a bold Markdown heading '**References**'", () => {
  const doc = ["body prose", "", "**References**", "Smith, J. (2020). A title."].join("\n");
  const s = locateBibliography(doc);
  expect(s.sectionFound).toBe(true);
  expect(s.confidence).toBe("high");
  expect(s.heading).toBe("**References**");
  expect(s.text).toContain("Smith");
});

test("stops at a Markdown ATX stop heading '## Appendix'", () => {
  const doc = ["## References", "[1] Real ref", "## Appendix", "raw appendix prose"].join("\n");
  const s = locateBibliography(doc);
  expect(s.text).toContain("[1] Real ref");
  expect(s.text).not.toContain("appendix prose");
});

test("no heading => whole document, low confidence", () => {
  const doc = "just some text with no bibliography heading at all";
  const s = locateBibliography(doc);
  expect(s.sectionFound).toBe(false);
  expect(s.confidence).toBe("low");
  expect(s.heading).toBeNull();
  expect(s.text).toBe(doc);
});
