# Runbook

## Environment

Copy `.env.example` to `.env` and fill in:

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Postgres for the app and keeper |
| `RPC_URL` | Solana RPC |
| `KEEPER_KEYPAIR` | JSON secret key array of the keeper wallet |
| `SPILL_KEYPAIR` | JSON secret key array of the spill wallet |
| `TREASURY_ADDRESS` | Platform treasury (receive only) |
| `OURTOKEN_MINT` | The platform token, classic SPL |
| `KAMINO_GLOBAL_CONFIG` | Output of `scripts/create-kamino-global-config.ts` |
| `DAMM_V2_MIGRATION_CONFIG` | `A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck` (DAMM v2 Customizable) |
| `JUPITER_BASE_URL` | `https://api.jup.ag/swap/v1` |
| `JUPITER_API_KEY` | Free key from the Jupiter portal; without it requests are limited to 30 a minute |
| `ALERT_WEBHOOK_URL` | Optional. Incoming webhook the keeper and indexer post alerts to (see Alerts) |
| `QUOTE_GRADUATIONS` | Optional. JSON of graduation targets by pair symbol, for example `{"SOL":100,"USDC":15000}` (see Graduation targets) |

## Wallets

- **Keeper.** Fee claimer on every DBC config, owner of every graduated LP position, admin of every Kamino farm. Holds claimed fees between keeper runs and pays rent for farms. That rent comes out of each launch's stakers' share (see Staking opens), so the ledger moves it out of the basket before the keeper spends it. Keep at least 1 SOL above what the ledger says it owes for transaction fees and retries.
- **Spill.** Only receives early-exit penalties from farms. The keeper burns from it. It should never hold anything else.
- **Treasury.** Receives the platform share. Receive only. It must already exist on-chain (hold at least the rent-exempt minimum of SOL), or small SOL payouts to it fail.

## One-time setup

```bash
docker compose up -d
bun run migrate
bun scripts/create-kamino-global-config.ts         # prints KAMINO_GLOBAL_CONFIG
OURTOKEN_GRADUATION=<amount> bun scripts/create-configs.ts > config-keys.json
```

### Graduation targets

Each pair graduates once a set amount of the pair token has been raised on the curve: 85 SOL, 12,000 USDC, 12,000 USDT, 30,000 JUP, and `OURTOKEN_GRADUATION` for the platform token. To change any of them, set `QUOTE_GRADUATIONS` to JSON keyed by symbol, for example `QUOTE_GRADUATIONS='{"SOL":100,"JUP":40000}'`. Pairs you leave out keep their default. An unknown symbol or a target that is not a positive number is an error naming the pair, in the script and in the web app.

The target is written into each config key when `scripts/create-configs.ts` runs, and every pool keeps the target of the config key it was launched from. Set `QUOTE_GRADUATIONS` before creating config keys. Changing it afterwards does nothing for existing keys or pools; create a new set of config keys for a new target to apply. The admin page lists the targets the server is set to under Pairs, and `NEXT_PUBLIC_SOL_GRADUATION` and `NEXT_PUBLIC_OURTOKEN_GRADUATION` must match what the keys were created with.

Keep `config-keys.json` next to `.env` on the server (it is gitignored because the dev seed regenerates it); the web app reads it from `CONFIG_KEYS_PATH`. Save the initial settings from a script or the admin page (plan 2) with `saveSettings(sql, defaultSettings(OURTOKEN_MINT), "<admin>")`.

### Stock pairs

Tokenized stocks (xStocks from Backed, and Backpack stocks such as `SPCX.US`) can be pair tokens. They are Token-2022 mints, so:

