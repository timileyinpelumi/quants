import { test, expect } from "bun:test";

test("health reports the database answers", async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { GET } = await import("../../src/app/api/health/route");
  const r = await GET();
  expect(await r.json()).toEqual({ ok: true });
});
