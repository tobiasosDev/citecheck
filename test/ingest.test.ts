import { test, expect } from "bun:test";
import { textIngester } from "../src/ingest/text.js";

test("textIngester handles .txt and .md, not .docx", () => {
  expect(textIngester.canHandle("a.txt", new Uint8Array())).toBe(true);
  expect(textIngester.canHandle("a.md", new Uint8Array())).toBe(true);
  expect(textIngester.canHandle("a.docx", new Uint8Array())).toBe(false);
});

test("textIngester decodes utf8 bytes", async () => {
  const bytes = new TextEncoder().encode("Grüße — héllo");
  expect(await textIngester.extractText(bytes)).toBe("Grüße — héllo");
});
