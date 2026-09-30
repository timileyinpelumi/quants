import type { KeeperDeps } from "../deps";
import type { LaunchRow } from "../launch-row";
import type { VersionedSettings } from "../../domain/settings";
import { getBalance, type DeltaResolver } from "../../ledger/ledger";
import { runTxStep } from "../../ledger/run-step";

export const payoutResolver: DeltaResolver = async (row) =>
  [{ bucket: row.detail.bucket, mint: row.detail.mint, amount: -BigInt(row.detail.amount) }];

export async function payoutStep(deps: KeeperDeps, launch: LaunchRow, s: VersionedSettings, runId: string) {
  const mint = launch.quoteMint;
  const targets = [
    { bucket: "treasury" as const, to: deps.wallets.treasury, min: 1n },
    { bucket: "creator" as const, to: launch.creator, min: s.creatorPayoutMin[mint] ?? 1n },
  ];
  for (const t of targets) {
    const amount = await getBalance(deps.sql, launch.id, t.bucket, mint);
    if (amount === 0n || amount < t.min) continue;
    await runTxStep(deps.sql, deps.chain, {
      launchId: launch.id, idemKey: `payout:${launch.id}:${runId}:${t.bucket}`, stepKey: `payout:${launch.id}:${t.bucket}`, kind: "payout", settingsVersion: s.version,
      detail: { bucket: t.bucket, mint, amount: amount.toString(), to: t.to },
      build: () => deps.chain.buildTransfer(mint, t.to, amount),
      resolve: payoutResolver,
    });
  }
}
