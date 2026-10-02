// Shared by scripts/devnet-bootstrap.ts and scripts/devnet-run.ts: state files, the stand-in token table, budgets and sending.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Keypair, Transaction, VersionedTransaction, type Connection } from "@solana/web3.js";
import bs58 from "bs58";
import { FEE_TIERS_BPS } from "../../src/domain/fees";
import { launchCost } from "../../src/domain/launch-cost";
import { defaultSettings } from "../../src/domain/settings";

export const LAMPORTS = 1_000_000_000;
export const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const DAMM_CUSTOM = "A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck";
export const KEYS_DIR = join(homedir(), ".config", "quants");

/** Stand-ins for the mainnet reward tokens, priced roughly like them against SOL. The keeper is mint authority. */
export const STAND_INS = [
  { symbol: "dZEC", name: "Devnet ZEC", decimals: 8, perSol: 0.5 },
  { symbol: "dJUP", name: "Devnet JUP", decimals: 6, perSol: 400 },
  { symbol: "dBONK", name: "Devnet BONK", decimals: 5, perSol: 10_000_000 },
  { symbol: "dWIF", name: "Devnet WIF", decimals: 6, perSol: 250 },
  { symbol: "dCATE", name: "Devnet CATE", decimals: 6, perSol: 500_000 },
] as const;
export const QUANTS = { symbol: "QUANTS", name: "quants", decimals: 6 } as const;

export type SecretKey = number[];
export const secretOf = (k: Keypair): SecretKey => Array.from(k.secretKey);
export const keypairOf = (s: SecretKey) => Keypair.fromSecretKey(Uint8Array.from(s));

export function loadState<T extends object>(path: string, empty: T): T {
  return existsSync(path) ? { ...empty, ...(JSON.parse(readFileSync(path, "utf8")) as T) } : empty;
}

// Written through a temp file so a crash mid-write never leaves half a state file.
export function saveState(path: string, state: object) {
  writeFileSync(`${path}.tmp`, JSON.stringify(state, null, 2));
  renameSync(`${path}.tmp`, path);
}

export function loadKeeper(path = process.env.DEVNET_KEEPER_PATH ?? join(KEYS_DIR, "devnet-keeper.json")): Keypair {
  if (process.env.KEEPER_KEYPAIR) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.KEEPER_KEYPAIR)));
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

/** A keypair kept in ~/.config/quants (spill, treasury), created on first use. */
export function localKeypair(name: string, dryRun: boolean): Keypair {
  const path = join(KEYS_DIR, name);
  if (existsSync(path)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
  const k = Keypair.generate();
  if (!dryRun) writeFileSync(path, JSON.stringify(secretOf(k)), { mode: 0o600 });
  return k;
}

export const arg = (name: string, argv = process.argv) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
export const num = (name: string, fallback: number, argv = process.argv) => {
  const v = arg(name, argv);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number`);
  return n;
};

/** Rent-exempt minimum for an account of `size` bytes (the cluster's rent is fixed at 3,480 lamports per byte-year, 2 years). */
export const rent = (size: number) => (size + 128) * 6_960;
const SIZES = { mint: 82, metadata: 679, tokenAccount: 165, dammPool: 1112, dammPosition: 408, positionNftMint: 450, positionNftAccount: 170, dbcConfig: 1048, kaminoGlobalConfig: 2136 };
// Token Metadata charges a protocol fee on create; 0.01 SOL is an upper estimate.
const METAPLEX_CREATE_FEE = 10_000_000;
const SIG = 5_000;

export interface BootstrapOptions { liquiditySol: number; solGraduation: number; usdcGraduation: number; quantsGraduation: number; quantsPerSol: number }

export interface BudgetLine { item: string; lamports: number }

export interface BootstrapTodo { tokens: number; pools: number; kamino: number; configs: number; treasury: number }

/** SOL the bootstrap spends; `todo` limits it to the steps not done yet (all of them by default). */
export function bootstrapBudget(o: BootstrapOptions, todo?: BootstrapTodo): { lines: BudgetLine[]; total: number } {
  const tokens = STAND_INS.length + 1;
  const configs = 3 * FEE_TIERS_BPS.length;
  const n = todo ?? { tokens, pools: tokens, kamino: 1, configs, treasury: 1 };
  const mint = rent(SIZES.mint) + rent(SIZES.metadata) + METAPLEX_CREATE_FEE + rent(SIZES.tokenAccount) + 2 * SIG;
  const pool = Math.round(o.liquiditySol * LAMPORTS) + rent(SIZES.dammPool) + rent(SIZES.dammPosition) + rent(SIZES.positionNftMint)
    + rent(SIZES.positionNftAccount) + 3 * rent(SIZES.tokenAccount) + 2 * SIG;
  const lines: BudgetLine[] = [
    { item: `${n.tokens} mints with metadata (QUANTS and ${STAND_INS.length} stand-ins)`, lamports: n.tokens * mint },
    { item: `${n.pools} DAMM v2 pools, ${o.liquiditySol} SOL each plus rent`, lamports: n.pools * pool },
    { item: "Kamino global config", lamports: n.kamino * (rent(SIZES.kaminoGlobalConfig) + 4 * SIG) },
    { item: `${n.configs} DBC config keys (SOL, USDC, QUANTS x ${FEE_TIERS_BPS.length} tiers)`, lamports: n.configs * (rent(SIZES.dbcConfig) + 2 * SIG) },
    { item: "treasury account", lamports: n.treasury * (rent(0) + SIG) },
  ].filter((l) => l.lamports > 0);
  const sum = lines.reduce((a, l) => a + l.lamports, 0);
  lines.push({ item: "margin (15%)", lamports: Math.round(sum * 0.15) });
  return { lines, total: lines.reduce((a, l) => a + l.lamports, 0) };
}

export interface RunOptions { roundTripSol: number; solGraduation: number; feeTierBps: number; basketSize: number }

/**
 * What scripts/devnet-run.ts sends to its two wallets and spends from the keeper. Staking opens once the stakers'
 * share of fees covers the farm rent, so the trading volume needed follows from the rent and the fee tier; DBC keeps a
 * protocol share of each fee (taken here as 20%) before the keeper can claim it.
 */
export function runBudget(o: RunOptions): { lines: BudgetLine[]; total: number; volumeSol: number } {
  const s = defaultSettings("11111111111111111111111111111111");
  const farmRent = Number(launchCost(s, o.basketSize).rent);
  const basketShare = s.split.basketBps / 10_000;
  const feesNeeded = farmRent / basketShare / 0.8;
  const volume = feesNeeded / (o.feeTierBps / 10_000);
  const launch = 3 * rent(SIZES.tokenAccount) + rent(SIZES.mint) + rent(SIZES.metadata) + METAPLEX_CREATE_FEE + rent(700) + 0.05 * LAMPORTS;
  const lines: BudgetLine[] = [
    { item: "launch with a 0.05 SOL first buy", lamports: Math.round(launch) },
    { item: `round trips: ${o.roundTripSol} SOL working balance`, lamports: Math.round(o.roundTripSol * LAMPORTS * 1.1) },
    { item: `fees to open staking (${(volume / LAMPORTS).toFixed(1)} SOL of volume at ${o.feeTierBps / 100}%)`, lamports: Math.round(feesNeeded * 1.1) },
    { item: "stake buys for two wallets", lamports: Math.round(0.2 * LAMPORTS) },
    { item: `buys to graduate (${o.solGraduation} SOL raised, partly sold back after)`, lamports: Math.round(o.solGraduation * LAMPORTS * 1.1) },
    { item: "transaction fees and token accounts (wallets and keeper)", lamports: Math.round(0.1 * LAMPORTS) },
  ];
  return { lines, total: lines.reduce((a, l) => a + l.lamports, 0), volumeSol: volume / LAMPORTS };
}

export const sol = (lamports: number | bigint) => (Number(lamports) / LAMPORTS).toFixed(4);

export function printBudget(title: string, b: { lines: BudgetLine[]; total: number }) {
  console.log(title);
  for (const l of b.lines) console.log(`  ${sol(l.lamports).padStart(9)} SOL  ${l.item}`);
  console.log(`  ${sol(b.total).padStart(9)} SOL  total`);
}

// RETRY-LOOP-SAFETY: bounded by design.
//   attempts: at most `attempts` tries (default 4), with 2s, 4s, 8s between them; the last error is thrown.
//   safety:   callers either rebuild an idempotent step (they check the chain first) or send through sendTx, which only
//             gives up on a signature once its blockhash has expired, so a retry can never double-send a landed transaction.
export async function withRetries<T>(label: string, fn: (attempt: number) => Promise<T>, attempts = 4): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn(i);
    } catch (e) {
      last = e;
      if (i < attempts) {
        console.error(`  ${label}: attempt ${i} failed (${String(e).slice(0, 200)}), retrying`);
        await Bun.sleep(2_000 * 2 ** (i - 1));
      }
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${String(last)}`);
}

