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

## Wallets

- **Keeper.** Fee claimer on every DBC config, owner of every graduated LP position, admin of every Kamino farm. Holds claimed fees between keeper runs and pays rent for farms. Launch fees (0.3 SOL each) are paid to it to cover that rent. Keep at least 1 SOL above what the ledger says it owes.
- **Spill.** Only receives early-exit penalties from farms. The keeper burns from it. It should never hold anything else.
- **Treasury.** Receives the platform share. Receive only. It must already exist on-chain (hold at least the rent-exempt minimum of SOL), or small SOL payouts to it fail.

## One-time setup

```bash
docker compose up -d
bun run migrate
bun scripts/create-kamino-global-config.ts         # prints KAMINO_GLOBAL_CONFIG
SOL_GRADUATION=85 OURTOKEN_GRADUATION=<amount> bun scripts/create-configs.ts > config-keys.json
```

Keep `config-keys.json` next to `.env` on the server (it is gitignored because the dev seed regenerates it); the web app reads it from `CONFIG_KEYS_PATH`. Save the initial settings from a script or the admin page (plan 2) with `saveSettings(sql, defaultSettings(OURTOKEN_MINT), "<admin>")`.

## Running the keeper

```bash
bun run keeper
```

It runs every `keeperIntervalSeconds` (default 600) and logs one JSON line per run with `runId`, `launches` and per-launch `errors`.

## Running the trade indexer

```bash
bun run indexer
```

It reads every swap on every quants pool (the curve, then DAMM v2 after graduation) into `trades`. Charts, market stats, volume and the home page come from that table, so they lag the chain by one pass (`INDEXER_INTERVAL_SECONDS`, default 5). It logs a JSON line only when it wrote trades, skipped any, or an address failed. A transaction the RPC lists but will not return is waited on for 10 minutes, then skipped and counted in `skipped` (pruned RPC history causes this). If the RPC has pruned the transaction a cursor points at, the indexer reads that pool again from its recent history. A failing address is skipped for that pass and retried on the next one; one that fails every pass shows in every line. Only one indexer runs at a time (Postgres advisory lock); a second one exits.

Each trade stores the quote token's USD price from Jupiter (`JUPITER_API_KEY`) at the time it was indexed. With no price the trade is stored without one and pages show values in the quote token.

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

The script launches a token, trades it, runs the keeper three times (before staking, after staking, after an early exit) and checks the burn reduced the mint supply by the burned amount. Jupiter is not available locally, so a stand-in mints the basket token to the keeper instead of swapping.

## Web app environment

On top of the keeper variables above, the web app needs:

| Variable | What it is |
|---|---|
| `KEEPER_ADDRESS` | Keeper public key; launch fees are paid to it |
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

1. Install Bun, Node 22 or newer (for the build), Postgres 16 and Caddy. Create a `quants` user.
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
