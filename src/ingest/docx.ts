import * as mammoth from "mammoth";
import type { Ingester } from "./types.js";

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04" — a .docx is a ZIP container

/**
 * Maximum total uncompressed size (in bytes) summed across all ZIP entries.
 * Generous enough for image-heavy theses, small enough to prevent OOM from a
 * zip-bomb payload that fits inside the MAX_INPUT_BYTES compressed cap.
 */
export const MAX_DOCX_UNCOMPRESSED = 200 * 1024 * 1024; // 200 MB

/**
 * Read a little-endian uint16 from `buf` at absolute byte index `offset`.
 * Returns 0 for any out-of-bounds read (fail-open).
 */
function readUint16LE(buf: Uint8Array, offset: number): number {
  if (offset + 1 >= buf.length) return 0;
  return (buf[offset]! | (buf[offset + 1]! << 8)) & 0xffff;
}

/**
 * Read a little-endian uint32 from `buf` at absolute byte index `offset`.
 * Returns 0 for any out-of-bounds read (fail-open).
 */
function readUint32LE(buf: Uint8Array, offset: number): number {
  if (offset + 3 >= buf.length) return 0;
  return (
    ((buf[offset]! |
      (buf[offset + 1]! << 8) |
      (buf[offset + 2]! << 16) |
      (buf[offset + 3]! << 24)) >>>
      0)
  );
}

/**
 * Inspect the ZIP central directory (without decompressing) and throw if the
 * total uncompressed size of all entries exceeds MAX_DOCX_UNCOMPRESSED.
 *
 * Fail-open contract: if anything about the parse is ambiguous or the buffer
 * is not a recognisable ZIP, this function returns without throwing — mammoth
 * will then produce its own "not a valid docx" error. Only throws when it has
 * positively read a central directory whose summed uncompressed size exceeds
 * the cap, or when a ZIP64 sentinel (0xFFFFFFFF) is encountered.
 */
function rejectIfZipBomb(bytes: Uint8Array): void {
  let total = 0;

  try {
    // Step 1: locate the End Of Central Directory (EOCD) record by scanning
    // backwards for its 4-byte signature PK\x05\x06.
    const EOCD_SIG_0 = 0x50;
    const EOCD_SIG_1 = 0x4b;
    const EOCD_SIG_2 = 0x05;
    const EOCD_SIG_3 = 0x06;
    const EOCD_MIN_SIZE = 22;
    const SCAN_LIMIT = Math.min(bytes.length, 65557 + EOCD_MIN_SIZE);

    let eocdOffset = -1;
    for (let i = bytes.length - EOCD_MIN_SIZE; i >= bytes.length - SCAN_LIMIT; i--) {
      if (
        bytes[i] === EOCD_SIG_0 &&
        bytes[i + 1] === EOCD_SIG_1 &&
        bytes[i + 2] === EOCD_SIG_2 &&
        bytes[i + 3] === EOCD_SIG_3
      ) {
        eocdOffset = i;
        break;
      }
    }

    if (eocdOffset === -1) {
      // Not a parseable ZIP — fail-open
      return;
    }

    // Step 2: read entry count and central-directory offset from EOCD.
    const entryCount = readUint16LE(bytes, eocdOffset + 10);
    const cdOffset = readUint32LE(bytes, eocdOffset + 16);

    if (entryCount === 0) return; // empty ZIP — fine

    // Step 3: walk central directory entries.
    const CD_ENTRY_SIG_0 = 0x50;
    const CD_ENTRY_SIG_1 = 0x4b;
    const CD_ENTRY_SIG_2 = 0x01;
    const CD_ENTRY_SIG_3 = 0x02;
    const CD_ENTRY_FIXED = 46;
    const ZIP64_SENTINEL = 0xffffffff;

    let pos = cdOffset;
    for (let i = 0; i < entryCount; i++) {
      // Verify signature — fail-open if it doesn't match
      if (
        bytes[pos] !== CD_ENTRY_SIG_0 ||
        bytes[pos + 1] !== CD_ENTRY_SIG_1 ||
        bytes[pos + 2] !== CD_ENTRY_SIG_2 ||
        bytes[pos + 3] !== CD_ENTRY_SIG_3
      ) {
        // Stop walking, use what we have
        break;
      }

      const uncompressedSize = readUint32LE(bytes, pos + 24);

      // ZIP64 sentinel — true size is in an extra field we won't parse. Reject.
      if (uncompressedSize === ZIP64_SENTINEL) {
        total = Infinity;
        break;
      }

      total += uncompressedSize;

      // Advance past this entry's fixed header + variable-length fields.
      const nameLen = readUint16LE(bytes, pos + 28);
      const extraLen = readUint16LE(bytes, pos + 30);
      const commentLen = readUint16LE(bytes, pos + 32);
      pos += CD_ENTRY_FIXED + nameLen + extraLen + commentLen;
    }
  } catch {
    // Any parse error → fail-open
    return;
  }

  if (total > MAX_DOCX_UNCOMPRESSED) {
    throw new Error("Document too large to process safely (decompressed size exceeds limit).");
  }
}

export const docxIngester: Ingester = {
  canHandle(filename: string, bytes: Uint8Array): boolean {
    if (!/\.docx$/i.test(filename)) return false;
    return ZIP_MAGIC.every((b, i) => bytes[i] === b);
  },
  async extractText(bytes: Uint8Array): Promise<string> {
    rejectIfZipBomb(bytes);
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return value;
  },
};