/**
 * Sends a transaction that is already fully signed against its own blockhash (a launch, which the mint keypair signed
 * when it was prepared). Resends every 2 seconds until it lands, fails, or its blockhash is no longer valid.
 */
export async function sendSigned(conn: Connection, tx: Transaction): Promise<string> {
  const raw = tx.serialize();
  const sig = bs58.encode(tx.signature!);
  await conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 0 });
  while (true) {
    const { value } = await conn.getSignatureStatuses([sig]);
    const s = value[0];
    if (s?.err) throw new Error(`transaction ${sig} failed: ${JSON.stringify(s.err)}`);
    if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return sig;
    if (!(await conn.isBlockhashValid(tx.recentBlockhash!, { commitment: "confirmed" })).value) {
      const late = (await conn.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0];
      if (late && !late.err) return sig;
      throw new Error(`transaction ${sig} expired before it landed`);
    }
    await Bun.sleep(2_000);
    await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
  }
}

/**
 * Signs, sends and waits for a transaction. Resends the same bytes every 2 seconds while its blockhash is valid
 * (bounded by lastValidBlockHeight, about 60 to 90 seconds), then reports it as expired. A failed transaction throws.
 */
export async function sendTx(conn: Connection, tx: Transaction | VersionedTransaction, signers: Keypair[]): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  let raw: Uint8Array, sig: string;
  if (tx instanceof VersionedTransaction) {
    tx.message.recentBlockhash = blockhash;
    tx.sign(signers);
    raw = tx.serialize();
    sig = bs58.encode(tx.signatures[0]!);
  } else {
    tx.recentBlockhash = blockhash;
    tx.feePayer ??= signers[0]!.publicKey;
    tx.sign(...signers);
    raw = tx.serialize();
    sig = bs58.encode(tx.signature!);
  }
  await conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 0 });
  while (true) {
    const { value } = await conn.getSignatureStatuses([sig], { searchTransactionHistory: false });
    const s = value[0];
    if (s?.err) throw new Error(`transaction ${sig} failed: ${JSON.stringify(s.err)}`);
    if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return sig;
    if ((await conn.getBlockHeight("confirmed")) > lastValidBlockHeight) {
      const late = (await conn.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0];
      if (late && !late.err) return sig;
      throw new Error(`transaction ${sig} expired before it landed`);
    }
    await Bun.sleep(2_000);
    await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
  }
}
