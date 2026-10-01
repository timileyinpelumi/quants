import { test, expect } from "bun:test";
import { z } from "zod";
import { json, jsonError, AuthError, LimitError, rateLimit, resetRateLimits, limiterSize } from "../../src/web/server/http";
import { LaunchError } from "../../src/launch/prepare";

test("json serialises bigints as strings", async () => {
  expect(await json({ a: 5n }).json()).toEqual({ a: "5" });
});

test("jsonError maps known errors", async () => {
  const cases: [unknown, number, string][] = [
    [new LaunchError("dev_buy_too_large", "too big"), 400, "dev_buy_too_large"],
    [new AuthError(401, "sign in"), 401, "unauthorized"],
    [new AuthError(403, "not admin"), 403, "forbidden"],
    [z.object({ a: z.string() }).safeParse({}).error, 400, "invalid_input"],
    [new Error("boom"), 500, "internal"],
  ];
  for (const [e, status, code] of cases) {
    const r = jsonError(e);
    expect(r.status).toBe(status);
    expect((await r.json()).error.code).toBe(code);
  }
});

const fromIp = (ip: string) => new Request("http://x", { headers: { "x-forwarded-for": ip } });

test("x-forwarded-for is ignored unless TRUST_PROXY=1", () => {
  resetRateLimits();
  delete process.env.TRUST_PROXY;
  rateLimit(fromIp("1.1.1.1"), "xff", 1);
  expect(() => rateLimit(fromIp("2.2.2.2"), "xff", 1)).toThrow(LimitError);
  resetRateLimits();
  process.env.TRUST_PROXY = "1";
  try {
    rateLimit(fromIp("1.1.1.1"), "xff", 1);
    expect(() => rateLimit(fromIp("2.2.2.2"), "xff", 1)).not.toThrow();
  } finally {
    delete process.env.TRUST_PROXY;
  }
});

test("expired limiter entries are evicted", async () => {
  resetRateLimits();
  for (let i = 0; i < 12_000; i++) rateLimit(new Request("http://x"), `b${i}`, 10, 1);
  await Bun.sleep(5);
  rateLimit(new Request("http://x"), "fresh", 10);
  expect(limiterSize()).toBeLessThan(10_001);
  for (let i = 0; i < 20_000; i++) rateLimit(new Request("http://x"), `c${i}`, 10);
  expect(limiterSize()).toBeLessThanOrEqual(10_000);
});

test("500 responses do not leak the message", async () => {
  const orig = console.error;
  console.error = () => {};
  expect((await jsonError(new Error("db password xyz")).json()).error.message).toBe("Something went wrong");
  console.error = orig;
});
