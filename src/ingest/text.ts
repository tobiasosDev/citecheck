import type { Ingester } from "./types.js";

export const textIngester: Ingester = {
  canHandle(filename: string): boolean {
    return /\.(txt|md|markdown)$/i.test(filename);
  },
  async extractText(bytes: Uint8Array): Promise<string> {
    return new TextDecoder("utf-8").decode(bytes);
  },
};
