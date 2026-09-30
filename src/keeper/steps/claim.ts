import type { KeeperDeps } from "../deps";
import type { LaunchRow } from "../launch-row";
import type { VersionedSettings } from "../../domain/settings";
import { runTxStep, type Outcome } from "../../ledger/run-step";
import type { DeltaResolver } from "../../ledger/ledger";

export const claimResolver = (deps: KeeperDeps): DeltaResolver => async (row, sig) => {
  const mint = row.detail.quoteMint as string;
  const amount = row.detail.source === "dbc" ? BigInt(row.detail.amount) : await deps.chain.received(sig, deps.wallets.keeper, mint);
  return amount > 0n ? [{ bucket: "unsplit", mint, amount }] : [];
};

// DBC partner fees only grow, so claiming with maxQuoteAmount = amount transfers exactly amount.
export async function claimStep(deps: KeeperDeps, launch: LaunchRow, s: VersionedSettings, runId: string): Promise<Outcome | "skipped"> {
  const base = { launchId: launch.id, idemKey: `claim:${launch.id}:${runId}`, kind: "claim" as const, settingsVersion: s.version, resolve: claimResolver(deps) };
  if (launch.status === "graduated") {
    if (!launch.dammPool || !launch.dammPosition || !launch.dammPositionNftAccount) return "skipped";
    const p = { dammPool: launch.dammPool, position: launch.dammPosition, positionNftAccount: launch.dammPositionNftAccount };
    return runTxStep(deps.sql, deps.chain, { ...base, detail: { source: "damm", quoteMint: launch.quoteMint }, build: () => deps.meteora.buildClaimPositionFee(p) });
  }
  const amount = await deps.meteora.pendingPartnerQuoteFee(launch.pool);
  if (amount === 0n) return "skipped";
  return runTxStep(deps.sql, deps.chain, {
    ...base, detail: { source: "dbc", quoteMint: launch.quoteMint, amount: amount.toString() },
    build: () => deps.meteora.buildClaimPartnerFee(launch.pool, amount),
  });
}
