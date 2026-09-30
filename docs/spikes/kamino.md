# Kamino Farms spike

Run: 2026-09-30, local `solana-test-validator` (Agave 4.3.0) with `FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr` cloned from mainnet, `@kamino-finance/farms-sdk@4.0.1`. Script: `spike/kamino.ts`.

## Answers

1. **Reward rate units.** New rewards have `rewardsPerSecondDecimals = 0`. The raw value passed to `updateFarmConfigIx(..., UpdateRewardRps, raw)` is `baseUnitsPerSecond * 10^rpsDecimals`, so with decimals 0 it is base units per second. Setting `1e9 / 100` produced a curve point of `10000000` per second as expected. `addRewardAmountToFarmIx` takes a UI amount (`Decimal`) and converts with the reward's decimals: 1000 UI of a 6-decimal mint gave `rewardsAvailable = 1_000_000_000`.
2. **Top-up and rate change with active stakers.** A second top-up and a rate change after two users had staked for 20 seconds both succeeded. `rewardsAvailable` and `rewardsIssuedUnclaimed` moved as expected.
3. **Early exit.**
   - `unstakeIx` takes stake **shares scaled by 1e18**, not token amounts (`stakeSharesScaled`). Passing token amounts unstakes a dust amount and no penalty is charged. Use `userState.activeStakeScaled` to unstake a whole position.
   - With `LockingMode = Continuous (1)`, the penalty is charged inside `unstake`: `penaltyBps * timeRemaining / lockDuration`, where the lock is measured from the user's `lastStakeTs`. Result: 30% max, about 32 of 60 seconds left, 16% charged (16,000,000 of 100,000,000).
   - The penalty goes to `slashedAmountCurrent`. The remaining 84% goes to pending withdrawal, and with cooldown 0 `withdrawUnstakedDepositIx` succeeded straight away. The SDK helper `getPendingWithdrawalCooldownStatus...` reported `canWithdraw: false` at the same time, which is wrong for our setup; do not rely on it.
   - Penalty bps of 0 or 10000 blocks early exit entirely (`EarlyWithdrawalNotAllowed`), so the settings range 1..9999 in the plan is correct.
4. **Penalty collection.** `getWithdrawSlashedAmountInstruction` (exported from the SDK root) moved the full 16,000,000 to the spill ATA and reset `slashedAmountCurrent` to 0.
5. **Three reward mints** of decimals 6, 9 and 6 on one farm worked.
6. **Stake units.** `stakeIx` takes base units (a `Decimal` of base units staked exactly 100,000,000).

## Differences from the spec

- **Adding to a stake resets the lock for the whole position.** In Continuous mode the lock runs from `lastStakeTs`, which moves on every stake. Someone who adds tokens to a 90-day position restarts the 90 days for all of it. The staking UI (plan 2) must say so before signing. No change to the keeper.
- None of the other findings contradict the spec.
