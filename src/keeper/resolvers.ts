import type { KeeperDeps } from "./deps";
import type { DeltaResolver, StepKind } from "../ledger/ledger";
import { claimResolver } from "./steps/claim";
import { payoutResolver } from "./steps/payout";
import { swapResolver } from "./steps/swap";
import { fundResolver } from "./steps/fund";
import { stakePayoutResolver } from "./steps/earn";
import { burnResolver, collectResolver } from "./steps/penalty";

const none: DeltaResolver = async () => [];

export function makeResolvers(deps: KeeperDeps): Record<StepKind, DeltaResolver> {
  return {
    claim: claimResolver(deps), payout: payoutResolver, stake_payout: stakePayoutResolver, split: none,
    swap: swapResolver(deps), fund: fundResolver, collect_penalty: collectResolver(deps), burn: burnResolver, migrate: none, create_farm: none, configure_farm: none, rent: none,
  };
}
