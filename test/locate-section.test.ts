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

test("finds Spanish/Portuguese 'Referencias' / accented 'Bibliografía' headings", () => {
  const es = ["Cuerpo", "", "Referencias", "García, J. (2020). Título."].join("\n");
  expect(locateBibliography(es).heading).toBe("Referencias");
  const accented = ["Cuerpo", "", "Bibliografía", "García, J. (2020). Título."].join("\n");
  const s = locateBibliography(accented);
  expect(s.sectionFound).toBe(true);
  expect(s.text).toContain("García");
});

test("finds an Italian 'Riferimenti' heading", () => {
  const doc = ["Corpo", "", "Riferimenti", "Rossi, M. (2021). Titolo."].join("\n");
  const s = locateBibliography(doc);
  expect(s.heading).toBe("Riferimenti");
  expect(s.text).toContain("Rossi");
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

test("matches a bold + numbered Markdown heading '**6. References**'", () => {
  const doc = ["body", "**6. References**", "[1] X"].join("\n");
  const s = locateBibliography(doc);
  expect(s.sectionFound).toBe(true);
  expect(s.text).toContain("[1] X");
});

test("stops at a German back-matter list after the bibliography (Tabellenverzeichnis)", () => {
  // Mirrors a real thesis: APA references under "Literaturverzeichnis", then a
  // list-of-tables. Without the stop heading, "Tabelle 1 …" rows would each
  // segment into a phantom reference.
  const doc = [
    "Literaturverzeichnis",
    "Alkanani, A. K. (2015). Alterations in Intestinal Microbiota.",
    "Zimmerman, S. (2025). Specification curve analysis.",
    "",
    "Tabellenverzeichnis",
    "Tabelle 1 - Reifungsphasen des Darmmikrobioms",
    "Tabelle 2 - Synopse der Kohortenstudien",
  ].join("\n");
  const s = locateBibliography(doc);
  expect(s.heading).toBe("Literaturverzeichnis");
  expect(s.text).toContain("Alkanani");
  expect(s.text).toContain("Zimmerman");
  expect(s.text).not.toContain("Tabellenverzeichnis");
  expect(s.text).not.toContain("Tabelle 1");
});

test("stops at an accented Abkürzungsverzeichnis (diacritic-folded match)", () => {
  const doc = [
    "Literaturverzeichnis",
    "Müller, K. (2020). Ein Titel.",
    "",
    "Abkürzungsverzeichnis",
    "SCFA",
    "T1D",
  ].join("\n");
  const s = locateBibliography(doc);
  expect(s.text).toContain("Müller");
  expect(s.text).not.toContain("SCFA");
  expect(s.text).not.toContain("T1D");
});

test("stops at a Hilfsmittelverzeichnis (AI-tools declaration) so 'Zotero'/'ChatGPT' are not refs", () => {
  const doc = [
    "Literaturverzeichnis",
    "Müller, K. (2020). Ein Titel.",
    "",
    "Hilfsmittelverzeichnis",
    "ChatGPT 5.2",
    "Zotero",
  ].join("\n");
  const s = locateBibliography(doc);
  expect(s.text).toContain("Müller");
  expect(s.text).not.toContain("ChatGPT");
  expect(s.text).not.toContain("Zotero");
});

test("stops at an English 'List of Figures' after the bibliography", () => {
  const doc = [
    "References",
    "Smith, J. (2020). A real paper.",
    "",
    "List of Figures",
    "Figure 1 - A chart",
  ].join("\n");
  const s = locateBibliography(doc);
  expect(s.text).toContain("Smith");
  expect(s.text).not.toContain("Figure 1");
});

test("stops at a German Eidesstattliche Versicherung after the bibliography", () => {
  const doc = [
    "Literaturverzeichnis",
    "Müller, K. (2020). Ein Titel.",
    "",
    "Eidesstattliche Versicherung",
    "Hiermit versichere ich …",
  ].join("\n");
  const s = locateBibliography(doc);
  expect(s.text).toContain("Müller");
  expect(s.text).not.toContain("Hiermit versichere");
});

test("stops at a French 'Liste des figures' after the bibliography", () => {
  const doc = [
    "Bibliographie",
    "Dupont, J. (2019). Un article réel.",
    "",
    "Liste des figures",
    "Figure 1 - un schéma",
  ].join("\n");
  const s = locateBibliography(doc);
  expect(s.text).toContain("Dupont");
  expect(s.text).not.toContain("Figure 1");
});

test("a standalone bare common word (Index) does NOT truncate a real bibliography", () => {
  // Guards the false-drop hazard: a reference can hard-wrap so one line equals a
  // bare common word. Such a word must NOT be a stop heading, or every reference
  // after it is dropped. Only distinctive phrases/compounds are stop headings.
  const doc = [
    "References",
    "Smith, J. (2020). A paper about the Index of biodiversity. Journal X.",
    "Index",
    "Jones, A. (2021). Another real paper. Journal Y.",
  ].join("\n");
  const s = locateBibliography(doc);
  expect(s.text).toContain("Smith");
  expect(s.text).toContain("Jones"); // not dropped by the standalone "Index" line
});

test("no heading => whole document, low confidence", () => {
  const doc = "just some text with no bibliography heading at all";
  const s = locateBibliography(doc);
  expect(s.sectionFound).toBe(false);
  expect(s.confidence).toBe("low");
  expect(s.heading).toBeNull();
  expect(s.text).toBe(doc);
});
