import type { SQL } from "bun";
import type { ChainPort, SignedTx } from "../chain/port";
import {
  beginStep, confirmStep, failStep, failuresSinceConfirmed, markSent, resetToPending, retryFailed, sentSignatures, sentSinceConfirmed,
  type Delta, type DeltaResolver, type StepInput, type StepRow,
} from "./ledger";

export const MAX_ATTEMPTS = 5;
export type Outcome = "confirmed" | "failed" | "pending";

interface Survey { landed?: { row: StepRow; signature: string }; failed: Set<string>; live: boolean }

// Height is read before any status, so an unknown status for a signature whose blockhash expired by that height is final.
async function survey(chain: ChainPort, rows: StepRow[]): Promise<Survey> {
  const height = await chain.blockHeight();
  const failed = new Set<string>();
  let live = false;
  for (const row of rows) {
    for (const s of sentSignatures(row)) {
      const st = await chain.status(s.signature);
      if (st === "confirmed") return { landed: { row, signature: s.signature }, failed, live };
      if (st === "failed") failed.add(s.signature);
      else if (height <= s.lastValidBlockHeight) live = true;
    }
  }
  return { failed, live };
}

export async function resolveSent(sql: SQL, chain: ChainPort, row: StepRow, resolve: DeltaResolver): Promise<Outcome | "expired"> {
  const sv = await survey(chain, [row]);
  if (sv.landed) {
    await confirmStep(sql, row, await resolve(row, sv.landed.signature), { signature: sv.landed.signature });
    return "confirmed";
  }
  if (sv.failed.has(row.signature!)) {
    await failStep(sql, row.id, "transaction failed on-chain");
    return "failed";
  }
  if (sv.live) return "pending";
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
  if (spec.stepKey && spec.stepKey !== spec.idemKey && (await failuresSinceConfirmed(sql, spec.stepKey)) >= MAX_ATTEMPTS) return "failed";
  let row = await beginStep(sql, spec);
  if (row.status === "confirmed") return "confirmed";
  if (row.status === "failed") {
    if (row.attempts >= MAX_ATTEMPTS) return "failed";
    await retryFailed(sql, row.id);
    row = { ...row, status: "pending", signature: null, lastValidBlockHeight: null };
  }
  if (row.status === "sent") {
    const r = await resolveSent(sql, chain, row, spec.resolve);
    if (r !== "expired") return r;
    row = { ...row, status: "pending", signature: null, lastValidBlockHeight: null };
  }
  // Every earlier send of this logical step must be provably dead before a new one is built.
  const prior = await sentSinceConfirmed(sql, spec.stepKey ?? spec.idemKey);
  if (prior.length) {
    const sv = await survey(chain, prior);
    if (sv.landed) {
      const { row: r, signature } = sv.landed;
      await confirmStep(sql, r, await spec.resolve(r, signature), { signature }, true);
      return r.id === row.id ? "confirmed" : "pending";
    }
    if (sv.live) return "pending";
  }
  let tx: SignedTx;
  try {
    tx = await spec.build(row);
  } catch (e) {
    await failStep(sql, row.id, `build failed: ${e}`, true);
    return "failed";
  }
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
