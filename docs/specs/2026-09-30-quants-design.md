# Quants design

Date: 2026-09-30
Status: draft, awaiting review

## Summary

A Solana token launchpad. A project launches a token with a trading fee chosen from a set of tiers. Part of the fees is swapped into a reward basket of up to three tokens chosen by the project. Holders stake the launched token for a lock period and earn the basket. Longer locks earn more. Stakers can exit early for a penalty on their principal, and 100% of that penalty is burned.

Launches run on Meteora (Dynamic Bonding Curve, graduating to DAMM v2). Staking runs on Kamino Farms. No custom on-chain program in v1.

## Scope

In scope:

- Launch form and launch transaction (DBC pool with optional first buy).
- Quote token per launch: SOL or OURTOKEN, chosen by the creator.
- Fee tiers (default 1%, 2%, 3%, 5%).
- Fee claiming, splitting (basket / platform / creator), swapping and reward funding by a keeper.
- Graduation for OURTOKEN-quoted launches (Meteora's keepers only migrate SOL launches).
- Staking with lock tiers, multipliers, early exit and penalty burn, on Kamino Farms.
- Token page (chart, trade through Jupiter, stake), staking page, admin page.

Out of scope for v1:

- Our own staking program ("contract mode"). The staking layer sits behind an adapter so it can be added later; see "Contract mode".
- Pairing one launch against both SOL and OURTOKEN.
- Transfer-tax reward tokens, airdrops, referrals.
- Changing a launch's basket after launch (admin override only).
- Token-2022 launched tokens (Kamino Farms requires a classic SPL stake mint).

## Research findings that shaped the design

- Meteora Stake2Earn pays only the pool's two tokens, only to the top N stakers, has no locks, multipliers, penalty or burn, requires a SOL/USDC quote and a DAMM v1 pool. Meteora marks it legacy. Not used.
- DBC new configs graduate to DAMM v2 only. Any SPL mint can be the quote; a mint outside Meteora's permissionless list needs a DBC token badge, and Meteora's keepers do not auto-migrate it.
- Streamflow Staking: about 1.3 SOL per pool plus paid plans, per-claim fees, no early exit, closed source. Not used.
- Kamino Farms (`FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr`): permissionless farm creation, up to 10 reward mints, early withdrawal penalty decaying linearly with remaining lock time, penalty sent to a configurable address, no protocol fee under our own global config, audited by OtterSec and Offside Labs. BSL 1.1 licence: calling the deployed program is allowed. One lock duration per farm, no multipliers, rewards stream at a set rate.
- stonkfun.xyz form (Raydium LaunchLab) used as the reference for the launch form fields and flow.

## Components

### 1. Web app

Next.js on Bun. Wallet adapter for signing.

- **Launch form**, in order:
  1. Name (required, max 32 characters).
  2. Symbol (required, max 10 characters).
  3. Image (required, square, PNG/JPEG/WebP, max 2 MB).
  4. Description (optional, max 500 characters).
  5. Website, X, Telegram links (optional, HTTPS, validated the same way stonkfun does).
  6. Quote token: SOL or OURTOKEN.
  7. Fee tier.
  8. Reward basket: 1 to 3 tokens from the Jupiter verified list, with optional weights that sum to 100 (default equal).
  9. Dev buy (optional): SOL amount or % of supply, capped by an admin setting.
  10. Summary panel: quote, fee, split, basket, lock tiers, launch fee, dev buy, graduation threshold.
- **Token page**: price chart, trade through the Jupiter plugin, basket, staking stats (total staked per tier, rewards paid, penalties burned).
- **Staking page**: stake with a tier, view positions, claim rewards, exit early with the penalty shown before signing, withdraw after lock.
- **Admin page**: settings (below), basket override per launch, keeper status, failed steps.

Admin access is by wallet signature against an allowlist of admin wallets.

### 2. API

Same Next.js app.

- `POST /api/launch/prepare`: validates input, uploads image and metadata, picks the config key for (quote, fee tier), returns an unsigned transaction. The transaction contains the launch fee transfer and `createPoolWithFirstBuy` (or `createPool` with no dev buy). An OURTOKEN-quoted dev buy adds a Jupiter SOL to OURTOKEN swap before it. One wallet approval.
- `POST /api/launch/confirm`: takes the signature, verifies the pool on-chain, records the launch, and queues farm creation.
- Read endpoints for tokens, stake stats and distributions.

### 3. Postgres

- `launches`: mint, pool, quote mint, fee tier, config key, creator, status (`live`, `graduating`, `graduated`), created at.
- `baskets`: launch, reward mint, weight.
- `stake_pools`: launch, backend (`kamino`), per tier: tier id, lock seconds, multiplier, farm address.
- `settings`: versioned rows. Each new version is a new row; the keeper reads the latest.
- `distributions`: one row per on-chain step with type (`claim`, `split`, `swap`, `fund`, `set_rate`, `collect_penalty`, `burn`, `migrate`, `payout`), amounts, status (`pending`, `sent`, `confirmed`, `failed`), transaction signature, settings version used.
- `escrow`: basket share owed per launch per reward mint, not yet funded.

### 4. Keeper

Bun worker. Runs every N minutes (setting). For each live launch:

1. **Claim** partner fees: `claimPartnerTradingFee` before graduation, `claimPositionFee` on our DAMM v2 position after. Fees are always collected in the quote token, so a claim yields SOL or OURTOKEN only.
2. **Split** by the current settings: basket / platform / creator (default 60 / 25 / 15). Platform share goes to the treasury wallet. Creator share is paid to the creator's wallet once it passes a minimum (setting); below that it accumulates.
3. **Swap** the basket share into each basket token by weight through the Jupiter Swap API, with a slippage cap (setting). A failed or over-slippage swap leaves the amount in `escrow` for the next run.
4. **Allocate across tiers**: for tier `t` with total staked `S_t` and multiplier `m_t`, tier share is `m_t * S_t / sum(m_i * S_i)`. If nothing is staked, the amount stays in `escrow`.
5. **Fund and set rate** on each tier's farm: top up the reward vault and set `rewards_per_second` so the funded amount plus any unstreamed remainder streams over the reward period (setting, default 24 hours).
6. **Collect and burn penalties**: call `withdraw_slashed_amount` on each farm, then burn the collected tokens from the spill account with SPL `burn`. The spill account is a platform-owned token account for that launch's mint used only for this.
7. **Graduate** OURTOKEN-quoted launches: when the curve completes, run `migrateToDammV2`.

Each step writes a `pending` row before sending and updates it after confirmation. On restart the keeper checks the chain for pending rows before retrying, so no step is sent twice. Steps for one launch run in order; different launches run independently.

Keeper wallet balance is kept low: platform share is swept to treasury every run.

### 5. Staking adapter

```
createStakePool(launchMint, tiers, rewardMints)
fundRewards(pool, tier, rewardMint, amount, periodSeconds)
stakeTx(pool, tier, owner, amount)        // unsigned, user signs
claimTx(pool, owner)
exitEarlyTx(pool, tier, owner)
withdrawTx(pool, tier, owner)
collectAndBurnPenalties(pool)
capabilities() -> { earlyExit, tiersOnChain }
```

v1 has one implementation, `KaminoBackend`. The backend name is stored on each stake pool when it is created. The platform default backend is a setting and applies to new launches only.

### 6. Kamino setup

- One global config owned by the platform, with treasury fee set to 0.
- Per launch, one farm per lock tier (default four: 7, 30, 90, 180 days), each with:
  - stake mint = launched token,
  - reward mints = the basket,
  - locking mode set so each deposit is locked for the tier duration,
  - early withdrawal penalty = max penalty setting (default 30%),
  - withdrawal cooldown 0,
  - slashed amount spill address = the launch's spill account.
- Farm admin is a platform wallet.
- Rent is about 0.06 SOL per farm. It is covered by a flat launch fee paid in the launch transaction (setting, default 0.3 SOL).

### 7. Meteora setup

- One DBC config key per (quote token, fee tier). Default: 2 quotes x 4 tiers = 8 keys, created by an admin script.
- Each config: creator trading fee share 0, `feeClaimer` = keeper wallet, fee collected in quote token only, graduated LP 100% to partner (the platform) with at least the required minimum permanently locked, migration target DAMM v2 with the graduated pool fee equal to the tier.
- Graduation threshold per quote token (setting used when the keys are created; stonkfun uses 85 SOL).
- OURTOKEN needs a DBC token badge from Meteora. SOL launches do not depend on it.

## Settings

All editable from the admin page. Changes create a new version.

| Setting | Default | Applies to |
|---|---|---|
| Fee split basket / platform / creator | 60 / 25 / 15 | fees claimed after the change |
| Creator payout minimum | 0.05 SOL equivalent | next payout |
| Lock tiers and multipliers | 7d 1x, 30d 1.5x, 90d 2x, 180d 3x | launches created after the change |
| Max early exit penalty | 30% | launches created after the change |
| Reward stream period | 24 hours | next funding |
| Swap slippage cap | 1% | next swap |
| Launch fee | 0.3 SOL | next launch |
| Dev buy cap | 50% of supply | next launch |
| Keeper interval | 10 minutes | next run |
| Default staking backend | kamino | launches created after the change |

Fee tiers are fixed by the config keys; adding a tier means creating new keys.

## Invariants

- Split percentages sum to 100.
- The platform never receives any early exit penalty. Every penalty token collected is burned; `collect_penalty` and `burn` amounts match per run.
- No on-chain step is sent twice for the same `distributions` row.
- Basket funds only go to farms of the launch that generated them.
- A stake pool's backend, tiers, multipliers and max penalty do not change after creation.
- A launch's basket does not change except by admin override.

## Contract mode

Our own staking program, deferred. It would replace the workarounds: exact multipliers in one pool, rewards split on deposit, penalty burned in the exit instruction, Token-2022 support. It plugs in as a second adapter backend and is enabled by switching the default backend setting. Existing Kamino pools stay on Kamino. Not built unless the Kamino workarounds cause problems.

## Phases

0. **Spike (devnet)**: create a Kamino global config and farm with three reward mints; stake from two wallets; top up and change `rewards_per_second` twice; exit early; collect and burn the penalty. Also create a DBC config with a custom quote and run `migrateToDammV2` manually. Confirms the two assumptions the design rests on.
1. **Setup**: OURTOKEN mint confirmed as classic SPL, token badge requested, config keys created, wallets (keeper, treasury, farm admin) and Postgres in place.
2. **Launch**: launch form, prepare/confirm API, token page, keeper steps claim, split, payout, graduate. Basket share accrues in `escrow`.
3. **Staking**: Kamino backend, farm creation on launch, keeper steps swap, allocate, fund, burn. Staking page. Escrow from phase 2 is funded into farms once they exist.
4. **Admin**: settings page, keeper status, overrides.

## Testing

- Unit tests: fee split, tier allocation, reward rate calculation, penalty formula, settings validation.
- Keeper tests against a local validator or devnet with recorded fixtures: crash between send and confirm does not double-send.
- Devnet end-to-end before mainnet: launch, trade, claim, split, swap, fund, stake, exit early, burn, graduate.

## Open items

- OURTOKEN mint address and token program.
- Time to get a DBC token badge from Meteora.
- Whether Kamino accepts rate changes on a farm with active stakers the way the design assumes (phase 0).
- Project name: quants (decided 2026-09-30).
