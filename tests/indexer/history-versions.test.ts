import { test, expect } from "bun:test";
import { RpcHistory } from "../../src/indexer/history";
import type { IndexedTx } from "../../src/indexer/run";

const POOL = "6SUaeWkYP1xgxqSuRN4heBzme5u3UCuk6LJX5qKLBNLb";
const v1 = await Bun.file("tests/fixtures/tcat-xUDzNfMF.json").json();
const legacy = await Bun.file("tests/fixtures/tcat-L3tMJZ8j.json").json();
const sigOf = (j: any) => j.result.transaction.signatures[0] as string;

function conn(results: Record<string, any>, calls: any[] = []) {
  return {
    async _rpcBatchRequest(reqs: { methodName: string; args: any[] }[]) {
      calls.push(...reqs);
      return reqs.map((r) => results[r.args[0]] ?? { result: null });
    },
  } as any;
}

test("a version 1 transaction from another app is decoded like any other swap", async () => {
  const calls: any[] = [];
  const h = new RpcHistory(conn({ [sigOf(v1)]: v1, [sigOf(legacy)]: legacy }, calls));
  const [a, b] = await h.transactions([sigOf(v1), sigOf(legacy)], POOL) as IndexedTx[];
  expect(calls[0].args[1].maxSupportedTransactionVersion).toBe(1);
  expect(a!.swaps.length).toBe(1);
  expect(a!.swaps[0]!.venue).toBe("curve");
  expect(a!.trader).toBe(v1.result.transaction.message.accountKeys[0]);
  // the legacy one is the keeper claiming fees: read fine, no swap in it
  expect(b!.swaps).toEqual([]);
  expect(b!.trader).toBe("JDsCfbCUUifkBQLpMPbsyH6UqRPjfAC21cXaqWAyxrNb");
});

test("one transaction the RPC refuses is skipped without blocking the others", async () => {
  const bad = { error: { code: -32015, message: "Transaction version (2) is not supported" } };
  const h = new RpcHistory(conn({ BAD: bad, [sigOf(v1)]: v1 }));
  const out = await h.transactions(["BAD", sigOf(v1)], POOL);
  expect(out[0]).toEqual({ signature: "BAD", unreadable: true });
  expect((out[1] as IndexedTx).swaps.length).toBe(1);
});
