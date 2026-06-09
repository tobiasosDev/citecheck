import { test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { mock } from "bun:test";
import type { CitationCheckResult, QuickCheckResult } from "../src/quick-check.js";

// Mutable stubs the mocked modules call at invocation time. Each test assigns
// the behavior it needs before calling the handler.
//
// ISOLATION NOTE (Bun 1.3.12): mock.module patches live ESM bindings globally —
// all files in the same test process see the patched export, even if they imported
// the module before the mock was installed. To avoid contaminating
// match-network.test.ts (which has a direct top-level binding to checkFreeTextRef),
// every stub defaults to the real implementation and is reset to the real
// implementation after each test via afterEach. Tests only override the stub for
// the duration of a single test.
let stubCheckFreeTextRef: (raw: string) => Promise<CitationCheckResult>;
let stubQuickCheck: (items: unknown[]) => Promise<QuickCheckResult>;
let stubCheckDocument: (input: unknown) => Promise<unknown>;

let runVerifyReference: (input: { ref: string; mailto?: string }) => Promise<unknown>;
let runCheckBibliography: (input: { path?: string; content?: string; format?: string; mailto?: string }) => Promise<unknown>;
let runCheckDocument: (input: { path: string; mailto?: string }) => Promise<unknown>;

// Real functions captured in beforeAll; needed to initialise stubs and restore
// after tests.
let realCheckFreeTextRef: (raw: string) => Promise<CitationCheckResult>;
let realQuickCheck: (items: Parameters<typeof import("../src/quick-check.js")["quickCheck"]>[0]) => Promise<QuickCheckResult>;
let realCheckDocument: (input: Parameters<typeof import("../src/document.js")["checkDocument"]>[0]) => Promise<unknown>;

beforeAll(async () => {
  // Capture real modules BEFORE installing stubs.
  const realMatchMod = await import("../src/references/match.js");
  const realQuickCheckMod = await import("../src/quick-check.js");
  const realDocumentMod = await import("../src/document.js");

  realCheckFreeTextRef = realMatchMod.checkFreeTextRef;
  realQuickCheck = realQuickCheckMod.quickCheck;
  realCheckDocument = realDocumentMod.checkDocument;

  // Default stubs delegate to the real implementations so that if other test
  // files' direct bindings call through our stub (due to Bun 1.3.12's live ESM
  // patching), they still get correct behaviour.
  stubCheckFreeTextRef = (raw) => realCheckFreeTextRef(raw);
  stubQuickCheck = (items) => realQuickCheck(items);
  stubCheckDocument = (input) => realCheckDocument(input as Parameters<typeof realCheckDocument>[0]);

  // Install ALL engine mocks BEFORE tools.js is imported below.
  mock.module("../src/references/match.js", () => ({
    ...realMatchMod,
    checkFreeTextRef: (raw: string) => stubCheckFreeTextRef(raw),
  }));
  mock.module("../src/quick-check.js", () => ({
    ...realQuickCheckMod,
    quickCheck: (items: unknown[]) => stubQuickCheck(items as Parameters<typeof realQuickCheck>[0]),
  }));
  mock.module("../src/document.js", () => ({
    ...realDocumentMod,
    MAX_INPUT_BYTES: 10 * 1024 * 1024,
    MAX_REFS: 200,
    tooLargeMessage: (n: number) => `too large ${n}`,
    checkDocument: (input: unknown) => stubCheckDocument(input),
  }));

  const tools = await import("../src/mcp/tools.js");
  runVerifyReference = tools.runVerifyReference;
  runCheckBibliography = tools.runCheckBibliography;
  runCheckDocument = tools.runCheckDocument;

  // Restore real modules after all tests in this file complete.
  afterAll(() => {
    mock.module("../src/references/match.js", () => realMatchMod);
    mock.module("../src/quick-check.js", () => realQuickCheckMod);
    mock.module("../src/document.js", () => realDocumentMod);
  });
});

// After each test, reset stubs to pass-through so that concurrent test files
// that call checkFreeTextRef through our patched binding see the real function.
afterEach(() => {
  if (realCheckFreeTextRef) stubCheckFreeTextRef = (raw) => realCheckFreeTextRef(raw);
  if (realQuickCheck) stubQuickCheck = (items) => realQuickCheck(items);
  if (realCheckDocument) stubCheckDocument = (input) => realCheckDocument(input as Parameters<typeof realCheckDocument>[0]);
});

function cite(over: Partial<CitationCheckResult>): CitationCheckResult {
  return {
    key: "", title: "", status: "verified", crossrefMatch: null, openalexMatch: null,
    journalStatus: "unknown", retracted: false, warnings: [], ...over,
  };
}

test("runVerifyReference maps a not_found engine result to the hedged shape", async () => {
  stubCheckFreeTextRef = async (raw) => cite({ status: "not_found", sourceRef: raw });
  const out = await runVerifyReference({ ref: "Nobody (2099). Fake." }) as { status: string; caveat: string };
  expect(out.status).toBe("not_found");
  expect(out.caveat).toContain("fabricated");
});

test("runCheckBibliography caps at MAX_REFS and reports the true detected total", async () => {
  let received = -1;
  stubQuickCheck = async (items) => {
    received = (items as unknown[]).length;
    return {
      citations: (items as { id: string; title: string }[]).map((i) =>
        cite({ key: i.id, title: i.title, status: "verified" })),
      checkedAt: "t",
    };
  };
  const entries = Array.from({ length: 201 }, (_, i) => ({ id: `k${i}`, title: `T${i}`, type: "article-journal" }));
  const out = await runCheckBibliography({ content: JSON.stringify(entries) }) as { truncated: boolean; summary: { total: number } };
  expect(received).toBe(200);          // engine only saw the capped slice
  expect(out.truncated).toBe(true);
  expect(out.summary.total).toBe(201); // but the report shows the true count
});

test("runCheckBibliography throws when neither path nor content is given", async () => {
  await expect(runCheckBibliography({})).rejects.toThrow(/path|content/i);
});

test("runCheckDocument reads the file and maps the extraction block", async () => {
  stubCheckDocument = async () => ({
    extraction: { format: "docx", sectionFound: true, referencesDetected: 3, referencesChecked: 3, confidence: "high", truncated: false },
    result: {
      citations: [
        cite({ title: "Real", status: "verified", sourceRef: "Real (2020)" }),
        cite({ status: "not_found", warnings: ["No matching record"], sourceRef: "Fake (2099)" }),
      ],
      checkedAt: "t",
    },
  });
  const out = await runCheckDocument({ path: "package.json" }) as { extraction: { detected: number }; summary: { total: number }; issues: { sourceRef: string }[] }; // any small existing file; bytes are ignored by the mock
  expect(out.extraction?.detected).toBe(3);
  expect(out.summary.total).toBe(3);
  expect(out.issues.length).toBe(1);
  expect(out.issues[0]?.sourceRef).toBe("Fake (2099)");
});
