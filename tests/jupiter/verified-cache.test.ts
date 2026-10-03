import { test, expect } from "bun:test";
import { freshDb } from "../helpers/db";
import { withVerifiedCache } from "../../src/jupiter/verified-cache";
import type { JupiterPort } from "../../src/jupiter/port";

const port = (calls: string[]): JupiterPort => ({
  async isVerified(m: string) { calls.push(m); return m !== "BAD"; },
  async searchVerified() { return [{ mint: "SEEN", symbol: "S", name: "S", icon: null, decimals: 6, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }]; },
  async popularVerified() { return []; },
} as unknown as JupiterPort);

test("a token verified once is never looked up again, even by a fresh process", async () => {
  const sql = await freshDb();
  const calls: string[] = [];
  const a = withVerifiedCache(port(calls), sql);
  expect(await a.isVerified("GOOD")).toBe(true);
  expect(await a.isVerified("GOOD")).toBe(true);
  expect(calls).toEqual(["GOOD"]);
  await Bun.sleep(50);
  const b = withVerifiedCache(port(calls), sql);
  expect(await b.isVerified("GOOD")).toBe(true);
  expect(calls).toEqual(["GOOD"]);
});

test("tokens shown as verified in search are trusted without a lookup; unverified ones are asked each time", async () => {
  const sql = await freshDb();
  const calls: string[] = [];
  const a = withVerifiedCache(port(calls), sql);
  await a.searchVerified("s");
  expect(await a.isVerified("SEEN")).toBe(true);
  expect(await a.isVerified("BAD")).toBe(false);
  expect(await a.isVerified("BAD")).toBe(false);
  expect(calls).toEqual(["BAD", "BAD"]);
});
