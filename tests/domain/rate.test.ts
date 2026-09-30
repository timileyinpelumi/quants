import { test, expect } from "bun:test";
import { kaminoRawRps } from "../../src/domain/rate";

test("raw rps scales base units per second by rps decimals", () => {
  expect(kaminoRawRps(86_400_000_000n, 86_400, 0)).toBe(1_000_000n);
  expect(kaminoRawRps(1n, 86_400, 9)).toBe(11_574n);
});

test("raw rps rejects a non-positive period", () => {
  expect(() => kaminoRawRps(1n, 0, 0)).toThrow();
});
