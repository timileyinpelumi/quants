# Quants Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend of quants: two validator spikes, domain math, a crash-safe step ledger, launch preparation, and the keeper that claims fees, splits them, swaps into reward baskets, funds Kamino farms, and burns early-exit penalties.

**Architecture:** One Bun + TypeScript package. Pure domain functions (`src/domain`) hold all money math in `bigint`. A Postgres ledger (`src/ledger`) records every on-chain step before it is sent, so the keeper resumes after a crash without sending anything twice. Chain access sits behind small ports (`ChainPort`, `MeteoraPort`, `StakingAdapter`, `JupiterPort`) so keeper steps are tested with fakes; the real ports wrap the Meteora DBC, Meteora cp-amm, Kamino Farms and Jupiter APIs.

**Tech Stack:** Bun 1.2+, TypeScript, Postgres 16 (`Bun.SQL`), `@meteora-ag/dynamic-bonding-curve-sdk@1.5.13`, `@meteora-ag/cp-amm-sdk@1.5.1`, `@kamino-finance/farms-sdk@4.0.1` (uses `@solana/kit` 7), `@solana/web3.js` 1.98, `@solana/spl-token` 0.4, `zod`, `decimal.js`, Jupiter Swap API v1.

**Spec:** `docs/specs/2026-09-30-quants-design.md`

**Not in this plan:** the Next.js web app, metadata upload, user-facing stake/claim/exit transaction builders, and the admin UI. Those go in plan 2 (`2026-xx-xx-quants-web.md`), written after this plan lands. Plan 2 calls `prepareLaunch`, `confirmLaunch`, `saveSettings` and the `StakingAdapter` defined here.

## Global Constraints

- Bun only: `bun install`, `bun test`, `bun run`, `bunx`. Never npm/yarn/pnpm.
- Git identity `timileyinpelumi <timmypelumy@gmail.com>`; no AI attribution lines in commits.
- All token amounts are `bigint` base units. No `number` for money. Percentages are basis points (`10_000` = 100%).
- Default settings, copied from the spec: split basket/platform/creator 60/25/15; creator payout minimum 0.05 SOL equivalent; tiers 7d 1x, 30d 1.5x, 90d 2x, 180d 3x; max early exit penalty 30%; reward stream period 24 hours; swap slippage cap 1%; launch fee 0.3 SOL; dev buy cap 50% of supply; keeper interval 10 minutes; default staking backend `kamino`.
- Fee tiers 1%, 2%, 3%, 5%; quote tokens SOL and OURTOKEN; one DBC config key per (quote, tier).
- Launched tokens are classic SPL tokens (`TokenType.SPLToken`), 6 decimals, 1,000,000,000 supply.
- The platform never receives early-exit penalties. Every collected penalty token is burned.
- Keeper runs as a single instance. Postgres writes that must be atomic are single statements (see memory note on `Bun.SQL` pooled result mixing: no concurrent `sql.begin` on the hot path).
- Minimal comments: only for non-obvious constraints.

## Review Focus

1. Keeper process dies after a transaction is sent but before it is confirmed: on restart the step is resolved from its stored signature and never re-sent while the old blockhash is still valid (Task 6, Task 16).
2. A launch has baskets funded but nobody staked in any tier: the reward tokens stay in escrow and are funded on a later run, never sent to a farm with zero stake (Task 13).
3. Jupiter has no route, or the quote exceeds the slippage cap, for one basket token: that token's share stays in escrow and the other basket tokens still swap (Task 12).
4. The ledger says the keeper holds more of a mint than the wallet does (manual withdrawal, bug, rent): the keeper halts the run instead of spending funds that belong to other launches (Task 16).
5. A transaction fails deterministically every time (bad account, program error): the step stops after 5 attempts and is marked failed instead of retrying forever (Task 6).

---

## File Structure

```
quants/
  package.json, tsconfig.json, bunfig.toml, docker-compose.yml, .env.example
  db/migrations/001_init.sql
  spike/                          throwaway validator scripts (Tasks 1-2)
  docs/spikes/kamino.md, docs/spikes/dbc.md
  src/
    env.ts                        typed env loading
    db/client.ts, db/migrate.ts
    domain/types.ts               shared types
    domain/weights.ts             splitByWeights, splitFees, allocateAcrossTiers
    domain/rate.ts                kaminoRawRps
    domain/penalty.ts             earlyExitPenalty
    domain/settings.ts            schema, defaults, load/save
    ledger/ledger.ts              distributions + escrow persistence
    ledger/run-step.ts            runTxStep, runDbStep, resolveSent
    chain/port.ts                 ChainPort, SignedTx
    chain/solana.ts               web3.js implementation, kit instruction bridge
    meteora/config.ts             DBC config parameter builder
    meteora/port.ts               MeteoraPort + implementation
    launch/prepare.ts, launch/confirm.ts
    jupiter/port.ts               JupiterPort + implementation
    staking/adapter.ts            StakingAdapter interface
    staking/kamino.ts             KaminoBackend
    keeper/deps.ts                KeeperDeps
    keeper/steps/*.ts             one file per step
    keeper/resolvers.ts           kind -> delta resolver registry
    keeper/run.ts                 runKeeper, processLaunch, reconcile
    keeper/main.ts                interval loop entry point
  scripts/create-configs.ts, scripts/create-kamino-global-config.ts
  tests/                          mirrors src/
```

---

### Task 1: Kamino Farms spike (throwaway)

Confirms the staking assumptions on a local validator with the mainnet Kamino program cloned. Output is `docs/spikes/kamino.md`. Code in `spike/` is not reused.

**Files:**
- Create: `spike/kamino.ts`, `docs/spikes/kamino.md`, `package.json` (minimal, extended in Task 3)

**Interfaces:**
- Produces: findings consumed by Task 12-15 (`rpsDecimals` default, penalty behaviour on `unstakeIx`, whether rate changes apply to active stakers).

- [ ] **Step 1: Start a validator with Kamino Farms cloned**

```bash
solana-test-validator --reset \
  --url https://api.mainnet-beta.solana.com \
  --clone-upgradeable-program FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr
```

- [ ] **Step 2: Install spike dependencies**

```bash
cd /home/timileyin/dev/personal/quants
bun add @kamino-finance/farms-sdk@4.0.1 @solana/kit@^7 @solana/web3.js@^1.98 @solana/spl-token@^0.4.13 decimal.js
```

- [ ] **Step 3: Write the spike script**

`spike/kamino.ts` must, in order, log each result:

```ts
import { Farms, FarmConfigOption } from "@kamino-finance/farms-sdk";
import { createSolanaRpc, createNoopSigner, address, type Instruction } from "@solana/kit";
import { Connection, Keypair, Transaction, TransactionInstruction, PublicKey, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount } from "@solana/spl-token";
import Decimal from "decimal.js";

const RPC = "http://127.0.0.1:8899";
const conn = new Connection(RPC, "confirmed");
const farms = new Farms(createSolanaRpc(RPC));

const toWeb3 = (ix: Instruction) => new TransactionInstruction({
  programId: new PublicKey(ix.programAddress),
  keys: (ix.accounts ?? []).map((a) => ({ pubkey: new PublicKey(a.address), isSigner: a.role >= 2, isWritable: a.role === 1 || a.role === 3 })),
  data: Buffer.from(ix.data ?? []),
});
const signer = (kp: Keypair) => createNoopSigner(address(kp.publicKey.toBase58()));
const send = (ixs: Instruction[], signers: Keypair[]) =>
  sendAndConfirmTransaction(conn, new Transaction().add(...ixs.map(toWeb3)), signers);

const admin = Keypair.generate(), alice = Keypair.generate(), bob = Keypair.generate(), spill = Keypair.generate();
for (const k of [admin, alice, bob, spill]) await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 10 * LAMPORTS_PER_SOL));

const stakeMint = await createMint(conn, admin, admin.publicKey, null, 6);
const rewardMints = [await createMint(conn, admin, admin.publicKey, null, 6), await createMint(conn, admin, admin.publicKey, null, 9), await createMint(conn, admin, admin.publicKey, null, 6)];

const globalConfig = Keypair.generate();
await send(await farms.createGlobalConfigIxs(signer(admin), signer(globalConfig)), [admin, globalConfig]);
const farm = Keypair.generate();
await send(await farms.createFarmIxs(signer(admin), signer(farm), address(globalConfig.publicKey.toBase58()), address(stakeMint.toBase58())), [admin, farm]);
const farmAddr = address(farm.publicKey.toBase58());
for (const m of rewardMints) await send([await farms.addRewardToFarmIx(signer(admin), address(globalConfig.publicKey.toBase58()), farmAddr, address(m.toBase58()), address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"))], [admin]);

const spillAta = await getOrCreateAssociatedTokenAccount(conn, admin, stakeMint, spill.publicKey);
const cfg = async (mode: FarmConfigOption, value: number | bigint | ReturnType<typeof address>) =>
  send([await farms.updateFarmConfigIx(signer(admin), farmAddr, address(rewardMints[0].toBase58()), mode, value)], [admin]);
await cfg(FarmConfigOption.LockingMode, 1);
await cfg(FarmConfigOption.LockingDuration, 60);
await cfg(FarmConfigOption.LockingEarlyWithdrawalPenaltyBps, 3000);
await cfg(FarmConfigOption.WithdrawCooldownPeriod, 0);
await cfg(FarmConfigOption.SlashedAmountSpillAddress, address(spillAta.address.toBase58()));

// fund reward 0 with 1000 tokens and set rps so it streams over 100s
const adminRewardAta = await getOrCreateAssociatedTokenAccount(conn, admin, rewardMints[0], admin.publicKey);
await mintTo(conn, admin, rewardMints[0], adminRewardAta.address, admin, 10_000_000_000n);
await send([await farms.addRewardAmountToFarmIx(signer(admin), farmAddr, address(rewardMints[0].toBase58()), new Decimal(1000))], [admin]);
let state = (await farms.getAllFarmStatesByPubkeys([farmAddr]))[0].farmState;
console.log("rpsDecimals", state.rewardInfos[0].rewardsPerSecondDecimals, "rewardsAvailable", state.rewardInfos[0].rewardsAvailable);
const rawRps = (1_000_000_000n * 10n ** BigInt(state.rewardInfos[0].rewardsPerSecondDecimals)) / 100n;
await send([await farms.updateFarmConfigIx(signer(admin), farmAddr, address(rewardMints[0].toBase58()), FarmConfigOption.UpdateRewardRps, rawRps)], [admin]);

// alice and bob stake 100 each
for (const u of [alice, bob]) {
  const ata = await getOrCreateAssociatedTokenAccount(conn, admin, stakeMint, u.publicKey);
  await mintTo(conn, admin, stakeMint, ata.address, admin, 100_000_000n);
  await send([await farms.createNewUserIx(signer(u), farmAddr)], [u]);
  await send([await farms.stakeIx(signer(u), farmAddr, new Decimal(100_000_000), address(stakeMint.toBase58()), { __option: "None" } as any)], [u]);
}
await Bun.sleep(20_000);

// top up again and change rps while stakers are active
await send([await farms.addRewardAmountToFarmIx(signer(admin), farmAddr, address(rewardMints[0].toBase58()), new Decimal(500))], [admin]);
state = (await farms.getAllFarmStatesByPubkeys([farmAddr]))[0].farmState;
const avail = state.rewardInfos[0].rewardsAvailable;
await send([await farms.updateFarmConfigIx(signer(admin), farmAddr, address(rewardMints[0].toBase58()), FarmConfigOption.UpdateRewardRps, (avail * 10n ** BigInt(state.rewardInfos[0].rewardsPerSecondDecimals)) / 100n)], [admin]);
console.log("rewardsAvailable after top-up", avail);

// alice exits early with her whole stake
await send([await farms.unstakeIx(signer(alice), farmAddr, new Decimal(100_000_000), { __option: "None" } as any)], [alice]);
state = (await farms.getAllFarmStatesByPubkeys([farmAddr]))[0].farmState;
console.log("slashedAmountCurrent", state.slashedAmountCurrent);
const pending = await farms.getPendingWithdrawalCooldownStatusForWalletAndFarm(address(alice.publicKey.toBase58()), farmAddr);
console.log("alice pending withdrawal", pending);

// claim for bob across all rewards
await send(await farms.claimForUserForFarmAllRewardsIx(signer(bob), address(bob.publicKey.toBase58()), farmAddr, false), [bob]);
console.log("bob reward0 balance", (await getAccount(conn, (await getOrCreateAssociatedTokenAccount(conn, admin, rewardMints[0], bob.publicKey)).address)).amount);
```

Add the `withdrawSlashedAmount` call at the end using `getWithdrawSlashedAmountInstruction` (exported from `@kamino-finance/farms-sdk`) with accounts `{ crank: signer(admin), farmState: farmAddr, slashedAmountSpillAddress: spillAta, farmVault: state.farmVault, farmVaultsAuthority: state.farmVaultsAuthority }`, then log the spill ATA balance.

- [ ] **Step 4: Run it**

Run: `bun spike/kamino.ts`
Expected: every `console.log` prints; no transaction error.

- [ ] **Step 5: Write findings**

`docs/spikes/kamino.md` answers, with the logged numbers:
1. Default `rewardsPerSecondDecimals` and whether `raw rps = baseUnitsPerSecond * 10^rpsDecimals` produced the expected stream.
2. Whether the second top-up and rate change while stakers were active worked without errors.
3. How early exit behaves: does `unstakeIx` during the lock apply the penalty and put it into `slashedAmountCurrent`; is the remainder withdrawable immediately with cooldown 0; exact penalty for 30% and the elapsed time.
4. Whether `withdrawSlashedAmount` moved the penalty to the spill ATA.
5. Whether one farm with three reward mints of different decimals worked.
6. Anything that contradicts the spec.

If any answer contradicts the spec, stop and report to the user before Task 3.

- [ ] **Step 6: Commit**

```bash
git add spike/kamino.ts docs/spikes/kamino.md package.json bun.lock
git commit -m "Kamino farms spike on local validator"
```

---

### Task 2: DBC custom quote and graduation spike (throwaway)

**Files:**
- Create: `spike/dbc.ts`, `docs/spikes/dbc.md`

**Interfaces:**
- Produces: the DAMM v2 migration config address (`DAMM_V2_MIGRATION_CONFIG` env var, used in Task 9 and Task 15), and whether partner LP positions go to the `feeClaimer` wallet.

- [ ] **Step 1: Start a validator with the DBC, DAMM v2 and Metaplex programs cloned**

```bash
solana-test-validator --reset --url https://api.mainnet-beta.solana.com \
  --clone-upgradeable-program dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN \
  --clone-upgradeable-program cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG \
  --clone-upgradeable-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s
```

Also clone every account in `DAMM_V2_MIGRATION_FEE_ADDRESS` (exported by the DBC SDK) with `--clone <address>`; print them first with `bun -e 'import {DAMM_V2_MIGRATION_FEE_ADDRESS as a} from "@meteora-ag/dynamic-bonding-curve-sdk"; console.log(a.map(String).join(" "))'`.

- [ ] **Step 2: Install**

```bash
bun add @meteora-ag/dynamic-bonding-curve-sdk@1.5.13 @meteora-ag/cp-amm-sdk@1.5.1 bn.js
```

- [ ] **Step 3: Write the spike**

`spike/dbc.ts`:
1. Create a classic SPL "OURTOKEN" mint (6 decimals); mint 10M to a buyer wallet.
2. Build config params with `buildCurve` (the same params Task 9 uses: 1B supply, `percentageSupplyOnMigration: 20`, `migrationQuoteThreshold: 1000` OURTOKEN, `creatorTradingFeePercentage: 0`, `collectFeeMode: CollectFeeMode.QuoteToken`, `migrationOption: MigrationOption.MET_DAMM_V2`, `migrationFeeOption: MigrationFeeOption.Customizable`, `migratedPoolFee: { collectFeeMode: MigratedCollectFeeMode.QuoteToken, dynamicFee: DammV2DynamicFeeMode.Disabled, poolFeeBps: 200 }`, `partnerPermanentLockedLiquidityPercentage: 100`, other LP percentages 0).
3. `client.partner.createConfig({ config, feeClaimer: keeper, leftoverReceiver: keeper, quoteMint: ourtoken, payer: keeper, ...params })`. Log any error (expected: the token badge requirement for a non-permissionless quote; if it fails, note the exact error and retry with SOL quote to keep going).
4. `client.creator.createPoolWithFirstBuy(...)` for a launch mint; buy with OURTOKEN until `quoteReserve >= migrationQuoteThreshold`.
5. `client.state.getPoolFeeMetrics(pool)` then `client.partner.claimPartnerTradingFee({ feeClaimer, payer, pool, maxBaseAmount: new BN(0), maxQuoteAmount: current.partnerQuoteFee, receiver: keeper })`; log balances before and after, and for the SOL-quote case log whether the fee arrived as native SOL or wSOL.
6. Find the DAMM v2 config to pass as `dammConfig` for a Customizable migration (read the `migrateToDammV2` source in `node_modules/@meteora-ag/dynamic-bonding-curve-sdk/dist/index.js` and the Meteora migration docs). Run `client.migration.migrateToDammV2({ payer, pool, dammConfig })`, signing with the two returned position NFT keypairs.
7. `new CpAmm(conn).getUserPositionByPool(deriveDammV2PoolAddress(dammConfig, baseMint, quoteMint), keeper)`; log positions and which wallet owns them.

- [ ] **Step 4: Run it**

Run: `bun spike/dbc.ts`
Expected: config, pool, trades, claim, migration all succeed, or the token-badge error is captured verbatim.

- [ ] **Step 5: Write findings**

`docs/spikes/dbc.md`: token badge error text (if any), the `dammConfig` address, which wallet received partner positions, how the SOL-quote partner fee arrived (native or wSOL), and the exact migration transaction sequence. If partner positions do not go to `feeClaimer`, stop and report before Task 9.

- [ ] **Step 6: Commit**

```bash
git add spike/dbc.ts docs/spikes/dbc.md package.json bun.lock
git commit -m "DBC custom quote and graduation spike"
```

---

### Task 3: Project scaffold and database

**Files:**
- Create: `tsconfig.json`, `bunfig.toml`, `docker-compose.yml`, `.env.example`, `.gitignore`, `src/env.ts`, `src/db/client.ts`, `src/db/migrate.ts`, `db/migrations/001_init.sql`, `tests/helpers/db.ts`, `tests/db/migrate.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `db(url?: string): SQL`, `migrate(sql: SQL): Promise<string[]>`, `freshDb(): Promise<SQL>` (tests), `env` object.

- [ ] **Step 1: Config files**

`package.json` scripts:

```json
{
  "name": "quants",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "bun test",
    "migrate": "bun src/db/migrate.ts",
    "keeper": "bun src/keeper/main.ts",
    "typecheck": "bunx tsc --noEmit"
  }
}
```

```bash
bun add zod @solana/compat@^7
bun add -d typescript @types/bun @types/bn.js
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "strict": true, "noUncheckedIndexedAccess": true, "skipLibCheck": true,
    "types": ["bun"], "esModuleInterop": true, "resolveJsonModule": true
  },
  "include": ["src", "tests", "scripts"]
}
```

`docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16
    environment: { POSTGRES_USER: quants, POSTGRES_PASSWORD: quants, POSTGRES_DB: quants }
    ports: ["5433:5432"]
```

`.env.example`:

```
DATABASE_URL=postgres://quants:quants@localhost:5433/quants
TEST_DATABASE_URL=postgres://quants:quants@localhost:5433/quants_test
RPC_URL=http://127.0.0.1:8899
KEEPER_KEYPAIR=[...]
SPILL_KEYPAIR=[...]
TREASURY_ADDRESS=
OURTOKEN_MINT=
KAMINO_GLOBAL_CONFIG=
DAMM_V2_MIGRATION_CONFIG=
JUPITER_BASE_URL=https://lite-api.jup.ag/swap/v1
```

`.gitignore`: `node_modules`, `.env`, `test-ledger`.

- [ ] **Step 2: Write the failing migration test**

`tests/helpers/db.ts`:

```ts
import { SQL } from "bun";
import { migrate } from "../../src/db/migrate";

export async function freshDb(): Promise<SQL> {
  const sql = new SQL(process.env.TEST_DATABASE_URL!);
  await sql.unsafe("drop schema if exists public cascade; create schema public;");
  await migrate(sql);
  return sql;
}
```

`tests/db/migrate.test.ts`:

```ts
import { test, expect } from "bun:test";
import { freshDb } from "../helpers/db";
import { migrate } from "../../src/db/migrate";