- **Trading only.** Kamino farms reject these mints, so a launch against a stock has no reward basket, no stake pool and no farms. The keeper splits its fees between the treasury and the creator in proportion to `platformBps` and `creatorBps` (the basket share is shared out the same way) and never runs the rent, swap or fund steps for it. The launch form hides the basket and staking for these pairs, and the token page, explore and home show a Trading only tag instead of staking.
- **Token badge.** DBC rejects Token-2022 quote mints with extensions unless the config and every pool pass the mint's DBC token badge (`deriveTokenBadgeAddress(mint)`). Meteora creates badges, and the xStocks and Backpack stocks checked so far have one on mainnet. `create-configs.ts` refuses a stock with extensions and no badge, and `MeteoraLive.buildLaunchTx` passes the badge whenever the quote mint is Token-2022 and the badge account exists.
- **Pause risk.** The issuer can pause the mint (Token-2022 pausable extension), for example around corporate actions. While it is paused every transfer fails with custom program error `0x43`: nobody can trade the paired tokens, and the keeper skips migrate, claim and payout for those launches without recording failures or alerting. A paused error that slips through while building or sending is recorded as `mint paused`, gives back its attempt and does not count toward the retry cap. Everything resumes on the first run after the issuer unpauses.
- **Scaled UI amounts.** Stock mints can carry a scaled UI multiplier (dividends, splits). Balances and amounts in the trade panel are shown multiplied by the mint's current multiplier, as wallets show them; transactions, the ledger, charts and graduation progress use raw on-chain amounts. Jupiter prices are per displayed unit, so USD values can drift by the multiplier while it is not 1.

Which stocks are offered: the web app reads the xStocks list (`api.xstocks.fi/api/v2/public/assets`, Solana deployments) and Backpack's assets (`api.backpack.exchange/api/v1/assets`, `.US` symbols with a Solana mint) once a day into the `stock_quotes` table. A stock is offered only when `config-keys.json` has config keys for its mint, and each such mint is checked on chain once: Token-2022, no transfer fee, no transfer hook program. To add stocks on mainnet, create their config keys and merge the printed keys into `config-keys.json`:

```bash
# graduation is --graduation-usd worth at the current Jupiter price (default 12000), or set per mint with <mint>=<whole units>
bun --env-file=.env scripts/create-configs.ts --stocks Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh,<mint>=<units> > stock-keys.json
```

Locally, `scripts/dev-seed.ts` creates two Token-2022 stand-in stocks with no extensions (NVDAx and SPCX.US), their config keys and a trading only launch (`SEED_STOCK_MINT`), and lists them through `LOCAL_STOCKS` instead of the issuers' lists. `LOCAL_STOCKS` is a dev switch and refuses to start against a non-local RPC.

## Running the keeper

```bash
bun run keeper
```

It runs every `keeperIntervalSeconds` (default 600) and logs one JSON line per run with `runId`, `launches` and per-launch `errors`.

### Staking opens

