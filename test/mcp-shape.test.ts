import { test, expect } from "bun:test";
import type { CitationCheckResult, QuickCheckResult } from "../src/quick-check.js";
import {
  shapeVerify,
  summarize,
  toIssues,
  shapeReport,
  CAVEAT_NOT_FOUND,
  CAVEAT_CHECK_FAILED,
} from "../src/mcp/shape.js";

function cite(over: Partial<CitationCheckResult>): CitationCheckResult {
  return {
    key: "",
    title: "",
    status: "verified",
    crossrefMatch: null,
    openalexMatch: null,
    journalStatus: "unknown",
    retracted: false,
    warnings: [],
    ...over,
  };
}

test("shapeVerify: not_found carries the hedge caveat, not a 'fabricated' verdict", () => {
  const out = shapeVerify(cite({ status: "not_found" }));
  expect(out.status).toBe("not_found");
  expect(out.caveat).toBe(CAVEAT_NOT_FOUND);
  expect(out.interpretation).toContain("No matching record");
});

test("shapeVerify: check_failed is framed as not-a-problem", () => {
  const out = shapeVerify(cite({ status: "check_failed" }));
  expect(out.caveat).toBe(CAVEAT_CHECK_FAILED);
});

test("shapeVerify: verified has no caveat and reports open access from DOAJ", () => {
  const out = shapeVerify(cite({ status: "verified", title: "T", journalStatus: "doaj_listed" }));
  expect(out.caveat).toBeUndefined();
  expect(out.openAccess).toBe(true);
  expect(out.matchedTitle).toBe("T");
});

test("summarize: counts each verdict, retracted, and open access", () => {
  const s = summarize([
    cite({ status: "verified" }),
    cite({ status: "verified", retracted: true }),
    cite({ status: "not_found" }),
    cite({ status: "check_failed" }),
    cite({ status: "verified", journalStatus: "doaj_listed" }),
  ]);
  expect(s).toEqual({
    total: 5, verified: 3, partial: 0, not_found: 1, suspicious: 0,
    check_failed: 1, retracted: 1, open_access: 1,
  });
});

test("toIssues: excludes verified-clean and check_failed; includes retracted-even-if-verified", () => {
  const issues = toIssues([
    cite({ key: "ok", status: "verified" }),
    cite({ key: "net", status: "check_failed" }),
    cite({ key: "gone", status: "not_found" }),
    cite({ key: "pulled", status: "verified", retracted: true }),
  ]);
  expect(issues.map((i) => i.key)).toEqual(["gone", "pulled"]);
  expect(issues.find((i) => i.key === "pulled")?.note).toBe("RETRACTED");
});

test("shapeReport: collapses verified to a count, uses detectedTotal for total", () => {
  const result: QuickCheckResult = {
    citations: [cite({ key: "a", status: "verified" }), cite({ key: "b", status: "not_found" })],
    checkedAt: "t",
  };
  const out = shapeReport(result, { truncated: true, detectedTotal: 250 });
  expect(out.summary.total).toBe(250);
  expect(out.summary.verified).toBe(1);
  expect(out.truncated).toBe(true);
  expect(out.issues.length).toBe(1);
  expect(out.caveat).toBe(CAVEAT_NOT_FOUND);
});

test("toIssues: partial_match notes carry the 'sloppy entry' reassurance", () => {
  const issues = toIssues([
    cite({ key: "p", status: "partial_match", warnings: ["Title differs from Crossref record."] }),
  ]);
  expect(issues[0]?.note).toContain("sloppy entry");
  expect(issues[0]?.note).toContain("Title differs"); // keeps the specific signal too
});
