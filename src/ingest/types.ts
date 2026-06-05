export interface Ingester {
  canHandle(filename: string, bytes: Uint8Array): boolean;
  /** Whole-document plain text. */
  extractText(bytes: Uint8Array): Promise<string>;
}
