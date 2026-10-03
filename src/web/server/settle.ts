import type { Connection } from "@solana/web3.js";

export type TxState = "confirmed" | "failed" | "pending";

// RETRY-LOOP-SAFETY: bounded by timeoutMs (callers pass at most ~40s so a request never hangs); an RPC error is
//   treated as "not yet" and polled again after pollMs; no unbounded loop and no retry handler underneath.
export async function waitForSignature(
  conn: Pick<Connection, "getSignatureStatuses">, signature: string, o: { timeoutMs: number; pollMs: number },
): Promise<TxState> {
  const until = Date.now() + o.timeoutMs;
  for (;;) {
    try {
      const st = (await conn.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
      if (st?.err) return "failed";
      if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return "confirmed";
    } catch {}
    if (Date.now() + o.pollMs > until) return "pending";
    await new Promise((r) => setTimeout(r, o.pollMs));
  }
}
