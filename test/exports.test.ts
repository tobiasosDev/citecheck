import { test, expect } from "bun:test";
import { verifyReference } from "../src/index.js";
import { MAX_REFS } from "../src/document.js";

test("verifyReference is exported as a function", () => {
  expect(typeof verifyReference).toBe("function");
});

test("MAX_REFS is exported as 200", () => {
  expect(MAX_REFS).toBe(200);
});
