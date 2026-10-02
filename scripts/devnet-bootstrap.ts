// Sets up devnet for quants, once: the QUANTS mint, five stand-in reward tokens, a DAMM v2 pool against SOL for each,
// a Kamino global config and DBC config keys for SOL, devnet USDC and QUANTS. Writes config-keys.devnet.json, devnet.env
// (web, indexer and keeper settings) and devnet.secrets.env (keeper and spill keypairs).
//
//   bun scripts/devnet-bootstrap.ts --dry-run          planned steps, what is already on chain, and the SOL budget
//   bun scripts/devnet-bootstrap.ts                    runs the steps not done yet
//
// Options: --rpc <url> (default DEVNET_RPC_URL, else api.devnet.solana.com), --keeper <path> (default
// ~/.config/quants/devnet-keeper.json, or KEEPER_KEYPAIR), --state <path> (default devnet-state.json),
// --liquidity-sol 0.3, --sol-graduation 2, --usdc-graduation 300, --quants-per-sol 1000000, --quants-graduation <units>.
//
// Idempotent: every address is written to the state file before its transaction is sent, and every step checks the
// chain first, so a run that stopped half way picks up where it was.
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  MINT_SIZE, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createInitializeMint2Instruction, createMintToInstruction,
  getAssociatedTokenAddressSync, getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  ActivationType, BaseFeeMode, CollectFeeMode, CpAmm, MAX_SQRT_PRICE, MIN_SQRT_PRICE, deriveCustomizablePoolAddress, getBaseFeeParams,
} from "@meteora-ag/cp-amm-sdk";
import { Farms, GlobalConfigOption } from "@kamino-finance/farms-sdk";
import { address, createSolanaRpc } from "@solana/kit";
import BN from "bn.js";
import { fromKitInstruction, kitSigner } from "../src/chain/solana";
import { createMetadataIx } from "../src/chain/metadata";
import { configKeyName, FEE_TIERS_BPS } from "../src/meteora/config";
import { createConfigTx } from "../src/meteora/create-config";
import { NATIVE_MINT } from "../src/domain/types";
import type { PoolToken } from "../src/jupiter/damm";
import {
  DAMM_CUSTOM, DEVNET_USDC, LAMPORTS, QUANTS, STAND_INS, arg, bootstrapBudget, keypairOf, loadKeeper, loadState, localKeypair, num, printBudget,
  rent, runBudget, saveState, secretOf, sendTx, sol, withRetries, type SecretKey,
} from "./lib/devnet";

interface TokenState { secret: SecretKey; mint: string; symbol: string; name: string; decimals: number; perSol: number }
interface State {
  keeper?: string;
  tokens: Record<string, TokenState>;
  pools: Record<string, { nftSecret: SecretKey; pool: string }>;
  kamino?: { secret: SecretKey; address: string; treasuryFeeSet?: boolean };
  configs: Record<string, { secret: SecretKey; address: string; graduation: number }>;
}

const dryRun = process.argv.includes("--dry-run");
const rpc = arg("--rpc") ?? process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
const statePath = arg("--state") ?? "devnet-state.json";
const liquiditySol = num("--liquidity-sol", 0.3);
const solGraduation = num("--sol-graduation", 2);
const usdcGraduation = num("--usdc-graduation", 300);
const quantsPerSol = num("--quants-per-sol", 1_000_000);
const quantsGraduation = num("--quants-graduation", solGraduation * quantsPerSol);

const conn = new Connection(rpc, "confirmed");
const keeper = loadKeeper(arg("--keeper"));
const state = loadState<State>(statePath, { tokens: {}, pools: {}, configs: {} });
if (state.keeper && state.keeper !== keeper.publicKey.toBase58()) {
  throw new Error(`${statePath} belongs to keeper ${state.keeper}, not ${keeper.publicKey.toBase58()}. Use --state for another file.`);
}
const save = () => { if (!dryRun) saveState(statePath, { ...state, keeper: keeper.publicKey.toBase58() }); };
const exists = async (k: PublicKey | string) => !!(await conn.getAccountInfo(new PublicKey(k), "confirmed"));
const log = (m: string) => console.log(`[bootstrap] ${m}`);
const tx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

const tokenSpecs = [
  { symbol: QUANTS.symbol, name: QUANTS.name, decimals: QUANTS.decimals, perSol: quantsPerSol },
  ...STAND_INS.map((t) => ({ symbol: t.symbol, name: t.name, decimals: t.decimals, perSol: t.perSol })),
];
const spill = localKeypair("devnet-spill.json", dryRun);
const treasury = localKeypair("devnet-treasury.json", dryRun);

