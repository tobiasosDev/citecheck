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

// ---------------------------------------------------------------------------
// Zip-bomb guard tests
// ---------------------------------------------------------------------------

/**
 * Build a minimal in-memory ZIP buffer containing one central-directory entry
 * (no actual compressed data) and a matching EOCD record.
 *
 * Layout: [46-byte CD entry][22-byte EOCD]
 *
 * @param uncompressedSize  The value to write into the CD entry's
 *                          uncompressed-size field (uint32 LE, entry offset +24).
 */
function buildMinimalZipCD(uncompressedSize: number): Uint8Array {
  // Total: 46 (CD entry) + 22 (EOCD) = 68 bytes.
  const buf = new ArrayBuffer(68);
  const v = new DataView(buf);
  const CD_OFFSET = 0;
  const EOCD_OFFSET = 46;

  // --- Central-directory entry ---
  // Signature PK\x01\x02
  v.setUint8(CD_OFFSET + 0, 0x50);
  v.setUint8(CD_OFFSET + 1, 0x4b);
  v.setUint8(CD_OFFSET + 2, 0x01);
  v.setUint8(CD_OFFSET + 3, 0x02);
  // Uncompressed size at +24 (uint32 LE)
  v.setUint32(CD_OFFSET + 24, uncompressedSize, /*littleEndian=*/true);
  // name/extra/comment lengths at +28/+30/+32 all 0 (zero-initialised)

  // --- End Of Central Directory record ---
  // Signature PK\x05\x06
  v.setUint8(EOCD_OFFSET + 0, 0x50);
  v.setUint8(EOCD_OFFSET + 1, 0x4b);
  v.setUint8(EOCD_OFFSET + 2, 0x05);
  v.setUint8(EOCD_OFFSET + 3, 0x06);
  // Total entry count (disk + total) at +8/+10 — uint16 LE = 1
  v.setUint16(EOCD_OFFSET + 8, 1, true);
  v.setUint16(EOCD_OFFSET + 10, 1, true);
  // CD offset at +16 — uint32 LE = 0 (CD starts at byte 0)
  v.setUint32(EOCD_OFFSET + 16, CD_OFFSET, true);

  return new Uint8Array(buf);
}

test("zip-bomb guard rejects ZIP whose total uncompressed size exceeds the cap", async () => {
  const { docxIngester } = await import("../src/ingest/docx.js");
  // 0x0D000000 = 218,103,808 bytes ≈ 208 MB — just over the 200 MB cap
  const oversized = buildMinimalZipCD(0x0d000000);
  await expect(docxIngester.extractText(oversized)).rejects.toThrow(/too large/i);
});

test("zip-bomb guard rejects a ZIP64 EOCD sentinel instead of failing open", async () => {
  const { docxIngester } = await import("../src/ingest/docx.js");
  // A single small, in-cap entry, but the EOCD CD-offset field is the ZIP64
  // sentinel 0xFFFFFFFF — the real central directory lives in a ZIP64 record we
  // don't parse, so the guard must reject (treat as unbounded), not fail open.
  const zip = buildMinimalZipCD(1024);
  new DataView(zip.buffer).setUint32(46 + 16, 0xffffffff, true); // EOCD cdOffset
  await expect(docxIngester.extractText(zip)).rejects.toThrow(/too large/i);
});

test("zip-bomb guard fails open on a buffer with no EOCD (4-byte ZIP magic only)", async () => {
  // Stub mammoth so the test doesn't depend on real mammoth behaviour.
  mock.module("mammoth", () => ({
    extractRawText: async (_input: unknown) => ({ value: "ok", messages: [] }),
  }));
  const { docxIngester } = await import("../src/ingest/docx.js");
  // The 4-byte-magic buffer has no EOCD — guard must NOT throw the size error.
  const noEocd = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  // Guard fails open → mammoth stub runs → resolves to "ok"
  await expect(docxIngester.extractText(noEocd)).resolves.toBe("ok");
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
