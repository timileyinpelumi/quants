import type { KeeperDeps } from "./deps";
import type { DeltaResolver, StepKind } from "../ledger/ledger";
import { claimResolver } from "./steps/claim";
import { payoutResolver } from "./steps/payout";
import { swapResolver } from "./steps/swap";

const none: DeltaResolver = async () => [];

export function makeResolvers(deps: KeeperDeps): Record<StepKind, DeltaResolver> {
  return {
    claim: claimResolver(deps), payout: payoutResolver, split: none,
    swap: swapResolver(deps), fund: none, collect_penalty: none, burn: none, migrate: none, create_farm: none, configure_farm: none,
  };
}