// What is left to do, read from the chain.
const todo = { tokens: 0, pools: 0, kamino: 0, configs: 0, treasury: 0 };
const plan: string[] = [];
for (const t of tokenSpecs) {
  const s = state.tokens[t.symbol];
  const mintDone = !!s && (await exists(s.mint));
  const poolDone = !!s && (await exists(deriveCustomizablePoolAddress(new PublicKey(s.mint), new PublicKey(NATIVE_MINT))));
  if (!mintDone) todo.tokens++;
  if (!poolDone) todo.pools++;
  plan.push(`${mintDone ? "done" : "todo"}  ${t.symbol} mint (${t.decimals} decimals) with metadata${s ? ` ${s.mint}` : ""}`);
  plan.push(`${poolDone ? "done" : "todo"}  ${t.symbol}/SOL DAMM v2 pool, ${liquiditySol} SOL and ${liquiditySol * t.perSol} ${t.symbol}`);
}
const kaminoDone = !!state.kamino && (await exists(state.kamino.address)) && !!state.kamino.treasuryFeeSet;
if (!kaminoDone) todo.kamino++;
plan.push(`${kaminoDone ? "done" : "todo"}  Kamino global config with treasury fee 0${state.kamino ? ` ${state.kamino.address}` : ""}`);
const quoteSpecs = (quantsMint: string | undefined) => [
  { label: "SOL", mint: NATIVE_MINT, decimals: 9, migrationQuoteThreshold: solGraduation },
  { label: "USDC", mint: DEVNET_USDC, decimals: 6, migrationQuoteThreshold: usdcGraduation },
  { label: "QUANTS", mint: quantsMint, decimals: QUANTS.decimals, migrationQuoteThreshold: quantsGraduation },
];
for (const q of quoteSpecs(state.tokens.QUANTS?.mint)) {
  for (const bps of FEE_TIERS_BPS) {
    const c = q.mint ? state.configs[configKeyName(q.mint, bps)] : undefined;
    const done = !!c && (await exists(c.address));
    if (!done) todo.configs++;
    if (c && c.graduation !== q.migrationQuoteThreshold) log(`warning: ${q.label} ${bps / 100}% config graduates at ${c.graduation}, not ${q.migrationQuoteThreshold}; config keys keep the target they were created with`);
    plan.push(`${done ? "done" : "todo"}  DBC config ${q.label} ${bps / 100}%, graduates at ${q.migrationQuoteThreshold} ${q.label}`);
  }
}
const treasuryDone = (await conn.getBalance(treasury.publicKey)) >= rent(0);
if (!treasuryDone) todo.treasury++;
plan.push(`${treasuryDone ? "done" : "todo"}  treasury ${treasury.publicKey.toBase58()} funded to the rent-exempt minimum`);

const opts = { liquiditySol, solGraduation, usdcGraduation, quantsGraduation, quantsPerSol };
const full = bootstrapBudget(opts);
const remaining = bootstrapBudget(opts, todo);
const balance = await conn.getBalance(keeper.publicKey);
log(`rpc ${rpc.replace(/api-key=[^&]+/, "api-key=***")}`);
log(`keeper ${keeper.publicKey.toBase58()} has ${sol(balance)} SOL`);
console.log(plan.map((p) => `  ${p}`).join("\n"));
printBudget("Bootstrap budget (all steps):", full);
if (remaining.total !== full.total) printBudget("Left to spend (steps not done yet):", remaining);
printBudget("Then scripts/devnet-run.ts needs about (sent from the keeper):", runBudget({ roundTripSol: 0.5, solGraduation, feeTierBps: 300, basketSize: 3 }));

const allDone = Object.values(todo).every((n) => n === 0);
if (dryRun) {
  if (!allDone && balance < remaining.total) log(`the keeper is ${sol(remaining.total - balance)} SOL short of the steps left`);
  log("dry run: nothing sent");
  process.exit(0);
}
if (!allDone && balance < remaining.total) {
  console.error(`[bootstrap] stopping: the keeper has ${sol(balance)} SOL and the steps left need about ${sol(remaining.total)} SOL. Fund ${keeper.publicKey.toBase58()} (https://faucet.solana.com) and run again.`);
  process.exit(1);
}

