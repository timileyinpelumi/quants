# Trade indexer, charts and landing page

Date: 2026-10-01. Branch: `landing`.

## What it does

1. **Trade indexer.** A separate process (`bun run indexer`) that records every swap on every quants pool into a `trades` table. Charts, market stats, volume and the landing page read from that table. GeckoTerminal is no longer used.
2. **Charts and market stats** on the token page come from `trades`.
3. **Landing page** at `/`. The launch form moves to `/launch`.
4. **Centered layout.** One container, max 1280px, used by the header, footer and every page.
5. **Dev warm-up.** `bun run warm` and Playwright global setup compile every route once; `onDemandEntries` keeps them compiled.

## What it does not do

- No trades from before the indexer first sees a pool. It starts from the pool's oldest signature the RPC still returns, so on mainnet a full history is available for new launches and old ones backfill as far as the RPC allows.
- No websocket or live push. Pages read what the indexer has written, a few seconds behind the chain.
- No per-wallet trade history page.
- No USD history for the quote token. Each trade stores the quote token's USD price at the time it was indexed. Locally there is no USD price, so values show in the quote token.

## How the indexer works

- Every few seconds it lists launches. For each pool (the curve pool, and the DAMM v2 pool once graduated) it calls `getSignaturesForAddress` back to the last signature it saw (`index_cursors`), oldest first.
- It fetches those transactions, skips failed ones, and decodes the `EvtSwap2` events the Meteora programs emit as self-CPI inner instructions, using the IDLs exported by the two SDKs.
- Only events whose `pool` matches the pool being indexed are kept.
- Direction 1 is a buy in both programs (quote to base). Token A is the base and token B the quote in both.
- Price is the post-trade spot price from `next_sqrt_price`: `(sqrt / 2^64)^2 * 10^(baseDecimals - quoteDecimals)`.
- Writes are idempotent on `(signature, event_index)`. The cursor moves only after the trades are written, so a crash re-reads and the unique key drops repeats.

## Invariants

- A trade is counted once.
- A failed transaction is never counted.
- Candles and volume for a token come only from its own pools.

## Table

`trades(signature, event_index, launch_id, venue, side, trader, base_amount, quote_amount, fee_amount, price, quote_usd, block_time)`, primary key `(signature, event_index)`, index on `(launch_id, block_time)`.

`base_amount` and `quote_amount` are raw integer units. `quote_amount` is what the trader paid in on a buy (fee included) or received on a sell. `price` is quote per base in whole tokens.

## Landing page

- Hero: one line on what quants is, Launch and Explore buttons.
- Stats row: launches, 24h volume, total volume, rewards paid, burned, staked.
- Lists as flat rows: biggest by market cap, top gainers 24h, newest, closest to graduating, recent trades.
- Data comes from `trades`, `launches`, `distributions` and on-chain pool state for graduation progress.

## Tests

- Event decoding and price math against fixed transaction data.
- Indexer run against a fake chain: ordering, failed transactions skipped, idempotent re-run, cursor movement.
- Candle and market queries against Postgres.
- Landing stats queries against Postgres.
- On the validator: launch, trade, run the indexer, see the trades.
- Playwright: landing renders with stats; token chart draws after trades.
