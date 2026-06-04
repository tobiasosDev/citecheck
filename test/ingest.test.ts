import { test, expect, mock, afterEach } from "bun:test";
import * as realMammoth from "mammoth";
import { textIngester } from "../src/ingest/text.js";

// Best-effort teardown for the docx mammoth stub below. In Bun 1.3.12,
// mock.module overrides are scoped PER FILE (verified empirically: a stub
// installed here does NOT leak into a separate test file), so this teardown is
// hygiene, not load-bearing for cross-file isolation. Caveat: it re-registers
// the real module for FUTURE imports but does NOT restore the live binding of a
// module already imported in this file (mock.restore() doesn't either) — so any
// test added BELOW the stub test that exercises real mammoth IN THIS FILE would
// still see the stub. Keep real-mammoth tests in a separate file.
afterEach(() => { mock.module("mammoth", () => realMammoth); });

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

test("docxIngester extracts raw text via mammoth and passes a { buffer: Buffer } from the input bytes", async () => {
  let received: unknown;
  mock.module("mammoth", () => ({
    extractRawText: async (input: unknown) => {
      received = input;
      return { value: "Hello from docx", messages: [] };
    },
  }));
  const { docxIngester } = await import("../src/ingest/docx.js");
  const inputBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  const out = await docxIngester.extractText(inputBytes);
  expect(out).toBe("Hello from docx");
  // Pin the load-bearing call shape: a { buffer } wrapper whose value is a Buffer
  // derived from the input Uint8Array. A regression (raw Uint8Array, { arrayBuffer },
  // or a path) would throw against real mammoth but otherwise pass silently.
  const arg = received as { buffer?: unknown };
  expect(Buffer.isBuffer(arg.buffer)).toBe(true);
  expect(Array.from(arg.buffer as Buffer)).toEqual(Array.from(inputBytes));
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