// Mints: create, metadata, keeper token account and supply in one transaction, so the mint existing means all of it landed.
for (const t of tokenSpecs) {
  let s = state.tokens[t.symbol];
  if (!s) {
    const kp = Keypair.generate();
    s = state.tokens[t.symbol] = { secret: secretOf(kp), mint: kp.publicKey.toBase58(), ...t };
    save();
  }
  if (await exists(s.mint)) continue;
  const kp = keypairOf(s.secret);
  const mint = kp.publicKey;
  const ata = getAssociatedTokenAddressSync(mint, keeper.publicKey);
  // Supply worth 1,000 SOL at the pool price, all to the keeper; it can mint more later.
  const supply = BigInt(Math.round(t.perSol * 1_000)) * 10n ** BigInt(t.decimals);
  const sig = await withRetries(`${t.symbol} mint`, async () => {
    if (await exists(mint)) return "already on chain";
    return sendTx(conn, new Transaction().add(
      SystemProgram.createAccount({ fromPubkey: keeper.publicKey, newAccountPubkey: mint, lamports: await getMinimumBalanceForRentExemptMint(conn), space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
      createInitializeMint2Instruction(mint, t.decimals, keeper.publicKey, null),
      createMetadataIx({ mint, authority: keeper.publicKey, payer: keeper.publicKey, name: t.name, symbol: t.symbol, uri: "" }),
      createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, ata, keeper.publicKey, mint),
      createMintToInstruction(mint, ata, keeper.publicKey, supply),
    ), [keeper, kp]);
  });
  log(`${t.symbol} mint ${mint.toBase58()} ${tx(sig)}`);
}

const cp = new CpAmm(conn);
for (const t of tokenSpecs) {
  const s = state.tokens[t.symbol]!;
  const mint = new PublicKey(s.mint);
  const pool = deriveCustomizablePoolAddress(mint, new PublicKey(NATIVE_MINT));
  if (await exists(pool)) {
    state.pools[t.symbol] ??= { nftSecret: [], pool: pool.toBase58() };
    continue;
  }
  if (!state.pools[t.symbol]?.nftSecret.length) {
    state.pools[t.symbol] = { nftSecret: secretOf(Keypair.generate()), pool: pool.toBase58() };
    save();
  }
  const nft = keypairOf(state.pools[t.symbol]!.nftSecret);
  const tokenAAmount = new BN((BigInt(Math.round(t.perSol * liquiditySol * 1e6)) * 10n ** BigInt(t.decimals) / 1_000_000n).toString());
  const tokenBAmount = new BN(Math.round(liquiditySol * LAMPORTS).toString());
  const sig = await withRetries(`${t.symbol} pool`, async () => {
    if (await exists(pool)) return "already on chain";
    const { initSqrtPrice, liquidityDelta } = cp.preparePoolCreationParams({ tokenAAmount, tokenBAmount, minSqrtPrice: MIN_SQRT_PRICE, maxSqrtPrice: MAX_SQRT_PRICE, collectFeeMode: CollectFeeMode.BothToken });
    const { tx: create } = await cp.createCustomPool({
      payer: keeper.publicKey, creator: keeper.publicKey, positionNft: nft.publicKey, tokenAMint: mint, tokenBMint: new PublicKey(NATIVE_MINT),
      tokenAAmount, tokenBAmount, sqrtMinPrice: MIN_SQRT_PRICE, sqrtMaxPrice: MAX_SQRT_PRICE, liquidityDelta, initSqrtPrice,
      poolFees: {
        baseFee: getBaseFeeParams({ baseFeeMode: BaseFeeMode.FeeTimeSchedulerLinear, feeTimeSchedulerParam: { startingFeeBps: 25, endingFeeBps: 25, numberOfPeriod: 0, totalDuration: 0 } }),
        compoundingFeeBps: 0, padding: 0, dynamicFee: null,
      },
      hasAlphaVault: false, activationType: ActivationType.Timestamp, collectFeeMode: CollectFeeMode.BothToken, activationPoint: null,
      tokenAProgram: TOKEN_PROGRAM_ID, tokenBProgram: TOKEN_PROGRAM_ID,
    });
    return sendTx(conn, create, [keeper, nft]);
  });
  save();
  log(`${t.symbol}/SOL pool ${pool.toBase58()} ${tx(sig)}`);
}

const farms = new Farms(createSolanaRpc(rpc));
if (!state.kamino) {
  const gc = Keypair.generate();
  state.kamino = { secret: secretOf(gc), address: gc.publicKey.toBase58() };
  save();
}
const gc = keypairOf(state.kamino.secret);
if (!(await exists(gc.publicKey))) {
  const sig = await withRetries("Kamino global config", async () => {
    if (await exists(gc.publicKey)) return "already on chain";
    return sendTx(conn, new Transaction().add(...(await farms.createGlobalConfigIxs(kitSigner(keeper), kitSigner(gc))).map(fromKitInstruction)), [keeper, gc]);
  });
  log(`Kamino global config ${gc.publicKey.toBase58()} ${tx(sig)}`);
}
if (!state.kamino.treasuryFeeSet) {
  const sig = await withRetries("Kamino treasury fee", async () => sendTx(conn, new Transaction().add(
    fromKitInstruction(await farms.updateGlobalConfigIx(kitSigner(keeper), address(gc.publicKey.toBase58()), GlobalConfigOption.SetTreasuryFeeBps, "0", "number")),
  ), [keeper]));
  state.kamino.treasuryFeeSet = true;
  save();
  log(`Kamino treasury fee set to 0 ${tx(sig)}`);
}

const client = DynamicBondingCurveClient.create(conn, "confirmed");
for (const q of quoteSpecs(state.tokens.QUANTS!.mint)) {
  for (const bps of FEE_TIERS_BPS) {
    const name = configKeyName(q.mint!, bps);
    if (!state.configs[name]) {
      const kp = Keypair.generate();
      state.configs[name] = { secret: secretOf(kp), address: kp.publicKey.toBase58(), graduation: q.migrationQuoteThreshold };
      save();
    }
    const kp = keypairOf(state.configs[name]!.secret);
    if (await exists(kp.publicKey)) continue;
    const spec = { mint: q.mint!, decimals: q.decimals, migrationQuoteThreshold: state.configs[name]!.graduation };
    const sig = await withRetries(`${q.label} ${bps} config`, async () => {
      if (await exists(kp.publicKey)) return "already on chain";
      return sendTx(conn, await createConfigTx(client, conn, keeper.publicKey, kp.publicKey, bps, spec), [keeper, kp]);
    });
    log(`DBC config ${q.label} ${bps / 100}% ${kp.publicKey.toBase58()} ${tx(sig)}`);
  }
}

if ((await conn.getBalance(treasury.publicKey)) < rent(0)) {
  const sig = await withRetries("treasury", async () => {
    const short = rent(0) - (await conn.getBalance(treasury.publicKey));
    if (short <= 0) return "already funded";
    return sendTx(conn, new Transaction().add(SystemProgram.transfer({ fromPubkey: keeper.publicKey, toPubkey: treasury.publicKey, lamports: short })), [keeper]);
  });
  log(`treasury funded ${tx(sig)}`);
}

const quants = state.tokens.QUANTS!;
const configKeys = Object.fromEntries(Object.entries(state.configs).map(([k, v]) => [k, v.address]));
const devnetTokens: PoolToken[] = tokenSpecs.map((t) => ({
  mint: state.tokens[t.symbol]!.mint, symbol: t.symbol, name: t.name, decimals: t.decimals, pool: state.pools[t.symbol]!.pool, icon: null,
}));
const graduations = { SOL: solGraduation, USDC: usdcGraduation, QUANTS: state.configs[configKeyName(quants.mint, FEE_TIERS_BPS[0])]!.graduation };
const env: Record<string, string> = {
  CLUSTER: "devnet",
  KEEPER_ADDRESS: keeper.publicKey.toBase58(),
  SPILL_ADDRESS: spill.publicKey.toBase58(),
  TREASURY_ADDRESS: treasury.publicKey.toBase58(),
  OURTOKEN_MINT: quants.mint,
  OURTOKEN_SYMBOL: QUANTS.symbol,
  OURTOKEN_DECIMALS: String(QUANTS.decimals),
  OURTOKEN_GRADUATION: String(graduations.QUANTS),
  KAMINO_GLOBAL_CONFIG: state.kamino.address,
  DAMM_V2_MIGRATION_CONFIG: DAMM_CUSTOM,
  QUOTE_MINTS: JSON.stringify({ USDC: DEVNET_USDC }),
  QUOTE_GRADUATIONS: JSON.stringify(graduations),
  CONFIG_KEYS_PATH: "config-keys.devnet.json",
  CONFIG_KEYS: JSON.stringify(configKeys),
  DEVNET_TOKENS: JSON.stringify(devnetTokens),
  // The browser's RPC is public: keep API keys (DEVNET_RPC_URL) server side.
  NEXT_PUBLIC_RPC_URL: "https://api.devnet.solana.com",
  NEXT_PUBLIC_OURTOKEN_MINT: quants.mint,
  NEXT_PUBLIC_OURTOKEN_SYMBOL: QUANTS.symbol,
  NEXT_PUBLIC_SOL_GRADUATION: String(solGraduation),
  NEXT_PUBLIC_OURTOKEN_GRADUATION: String(graduations.QUANTS),
};
const dotenv = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${k}='${v}'`).join("\n") + "\n";
await Bun.write("config-keys.devnet.json", JSON.stringify(configKeys, null, 2));
await Bun.write("devnet.env", dotenv(env));
await Bun.write("devnet.secrets.env", dotenv({ KEEPER_KEYPAIR: JSON.stringify(secretOf(keeper)), SPILL_KEYPAIR: JSON.stringify(secretOf(spill)) }));
log(`done. Keeper has ${sol(await conn.getBalance(keeper.publicKey))} SOL left. Wrote config-keys.devnet.json, devnet.env and devnet.secrets.env`);
process.exit(0);
