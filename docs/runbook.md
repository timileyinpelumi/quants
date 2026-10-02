# Runbook

Security review and accepted risks: `docs/security.md`.

## Environment

Copy `.env.example` to `.env` and fill in:

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Postgres for the app and keeper |
| `RPC_URL` | Solana RPC |
| `KEEPER_KEYPAIR` | JSON secret key array of the keeper wallet. Or `KEEPER_KEYPAIR_PATH`, a file holding it (not both) |
| `SPILL_KEYPAIR` | JSON secret key array of the spill wallet. Or `SPILL_KEYPAIR_PATH` |
| `TREASURY_ADDRESS` | Platform treasury (receive only) |
| `KAMINO_GLOBAL_CONFIG` | Optional. Without it the keeper creates one on the first staking open (see Starting with no SOL) |
| `DAMM_V2_MIGRATION_CONFIG` | `A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck` (DAMM v2 Customizable) |
| `JUPITER_BASE_URL` | `https://api.jup.ag/swap/v1` |
| `JUPITER_API_KEY` | Free key from the Jupiter portal; without it requests are limited to 30 a minute |

Seed values, read once when a fresh database gets its first settings version (see Settings). After that the admin page owns them and these do nothing:

| Variable | Seeds |
|---|---|
| `OURTOKEN_MINT`, `OURTOKEN_SYMBOL`, `OURTOKEN_DECIMALS`, `OURTOKEN_GRADUATION` | The platform token. Leave the mint empty until the token exists |
| `QUOTE_GRADUATIONS` | Graduation targets by pair symbol, for example `{"SOL":100,"USDC":15000}` |
| `STOCK_PAIRS` | `1` turns stock pairs on |
| `ALERT_WEBHOOK_URL` | The alert webhook |

## Settings

Business values live in the versioned `settings` table and are edited on the admin page (Settings tab). Saving shows the changed sections and asks to confirm, then writes a new version. Pages read settings through a 5 second cache and the keeper and indexer read them every pass, so a change applies without a rebuild or restart.

| Section | What |
|---|---|
| Launches | Pause new launches (prepare refuses and the launch page says so; trading, staking and the keeper carry on), site banner shown on every page |
| Pairs | Which pair tokens new launches can use, the graduation target of each, the creator payout minimum per pair, stock pairs on or off |
| Platform token | Mint (empty means not launched: the home page shows the prelaunch card), symbol, decimals, graduation target, offered as a pair |
| Fees | Fee tiers offered (0.25% to 10%, up to four), fee split, swap slippage cap, first buy cap |
| Staking | Lock tiers, max early exit penalty, reward stream period |
| Keeper | Run interval, alert webhook |
| Home page | Featured headline and text, prelaunch message (`{symbol}` becomes the platform symbol), X link (empty falls back to `NEXT_PUBLIC_X_URL`) |

What stays in the env and why: database, RPC and Jupiter URLs and keys, Cloudinary, keypairs, wallet addresses (`TREASURY_ADDRESS`, `KEEPER_ADDRESS`, `SPILL_ADDRESS`, `PLATFORM_ADDRESSES`), `DAMM_V2_MIGRATION_CONFIG`, `QUOTE_MINTS`, `KAMINO_GLOBAL_CONFIG` and `CONFIG_KEYS`: secrets, infrastructure addresses or chain data that must match the network. `NEXT_PUBLIC_RPC_URL` is built into the browser bundle. `INDEXER_INTERVAL_SECONDS` and the backup settings are operations, not product.

## Wallets

- **Keeper.** Fee claimer on every DBC config, owner of every graduated LP position, admin of every Kamino farm. Holds claimed fees between keeper runs and pays rent for farms. That rent comes out of each launch's stakers' share (see Staking opens), so the ledger moves it out of the basket before the keeper spends it. Keep at least 1 SOL above what the ledger says it owes for transaction fees and retries.
- **Spill.** Only receives early-exit penalties from farms. The keeper burns from it. It should never hold anything else.
- **Treasury.** Receives the platform share. Receive only. It must already exist on-chain (hold at least the rent-exempt minimum of SOL), or small SOL payouts to it fail.

## One-time setup

```bash
docker compose up -d
bun run migrate
```