There is no launch fee. A new launch's stake pool stays `pending` and its stakers' share (the `basket` bucket in `escrow`) is held in the pair token. Each run the keeper values that balance in SOL (SOL pairs 1:1, other pairs by a Jupiter quote to SOL) and stores it with the farm rent (`launchCost(...).rent` for the pool's tiers and basket) on `stake_pools` as `basket_value_lamports` and `rent_lamports`; pages show the ratio as a percent. On the run the value covers the rent:

1. Non-SOL pairs swap just enough of the basket to SOL (a `swap` row with `detail.toBucket = 'basket'`, step key `rent_swap:<launch>`), sized from the quote plus the slippage cap.
2. A `rent` row debits the rent from the basket's SOL. A unique index allows one confirmed `rent` row per launch.
3. The farms are created as before, and the rest of the basket buys rewards from then on.

Launches made under settings that had a launch fee open without a `rent` row, since they paid at launch.

## Running the trade indexer

```bash
bun run indexer
```

It reads every swap on every quants pool (the curve, then DAMM v2 after graduation) into `trades`. Charts, market stats, volume and the home page come from that table, so they lag the chain by one pass (`INDEXER_INTERVAL_SECONDS`, default 5). It logs a JSON line only when it wrote trades, skipped any, or an address failed. A transaction the RPC lists but will not return is waited on for 10 minutes, then skipped and counted in `skipped` (pruned RPC history causes this). If the RPC has pruned the transaction a cursor points at, the indexer reads that pool again from its recent history. A failing address is skipped for that pass and retried on the next one; one that fails every pass shows in every line. Only one indexer runs at a time (Postgres advisory lock); a second one exits.

Each trade stores the quote token's USD price from Jupiter (`JUPITER_API_KEY`) at the time it was indexed. With no price the trade is stored without one and pages show values in the quote token.

## Alerts

Set `ALERT_WEBHOOK_URL` and the keeper and indexer post `{"text": "..."}` to it. That works as is with Slack incoming webhooks and anything that accepts the same body. For Discord, add `/slack` to the end of the channel's webhook URL. Without the variable nothing is sent.

They alert when:

- The keeper stops on a `ReconcileError`.
- A keeper run fails outright.
- The same launch errors on 3 keeper runs in a row (and on every run after that until it clears).
- An indexer pass fails outright.
- The indexer fails to read the same pool address on 5 passes in a row.
- The indexer skips transactions the RPC would not return.

The same alert is sent at most once an hour. The last send time per alert is kept in the `alerts_sent` table, so a keeper that exits and restarts does not repeat it every 30 seconds; to get an alert again sooner, delete its row. A webhook that is down or slow (5 second timeout) is logged as `alertFailed` and never holds up the keeper or indexer.

## When something goes wrong

- **`ReconcileError`, process exits.** The ledger says the keeper or spill wallet should hold more of a mint than it does. Nothing is sent until this is fixed. Compare `select bucket, mint, sum(amount) from escrow group by 1, 2` with the wallet balances. Causes seen so far: the keeper's SOL float ran out (top it up), or someone moved funds out of a keeper wallet by hand.
- **A `failed` row in `distributions`.** Look at `error`. `transaction failed on-chain`: the program rejected it; check the signature on an explorer. `not confirmed after 5 attempts`: it never landed; usually RPC trouble or a transaction that fails preflight every time. `abandoned before send`: the keeper stopped between recording and sending; nothing was sent, and the next run starts that step again under a new key. Failed rows never move balances.
- **A launch in `errors` every run.** The other launches keep going. Read the error; most are RPC timeouts that clear on their own.

## Local end-to-end run

```bash
solana-test-validator --reset --url https://api.mainnet-beta.solana.com \
  --clone-upgradeable-program FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr \
  --clone-upgradeable-program dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN \
  --clone-upgradeable-program cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG \
  --clone-upgradeable-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s \
  --clone A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck
bun scripts/e2e-local.ts
```

The script launches a token, trades it past the volume that opens staking, runs the keeper three times (before staking, after staking, after an early exit) and checks the burn reduced the mint supply by the burned amount. Jupiter is not available locally, so a stand-in mints the basket token to the keeper instead of swapping. The stand-in in `scripts/lib/local-jupiter.ts` (used by `scripts/keeper-once.ts`) also swaps a pair token to SOL by burning it and paying SOL from an airdropped wallet. `scripts/trade-curve.ts <mint> <rounds>` buys and sells a local launch on its curve to add fees; the seed uses the same approach so CAT opens staking on the first keeper run and DOG stays closed.

## Web app environment

On top of the keeper variables above, the web app needs:

| Variable | What it is |
|---|---|
| `KEEPER_ADDRESS` | Keeper public key, listed on the docs page |
| `SPILL_ADDRESS` | Spill public key; stake pools send penalties to its token accounts |
| `PINATA_JWT` | Pinata API JWT for image and metadata uploads |
| `PINATA_GATEWAY` | Your Pinata gateway domain (optional, else ipfs.io links) |
| `ADMIN_WALLETS` | Comma separated wallet addresses allowed into `/admin` |
| `ADMIN_SESSION_SECRET` | At least 32 random bytes, hex |
| `CONFIG_KEYS_PATH` | Path to `config-keys.json` |
| `NEXT_PUBLIC_RPC_URL` | RPC the browser uses |
| `NEXT_PUBLIC_OURTOKEN_MINT`, `NEXT_PUBLIC_OURTOKEN_SYMBOL` | The platform token |
| `NEXT_PUBLIC_SOL_GRADUATION`, `NEXT_PUBLIC_OURTOKEN_GRADUATION` | Shown on the launch form; must match what the config keys were created with |
| `SITE_URL` | Public origin, e.g. `https://quants.example`; the admin sign in message names its domain |
| `TRUST_PROXY` | `1` behind Caddy or on Vercel so rate limits key on `x-forwarded-for`; leave unset when the app is reachable directly |

Never set these in production: `NEXT_PUBLIC_TEST_WALLET_SECRET`, `PINATA_JWT=stub`, `DEV_UPLOADS_BASE`, `ALLOW_LOCAL_URIS`, `LOCAL_TOKEN_LIST`, `LOCAL_REWARD_MINTS`. They exist for the local seed and end to end run only. The web app and keeper refuse to start when `PINATA_JWT=stub`, `DEV_UPLOADS_BASE`, `ALLOW_LOCAL_URIS`, `LOCAL_TOKEN_LIST` or `LOCAL_REWARD_MINTS` is set and `RPC_URL` is not localhost or 127.0.0.1. The Vercel preview runs against a tunnelled local validator with `PINATA_JWT=stub` and `LOCAL_TOKEN_LIST`, so it sets `ALLOW_DEV_SWITCHES=1`; nothing else should.

`ADMIN_SESSION_SECRET` must be at least 64 hex characters (`openssl rand -hex 32`); the web app refuses to start otherwise.

## Deploying to a VPS

1. Install Bun, Node 22 or newer (for the build), Postgres 16 and Caddy. Create a `quants` user. The service files run `/usr/local/bin/bun`, and the Bun installer puts it in your home directory, so copy it there: `sudo install -m 755 ~/.bun/bin/bun /usr/local/bin/bun`. Check the units with `systemd-analyze verify deploy/*.service`.
2. Clone the repo to `/opt/quants` and put `config-keys.json` in it. Split the variables from `.env.example` into two files, both mode 600 and owned by `quants`:
   - `/opt/quants/keeper.env` (keeper only): `DATABASE_URL`, `RPC_URL`, `KEEPER_KEYPAIR`, `SPILL_KEYPAIR`, `TREASURY_ADDRESS`, `OURTOKEN_MINT`, `KAMINO_GLOBAL_CONFIG`, `DAMM_V2_MIGRATION_CONFIG`, `JUPITER_BASE_URL`, `JUPITER_API_KEY`.
   - `/opt/quants/web.env` (web and indexer): everything in the web table below plus `DATABASE_URL`, `RPC_URL`, `OURTOKEN_MINT`, `KAMINO_GLOBAL_CONFIG`, `DAMM_V2_MIGRATION_CONFIG`, `JUPITER_API_KEY`, `SITE_URL=https://<your domain>` and `TRUST_PROXY=1`. No keypairs.
   - Do not leave a `/opt/quants/.env`: Bun and Next load it into every process started there, which would put the keypairs back into the web server.
3. `bun install`, `bun --env-file=web.env run migrate`, `bun --env-file=web.env run build`.
4. Copy `deploy/quants-web.service`, `deploy/quants-keeper.service` and `deploy/quants-indexer.service` to `/etc/systemd/system/`, then `systemctl enable --now quants-web quants-keeper quants-indexer`.
5. Point your domain at the server, set `QUANTS_DOMAIN` for Caddy, copy `deploy/Caddyfile` to `/etc/caddy/Caddyfile` and reload Caddy. It gets a certificate on its own.
6. Watch the keeper with `journalctl -u quants-keeper -f`. A `ReconcileError` exits the keeper; systemd restarts it after 30 seconds and it exits again until the ledger and wallets agree.

`bun run build` runs `next build` under Node 22 or newer (install Node on the server too), because Bun 1.3.14 crashes when Next's build workers exit. The app itself runs on Bun (`bun --bun next start`), which it needs for `Bun.SQL`.

## Local development

```bash
docker compose up -d
solana-test-validator ... (flags in "Local end-to-end run" above)
bun run seed                                  # writes .env.local and config-keys.json, launches CAT and DOG
bun --env-file=.env.local scripts/keeper-once.ts
bun --env-file=.env.local run indexer         # keep running; fills charts and the home page
bun run dev                                   # http://localhost:3000 (webpack dev server), connect "Test Wallet"
bun run warm                                  # compiles every route once; a first compile reloads open pages
# Editing any .ts file reloads every open page in dev, so do not edit while the browser tests run.
# Do not run `bun run build` while the dev server is running: both write to .next.
set -a; source .env.local; set +a; bun run e2e
```
