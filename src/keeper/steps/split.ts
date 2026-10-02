import type { KeeperDeps } from "../deps";
import type { LaunchRow } from "../launch-row";
import type { VersionedSettings } from "../../domain/settings";
import { getBalance } from "../../ledger/ledger";
import { runDbStep } from "../../ledger/run-step";
import { splitFees } from "../../domain/weights";

export async function splitStep(deps: KeeperDeps, launch: LaunchRow, s: VersionedSettings, runId: string): Promise<boolean> {
  const lp = await lpToTreasury(deps, launch, s, runId);
  return (await splitCurveFees(deps, launch, s, runId)) || lp;
}

// Fees from the graduated pool's locked LP position belong to the platform in full.
async function lpToTreasury(deps: KeeperDeps, launch: LaunchRow, s: VersionedSettings, runId: string): Promise<boolean> {
  const mint = launch.quoteMint;
  const amount = await getBalance(deps.sql, launch.id, "lp", mint);
  if (amount === 0n) return false;
  return runDbStep(deps.sql, {
    launchId: launch.id, idemKey: `split:${launch.id}:${runId}:lp`, kind: "split", settingsVersion: s.version,
    detail: { amount: amount.toString(), lp: true },
    deltas: [{ bucket: "lp", mint, amount: -amount }, { bucket: "treasury", mint, amount }],
  });
}

async function splitCurveFees(deps: KeeperDeps, launch: LaunchRow, s: VersionedSettings, runId: string): Promise<boolean> {
  const mint = launch.quoteMint;
  const amount = await getBalance(deps.sql, launch.id, "unsplit", mint);
  if (amount === 0n) return false;
  const r = splitFees(amount, s.split, launch.tradingOnly);
  return runDbStep(deps.sql, {
    launchId: launch.id, idemKey: `split:${launch.id}:${runId}`, kind: "split", settingsVersion: s.version,
    detail: { amount: amount.toString(), ...(launch.tradingOnly ? { tradingOnly: true } : {}) },
    deltas: [
      { bucket: "unsplit", mint, amount: -amount },
      ...(launch.tradingOnly ? [] : [{ bucket: "basket" as const, mint, amount: r.basket }]),
      { bucket: "treasury", mint, amount: r.platform },
      { bucket: "creator", mint, amount: r.creator },
    ],
  });
}
