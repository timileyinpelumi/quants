import { test, expect } from "bun:test";
import type { RpcTransport } from "@solana/kit";
import { failover } from "../../src/chain/kit-rpc";

const httpError = (statusCode: number) => Object.assign(new Error(`http ${statusCode}`), { context: { statusCode } });
const transport = (calls: string[], name: string, result: () => unknown) =>
  (async () => { calls.push(name); return result(); }) as unknown as RpcTransport;

test("a rate limit, a server error or a network failure moves on to the next provider", async () => {
  const calls: string[] = [];
  const t = failover([
    transport(calls, "infura", () => { throw httpError(429); }),
    transport(calls, "alchemy", () => { throw httpError(503); }),
    transport(calls, "flaky", () => { throw new TypeError("fetch failed"); }),
    transport(calls, "helius", () => ({ result: 7 })),
  ]);
  expect(await t({ payload: {} } as any)).toEqual({ result: 7 });
  expect(calls).toEqual(["infura", "alchemy", "flaky", "helius"]);
});

test("a client error is final and the last error surfaces when every provider fails", async () => {
  const calls: string[] = [];
  await expect(failover([transport(calls, "a", () => { throw httpError(400); }), transport(calls, "b", () => ({}))])({ payload: {} } as any)).rejects.toThrow("http 400");
  expect(calls).toEqual(["a"]);
  await expect(failover([transport([], "a", () => { throw httpError(429); }), transport([], "b", () => { throw httpError(429); })])({ payload: {} } as any)).rejects.toThrow("http 429");
});
