import { test, expect } from "bun:test";
import { waitForSignature } from "../../src/web/server/settle";

const conn = (seq: any[]) => {
  let i = 0;
  return { calls: () => i, async getSignatureStatuses() { const v = seq[Math.min(i++, seq.length - 1)]; if (v instanceof Error) throw v; return { value: [v] }; } } as any;
};

test("waits until the signature is confirmed", async () => {
  const c = conn([null, null, { confirmationStatus: "confirmed", err: null }]);
  expect(await waitForSignature(c, "sig", { timeoutMs: 5000, pollMs: 1 })).toBe("confirmed");
  expect(c.calls()).toBe(3);
});

test("a failed transaction is reported as failed", async () => {
  expect(await waitForSignature(conn([{ confirmationStatus: "confirmed", err: { InstructionError: [0, 1] } }]), "sig", { timeoutMs: 5000, pollMs: 1 })).toBe("failed");
});

test("RPC errors are retried until the time runs out, then it says pending", async () => {
  const c = conn([new Error("429"), null]);
  expect(await waitForSignature(c, "sig", { timeoutMs: 30, pollMs: 5 })).toBe("pending");
  expect(c.calls()).toBeGreaterThan(1);
});
