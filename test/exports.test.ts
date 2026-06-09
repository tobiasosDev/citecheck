import { test, expect } from "bun:test";
import { verifyReference, MAX_REFS } from "../src/index.js";

test("verifyReference is exported from the package entrypoint as a function", () => {
  expect(typeof verifyReference).toBe("function");
});

test("MAX_REFS is exported from the package entrypoint as 200", () => {
  expect(MAX_REFS).toBe(200);
});
