import { test, expect } from "bun:test";
import { RpcHistory } from "../../src/indexer/history";

const ADDR = "11111111111111111111111111111111";

test("a cursor the RPC no longer knows falls back to recent history instead of failing every pass", async () => {
  const calls: any[] = [];
  const conn = {
    async getSignaturesForAddress(_a: unknown, o: { until?: string }) {
      calls.push(o);
      if (o.until) throw new Error("failed to get signatures for address: Transaction pruned111 not found");
      return [{ signature: "s3", blockTime: 3 }, { signature: "s2", blockTime: 2 }];
    },
  };
  const h = new RpcHistory(conn as any);
  expect(await h.signaturesSince(ADDR, "pruned111")).toEqual([{ signature: "s2", blockTime: 2 }, { signature: "s3", blockTime: 3 }]);
  expect(calls.map((c) => c.until)).toEqual(["pruned111", undefined]);
});

test("other RPC errors still fail the pass", async () => {
  const conn = { async getSignaturesForAddress() { throw new Error("429 Too Many Requests"); } };
  await expect(new RpcHistory(conn as any).signaturesSince(ADDR, "x")).rejects.toThrow("429");
});
