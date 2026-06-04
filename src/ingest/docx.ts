import * as mammoth from "mammoth";
import type { Ingester } from "./types.js";

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04" — a .docx is a ZIP container

export const docxIngester: Ingester = {
  canHandle(filename: string, bytes: Uint8Array): boolean {
    if (!/\.docx$/i.test(filename)) return false;
    return ZIP_MAGIC.every((b, i) => bytes[i] === b);
  },
  async extractText(bytes: Uint8Array): Promise<string> {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return value;
  },
};