Nothing else is needed on chain before the first launch (see Starting with no SOL). The first settings version is written from the env seed the first time anything reads settings.

### Graduation targets

Each pair graduates once a set amount of the pair token has been raised on the curve: 85 SOL, 12,000 USDC, 12,000 USDT and 30,000 JUP by default, and the platform token's own target. Change them on the admin page under Pairs and Platform token.

The target is fixed into the DBC config key a pool is created from, and every pool keeps the target it started with. Config keys live in the `config_keys` table by pair, fee tier and threshold. When a launch needs a key for the current target that does not exist yet, prepare returns a setup step first that creates it, paid by that launcher (about 0.008 SOL of rent), and records the key. The launcher approves it on its own, and the launch transaction is built only after it confirmed. So a new target applies to the next launch on that pair, and old pools keep theirs. The first prepare claims the row, so two first launches on the same pair get the same address; one setup transaction lands, the other fails harmlessly (it is optional) and both launches go through. A pending key is trusted only once it is on chain with the keeper as fee claimer, the right mint and the right threshold.

`CONFIG_KEYS` (or `config-keys.json` at `CONFIG_KEYS_PATH`) is an optional seed: keys made by `scripts/create-configs.ts` are recorded on the first prepare with the threshold read from chain and reused when it matches. Stock pairs still need keys made by the script, since their graduation is set per stock.

### Stock pairs

Tokenized stocks (xStocks from Backed, and Backpack stocks such as `SPCX.US`) can be pair tokens. New stock launches are off by default because these launches have no staking: the launch form shows crypto pairs only, the docs page leaves out the stock section, and `/api/launch/prepare` refuses a stock pair. Turn on Stock pairs on the admin page (or seed it with `STOCK_PAIRS=1`). Stock launches that already exist keep trading either way, the registry keeps refreshing, and `e2e/stocks.spec.ts` runs only when `STOCK_PAIRS=1` is set for the Playwright run and the setting is on. They are Token-2022 mints, so:

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

It runs every `keeperIntervalSeconds` (default 600, set on the admin page) and logs one JSON line per run with `runId`, `launches` and per-launch `errors`.

### Starting with no SOL

Nothing has to be paid for up front:

- **Config keys** are created by the first launch that needs one, in that launcher's setup transaction (see Graduation targets).
- **The Kamino global config.** Without `KAMINO_GLOBAL_CONFIG`, the first launch to open staking covers it: its rent includes the global config (about 0.016 SOL), its `rent` row carries `detail.globalConfig = true`, and the keeper creates the global config (keeper as admin, treasury fee 0) before that launch's farms and records it in `platform_accounts`. Other launches wait for it and pay only their own rent. Set `KAMINO_GLOBAL_CONFIG` to use an existing one instead.
- **Keeper float.** While the keeper holds under 0.01 SOL, every launch transaction tops it up to 0.01 SOL from the launcher (never more than 0.01 SOL, nothing once it is funded). That covers the keeper's first fee claim.
- **The platform token** is launched by the operator from their own wallet, like any launch: leave its mint empty until then, then set it on the admin page.

The remaining minimum is about 0.01 SOL in the keeper for its first fee claim, which the first launch provides. After that the keeper pays farm rent from each launch's stakers' share and its fees from claimed fees; keep an eye on the Wallets tab, which turns the keeper red below 0.01 SOL.

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

Set the alert webhook on the admin page (Keeper section; `ALERT_WEBHOOK_URL` seeds it) and the keeper and indexer post `{"text": "..."}` to it. They pick up a change on their next pass. That works as is with Slack incoming webhooks and anything that accepts the same body. For Discord, add `/slack` to the end of the channel's webhook URL. With no webhook nothing is sent.

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
| `CLOUDINARY_URL` | `cloudinary://<api key>:<api secret>@<cloud name>` from the Cloudinary console, for launch images and metadata JSON. Or set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` |
| `ADMIN_CODE_HASH` | argon2id hash of the admin access code, base64, from `bun scripts/admin-code.ts` (see Admin access) |
| `ADMIN_SESSION_SECRET` | At least 32 random bytes, hex; signs the admin session cookie |
| `CONFIG_KEYS_PATH` | Optional path to `config-keys.json` (a seed, see Graduation targets) |
| `NEXT_PUBLIC_RPC_URL` | RPC the browser uses |
| `PLATFORM_ADDRESSES` | Public addresses of the platform wallet roles, from `bun scripts/hd-wallet.ts env`; the admin Wallets tab lists them with balances |
| `SITE_URL` | Public origin, e.g. `https://quants.example`; admin requests must come from it, and shared token links preview with images from it |
| `NEXT_PUBLIC_X_URL` | Fallback X profile when the admin X link is empty; shown in the header, menu, footer and the prelaunch card. Neither set hides it |
| `TRUST_PROXY` | `1` behind Caddy or on Vercel so rate limits key on `x-forwarded-for`; leave unset when the app is reachable directly |

