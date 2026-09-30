# Meteora DBC spike

Run: 2026-09-30, local `solana-test-validator` (Agave 4.3.0) with DBC (`dbcij3…`), DAMM v2 (`cpamdp…`), Metaplex token metadata and the DAMM v2 Customizable migration config cloned from mainnet. SDKs: `@meteora-ag/dynamic-bonding-curve-sdk@1.5.13`, `@meteora-ag/cp-amm-sdk@1.5.1`. Script: `spike/dbc.ts`.

## Answers

1. **Token badge.** Not needed. A config with a classic SPL quote mint (6 decimals, no extensions) was created without a badge, so OURTOKEN launches do not wait on Meteora. A badge is only needed for Token-2022 quote mints with extra extensions. Meteora's keepers still won't auto-migrate an unknown quote, so our keeper runs graduation.
2. **Migration config.** For `MigrationFeeOption.Customizable` the `dammConfig` is `A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck` (the last entry of the SDK's `DAMM_V2_MIGRATION_FEE_ADDRESS`). The same address is used for every fee tier; the fee comes from `migratedPoolFee.poolFeeBps` in our DBC config. Set `DAMM_V2_MIGRATION_CONFIG` to it.
3. **Who gets the graduated LP.** With `partnerPermanentLockedLiquidityPercentage: 100`, migration creates one permanently locked position owned by the config's `feeClaimer` (our keeper). The creator gets none. `CpAmm.getUserPositionByPool(dammPool, keeper)` finds it.
4. **Partner fee claim before graduation.** `claimPartnerTradingFee` with `maxQuoteAmount = getPoolFeeMetrics().current.partnerQuoteFee` claimed exactly that amount and left 0. For a SOL quote the fee arrives as **native SOL** (the SDK unwraps), not wSOL. Partner fee is 80% of the trading fee (Meteora keeps 20%), and the creator share is 0 as configured.
5. **Graduation.** The curve is complete when `quoteReserve >= migrationQuoteThreshold` (`migrationProgress` becomes 2). `migrateToDammV2({ payer, pool, dammConfig })` then succeeds in one transaction signed by the payer and the two returned position NFT keypairs. There is no separate metadata or locker step for this config.
6. **Graduated pool fees.** The DAMM v2 pool's `collectFeeMode` is 1 (quote token only). `claimPositionFee` succeeded.

## Corrections to the plan

- `StateService.getPool()` returns the virtual pool with its fields under `poolState` (`p.poolState.quoteReserve`, `p.poolState.isMigrated`, `p.poolState.config`). Task 9 `curveState` must read those.
- `CpAmm.claimPositionFee` must not be given `receiver` for a SOL pool unless a temporary wSOL account is also passed. The keeper owns the position, so leave `receiver` out; fees go to the owner.
- The last buy before graduation fails with `insufficientLiquidity` if it asks for more than the curve has left. Use `pool.swap2` with `SwapMode.PartialFill` (matters for tests and the e2e script).
- On mainnet the DBC and DAMM v2 pool authority PDAs hold SOL used for migration rent. On a local validator they start at 0 and must be airdropped (`deriveDbcPoolAuthority()`, `deriveDammV2PoolAuthority()`). Test setup only.
- The first SOL claim created the keeper's wSOL token account, so the native SOL received was about 0.002 SOL (the account's rent) less than the recorded fee. The ledger records the exact fee. The keeper's SOL float covers the difference when `reconcile` compares balances.
