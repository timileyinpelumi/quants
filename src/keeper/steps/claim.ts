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
async function claimCurve(deps: KeeperDeps, launch: LaunchRow, s: VersionedSettings, idemKey: string): Promise<Outcome | "skipped"> {
  const amount = await deps.meteora.pendingPartnerQuoteFee(launch.pool);
  if (amount === 0n) return "skipped";
  return runTxStep(deps.sql, deps.chain, {
    launchId: launch.id, idemKey, kind: "claim", settingsVersion: s.version, resolve: claimResolver(deps),
    detail: { source: "dbc", quoteMint: launch.quoteMint, amount: amount.toString() },
    build: () => deps.meteora.buildClaimPartnerFee(launch.pool, amount),
  });
}

export async function claimStep(deps: KeeperDeps, launch: LaunchRow, s: VersionedSettings, runId: string): Promise<Outcome | "skipped"> {
  if (launch.status !== "graduated") return claimCurve(deps, launch, s, `claim:${launch.id}:${runId}`);
  await claimCurve(deps, launch, s, `claim:${launch.id}:${runId}:curve`);
  if (!launch.dammPool || !launch.dammPosition || !launch.dammPositionNftAccount) return "skipped";
  const p = { dammPool: launch.dammPool, position: launch.dammPosition, positionNftAccount: launch.dammPositionNftAccount };
  return runTxStep(deps.sql, deps.chain, {
    launchId: launch.id, idemKey: `claim:${launch.id}:${runId}`, kind: "claim", settingsVersion: s.version, resolve: claimResolver(deps),
    detail: { source: "damm", quoteMint: launch.quoteMint },
    build: () => deps.meteora.buildClaimPositionFee(p),
  });
}