test("migrations create tables and are idempotent", async () => {
  const sql = await freshDb();
  const tables = await sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`;
  expect(tables.map((t: { table_name: string }) => t.table_name)).toEqual(
    ["baskets", "distributions", "escrow", "launches", "schema_migrations", "settings", "stake_pools", "stake_tiers"],
  );
  expect(await migrate(sql)).toEqual([]);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `docker compose up -d && psql postgres://quants:quants@localhost:5433/quants -c 'create database quants_test' ; bun test tests/db`
Expected: FAIL, cannot find module `src/db/migrate`.

- [ ] **Step 4: Implement**

`db/migrations/001_init.sql`:

```sql
create table launches (
  id bigserial primary key,
  mint text not null unique,
  pool text not null unique,
  quote_mint text not null,
  fee_tier_bps int not null,
  config_key text not null,
  creator text not null,
  status text not null check (status in ('live', 'graduated')),
  damm_pool text,
  damm_position text,
  damm_position_nft_account text,
  settings_version int not null,
  created_at timestamptz not null default now()
);

create table baskets (
  launch_id bigint not null references launches(id),
  reward_mint text not null,
  weight_bps int not null check (weight_bps > 0),
  primary key (launch_id, reward_mint)
);

create table stake_pools (
  launch_id bigint primary key references launches(id),
  backend text not null,
  max_penalty_bps int not null,
  spill_account text not null,
  status text not null check (status in ('pending', 'ready'))
);

create table stake_tiers (
  launch_id bigint not null references stake_pools(launch_id),
  tier_id text not null,
  lock_seconds int not null,
  multiplier_bps int not null,
  farm text,
  primary key (launch_id, tier_id)
);

create table settings (
  version serial primary key,
  data jsonb not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

create table distributions (
  id bigserial primary key,
  launch_id bigint not null references launches(id),
  idem_key text not null unique,
  kind text not null,
  status text not null check (status in ('pending', 'sent', 'confirmed', 'failed')),
  signature text,
  last_valid_block_height bigint,
  attempts int not null default 0,
  detail jsonb not null default '{}',
  settings_version int,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index distributions_open on distributions (status) where status in ('pending', 'sent');

create table escrow (
  launch_id bigint not null references launches(id),
  bucket text not null check (bucket in ('unsplit', 'basket', 'reward', 'creator', 'treasury', 'penalty')),
  mint text not null,
  amount numeric(39, 0) not null default 0 check (amount >= 0),
  primary key (launch_id, bucket, mint)
);
```

`src/db/migrate.ts`:

```ts
import { SQL } from "bun";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const DIR = join(import.meta.dir, "../../db/migrations");

export async function migrate(sql: SQL): Promise<string[]> {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql`select name from schema_migrations`).map((r: { name: string }) => r.name));
  const applied: string[] = [];
  for (const name of (await readdir(DIR)).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(name)) continue;
    const body = await Bun.file(join(DIR, name)).text();
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into schema_migrations (name) values (${name})`;
    });
    applied.push(name);
  }
  return applied;
}

if (import.meta.main) {
  const sql = new SQL(process.env.DATABASE_URL!);
  console.log(await migrate(sql));
  await sql.close();
}
```

`src/db/client.ts`:

```ts
import { SQL } from "bun";
export const db = (url = process.env.DATABASE_URL!) => new SQL(url);
```

`src/env.ts`:

```ts
import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().url(),
  RPC_URL: z.string().url(),
  KEEPER_KEYPAIR: z.string(),
  SPILL_KEYPAIR: z.string(),
  TREASURY_ADDRESS: z.string().min(32),
  OURTOKEN_MINT: z.string().min(32),
  KAMINO_GLOBAL_CONFIG: z.string().min(32),
  DAMM_V2_MIGRATION_CONFIG: z.string().min(32),
  JUPITER_BASE_URL: z.string().url().default("https://lite-api.jup.ag/swap/v1"),
});
export type Env = z.infer<typeof Env>;
export const loadEnv = (): Env => Env.parse(process.env);
```

- [ ] **Step 5: Run the test**

Run: `bun test tests/db`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Scaffold project, Postgres schema and migrations"
```

---

### Task 4: Domain math

**Files:**
- Create: `src/domain/types.ts`, `src/domain/weights.ts`, `src/domain/rate.ts`, `src/domain/penalty.ts`
- Test: `tests/domain/weights.test.ts`, `tests/domain/rate.test.ts`, `tests/domain/penalty.test.ts`

**Interfaces:**
- Produces:
  - `type Bucket = "unsplit" | "basket" | "reward" | "creator" | "treasury" | "penalty"`
  - `interface FeeSplit { basketBps: number; platformBps: number; creatorBps: number }`
  - `interface LockTier { id: string; lockSeconds: number; multiplierBps: number }`
  - `splitByWeights<K extends string>(amount: bigint, entries: { key: K; weight: bigint }[]): Map<K, bigint>`
  - `splitFees(amount: bigint, s: FeeSplit): { basket: bigint; platform: bigint; creator: bigint }`
  - `allocateAcrossTiers(amount: bigint, tiers: { tierId: string; staked: bigint; multiplierBps: number }[]): Map<string, bigint>`
  - `kaminoRawRps(totalBaseUnits: bigint, periodSeconds: number, rpsDecimals: number): bigint`
  - `earlyExitPenalty(amount: bigint, maxPenaltyBps: number, lockSeconds: number, secondsRemaining: number): bigint`

- [ ] **Step 1: Write the failing tests**

`tests/domain/weights.test.ts`:

```ts
import { test, expect } from "bun:test";
import { splitFees, splitByWeights, allocateAcrossTiers } from "../../src/domain/weights";

const split = { basketBps: 6000, platformBps: 2500, creatorBps: 1500 };

test("splitFees uses the configured ratio", () => {
  expect(splitFees(1_000_000n, split)).toEqual({ basket: 600_000n, platform: 250_000n, creator: 150_000n });
});

test("splitFees gives rounding dust to the basket and always sums to the input", () => {
  for (const amount of [0n, 1n, 7n, 999_999n, 123_456_789_012n]) {
    const r = splitFees(amount, split);
    expect(r.basket + r.platform + r.creator).toBe(amount);
  }
  expect(splitFees(1n, split)).toEqual({ basket: 1n, platform: 0n, creator: 0n });
});

test("splitFees rejects negative amounts", () => {
  expect(() => splitFees(-1n, split)).toThrow();
});

test("splitByWeights is proportional and exact", () => {
  const r = splitByWeights(100n, [{ key: "a", weight: 5000n }, { key: "b", weight: 3000n }, { key: "c", weight: 2000n }]);
  expect([...r.entries()]).toEqual([["a", 50n], ["b", 30n], ["c", 20n]]);
  const odd = splitByWeights(10n, [{ key: "a", weight: 1n }, { key: "b", weight: 1n }, { key: "c", weight: 1n }]);
  expect([...odd.values()].reduce((x, y) => x + y, 0n)).toBe(10n);
});

test("splitByWeights returns empty when all weights are zero", () => {
  expect(splitByWeights(100n, [{ key: "a", weight: 0n }]).size).toBe(0);
});

test("allocateAcrossTiers weights stake by multiplier", () => {
  const r = allocateAcrossTiers(1_000n, [
    { tierId: "7d", staked: 100n, multiplierBps: 10_000 },
    { tierId: "180d", staked: 100n, multiplierBps: 30_000 },
  ]);
  expect(r.get("7d")).toBe(250n);
  expect(r.get("180d")).toBe(750n);
});

test("allocateAcrossTiers skips empty tiers and holds everything when nobody staked", () => {
  const r = allocateAcrossTiers(1_000n, [
    { tierId: "7d", staked: 0n, multiplierBps: 10_000 },
    { tierId: "30d", staked: 50n, multiplierBps: 15_000 },
  ]);
  expect([...r.entries()]).toEqual([["30d", 1_000n]]);
  expect(allocateAcrossTiers(1_000n, [{ tierId: "7d", staked: 0n, multiplierBps: 10_000 }]).size).toBe(0);
});
```

`tests/domain/rate.test.ts`:

```ts
import { test, expect } from "bun:test";
import { kaminoRawRps } from "../../src/domain/rate";

test("raw rps scales base units per second by rps decimals", () => {
  expect(kaminoRawRps(86_400_000_000n, 86_400, 0)).toBe(1_000_000n);
  expect(kaminoRawRps(1n, 86_400, 9)).toBe(11_574n);
});

test("raw rps rejects a non-positive period", () => {
  expect(() => kaminoRawRps(1n, 0, 0)).toThrow();
});
```

`tests/domain/penalty.test.ts`:

```ts
import { test, expect } from "bun:test";
import { earlyExitPenalty } from "../../src/domain/penalty";

const DAY = 86_400;

test("penalty decays linearly with remaining lock time", () => {
  expect(earlyExitPenalty(1_000_000n, 3000, 90 * DAY, 45 * DAY)).toBe(150_000n);
  expect(earlyExitPenalty(1_000_000n, 3000, 90 * DAY, 90 * DAY)).toBe(300_000n);
});

test("no penalty after the lock ends, remaining time is capped at the lock", () => {
  expect(earlyExitPenalty(1_000_000n, 3000, 90 * DAY, 0)).toBe(0n);
  expect(earlyExitPenalty(1_000_000n, 3000, 90 * DAY, -5)).toBe(0n);
  expect(earlyExitPenalty(1_000_000n, 3000, 90 * DAY, 200 * DAY)).toBe(300_000n);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/domain`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/domain/types.ts`:

```ts
export type Bucket = "unsplit" | "basket" | "reward" | "creator" | "treasury" | "penalty";
export interface FeeSplit { basketBps: number; platformBps: number; creatorBps: number }
export interface LockTier { id: string; lockSeconds: number; multiplierBps: number }
export const BPS = 10_000n;
export const NATIVE_MINT = "So11111111111111111111111111111111111111112";
```

`src/domain/weights.ts`:

```ts
import { BPS, type FeeSplit } from "./types";

export function splitByWeights<K extends string>(amount: bigint, entries: { key: K; weight: bigint }[]): Map<K, bigint> {
  const out = new Map<K, bigint>();
  const total = entries.reduce((a, e) => a + e.weight, 0n);
  if (total === 0n || amount === 0n) return out;
  let given = 0n;
  let last: K | undefined;
  for (const e of entries) {
    if (e.weight === 0n) continue;
    const share = (amount * e.weight) / total;
    out.set(e.key, share);
    given += share;
    last = e.key;
  }
  out.set(last!, out.get(last!)! + amount - given);
  return out;
}

export function splitFees(amount: bigint, s: FeeSplit) {
  if (amount < 0n) throw new Error("negative amount");
  const platform = (amount * BigInt(s.platformBps)) / BPS;
  const creator = (amount * BigInt(s.creatorBps)) / BPS;
  return { basket: amount - platform - creator, platform, creator };
}

export function allocateAcrossTiers(amount: bigint, tiers: { tierId: string; staked: bigint; multiplierBps: number }[]) {
  return splitByWeights(amount, tiers.map((t) => ({ key: t.tierId, weight: t.staked * BigInt(t.multiplierBps) })));
}
```

`src/domain/rate.ts`:

```ts
export function kaminoRawRps(totalBaseUnits: bigint, periodSeconds: number, rpsDecimals: number): bigint {
  if (periodSeconds <= 0) throw new Error("period must be positive");
  return (totalBaseUnits * 10n ** BigInt(rpsDecimals)) / BigInt(periodSeconds);
}
```

`src/domain/penalty.ts`:

```ts
import { BPS } from "./types";

// UI preview only; Kamino computes the charged amount on-chain.
export function earlyExitPenalty(amount: bigint, maxPenaltyBps: number, lockSeconds: number, secondsRemaining: number): bigint {
  if (secondsRemaining <= 0) return 0n;
  const remaining = BigInt(Math.min(secondsRemaining, lockSeconds));
  return (amount * BigInt(maxPenaltyBps) * remaining) / (BPS * BigInt(lockSeconds));
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/domain`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain tests/domain && git commit -m "Add fee split, tier allocation, rate and penalty math"
```

---

### Task 5: Settings

**Files:**
- Create: `src/domain/settings.ts`
- Test: `tests/domain/settings.test.ts`

**Interfaces:**
- Consumes: `FeeSplit`, `LockTier` (Task 4).
- Produces:
  - `interface Settings { split: FeeSplit; creatorPayoutMin: Record<string, bigint>; tiers: LockTier[]; maxPenaltyBps: number; rewardPeriodSeconds: number; slippageBps: number; launchFeeLamports: bigint; devBuyCapBps: number; keeperIntervalSeconds: number; defaultBackend: "kamino" }`
  - `interface VersionedSettings extends Settings { version: number }`
  - `defaultSettings(ourtokenMint: string): Settings`
  - `parseSettings(input: unknown): Settings` (throws `ZodError`)
  - `saveSettings(sql: SQL, s: Settings, by: string): Promise<number>` (returns version)
  - `loadLatestSettings(sql: SQL): Promise<VersionedSettings>` (throws if none)

- [ ] **Step 1: Write failing tests**

```ts
import { test, expect } from "bun:test";
import { freshDb } from "../helpers/db";
import { defaultSettings, parseSettings, saveSettings, loadLatestSettings } from "../../src/domain/settings";
import { NATIVE_MINT } from "../../src/domain/types";

const OURS = "OURS1111111111111111111111111111111111111111";

test("defaults match the spec", () => {
  const s = defaultSettings(OURS);
  expect(s.split).toEqual({ basketBps: 6000, platformBps: 2500, creatorBps: 1500 });
  expect(s.tiers.map((t) => [t.id, t.lockSeconds, t.multiplierBps])).toEqual([
    ["7d", 604_800, 10_000], ["30d", 2_592_000, 15_000], ["90d", 7_776_000, 20_000], ["180d", 15_552_000, 30_000],
  ]);
  expect(s.maxPenaltyBps).toBe(3000);
  expect(s.rewardPeriodSeconds).toBe(86_400);
  expect(s.slippageBps).toBe(100);
  expect(s.launchFeeLamports).toBe(300_000_000n);
  expect(s.creatorPayoutMin[NATIVE_MINT]).toBe(50_000_000n);
  expect(s.devBuyCapBps).toBe(5000);
  expect(s.keeperIntervalSeconds).toBe(600);
});

test("split must sum to 100%", () => {
  const s = defaultSettings(OURS);
  expect(() => parseSettings({ ...s, split: { basketBps: 6000, platformBps: 2500, creatorBps: 1000 } })).toThrow();
});

test("tiers need unique ids, positive locks, multiplier at least 1x", () => {
  const s = defaultSettings(OURS);
  expect(() => parseSettings({ ...s, tiers: [s.tiers[0], s.tiers[0]] })).toThrow();
  expect(() => parseSettings({ ...s, tiers: [{ id: "x", lockSeconds: 0, multiplierBps: 10_000 }] })).toThrow();
  expect(() => parseSettings({ ...s, tiers: [{ id: "x", lockSeconds: 60, multiplierBps: 9_000 }] })).toThrow();
  expect(() => parseSettings({ ...s, tiers: [] })).toThrow();
});

test("penalty must be strictly between 0 and 100%", () => {
  const s = defaultSettings(OURS);
  expect(() => parseSettings({ ...s, maxPenaltyBps: 0 })).toThrow();
  expect(() => parseSettings({ ...s, maxPenaltyBps: 10_000 })).toThrow();
});

test("save creates a new version and load returns the latest with bigints intact", async () => {
  const sql = await freshDb();
  const s = defaultSettings(OURS);
  const v1 = await saveSettings(sql, s, "admin1");
  const v2 = await saveSettings(sql, { ...s, split: { basketBps: 7000, platformBps: 2000, creatorBps: 1000 } }, "admin1");
  expect(v2).toBe(v1 + 1);
  const latest = await loadLatestSettings(sql);
  expect(latest.version).toBe(v2);
  expect(latest.split.basketBps).toBe(7000);
  expect(latest.launchFeeLamports).toBe(300_000_000n);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/domain/settings.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import type { SQL } from "bun";
import { z } from "zod";
import { NATIVE_MINT, type FeeSplit, type LockTier } from "./types";

const big = z.union([z.bigint(), z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((v) => BigInt(v));
const bps = z.number().int().min(0).max(10_000);
const DAY = 86_400;

const Schema = z.object({
  split: z.object({ basketBps: bps, platformBps: bps, creatorBps: bps })
    .refine((s) => s.basketBps + s.platformBps + s.creatorBps === 10_000, "split must sum to 10000 bps"),
  creatorPayoutMin: z.record(z.string(), big),
  tiers: z.array(z.object({ id: z.string().min(1).max(16), lockSeconds: z.number().int().positive(), multiplierBps: z.number().int().min(10_000).max(100_000) }))
    .min(1).max(6)
    .refine((t) => new Set(t.map((x) => x.id)).size === t.length, "tier ids must be unique"),
  maxPenaltyBps: z.number().int().min(1).max(9_999),
  rewardPeriodSeconds: z.number().int().min(3_600),
  slippageBps: z.number().int().min(1).max(1_000),
  launchFeeLamports: big,
  devBuyCapBps: z.number().int().min(0).max(7_500),
  keeperIntervalSeconds: z.number().int().min(60),
  defaultBackend: z.literal("kamino"),
});

export type Settings = {
  split: FeeSplit; creatorPayoutMin: Record<string, bigint>; tiers: LockTier[]; maxPenaltyBps: number;
  rewardPeriodSeconds: number; slippageBps: number; launchFeeLamports: bigint; devBuyCapBps: number;
  keeperIntervalSeconds: number; defaultBackend: "kamino";
};
export type VersionedSettings = Settings & { version: number };

export const parseSettings = (input: unknown): Settings => Schema.parse(input);

export function defaultSettings(ourtokenMint: string): Settings {
  return parseSettings({
    split: { basketBps: 6000, platformBps: 2500, creatorBps: 1500 },
    creatorPayoutMin: { [NATIVE_MINT]: 50_000_000n, [ourtokenMint]: 0n },
    tiers: [
      { id: "7d", lockSeconds: 7 * DAY, multiplierBps: 10_000 },
      { id: "30d", lockSeconds: 30 * DAY, multiplierBps: 15_000 },
      { id: "90d", lockSeconds: 90 * DAY, multiplierBps: 20_000 },
      { id: "180d", lockSeconds: 180 * DAY, multiplierBps: 30_000 },
    ],
    maxPenaltyBps: 3000,
    rewardPeriodSeconds: DAY,
    slippageBps: 100,
    launchFeeLamports: 300_000_000n,
    devBuyCapBps: 5000,
    keeperIntervalSeconds: 600,
    defaultBackend: "kamino",
  });
}

const toJson = (s: Settings) => JSON.stringify(s, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

export async function saveSettings(sql: SQL, s: Settings, by: string): Promise<number> {
  const valid = parseSettings(s);
  const [row] = await sql`insert into settings (data, created_by) values (${toJson(valid)}::jsonb, ${by}) returning version`;
  return row.version;
}

export async function loadLatestSettings(sql: SQL): Promise<VersionedSettings> {
  const [row] = await sql`select version, data from settings order by version desc limit 1`;
  if (!row) throw new Error("no settings saved");
  return { ...parseSettings(row.data), version: row.version };
}
```

The OURTOKEN creator payout minimum defaults to `0n` because there is no price source for it in v1; the admin sets it in base units.

- [ ] **Step 4: Run tests**

Run: `bun test tests/domain`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/settings.ts tests/domain/settings.test.ts && git commit -m "Add versioned settings with validation"
```

---

### Task 6: Step ledger

The core of crash safety. Every on-chain action is a `distributions` row. The signature is stored before the transaction is sent. Balance changes (`escrow`) are applied in the same SQL statement that marks the step confirmed.

**Files:**
- Create: `src/chain/port.ts`, `src/ledger/ledger.ts`, `src/ledger/run-step.ts`
- Test: `tests/ledger/ledger.test.ts`, `tests/ledger/run-step.test.ts`, `tests/helpers/fake-chain.ts`, `tests/helpers/fixtures.ts`

**Interfaces:**
- Consumes: `Bucket` (Task 4), `freshDb` (Task 3).
- Produces:
  - `interface SignedTx { signature: string; lastValidBlockHeight: bigint; send(): Promise<void> }`
  - `type SigState = "confirmed" | "failed" | "unknown"`
  - `interface ChainPort { status(sig: string): Promise<SigState>; blockHeight(): Promise<bigint>; waitForConfirmation(sig: string, lastValidBlockHeight: bigint): Promise<SigState>; received(sig: string, owner: string, mint: string): Promise<bigint>; buildTransfer(mint: string, to: string, amount: bigint): Promise<SignedTx>; buildBurn(mint: string, amount: bigint): Promise<SignedTx>; balance(owner: string, mint: string): Promise<bigint> }`
  - `type StepKind = "claim" | "split" | "payout" | "swap" | "fund" | "collect_penalty" | "burn" | "migrate" | "create_farm" | "configure_farm"`
  - `interface Delta { bucket: Bucket; mint: string; amount: bigint }` (negative amount = debit)
  - `interface StepRow { id: number; launchId: number; idemKey: string; kind: StepKind; status: "pending" | "sent" | "confirmed" | "failed"; signature: string | null; lastValidBlockHeight: bigint | null; attempts: number; detail: Record<string, any>; settingsVersion: number | null }`
  - `type DeltaResolver = (row: StepRow, signature: string) => Promise<Delta[]>`
  - `beginStep`, `markSent`, `resetToPending`, `failStep`, `confirmStep(sql, row, deltas, detail?): Promise<boolean>`, `getBalance(sql, launchId, bucket, mint): Promise<bigint>`, `openSentSteps(sql): Promise<StepRow[]>`, `abandonUnsent(sql): Promise<number>`, `ledgerTotals(sql): Promise<Map<string, bigint>>` (key `${bucketGroup}:${mint}` where bucketGroup is `keeper` for all buckets except `penalty`, which is `spill`)
  - `runTxStep(sql, chain, spec: { launchId: number; idemKey: string; kind: StepKind; settingsVersion: number | null; detail: Record<string, any>; build: (row: StepRow) => Promise<SignedTx>; resolve: DeltaResolver }): Promise<"confirmed" | "failed" | "pending">`
  - `runDbStep(sql, spec: { launchId; idemKey; kind; settingsVersion; detail; deltas: Delta[] }): Promise<boolean>`
  - `resolveSent(sql, chain, row, resolve): Promise<"confirmed" | "failed" | "pending" | "expired">`
  - `MAX_ATTEMPTS = 5`

- [ ] **Step 1: Test helpers**

`tests/helpers/fixtures.ts`:

```ts
import type { SQL } from "bun";

export async function insertLaunch(sql: SQL, over: Partial<{ mint: string; pool: string; quote_mint: string; status: string }> = {}) {
  const n = crypto.randomUUID().slice(0, 8);
  const [r] = await sql`insert into launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, status, settings_version)
    values (${over.mint ?? `mint-${n}`}, ${over.pool ?? `pool-${n}`}, ${over.quote_mint ?? "So11111111111111111111111111111111111111112"},
            200, 'cfg', 'creator-wallet', ${over.status ?? "live"}, 1) returning id`;
  return Number(r.id);
}
```

`tests/helpers/fake-chain.ts`:

```ts
import type { ChainPort, SigState, SignedTx } from "../../src/chain/port";

export class FakeChain implements ChainPort {
  height = 100n;
  states = new Map<string, SigState>();
  receipts = new Map<string, bigint>();
  balances = new Map<string, bigint>();
  sent: string[] = [];
  nextOutcome: SigState = "confirmed";
  sendThrows = false;
  private n = 0;

  tx(label = "tx"): SignedTx {
    const signature = `${label}-${++this.n}`;
    return {
      signature,
      lastValidBlockHeight: this.height + 150n,
      send: async () => {
        if (this.sendThrows) throw new Error("rpc down");
        this.sent.push(signature);
        this.states.set(signature, this.nextOutcome);
      },
    };
  }
  async status(sig: string) { return this.states.get(sig) ?? "unknown"; }
  async blockHeight() { return this.height; }
  async waitForConfirmation(sig: string) { return this.status(sig); }
  async received(sig: string) { return this.receipts.get(sig) ?? 0n; }
  async buildTransfer() { return this.tx("transfer"); }
  async buildBurn() { return this.tx("burn"); }
  async balance(owner: string, mint: string) { return this.balances.get(`${owner}:${mint}`) ?? 0n; }
}
```

- [ ] **Step 2: Write failing ledger tests**

`tests/ledger/ledger.test.ts`:

```ts
import { test, expect } from "bun:test";
import { freshDb } from "../helpers/db";
import { insertLaunch } from "../helpers/fixtures";
import { beginStep, confirmStep, getBalance, abandonUnsent, markSent, ledgerTotals } from "../../src/ledger/ledger";

const M = "mintA";

test("confirmStep applies deltas once", async () => {
  const sql = await freshDb();
  const launchId = await insertLaunch(sql);
  const row = await beginStep(sql, { launchId, idemKey: "k1", kind: "claim", settingsVersion: 1, detail: {} });
  expect(await confirmStep(sql, row, [{ bucket: "unsplit", mint: M, amount: 500n }])).toBe(true);
  expect(await confirmStep(sql, row, [{ bucket: "unsplit", mint: M, amount: 500n }])).toBe(false);
  expect(await getBalance(sql, launchId, "unsplit", M)).toBe(500n);
});

test("beginStep with the same idem key returns the existing row", async () => {
  const sql = await freshDb();
  const launchId = await insertLaunch(sql);
  const a = await beginStep(sql, { launchId, idemKey: "same", kind: "claim", settingsVersion: 1, detail: { x: 1 } });
  const b = await beginStep(sql, { launchId, idemKey: "same", kind: "claim", settingsVersion: 1, detail: { x: 2 } });
  expect(b.id).toBe(a.id);
  expect(b.detail).toEqual({ x: 1 });
});

test("a delta that would make a balance negative rejects the whole step", async () => {
  const sql = await freshDb();
  const launchId = await insertLaunch(sql);
  const row = await beginStep(sql, { launchId, idemKey: "k2", kind: "split", settingsVersion: 1, detail: {} });
  await expect(confirmStep(sql, row, [{ bucket: "unsplit", mint: M, amount: -1n }, { bucket: "basket", mint: M, amount: 1n }])).rejects.toThrow();
  expect(await getBalance(sql, launchId, "basket", M)).toBe(0n);
  const [r] = await sql`select status from distributions where id = ${row.id}`;
  expect(r.status).toBe("pending");
});

test("abandonUnsent fails pending rows with no signature and leaves sent rows", async () => {
  const sql = await freshDb();
  const launchId = await insertLaunch(sql);
  await beginStep(sql, { launchId, idemKey: "p", kind: "claim", settingsVersion: 1, detail: {} });
  const s = await beginStep(sql, { launchId, idemKey: "s", kind: "claim", settingsVersion: 1, detail: {} });
  await markSent(sql, s.id, "sig", 10n);
  expect(await abandonUnsent(sql)).toBe(1);
  const rows = await sql`select idem_key, status from distributions order by idem_key`;
  expect(rows.map((r: any) => [r.idem_key, r.status])).toEqual([["p", "failed"], ["s", "sent"]]);
});

test("ledgerTotals groups penalty under spill and the rest under keeper", async () => {
  const sql = await freshDb();
  const launchId = await insertLaunch(sql);
  const row = await beginStep(sql, { launchId, idemKey: "t", kind: "claim", settingsVersion: 1, detail: {} });
  await confirmStep(sql, row, [
    { bucket: "basket", mint: M, amount: 10n }, { bucket: "creator", mint: M, amount: 5n }, { bucket: "penalty", mint: M, amount: 3n },
  ]);
  const t = await ledgerTotals(sql);
  expect(t.get(`keeper:${M}`)).toBe(15n);
  expect(t.get(`spill:${M}`)).toBe(3n);
});
```

`tests/ledger/run-step.test.ts`:

```ts
import { test, expect } from "bun:test";
import { freshDb } from "../helpers/db";
import { insertLaunch } from "../helpers/fixtures";
import { FakeChain } from "../helpers/fake-chain";
import { runTxStep, resolveSent, MAX_ATTEMPTS } from "../../src/ledger/run-step";
import { getBalance, openSentSteps } from "../../src/ledger/ledger";

const resolve = async () => [{ bucket: "unsplit" as const, mint: "m", amount: 100n }];

test("sends once and credits on confirmation", async () => {
  const sql = await freshDb();
  const chain = new FakeChain();
  const launchId = await insertLaunch(sql);
  const spec = { launchId, idemKey: "claim:1", kind: "claim" as const, settingsVersion: 1, detail: {}, build: async () => chain.tx(), resolve };
  expect(await runTxStep(sql, chain, spec)).toBe("confirmed");
  expect(await runTxStep(sql, chain, spec)).toBe("confirmed");
  expect(chain.sent.length).toBe(1);
  expect(await getBalance(sql, launchId, "unsplit", "m")).toBe(100n);
});

test("crash after send: resolving the stored signature credits without resending", async () => {
  const sql = await freshDb();
  const chain = new FakeChain();
  const launchId = await insertLaunch(sql);
  chain.nextOutcome = "unknown";
  const spec = { launchId, idemKey: "claim:2", kind: "claim" as const, settingsVersion: 1, detail: {}, build: async () => chain.tx(), resolve };
  expect(await runTxStep(sql, chain, spec)).toBe("pending");
  const [row] = await openSentSteps(sql);
  chain.states.set(row!.signature!, "confirmed");
  expect(await resolveSent(sql, chain, row!, resolve)).toBe("confirmed");
  expect(chain.sent.length).toBe(1);
  expect(await getBalance(sql, launchId, "unsplit", "m")).toBe(100n);
});

test("unknown status is not retried until the blockhash has expired", async () => {
  const sql = await freshDb();
  const chain = new FakeChain();
  const launchId = await insertLaunch(sql);
  chain.nextOutcome = "unknown";
  const spec = { launchId, idemKey: "claim:3", kind: "claim" as const, settingsVersion: 1, detail: {}, build: async () => chain.tx(), resolve };
  await runTxStep(sql, chain, spec);
  expect(await runTxStep(sql, chain, spec)).toBe("pending");
  expect(chain.sent.length).toBe(1);
  chain.height += 1_000n;
  chain.nextOutcome = "confirmed";
  expect(await runTxStep(sql, chain, spec)).toBe("confirmed");
  expect(chain.sent.length).toBe(2);
  expect(await getBalance(sql, launchId, "unsplit", "m")).toBe(100n);
});

test("a send that throws is resolved by status, not assumed failed", async () => {
  const sql = await freshDb();
  const chain = new FakeChain();
  const launchId = await insertLaunch(sql);
  chain.sendThrows = true;
  const spec = { launchId, idemKey: "claim:4", kind: "claim" as const, settingsVersion: 1, detail: {}, build: async () => chain.tx(), resolve };
  expect(await runTxStep(sql, chain, spec)).toBe("pending");
  const [row] = await openSentSteps(sql);
  expect(row!.status).toBe("sent");
});

test("stops after MAX_ATTEMPTS expiries", async () => {
  const sql = await freshDb();
  const chain = new FakeChain();
  const launchId = await insertLaunch(sql);
  chain.nextOutcome = "unknown";
  const spec = { launchId, idemKey: "claim:5", kind: "claim" as const, settingsVersion: 1, detail: {}, build: async () => chain.tx(), resolve };
  let last = "";
  for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
    last = await runTxStep(sql, chain, spec);
    chain.height += 1_000n;
  }
  expect(last).toBe("failed");
  expect(chain.sent.length).toBe(MAX_ATTEMPTS);
});

