import { test, expect, mock } from "bun:test";
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

test("docxIngester.canHandle requires .docx extension AND zip magic bytes", async () => {
  const { docxIngester } = await import("../src/ingest/docx.js");
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  expect(docxIngester.canHandle("a.docx", zip)).toBe(true);
  expect(docxIngester.canHandle("a.docx", new Uint8Array([0, 0, 0, 0]))).toBe(false);
  expect(docxIngester.canHandle("a.txt", zip)).toBe(false);
});

test("docxIngester extracts raw text via mammoth", async () => {
  mock.module("mammoth", () => ({
    extractRawText: async (_input: unknown) => ({ value: "Hello from docx", messages: [] }),
  }));
  const { docxIngester } = await import("../src/ingest/docx.js");
  const out = await docxIngester.extractText(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
  expect(out).toBe("Hello from docx");
});

import { extractDocumentText, formatOf } from "../src/ingest/index.js";

test("formatOf maps extensions", () => {
  expect(formatOf("a.docx")).toBe("docx");
  expect(formatOf("a.md")).toBe("md");
  expect(formatOf("a.markdown")).toBe("md");
  expect(formatOf("a.txt")).toBe("txt");
  expect(formatOf("a.pdf")).toBeNull();
});

test("extractDocumentText routes a .txt through the text ingester", async () => {
  const bytes = new TextEncoder().encode("hello doc");
  expect(await extractDocumentText({ bytes, filename: "x.txt" })).toBe("hello doc");
});

test("extractDocumentText throws on an unsupported format", async () => {
  await expect(
    extractDocumentText({ bytes: new Uint8Array(), filename: "x.pdf" }),
  ).rejects.toThrow(/unsupported/i);
});
