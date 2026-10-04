import { test, expect } from "bun:test";
import { rawToUi, uiToRaw } from "../../src/web/ui/scaled";

test("scaled UI amounts convert both ways and never round up", () => {
  expect(rawToUi(100n)).toBe(100n);
  expect(rawToUi(100n, 1.05)).toBe(105n);
  expect(uiToRaw(105n, 1.05)).toBe(100n);
  expect(uiToRaw(rawToUi(333n, 1.07), 1.07)).toBeLessThanOrEqual(333n);
  expect(rawToUi(10n ** 8n, 1.0234)).toBe(102_340_000n);
});