test("on-chain failure marks the step failed and credits nothing", async () => {
  const sql = await freshDb();
  const chain = new FakeChain();
  const launchId = await insertLaunch(sql);
  chain.nextOutcome = "failed";
  const spec = { launchId, idemKey: "claim:6", kind: "claim" as const, settingsVersion: 1, detail: {}, build: async () => chain.tx(), resolve };
  expect(await runTxStep(sql, chain, spec)).toBe("failed");
  expect(await getBalance(sql, launchId, "unsplit", "m")).toBe(0n);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `bun test tests/ledger`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement**

`src/chain/port.ts`:

```ts
export interface SignedTx { signature: string; lastValidBlockHeight: bigint; send(): Promise<void> }
export type SigState = "confirmed" | "failed" | "unknown";
export interface ChainPort {
  status(sig: string): Promise<SigState>;
  blockHeight(): Promise<bigint>;
  waitForConfirmation(sig: string, lastValidBlockHeight: bigint): Promise<SigState>;
  received(sig: string, owner: string, mint: string): Promise<bigint>;
  buildTransfer(mint: string, to: string, amount: bigint): Promise<SignedTx>;
  buildBurn(mint: string, amount: bigint): Promise<SignedTx>;
  balance(owner: string, mint: string): Promise<bigint>;
}
```

`src/ledger/ledger.ts`:

```ts
import type { SQL } from "bun";
import type { Bucket } from "../domain/types";

export type StepKind = "claim" | "split" | "payout" | "swap" | "fund" | "collect_penalty" | "burn" | "migrate" | "create_farm" | "configure_farm";
export type StepStatus = "pending" | "sent" | "confirmed" | "failed";
export interface Delta { bucket: Bucket; mint: string; amount: bigint }
export interface StepRow {
  id: number; launchId: number; idemKey: string; kind: StepKind; status: StepStatus;
  signature: string | null; lastValidBlockHeight: bigint | null; attempts: number;
  detail: Record<string, any>; settingsVersion: number | null;
}
export type DeltaResolver = (row: StepRow, signature: string) => Promise<Delta[]>;
export interface StepInput { launchId: number; idemKey: string; kind: StepKind; settingsVersion: number | null; detail: Record<string, any> }

const toRow = (r: any): StepRow => ({
  id: Number(r.id), launchId: Number(r.launch_id), idemKey: r.idem_key, kind: r.kind, status: r.status,
  signature: r.signature, lastValidBlockHeight: r.last_valid_block_height == null ? null : BigInt(r.last_valid_block_height),
  attempts: r.attempts, detail: r.detail, settingsVersion: r.settings_version,
});

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

export async function beginStep(sql: SQL, a: StepInput): Promise<StepRow> {
  const [r] = await sql`
    insert into distributions (launch_id, idem_key, kind, status, settings_version, detail)
    values (${a.launchId}, ${a.idemKey}, ${a.kind}, 'pending', ${a.settingsVersion}, ${json(a.detail)}::jsonb)
    on conflict (idem_key) do update set updated_at = now()
    returning *`;
  return toRow(r);
}

export async function markSent(sql: SQL, id: number, signature: string, lastValidBlockHeight: bigint) {
  await sql`update distributions set status = 'sent', signature = ${signature}, last_valid_block_height = ${lastValidBlockHeight.toString()},
    attempts = attempts + 1, updated_at = now() where id = ${id} and status = 'pending'`;
}

export async function resetToPending(sql: SQL, id: number) {
  await sql`update distributions set status = 'pending', signature = null, last_valid_block_height = null, updated_at = now()
    where id = ${id} and status = 'sent'`;
}

export async function failStep(sql: SQL, id: number, error: string) {
  await sql`update distributions set status = 'failed', error = ${error}, updated_at = now() where id = ${id} and status in ('pending', 'sent')`;
}

export async function confirmStep(sql: SQL, row: StepRow, deltas: Delta[], detail: Record<string, any> = {}): Promise<boolean> {
  const payload = json(deltas.map((d) => ({ bucket: d.bucket, mint: d.mint, amount: d.amount.toString() })));
  const [r] = await sql`
    with s as (
      update distributions set status = 'confirmed', detail = detail || ${json(detail)}::jsonb, updated_at = now()
      where id = ${row.id} and status in ('pending', 'sent') returning launch_id
    ), d as (
      select x.bucket, x.mint, sum(x.amount::numeric) as amount
      from jsonb_to_recordset(${payload}::jsonb) as x(bucket text, mint text, amount text)
      group by x.bucket, x.mint
    ), ins as (
      insert into escrow (launch_id, bucket, mint, amount)
      select s.launch_id, d.bucket, d.mint, d.amount from s cross join d
      on conflict (launch_id, bucket, mint) do update set amount = escrow.amount + excluded.amount
      returning 1
    )
    select (select count(*) from s)::int as updated`;
  return r.updated === 1;
}

export async function getBalance(sql: SQL, launchId: number, bucket: string, mint: string): Promise<bigint> {
  const [r] = await sql`select amount from escrow where launch_id = ${launchId} and bucket = ${bucket} and mint = ${mint}`;
  return r ? BigInt(r.amount) : 0n;
}

export async function openSentSteps(sql: SQL): Promise<StepRow[]> {
  return (await sql`select * from distributions where status = 'sent' order by id`).map(toRow);
}

export async function abandonUnsent(sql: SQL): Promise<number> {
  const rows = await sql`update distributions set status = 'failed', error = 'abandoned before send', updated_at = now()
    where status = 'pending' and signature is null returning id`;
  return rows.length;
}

export async function ledgerTotals(sql: SQL): Promise<Map<string, bigint>> {
  const rows = await sql`select case when bucket = 'penalty' then 'spill' else 'keeper' end as grp, mint, sum(amount) as total
    from escrow group by 1, 2`;
  return new Map(rows.map((r: any) => [`${r.grp}:${r.mint}`, BigInt(r.total)]));
}
```

A new escrow row inserted with a negative amount violates `amount >= 0`, and so does an update that takes an existing row below zero. Either one aborts the whole statement, including the status update.

`src/ledger/run-step.ts`:

```ts
import type { SQL } from "bun";
import type { ChainPort, SignedTx } from "../chain/port";
import { beginStep, confirmStep, failStep, markSent, resetToPending, type Delta, type DeltaResolver, type StepInput, type StepRow } from "./ledger";

export const MAX_ATTEMPTS = 5;
export type Outcome = "confirmed" | "failed" | "pending";

export async function resolveSent(sql: SQL, chain: ChainPort, row: StepRow, resolve: DeltaResolver): Promise<Outcome | "expired"> {
  const sig = row.signature!;
  const st = await chain.status(sig);
  if (st === "confirmed") {
    await confirmStep(sql, row, await resolve(row, sig), { signature: sig });
    return "confirmed";
  }
  if (st === "failed") {
    await failStep(sql, row.id, "transaction failed on-chain");
    return "failed";
  }
  if ((await chain.blockHeight()) <= row.lastValidBlockHeight!) return "pending";
  if (row.attempts >= MAX_ATTEMPTS) {
    await failStep(sql, row.id, `not confirmed after ${row.attempts} attempts`);
    return "failed";
  }
  await resetToPending(sql, row.id);
  return "expired";
}

export async function runTxStep(
  sql: SQL, chain: ChainPort,
  spec: StepInput & { build: (row: StepRow) => Promise<SignedTx>; resolve: DeltaResolver },
): Promise<Outcome> {
  let row = await beginStep(sql, spec);
  if (row.status === "confirmed" || row.status === "failed") return row.status;
  if (row.status === "sent") {
    const r = await resolveSent(sql, chain, row, spec.resolve);
    if (r !== "expired") return r;
    row = { ...row, status: "pending", signature: null, lastValidBlockHeight: null };
  }
  const tx = await spec.build(row);
  await markSent(sql, row.id, tx.signature, tx.lastValidBlockHeight);
  row = { ...row, status: "sent", signature: tx.signature, lastValidBlockHeight: tx.lastValidBlockHeight, attempts: row.attempts + 1 };
  try {
    await tx.send();
  } catch {
    return "pending";
  }
  const state = await chain.waitForConfirmation(tx.signature, tx.lastValidBlockHeight);
  if (state === "confirmed") {
    await confirmStep(sql, row, await spec.resolve(row, tx.signature), { signature: tx.signature });
    return "confirmed";
  }
  if (state === "failed") {
    await failStep(sql, row.id, "transaction failed on-chain");
    return "failed";
  }
  return "pending";
}

export async function runDbStep(sql: SQL, spec: StepInput & { deltas: Delta[] }): Promise<boolean> {
  const row = await beginStep(sql, spec);
  if (row.status !== "pending") return false;
  return confirmStep(sql, row, spec.deltas);
}
```

- [ ] **Step 5: Run tests**

Run: `bun test tests/ledger`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/chain/port.ts src/ledger tests/ledger tests/helpers && git commit -m "Add crash-safe step ledger"
```

---

### Task 7: Solana chain implementation

**Files:**
- Create: `src/chain/solana.ts`
- Test: `tests/chain/solana.test.ts` (runs against `solana-test-validator`; skipped when `RPC_URL` is unreachable)

**Interfaces:**
- Consumes: `ChainPort`, `SignedTx` (Task 6).
- Produces:
  - `class SolanaChain implements ChainPort` with `constructor(conn: Connection, keeper: Keypair, spill: Keypair)`
  - `signLegacy(tx: Transaction, signers: Keypair[]): Promise<SignedTx>` (method; sets fee payer = keeper, fetches blockhash)
  - `signVersioned(tx: VersionedTransaction, signers: Keypair[], lastValidBlockHeight: bigint): Promise<SignedTx>`
  - `fromKitInstruction(ix: Instruction): TransactionInstruction` (exported function)
  - `kitSigner(kp: Keypair): TransactionSigner` (exported function, no-op signer used only for instruction building)
  - `loadKeypair(json: string): Keypair`

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect, beforeAll } from "bun:test";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { SolanaChain } from "../../src/chain/solana";
import { NATIVE_MINT } from "../../src/domain/types";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const conn = new Connection(RPC, "confirmed");
let up = true;
beforeAll(async () => { try { await conn.getVersion(); } catch { up = false; } });

test.skipIf(!up)("transfer, received and burn round trip", async () => {
  const keeper = Keypair.generate(), spill = Keypair.generate(), dest = Keypair.generate();
  for (const k of [keeper, spill]) await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 5 * LAMPORTS_PER_SOL));
  const chain = new SolanaChain(conn, keeper, spill);

  const mint = await createMint(conn, keeper, keeper.publicKey, null, 6);
  const ata = await getOrCreateAssociatedTokenAccount(conn, keeper, mint, keeper.publicKey);
  await mintTo(conn, keeper, mint, ata.address, keeper, 1_000n);

  const t = await chain.buildTransfer(mint.toBase58(), dest.publicKey.toBase58(), 400n);
  await t.send();
  expect(await chain.waitForConfirmation(t.signature, t.lastValidBlockHeight)).toBe("confirmed");
  expect(await chain.received(t.signature, dest.publicKey.toBase58(), mint.toBase58())).toBe(400n);
  expect(await chain.balance(keeper.publicKey.toBase58(), mint.toBase58())).toBe(600n);

  const s = await chain.buildTransfer(NATIVE_MINT, dest.publicKey.toBase58(), 1_000_000n);
  await s.send();
  await chain.waitForConfirmation(s.signature, s.lastValidBlockHeight);
  expect(await chain.received(s.signature, dest.publicKey.toBase58(), NATIVE_MINT)).toBe(1_000_000n);

  const spillAta = await getOrCreateAssociatedTokenAccount(conn, keeper, mint, spill.publicKey);
  await mintTo(conn, keeper, mint, spillAta.address, keeper, 50n);
  const b = await chain.buildBurn(mint.toBase58(), 50n);
  await b.send();
  expect(await chain.waitForConfirmation(b.signature, b.lastValidBlockHeight)).toBe("confirmed");
  expect(await chain.balance(spill.publicKey.toBase58(), mint.toBase58())).toBe(0n);
  expect(await chain.status("1111111111111111111111111111111111111111111111111111111111111111")).toBe("unknown");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/chain` (with `solana-test-validator --reset` running)
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, VersionedTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction, createBurnInstruction, createTransferInstruction, getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { createNoopSigner, address, type Instruction, type TransactionSigner } from "@solana/kit";
import bs58 from "bs58";
import type { ChainPort, SignedTx, SigState } from "./port";
import { NATIVE_MINT } from "../domain/types";

export const loadKeypair = (json: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(json)));
export const kitSigner = (kp: Keypair): TransactionSigner => createNoopSigner(address(kp.publicKey.toBase58()));

export function fromKitInstruction(ix: Instruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programAddress),
    keys: (ix.accounts ?? []).map((a) => ({ pubkey: new PublicKey(a.address), isSigner: a.role >= 2, isWritable: a.role === 1 || a.role === 3 })),
    data: Buffer.from(ix.data ?? []),
  });
}

export class SolanaChain implements ChainPort {
  constructor(readonly conn: Connection, readonly keeper: Keypair, readonly spill: Keypair) {}

