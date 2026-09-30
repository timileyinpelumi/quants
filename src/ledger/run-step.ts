import type { SQL } from "bun";
import type { ChainPort, SignedTx } from "../chain/port";
import { beginStep, confirmStep, failStep, markSent, resetToPending, type Delta, type DeltaResolver, type StepInput, type StepRow } from "./ledger";

export const MAX_ATTEMPTS = 5;
export type Outcome = "confirmed" | "failed" | "pending";

export async function resolveSent(sql: SQL, chain: ChainPort, row: StepRow, resolve: DeltaResolver): Promise<Outcome | "expired"> {
  const sig = row.signature!;
  const st = await chain.status(sig);
  if (st === "confirmed") {
    await confirmStep(sql, row, await resolve(row, sig), { signature: sig });
    return "confirmed";
  }
  if (st === "failed") {
    await failStep(sql, row.id, "transaction failed on-chain");
    return "failed";
  }
  if ((await chain.blockHeight()) <= row.lastValidBlockHeight!) return "pending";
  if (row.attempts >= MAX_ATTEMPTS) {
    await failStep(sql, row.id, `not confirmed after ${row.attempts} attempts`);
    return "failed";
  }
  await resetToPending(sql, row.id);
  return "expired";
}

export async function runTxStep(
  sql: SQL, chain: ChainPort,
  spec: StepInput & { build: (row: StepRow) => Promise<SignedTx>; resolve: DeltaResolver },
): Promise<Outcome> {
  let row = await beginStep(sql, spec);
  if (row.status === "confirmed" || row.status === "failed") return row.status;
  if (row.status === "sent") {
    const r = await resolveSent(sql, chain, row, spec.resolve);
    if (r !== "expired") return r;
    row = { ...row, status: "pending", signature: null, lastValidBlockHeight: null };
  }
  const tx = await spec.build(row);
  await markSent(sql, row.id, tx.signature, tx.lastValidBlockHeight);
  row = { ...row, status: "sent", signature: tx.signature, lastValidBlockHeight: tx.lastValidBlockHeight, attempts: row.attempts + 1 };
  try {
    await tx.send();
  } catch {
    return "pending";
  }
  const state = await chain.waitForConfirmation(tx.signature, tx.lastValidBlockHeight);
  if (state === "confirmed") {
    await confirmStep(sql, row, await spec.resolve(row, tx.signature), { signature: tx.signature });
    return "confirmed";
  }
  if (state === "failed") {
    await failStep(sql, row.id, "transaction failed on-chain");
    return "failed";
  }
  return "pending";
}

export async function runDbStep(sql: SQL, spec: StepInput & { deltas: Delta[] }): Promise<boolean> {
  const row = await beginStep(sql, spec);
  if (row.status !== "pending") return false;
  return confirmStep(sql, row, spec.deltas);
}