Uploads are signed server side: images go to Cloudinary as image uploads and metadata JSON as raw uploads under the `quants` folder, named by a hash of their content, and the token URI and image are the returned `https://res.cloudinary.com/...` links. The API secret never reaches the browser. Without Cloudinary set, `/api/metadata` refuses uploads, except in local development where `DEV_UPLOADS_BASE` keeps files in `.dev-uploads` and serves them from `/api/dev-uploads`. Launches made before the switch keep their IPFS links.

Never set these in production: `NEXT_PUBLIC_TEST_WALLET_SECRET`, `PINATA_JWT=stub`, `DEV_UPLOADS_BASE`, `ALLOW_LOCAL_URIS`, `LOCAL_TOKEN_LIST`, `LOCAL_REWARD_MINTS`. They exist for the local seed and end to end run only. The web app and keeper refuse to start when `PINATA_JWT=stub`, `DEV_UPLOADS_BASE`, `ALLOW_LOCAL_URIS`, `LOCAL_TOKEN_LIST` or `LOCAL_REWARD_MINTS` is set and `RPC_URL` is not localhost or 127.0.0.1. The Vercel preview runs against a tunnelled local validator with `PINATA_JWT=stub` and `LOCAL_TOKEN_LIST`, so it sets `ALLOW_DEV_SWITCHES=1`; nothing else should. (`PINATA_JWT=stub` now only turns on local uploads, like `DEV_UPLOADS_BASE`.)

`ADMIN_SESSION_SECRET` must be at least 64 hex characters (`openssl rand -hex 32`) and `ADMIN_CODE_HASH` must be an argon2id hash; the web app refuses to start otherwise.

### Admin access

`/admin` asks for one access code. Create it once per network:

```bash
bun scripts/admin-code.ts                       # mainnet; --cluster devnet or localnet for the others
```

It writes the plain code to `~/.config/quants/<cluster>/admin-code.txt` (mode 600, in a mode 700 folder) and prints the `ADMIN_CODE_HASH=` line for the env file. The server only ever sees the hash. The script refuses to overwrite an existing code file; `--rotate` makes a new code, and deploying its hash ends every admin session at once (sessions are tied to the hash they were made with).

- A session lasts 12 hours. The cookie is httpOnly, SameSite=Strict, Secure in production, and signed with `ADMIN_SESSION_SECRET`; the session itself is a row in `admin_sessions`, so Sign out ends it on the server.
- Five wrong codes from one address in 15 minutes lock that address for the rest of the window. Fifty wrong codes in an hour from anywhere lock sign in for everyone until the hour passes. Every attempt is a row in `admin_logins` and a log line (`adminLogin`). To unlock early: `delete from admin_logins where not ok`.
- Admin API requests from another origin are refused (Origin and Sec-Fetch-Site checks).
- Lost the code: run the script with `--rotate`, put the new hash in the env file and deploy.

## Deploying to a VPS