  async signLegacy(tx: Transaction, signers: Keypair[]): Promise<SignedTx> {
    const { blockhash, lastValidBlockHeight } = await this.conn.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = this.keeper.publicKey;
    tx.sign(this.keeper, ...signers.filter((s) => !s.publicKey.equals(this.keeper.publicKey)));
    const raw = tx.serialize();
    return {
      signature: bs58.encode(tx.signature!),
      lastValidBlockHeight: BigInt(lastValidBlockHeight),
      send: async () => { await this.conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 }); },
    };
  }

  async signVersioned(tx: VersionedTransaction, signers: Keypair[], lastValidBlockHeight: bigint): Promise<SignedTx> {
    tx.sign([this.keeper, ...signers]);
    const raw = tx.serialize();
    return {
      signature: bs58.encode(tx.signatures[0]!),
      lastValidBlockHeight,
      send: async () => { await this.conn.sendRawTransaction(raw, { maxRetries: 3 }); },
    };
  }

  async status(sig: string): Promise<SigState> {
    const { value } = await this.conn.getSignatureStatuses([sig], { searchTransactionHistory: true });
    const s = value[0];
    if (!s) return "unknown";
    if (s.err) return "failed";
    return s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized" ? "confirmed" : "unknown";
  }

  async blockHeight() { return BigInt(await this.conn.getBlockHeight("confirmed")); }

  async waitForConfirmation(sig: string, lastValidBlockHeight: bigint): Promise<SigState> {
    while (true) {
      const s = await this.status(sig);
      if (s !== "unknown") return s;
      if ((await this.blockHeight()) > lastValidBlockHeight) return "unknown";
      await Bun.sleep(1_000);
    }
  }

  async received(sig: string, owner: string, mint: string): Promise<bigint> {
    const tx = await this.conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    if (!tx?.meta) throw new Error(`transaction ${sig} not found`);
    const sum = (list: typeof tx.meta.preTokenBalances) =>
      (list ?? []).filter((b) => b.owner === owner && b.mint === mint).reduce((a, b) => a + BigInt(b.uiTokenAmount.amount), 0n);
    let delta = sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances);
    if (mint === NATIVE_MINT) {
      const keys = tx.transaction.message.getAccountKeys().staticAccountKeys.map((k) => k.toBase58());
      const i = keys.indexOf(owner);
      if (i >= 0) {
        delta += BigInt(tx.meta.postBalances[i]! - tx.meta.preBalances[i]!);
        if (i === 0) delta += BigInt(tx.meta.fee);
      }
    }
    return delta;
  }

  async buildTransfer(mint: string, to: string, amount: bigint): Promise<SignedTx> {
    const tx = new Transaction();
    const dest = new PublicKey(to);
    if (mint === NATIVE_MINT) {
      tx.add(SystemProgram.transfer({ fromPubkey: this.keeper.publicKey, toPubkey: dest, lamports: amount }));
    } else {
      const m = new PublicKey(mint);
      const from = getAssociatedTokenAddressSync(m, this.keeper.publicKey);
      const toAta = getAssociatedTokenAddressSync(m, dest, true);
      tx.add(createAssociatedTokenAccountIdempotentInstruction(this.keeper.publicKey, toAta, dest, m));
      tx.add(createTransferInstruction(from, toAta, this.keeper.publicKey, amount));
    }
    return this.signLegacy(tx, []);
  }

  async buildBurn(mint: string, amount: bigint): Promise<SignedTx> {
    const m = new PublicKey(mint);
    const ata = getAssociatedTokenAddressSync(m, this.spill.publicKey);
    return this.signLegacy(new Transaction().add(createBurnInstruction(ata, m, this.spill.publicKey, amount)), [this.spill]);
  }

  async balance(owner: string, mint: string): Promise<bigint> {
    const o = new PublicKey(owner);
    if (mint === NATIVE_MINT) return BigInt(await this.conn.getBalance(o, "confirmed"));
    try {
      const r = await this.conn.getTokenAccountBalance(getAssociatedTokenAddressSync(new PublicKey(mint), o, true), "confirmed");
      return BigInt(r.value.amount);
    } catch {
      return 0n;
    }
  }
}
```

The SOL `received` figure excludes rent paid for new accounts, so it can under-count. It never over-counts. Under-counting is the safe direction for the ledger.

```bash
bun add bs58
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/chain`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chain/solana.ts tests/chain package.json bun.lock && git commit -m "Add Solana chain port"
```

---

### Task 8: Meteora config keys

**Files:**
- Create: `src/meteora/config.ts`, `scripts/create-configs.ts`
- Test: `tests/meteora/config.test.ts`

**Interfaces:**
- Produces:
  - `FEE_TIERS_BPS = [100, 200, 300, 500] as const`
  - `interface QuoteSpec { mint: string; decimals: number; migrationQuoteThreshold: number }` (threshold in whole tokens)
  - `buildQuantsConfig(feeBps: number, quote: QuoteSpec): ConfigParameters`
  - `configKeyName(quoteMint: string, feeBps: number): string`

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from "bun:test";
import { validateConfigParameters, bpsToFeeNumerator } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { buildQuantsConfig, FEE_TIERS_BPS } from "../../src/meteora/config";
import { NATIVE_MINT } from "../../src/domain/types";

const SOL = { mint: NATIVE_MINT, decimals: 9, migrationQuoteThreshold: 85 };

