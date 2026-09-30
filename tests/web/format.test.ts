import { test, expect } from "bun:test";
import { fmtAmount, fmtCompact, shortAddr, avatarGradient } from "../../src/web/ui/format";

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