1. Install Bun, Node 22 or newer (for the build), Postgres 16 and Caddy. Create a `quants` user. The service files run `/usr/local/bin/bun`, and the Bun installer puts it in your home directory, so copy it there: `sudo install -m 755 ~/.bun/bin/bun /usr/local/bin/bun`. Check the units with `systemd-analyze verify deploy/*.service`.
2. Clone the repo to `/opt/quants` and put `config-keys.json` in it. Split the variables from `.env.example` into two files, both mode 600 and owned by `quants`:
   - `/opt/quants/keeper.env` (keeper only): `DATABASE_URL`, `RPC_URL`, `KEEPER_KEYPAIR`, `SPILL_KEYPAIR`, `TREASURY_ADDRESS`, `DAMM_V2_MIGRATION_CONFIG`, `JUPITER_BASE_URL`, `JUPITER_API_KEY`, optionally `KAMINO_GLOBAL_CONFIG`.
   - `/opt/quants/web.env` (web and indexer): everything in the web table below plus `DATABASE_URL`, `RPC_URL`, `DAMM_V2_MIGRATION_CONFIG`, `JUPITER_API_KEY`, `SITE_URL=https://<your domain>` and `TRUST_PROXY=1`. No keypairs.
   - Do not leave a `/opt/quants/.env`: Bun and Next load it into every process started there, which would put the keypairs back into the web server.
3. `bun install`, `bun --env-file=web.env run migrate`, `bun --env-file=web.env run build`.
4. Copy `deploy/quants-web.service`, `deploy/quants-keeper.service` and `deploy/quants-indexer.service` to `/etc/systemd/system/`, then `systemctl enable --now quants-web quants-keeper quants-indexer`.
5. Point your domain at the server, set `QUANTS_DOMAIN` for Caddy, copy `deploy/Caddyfile` to `/etc/caddy/Caddyfile` and reload Caddy. It gets a certificate on its own.
6. Watch the keeper with `journalctl -u quants-keeper -f`. A `ReconcileError` exits the keeper; systemd restarts it after 30 seconds and it exits again until the ledger and wallets agree.

`bun run build` runs `next build` under Node 22 or newer (install Node on the server too), because Bun 1.3.14 crashes when Next's build workers exit. The app itself runs on Bun (`bun --bun next start`), which it needs for `Bun.SQL`.

## AWS (EC2, Docker Compose)

One EC2 instance runs everything from `docker-compose.prod.yml`: Postgres 18 (named volume, not published on the host), a one shot `migrate`, `web` (Next on 3000, reachable only through Caddy), `indexer`, `keeper`, Caddy on 80 and 443 with automatic HTTPS, and `backup`. The app image is built on the instance from the `Dockerfile`; `migrate`, `web`, `indexer` and `keeper` all run it with different commands. Container logs are capped at 5 files of 10 MB each.

Caches (prices, icons, landing data, the rate limiter) live in each process's memory. With one web container that is all the sharing needed, so there is no Redis. A second web replica would need a shared rate limiter.

The scripts in `deploy/aws/` use the AWS CLI on your machine (`aws configure` or `aws sso login` first). They default to `us-east-1`; override with `REGION`, `NAME`, `INSTANCE_TYPE` and `KEY_FILE`.

### Provision

```bash
deploy/aws/provision.sh            # add --dns to upsert the A records when quants.wtf is in Route 53
```

It creates or reuses: key pair `quants` (private key in `~/.ssh/quants-deploy.pem`), security group `quants` (22 from your current IP only, 80 and 443 from anywhere), an Ubuntu 24.04 `t3.medium` with a 30 GB gp3 disk, and an Elastic IP. User data installs Docker with the compose plugin and adds 4 GB of swap; the Next build needs it on a 4 GB instance. It saves the IP in `deploy/aws/.host`, waits up to 10 minutes for first boot, and prints the DNS records to create. Running it again from a new IP adds that IP to port 22; remove old rules in the console.

With `BACKUP_BUCKET=<bucket>` it also gives the instance a role that can write backups to that bucket, so no AWS keys go into `.env.production`.

### DNS

Create two A records pointing at the Elastic IP: `quants.wtf` and `www.quants.wtf` (`www` redirects to the bare domain). If the zone is in Route 53, `provision.sh --dns` upserts them. Let's Encrypt only issues a certificate once the A record resolves to the instance, so until DNS has propagated Caddy logs certificate errors and keeps retrying. Check with `dig +short quants.wtf`.

Before DNS is pointed, use sslip.io, which resolves `<ip with dashes>.sslip.io` to that IP: set `SITE_HOST=3-80-12-34.sslip.io` and `SITE_URL=https://3-80-12-34.sslip.io` (the line provision prints). Let's Encrypt issues for it like any other name. Switch both to `quants.wtf` and deploy again once DNS resolves; admin requests are only accepted from `SITE_URL`.