test("every tier builds a valid config with the fee we asked for", () => {
  for (const bps of FEE_TIERS_BPS) {
    const p = buildQuantsConfig(bps, SOL);
    expect(() => validateConfigParameters({ ...p, leftoverReceiver: undefined } as any)).not.toThrow();
    expect(p.poolFees.baseFee.cliffFeeNumerator.toString()).toBe(bpsToFeeNumerator(bps).toString());
    expect(p.creatorTradingFeePercentage).toBe(0);
    expect(p.collectFeeMode).toBe(0);
    expect(p.migrationOption).toBe(1);
    expect(p.partnerPermanentLockedLiquidityPercentage).toBe(100);
    expect(p.creatorPermanentLockedLiquidityPercentage + p.creatorLiquidityPercentage + p.partnerLiquidityPercentage).toBe(0);
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/meteora/config.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/meteora/config.ts`:

```ts
import {
  buildCurve, ActivationType, BaseFeeMode, CollectFeeMode, MigrationOption, MigrationFeeOption, TokenDecimal, TokenType,
  TokenAuthorityOption, MigratedCollectFeeMode, DammV2DynamicFeeMode, type ConfigParameters,
} from "@meteora-ag/dynamic-bonding-curve-sdk";

export const FEE_TIERS_BPS = [100, 200, 300, 500] as const;
export interface QuoteSpec { mint: string; decimals: number; migrationQuoteThreshold: number }

export function buildQuantsConfig(feeBps: number, quote: QuoteSpec): ConfigParameters {
  return buildCurve({
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: TokenDecimal.SIX,
      tokenQuoteDecimal: quote.decimals,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: 1_000_000_000,
      leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: { startingFeeBps: feeBps, endingFeeBps: feeBps, numberOfPeriod: 0, totalDuration: 0 },
      },
      dynamicFeeEnabled: false,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 0,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.Customizable,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
      migratedPoolFee: { collectFeeMode: MigratedCollectFeeMode.QuoteToken, dynamicFee: DammV2DynamicFeeMode.Disabled, poolFeeBps: feeBps },
    },
    liquidityDistribution: {
      partnerPermanentLockedLiquidityPercentage: 100,
      partnerLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 0,
      creatorLiquidityPercentage: 0,
    },
    lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
    activationType: ActivationType.Timestamp,
    percentageSupplyOnMigration: 20,
    migrationQuoteThreshold: quote.migrationQuoteThreshold,
  });
}

export const configKeyName = (quoteMint: string, feeBps: number) => `${quoteMint}:${feeBps}`;
```

`scripts/create-configs.ts` creates the 8 configs and prints a JSON map `{ "<quoteMint>:<bps>": "<config address>" }` that is saved to `config-keys.json` and committed:

```ts
import { Connection, Keypair, sendAndConfirmTransaction } from "@solana/web3.js";
import { DynamicBondingCurveClient, deriveTokenBadgeAddress } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { PublicKey } from "@solana/web3.js";
import { loadEnv } from "../src/env";
import { loadKeypair } from "../src/chain/solana";
import { buildQuantsConfig, configKeyName, FEE_TIERS_BPS } from "../src/meteora/config";
import { NATIVE_MINT } from "../src/domain/types";

const env = loadEnv();
const conn = new Connection(env.RPC_URL, "confirmed");
const keeper = loadKeypair(env.KEEPER_KEYPAIR);
const client = DynamicBondingCurveClient.create(conn);
const quotes = [
  { mint: NATIVE_MINT, decimals: 9, migrationQuoteThreshold: Number(process.env.SOL_GRADUATION ?? 85), badge: false },
  { mint: env.OURTOKEN_MINT, decimals: Number(process.env.OURTOKEN_DECIMALS ?? 6), migrationQuoteThreshold: Number(process.env.OURTOKEN_GRADUATION), badge: true },
];
const out: Record<string, string> = {};
for (const q of quotes) {
  for (const bps of FEE_TIERS_BPS) {
    const config = Keypair.generate();
    const tx = await client.partner.createConfig({
      config: config.publicKey, feeClaimer: keeper.publicKey, leftoverReceiver: keeper.publicKey,
      quoteMint: new PublicKey(q.mint), payer: keeper.publicKey,
      tokenBadge: q.badge ? deriveTokenBadgeAddress(new PublicKey(q.mint)) : undefined,
      ...buildQuantsConfig(bps, q),
    });
    await sendAndConfirmTransaction(conn, tx, [keeper, config]);
    out[configKeyName(q.mint, bps)] = config.publicKey.toBase58();
    console.error("created", configKeyName(q.mint, bps));
  }
}
console.log(JSON.stringify(out, null, 2));
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/meteora/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/meteora/config.ts scripts/create-configs.ts tests/meteora && git commit -m "Add DBC config builder and config key script"
```

---

### Task 9: Meteora port

**Files:**
- Create: `src/meteora/port.ts`
- Test: `tests/meteora/port.test.ts` (validator with programs cloned as in Task 2; skipped when unreachable)

**Interfaces:**
- Consumes: `SolanaChain` (Task 7), `buildQuantsConfig` (Task 8).
- Produces:

```ts
export interface GraduatedPosition { dammPool: string; position: string; positionNftAccount: string }
export interface MeteoraPort {
  pendingPartnerQuoteFee(pool: string): Promise<bigint>;
  buildClaimPartnerFee(pool: string, maxQuote: bigint): Promise<SignedTx>;
  buildClaimPositionFee(p: GraduatedPosition): Promise<SignedTx>;
  curveState(pool: string): Promise<{ migrated: boolean; complete: boolean }>;
  buildMigrate(pool: string): Promise<SignedTx>;
  findGraduatedPosition(configKey: string, baseMint: string, quoteMint: string): Promise<GraduatedPosition | null>;
  buildLaunchTx(input: LaunchTxInput): Promise<{ tx: Transaction; baseMint: Keypair; pool: string }>;
}
export interface LaunchTxInput {
  name: string; symbol: string; uri: string; creator: string; configKey: string; quoteMint: string;
  launchFeeLamports: bigint; feeReceiver: string; devBuyQuoteAmount: bigint; devBuyMinOut: bigint;
}
export class MeteoraLive implements MeteoraPort { constructor(chain: SolanaChain, dammMigrationConfig: string) }
```

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect, beforeAll } from "bun:test";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { SolanaChain } from "../../src/chain/solana";
import { MeteoraLive } from "../../src/meteora/port";
import { buildQuantsConfig } from "../../src/meteora/config";
import { NATIVE_MINT } from "../../src/domain/types";

const conn = new Connection(process.env.RPC_URL ?? "http://127.0.0.1:8899", "confirmed");
let up = true;
beforeAll(async () => {
  try { up = (await conn.getAccountInfo(new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"))) !== null; } catch { up = false; }
});

test.skipIf(!up)("launch, trade, read and claim partner fee", async () => {
  const keeper = Keypair.generate(), creator = Keypair.generate();
  for (const k of [keeper, creator]) await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 20 * LAMPORTS_PER_SOL));
  const chain = new SolanaChain(conn, keeper, Keypair.generate());
  const m = new MeteoraLive(chain, process.env.DAMM_V2_MIGRATION_CONFIG ?? keeper.publicKey.toBase58());

  const config = Keypair.generate();
  const client = DynamicBondingCurveClient.create(conn);
  const ctx = await client.partner.createConfig({
    config: config.publicKey, feeClaimer: keeper.publicKey, leftoverReceiver: keeper.publicKey,
    quoteMint: new PublicKey(NATIVE_MINT), payer: keeper.publicKey,
    ...buildQuantsConfig(200, { mint: NATIVE_MINT, decimals: 9, migrationQuoteThreshold: 85 }),
  });
  await sendAndConfirmTransaction(conn, ctx, [keeper, config]);

  const { tx, baseMint, pool } = await m.buildLaunchTx({
    name: "Cat", symbol: "CAT", uri: "https://example.com/cat.json", creator: creator.publicKey.toBase58(),
    configKey: config.publicKey.toBase58(), quoteMint: NATIVE_MINT, launchFeeLamports: 300_000_000n,
    feeReceiver: keeper.publicKey.toBase58(), devBuyQuoteAmount: 1_000_000_000n, devBuyMinOut: 0n,
  });
  await sendAndConfirmTransaction(conn, tx, [creator, baseMint]);

  const fee = await m.pendingPartnerQuoteFee(pool);
  expect(fee).toBeGreaterThan(0n);
  const claim = await m.buildClaimPartnerFee(pool, fee);
  await claim.send();
  expect(await chain.waitForConfirmation(claim.signature, claim.lastValidBlockHeight)).toBe("confirmed");
  expect(await m.pendingPartnerQuoteFee(pool)).toBe(0n);
  expect(await m.curveState(pool)).toEqual({ migrated: false, complete: false });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/meteora/port.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { DynamicBondingCurveClient, deriveDbcPoolAddress, deriveDammV2PoolAddress, derivePositionNftAccount } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { CpAmm, getTokenProgram } from "@meteora-ag/cp-amm-sdk";
import type { SignedTx } from "../chain/port";
import type { SolanaChain } from "../chain/solana";

export interface GraduatedPosition { dammPool: string; position: string; positionNftAccount: string }
export interface LaunchTxInput {
  name: string; symbol: string; uri: string; creator: string; configKey: string; quoteMint: string;
  launchFeeLamports: bigint; feeReceiver: string; devBuyQuoteAmount: bigint; devBuyMinOut: bigint;
}
export interface MeteoraPort {
  pendingPartnerQuoteFee(pool: string): Promise<bigint>;
  buildClaimPartnerFee(pool: string, maxQuote: bigint): Promise<SignedTx>;
  buildClaimPositionFee(p: GraduatedPosition): Promise<SignedTx>;
  curveState(pool: string): Promise<{ migrated: boolean; complete: boolean }>;
  buildMigrate(pool: string): Promise<SignedTx>;
  findGraduatedPosition(configKey: string, baseMint: string, quoteMint: string): Promise<GraduatedPosition | null>;
  buildLaunchTx(input: LaunchTxInput): Promise<{ tx: Transaction; baseMint: Keypair; pool: string }>;
}

const pk = (s: string) => new PublicKey(s);

export class MeteoraLive implements MeteoraPort {
  private dbc: DynamicBondingCurveClient;
  private cp: CpAmm;
  constructor(private chain: SolanaChain, private dammMigrationConfig: string) {
    this.dbc = DynamicBondingCurveClient.create(chain.conn, "confirmed");
    this.cp = new CpAmm(chain.conn);
  }

  async pendingPartnerQuoteFee(pool: string) {
    const m = await this.dbc.state.getPoolFeeMetrics(pool);
    return BigInt(m.current.partnerQuoteFee.toString());
  }

  async buildClaimPartnerFee(pool: string, maxQuote: bigint) {
    const keeper = this.chain.keeper.publicKey;
    const tx = await this.dbc.partner.claimPartnerTradingFee({
      feeClaimer: keeper, payer: keeper, pool: pk(pool), maxBaseAmount: new BN(0), maxQuoteAmount: new BN(maxQuote.toString()), receiver: keeper,
    });
    return this.chain.signLegacy(tx, []);
  }

  async buildClaimPositionFee(p: GraduatedPosition) {
    const state = await this.cp.fetchPoolState(pk(p.dammPool));
    const keeper = this.chain.keeper.publicKey;
    const tx = await this.cp.claimPositionFee({
      owner: keeper, position: pk(p.position), pool: pk(p.dammPool), positionNftAccount: pk(p.positionNftAccount),
      tokenAMint: state.tokenAMint, tokenBMint: state.tokenBMint, tokenAVault: state.tokenAVault, tokenBVault: state.tokenBVault,
      tokenAProgram: getTokenProgram(state.tokenAFlag), tokenBProgram: getTokenProgram(state.tokenBFlag), receiver: keeper,
    });
    return this.chain.signLegacy(tx, []);
  }

  async curveState(pool: string) {
    const p = await this.dbc.state.getPool(pool);
    if (!p) throw new Error(`pool ${pool} not found`);
    const cfg = await this.dbc.state.getPoolConfig(p.config);
    if (!cfg) throw new Error(`config ${p.config.toBase58()} not found`);
    return { migrated: p.isMigrated !== 0, complete: p.quoteReserve.gte(cfg.migrationQuoteThreshold) };
  }

  async buildMigrate(pool: string) {
    const { transaction, firstPositionNftKeypair, secondPositionNftKeypair } = await this.dbc.migration.migrateToDammV2({
      payer: this.chain.keeper.publicKey, pool: pk(pool), dammConfig: pk(this.dammMigrationConfig),
    });
    return this.chain.signLegacy(transaction, [firstPositionNftKeypair, secondPositionNftKeypair]);
  }

  async findGraduatedPosition(_configKey: string, baseMint: string, quoteMint: string) {
    const dammPool = deriveDammV2PoolAddress(pk(this.dammMigrationConfig), pk(baseMint), pk(quoteMint));
    const positions = await this.cp.getUserPositionByPool(dammPool, this.chain.keeper.publicKey);
    const first = positions[0];
    if (!first) return null;
    return {
      dammPool: dammPool.toBase58(),
      position: first.position.toBase58(),
      positionNftAccount: first.positionNftAccount.toBase58(),
    };
  }

  async buildLaunchTx(input: LaunchTxInput) {
    const baseMint = Keypair.generate();
    const creator = pk(input.creator);
    const create = await this.dbc.creator.createPoolWithFirstBuy({
      createPoolParam: {
        name: input.name, symbol: input.symbol, uri: input.uri, payer: creator, poolCreator: creator,
        config: pk(input.configKey), baseMint: baseMint.publicKey,
      },
      firstBuyParam: input.devBuyQuoteAmount > 0n
        ? { buyer: creator, buyAmount: new BN(input.devBuyQuoteAmount.toString()), minimumAmountOut: new BN(input.devBuyMinOut.toString()), referralTokenAccount: null }
        : undefined,
    });
    const tx = new Transaction()
      .add(SystemProgram.transfer({ fromPubkey: creator, toPubkey: pk(input.feeReceiver), lamports: input.launchFeeLamports }))
      .add(...create.instructions);
    const { blockhash } = await this.chain.conn.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = creator;
    tx.partialSign(baseMint);
    const pool = deriveDbcPoolAddress(pk(input.quoteMint), baseMint.publicKey, pk(input.configKey)).toBase58();
    return { tx, baseMint, pool };
  }
}
```

If Task 2 found that `DAMM_V2_MIGRATION_CONFIG` must differ per fee tier, change `dammMigrationConfig` to a map keyed by fee tier and look it up from the launch's `fee_tier_bps` here and in Task 15. The spike doc says which.

- [ ] **Step 4: Run tests**

Run: `bun test tests/meteora`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/meteora/port.ts tests/meteora/port.test.ts && git commit -m "Add Meteora port for launch, claims and migration"
```

---

### Task 10: Launch prepare and confirm

**Files:**
- Create: `src/launch/prepare.ts`, `src/launch/confirm.ts`
- Test: `tests/launch/prepare.test.ts`, `tests/launch/confirm.test.ts`, `tests/helpers/fake-meteora.ts`

**Interfaces:**
- Consumes: `MeteoraPort`, `LaunchTxInput` (Task 9), `loadLatestSettings` (Task 5), `configKeyName` (Task 8).
- Produces:
  - `LaunchInput` zod schema: `{ name (1-32), symbol (1-10, [A-Za-z0-9]), uri (https URL), creator (base58 32-44), quoteMint (SOL or OURTOKEN), feeTierBps (100|200|300|500), basket: { mint, weightBps }[] (1-3, unique mints, weights sum 10000), devBuyQuoteAmount (bigint string, default "0"), devBuyMinOut (bigint string, default "0") }`
  - `prepareLaunch(deps: { sql; meteora: MeteoraPort; configKeys: Record<string, string>; ourtokenMint: string; keeperAddress: string; isVerified: (mint: string) => Promise<boolean> }, input: unknown): Promise<{ transaction: string /* base64, partially signed */; mint: string; pool: string; settingsVersion: number }>`
  - `confirmLaunch(deps: { sql; conn: Connection; configKeys: Record<string, string> }, input: { signature: string; mint: string; pool: string; creator: string; quoteMint: string; feeTierBps: number; basket: { mint: string; weightBps: number }[]; settingsVersion: number; spillAccount: string }): Promise<number /* launch id */>`
  - `LaunchError` class with `code: "invalid_input" | "basket_not_verified" | "dev_buy_too_large" | "not_found_on_chain"`

The dev buy cap is checked in plan 2's UI in supply terms. Here the server rejects a dev buy whose `devBuyMinOut` exceeds `devBuyCapBps` of the 1B supply (6 decimals).

- [ ] **Step 1: Fake Meteora and failing tests**

`tests/helpers/fake-meteora.ts`:

```ts
import { Keypair, Transaction } from "@solana/web3.js";
import type { MeteoraPort, GraduatedPosition, LaunchTxInput } from "../../src/meteora/port";
import type { FakeChain } from "./fake-chain";

export class FakeMeteora implements MeteoraPort {
  partnerFee = new Map<string, bigint>();
  curve = new Map<string, { migrated: boolean; complete: boolean }>();
  graduated = new Map<string, GraduatedPosition>();
  launches: LaunchTxInput[] = [];
  constructor(private chain: FakeChain) {}
  async pendingPartnerQuoteFee(pool: string) { return this.partnerFee.get(pool) ?? 0n; }
  async buildClaimPartnerFee(pool: string) { return this.chain.tx(`claim-${pool}`); }
  async buildClaimPositionFee(p: GraduatedPosition) { return this.chain.tx(`claimpos-${p.dammPool}`); }
  async curveState(pool: string) { return this.curve.get(pool) ?? { migrated: false, complete: false }; }
  async buildMigrate(pool: string) { return this.chain.tx(`migrate-${pool}`); }
  async findGraduatedPosition(_c: string, baseMint: string) { return this.graduated.get(baseMint) ?? null; }
  async buildLaunchTx(input: LaunchTxInput) {
    this.launches.push(input);
    const baseMint = Keypair.generate();
    const tx = new Transaction({ feePayer: baseMint.publicKey, recentBlockhash: "11111111111111111111111111111111" });
    return { tx, baseMint, pool: `pool-${baseMint.publicKey.toBase58()}` };
  }
}
```

`tests/launch/prepare.test.ts`:

```ts
import { test, expect } from "bun:test";
import { freshDb } from "../helpers/db";
import { FakeChain } from "../helpers/fake-chain";
import { FakeMeteora } from "../helpers/fake-meteora";
import { prepareLaunch, LaunchError } from "../../src/launch/prepare";
import { defaultSettings, saveSettings } from "../../src/domain/settings";
import { NATIVE_MINT } from "../../src/domain/types";

const OURS = "OURS1111111111111111111111111111111111111111";
const KEEPER = "Keeper1111111111111111111111111111111111111";
const configKeys = { [`${NATIVE_MINT}:200`]: "CfgSol200", [`${OURS}:200`]: "CfgOurs200" };
const valid = {
  name: "Cat", symbol: "CAT", uri: "https://x.test/cat.json", creator: "Creator111111111111111111111111111111111111",
  quoteMint: NATIVE_MINT, feeTierBps: 200,
  basket: [{ mint: "Zec1111111111111111111111111111111111111111", weightBps: 5000 }, { mint: "Cate111111111111111111111111111111111111111", weightBps: 5000 }],
};

async function setup(verified = true) {
  const sql = await freshDb();
  await saveSettings(sql, defaultSettings(OURS), "test");
  const meteora = new FakeMeteora(new FakeChain());
  return { sql, meteora, deps: { sql, meteora, configKeys, ourtokenMint: OURS, keeperAddress: KEEPER, isVerified: async () => verified } };
}

test("prepares a transaction against the right config key with the launch fee", async () => {
  const { deps, meteora } = await setup();
  const r = await prepareLaunch(deps, valid);
  expect(r.pool).toStartWith("pool-");
  expect(typeof r.transaction).toBe("string");
  expect(meteora.launches[0]!.configKey).toBe("CfgSol200");
  expect(meteora.launches[0]!.launchFeeLamports).toBe(300_000_000n);
  expect(meteora.launches[0]!.feeReceiver).toBe(KEEPER);
});

test("rejects bad input", async () => {
  const { deps } = await setup();
  const bad = [
    { ...valid, name: "" },
    { ...valid, symbol: "TOOLONGSYMBOL" },
    { ...valid, feeTierBps: 250 },
    { ...valid, quoteMint: "Other11111111111111111111111111111111111111" },
    { ...valid, basket: [] },
    { ...valid, basket: [...valid.basket, valid.basket[0], valid.basket[1]] },
    { ...valid, basket: [{ mint: valid.basket[0]!.mint, weightBps: 4000 }] },
    { ...valid, uri: "http://x.test/cat.json" },
  ];
  for (const b of bad) await expect(prepareLaunch(deps, b)).rejects.toBeInstanceOf(LaunchError);
});

test("rejects unverified basket tokens", async () => {
  const { deps } = await setup(false);
  await expect(prepareLaunch(deps, valid)).rejects.toMatchObject({ code: "basket_not_verified" });
});

test("rejects a dev buy over the cap", async () => {
  const { deps } = await setup();
  await expect(prepareLaunch(deps, { ...valid, devBuyQuoteAmount: "1", devBuyMinOut: (600_000_000n * 1_000_000n).toString() }))
    .rejects.toMatchObject({ code: "dev_buy_too_large" });
});
```

`tests/launch/confirm.test.ts`:

```ts
import { test, expect } from "bun:test";
import { freshDb } from "../helpers/db";
import { confirmLaunch } from "../../src/launch/confirm";
import { NATIVE_MINT } from "../../src/domain/types";
import { defaultSettings, saveSettings } from "../../src/domain/settings";

const conn = (ok: boolean) => ({
  getSignatureStatuses: async () => ({ value: [ok ? { err: null, confirmationStatus: "confirmed" } : null] }),
  getAccountInfo: async () => (ok ? { data: Buffer.alloc(0) } : null),
}) as any;

const input = {
  signature: "sig", mint: "Mint1", pool: "Pool1", creator: "Creator1", quoteMint: NATIVE_MINT, feeTierBps: 200,
  basket: [{ mint: "Zec", weightBps: 10_000 }], settingsVersion: 1, spillAccount: "Spill1",
};

test("records launch, basket, and a pending stake pool with tiers from the settings version", async () => {
  const sql = await freshDb();
  await saveSettings(sql, defaultSettings("OURS"), "t");
  const id = await confirmLaunch({ sql, conn: conn(true), configKeys: { [`${NATIVE_MINT}:200`]: "Cfg" } }, input);
  const [l] = await sql`select * from launches where id = ${id}`;
  expect(l.config_key).toBe("Cfg");
  expect((await sql`select * from baskets where launch_id = ${id}`).length).toBe(1);
  const [sp] = await sql`select * from stake_pools where launch_id = ${id}`;
  expect(sp.status).toBe("pending");
  expect(sp.max_penalty_bps).toBe(3000);
  expect((await sql`select tier_id from stake_tiers where launch_id = ${id} order by lock_seconds`).map((r: any) => r.tier_id)).toEqual(["7d", "30d", "90d", "180d"]);
});

test("confirm is idempotent on mint", async () => {
  const sql = await freshDb();
  await saveSettings(sql, defaultSettings("OURS"), "t");
  const deps = { sql, conn: conn(true), configKeys: { [`${NATIVE_MINT}:200`]: "Cfg" } };
  expect(await confirmLaunch(deps, input)).toBe(await confirmLaunch(deps, input));
});

test("rejects when the pool is not on-chain", async () => {
  const sql = await freshDb();
  await saveSettings(sql, defaultSettings("OURS"), "t");
  await expect(confirmLaunch({ sql, conn: conn(false), configKeys: { [`${NATIVE_MINT}:200`]: "Cfg" } }, input)).rejects.toMatchObject({ code: "not_found_on_chain" });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/launch`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/launch/prepare.ts`:

```ts
import type { SQL } from "bun";
import { z } from "zod";
import type { MeteoraPort } from "../meteora/port";
import { configKeyName, FEE_TIERS_BPS } from "../meteora/config";
import { loadLatestSettings } from "../domain/settings";
import { NATIVE_MINT } from "../domain/types";

export class LaunchError extends Error {
  constructor(public code: "invalid_input" | "basket_not_verified" | "dev_buy_too_large" | "not_found_on_chain", message: string) { super(message); }
}

const addr = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const uint = z.string().regex(/^\d+$/).transform((v) => BigInt(v));

const launchInput = (ourtokenMint: string) => z.object({
  name: z.string().trim().min(1).max(32),
  symbol: z.string().regex(/^[A-Za-z0-9]{1,10}$/),
  uri: z.string().url().startsWith("https://"),
  creator: addr,
  quoteMint: z.enum([NATIVE_MINT, ourtokenMint] as [string, string]),
  feeTierBps: z.number().refine((v) => (FEE_TIERS_BPS as readonly number[]).includes(v)),
  basket: z.array(z.object({ mint: addr, weightBps: z.number().int().positive() })).min(1).max(3)
    .refine((b) => new Set(b.map((x) => x.mint)).size === b.length, "duplicate basket token")
    .refine((b) => b.reduce((a, x) => a + x.weightBps, 0) === 10_000, "weights must sum to 10000"),
  devBuyQuoteAmount: uint.default("0"),
  devBuyMinOut: uint.default("0"),
});
export type LaunchInput = z.infer<ReturnType<typeof launchInput>>;

const SUPPLY_BASE_UNITS = 1_000_000_000n * 1_000_000n;

export async function prepareLaunch(
  deps: { sql: SQL; meteora: MeteoraPort; configKeys: Record<string, string>; ourtokenMint: string; keeperAddress: string; isVerified: (mint: string) => Promise<boolean> },
  raw: unknown,
) {
  const parsed = launchInput(deps.ourtokenMint).safeParse(raw);
  if (!parsed.success) throw new LaunchError("invalid_input", parsed.error.issues.map((i) => i.message).join("; "));
  const input = parsed.data;
  for (const b of input.basket) {
    if (!(await deps.isVerified(b.mint))) throw new LaunchError("basket_not_verified", `${b.mint} is not on the Jupiter verified list`);
  }
  const settings = await loadLatestSettings(deps.sql);
  if (input.devBuyMinOut * 10_000n > SUPPLY_BASE_UNITS * BigInt(settings.devBuyCapBps)) {
    throw new LaunchError("dev_buy_too_large", `dev buy is capped at ${settings.devBuyCapBps / 100}% of supply`);
  }
  const configKey = deps.configKeys[configKeyName(input.quoteMint, input.feeTierBps)];
  if (!configKey) throw new LaunchError("invalid_input", "no config key for this quote and fee tier");
  const { tx, baseMint, pool } = await deps.meteora.buildLaunchTx({
    name: input.name, symbol: input.symbol, uri: input.uri, creator: input.creator, configKey, quoteMint: input.quoteMint,
    launchFeeLamports: settings.launchFeeLamports, feeReceiver: deps.keeperAddress,
    devBuyQuoteAmount: input.devBuyQuoteAmount, devBuyMinOut: input.devBuyMinOut,
  });
  return {
    transaction: tx.serialize({ requireAllSignatures: false }).toString("base64"),
    mint: baseMint.publicKey.toBase58(),
    pool,
    settingsVersion: settings.version,
  };
}
```

OURTOKEN-quoted dev buys paid in SOL need a Jupiter SOL-to-OURTOKEN swap before this transaction. Plan 2 builds that swap client-side and asks the wallet to sign both in one approval. The server here only takes a dev buy already denominated in the quote token.

`src/launch/confirm.ts`:

```ts
import type { SQL } from "bun";
import { PublicKey, type Connection } from "@solana/web3.js";
import { LaunchError } from "./prepare";
import { configKeyName } from "../meteora/config";

export async function confirmLaunch(
  deps: { sql: SQL; conn: Connection; configKeys: Record<string, string> },
  i: { signature: string; mint: string; pool: string; creator: string; quoteMint: string; feeTierBps: number;
       basket: { mint: string; weightBps: number }[]; settingsVersion: number; spillAccount: string },
): Promise<number> {
  const [existing] = await deps.sql`select id from launches where mint = ${i.mint}`;
  if (existing) return Number(existing.id);
  const { value } = await deps.conn.getSignatureStatuses([i.signature], { searchTransactionHistory: true });
  const status = value[0];
  const pool = await deps.conn.getAccountInfo(new PublicKey(i.pool), "confirmed").catch(() => null);
  if (!status || status.err || !pool) throw new LaunchError("not_found_on_chain", "launch transaction or pool not found");
  const configKey = deps.configKeys[configKeyName(i.quoteMint, i.feeTierBps)]!;
  const basket = JSON.stringify(i.basket);
  const [row] = await deps.sql`
    with s as (select data from settings where version = ${i.settingsVersion}),
    l as (
      insert into launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, status, settings_version)
      values (${i.mint}, ${i.pool}, ${i.quoteMint}, ${i.feeTierBps}, ${configKey}, ${i.creator}, 'live', ${i.settingsVersion})
      on conflict (mint) do nothing returning id
    ), b as (
      insert into baskets (launch_id, reward_mint, weight_bps)
      select l.id, x.mint, x."weightBps" from l cross join jsonb_to_recordset(${basket}::jsonb) as x(mint text, "weightBps" int)
    ), p as (
      insert into stake_pools (launch_id, backend, max_penalty_bps, spill_account, status)
      select l.id, s.data->>'defaultBackend', (s.data->>'maxPenaltyBps')::int, ${i.spillAccount}, 'pending' from l, s
      returning launch_id
    ), t as (
      insert into stake_tiers (launch_id, tier_id, lock_seconds, multiplier_bps)
      select p.launch_id, x.id, x."lockSeconds", x."multiplierBps"
      from p, s, jsonb_to_recordset(s.data->'tiers') as x(id text, "lockSeconds" int, "multiplierBps" int)
    )
    select id from l`;
  if (row) return Number(row.id);
  const [again] = await deps.sql`select id from launches where mint = ${i.mint}`;
  return Number(again.id);
}
```

`spillAccount` is the spill wallet's associated token account for the launch mint; the caller derives it with `getAssociatedTokenAddressSync(mint, spillPubkey)`. The keeper creates it in Task 13 before configuring farms.

- [ ] **Step 4: Run tests**

Run: `bun test tests/launch`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/launch tests/launch tests/helpers/fake-meteora.ts && git commit -m "Add launch prepare and confirm"
```

---

### Task 11: Keeper deps, claim, split and payout steps

**Files:**
- Create: `src/keeper/deps.ts`, `src/keeper/steps/claim.ts`, `src/keeper/steps/split.ts`, `src/keeper/steps/payout.ts`, `src/keeper/resolvers.ts`, `src/keeper/launch-row.ts`
- Test: `tests/keeper/claim-split-payout.test.ts`, `tests/helpers/keeper-deps.ts`

**Interfaces:**
- Consumes: ledger (Task 6), `MeteoraPort` (Task 9), `splitFees` (Task 4), `VersionedSettings` (Task 5).
- Produces:
  - `interface LaunchRow { id: number; mint: string; pool: string; quoteMint: string; creator: string; configKey: string; status: "live" | "graduated"; dammPool: string | null; dammPosition: string | null; dammPositionNftAccount: string | null; ourtoken: boolean }`
  - `loadLaunches(sql, ourtokenMint): Promise<LaunchRow[]>`
  - `interface KeeperDeps { sql: SQL; chain: ChainPort; meteora: MeteoraPort; jupiter: JupiterPort; staking: StakingAdapter; wallets: { keeper: string; spill: string; treasury: string }; ourtokenMint: string }` (`JupiterPort` and `StakingAdapter` types are declared in Tasks 12 and 13; this task declares them as imports and Task 12/13 create the files — until then `deps.ts` imports only what exists, and Task 12 and 13 each add their field)
  - `claimStep(deps, launch, settings, runId): Promise<Outcome | "skipped">`
  - `splitStep(deps, launch, settings, runId): Promise<boolean>`
  - `payoutStep(deps, launch, settings, runId): Promise<void>`
  - `resolvers: Record<StepKind, DeltaResolver>` built by `makeResolvers(deps)`

Idem keys: `${kind}:${launchId}:${runId}[:${sub}]`.

- [ ] **Step 1: Shared test deps**

`tests/helpers/keeper-deps.ts`:

```ts
import { freshDb } from "./db";
import { FakeChain } from "./fake-chain";
import { FakeMeteora } from "./fake-meteora";
import { defaultSettings, saveSettings, loadLatestSettings } from "../../src/domain/settings";
import type { KeeperDeps } from "../../src/keeper/deps";

export const OURS = "OURS1111111111111111111111111111111111111111";
export const WALLETS = { keeper: "Keeper", spill: "Spill", treasury: "Treasury" };

export async function keeperFixture(extra: Partial<KeeperDeps> = {}) {
  const sql = await freshDb();
  await saveSettings(sql, defaultSettings(OURS), "t");
  const chain = new FakeChain();
  const meteora = new FakeMeteora(chain);
  const deps = { sql, chain, meteora, wallets: WALLETS, ourtokenMint: OURS, ...extra } as KeeperDeps;
  return { sql, chain, meteora, deps, settings: await loadLatestSettings(sql) };
}
```

- [ ] **Step 2: Failing tests**

`tests/keeper/claim-split-payout.test.ts`:

```ts
import { test, expect } from "bun:test";
import { keeperFixture } from "../helpers/keeper-deps";
import { insertLaunch } from "../helpers/fixtures";
import { loadLaunches } from "../../src/keeper/launch-row";
import { claimStep } from "../../src/keeper/steps/claim";
import { splitStep } from "../../src/keeper/steps/split";
import { payoutStep } from "../../src/keeper/steps/payout";
import { getBalance } from "../../src/ledger/ledger";
import { saveSettings } from "../../src/domain/settings";
import { NATIVE_MINT } from "../../src/domain/types";

test("claim credits the exact pending partner fee, then split moves it by the settings", async () => {
  const { sql, meteora, deps, settings } = await keeperFixture();
  const id = await insertLaunch(sql, { pool: "P1" });
  meteora.partnerFee.set("P1", 1_000_000n);
  const [launch] = await loadLaunches(sql, deps.ourtokenMint);
  expect(await claimStep(deps, launch!, settings, "r1")).toBe("confirmed");
  expect(await getBalance(sql, id, "unsplit", NATIVE_MINT)).toBe(1_000_000n);
  expect(await splitStep(deps, launch!, settings, "r1")).toBe(true);
  expect(await getBalance(sql, id, "unsplit", NATIVE_MINT)).toBe(0n);
  expect(await getBalance(sql, id, "basket", NATIVE_MINT)).toBe(600_000n);
  expect(await getBalance(sql, id, "treasury", NATIVE_MINT)).toBe(250_000n);
  expect(await getBalance(sql, id, "creator", NATIVE_MINT)).toBe(150_000n);
});

test("claim is skipped when nothing is pending", async () => {
  const { sql, deps, settings } = await keeperFixture();
  await insertLaunch(sql, { pool: "P2" });
  const [launch] = await loadLaunches(sql, deps.ourtokenMint);
  expect(await claimStep(deps, launch!, settings, "r1")).toBe("skipped");
});

test("split uses the settings version passed in, even if a newer one is saved mid-run", async () => {
  const { sql, meteora, deps, settings } = await keeperFixture();
  const id = await insertLaunch(sql, { pool: "P3" });
  meteora.partnerFee.set("P3", 1_000n);
  const [launch] = await loadLaunches(sql, deps.ourtokenMint);
  await claimStep(deps, launch!, settings, "r1");
  await saveSettings(sql, { ...settings, split: { basketBps: 10_000, platformBps: 0, creatorBps: 0 } }, "admin");
  await splitStep(deps, launch!, settings, "r1");
  expect(await getBalance(sql, id, "basket", NATIVE_MINT)).toBe(600n);
  const [d] = await sql`select settings_version from distributions where kind = 'split'`;
  expect(d.settings_version).toBe(settings.version);
});

test("payout sends treasury every run and creator only above the minimum", async () => {
  const { sql, chain, meteora, deps, settings } = await keeperFixture();
  const id = await insertLaunch(sql, { pool: "P4" });
  meteora.partnerFee.set("P4", 100_000_000n);
  const [launch] = await loadLaunches(sql, deps.ourtokenMint);
  await claimStep(deps, launch!, settings, "r1");
  await splitStep(deps, launch!, settings, "r1");
  await payoutStep(deps, launch!, settings, "r1");
  expect(await getBalance(sql, id, "treasury", NATIVE_MINT)).toBe(0n);
  expect(await getBalance(sql, id, "creator", NATIVE_MINT)).toBe(15_000_000n);
  expect(chain.sent.filter((s) => s.startsWith("transfer")).length).toBe(1);

  meteora.partnerFee.set("P4", 300_000_000n);
  await claimStep(deps, launch!, settings, "r2");
  await splitStep(deps, launch!, settings, "r2");
  await payoutStep(deps, launch!, settings, "r2");
  expect(await getBalance(sql, id, "creator", NATIVE_MINT)).toBe(0n);
});

test("graduated launches claim from the DAMM position and credit the measured amount", async () => {
  const { sql, chain, deps, settings } = await keeperFixture();
  const id = await insertLaunch(sql, { pool: "P5", status: "graduated" });
  await sql`update launches set damm_pool = 'D5', damm_position = 'Pos5', damm_position_nft_account = 'Nft5' where id = ${id}`;
  const [launch] = await loadLaunches(sql, deps.ourtokenMint);
  const orig = chain.tx.bind(chain);
  chain.tx = (label) => { const t = orig(label); chain.receipts.set(t.signature, 777n); return t; };
  expect(await claimStep(deps, launch!, settings, "r1")).toBe("confirmed");
  expect(await getBalance(sql, id, "unsplit", NATIVE_MINT)).toBe(777n);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `bun test tests/keeper/claim-split-payout.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement**

`src/keeper/launch-row.ts`:

```ts
import type { SQL } from "bun";

export interface LaunchRow {
  id: number; mint: string; pool: string; quoteMint: string; creator: string; configKey: string; status: "live" | "graduated";
  dammPool: string | null; dammPosition: string | null; dammPositionNftAccount: string | null; ourtoken: boolean;
}

export async function loadLaunches(sql: SQL, ourtokenMint: string): Promise<LaunchRow[]> {
  const rows = await sql`select * from launches order by id`;
  return rows.map((r: any) => ({
    id: Number(r.id), mint: r.mint, pool: r.pool, quoteMint: r.quote_mint, creator: r.creator, configKey: r.config_key,
    status: r.status, dammPool: r.damm_pool, dammPosition: r.damm_position, dammPositionNftAccount: r.damm_position_nft_account,
    ourtoken: r.quote_mint === ourtokenMint,
  }));
}
```

`src/keeper/deps.ts` (Task 12 adds `jupiter`, Task 13 adds `staking`):

```ts
import type { SQL } from "bun";
import type { ChainPort } from "../chain/port";
import type { MeteoraPort } from "../meteora/port";

export interface KeeperDeps {
  sql: SQL;
  chain: ChainPort;
  meteora: MeteoraPort;
  wallets: { keeper: string; spill: string; treasury: string };
  ourtokenMint: string;
}
```

`src/keeper/steps/claim.ts`:

```ts
import type { KeeperDeps } from "../deps";
import type { LaunchRow } from "../launch-row";
import type { VersionedSettings } from "../../domain/settings";
import { runTxStep, type Outcome } from "../../ledger/run-step";
import type { DeltaResolver } from "../../ledger/ledger";

export const claimResolver = (deps: KeeperDeps): DeltaResolver => async (row, sig) => {
  const mint = row.detail.quoteMint as string;
  const amount = row.detail.source === "dbc" ? BigInt(row.detail.amount) : await deps.chain.received(sig, deps.wallets.keeper, mint);
  return amount > 0n ? [{ bucket: "unsplit", mint, amount }] : [];
};

export async function claimStep(deps: KeeperDeps, launch: LaunchRow, s: VersionedSettings, runId: string): Promise<Outcome | "skipped"> {
  const base = { launchId: launch.id, idemKey: `claim:${launch.id}:${runId}`, kind: "claim" as const, settingsVersion: s.version, resolve: claimResolver(deps) };
  if (launch.status === "graduated") {
    if (!launch.dammPool || !launch.dammPosition || !launch.dammPositionNftAccount) return "skipped";
    const p = { dammPool: launch.dammPool, position: launch.dammPosition, positionNftAccount: launch.dammPositionNftAccount };
    return runTxStep(deps.sql, deps.chain, { ...base, detail: { source: "damm", quoteMint: launch.quoteMint }, build: () => deps.meteora.buildClaimPositionFee(p) });
  }
  const amount = await deps.meteora.pendingPartnerQuoteFee(launch.pool);
  if (amount === 0n) return "skipped";
  return runTxStep(deps.sql, deps.chain, {
    ...base, detail: { source: "dbc", quoteMint: launch.quoteMint, amount: amount.toString() },
    build: () => deps.meteora.buildClaimPartnerFee(launch.pool, amount),
  });
}
```

DBC partner fees only grow, so claiming with `maxQuoteAmount = amount` transfers exactly `amount`. That makes the recorded figure exact without reading the transaction.

`src/keeper/steps/split.ts`:

```ts
import type { KeeperDeps } from "../deps";
import type { LaunchRow } from "../launch-row";
import type { VersionedSettings } from "../../domain/settings";
import { getBalance } from "../../ledger/ledger";
import { runDbStep } from "../../ledger/run-step";
import { splitFees } from "../../domain/weights";

export async function splitStep(deps: KeeperDeps, launch: LaunchRow, s: VersionedSettings, runId: string): Promise<boolean> {
  const mint = launch.quoteMint;
  const amount = await getBalance(deps.sql, launch.id, "unsplit", mint);
  if (amount === 0n) return false;
  const r = splitFees(amount, s.split);
  return runDbStep(deps.sql, {
    launchId: launch.id, idemKey: `split:${launch.id}:${runId}`, kind: "split", settingsVersion: s.version,
    detail: { amount: amount.toString() },
    deltas: [
      { bucket: "unsplit", mint, amount: -amount },
      { bucket: "basket", mint, amount: r.basket },
      { bucket: "treasury", mint, amount: r.platform },
      { bucket: "creator", mint, amount: r.creator },
    ],
  });
}
```

`src/keeper/steps/payout.ts`:

```ts
import type { KeeperDeps } from "../deps";
import type { LaunchRow } from "../launch-row";
import type { VersionedSettings } from "../../domain/settings";
import { getBalance, type DeltaResolver } from "../../ledger/ledger";
import { runTxStep } from "../../ledger/run-step";

export const payoutResolver: DeltaResolver = async (row) =>
  [{ bucket: row.detail.bucket, mint: row.detail.mint, amount: -BigInt(row.detail.amount) }];

export async function payoutStep(deps: KeeperDeps, launch: LaunchRow, s: VersionedSettings, runId: string) {
  const mint = launch.quoteMint;
  const targets = [
    { bucket: "treasury" as const, to: deps.wallets.treasury, min: 1n },
    { bucket: "creator" as const, to: launch.creator, min: s.creatorPayoutMin[mint] ?? 1n },
  ];
  for (const t of targets) {
    const amount = await getBalance(deps.sql, launch.id, t.bucket, mint);
    if (amount === 0n || amount < t.min) continue;
    await runTxStep(deps.sql, deps.chain, {
      launchId: launch.id, idemKey: `payout:${launch.id}:${runId}:${t.bucket}`, kind: "payout", settingsVersion: s.version,
      detail: { bucket: t.bucket, mint, amount: amount.toString(), to: t.to },
      build: () => deps.chain.buildTransfer(mint, t.to, amount),
      resolve: payoutResolver,
    });
  }
}
```

`src/keeper/resolvers.ts` (Tasks 12-15 add their kinds):

```ts
import type { KeeperDeps } from "./deps";
import type { DeltaResolver, StepKind } from "../ledger/ledger";
import { claimResolver } from "./steps/claim";
import { payoutResolver } from "./steps/payout";

const none: DeltaResolver = async () => [];

export function makeResolvers(deps: KeeperDeps): Record<StepKind, DeltaResolver> {
  return {
    claim: claimResolver(deps), payout: payoutResolver, split: none,
    swap: none, fund: none, collect_penalty: none, burn: none, migrate: none, create_farm: none, configure_farm: none,
  };
}
```

- [ ] **Step 5: Run tests**

Run: `bun test tests/keeper`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/keeper tests/keeper tests/helpers/keeper-deps.ts && git commit -m "Add keeper claim, split and payout steps"
```

---

### Task 12: Jupiter port and swap step

**Files:**
- Create: `src/jupiter/port.ts`, `src/keeper/steps/swap.ts`
- Modify: `src/keeper/deps.ts` (add `jupiter: JupiterPort`), `src/keeper/resolvers.ts` (add `swap`)
- Test: `tests/jupiter/port.test.ts`, `tests/keeper/swap.test.ts`, `tests/helpers/fake-jupiter.ts`

**Interfaces:**
- Produces:
  - `interface SwapQuote { inAmount: bigint; outAmount: bigint; priceImpactBps: number; raw: unknown }`
  - `interface JupiterPort { quote(inputMint: string, outputMint: string, amount: bigint, slippageBps: number): Promise<SwapQuote | null>; buildSwap(q: SwapQuote): Promise<SignedTx>; isVerified(mint: string): Promise<boolean> }`
  - `class JupiterLive implements JupiterPort { constructor(baseUrl: string, chain: SolanaChain) }`
  - `swapStep(deps, launch, settings, runId): Promise<void>`

- [ ] **Step 1: Failing tests**

`tests/jupiter/port.test.ts`:

```ts
import { test, expect } from "bun:test";
import { JupiterLive } from "../../src/jupiter/port";

test("quote returns null when Jupiter has no route", async () => {
  const j = new JupiterLive("https://jup.test", {} as any, async () => new Response(JSON.stringify({ error: "No routes found" }), { status: 400 }));
  expect(await j.quote("a", "b", 100n, 100)).toBeNull();
});

test("quote parses amounts and price impact", async () => {
  const body = { inAmount: "100", outAmount: "250", priceImpactPct: "0.0123" };
  const j = new JupiterLive("https://jup.test", {} as any, async (url) => {
    expect(String(url)).toContain("slippageBps=100");
    return new Response(JSON.stringify(body));
  });
  expect(await j.quote("a", "b", 100n, 100)).toMatchObject({ inAmount: 100n, outAmount: 250n, priceImpactBps: 123 });
});

test("isVerified reads the verified tag", async () => {
  const j = new JupiterLive("https://jup.test", {} as any, async () => new Response(JSON.stringify([{ id: "m", tags: ["verified"] }])));
  expect(await j.isVerified("m")).toBe(true);
});
```

`tests/helpers/fake-jupiter.ts`:

```ts
import type { JupiterPort, SwapQuote } from "../../src/jupiter/port";
import type { FakeChain } from "./fake-chain";

export class FakeJupiter implements JupiterPort {
  rates = new Map<string, number>();
  impactBps = new Map<string, number>();
  constructor(private chain: FakeChain) {}
  async quote(input: string, output: string, amount: bigint): Promise<SwapQuote | null> {
    const rate = this.rates.get(output);
    if (rate === undefined) return null;
    return { inAmount: amount, outAmount: BigInt(Math.floor(Number(amount) * rate)), priceImpactBps: this.impactBps.get(output) ?? 5, raw: { input, output } };
  }
  async buildSwap(q: SwapQuote) {
    const t = this.chain.tx("swap");
    this.chain.receipts.set(t.signature, q.outAmount);
    return t;
  }
  async isVerified() { return true; }
}
```

`tests/keeper/swap.test.ts`:

```ts
import { test, expect } from "bun:test";
import { keeperFixture } from "../helpers/keeper-deps";
import { insertLaunch } from "../helpers/fixtures";
import { FakeJupiter } from "../helpers/fake-jupiter";
import { loadLaunches } from "../../src/keeper/launch-row";
import { swapStep } from "../../src/keeper/steps/swap";
import { beginStep, confirmStep, getBalance } from "../../src/ledger/ledger";
import { NATIVE_MINT } from "../../src/domain/types";

async function seed(sql: any, launchId: number, amount: bigint) {
  const r = await beginStep(sql, { launchId, idemKey: `seed:${launchId}`, kind: "split", settingsVersion: 1, detail: {} });
  await confirmStep(sql, r, [{ bucket: "basket", mint: NATIVE_MINT, amount }]);
}

test("swaps the basket share by weight and credits measured output", async () => {
  const f = await keeperFixture();
  const jupiter = new FakeJupiter(f.chain);
  jupiter.rates.set("ZEC", 2).set("CATE", 3);
  const deps = { ...f.deps, jupiter };
  const id = await insertLaunch(f.sql);
  await f.sql`insert into baskets values (${id}, 'ZEC', 7000), (${id}, 'CATE', 3000)`;
  await seed(f.sql, id, 1_000n);
  const [launch] = await loadLaunches(f.sql, deps.ourtokenMint);
  await swapStep(deps, launch!, f.settings, "r1");
  expect(await getBalance(f.sql, id, "basket", NATIVE_MINT)).toBe(0n);
  expect(await getBalance(f.sql, id, "reward", "ZEC")).toBe(1_400n);
  expect(await getBalance(f.sql, id, "reward", "CATE")).toBe(900n);
});

test("no route or too much price impact leaves that token's share in escrow, others still swap", async () => {
  const f = await keeperFixture();
  const jupiter = new FakeJupiter(f.chain);
  jupiter.rates.set("ZEC", 2).set("CATE", 3);
  jupiter.impactBps.set("CATE", 500);
  const deps = { ...f.deps, jupiter };
  const id = await insertLaunch(f.sql);
  await f.sql`insert into baskets values (${id}, 'ZEC', 5000), (${id}, 'CATE', 3000), (${id}, 'ANSEM', 2000)`;
  await seed(f.sql, id, 1_000n);
  const [launch] = await loadLaunches(f.sql, deps.ourtokenMint);
  await swapStep(deps, launch!, f.settings, "r1");
  expect(await getBalance(f.sql, id, "reward", "ZEC")).toBe(1_000n);
  expect(await getBalance(f.sql, id, "basket", NATIVE_MINT)).toBe(500n);
});

test("a basket token equal to the quote token moves without a swap", async () => {
  const f = await keeperFixture();
  const jupiter = new FakeJupiter(f.chain);
  const deps = { ...f.deps, jupiter };
  const id = await insertLaunch(f.sql);
  await f.sql`insert into baskets values (${id}, ${NATIVE_MINT}, 10000)`;
  await seed(f.sql, id, 1_000n);
  const [launch] = await loadLaunches(f.sql, deps.ourtokenMint);
  await swapStep(deps, launch!, f.settings, "r1");
  expect(await getBalance(f.sql, id, "reward", NATIVE_MINT)).toBe(1_000n);
  expect(f.chain.sent.length).toBe(0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/jupiter tests/keeper/swap.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/jupiter/port.ts`:

```ts
import { VersionedTransaction } from "@solana/web3.js";
import type { SignedTx } from "../chain/port";
import type { SolanaChain } from "../chain/solana";

export interface SwapQuote { inAmount: bigint; outAmount: bigint; priceImpactBps: number; raw: unknown }
export interface JupiterPort {
  quote(inputMint: string, outputMint: string, amount: bigint, slippageBps: number): Promise<SwapQuote | null>;
  buildSwap(q: SwapQuote): Promise<SignedTx>;
  isVerified(mint: string): Promise<boolean>;
}

type Fetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

export class JupiterLive implements JupiterPort {
  constructor(private baseUrl: string, private chain: SolanaChain, private fetchFn: Fetch = fetch) {}

  async quote(inputMint: string, outputMint: string, amount: bigint, slippageBps: number): Promise<SwapQuote | null> {
    const url = new URL(`${this.baseUrl}/quote`);
    url.search = new URLSearchParams({ inputMint, outputMint, amount: amount.toString(), slippageBps: String(slippageBps), restrictIntermediateTokens: "true" }).toString();
    const res = await this.fetchFn(url);
    if (!res.ok) return null;
    const q = await res.json() as { inAmount: string; outAmount: string; priceImpactPct: string };
    return { inAmount: BigInt(q.inAmount), outAmount: BigInt(q.outAmount), priceImpactBps: Math.round(Number(q.priceImpactPct) * 10_000), raw: q };
  }

  async buildSwap(q: SwapQuote): Promise<SignedTx> {
    const res = await this.fetchFn(`${this.baseUrl}/swap`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ quoteResponse: q.raw, userPublicKey: this.chain.keeper.publicKey.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }),
    });
    if (!res.ok) throw new Error(`jupiter swap build failed: ${res.status}`);
    const { swapTransaction, lastValidBlockHeight } = await res.json() as { swapTransaction: string; lastValidBlockHeight: number };
    const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
    return this.chain.signVersioned(tx, [], BigInt(lastValidBlockHeight));
  }

  async isVerified(mint: string): Promise<boolean> {
    const res = await this.fetchFn(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`);
    if (!res.ok) return false;
    const list = await res.json() as { id: string; tags?: string[]; isVerified?: boolean }[];
    const t = list.find((x) => x.id === mint);
    return !!t && (t.isVerified === true || (t.tags ?? []).includes("verified"));
  }
}
```

`src/keeper/steps/swap.ts`:

```ts
import type { KeeperDeps } from "../deps";
import type { LaunchRow } from "../launch-row";
import type { VersionedSettings } from "../../domain/settings";
import { getBalance, type DeltaResolver } from "../../ledger/ledger";
import { runDbStep, runTxStep } from "../../ledger/run-step";
import { splitByWeights } from "../../domain/weights";

export const swapResolver = (deps: KeeperDeps): DeltaResolver => async (row, sig) => [
  { bucket: "basket", mint: row.detail.inputMint, amount: -BigInt(row.detail.amountIn) },
  { bucket: "reward", mint: row.detail.outputMint, amount: await deps.chain.received(sig, deps.wallets.keeper, row.detail.outputMint) },
];

export async function swapStep(deps: KeeperDeps, launch: LaunchRow, s: VersionedSettings, runId: string) {
  const input = launch.quoteMint;
  const total = await getBalance(deps.sql, launch.id, "basket", input);
  if (total === 0n) return;
  const basket = await deps.sql`select reward_mint, weight_bps from baskets where launch_id = ${launch.id} order by reward_mint`;
  const shares = splitByWeights(total, basket.map((b: any) => ({ key: b.reward_mint as string, weight: BigInt(b.weight_bps) })));
  for (const [outputMint, amountIn] of shares) {
    if (amountIn === 0n) continue;
    const idemKey = `swap:${launch.id}:${runId}:${outputMint}`;
    if (outputMint === input) {
      await runDbStep(deps.sql, {
        launchId: launch.id, idemKey, kind: "swap", settingsVersion: s.version, detail: { direct: true },
        deltas: [{ bucket: "basket", mint: input, amount: -amountIn }, { bucket: "reward", mint: input, amount: amountIn }],
      });
      continue;
    }
    const q = await deps.jupiter.quote(input, outputMint, amountIn, s.slippageBps);
    if (!q || q.priceImpactBps > s.slippageBps) continue;
    try {
      await runTxStep(deps.sql, deps.chain, {
        launchId: launch.id, idemKey, kind: "swap", settingsVersion: s.version,
        detail: { inputMint: input, outputMint, amountIn: amountIn.toString(), quotedOut: q.outAmount.toString() },
        build: () => deps.jupiter.buildSwap(q),
        resolve: swapResolver(deps),
      });
    } catch (e) {
      console.error(`swap ${idemKey} failed to build`, e);
    }
  }
}
```

Add `jupiter: JupiterPort` to `KeeperDeps` and `swap: swapResolver(deps)` to `makeResolvers`.

- [ ] **Step 4: Run tests**

Run: `bun test tests/jupiter tests/keeper`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/jupiter src/keeper tests/jupiter tests/keeper tests/helpers/fake-jupiter.ts && git commit -m "Add Jupiter port and basket swap step"
```

---

### Task 13: Staking adapter, Kamino backend, farm creation and funding

**Files:**
- Create: `src/staking/adapter.ts`, `src/staking/kamino.ts`, `src/keeper/steps/farms.ts`, `src/keeper/steps/fund.ts`, `scripts/create-kamino-global-config.ts`
- Modify: `src/keeper/deps.ts` (add `staking: StakingAdapter`), `src/keeper/resolvers.ts` (add `fund`)
- Test: `tests/staking/kamino.test.ts` (validator with Kamino cloned; skipped otherwise), `tests/keeper/farms-fund.test.ts`, `tests/helpers/fake-staking.ts`

**Interfaces:**
- Consumes: `SolanaChain`, `kitSigner`, `fromKitInstruction` (Task 7), `kaminoRawRps`, `allocateAcrossTiers` (Task 4), `LockTier`.
- Produces:

```ts
export interface StakingAdapter {
  readonly backend: "kamino";
  capabilities(): { earlyExit: boolean; tiersOnChain: boolean };
  buildCreateFarm(stakeMint: string, farmSecret: Uint8Array): Promise<SignedTx>;
  buildConfigureFarm(i: { farm: string; stakeMint: string; lockSeconds: number; maxPenaltyBps: number; spillAccount: string; rewardMints: string[] }): Promise<SignedTx>;
  farmExists(farm: string): Promise<boolean>;
  totalStaked(farm: string): Promise<bigint>;
  rewardState(farm: string, rewardMint: string): Promise<{ available: bigint; rpsDecimals: number; decimals: number }>;
  buildFund(i: { farm: string; rewardMint: string; amount: bigint; rawRps: bigint; decimals: number }): Promise<SignedTx>;
  slashedAmount(farm: string): Promise<bigint>;
  buildCollectPenalty(farm: string, spillAccount: string): Promise<SignedTx>;
}
export class KaminoBackend implements StakingAdapter { constructor(chain: SolanaChain, rpcUrl: string, globalConfig: string) }
export async function createFarmsStep(deps, launch, settings, runId): Promise<"ready" | "pending">
export async function fundStep(deps, launch, settings, runId): Promise<void>
```

- [ ] **Step 1: Failing tests**

`tests/helpers/fake-staking.ts`:

```ts
import type { StakingAdapter } from "../../src/staking/adapter";
import type { FakeChain } from "./fake-chain";

export class FakeStaking implements StakingAdapter {
  readonly backend = "kamino" as const;
  farms = new Set<string>();
  staked = new Map<string, bigint>();
  available = new Map<string, bigint>();
  slashed = new Map<string, bigint>();
  funded: { farm: string; rewardMint: string; amount: bigint; rawRps: bigint }[] = [];
  constructor(private chain: FakeChain) {}
  capabilities() { return { earlyExit: true, tiersOnChain: false }; }
  async buildCreateFarm() { return this.chain.tx("create_farm"); }
  async buildConfigureFarm(i: { farm: string }) { this.farms.add(i.farm); return this.chain.tx("configure_farm"); }
  async farmExists(farm: string) { return this.farms.has(farm); }
  async totalStaked(farm: string) { return this.staked.get(farm) ?? 0n; }
  async rewardState(farm: string, mint: string) { return { available: this.available.get(`${farm}:${mint}`) ?? 0n, rpsDecimals: 0, decimals: 6 }; }
  async buildFund(i: { farm: string; rewardMint: string; amount: bigint; rawRps: bigint }) { this.funded.push(i); return this.chain.tx("fund"); }
  async slashedAmount(farm: string) { return this.slashed.get(farm) ?? 0n; }
  async buildCollectPenalty() { return this.chain.tx("collect"); }
}
```

`tests/keeper/farms-fund.test.ts`:

```ts
import { test, expect } from "bun:test";
import { keeperFixture } from "../helpers/keeper-deps";
import { insertLaunch } from "../helpers/fixtures";
import { FakeStaking } from "../helpers/fake-staking";
import { loadLaunches } from "../../src/keeper/launch-row";
import { createFarmsStep } from "../../src/keeper/steps/farms";
import { fundStep } from "../../src/keeper/steps/fund";
import { beginStep, confirmStep, getBalance } from "../../src/ledger/ledger";

async function pendingPool(sql: any, id: number) {
  await sql`insert into baskets values (${id}, 'ZEC', 10000)`;
  await sql`insert into stake_pools values (${id}, 'kamino', 3000, 'SpillAta', 'pending')`;
  await sql`insert into stake_tiers (launch_id, tier_id, lock_seconds, multiplier_bps) values
    (${id}, '7d', 604800, 10000), (${id}, '180d', 15552000, 30000)`;
}

test("creates and configures one farm per tier, then marks the pool ready", async () => {
  const f = await keeperFixture();
  const staking = new FakeStaking(f.chain);
  const deps = { ...f.deps, staking };
  const id = await insertLaunch(f.sql);
  await pendingPool(f.sql, id);
  const [launch] = await loadLaunches(f.sql, deps.ourtokenMint);
  expect(await createFarmsStep(deps, launch!, f.settings, "r1")).toBe("ready");
  const tiers = await f.sql`select farm from stake_tiers where launch_id = ${id}`;
  expect(tiers.every((t: any) => t.farm)).toBe(true);
  const [p] = await f.sql`select status from stake_pools where launch_id = ${id}`;
  expect(p.status).toBe("ready");
  expect(await createFarmsStep(deps, launch!, f.settings, "r2")).toBe("ready");
  expect(f.chain.sent.filter((s) => s.startsWith("create_farm")).length).toBe(2);
});

test("a retried farm creation reuses the stored farm keypair", async () => {
  const f = await keeperFixture();
  const staking = new FakeStaking(f.chain);
  const deps = { ...f.deps, staking };
  const id = await insertLaunch(f.sql);
  await pendingPool(f.sql, id);
  const [launch] = await loadLaunches(f.sql, deps.ourtokenMint);
  f.chain.nextOutcome = "unknown";
  await createFarmsStep(deps, launch!, f.settings, "r1");
  const [a] = await f.sql`select detail->>'farm' as farm from distributions where kind = 'create_farm' order by id limit 1`;
  f.chain.height += 1_000n;
  f.chain.nextOutcome = "confirmed";
  await createFarmsStep(deps, launch!, f.settings, "r1");
  const [b] = await f.sql`select detail->>'farm' as farm from distributions where kind = 'create_farm' order by id limit 1`;
  expect(b.farm).toBe(a.farm);
});

test("fund allocates by stake times multiplier and sets rate over the period", async () => {
  const f = await keeperFixture();
  const staking = new FakeStaking(f.chain);
  const deps = { ...f.deps, staking };
  const id = await insertLaunch(f.sql);
  await pendingPool(f.sql, id);
  const [launch] = await loadLaunches(f.sql, deps.ourtokenMint);
  await createFarmsStep(deps, launch!, f.settings, "r1");
  const farms = await f.sql`select tier_id, farm from stake_tiers where launch_id = ${id} order by lock_seconds`;
  staking.staked.set(farms[0].farm, 100n).set(farms[1].farm, 100n);
  staking.available.set(`${farms[1].farm}:ZEC`, 86_400n);
  const r = await beginStep(f.sql, { launchId: id, idemKey: "seed", kind: "swap", settingsVersion: 1, detail: {} });
  await confirmStep(f.sql, r, [{ bucket: "reward", mint: "ZEC", amount: 86_400n * 4n }]);
  await fundStep(deps, launch!, f.settings, "r1");
  expect(await getBalance(f.sql, id, "reward", "ZEC")).toBe(0n);
  const byFarm = Object.fromEntries(staking.funded.map((x) => [x.farm, x]));
  expect(byFarm[farms[0].farm]!.amount).toBe(86_400n);
  expect(byFarm[farms[1].farm]!.amount).toBe(259_200n);
  expect(byFarm[farms[1].farm]!.rawRps).toBe(4n);
});

test("fund holds rewards in escrow when nobody has staked", async () => {
  const f = await keeperFixture();
  const staking = new FakeStaking(f.chain);
  const deps = { ...f.deps, staking };
  const id = await insertLaunch(f.sql);
  await pendingPool(f.sql, id);
  const [launch] = await loadLaunches(f.sql, deps.ourtokenMint);
  await createFarmsStep(deps, launch!, f.settings, "r1");
  const r = await beginStep(f.sql, { launchId: id, idemKey: "seed", kind: "swap", settingsVersion: 1, detail: {} });
  await confirmStep(f.sql, r, [{ bucket: "reward", mint: "ZEC", amount: 1_000n }]);
  await fundStep(deps, launch!, f.settings, "r1");
  expect(staking.funded.length).toBe(0);
  expect(await getBalance(f.sql, id, "reward", "ZEC")).toBe(1_000n);
});

test("fund does nothing while the stake pool is pending", async () => {
  const f = await keeperFixture();
  const staking = new FakeStaking(f.chain);
  const deps = { ...f.deps, staking };
  const id = await insertLaunch(f.sql);
  await pendingPool(f.sql, id);
  const [launch] = await loadLaunches(f.sql, deps.ourtokenMint);
  const r = await beginStep(f.sql, { launchId: id, idemKey: "seed", kind: "swap", settingsVersion: 1, detail: {} });
  await confirmStep(f.sql, r, [{ bucket: "reward", mint: "ZEC", amount: 1_000n }]);
  await fundStep(deps, launch!, f.settings, "r1");
  expect(staking.funded.length).toBe(0);
});
```

`tests/staking/kamino.test.ts` (needs the Kamino program cloned on the local validator, as in Task 1):

```ts
import { test, expect, beforeAll } from "bun:test";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import { Farms, GlobalConfigOption } from "@kamino-finance/farms-sdk";
import { address, createSolanaRpc, none } from "@solana/kit";
import Decimal from "decimal.js";
import { SolanaChain, fromKitInstruction, kitSigner } from "../../src/chain/solana";
import { KaminoBackend } from "../../src/staking/kamino";
import { kaminoRawRps } from "../../src/domain/rate";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const conn = new Connection(RPC, "confirmed");
let up = true;
beforeAll(async () => {
  try { up = (await conn.getAccountInfo(new PublicKey("FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr"))) !== null; } catch { up = false; }
});

test.skipIf(!up)("create, configure, fund, early exit, collect penalty", async () => {
  const keeper = Keypair.generate(), spill = Keypair.generate(), user = Keypair.generate();
  for (const k of [keeper, spill, user]) await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 10 * LAMPORTS_PER_SOL));
  const chain = new SolanaChain(conn, keeper, spill);
  const farms = new Farms(createSolanaRpc(RPC));
  const gc = Keypair.generate();
  await sendAndConfirmTransaction(conn, new Transaction().add(...(await farms.createGlobalConfigIxs(kitSigner(keeper), kitSigner(gc))).map(fromKitInstruction)), [keeper, gc]);
  await sendAndConfirmTransaction(conn, new Transaction().add(fromKitInstruction(await farms.updateGlobalConfigIx(kitSigner(keeper), address(gc.publicKey.toBase58()), GlobalConfigOption.SetTreasuryFeeBps, "0", "number"))), [keeper]);
  const kamino = new KaminoBackend(chain, RPC, gc.publicKey.toBase58());

  const stakeMint = await createMint(conn, keeper, keeper.publicKey, null, 6);
  const rewards = await Promise.all([6, 9, 6].map((d) => createMint(conn, keeper, keeper.publicKey, null, d)));
  const farm = Keypair.generate();
  const spillAccount = getAssociatedTokenAddressSync(stakeMint, spill.publicKey).toBase58();

  const run = async (t: Promise<{ send(): Promise<void>; signature: string; lastValidBlockHeight: bigint }>) => {
    const tx = await t; await tx.send();
    expect(await chain.waitForConfirmation(tx.signature, tx.lastValidBlockHeight)).toBe("confirmed");
  };
  await run(kamino.buildCreateFarm(stakeMint.toBase58(), farm.secretKey));
  expect(await kamino.farmExists(farm.publicKey.toBase58())).toBe(true);
  await run(kamino.buildConfigureFarm({
    farm: farm.publicKey.toBase58(), stakeMint: stakeMint.toBase58(), lockSeconds: 60, maxPenaltyBps: 3000,
    spillAccount, rewardMints: rewards.map((m) => m.toBase58()),
  }));

  const ata = await getOrCreateAssociatedTokenAccount(conn, keeper, stakeMint, user.publicKey);
  await mintTo(conn, keeper, stakeMint, ata.address, keeper, 100_000_000n);
  const f = address(farm.publicKey.toBase58());
  await sendAndConfirmTransaction(conn, new Transaction().add(fromKitInstruction(await farms.createNewUserIx(kitSigner(user), f))), [user]);
  await sendAndConfirmTransaction(conn, new Transaction().add(fromKitInstruction(await farms.stakeIx(kitSigner(user), f, new Decimal(100_000_000), address(stakeMint.toBase58()), none()))), [user]);
  expect(await kamino.totalStaked(farm.publicKey.toBase58())).toBe(100_000_000n);

  const keeperReward = await getOrCreateAssociatedTokenAccount(conn, keeper, rewards[0]!, keeper.publicKey);
  await mintTo(conn, keeper, rewards[0]!, keeperReward.address, keeper, 1_000_000n);
  const rs = await kamino.rewardState(farm.publicKey.toBase58(), rewards[0]!.toBase58());
  await run(kamino.buildFund({
    farm: farm.publicKey.toBase58(), rewardMint: rewards[0]!.toBase58(), amount: 1_000_000n,
    rawRps: kaminoRawRps(rs.available + 1_000_000n, 3_600, rs.rpsDecimals), decimals: rs.decimals,
  }));
  expect((await kamino.rewardState(farm.publicKey.toBase58(), rewards[0]!.toBase58())).available).toBe(1_000_000n);

  await sendAndConfirmTransaction(conn, new Transaction().add(fromKitInstruction(await farms.unstakeIx(kitSigner(user), f, new Decimal(100_000_000), none()))), [user]);
  const slashed = await kamino.slashedAmount(farm.publicKey.toBase58());
  expect(slashed).toBeGreaterThan(0n);
  await run(kamino.buildCollectPenalty(farm.publicKey.toBase58(), spillAccount));
  expect((await getAccount(conn, new PublicKey(spillAccount))).amount).toBe(slashed);
});
```

The `stakeIx` amount argument follows whatever unit the Task 1 spike found (base units or UI units); adjust the `Decimal` here if the spike says otherwise.

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/keeper/farms-fund.test.ts tests/staking`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/staking/adapter.ts`: the `StakingAdapter` interface exactly as in the Interfaces block above, importing `SignedTx` from `../chain/port`.

`src/staking/kamino.ts`:

```ts
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Farms, FarmConfigOption, getWithdrawSlashedAmountInstruction } from "@kamino-finance/farms-sdk";
import { address, createSolanaRpc } from "@solana/kit";
import Decimal from "decimal.js";
import type { StakingAdapter } from "./adapter";
import { fromKitInstruction, kitSigner, type SolanaChain } from "../chain/solana";

const TOKEN_PROGRAM = address(TOKEN_PROGRAM_ID.toBase58());

export class KaminoBackend implements StakingAdapter {
  readonly backend = "kamino" as const;
  private farms: Farms;
  constructor(private chain: SolanaChain, rpcUrl: string, private globalConfig: string) {
    this.farms = new Farms(createSolanaRpc(rpcUrl));
  }

  capabilities() { return { earlyExit: true, tiersOnChain: false }; }

  private async state(farm: string) {
    const [f] = await this.farms.getAllFarmStatesByPubkeys([address(farm)]);
    if (!f) throw new Error(`farm ${farm} not found`);
    return f.farmState;
  }

  async buildCreateFarm(stakeMint: string, farmSecret: Uint8Array) {
    const farm = Keypair.fromSecretKey(farmSecret);
    const ixs = await this.farms.createFarmIxs(kitSigner(this.chain.keeper), kitSigner(farm), address(this.globalConfig), address(stakeMint));
    return this.chain.signLegacy(new Transaction().add(...ixs.map(fromKitInstruction)), [farm]);
  }

  async buildConfigureFarm(i: { farm: string; stakeMint: string; lockSeconds: number; maxPenaltyBps: number; spillAccount: string; rewardMints: string[] }) {
    const admin = kitSigner(this.chain.keeper);
    const farm = address(i.farm);
    const first = address(i.rewardMints[0]!);
    const spillOwner = this.chain.spill.publicKey;
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(this.chain.keeper.publicKey, new PublicKey(i.spillAccount), spillOwner, new PublicKey(i.stakeMint)),
    );
    for (const m of i.rewardMints) tx.add(fromKitInstruction(await this.farms.addRewardToFarmIx(admin, address(this.globalConfig), farm, address(m), TOKEN_PROGRAM)));
    const cfg = async (mode: FarmConfigOption, value: number | bigint | ReturnType<typeof address>) =>
      fromKitInstruction(await this.farms.updateFarmConfigIx(admin, farm, first, mode, value, -1, undefined, true));
    tx.add(
      await cfg(FarmConfigOption.LockingMode, 1),
      await cfg(FarmConfigOption.LockingDuration, i.lockSeconds),
      await cfg(FarmConfigOption.LockingEarlyWithdrawalPenaltyBps, i.maxPenaltyBps),
      await cfg(FarmConfigOption.WithdrawCooldownPeriod, 0),
      await cfg(FarmConfigOption.SlashedAmountSpillAddress, address(i.spillAccount)),
    );
    return this.chain.signLegacy(tx, []);
  }

  async farmExists(farm: string) {
    return (await this.chain.conn.getAccountInfo(new PublicKey(farm), "confirmed")) !== null;
  }

  async totalStaked(farm: string) { return (await this.state(farm)).totalStakedAmount; }

  async rewardState(farm: string, rewardMint: string) {
    const r = (await this.state(farm)).rewardInfos.find((x) => x.token.mint === rewardMint);
    if (!r) throw new Error(`reward ${rewardMint} not on farm ${farm}`);
    return { available: r.rewardsAvailable, rpsDecimals: r.rewardsPerSecondDecimals, decimals: Number(r.token.decimals) };
  }

  async buildFund(i: { farm: string; rewardMint: string; amount: bigint; rawRps: bigint; decimals: number }) {
    const admin = kitSigner(this.chain.keeper);
    const ui = new Decimal(i.amount.toString()).div(new Decimal(10).pow(i.decimals));
    const topUp = await this.farms.addRewardAmountToFarmIx(admin, address(i.farm), address(i.rewardMint), ui);
    const rate = await this.farms.updateFarmConfigIx(admin, address(i.farm), address(i.rewardMint), FarmConfigOption.UpdateRewardRps, i.rawRps);
    return this.chain.signLegacy(new Transaction().add(fromKitInstruction(topUp), fromKitInstruction(rate)), []);
  }

  async slashedAmount(farm: string) { return (await this.state(farm)).slashedAmountCurrent; }

  async buildCollectPenalty(farm: string, spillAccount: string) {
    const s = await this.state(farm);
    const ix = getWithdrawSlashedAmountInstruction({
      crank: kitSigner(this.chain.keeper), farmState: address(farm), slashedAmountSpillAddress: address(spillAccount),
      farmVault: s.farmVault, farmVaultsAuthority: s.farmVaultsAuthority, tokenProgram: TOKEN_PROGRAM,
    });
    return this.chain.signLegacy(new Transaction().add(fromKitInstruction(ix)), []);
  }
}
```

If the Task 1 spike showed a different ordering requirement (for example reward mints must be added before locking config) or that `updateFarmConfigIx`'s `newFarm` flag must be `false`, follow the spike doc.

`src/keeper/steps/farms.ts`:

```ts
import { Keypair } from "@solana/web3.js";
import type { KeeperDeps } from "../deps";
import type { LaunchRow } from "../launch-row";
import type { VersionedSettings } from "../../domain/settings";
import { beginStep } from "../../ledger/ledger";
import { runTxStep } from "../../ledger/run-step";

export async function createFarmsStep(deps: KeeperDeps, launch: LaunchRow, s: VersionedSettings, runId: string): Promise<"ready" | "pending"> {
  const [pool] = await deps.sql`select * from stake_pools where launch_id = ${launch.id}`;
  if (!pool) return "pending";
  if (pool.status === "ready") return "ready";
  const tiers = await deps.sql`select * from stake_tiers where launch_id = ${launch.id} order by lock_seconds`;
  const rewardMints = (await deps.sql`select reward_mint from baskets where launch_id = ${launch.id} order by reward_mint`).map((r: any) => r.reward_mint);
  let allDone = true;
  for (const t of tiers) {
    if (t.farm) continue;
    const idemKey = `create_farm:${launch.id}:${t.tier_id}`;
    const kp = Keypair.generate();
    const row = await beginStep(deps.sql, {
      launchId: launch.id, idemKey, kind: "create_farm", settingsVersion: s.version,
      detail: { farm: kp.publicKey.toBase58(), secret: Array.from(kp.secretKey), tier: t.tier_id },
    });
    const farm = row.detail.farm as string;
    const secret = Uint8Array.from(row.detail.secret as number[]);
    const created = row.status === "confirmed" || (await deps.staking.farmExists(farm))
      ? "confirmed"
      : await runTxStep(deps.sql, deps.chain, {
          launchId: launch.id, idemKey, kind: "create_farm", settingsVersion: s.version, detail: row.detail,
          build: () => deps.staking.buildCreateFarm(launch.mint, secret), resolve: async () => [],
        });
    if (created !== "confirmed") { allDone = false; continue; }
    const configured = await runTxStep(deps.sql, deps.chain, {
      launchId: launch.id, idemKey: `configure_farm:${launch.id}:${t.tier_id}`, kind: "configure_farm", settingsVersion: s.version,
      detail: { farm },
      build: () => deps.staking.buildConfigureFarm({
        farm, stakeMint: launch.mint, lockSeconds: t.lock_seconds, maxPenaltyBps: pool.max_penalty_bps,
        spillAccount: pool.spill_account, rewardMints,
      }),
      resolve: async () => [],
    });
    if (configured !== "confirmed") { allDone = false; continue; }
    await deps.sql`update stake_tiers set farm = ${farm} where launch_id = ${launch.id} and tier_id = ${t.tier_id}`;
  }
  if (!allDone) return "pending";
  await deps.sql`update stake_pools set status = 'ready' where launch_id = ${launch.id}`;
  return "ready";
}
```

Farm creation idem keys have no run id, so each tier's farm is created once per launch. The farm keypair is stored in the step row before sending, which lets a retry after an expired blockhash reuse the same address. The secret only authorises creating that one account.

`src/keeper/steps/fund.ts`:

```ts
import type { KeeperDeps } from "../deps";
import type { LaunchRow } from "../launch-row";
import type { VersionedSettings } from "../../domain/settings";
import { getBalance, type DeltaResolver } from "../../ledger/ledger";
import { runTxStep } from "../../ledger/run-step";
import { allocateAcrossTiers } from "../../domain/weights";
import { kaminoRawRps } from "../../domain/rate";

export const fundResolver: DeltaResolver = async (row) => [{ bucket: "reward", mint: row.detail.rewardMint, amount: -BigInt(row.detail.amount) }];

export async function fundStep(deps: KeeperDeps, launch: LaunchRow, s: VersionedSettings, runId: string) {
  const [pool] = await deps.sql`select status from stake_pools where launch_id = ${launch.id}`;
  if (pool?.status !== "ready") return;
  const tiers = await deps.sql`select tier_id, farm, multiplier_bps from stake_tiers where launch_id = ${launch.id} order by lock_seconds`;
  const staked = await Promise.all(tiers.map(async (t: any) => ({ tierId: t.tier_id as string, farm: t.farm as string, staked: await deps.staking.totalStaked(t.farm), multiplierBps: t.multiplier_bps as number })));
  const mints = (await deps.sql`select reward_mint from baskets where launch_id = ${launch.id} order by reward_mint`).map((r: any) => r.reward_mint as string);
  for (const mint of mints) {
    const total = await getBalance(deps.sql, launch.id, "reward", mint);
    if (total === 0n) continue;
    const alloc = allocateAcrossTiers(total, staked);
    for (const [tierId, amount] of alloc) {
      if (amount === 0n) continue;
      const farm = staked.find((t) => t.tierId === tierId)!.farm;
      const rs = await deps.staking.rewardState(farm, mint);
      const rawRps = kaminoRawRps(rs.available + amount, s.rewardPeriodSeconds, rs.rpsDecimals);
      await runTxStep(deps.sql, deps.chain, {
        launchId: launch.id, idemKey: `fund:${launch.id}:${runId}:${tierId}:${mint}`, kind: "fund", settingsVersion: s.version,
        detail: { farm, rewardMint: mint, amount: amount.toString(), rawRps: rawRps.toString() },
        build: () => deps.staking.buildFund({ farm, rewardMint: mint, amount, rawRps, decimals: rs.decimals }),
        resolve: fundResolver,
      });
    }
  }
}
```

Add `staking: StakingAdapter` to `KeeperDeps` and `fund: fundResolver` to `makeResolvers`.

`scripts/create-kamino-global-config.ts`:

```ts
import { Connection, Keypair, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { Farms, GlobalConfigOption } from "@kamino-finance/farms-sdk";
import { address, createSolanaRpc } from "@solana/kit";
import { loadEnv } from "../src/env";
import { fromKitInstruction, kitSigner, loadKeypair } from "../src/chain/solana";

const env = loadEnv();
const conn = new Connection(env.RPC_URL, "confirmed");
const keeper = loadKeypair(env.KEEPER_KEYPAIR);
const farms = new Farms(createSolanaRpc(env.RPC_URL));
const globalConfig = Keypair.generate();
const create = await farms.createGlobalConfigIxs(kitSigner(keeper), kitSigner(globalConfig));
await sendAndConfirmTransaction(conn, new Transaction().add(...create.map(fromKitInstruction)), [keeper, globalConfig]);
const fee = await farms.updateGlobalConfigIx(kitSigner(keeper), address(globalConfig.publicKey.toBase58()), GlobalConfigOption.SetTreasuryFeeBps, "0", "number");
await sendAndConfirmTransaction(conn, new Transaction().add(fromKitInstruction(fee)), [keeper]);
console.log(globalConfig.publicKey.toBase58());
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/keeper tests/staking`
Expected: PASS (staking test skipped if the validator is not running with Kamino cloned)

- [ ] **Step 5: Commit**

```bash
git add src/staking src/keeper scripts/create-kamino-global-config.ts tests/staking tests/keeper tests/helpers/fake-staking.ts
git commit -m "Add Kamino staking backend, farm creation and reward funding"
```

---

### Task 14: Penalty collection and burn

**Files:**
- Create: `src/keeper/steps/penalty.ts`
- Modify: `src/keeper/resolvers.ts` (add `collect_penalty`, `burn`)
- Test: `tests/keeper/penalty.test.ts`

**Interfaces:**
- Produces: `penaltyStep(deps, launch, settings, runId): Promise<void>`, `collectResolver(deps)`, `burnResolver`.

- [ ] **Step 1: Failing test**

```ts
import { test, expect } from "bun:test";
import { keeperFixture } from "../helpers/keeper-deps";
import { insertLaunch } from "../helpers/fixtures";
import { FakeStaking } from "../helpers/fake-staking";
import { loadLaunches } from "../../src/keeper/launch-row";
import { penaltyStep } from "../../src/keeper/steps/penalty";
import { getBalance } from "../../src/ledger/ledger";

async function readyPool(sql: any, id: number) {
  await sql`insert into stake_pools values (${id}, 'kamino', 3000, 'SpillAta', 'ready')`;
  await sql`insert into stake_tiers values (${id}, '7d', 604800, 10000, 'FarmA'), (${id}, '30d', 2592000, 15000, 'FarmB')`;
}

test("collects slashed amounts from every farm and burns all of it", async () => {
  const f = await keeperFixture();
  const staking = new FakeStaking(f.chain);
  const deps = { ...f.deps, staking };
  const id = await insertLaunch(f.sql, { mint: "CAT" });
  await readyPool(f.sql, id);
  staking.slashed.set("FarmA", 300n).set("FarmB", 200n);
  const collected = [300n, 200n];
  const orig = f.chain.tx.bind(f.chain);
  f.chain.tx = (label) => {
    const t = orig(label);
    if (label === "collect") f.chain.receipts.set(t.signature, collected.shift()!);
    return t;
  };
  const [launch] = await loadLaunches(f.sql, deps.ourtokenMint);
  await penaltyStep(deps, launch!, f.settings, "r1");
  expect(f.chain.sent.filter((s) => s.startsWith("collect")).length).toBe(2);
  expect(f.chain.sent.filter((s) => s.startsWith("burn")).length).toBe(1);
  expect(await getBalance(f.sql, id, "penalty", "CAT")).toBe(0n);
  const [burn] = await f.sql`select detail->>'amount' as amount from distributions where kind = 'burn'`;
  expect(burn.amount).toBe("500");
});

test("no transactions when nothing was slashed", async () => {
  const f = await keeperFixture();
  const staking = new FakeStaking(f.chain);
  const deps = { ...f.deps, staking };
  const id = await insertLaunch(f.sql, { mint: "CAT" });
  await readyPool(f.sql, id);
  const [launch] = await loadLaunches(f.sql, deps.ourtokenMint);
  await penaltyStep(deps, launch!, f.settings, "r1");
  expect(f.chain.sent.length).toBe(0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/keeper/penalty.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import type { KeeperDeps } from "../deps";
import type { LaunchRow } from "../launch-row";
import type { VersionedSettings } from "../../domain/settings";
import { getBalance, type DeltaResolver } from "../../ledger/ledger";
import { runTxStep } from "../../ledger/run-step";

export const collectResolver = (deps: KeeperDeps): DeltaResolver => async (row, sig) =>
  [{ bucket: "penalty", mint: row.detail.mint, amount: await deps.chain.received(sig, deps.wallets.spill, row.detail.mint) }];

export const burnResolver: DeltaResolver = async (row) => [{ bucket: "penalty", mint: row.detail.mint, amount: -BigInt(row.detail.amount) }];

export async function penaltyStep(deps: KeeperDeps, launch: LaunchRow, s: VersionedSettings, runId: string) {
  const [pool] = await deps.sql`select status, spill_account from stake_pools where launch_id = ${launch.id}`;
  if (pool?.status !== "ready") return;
  const tiers = await deps.sql`select tier_id, farm from stake_tiers where launch_id = ${launch.id}`;
  for (const t of tiers) {
    if ((await deps.staking.slashedAmount(t.farm)) === 0n) continue;
    await runTxStep(deps.sql, deps.chain, {
      launchId: launch.id, idemKey: `collect_penalty:${launch.id}:${runId}:${t.tier_id}`, kind: "collect_penalty", settingsVersion: s.version,
      detail: { farm: t.farm, mint: launch.mint },
      build: () => deps.staking.buildCollectPenalty(t.farm, pool.spill_account),
      resolve: collectResolver(deps),
    });
  }
  const amount = await getBalance(deps.sql, launch.id, "penalty", launch.mint);
  if (amount === 0n) return;
  await runTxStep(deps.sql, deps.chain, {
    launchId: launch.id, idemKey: `burn:${launch.id}:${runId}`, kind: "burn", settingsVersion: s.version,
    detail: { mint: launch.mint, amount: amount.toString() },
    build: () => deps.chain.buildBurn(launch.mint, amount),
    resolve: burnResolver,
  });
}
```

Add `collect_penalty: collectResolver(deps)` and `burn: burnResolver` to `makeResolvers`.

- [ ] **Step 4: Run tests**

Run: `bun test tests/keeper`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/keeper tests/keeper/penalty.test.ts && git commit -m "Add penalty collection and burn step"
```

---

### Task 15: Graduation step

**Files:**
- Create: `src/keeper/steps/graduate.ts`
- Test: `tests/keeper/graduate.test.ts`

**Interfaces:**
- Produces: `graduateStep(deps, launch, settings, runId): Promise<LaunchRow>` (returns the launch with updated status and DAMM fields).

- [ ] **Step 1: Failing test**

```ts
import { test, expect } from "bun:test";
import { keeperFixture, OURS } from "../helpers/keeper-deps";
import { insertLaunch } from "../helpers/fixtures";
import { loadLaunches } from "../../src/keeper/launch-row";
import { graduateStep } from "../../src/keeper/steps/graduate";

test("OURTOKEN launch with a complete curve is migrated by the keeper", async () => {
  const f = await keeperFixture();
  await insertLaunch(f.sql, { mint: "CAT", pool: "P1", quote_mint: OURS });
  f.meteora.curve.set("P1", { migrated: false, complete: true });
  const [launch] = await loadLaunches(f.sql, OURS);
  await graduateStep(f.deps, launch!, f.settings, "r1");
  expect(f.chain.sent.some((s) => s.startsWith("migrate-P1"))).toBe(true);
});

test("SOL launch is never migrated by the keeper", async () => {
  const f = await keeperFixture();
  await insertLaunch(f.sql, { mint: "CAT", pool: "P2" });
  f.meteora.curve.set("P2", { migrated: false, complete: true });
  const [launch] = await loadLaunches(f.sql, OURS);
  await graduateStep(f.deps, launch!, f.settings, "r1");
  expect(f.chain.sent.length).toBe(0);
});

test("a migrated launch records its DAMM position and becomes graduated", async () => {
  const f = await keeperFixture();
  const id = await insertLaunch(f.sql, { mint: "CAT", pool: "P3" });
  f.meteora.curve.set("P3", { migrated: true, complete: true });
  f.meteora.graduated.set("CAT", { dammPool: "D3", position: "Pos3", positionNftAccount: "Nft3" });
  const [launch] = await loadLaunches(f.sql, OURS);
  const updated = await graduateStep(f.deps, launch!, f.settings, "r1");
  expect(updated.status).toBe("graduated");
  const [l] = await f.sql`select status, damm_pool, damm_position from launches where id = ${id}`;
  expect([l.status, l.damm_pool, l.damm_position]).toEqual(["graduated", "D3", "Pos3"]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/keeper/graduate.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import type { KeeperDeps } from "../deps";
import type { LaunchRow } from "../launch-row";
import type { VersionedSettings } from "../../domain/settings";
import { runTxStep } from "../../ledger/run-step";

export async function graduateStep(deps: KeeperDeps, launch: LaunchRow, s: VersionedSettings, _runId: string): Promise<LaunchRow> {
  if (launch.status === "graduated") return launch;
  const curve = await deps.meteora.curveState(launch.pool);
  if (!curve.migrated) {
    if (curve.complete && launch.ourtoken) {
      await runTxStep(deps.sql, deps.chain, {
        launchId: launch.id, idemKey: `migrate:${launch.id}`, kind: "migrate", settingsVersion: s.version, detail: { pool: launch.pool },
        build: () => deps.meteora.buildMigrate(launch.pool), resolve: async () => [],
      });
    }
    return launch;
  }
  const pos = await deps.meteora.findGraduatedPosition(launch.configKey, launch.mint, launch.quoteMint);
  if (!pos) return launch;
  await deps.sql`update launches set status = 'graduated', damm_pool = ${pos.dammPool}, damm_position = ${pos.position},
    damm_position_nft_account = ${pos.positionNftAccount} where id = ${launch.id}`;
  return { ...launch, status: "graduated", dammPool: pos.dammPool, dammPosition: pos.position, dammPositionNftAccount: pos.positionNftAccount };
}
```

Before migration the keeper claims whatever partner fee is left on the curve in the same run (Task 16 runs claim after graduate, and a graduated launch without a position is still claimed from the DBC pool on the next run because `claimStep` only switches to DAMM once `damm_position` is set).

- [ ] **Step 4: Run tests**

Run: `bun test tests/keeper`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/keeper/steps/graduate.ts tests/keeper/graduate.test.ts && git commit -m "Add graduation step"
```

---

### Task 16: Keeper run loop, resume and reconciliation

**Files:**
- Create: `src/keeper/run.ts`, `src/keeper/main.ts`
- Test: `tests/keeper/run.test.ts`

**Interfaces:**
- Consumes: every step (Tasks 11-15), `makeResolvers`, ledger (`abandonUnsent`, `openSentSteps`, `ledgerTotals`), `resolveSent`.
- Produces:
  - `resume(deps): Promise<void>`
  - `reconcile(deps): Promise<void>` (throws `ReconcileError` listing each `group:mint` where the ledger exceeds the wallet)
  - `processLaunch(deps, launch, settings, runId): Promise<void>` (order: graduate, claim, split, payout, create farms, swap, fund, penalty)
  - `runKeeper(deps): Promise<{ runId: string; launches: number; errors: { launchId: number; error: string }[] }>`

- [ ] **Step 1: Failing tests**

```ts
import { test, expect } from "bun:test";
import { keeperFixture } from "../helpers/keeper-deps";
import { insertLaunch } from "../helpers/fixtures";
import { FakeStaking } from "../helpers/fake-staking";
import { FakeJupiter } from "../helpers/fake-jupiter";
import { runKeeper, resume, reconcile, ReconcileError } from "../../src/keeper/run";
import { beginStep, markSent, getBalance, confirmStep } from "../../src/ledger/ledger";
import { NATIVE_MINT } from "../../src/domain/types";

async function full() {
  const f = await keeperFixture();
  const staking = new FakeStaking(f.chain);
  const jupiter = new FakeJupiter(f.chain);
  jupiter.rates.set("ZEC", 1);
  f.chain.balances.set(`Keeper:${NATIVE_MINT}`, 10n ** 18n);
  return { ...f, staking, jupiter, deps: { ...f.deps, staking, jupiter } };
}

test("a full run claims, splits, pays out, creates farms, swaps and funds", async () => {
  const f = await full();
  const id = await insertLaunch(f.sql, { mint: "CAT", pool: "P1" });
  await f.sql`insert into baskets values (${id}, 'ZEC', 10000)`;
  await f.sql`insert into stake_pools values (${id}, 'kamino', 3000, 'SpillAta', 'pending')`;
  await f.sql`insert into stake_tiers (launch_id, tier_id, lock_seconds, multiplier_bps) values (${id}, '7d', 604800, 10000)`;
  f.meteora.partnerFee.set("P1", 1_000_000_000n);
  const orig = f.staking.totalStaked.bind(f.staking);
  f.staking.totalStaked = async () => 1n;
  const r = await runKeeper(f.deps);
  expect(r.errors).toEqual([]);
  expect(f.staking.funded.length).toBe(1);
  expect(f.staking.funded[0]!.amount).toBe(600_000_000n);
  expect(await getBalance(f.sql, id, "reward", "ZEC")).toBe(0n);
  f.staking.totalStaked = orig;
});

test("resume confirms a sent step whose transaction landed, without resending", async () => {
  const f = await full();
  const id = await insertLaunch(f.sql, { pool: "P2" });
  const row = await beginStep(f.sql, { launchId: id, idemKey: "claim:x", kind: "claim", settingsVersion: 1, detail: { source: "dbc", quoteMint: NATIVE_MINT, amount: "42" } });
  await markSent(f.sql, row.id, "landed-sig", 10_000n);
  f.chain.states.set("landed-sig", "confirmed");
  await resume(f.deps);
  expect(await getBalance(f.sql, id, "unsplit", NATIVE_MINT)).toBe(42n);
  expect(f.chain.sent.length).toBe(0);
});

test("reconcile halts when the ledger holds more than the wallet", async () => {
  const f = await full();
  const id = await insertLaunch(f.sql);
  const row = await beginStep(f.sql, { launchId: id, idemKey: "s", kind: "split", settingsVersion: 1, detail: {} });
  await confirmStep(f.sql, row, [{ bucket: "reward", mint: "ZEC", amount: 100n }]);
  f.chain.balances.set("Keeper:ZEC", 99n);
  await expect(reconcile(f.deps)).rejects.toBeInstanceOf(ReconcileError);
  await expect(runKeeper(f.deps)).rejects.toBeInstanceOf(ReconcileError);
});

test("one launch failing does not stop the others", async () => {
  const f = await full();
  await insertLaunch(f.sql, { pool: "BAD" });
  const good = await insertLaunch(f.sql, { pool: "GOOD" });
  f.meteora.partnerFee.set("GOOD", 1_000n);
  const orig = f.meteora.curveState.bind(f.meteora);
  f.meteora.curveState = async (pool) => { if (pool === "BAD") throw new Error("rpc"); return orig(pool); };
  const r = await runKeeper(f.deps);
  expect(r.errors.length).toBe(1);
  expect(await getBalance(f.sql, good, "unsplit", NATIVE_MINT) + await getBalance(f.sql, good, "basket", NATIVE_MINT)).toBeGreaterThan(0n);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/keeper/run.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/keeper/run.ts`:

```ts
import type { KeeperDeps } from "./deps";
import { loadLaunches, type LaunchRow } from "./launch-row";
import { makeResolvers } from "./resolvers";
import { loadLatestSettings, type VersionedSettings } from "../domain/settings";
import { abandonUnsent, ledgerTotals, openSentSteps } from "../ledger/ledger";
import { resolveSent } from "../ledger/run-step";
import { graduateStep } from "./steps/graduate";
import { claimStep } from "./steps/claim";
import { splitStep } from "./steps/split";
import { payoutStep } from "./steps/payout";
import { createFarmsStep } from "./steps/farms";
import { swapStep } from "./steps/swap";
import { fundStep } from "./steps/fund";
import { penaltyStep } from "./steps/penalty";

export class ReconcileError extends Error {}

export async function resume(deps: KeeperDeps) {
  await abandonUnsent(deps.sql);
  const resolvers = makeResolvers(deps);
  for (const row of await openSentSteps(deps.sql)) {
    await resolveSent(deps.sql, deps.chain, row, resolvers[row.kind]);
  }
}

export async function reconcile(deps: KeeperDeps) {
  const short: string[] = [];
  for (const [key, owed] of await ledgerTotals(deps.sql)) {
    const [group, mint] = key.split(":") as ["keeper" | "spill", string];
    const have = await deps.chain.balance(group === "spill" ? deps.wallets.spill : deps.wallets.keeper, mint);
    if (have < owed) short.push(`${key} ledger=${owed} wallet=${have}`);
  }
  if (short.length) throw new ReconcileError(`ledger exceeds wallet: ${short.join(", ")}`);
}

export async function processLaunch(deps: KeeperDeps, launch: LaunchRow, s: VersionedSettings, runId: string) {
  const l = await graduateStep(deps, launch, s, runId);
  await claimStep(deps, l, s, runId);
  await splitStep(deps, l, s, runId);
  await payoutStep(deps, l, s, runId);
  await createFarmsStep(deps, l, s, runId);
  await swapStep(deps, l, s, runId);
  await fundStep(deps, l, s, runId);
  await penaltyStep(deps, l, s, runId);
}

export async function runKeeper(deps: KeeperDeps) {
  await resume(deps);
  await reconcile(deps);
  const settings = await loadLatestSettings(deps.sql);
  const runId = crypto.randomUUID();
  const launches = await loadLaunches(deps.sql, deps.ourtokenMint);
  const errors: { launchId: number; error: string }[] = [];
  for (const launch of launches) {
    try {
      await processLaunch(deps, launch, settings, runId);
    } catch (e) {
      errors.push({ launchId: launch.id, error: String(e) });
    }
  }
  return { runId, launches: launches.length, errors };
}
```

`reconcile` compares SOL ledger totals against the keeper's lamport balance, which also has to cover transaction fees and farm rent. Keep a float of at least 1 SOL above what the ledger owes; launch fees top it up.

`src/keeper/main.ts`:

```ts
import { Connection } from "@solana/web3.js";
import { loadEnv } from "../env";
import { db } from "../db/client";
import { SolanaChain, loadKeypair } from "../chain/solana";
import { MeteoraLive } from "../meteora/port";
import { JupiterLive } from "../jupiter/port";
import { KaminoBackend } from "../staking/kamino";
import { loadLatestSettings } from "../domain/settings";
import { runKeeper, ReconcileError } from "./run";

const env = loadEnv();
const sql = db(env.DATABASE_URL);
const keeper = loadKeypair(env.KEEPER_KEYPAIR);
const spill = loadKeypair(env.SPILL_KEYPAIR);
const chain = new SolanaChain(new Connection(env.RPC_URL, "confirmed"), keeper, spill);
const deps = {
  sql, chain,
  meteora: new MeteoraLive(chain, env.DAMM_V2_MIGRATION_CONFIG),
  jupiter: new JupiterLive(env.JUPITER_BASE_URL, chain),
  staking: new KaminoBackend(chain, env.RPC_URL, env.KAMINO_GLOBAL_CONFIG),
  wallets: { keeper: keeper.publicKey.toBase58(), spill: spill.publicKey.toBase58(), treasury: env.TREASURY_ADDRESS },
  ourtokenMint: env.OURTOKEN_MINT,
};

while (true) {
  const started = Date.now();
  try {
    const r = await runKeeper(deps);
    console.log(JSON.stringify({ at: new Date().toISOString(), ...r }));
  } catch (e) {
    console.error(JSON.stringify({ at: new Date().toISOString(), fatal: String(e) }));
    if (e instanceof ReconcileError) process.exit(1);
  }
  const { keeperIntervalSeconds } = await loadLatestSettings(sql);
  await Bun.sleep(Math.max(0, keeperIntervalSeconds * 1000 - (Date.now() - started)));
}
```

A `ReconcileError` exits the process on purpose so a supervisor restart loop is visible and nobody's funds are spent while the ledger is wrong.

- [ ] **Step 4: Run all tests and typecheck**

Run: `bun test && bun run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/keeper tests/keeper/run.test.ts && git commit -m "Add keeper run loop with resume and reconciliation"
```

---

### Task 17: Local end-to-end run

Proves the whole backend on a local validator with the Meteora and Kamino programs cloned. No new source files unless the run finds a bug; bugs found here go back into the owning task's tests first.

**Files:**
- Create: `scripts/e2e-local.ts`, `docs/runbook.md`

- [ ] **Step 1: Write the e2e script**

`scripts/e2e-local.ts`, in order:
1. Airdrop to keeper, spill, a creator and two traders; create an OURTOKEN mint and a ZEC stand-in mint.
2. Run the create-configs flow (SOL only, since the local validator has no token badge) and the Kamino global config flow; write the addresses into process env.
3. `migrate`, `saveSettings(defaultSettings(OURTOKEN))`.
4. `prepareLaunch` with basket `[ZEC 100%]`, the creator signs and sends, `confirmLaunch`.
5. Traders buy and sell on the curve 20 times.
6. `runKeeper` once: expect farms created and treasury paid; ZEC swap is skipped (no Jupiter on localnet), so substitute a `FakeJupiter` that mints ZEC to the keeper to stand in for the swap.
7. A staker stakes in the 30d farm via `Farms.stakeIx`; `runKeeper` again: expect `fund` confirmed.
8. The staker exits early; `runKeeper` again: expect `collect_penalty` and `burn` confirmed, and the launch mint supply reduced by the burned amount.
9. Print the `distributions` table and `escrow` table.

- [ ] **Step 2: Run it**

Run: `solana-test-validator ... (flags from Task 2 plus the Kamino clone) & bun scripts/e2e-local.ts`
Expected: steps 6-8 print confirmed rows; mint supply after burn equals supply before minus the penalty.

- [ ] **Step 3: Write the runbook**

`docs/runbook.md`: env vars, wallet roles (keeper holds claimed fees and pays rent, spill only receives penalties, treasury is receive-only), how to create config keys and the Kamino global config, how to run the keeper, what `ReconcileError` means and how to investigate a `failed` distribution row.

- [ ] **Step 4: Commit**

```bash
git add scripts/e2e-local.ts docs/runbook.md && git commit -m "Add local end-to-end script and runbook"
```
