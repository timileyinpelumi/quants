import type { KeeperDeps } from "../deps";
import type { LaunchRow } from "../launch-row";
import type { VersionedSettings } from "../../domain/settings";
import { getBalance } from "../../ledger/ledger";
import { runDbStep } from "../../ledger/run-step";
import { splitFees } from "../../domain/weights";

export async function splitStep(deps: KeeperDeps, launch: LaunchRow, s: VersionedSettings, runId: string): Promise<boolean> {
  const mint = launch.quoteMint;
  const amount = await getBalance(deps.sql, launch.id, "unsplit", mint);
  if (amount === 0n) return false;
  const r = splitFees(amount, s.split);
  return runDbStep(deps.sql, {
    launchId: launch.id, idemKey: `split:${launch.id}:${runId}`, kind: "split", settingsVersion: s.version,
    detail: { amount: amount.toString() },
    deltas: [
      { bucket: "unsplit", mint, amount: -amount },
      { bucket: "basket", mint, amount: r.basket },
      { bucket: "treasury", mint, amount: r.platform },
      { bucket: "creator", mint, amount: r.creator },
    ],
  });
}
