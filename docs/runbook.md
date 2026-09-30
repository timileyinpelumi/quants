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
| `JUPITER_BASE_URL` | `https://lite-api.jup.ag/swap/v1` |

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

Commit `config-keys.json`; the launch API reads config keys from it. Save the initial settings from a script or the admin page (plan 2) with `saveSettings(sql, defaultSettings(OURTOKEN_MINT), "<admin>")`.

## Running the keeper

```bash
bun run keeper
```

It runs every `keeperIntervalSeconds` (default 600) and logs one JSON line per run with `runId`, `launches` and per-launch `errors`.

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
