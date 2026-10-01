import type { KeeperDeps } from "../deps";
import type { LaunchRow } from "../launch-row";
import type { VersionedSettings } from "../../domain/settings";
import { NATIVE_MINT } from "../../domain/types";
import { getBalance, type DeltaResolver } from "../../ledger/ledger";
import { runDbStep, runTxStep } from "../../ledger/run-step";
import { splitByWeights } from "../../domain/weights";

// A rent swap (toBucket "basket") turns basket quote into basket SOL; every other swap buys rewards.
export const swapResolver = (deps: KeeperDeps): DeltaResolver => async (row, sig) => [
  { bucket: "basket", mint: row.detail.inputMint, amount: -BigInt(row.detail.amountIn) },
  { bucket: row.detail.toBucket ?? "reward", mint: row.detail.outputMint, amount: await deps.chain.received(sig, deps.wallets.keeper, row.detail.outputMint) },
];

export async function swapStep(deps: KeeperDeps, launch: LaunchRow, s: VersionedSettings, runId: string) {
  // SOL left in the basket of a non-SOL launch after the rent swap buys rewards too.
  const inputs = launch.quoteMint === NATIVE_MINT ? [NATIVE_MINT] : [launch.quoteMint, NATIVE_MINT];
  const basket = await deps.sql`select reward_mint, weight_bps from baskets where launch_id = ${launch.id} order by reward_mint`;
  for (const input of inputs) {
    const total = await getBalance(deps.sql, launch.id, "basket", input);
    if (total === 0n) continue;
    const key = input === launch.quoteMint ? "" : `${input}:`;
    const shares = splitByWeights(total, basket.map((b: any) => ({ key: b.reward_mint as string, weight: BigInt(b.weight_bps) })));
    for (const [outputMint, amountIn] of shares) {
      if (amountIn === 0n) continue;
      const idemKey = `swap:${launch.id}:${runId}:${key}${outputMint}`;
      if (outputMint === input) {
        await runDbStep(deps.sql, {
          launchId: launch.id, idemKey, kind: "swap", settingsVersion: s.version, detail: { direct: true },
          deltas: [{ bucket: "basket", mint: input, amount: -amountIn }, { bucket: "reward", mint: input, amount: amountIn }],
        });
        continue;
      }
      const q = await deps.jupiter.quote(input, outputMint, amountIn, s.slippageBps).catch((e) => {
        console.error(`quote for ${outputMint} failed`, e);
        return null;
      });
      if (!q || q.priceImpactBps > s.slippageBps) continue;
      await runTxStep(deps.sql, deps.chain, {
        launchId: launch.id, idemKey, stepKey: `swap:${launch.id}:${key}${outputMint}`, kind: "swap", settingsVersion: s.version,
        detail: { inputMint: input, outputMint, amountIn: amountIn.toString(), quotedOut: q.outAmount.toString() },
        build: () => deps.jupiter.buildSwap(q),
        resolve: swapResolver(deps),
      });
    }
  }
}
