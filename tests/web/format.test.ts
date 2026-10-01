import { test, expect } from "bun:test";
import { fmtAmount, fmtCompact, fmtPrice, fmtAgo, shortAddr, avatarGradient } from "../../src/web/ui/format";

test("fmtAmount formats base units", () => {
  expect(fmtAmount(4_812_330_000_000n, 6)).toBe("4,812,330");
  expect(fmtAmount("1500000000", 9)).toBe("1.5");
  expect(fmtAmount(412_000_000n, 9, 3)).toBe("0.412");
  expect(fmtAmount(0n, 6)).toBe("0");
});
test("fmtCompact", () => {
  expect(fmtCompact(41_200_000)).toBe("41.2M");
  expect(fmtCompact(418_000)).toBe("418K");
  expect(fmtCompact(950)).toBe("950");
});
test("shortAddr", () => expect(shortAddr("7xKqAbCdEfGhf3Ra")).toBe("7xKq…f3Ra"));
test("avatarGradient is stable per seed", () => {
  expect(avatarGradient("mintA")).toEqual(avatarGradient("mintA"));
  expect(avatarGradient("mintA")).not.toEqual(avatarGradient("mintB"));
});

test("fmtPrice keeps three significant digits without exponents", () => {
  expect(fmtPrice(12.345)).toBe("12.35");
  expect(fmtPrice(0.5)).toBe("0.5");
  expect(fmtPrice(0.000123456)).toBe("0.000123");
  expect(fmtPrice(0.00000008)).toBe("0.00000008");
  expect(fmtPrice(0)).toBe("0");
  expect(fmtPrice(0.0000125678, 5)).toBe("0.000012568");
});

test("fmtAgo", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");
  expect(fmtAgo("2026-10-01T11:59:40Z", now)).toBe("just now");
  expect(fmtAgo("2026-10-01T11:55:00Z", now)).toBe("5m ago");
  expect(fmtAgo("2026-10-01T09:00:00Z", now)).toBe("3h ago");
  expect(fmtAgo("2026-09-28T12:00:00Z", now)).toBe("3d ago");
});
