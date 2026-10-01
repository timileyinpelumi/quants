import { test, expect } from "bun:test";
import { z } from "zod";
import { json, jsonError, AuthError } from "../../src/web/server/http";
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

test("500 responses do not leak the message", async () => {
  const orig = console.error;
  console.error = () => {};
  expect((await jsonError(new Error("db password xyz")).json()).error.message).toBe("Something went wrong. Try again.");
  console.error = orig;
});