### Fill .env.production and secrets

```bash
cp .env.production.example .env.production      # gitignored; fill in every empty value
mkdir -p secrets
bun scripts/hd-wallet.ts show                    # keeper, spill, treasury addresses
bun scripts/hd-wallet.ts export keeper secrets/keeper.json
bun scripts/hd-wallet.ts export spill secrets/spill.json
```

`KEEPER_ADDRESS`, `SPILL_ADDRESS` and `TREASURY_ADDRESS` come from `show`. Make the admin code with `bun scripts/admin-code.ts` and paste its `ADMIN_CODE_HASH=` line. `PLATFORM_ADDRESSES` is the line `bun scripts/hd-wallet.ts env` prints: every role's public address, which the admin Wallets tab lists with its derivation path and SOL balance (the keeper row turns red below 0.01 SOL). The seed phrase never goes to the server. `CONFIG_KEYS` is optional: the contents of a `config-keys.json` on one line, in single quotes, when you made keys with the script. `POSTGRES_PASSWORD` must be hex (`openssl rand -hex 24`) because it goes into `DATABASE_URL` as is. The keypairs are mounted read only into the keeper container only (`/run/secrets/keeper` and `/run/secrets/spill`, read through `KEEPER_KEYPAIR_PATH` and `SPILL_KEYPAIR_PATH`); they are never in the image or in `.env.production`. The container user has uid 1000, the same as `ubuntu` on the instance, so the files can stay mode 600.

### Deploy

```bash
deploy/aws/deploy.sh
```

It checks that each keypair file matches its address and that required values are set, rsyncs the repo (without `.git`, `node_modules`, `.next`, local env files and devnet state) plus `.env.production` and `secrets/` to `/opt/quants`, builds the image there tagged with the commit (`quants-app:<sha>`, plus `latest`), runs `docker compose up -d`, waits for web to be healthy and then runs `deploy/aws/smoke.sh` on the instance. The smoke check passes when `migrate` exited 0, web returns 200 on `/` and `/explore` (inside the network and on `https://SITE_HOST/`), the indexer logged its first pass and the keeper logged a run, with no restarts. On a fresh database the first settings version comes from the env seed, so the keeper runs straight away. Sign in on `/admin` with the code to check and change the settings. `NEXT_PUBLIC_*` values are built into the bundle, so every deploy rebuilds; settings do not need one. A build takes several minutes on a t3.medium.

### Logs

```bash
deploy/aws/logs.sh                      # last 200 lines of every service
deploy/aws/logs.sh keeper indexer
FOLLOW=1 deploy/aws/logs.sh keeper      # follow until Ctrl-C
```

On the instance: `cd /opt/quants && docker compose -f docker-compose.prod.yml --env-file .env.production ps` (or `logs`, `restart keeper`).

### Backups

The `backup` container runs `pg_dump -Fc` every day at `BACKUP_HOUR_UTC` (default 3) into `/opt/quants/backups`, deletes dumps older than `BACKUP_RETENTION_DAYS` (default 7), and copies each new dump to `BACKUP_S3_URI` (for example `s3://my-bucket/quants`) when that is set. Credentials come from the instance role (`BACKUP_BUCKET` on provision) or `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in `.env.production`; those keys reach every container that reads the env file, so prefer the role.

```bash
deploy/aws/backup-now.sh                # dump now; --download also copies it to ./backups here
```

Restore, on the instance (this replaces the database):

```bash
cd /opt/quants
C="docker compose -f docker-compose.prod.yml --env-file .env.production"
$C stop web indexer keeper
$C exec -T postgres sh -c 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backups/quants-<stamp>.dump
$C start web indexer keeper
```

To restore from S3 first: `aws s3 cp s3://<bucket>/quants/quants-<stamp>.dump backups/`. The keeper reconciles the ledger against the wallets on its first run; a dump older than the last keeper run can make it stop with a `ReconcileError` (see When something goes wrong).

### Update

Pull or commit locally, then `deploy/aws/deploy.sh` again. New migrations run in `migrate` before the other services start.

### Rollback

The last five builds stay on the instance. On the instance:

```bash
cd /opt/quants
docker images quants-app                         # pick the tag to go back to
docker tag quants-app:<sha> quants-app:latest
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --no-build
```

