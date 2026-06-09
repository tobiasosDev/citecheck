#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { VERSION } from "./http.js";
import { runVerifyReference, runCheckBibliography, runCheckDocument } from "./mcp/tools.js";

function jsonResult(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

function errorResult(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: msg }], isError: true };
}

const server = new McpServer({ name: "citecheck", version: VERSION });

server.registerTool(
  "verify_reference",
  {
    title: "Verify a single reference",
    description:
      "Check whether ONE citation is a real, non-retracted work. Pass a free-text reference string, a DOI, " +
      'or a title. A "not found" result means citecheck could not MATCH the reference — it is NOT proof the ' +
      "work is fabricated (preprints, books, grey literature and non-English sources are under-represented). " +
      "Only the reference string is sent to the public scholarly APIs (Crossref/OpenAlex/DOAJ).",
    inputSchema: {
      ref: z.string().describe("A reference string, DOI, or title to verify."),
      mailto: z.string().optional().describe("Email for the Crossref/OpenAlex polite pool (faster rate limits)."),
    },
  },
  async ({ ref, mailto }) => {
    try {
      return jsonResult(await runVerifyReference({ ref, mailto }));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "check_bibliography",
  {
    title: "Check a bibliography export",
    description:
      "Verify every reference in a .bib / .ris / CSL-JSON bibliography. Provide `path` (a file on disk) OR " +
      "`content` (the file's text). Returns summary counts plus only the problem references; verified-clean " +
      "ones are collapsed to a count. Capped at 200 references.",
    inputSchema: {
      path: z.string().optional().describe("Path to a .bib/.ris/.json file on disk."),
      content: z.string().optional().describe("Inline bibliography text (alternative to path)."),
      format: z.enum(["bib", "ris", "csljson"]).optional().describe("Force the format when passing inline content."),
      mailto: z.string().optional().describe("Email for the Crossref/OpenAlex polite pool."),
    },
  },
  async ({ path, content, format, mailto }) => {
    try {
      return jsonResult(await runCheckBibliography({ path, content, format, mailto }));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "check_document",
  {
    title: "Check a document's bibliography",
    description:
      "Extract the bibliography from a .docx / .txt / .md document on disk and verify each reference. " +
      "Extraction happens locally; only reference strings are sent to the public scholarly APIs. Always " +
      "confirm the detected reference count matches your bibliography — segmentation is best-effort.",
    inputSchema: {
      path: z.string().describe("Path to a .docx/.txt/.md document on disk."),
      mailto: z.string().optional().describe("Email for the Crossref/OpenAlex polite pool."),
    },
  },
  async ({ path, mailto }) => {
    try {
      return jsonResult(await runCheckDocument({ path, mailto }));
    } catch (err) {
      return errorResult(err);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