Migrations are not rolled back. An older build has to work with the newer schema, or restore a backup taken before the deploy. The next `deploy.sh` builds from your working tree again, so check out the old commit locally if the rollback should stick.

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

## Devnet

`CLUSTER` picks the network: `localnet` (the default, everything above), `devnet` or `mainnet`. It sets the RPC default when `RPC_URL` is unset (devnet: `DEVNET_RPC_URL`, else `https://api.devnet.solana.com`), the config keys file (`config-keys.devnet.json` on devnet unless `CONFIG_KEYS_PATH` is set), the swap adapter and the token list. Nothing else changes between networks.

Jupiter does not serve devnet and the real reward tokens do not exist there, so on devnet:

- **Swaps** (keeper reward swaps, rent swaps, and a first buy in QUANTS) go through DAMM v2 pools of stand-in tokens against SOL, as real on-chain swaps with a minimum out from the slippage cap. The keeper refuses a swap transaction that does anything other than a DAMM v2 swap on one of those pools into its own accounts, compute budget, its token accounts and wrapping its own SOL. Only SOL to token and token to SOL have a route: a QUANTS launch buys rewards only with the SOL left after its rent swap, and a USDC launch cannot open staking (there is no USDC pool).
- **Token search** and the popular list return the stand-ins (dZEC, dJUP, dBONK, dWIF, dCATE) and QUANTS, from `DEVNET_TOKENS`.
- **Prices**: SOL and devnet USDC use their mainnet Jupiter prices; stand-ins and QUANTS are their pool price times SOL.

### Bootstrap

The keeper key lives in `~/.config/quants/devnet-keeper.json`. Check the plan and the budget first; this only reads the chain:

```bash
bun scripts/devnet-bootstrap.ts --dry-run
```

It lists each step as `done` or `todo`, the SOL each part costs (about 2.5 SOL with the defaults, almost all of it the 0.3 SOL a side seeded into six pools) and what `scripts/devnet-run.ts` needs after it (about 3.8 SOL, about half of which comes back at the end). Fund the keeper (https://faucet.solana.com, or `solana airdrop` against devnet), then run it:

```bash
DEVNET_RPC_URL='https://devnet.helius-rpc.com/?api-key=<key>' bun scripts/devnet-bootstrap.ts
```

It stops before sending anything if the keeper holds less than the steps left need. Options: `--liquidity-sol 0.3` per pool side, `--sol-graduation 2`, `--usdc-graduation 300`, `--quants-per-sol 1000000` (the QUANTS pool price; the QUANTS graduation defaults to the SOL target times this), `--quants-graduation <units>`, `--rpc`, `--keeper`, `--state`.

It creates the QUANTS mint (6 decimals) and five stand-ins with Metaplex metadata (the keeper is mint and update authority and holds the supply), one DAMM v2 pool per token against SOL, the Kamino global config (treasury fee 0), DBC config keys for SOL, devnet USDC (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`) and QUANTS at each fee tier, a spill and a treasury keypair in `~/.config/quants/` (the treasury is funded to the rent-exempt minimum). Every address goes into `devnet-state.json` before its transaction is sent and every step checks the chain first, so after a failure run it again and it carries on. Config keys keep the graduation target they were created with.

It writes three gitignored files:

- `config-keys.devnet.json`
- `devnet.env`: `CLUSTER=devnet`, the keeper, spill and treasury addresses, `OURTOKEN_*`, `KAMINO_GLOBAL_CONFIG`, `DAMM_V2_MIGRATION_CONFIG`, `QUOTE_MINTS` (devnet USDC), `QUOTE_GRADUATIONS`, `CONFIG_KEYS_PATH` and `CONFIG_KEYS`, `DEVNET_TOKENS` and `NEXT_PUBLIC_RPC_URL`. `NEXT_PUBLIC_RPC_URL` is the public devnet RPC, because the browser sees it; keep a keyed RPC in `DEVNET_RPC_URL`.
- `devnet.secrets.env`: `KEEPER_KEYPAIR` and `SPILL_KEYPAIR`. Keeper only; never give these to the web app.

### Env merge

Use a database of its own for devnet, so devnet launches never mix with local ones:

```bash
psql postgres://quants:quants@localhost:5434/quants -c 'create database quants_devnet'
cat devnet.env devnet.secrets.env > .env.devnet
cat >> .env.devnet <<'ENV'
DATABASE_URL=postgres://quants:quants@localhost:5434/quants_devnet
DEVNET_RPC_URL=https://devnet.helius-rpc.com/?api-key=<key>
ADMIN_CODE_HASH=<from bun scripts/admin-code.ts --cluster devnet>
ADMIN_SESSION_SECRET=<openssl rand -hex 32>
CLOUDINARY_URL=cloudinary://<key>:<secret>@<cloud>
SITE_URL=http://localhost:3000
ENV
bun --env-file=.env.devnet run migrate
```

Do not put the local dev switches (`LOCAL_*`, `DEV_UPLOADS_BASE`, `ALLOW_LOCAL_URIS`, `PINATA_JWT=stub`) in it: they refuse to start against a remote RPC.

### Indexer, keeper and web app on devnet

```bash
bun --env-file=.env.devnet run indexer                 # keep running
bun --env-file=.env.devnet run keeper                  # or once: bun --env-file=.env.devnet scripts/keeper-once.ts
bun --env-file=.env.devnet run dev                     # web app against devnet, connect a real wallet set to devnet
```

Next reads `.env.local` on its own and adds every variable from it that is not already set, which brings back the local dev switches and the test wallet. Move it aside while the web app runs on devnet (`mv .env.local .env.local.off`), or run devnet from a separate checkout. Bun with `--env-file` reads only the file given, so the keeper, indexer and scripts are not affected.

All three read `RPC_URL` from `DEVNET_RPC_URL` when `RPC_URL` is unset. On devnet raise the slippage cap to 5% on the admin page, since the stand-in pools are small.

### Lifecycle run

```bash
bun --env-file=.env.devnet scripts/devnet-run.ts
```

It generates two wallets, funds them from the keeper and drives one launch through its life, running the keeper in process between steps: a SOL launch at 3% with a dZEC/dJUP/dBONK basket, buy and sell round trips until the stakers' share pays for the farms (a keeper pass every 5 round trips), a keeper pass for swaps and funding, a stake from each wallet (1d and 7d), an early exit from the 7d stake, the keeper collecting and burning the penalty, the creator payout, buys until the curve fills, migration to DAMM v2, a sale on DAMM v2 and a keeper pass after graduation, and finally the wallets' SOL sent back to the keeper. Each transaction is printed with an explorer link, and `docs/devnet-readiness.md` is rewritten after every step with the steps, results, transaction counts, fees and what differed from localnet.

Devnet drops transactions, so every step is kept in `devnet-run-state.json` (wallet keys included) and a second run skips what is done; a failed step is tried again from its start. Sends resend until the blockhash expires and each step retries at most 4 times. To start a new launch, delete `devnet-run-state.json`. Options: `--round-trip-sol 0.5`, `--max-round-trips 60`, `--state`.

### Vercel preview on devnet

Set these on the preview environment (`vercel env add <name> preview`), from `devnet.env`:

- Everything in `devnet.env` (including `CONFIG_KEYS`, since `config-keys.devnet.json` is not committed, and `DEVNET_TOKENS`).
- `DATABASE_URL` (a Neon database migrated with `bun --env-file=<neon env> run migrate`), `DEVNET_RPC_URL`, `ADMIN_CODE_HASH`, `ADMIN_SESSION_SECRET`, `CLOUDINARY_URL`, `SITE_URL=https://<preview domain>`, `TRUST_PROXY=1`.
- Remove the tunnel setup: `RPC_URL` and `NEXT_PUBLIC_RPC_URL` pointing at the tunnel, `ALLOW_DEV_SWITCHES`, `PINATA_JWT`, `LOCAL_TOKEN_LIST`, `ALLOW_LOCAL_URIS`, `DEV_UPLOADS_BASE` and `NEXT_PUBLIC_TEST_WALLET_SECRET` (the build refuses the test wallet with a non-local RPC).

Never put `KEEPER_KEYPAIR` or `SPILL_KEYPAIR` on Vercel. Run the keeper and indexer from your machine or the VPS with `.env.devnet`, then redeploy the preview so `NEXT_PUBLIC_RPC_URL` is built in.
